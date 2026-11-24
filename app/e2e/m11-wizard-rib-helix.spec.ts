import { test, expect } from '@playwright/test';
import { featureNames, guard, openApp, seedBlock, settle, store, volume } from './helpers';

const BLOCK = 60 * 40 * 25;

test.describe('milestone 11', () => {
  let check: () => void;
  test.beforeEach(async ({ page }) => {
    check = guard(page);
    await openApp(page);
  });
  test.afterEach(() => check());

  const startHole = async (page: import('@playwright/test').Page) => {
    await seedBlock(page, 25);
    const ex = await store<string>(page, `return S().doc.features[4].id;`);
    await store(page, `S().beginFeature('hole'); S().setHolePoint({ face: { kind: 'cap', featureId: '${ex}', cap: 'end', flip: false }, at: { x: 30, y: 20 } });`);
  };
  const pick = async (page: import('@playwright/test').Page, field: RegExp, option: string) => {
    await page.getByRole('button', { name: field }).click();
    await page.getByRole('menuitemradio', { name: option }).click();
  };

  test('Hole wizard: an M6 counterbore through the block', async ({ page }) => {
    await startHole(page);
    await pick(page, /^Hole type/, 'Counterbore');
    await pick(page, /^Screw size/, 'M6 (ISO metric)');
    await expect(page.getByRole('spinbutton', { name: 'Counterbore diameter' })).toHaveValue('11');
    await settle(page);
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    const r = 6.6 / 2, R = 11 / 2;
    expect(await volume(page)).toBeCloseTo(BLOCK - Math.PI * (R * R * 6.4 + r * r * (25 - 6.4)), 0);
  });

  test('Hole wizard: an M6 countersink at 90 degrees', async ({ page }) => {
    await startHole(page);
    await pick(page, /^Hole type/, 'Countersink');
    await pick(page, /^Screw size/, 'M6 (ISO metric)');
    await settle(page);
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    const r = 6.6 / 2, R = 13.7 / 2, h = R - r; // 90°: depth = radius difference
    const cone = (Math.PI * h * (R * R + R * r + r * r)) / 3;
    expect(await volume(page)).toBeCloseTo(BLOCK - cone - Math.PI * r * r * (25 - h), 0);
  });

  test('Hole wizard: a tapped M8 uses the tap drill, and a bad counterbore explains itself', async ({ page }) => {
    await startHole(page);
    await pick(page, /^Hole type/, 'Tapped (tap drill size)');
    await pick(page, /^Screw size/, 'M8 (ISO metric)');
    await expect(page.getByRole('spinbutton', { name: 'Tap drill diameter' })).toHaveValue('6.8');
    await expect(page.getByText(/Thread M8 × coarse/)).toBeVisible();
    await store(page, `S().updateDraft((d) => { d.kind = 'counterbore'; d.cbore = { diameter: { expr: '5', value: 5 }, depth: { expr: '3', value: 3 } }; });`);
    await expect(page.getByText('The counterbore must be wider than the hole.')).toBeVisible();
  });

  test('Rib: a 4 mm gusset fills the corner of an L bracket', async ({ page }) => {
    await store(page, `
      const front = S().doc.features[0].id;
      const ext = () => { S().beginFeature('extrude'); S().updateDraft((d) => { d.direction1 = { type: 'midPlane', depth: { expr: '20', value: 20 } }; }); S().confirmFeature(); };
      S().beginSketch(front); S().addRect({ at: { x: 0, y: 0 } }, { at: { x: 40, y: 5 } }); ext();
      S().beginSketch(front); S().addRect({ at: { x: 0, y: 0 } }, { at: { x: 5, y: 40 } }); ext();
      S().beginSketch(front); S().addLine({ at: { x: 5, y: 25 } }, { at: { x: 25, y: 5 } }); S().endSketch(); S().select(null);`);
    const before = await volume(page);
    expect(before).toBeCloseTo((200 + 200 - 25) * 20, 0);
    await page.getByRole('button', { name: 'Rib', exact: true }).click();
    await settle(page);
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    // the triangle between the line and the inside corner (5,5)-(5,25)-(25,5), 4 thick
    expect((await volume(page)) - before).toBeCloseTo(200 * 4, 0);
    expect(await featureNames(page)).toContain('Rib1');
  });

  test('Helix and sweep: a spring of 3 turns', async ({ page }) => {
    await store(page, `
      const front = S().doc.features[0].id, top = S().doc.features[1].id;
      S().beginSketch(top); S().addCircle({ at: { x: 0, y: 0 } }, 10); S().endSketch();`);
    await page.getByRole('button', { name: 'Helix', exact: true }).click();
    await page.getByRole('spinbutton', { name: 'Turns' }).fill('3');
    await page.getByRole('spinbutton', { name: 'Turns' }).press('Tab');
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    expect(await featureNames(page)).toContain('Helix1');
    // the wire profile sits where the helix starts: (10, 0, 0), in the Front plane through the axis
    await store(page, `S().beginSketch(S().doc.features[0].id); S().addCircle({ at: { x: 10, y: 0 } }, 1); S().endSketch(); S().select(null);`);
    await page.getByRole('button', { name: 'Sweep', exact: true }).click();
    await expect(page.getByRole('button', { name: /Path \(open chain or helix\): Helix1/ })).toBeVisible();
    await settle(page);
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    // a section in a plane through the axis, carried round 3 turns: area × 2πR × turns
    expect(await volume(page)).toBeCloseTo(Math.PI * 1 * 2 * Math.PI * 10 * 3, -1);
  });
});
