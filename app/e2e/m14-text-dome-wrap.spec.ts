import { test, expect } from '@playwright/test';
import { clickSketch, guard, openApp, seedBlock, settle, store, volume } from './helpers';

const BLOCK = 60 * 40 * 25;

/** the area of the active sketch's (or a given sketch's) profile, from the app's own outline code */
const profileArea = (page: import('@playwright/test').Page, sketchId?: string) =>
  page.evaluate(async (id) => {
    const { sketchLoops, nestLoops, area } = await import('/src/kernel/profile.ts');
    const s = (window as any).__pw.useDoc.getState();
    const sk = s.doc.features.find((f: any) => f.id === (id ?? s.mode.sketchId)).sketch;
    const { loops } = sketchLoops(sk);
    return nestLoops(loops).reduce((a: number, g: any) => a + Math.abs(area(g.outer.poly)) - g.holes.reduce((b: number, h: any) => b + Math.abs(area(h.poly)), 0), 0);
  }, sketchId);

test.describe('milestone 14', () => {
  let check: () => void;
  test.beforeEach(async ({ page }) => {
    check = guard(page);
    await openApp(page);
  });
  test.afterEach(() => check());

  test('Text: place it, type the words, engrave it 1 mm into the top', async ({ page }) => {
    await seedBlock(page, 25);
    const ex = await store<string>(page, `return S().doc.features[4].id;`);
    await store(page, `S().beginSketch({ kind: 'face', face: { kind: 'cap', featureId: '${ex}', cap: 'end', flip: false } });`);
    await page.getByRole('button', { name: 'Text', exact: true }).click();
    await clickSketch(page, 10, 15);
    const words = page.getByRole('textbox', { name: 'Text to write' });
    await expect(words).toHaveValue('Text');
    await words.fill('PART 8');
    await words.press('Enter');
    await page.getByRole('spinbutton', { name: 'Letter height' }).fill('8');
    await page.getByRole('spinbutton', { name: 'Letter height' }).press('Tab');
    const t = await store<{ text: string; height: number }>(page, `
      const sk = S().doc.features.find((f) => f.id === S().mode.sketchId).sketch;
      const e = sk.entities.find((x) => x.kind === 'text'); return { text: e.text, height: e.height };`);
    expect(t).toEqual({ text: 'PART 8', height: 8 });
    const a = await profileArea(page);
    expect(a).toBeGreaterThan(40);
    await store(page, `S().beginFeature('cutExtrude'); S().updateDraft((d) => { d.direction1 = { type: 'blind', depth: { expr: '1', value: 1 } }; }); S().confirmFeature(); S().select(null);`);
    await settle(page);
    // the letters are curves; the profile area is from sampled outlines, so allow 1%
    const cut = BLOCK - (await volume(page));
    expect(Math.abs(cut - a) / a).toBeLessThan(0.01);
  });

  const cylinder = async (page: import('@playwright/test').Page, r: number, h: number) => {
    await store(page, `S().beginSketch(S().doc.features[1].id); S().addCircle({ at: { x: 0, y: 0 } }, ${r});
      S().beginFeature('extrude'); S().updateDraft((d) => { d.direction1.depth = { expr: '${h}', value: ${h} }; }); S().confirmFeature(); S().select(null);`);
    await settle(page);
    return store<string>(page, `return S().doc.features[4].id;`);
  };

  test('Dome: a 5 mm cap on a round boss, then a dent of the same size', async ({ page }) => {
    const ex = await cylinder(page, 10, 20);
    const base = Math.PI * 100 * 20;
    expect(await volume(page)).toBeCloseTo(base, 0);
    await page.getByRole('button', { name: 'Dome', exact: true }).click();
    await expect(page.getByText('Click the flat face to dome.').first()).toBeVisible();
    await store(page, `S().updateDraft((d) => { d.at = { face: { kind: 'cap', featureId: '${ex}', cap: 'end', flip: false }, at: { x: 0, y: 0 } }; });`);
    await settle(page);
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await settle(page);
    const cap = (Math.PI * 5 * (3 * 100 + 25)) / 6;
    expect(await volume(page)).toBeCloseTo(base + cap, 0);
    const dome = await store<string>(page, `return S().doc.features.find((f) => f.type === 'dome').id;`);
    await store(page, `S().editFeature('${dome}'); S().updateDraft((d) => { d.reverse = true; }); S().confirmFeature();`);
    await settle(page);
    expect(await volume(page)).toBeCloseTo(base - cap, 0);
  });

  test('Wrap: a 10 × 10 rectangle sunk 1 mm into, then raised 1 mm from, a 20 mm radius cylinder', async ({ page }) => {
    await cylinder(page, 20, 40);
    const base = Math.PI * 400 * 40;
    // on the Front plane, which holds the cylinder's axis
    await store(page, `S().beginSketch(S().doc.features[0].id); S().addRect({ at: { x: -5, y: 10 } }, { at: { x: 5, y: 20 } }); S().endSketch();`);
    await page.getByRole('button', { name: 'Wrap', exact: true }).click();
    await page.getByRole('button', { name: /^Wrap type/ }).click();
    await page.getByRole('menuitemradio', { name: 'Deboss (sunk)' }).click();
    await settle(page);
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await settle(page);
    // 10 mm round a 20 mm radius is half a radian; 10 mm tall
    const ring = (r0: number, r1: number) => 10 * (0.5 / 2) * (r1 * r1 - r0 * r0);
    expect(base - (await volume(page))).toBeCloseTo(ring(19, 20), 0);
    const w = await store<string>(page, `return S().doc.features.find((f) => f.type === 'wrap').id;`);
    await store(page, `S().editFeature('${w}'); S().updateDraft((d) => { d.mode = 'emboss'; }); S().confirmFeature();`);
    await settle(page);
    expect((await volume(page)) - base).toBeCloseTo(ring(20, 21), 0);
  });

  test('Wrap keeps left and right: a rectangle right of centre sinks into the right side', async ({ page }) => {
    await cylinder(page, 20, 40);
    await store(page, `S().beginSketch(S().doc.features[0].id); S().addRect({ at: { x: 4, y: 10 } }, { at: { x: 14, y: 20 } }); S().endSketch();
      S().beginFeature('wrap'); S().updateDraft((d) => { d.mode = 'deboss'; d.depth = { expr: '3', value: 3 }; }); S().confirmFeature();`);
    await settle(page);
    const c = await page.evaluate(async () => {
      const { kernel } = await import('/src/kernel/client.ts');
      return (await kernel.massProps())!.centre;
    });
    const x = await store<number[]>(page, `const f = window.__pw.frameForSketch(S().doc, S().doc.features[5].id); return f.xDir;`);
    // the centre of mass moves away from the sunk side, i.e. against the sketch's +x
    expect(c[0] * x[0] + c[1] * x[1] + c[2] * x[2]).toBeLessThan(-0.01);
  });

  test('Split line: a square on the top face becomes its own face, which can take a colour', async ({ page }) => {
    await seedBlock(page, 25);
    const ex = await store<string>(page, `return S().doc.features[4].id;`);
    const faces = () => store<number>(page, `return K().mesh.faceGroups.length / 2;`);
    const before = await faces();
    await store(page, `S().beginSketch({ kind: 'face', face: { kind: 'cap', featureId: '${ex}', cap: 'end', flip: false } });
      S().addRect({ at: { x: 10, y: 10 } }, { at: { x: 30, y: 30 } });`);
    await store(page, `S().beginFeature('splitLine');`);
    await expect(page.getByRole('button', { name: /^Outline sketch/ })).toBeVisible();
    await page.getByRole('button', { name: /^Colour of its faces/ }).click();
    await page.getByRole('menuitemradio').nth(2).click();
    await settle(page);
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await settle(page);
    expect(await volume(page)).toBeCloseTo(BLOCK, 0);
    expect(await faces()).toBe(before + 1);
    const split = await store<string>(page, `return S().doc.features.find((f) => f.type === 'splitLine').id;`);
    const owners = await store<string[]>(page, `return K().mesh.faceOwners ?? [];`);
    expect(owners.filter((o) => o === split).length).toBe(1);
  });
});
