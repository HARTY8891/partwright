import { test, expect } from '@playwright/test';
import { featureNames, guard, openApp, seedBlock, settle, store, volume } from './helpers';

test.describe('milestone 8', () => {
  let check: () => void;
  test.beforeEach(async ({ page }) => {
    check = guard(page);
    await openApp(page);
  });
  test.afterEach(() => check());

  test('Loft: ruled loft from a 20×20 to a 10×10 square, 30 apart, is a frustum', async ({ page }) => {
    await store(page, `
      const top = S().doc.features[1].id;
      S().beginSketch(top); S().addRect({ at: { x: -10, y: -10 } }, { at: { x: 10, y: 10 } }); S().endSketch();
      S().select(top); S().beginFeature('plane'); S().updateDraft((d) => { d.def.distance = { expr: '30', value: 30 }; }); S().confirmFeature();
      const pl = S().selection;
      S().beginSketch(pl); S().addRect({ at: { x: -5, y: -5 } }, { at: { x: 5, y: 5 } }); S().endSketch(); S().select(null);`);
    await page.getByRole('button', { name: 'Loft', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: /1\. Sketch1/ })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: /2\. Sketch2/ })).toBeChecked();
    await page.getByRole('checkbox', { name: 'Straight sides (ruled)' }).check();
    await settle(page);
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    expect(await volume(page)).toBeCloseTo((30 / 3) * (400 + 100 + 200), 0);
    // the two sketches are shown inside the loft in the tree
    expect(await featureNames(page)).toContain('Loft1');
  });

  test('Sweep: a circle along a line and a quarter arc (Pappus volume)', async ({ page }) => {
    await store(page, `
      const front = S().doc.features[0].id, top = S().doc.features[1].id;
      S().beginSketch(front); S().addCircle({ id: S().doc.features[3].sketch.entities[0].id }, 5); S().endSketch();
      S().beginSketch(top);
      const sk = () => S().doc.features.find((f) => f.id === S().mode.sketchId).sketch;
      S().addLine({ id: sk().entities[0].id }, { at: { x: 0, y: 20 } });
      const end = sk().entities.find((e) => e.kind === 'point' && e.p.y === 20).id;
      S().addArc({ id: end }, { at: { x: 20, y: 40 } }, { x: 20 - 20 * Math.SQRT1_2, y: 20 + 20 * Math.SQRT1_2 });
      S().endSketch(); S().select(null);`);
    await page.getByRole('button', { name: 'Sweep', exact: true }).click();
    await settle(page);
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    expect(await volume(page)).toBeCloseTo(Math.PI * 25 * (20 + (Math.PI * 20) / 2), -1);
  });

  test('Up to a face: a post grows exactly to the top of the block', async ({ page }) => {
    await seedBlock(page, 25);
    await store(page, `
      S().beginSketch(S().doc.features[1].id); S().addRect({ at: { x: 70, y: 0 } }, { at: { x: 80, y: 10 } });
      S().beginFeature('extrude');
      S().updateDraft((d) => { d.direction1 = { type: 'upToFace', depth: d.direction1.depth, face: null }; });`);
    await expect(page.getByText('Click the flat face to extrude up to.')).toBeVisible();
    const ex = await store<string>(page, `return S().doc.features[4].id;`);
    await store(page, `S().setUpToFace({ kind: 'cap', featureId: '${ex}', cap: 'end', flip: false });`);
    await settle(page);
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    expect(await volume(page)).toBeCloseTo(60000 + 10 * 10 * 25, 0);
    // the post follows when the block gets taller
    await store(page, `S().editFeature('${ex}'); S().updateDraft((d) => { d.direction1.depth = { expr: '40', value: 40 }; }); S().confirmFeature();`);
    expect(await volume(page)).toBeCloseTo(60 * 40 * 40 + 10 * 10 * 40, 0);
  });

  test('Variable-radius fillet builds between the two constant ones', async ({ page }) => {
    await seedBlock(page, 25);
    const ex = await store<string>(page, `return S().doc.features[4].id;`);
    const point = await store<string>(page, `return S().doc.features[3].sketch.entities.filter((e) => e.kind === 'point' && !e.construction)[1].id;`);
    const run = async (r1: number, r2?: number) => {
      await store(page, `
        S().beginFeature('fillet');
        S().toggleEdge({ kind: 'sideEdge', featureId: '${ex}', pointId: '${point}' });
        S().updateDraft((d) => { d.size = { expr: '${r1}', value: ${r1} }; ${r2 ? `d.size2 = { expr: '${r2}', value: ${r2} };` : ''} });
        S().confirmFeature();`);
      const v = await volume(page);
      await store(page, `S().undo();`);
      await settle(page);
      return v;
    };
    const v2 = await run(2);
    const v8 = await run(8);
    const v28 = await run(2, 8);
    expect(v28).toBeLessThan(v2);
    expect(v28).toBeGreaterThan(v8);
  });

  test('Configurations: a long variant changes the part', async ({ page }) => {
    await seedBlock(page, 10);
    await store(page, `
      S().setVariables([{ id: 'w', name: 'w', expression: '60' }]);
      const sk = S().doc.features[3]; S().editSketch(sk.id);
      const L = sk.sketch.entities.find((e) => e.kind === 'line');
      S().addDimension(L.id); S().setDimension(S().editingDimId, '=w', 60); S().endSketch();`);
    expect(await volume(page)).toBeCloseTo(24000, 0);
    await page.getByRole('button', { name: 'Edit…' }).click();
    const dlg = page.getByRole('dialog', { name: 'Configurations' });
    await dlg.getByRole('button', { name: 'Add configuration' }).click();
    await dlg.getByRole('textbox', { name: 'Name of configuration 1' }).fill('Long');
    await dlg.getByRole('textbox', { name: 'w in Long' }).fill('100');
    await dlg.getByRole('button', { name: 'Apply' }).click();
    await page.getByRole('button', { name: /Configuration: Base values/ }).click();
    await page.getByRole('menuitemradio', { name: 'Long' }).click();
    expect(await volume(page)).toBeCloseTo(40000, 0);
    await page.getByRole('button', { name: /Configuration: Long/ }).click();
    await page.getByRole('menuitemradio', { name: 'Base values' }).click();
    expect(await volume(page)).toBeCloseTo(24000, 0);
  });
});
