import { test, expect } from '@playwright/test';
import { featureNames, guard, openApp, seedBlock, settle, store, volume } from './helpers';

test.describe('fixes from user research', () => {
  let check: () => void;
  test.beforeEach(async ({ page }) => {
    check = guard(page);
    await openApp(page);
  });
  test.afterEach(() => check());

  test('Fix 1: version history keeps a restore point and restores it', async ({ page }) => {
    await seedBlock(page, 25);
    await page.waitForTimeout(1500); // first autosave keeps a version
    // keep working: add a cut
    await store(page, `S().beginSketch(S().doc.features[1].id); S().addCircle({ at: { x: 30, y: 20 } }, 5); S().beginFeature('cutExtrude'); S().updateDraft((d) => { d.direction1.type = 'throughAllBoth'; }); S().confirmFeature();`);
    expect(await featureNames(page)).toContain('Cut1');
    await page.getByRole('button', { name: 'File' }).click();
    await page.getByRole('menuitem', { name: 'Version history…' }).click();
    const dlg = page.getByRole('dialog', { name: 'Version history' });
    await expect(dlg.getByText(/Automatic · 2 features/)).toBeVisible();
    await dlg.getByRole('button', { name: 'Keep a version now' }).click();
    await expect(dlg.getByText(/Kept by you · 4 features/)).toBeVisible();
    // restore the automatic one (block only)
    await dlg.locator('li', { hasText: 'Automatic' }).getByRole('button', { name: 'Restore' }).click();
    await expect(page.getByText(/Restored the version from/)).toBeVisible();
    expect(await featureNames(page)).not.toContain('Cut1');
    expect(await volume(page)).toBeCloseTo(60000, 0);
    // what was open before the restore is in the history too
    await page.getByRole('button', { name: 'File' }).click();
    await page.getByRole('menuitem', { name: 'Version history…' }).click();
    await expect(page.getByRole('dialog', { name: 'Version history' }).getByText(/Before a restore · 4 features/)).toBeVisible();
  });

  test('Fix 3: rebuild errors show the root cause first, with Re-pick', async ({ page }) => {
    await seedBlock(page, 25);
    await store(page, `
      const ex = S().doc.features[4].id;
      S().beginSketch({ kind: 'face', face: { kind: 'cap', featureId: ex, cap: 'end', flip: false } });
      S().addCircle({ at: { x: 30, y: 20 } }, 5); S().beginFeature('cutExtrude'); S().confirmFeature();
      const sk = S().doc.features[3].sketch;
      S().beginFeature('fillet');
      S().toggleEdge({ kind: 'capEdge', featureId: ex, cap: 'end', segmentId: sk.entities.find((e) => e.kind === 'line').id });
      S().confirmFeature();
      // break the base: depth 0 fails Extrude1, which takes the cut and the fillet down with it
      S().editFeature(ex); S().updateDraft((d) => { d.direction1.depth = { expr: '0', value: 0 }; }); S().confirmFeature();`);
    await settle(page);
    await page.getByRole('button', { name: /rebuild errors?/ }).click();
    const dlg = page.getByRole('dialog', { name: 'What went wrong' });
    await expect(dlg.getByText('Start here')).toBeVisible();
    // the first listed problem is Extrude1; the cut is shown as caused by it
    await expect(dlg.getByText('Extrude1', { exact: true })).toBeVisible();
    await expect(dlg.getByText(/Caused by Extrude1/).first()).toBeVisible();
  });

  test('Fix 3: Re-pick drops a lost edge and reopens the fillet', async ({ page }) => {
    await seedBlock(page, 25);
    await store(page, `
      const ex = S().doc.features[4].id; const sk = S().doc.features[3].sketch;
      const lines = sk.entities.filter((e) => e.kind === 'line');
      S().beginFeature('fillet');
      S().toggleEdge({ kind: 'capEdge', featureId: ex, cap: 'end', segmentId: lines[0].id }); // front top edge, middle at (30, 0, 25)
      S().toggleEdge({ kind: 'capEdge', featureId: ex, cap: 'end', segmentId: lines[2].id }); // back top edge
      S().confirmFeature();
      // roll back above the fillet and insert a notch that cuts away the middle of the front top edge
      S().setRollback(5);
      S().beginSketch(S().doc.features[0].id); S().addRect({ at: { x: 20, y: 15 } }, { at: { x: 40, y: 30 } });
      S().beginFeature('cutExtrude'); S().updateDraft((d) => { d.direction1.type = 'throughAllBoth'; }); S().confirmFeature();
      S().setRollback(S().doc.features.length);`);
    await settle(page);
    expect(await featureNames(page)).toEqual(['Front plane', 'Top plane', 'Right plane', 'Sketch1', 'Extrude1', 'Sketch2', 'Cut1', 'Fillet1']);
    await page.getByRole('button', { name: /rebuild error/ }).click();
    const dlg = page.getByRole('dialog', { name: 'What went wrong' });
    await expect(dlg.getByText(/Edge 1 \(Extrude1 end edge\) no longer exists/)).toBeVisible();
    await dlg.getByRole('button', { name: 'Re-pick' }).click();
    await expect(page.getByRole('heading', { name: 'Edit Fillet1' })).toBeVisible();
    // the lost edge was dropped, the other one kept
    expect(await store<number>(page, `return S().mode.draft.edges.length;`)).toBe(1);
  });

  test('Fix 5: rebuilds reuse every feature before the change', async ({ page }) => {
    await seedBlock(page, 25);
    await store(page, `
      S().beginSketch(S().doc.features[1].id); S().addRect({ at: { x: 62, y: 0 } }, { at: { x: 72, y: 10 } });
      S().beginFeature('extrude'); S().updateDraft((d) => { d.direction1.depth = { expr: '10', value: 10 }; }); S().confirmFeature();`);
    expect(await volume(page)).toBeCloseTo(61000, 0);
    // change only the last feature
    await store(page, `const ex2 = S().doc.features.find((f) => f.name === 'Extrude2').id; S().editFeature(ex2); S().updateDraft((d) => { d.direction1.depth = { expr: '20', value: 20 }; }); S().confirmFeature();`);
    expect(await volume(page)).toBeCloseTo(62000, 0);
    const st = await store<Record<string, { cached?: boolean; ms?: number }>>(page, `
      const ids = Object.fromEntries(S().doc.features.map((f) => [f.name, f.id]));
      const s = K().statuses; return { e1: s[ids.Extrude1], e2: s[ids.Extrude2] };`);
    expect(st.e1.cached).toBe(true); // Extrude1 came from the cache
    expect(st.e2.cached).toBeFalsy(); // Extrude2 was rebuilt
    expect(typeof st.e2.ms).toBe('number');
    // the tooltip in the tree says how long it took
    await expect(page.getByRole('treeitem', { name: 'Extrude2' })).toHaveAttribute('title', /Built in [\d.]+ ms/);
  });
});
