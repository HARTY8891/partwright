import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { clickSketch, featureNames, guard, openApp, seedBlock, settle, store, volume } from './helpers';

test.describe('milestone 6', () => {
  let check: () => void;
  test.beforeEach(async ({ page }) => {
    check = guard(page);
    await openApp(page);
  });
  test.afterEach(() => check());

  test('Command search runs a command from the keyboard', async ({ page }) => {
    await seedBlock(page, 10);
    await page.keyboard.press('Control+k');
    const box = page.getByRole('combobox', { name: 'Search commands' });
    await expect(box).toBeFocused();
    await box.fill('mass');
    await expect(page.getByRole('option', { name: /Mass properties/ })).toBeVisible();
    await box.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Mass properties' })).toBeVisible();
  });

  test('Command search: nothing matches', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox', { name: 'Search commands' }).fill('teleport');
    await expect(page.getByText('No command matches “teleport”.')).toBeVisible();
  });

  test('Display styles and section view', async ({ page }) => {
    await seedBlock(page, 25);
    await page.getByRole('button', { name: 'Display style' }).click();
    await page.getByRole('menuitemradio', { name: /Wireframe/ }).click();
    expect(await page.evaluate(() => (window as any).__pw.useView.getState().displayStyle)).toBe('wireframe');
    await page.getByRole('button', { name: 'Section view' }).click();
    const panel = page.getByRole('region', { name: 'Section view' });
    await expect(panel).toBeVisible();
    await panel.getByRole('spinbutton', { name: 'Offset' }).fill('-20');
    await panel.getByRole('spinbutton', { name: 'Offset' }).press('Tab');
    expect(await page.evaluate(() => (window as any).__pw.useView.getState().section)).toMatchObject({ on: true, plane: 'front', offset: -20 });
    // the part itself is not cut
    expect(await volume(page)).toBeCloseTo(60000, 0);
    await panel.getByRole('button', { name: 'Close section view' }).click();
    await expect(panel).toBeHidden();
  });

  test('Export 3MF downloads a 3MF package', async ({ page }) => {
    await seedBlock(page, 25);
    await page.getByRole('button', { name: 'File' }).click();
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: /Export 3MF/ }).click()]);
    expect(dl.suggestedFilename()).toBe('Part1.3mf');
    const buf = readFileSync((await dl.path())!);
    expect(buf.readUInt32LE(0)).toBe(0x04034b50); // a zip
    expect(buf.toString('latin1')).toContain('3D/3dmodel.model');
    expect(buf.toString('latin1').match(/<vertex /g)).toHaveLength(8); // a box, welded
  });

  test('Sketch fillet from the Modify panel rounds a corner', async ({ page }) => {
    await page.getByRole('treeitem', { name: 'Top plane' }).dblclick();
    await clickSketch(page, 0, 0);
    await clickSketch(page, 40, 30);
    await page.keyboard.press('Escape'); // select tool
    const corner = await store<{ x: number; y: number }>(page, `
      const sk = S().doc.features[3].sketch; const p = sk.entities.filter((e) => e.kind === 'point' && !e.construction);
      return p.reduce((a, b) => (b.p.x + b.p.y > a.p.x + a.p.y ? b : a)).p;`);
    await clickSketch(page, corner.x, corner.y);
    const panel = page.getByRole('region', { name: 'Relations' });
    await panel.getByRole('spinbutton', { name: 'Fillet radius' }).fill('8');
    await panel.getByRole('spinbutton', { name: 'Fillet radius' }).press('Tab');
    await panel.getByRole('button', { name: 'Fillet corner' }).click();
    await page.getByRole('button', { name: 'Extrude', exact: true }).click();
    await settle(page);
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    const [w, h] = await store<number[]>(page, `
      const sk = S().doc.features[3].sketch; const p = sk.entities.filter((e) => e.kind === 'point' && !e.construction && !sk.entities.some((l) => l.kind === 'line' && l.construction && (l.p1 === e.id || l.p2 === e.id)));
      const xs = p.map((q) => q.p.x), ys = p.map((q) => q.p.y); return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];`);
    expect(await volume(page)).toBeCloseTo((w * h - (64 - (Math.PI * 64) / 4)) * 10, 0);
  });

  test('Reorder: Alt+Up moves a feature with its sketch; a dependent cannot jump above its parent', async ({ page }) => {
    await seedBlock(page, 10);
    await store(page, `
      S().beginSketch(S().doc.features[1].id); S().addRect({ at: { x: 62, y: 0 } }, { at: { x: 72, y: 10 } });
      S().beginFeature('extrude'); S().updateDraft((d) => { d.direction1.depth = { expr: '10', value: 10 }; }); S().confirmFeature(); S().select(null);`);
    const row = page.getByRole('treeitem', { name: 'Extrude2' });
    await row.click();
    await row.press('Alt+ArrowUp');
    expect((await featureNames(page)).slice(3)).toEqual(['Sketch2', 'Extrude2', 'Sketch1', 'Extrude1']);
    expect(await volume(page)).toBeCloseTo(25000, 0);
    // a cut sketched on Extrude1's face cannot move above Extrude1
    await store(page, `
      const ex = S().doc.features.find((f) => f.name === 'Extrude1').id;
      S().beginSketch({ kind: 'face', face: { kind: 'cap', featureId: ex, cap: 'end', flip: false } });
      S().addCircle({ at: { x: 30, y: 20 } }, 4); S().beginFeature('cutExtrude'); S().confirmFeature(); S().select(null);`);
    const cut = page.getByRole('treeitem', { name: 'Cut1' });
    await cut.click();
    await cut.press('Alt+ArrowUp');
    await expect(page.getByText(/Cut1 uses|uses Extrude1|has to stay below/).first()).toBeVisible();
    expect((await featureNames(page)).slice(-2)).toEqual(['Sketch3', 'Cut1']);
  });

  test('Angled plane: 30° from the Top plane', async ({ page }) => {
    await seedBlock(page, 10);
    await page.getByRole('treeitem', { name: 'Top plane' }).click();
    await page.getByRole('button', { name: 'Plane', exact: true }).click();
    await page.getByRole('button', { name: /Kind/ }).click();
    await page.getByRole('menuitemradio', { name: 'At an angle' }).click();
    const angle = page.getByRole('spinbutton', { name: 'Angle' });
    await angle.fill('30');
    await angle.press('Tab');
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    const normal = await page.evaluate(async () => {
      const { useDoc } = (window as any).__pw;
      const doc = useDoc.getState().doc;
      const pl = doc.features.find((f: any) => f.name === 'Plane1');
      return pl.def;
    });
    expect(normal).toMatchObject({ type: 'angle', axis: 'x', angle: { value: 30 } });
    await expect(page.getByRole('treeitem', { name: 'Plane1' })).toBeVisible();
  });
});
