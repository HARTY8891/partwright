import { test, expect } from '@playwright/test';
import { featureNames, guard, openApp, settle, store, volume } from './helpers';

/** min and max of the solid along world x */
const xRange = (page: import('@playwright/test').Page) =>
  store<[number, number]>(page, `
    const v = K().mesh.vertices; let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < v.length; i += 3) { lo = Math.min(lo, v[i]); hi = Math.max(hi, v[i]); }
    return [lo, hi];`);

const colourCount = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const w = window as any;
    let attr: any = null;
    w.__scene.traverse((o: any) => o.userData?.solid && (attr = o.geometry.getAttribute('color')));
    if (!attr) return 0;
    const seen = new Set<string>();
    for (let i = 0; i < attr.count; i++) seen.add([attr.getX(i), attr.getY(i), attr.getZ(i)].map((x: number) => x.toFixed(3)).join());
    return seen.size;
  });

test.describe('milestone 10', () => {
  let check: () => void;
  test.beforeEach(async ({ page }) => {
    check = guard(page);
    await openApp(page);
  });
  test.afterEach(() => check());

  test('Axis where two planes meet: revolve a ring about it', async ({ page }) => {
    // Front and Right planes meet along the world y axis, which lies in the Front plane
    await store(page, `S().select(S().doc.features[0].id);`);
    await page.getByRole('button', { name: 'Axis', exact: true }).click();
    await page.getByRole('button', { name: /Second plane/ }).click();
    await page.getByRole('menuitemradio', { name: 'Right plane' }).click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    expect(await featureNames(page)).toContain('Axis1');
    await store(page, `
      S().beginSketch(S().doc.features[0].id); S().addRect({ at: { x: 10, y: 0 } }, { at: { x: 20, y: 10 } });
      S().beginFeature('revolve');`);
    await expect(page.getByRole('button', { name: 'Axis: Axis1' })).toBeVisible();
    await settle(page);
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    expect(await volume(page)).toBeCloseTo(Math.PI * (400 - 100) * 10, 0);
  });

  test('Axis through a round extrude: a circular pattern turns about it', async ({ page }) => {
    await store(page, `
      const top = S().doc.features[1].id;
      S().beginSketch(top);
      S().addCircle({ at: { x: 40, y: 0 } }, 5);
      S().beginFeature('extrude'); S().updateDraft((d) => { d.direction1.depth = { expr: '10', value: 10 }; }); S().confirmFeature();
      S().beginSketch(top); S().addRect({ at: { x: 50, y: -2 } }, { at: { x: 54, y: 2 } });
      S().beginFeature('extrude'); S().updateDraft((d) => { d.direction1.depth = { expr: '10', value: 10 }; }); S().confirmFeature();
      S().select(null);`);
    await page.getByRole('button', { name: 'Axis', exact: true }).click();
    await page.getByRole('button', { name: /Defined by/ }).click();
    await page.getByRole('menuitemradio', { name: 'The centre of a round extrude or cut' }).click();
    await expect(page.getByRole('button', { name: /Circle or arc: Extrude1, circle 1/ })).toBeVisible();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    const ex2 = await store<string>(page, `return S().doc.features.find((f) => f.name === 'Extrude2').id;`);
    await store(page, `S().select('${ex2}');`);
    await page.getByRole('button', { name: 'Circular pattern' }).click();
    await page.getByRole('button', { name: /^Axis:/ }).click();
    await page.getByRole('menuitemradio', { name: 'Axis1' }).click();
    await settle(page);
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    const [lo, hi] = await xRange(page);
    // copies around (40, 0): the far one reaches 40 - 14 = 26, never the other side of the origin
    expect(lo).toBeCloseTo(26, 1);
    expect(hi).toBeCloseTo(54, 1);
  });

  test('Face colour reaches curved faces: a coloured cylinder is all one colour', async ({ page }) => {
    await store(page, `
      S().beginSketch(S().doc.features[1].id); S().addCircle({ at: { x: 0, y: 0 } }, 10);
      S().beginFeature('extrude'); S().updateDraft((d) => { d.direction1.depth = { expr: '20', value: 20 }; d.color = 'part-orange'; }); S().confirmFeature();`);
    await settle(page);
    await page.waitForTimeout(300);
    expect(await colourCount(page)).toBe(1);
    // a plain block next to it keeps the part colour
    await store(page, `
      S().beginSketch(S().doc.features[1].id); S().addRect({ at: { x: 20, y: 0 } }, { at: { x: 40, y: 20 } });
      S().beginFeature('extrude'); S().updateDraft((d) => { d.direction1.depth = { expr: '5', value: 5 }; }); S().confirmFeature();`);
    await settle(page);
    await page.waitForTimeout(300);
    expect(await colourCount(page)).toBe(2);
  });

  test('Colour on a revolve: the panel offers it and the faces take it', async ({ page }) => {
    await store(page, `
      S().beginSketch(S().doc.features[0].id);
      S().addRect({ at: { x: 10, y: 0 } }, { at: { x: 20, y: 10 } });
      S().addLine({ at: { x: 0, y: -5 } }, { at: { x: 0, y: 15 } });
      const sk = S().doc.features.find((f) => f.id === S().mode.sketchId).sketch;
      S().toggleConstruction(sk.entities.filter((e) => e.kind === 'line').pop().id);
      S().endSketch();`);
    await store(page, `S().select(S().doc.features[3].id); S().beginFeature('revolve');`);
    await page.getByRole('button', { name: /Colour of its faces/ }).click();
    await page.getByRole('menuitemradio', { name: 'Green' }).click();
    await settle(page);
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await settle(page);
    await page.waitForTimeout(300);
    expect(await colourCount(page)).toBe(1);
  });
});
