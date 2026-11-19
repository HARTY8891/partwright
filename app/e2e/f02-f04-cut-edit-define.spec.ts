import { test, expect } from '@playwright/test';
import { clickSketch, clickWorld, featureNames, guard, iso, openApp, seedBlock, settle, store, typeDimension, volume } from './helpers';

test.describe('F02 cut a hole through a face', () => {
  let check: () => void;
  test.beforeEach(async ({ page }) => {
    check = guard(page);
    await openApp(page);
  });
  test.afterEach(() => check());

  test('F02-H1 pick the top face, sketch a circle, cut through', async ({ page }) => {
    await seedBlock(page, 25);
    await iso(page);
    await clickWorld(page, [40, 30, 25]);
    expect(await store<string>(page, `return window.__pw.useView.getState().pickedFace?.cap;`)).toBe('end');
    await page.keyboard.press('s');
    await page.keyboard.press('c');
    await clickSketch(page, 30, 20);
    await clickSketch(page, 34, 20);
    await page.keyboard.press('d');
    await clickSketch(page, 34, 20);
    await typeDimension(page, '20');
    await page.getByRole('button', { name: 'Cut', exact: true }).click();
    await settle(page);
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    expect(await volume(page)).toBeCloseTo(60000 - Math.PI * 100 * 25, 0);
    expect(await featureNames(page)).toContain('Cut1');
  });

  test('F02-E1 cut with no solid is refused', async ({ page }) => {
    await store(page, `S().beginSketch(S().doc.features[1].id); S().addCircle({ at: { x: 0, y: 0 } }, 5); S().beginFeature('cutExtrude');`);
    await settle(page);
    await expect(page.getByRole('alert').filter({ hasText: /no solid to cut/i })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeDisabled();
  });

  test('F02-E2 a cut that misses the part is reported', async ({ page }) => {
    await seedBlock(page, 25);
    await store(page, `S().beginSketch(S().doc.features[1].id); S().addCircle({ at: { x: 200, y: 200 } }, 5); S().beginFeature('cutExtrude'); S().updateDraft((d) => { d.direction1.type = 'throughAllBoth'; });`);
    await settle(page);
    await expect(page.getByRole('alert').filter({ hasText: /does not touch/i })).toBeVisible();
  });
});

test.describe('F03 change a dimension and rebuild', () => {
  let check: () => void;
  test.beforeEach(async ({ page }) => {
    check = guard(page);
    await openApp(page);
  });
  test.afterEach(() => check());

  test('F03-H1 edit Sketch1, D1 60 → 80', async ({ page }) => {
    await store(page, `
      S().beginSketch(S().doc.features[1].id);
      S().addRect({ at: { x: 0, y: 0 } }, { at: { x: 60, y: 40 } });
      const l = S().doc.features[3].sketch.entities.find((e) => e.kind === 'line');
      S().addDimension(l.id); S().setDimension(S().editingDimId, '60', 60);
      S().beginFeature('extrude'); S().updateDraft((d) => { d.direction1.depth = { expr: '25', value: 25 }; }); S().confirmFeature();
    `);
    expect(await volume(page)).toBeCloseTo(60000, 0);
    await page.getByRole('treeitem', { name: 'Sketch1' }).dblclick();
    await page.getByRole('button', { name: /Dimension D1/ }).dblclick();
    await typeDimension(page, '80');
    await page.getByRole('button', { name: 'Finish sketch' }).first().click();
    expect(await volume(page)).toBeCloseTo(80000, 0);
  });

  test('F03-E1 a change that breaks a later fillet shows an error and keeps the part', async ({ page }) => {
    await seedBlock(page, 25);
    await store(page, `
      const ex = S().doc.features[4].id;
      const sk = S().doc.features[3].sketch;
      S().beginFeature('fillet');
      for (const l of sk.entities.filter((e) => e.kind === 'line')) S().toggleEdge({ kind: 'capEdge', featureId: ex, cap: 'end', segmentId: l.id });
      S().updateDraft((d) => { d.size = { expr: '8', value: 8 }; });
      S().confirmFeature();
      S().editFeature(ex); S().updateDraft((d) => { d.direction1.depth = { expr: '5', value: 5 }; }); S().confirmFeature();
    `);
    await settle(page);
    const fillet = await store<{ status: string; message: string }>(page, `const f = S().doc.features.find((x) => x.name === 'Fillet1'); return K().statuses[f.id];`);
    expect(fillet.status).toBe('error');
    expect(fillet.message).toMatch(/too large|could not/i);
    expect(await volume(page)).toBeCloseTo(60 * 40 * 5, 0);
    await expect(page.getByRole('treeitem', { name: 'Fillet1' }).getByLabel('Error')).toBeVisible();
  });

  test('F03-E2 a face sketch follows its face when the depth changes', async ({ page }) => {
    await seedBlock(page, 25);
    await store(page, `
      const ex = S().doc.features[4].id;
      S().beginSketch({ kind: 'face', face: { kind: 'cap', featureId: ex, cap: 'end', flip: false } });
      S().addCircle({ at: { x: 30, y: 20 } }, 10);
      S().beginFeature('cutExtrude'); S().confirmFeature();
      S().editFeature(ex); S().updateDraft((d) => { d.direction1.depth = { expr: '30', value: 30 }; }); S().confirmFeature();
    `);
    expect(await volume(page)).toBeCloseTo(72000 - Math.PI * 100 * 30, 0);
  });

  test('F03-N1 text in a dimension is rejected', async ({ page }) => {
    await page.getByRole('treeitem', { name: 'Front plane' }).dblclick();
    await clickSketch(page, 5, 5);
    await clickSketch(page, 45, 25);
    await page.keyboard.press('d');
    await clickSketch(page, 25, 5);
    const input = page.getByRole('dialog', { name: /^Change D1/ }).getByRole('textbox');
    await input.fill('abc');
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('dialog', { name: /^Change D1/ }).getByRole('button', { name: 'OK' })).toBeDisabled();
  });
});

test.describe('F04 fully define a sketch', () => {
  let check: () => void;
  test.beforeEach(async ({ page }) => {
    check = guard(page);
    await openApp(page);
  });
  test.afterEach(() => check());

  test('F04-H1 rectangle from the origin + 2 dimensions = fully defined', async ({ page }) => {
    await page.getByRole('treeitem', { name: 'Front plane' }).dblclick();
    await clickSketch(page, 0, 0); // snaps to the origin
    await clickSketch(page, 40, 30);
    await page.keyboard.press('d');
    await clickSketch(page, 20, 0);
    await typeDimension(page, '50');
    await clickSketch(page, 50, 15);
    await typeDimension(page, '20');
    await expect(page.getByText('Fully defined', { exact: true })).toBeVisible();
    expect(await store<number>(page, `return S().solve.dof;`)).toBe(0);
  });

  test('F04-E1 a redundant dimension becomes a reference', async ({ page }) => {
    await page.getByRole('treeitem', { name: 'Front plane' }).dblclick();
    await clickSketch(page, 0, 0);
    await clickSketch(page, 40, 30);
    await page.keyboard.press('d');
    await clickSketch(page, 20, 0);
    await typeDimension(page, '40');
    await clickSketch(page, 20, 30); // the opposite side
    await expect(page.getByText(/would over-define the sketch/)).toBeVisible();
    const driving = await store<boolean[]>(page, `return S().doc.features[3].sketch.dimensions.map((d) => d.driving);`);
    expect(driving).toEqual([true, false]);
  });
});
