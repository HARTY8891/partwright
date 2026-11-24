import { test, expect } from '@playwright/test';
import { featureNames, guard, openApp, seedBlock, settle, store, volume } from './helpers';

const BLOCK = 60 * 40 * 25;

test.describe('milestone 13', () => {
  let check: () => void;
  test.beforeEach(async ({ page }) => {
    check = guard(page);
    await openApp(page);
  });
  test.afterEach(() => check());

  test('Convert edges: the top face with a slot through it, extruded up', async ({ page }) => {
    await seedBlock(page, 25);
    // a slot cut through the block: centres 10 apart, 4 either side
    await store(page, `
      S().beginSketch(S().doc.features[1].id);
      S().addSlot({ at: { x: 25, y: 20 } }, { at: { x: 35, y: 20 } }, { x: 30, y: 24 });
      S().beginFeature('cutExtrude'); S().updateDraft((d) => { d.direction1.type = 'throughAllBoth'; }); S().confirmFeature(); S().select(null);`);
    await settle(page);
    const slot = 10 * 8 + Math.PI * 16;
    expect(await volume(page)).toBeCloseTo(BLOCK - slot * 25, 0);
    const ex = await store<string>(page, `return S().doc.features[4].id;`);
    await store(page, `S().beginSketch({ kind: 'face', face: { kind: 'cap', featureId: '${ex}', cap: 'end', flip: false } });`);
    await page.getByRole('button', { name: 'Convert edges' }).click();
    await expect(page.getByText(/Converted \d+ edges into the sketch/)).toBeVisible();
    const info = await store<{ lines: number; arcs: number; state: string }>(page, `
      const sk = S().doc.features.find((f) => f.id === S().mode.sketchId).sketch;
      return { lines: sk.entities.filter((e) => e.kind === 'line').length, arcs: sk.entities.filter((e) => e.kind === 'arc').length, state: S().solve?.state };`);
    expect(info.lines).toBe(6); // 4 block sides + 2 slot sides
    expect(info.arcs).toBeGreaterThanOrEqual(2);
    expect(info.state).toBe('full');
    await store(page, `S().beginFeature('extrude'); S().updateDraft((d) => { d.direction1.depth = { expr: '5', value: 5 }; }); S().confirmFeature(); S().select(null);`);
    await settle(page);
    expect(await volume(page)).toBeCloseTo((BLOCK - slot * 25) + (2400 - slot) * 5, 0);
  });

  test('Convert edges explains when no face lies in the sketch plane', async ({ page }) => {
    // a block clear of the Front plane: no face of it lies there
    await store(page, `S().beginSketch(S().doc.features[1].id); S().addRect({ at: { x: 10, y: 10 } }, { at: { x: 50, y: 30 } });
      S().beginFeature('extrude'); S().confirmFeature(); S().select(null);`);
    await settle(page);
    await store(page, `S().beginSketch(S().doc.features[0].id);`);
    await page.getByRole('button', { name: 'Convert edges' }).click();
    await expect(page.getByText(/No flat face of the part lies in this sketch's plane/)).toBeVisible();
  });

  test('Sketch linear and circular patterns from the Modify panel', async ({ page }) => {
    await seedBlock(page, 25);
    await store(page, `S().beginSketch(S().doc.features[1].id); S().addCircle({ at: { x: 10, y: 10 } }, 3);
      const sk = S().doc.features.find((f) => f.id === S().mode.sketchId).sketch;
      window.__pw.useView.getState().setSketchSel([sk.entities.find((e) => e.kind === 'circle').id]);`);
    await page.getByRole('spinbutton', { name: 'Pattern copies (including the original)' }).fill('4');
    await page.getByRole('spinbutton', { name: 'Pattern copies (including the original)' }).press('Tab');
    await page.getByRole('spinbutton', { name: 'Pattern spacing' }).fill('12');
    await page.getByRole('spinbutton', { name: 'Pattern spacing' }).press('Tab');
    await page.getByRole('button', { name: 'Linear pattern', exact: true }).click();
    const xs = await store<number[]>(page, `
      const sk = S().doc.features.find((f) => f.id === S().mode.sketchId).sketch;
      const P = (id) => sk.entities.find((e) => e.id === id).p;
      return sk.entities.filter((e) => e.kind === 'circle').map((c) => Math.round(P(c.center).x));`);
    expect(xs).toEqual([10, 22, 34, 46]);
    // circular: the last circle, 3 copies round the origin over 90°... kept inside the block by turning round (30, 20)
    await store(page, `
      const sk = S().doc.features.find((f) => f.id === S().mode.sketchId).sketch;
      S().addPoint({ at: { x: 30, y: 20 } });
      const sk2 = S().doc.features.find((f) => f.id === S().mode.sketchId).sketch;
      const pt = sk2.entities.filter((e) => e.kind === 'point').pop().id;
      const c1 = sk2.entities.find((e) => e.kind === 'circle').id;
      window.__pw.useView.getState().setSketchSel([c1, pt]);`);
    await page.getByRole('spinbutton', { name: 'Pattern copies (including the original)' }).fill('2');
    await page.getByRole('spinbutton', { name: 'Pattern copies (including the original)' }).press('Tab');
    await page.getByRole('spinbutton', { name: 'Pattern angle' }).fill('180');
    await page.getByRole('spinbutton', { name: 'Pattern angle' }).press('Tab');
    await page.getByRole('button', { name: 'Circular pattern', exact: true }).click();
    await store(page, `S().beginFeature('cutExtrude'); S().updateDraft((d) => { d.direction1.type = 'throughAllBoth'; }); S().confirmFeature();`);
    await settle(page);
    // 4 in a row + one turned half round (30,20) from (10,10) to (50,30)
    expect(await volume(page)).toBeCloseTo(BLOCK - 5 * Math.PI * 9 * 25, 0);
  });

  test('Sketch-driven pattern: a hole copied onto three sketch points', async ({ page }) => {
    await seedBlock(page, 25);
    await store(page, `
      S().beginSketch(S().doc.features[1].id); S().addCircle({ at: { x: 10, y: 10 } }, 2);
      S().beginFeature('cutExtrude'); S().updateDraft((d) => { d.direction1.type = 'throughAllBoth'; }); S().confirmFeature(); S().select(null);`);
    await settle(page);
    // points drawn with the Point tool's action, on the Top plane
    await store(page, `S().beginSketch(S().doc.features[1].id); S().setTool('point');
      S().addPoint({ at: { x: 30, y: 10 } }); S().addPoint({ at: { x: 50, y: 10 } }); S().addPoint({ at: { x: 30, y: 30 } }); S().endSketch(); S().select(null);`);
    const cut = await store<string>(page, `return S().doc.features.find((f) => f.type === 'cutExtrude').id;`);
    await store(page, `S().select('${cut}');`);
    await page.getByRole('button', { name: 'Sketch pattern', exact: true }).click();
    await expect(page.getByText(/^3 points\./)).toBeVisible();
    await settle(page);
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await settle(page);
    expect(await volume(page)).toBeCloseTo(BLOCK - 4 * Math.PI * 4 * 25, 0);
    expect(await featureNames(page)).toContain('SketchPattern1');
  });
});
