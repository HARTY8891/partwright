import { test, expect } from '@playwright/test';
import { clickSketch, featureNames, guard, openApp, seedBlock, settle, store, volume } from './helpers';

test.describe('milestone 7', () => {
  let check: () => void;
  test.beforeEach(async ({ page }) => {
    check = guard(page);
    await openApp(page);
  });
  test.afterEach(() => check());

  test('Thin wall: a 2 mm wall inside a 60×40 outline, 10 deep', async ({ page }) => {
    await store(page, `
      S().beginSketch(S().doc.features[1].id); S().addRect({ at: { x: 0, y: 0 } }, { at: { x: 60, y: 40 } });
      S().beginFeature('extrude'); S().updateDraft((d) => { d.direction1.depth = { expr: '10', value: 10 }; });`);
    await page.getByRole('checkbox', { name: 'Use Thin wall' }).check();
    await settle(page);
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    expect(await volume(page)).toBeCloseTo((60 * 40 - 56 * 36) * 10, 0);
  });

  test('Spline: an outline closed by a spline extrudes to the drawn area', async ({ page }) => {
    await page.getByRole('treeitem', { name: 'Top plane' }).dblclick();
    await page.keyboard.press('l');
    await clickSketch(page, 0, 0);
    await clickSketch(page, 40, 0);
    await page.keyboard.press('Escape');
    await page.keyboard.press('n');
    await clickSketch(page, 40, 0); // snaps to the line end
    await clickSketch(page, 30, 15);
    await clickSketch(page, 10, 15);
    await clickSketch(page, 0, 0); // snaps to the start
    await page.keyboard.press('Enter');
    const area = await page.evaluate(async () => {
      const { useDoc } = (window as any).__pw;
      const { sketchLoops, area } = await import('/src/kernel/profile.ts');
      const s = useDoc.getState();
      const sk = s.doc.features.find((f: any) => f.id === s.mode.sketchId).sketch;
      const { loops } = sketchLoops(sk);
      return Math.abs(area(loops[0].poly));
    });
    expect(area).toBeGreaterThan(300);
    await page.getByRole('button', { name: 'Extrude', exact: true }).click();
    await page.getByRole('spinbutton', { name: 'Depth' }).fill('10');
    await page.getByRole('spinbutton', { name: 'Depth' }).press('Tab');
    await settle(page);
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    // the kernel's solid matches the outline the viewport drew (sampled polygon, within 1%)
    expect(Math.abs((await volume(page)) / (area * 10) - 1)).toBeLessThan(0.01);
  });

  test('Trim and extend by clicking', async ({ page }) => {
    await page.getByRole('treeitem', { name: 'Front plane' }).dblclick();
    await store(page, `
      S().addLine({ at: { x: 0, y: 0 } }, { at: { x: 40, y: 0 } });
      S().addLine({ at: { x: 10, y: -5 } }, { at: { x: 10, y: 5 } });
      S().addLine({ at: { x: 30, y: -5 } }, { at: { x: 30, y: 5 } });
      S().addLine({ at: { x: 50, y: -5 } }, { at: { x: 50, y: 5 } });`);
    await page.keyboard.press('y');
    await clickSketch(page, 20, 0); // cut out the middle
    await page.keyboard.press('w');
    await clickSketch(page, 39, 0); // stretch the right piece to x = 50
    const xs = await store<number[][]>(page, `
      const sk = S().doc.features.find((f) => f.id === S().mode.sketchId).sketch;
      const P = (id) => sk.entities.find((e) => e.id === id).p;
      return sk.entities.filter((e) => e.kind === 'line' && Math.abs(P(e.p1).y) < 1e-6 && Math.abs(P(e.p2).y) < 1e-6)
        .map((l) => [P(l.p1).x, P(l.p2).x].sort((a, b) => a - b)).sort((a, b) => a[0] - b[0]);`);
    expect(xs).toEqual([[0, 10], [30, 50]]);
  });

  test('STEP import: export a box, import it into a new part', async ({ page }) => {
    await seedBlock(page, 25);
    const step = await page.evaluate(async () => {
      const { kernel } = await import('/src/kernel/client.ts');
      return new TextDecoder().decode(await kernel.exportFile('step'));
    });
    await store(page, `S().newDoc();`);
    await page.getByLabel('Import a STEP file').setInputFiles({ name: 'box.step', mimeType: 'application/step', buffer: Buffer.from(step) });
    await expect(page.getByText(/Imported box.step/)).toBeVisible();
    expect(await featureNames(page)).toContain('Import1');
    expect(await volume(page)).toBeCloseTo(60000, 0);
    // a cut on top of the imported solid works
    await store(page, `S().beginSketch(S().doc.features[1].id); S().addCircle({ at: { x: 30, y: 20 } }, 5); S().beginFeature('cutExtrude'); S().updateDraft((d) => { d.direction1.type = 'throughAllBoth'; }); S().confirmFeature();`);
    expect(await volume(page)).toBeCloseTo(60000 - Math.PI * 25 * 25, 0);
  });

  test('STEP import refuses a file that is not STEP', async ({ page }) => {
    await page.getByLabel('Import a STEP file').setInputFiles({ name: 'notes.step', mimeType: 'text/plain', buffer: Buffer.from('hello') });
    await expect(page.getByText('notes.step does not look like a STEP file.')).toBeVisible();
  });

  test('Options: part colour and default units for new parts', async ({ page }) => {
    await page.getByRole('button', { name: 'Tools' }).click();
    await page.getByRole('menuitem', { name: 'Options…' }).click();
    const dlg = page.getByRole('dialog', { name: 'Options' });
    await dlg.locator('label', { hasText: 'Orange' }).click();
    await expect(dlg.getByRole('radio', { name: 'Orange' })).toBeChecked();
    expect(await store<string>(page, `return S().doc.color;`)).toBe('part-orange');
    await dlg.getByRole('button', { name: /Units for new parts/ }).click();
    await page.getByRole('menuitemradio', { name: 'Inches' }).click();
    await dlg.getByRole('button', { name: 'Done' }).click();
    await page.keyboard.press('Control+n');
    await expect(page.getByRole('dialog', { name: 'Start' }).getByLabel(/Inches/)).toBeChecked();
  });
});
