import { test, expect } from '@playwright/test';
import { clickWorld, guard, iso, openApp, seedBlock, settle, store, volume, type V3 } from './helpers';

const frustum = (a1: number, a2: number, h: number) => (h / 3) * (a1 + a2 + Math.sqrt(a1 * a2));

test.describe('milestone 9', () => {
  let check: () => void;
  test.beforeEach(async ({ page }) => {
    check = guard(page);
    await openApp(page);
  });
  test.afterEach(() => check());

  test('Draft: a 20×20 post, 10 tall, tapered 5° inward then outward', async ({ page }) => {
    await store(page, `
      S().beginSketch(S().doc.features[1].id); S().addRect({ at: { x: -10, y: -10 } }, { at: { x: 10, y: 10 } });
      S().beginFeature('extrude'); S().updateDraft((d) => { d.direction1.depth = { expr: '10', value: 10 }; });`);
    await page.getByRole('checkbox', { name: 'Use Draft' }).check();
    await page.getByRole('spinbutton', { name: 'Draft angle' }).fill('5');
    await page.getByRole('spinbutton', { name: 'Draft angle' }).press('Tab');
    await settle(page);
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    const t = 20 * Math.tan((5 * Math.PI) / 180);
    expect(await volume(page)).toBeCloseTo(frustum(400, (20 - t) ** 2, 10), 0);
    const ex = await store<string>(page, `return S().doc.features[4].id;`);
    await store(page, `S().editFeature('${ex}'); S().updateDraft((d) => { d.draft.outward = true; }); S().confirmFeature();`);
    expect(await volume(page)).toBeCloseTo(frustum(400, (20 + t) ** 2, 10), 0);
  });

  test('Draft on a through-all extrude explains what to do', async ({ page }) => {
    await store(page, `
      S().beginSketch(S().doc.features[1].id); S().addRect({ at: { x: -10, y: -10 } }, { at: { x: 10, y: 10 } });
      S().beginFeature('extrude'); S().updateDraft((d) => { d.direction1 = { type: 'throughAll', depth: d.direction1.depth }; d.draft = { angle: { expr: '3', value: 3 }, outward: false }; });`);
    await expect(page.getByText(/A draft needs an end/)).toBeVisible();
  });

  test('Up to a corner: clicking near a corner of the block sets the depth', async ({ page }) => {
    await seedBlock(page, 25);
    await iso(page);
    await store(page, `
      S().beginSketch(S().doc.features[1].id); S().addRect({ at: { x: 70, y: 0 } }, { at: { x: 80, y: 10 } });
      S().beginFeature('extrude');`);
    await page.getByRole('button', { name: /End condition/ }).click();
    await page.getByRole('menuitemradio', { name: 'Up to a corner' }).click();
    await expect(page.getByText('Click near a corner of the model to extrude up to.')).toBeVisible();
    // a point on the block's top face, just inside its corner at (60, 40)
    const near = await page.evaluate(() => {
      const w = window as any;
      const doc = w.__pw.useDoc.getState().doc;
      return w.__pw.toWorld(w.__pw.frameForSketch(doc, doc.features[3].id), { x: 59.6, y: 39.6 }, 25);
    });
    await clickWorld(page, near as V3);
    await expect(page.getByText(/Corner of Extrude1 \(end\)/)).toBeVisible();
    await settle(page);
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    expect(await volume(page)).toBeCloseTo(60000 + 100 * 25, 0);
    // the post follows when the block gets taller
    const block = await store<string>(page, `return S().doc.features[4].id;`);
    await store(page, `S().editFeature('${block}'); S().updateDraft((d) => { d.direction1.depth = { expr: '40', value: 40 }; }); S().confirmFeature();`);
    expect(await volume(page)).toBeCloseTo(60 * 40 * 40 + 100 * 40, 0);
  });

  test('Configurations: a feature suppressed in one configuration only', async ({ page }) => {
    await seedBlock(page, 10);
    await store(page, `
      S().beginSketch(S().doc.features[1].id); S().addRect({ at: { x: 70, y: 0 } }, { at: { x: 80, y: 10 } });
      S().beginFeature('extrude'); S().updateDraft((d) => { d.direction1.depth = { expr: '10', value: 10 }; }); S().confirmFeature();
      S().setConfigurations([{ id: 'plain', name: 'Plain', values: {} }], undefined);`);
    await settle(page);
    expect(await volume(page)).toBeCloseTo(25000, 0);
    const pick = async (from: string, to: string) => {
      await page.getByRole('button', { name: new RegExp(`Configuration: ${from}`) }).click();
      await page.getByRole('menuitemradio', { name: to }).click();
      await settle(page);
    };
    await pick('Base values', 'Plain');
    await page.getByRole('treeitem', { name: /Extrude2/ }).click();
    await page.getByRole('button', { name: 'Suppress selected' }).click();
    await settle(page);
    expect(await volume(page)).toBeCloseTo(24000, 0);
    await pick('Plain', 'Base values');
    expect(await volume(page)).toBeCloseTo(25000, 0);
    await pick('Base values', 'Plain');
    expect(await volume(page)).toBeCloseTo(24000, 0);
  });

  test('Face colour: the faces of one feature take their own colour', async ({ page }) => {
    await seedBlock(page, 10);
    await store(page, `
      S().beginSketch(S().doc.features[1].id); S().addRect({ at: { x: 20, y: 10 } }, { at: { x: 40, y: 30 } });
      S().beginFeature('cutExtrude'); S().updateDraft((d) => { d.reverse = true; d.direction1.depth = { expr: '5', value: 5 }; });`);
    await page.getByRole('button', { name: /Colour of its faces/ }).click();
    await page.getByRole('menuitemradio', { name: 'Blue' }).click();
    await settle(page);
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await settle(page);
    const colours = await page.evaluate(() => {
      const w = window as any;
      let attr: any = null;
      w.__scene.traverse((o: any) => o.userData?.solid && (attr = o.geometry.getAttribute('color')));
      if (!attr) return 0;
      const seen = new Set<string>();
      for (let i = 0; i < attr.count; i++) seen.add([attr.getX(i), attr.getY(i), attr.getZ(i)].map((x: number) => x.toFixed(3)).join());
      return seen.size;
    });
    expect(colours).toBe(2);
  });
});
