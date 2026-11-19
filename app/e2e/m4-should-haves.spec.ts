import { test, expect, type Page } from '@playwright/test';
import { clickSketch, clickWorld, featureNames, guard, iso, openApp, seedBlock, settle, store, typeDimension, volume } from './helpers';

const exId = (page: Page) => store<string>(page, `return S().doc.features[4].id;`);

test.describe('milestone 4: should-haves', () => {
  let check: () => void;
  test.beforeEach(async ({ page }) => {
    check = guard(page);
    await openApp(page);
  });
  test.afterEach(() => check());

  test('Hole: click the top face, through everything', async ({ page }) => {
    await seedBlock(page, 25);
    await iso(page);
    await page.getByRole('button', { name: 'Hole', exact: true }).click();
    await expect(page.getByText('Click a flat face where the hole should start.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeDisabled();
    await clickWorld(page, [40, 30, 25]);
    await page.getByRole('spinbutton', { name: 'Diameter' }).fill('10');
    await page.getByRole('spinbutton', { name: 'Diameter' }).press('Tab');
    await settle(page);
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    expect(await volume(page)).toBeCloseTo(60000 - Math.PI * 25 * 25, 0);
    expect(await featureNames(page)).toContain('Hole1');
  });

  test('Shell: open the top, 2 mm walls', async ({ page }) => {
    await seedBlock(page, 25);
    await iso(page);
    await page.getByRole('button', { name: 'Shell', exact: true }).click();
    await clickWorld(page, [40, 30, 25]);
    await expect(page.getByRole('listbox', { name: /Faces to remove/ }).getByText('Extrude1 end face')).toBeVisible();
    await settle(page);
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    expect(await volume(page)).toBeCloseTo(60000 - 56 * 36 * 23, 0);
  });

  test('Linear pattern: three holes 20 apart', async ({ page }) => {
    await seedBlock(page, 25);
    const ex = await exId(page);
    await store(page, `S().beginFeature('hole'); S().setHolePoint({ face: { kind: 'cap', featureId: '${ex}', cap: 'end', flip: false }, at: { x: 10, y: 20 } }); S().updateDraft((d) => { d.diameter = { expr: '10', value: 10 }; }); S().confirmFeature(); S().select(null);`);
    await page.getByRole('button', { name: 'Linear pattern' }).click();
    // the last hole is ticked already
    await expect(page.getByRole('checkbox', { name: 'Hole1' })).toBeChecked();
    const spacing = page.getByRole('spinbutton', { name: 'Spacing' });
    await spacing.fill('20');
    await spacing.press('Tab');
    await settle(page);
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    expect(await volume(page)).toBeCloseTo(60000 - 3 * Math.PI * 25 * 25, 0);
  });

  test('Circular pattern: six holes round a disc', async ({ page }) => {
    await store(page, `
      S().beginSketch(S().doc.features[1].id); S().addCircle({ id: S().doc.features[3].sketch.entities[0].id }, 30);
      S().beginFeature('extrude'); S().updateDraft((d) => { d.direction1.depth = { expr: '5', value: 5 }; }); S().confirmFeature();
      const ex = S().selection;
      S().beginFeature('hole'); S().setHolePoint({ face: { kind: 'cap', featureId: ex, cap: 'end', flip: false }, at: { x: 20, y: 0 } });
      S().updateDraft((d) => { d.diameter = { expr: '6', value: 6 }; }); S().confirmFeature();
      S().beginFeature('circularPattern'); S().updateDraft((d) => { d.axis = 'z'; d.count = 6; }); S().confirmFeature();`);
    expect(await volume(page)).toBeCloseTo(Math.PI * 900 * 5 - 6 * Math.PI * 9 * 5, 0);
  });

  test('Mirror: a boss mirrored about the Right plane', async ({ page }) => {
    await seedBlock(page, 10);
    await store(page, `
      S().beginSketch(S().doc.features[1].id); S().addRect({ at: { x: 62, y: 0 } }, { at: { x: 72, y: 10 } });
      S().beginFeature('extrude'); S().updateDraft((d) => { d.direction1.depth = { expr: '10', value: 10 }; }); S().confirmFeature();`);
    await page.getByRole('button', { name: 'Mirror', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: 'Extrude2' })).toBeChecked();
    await settle(page);
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    expect(await volume(page)).toBeCloseTo(24000 + 2000, 0);
  });

  test('Plane: offset from the Top plane, sketch on it, extrude both ways', async ({ page }) => {
    await seedBlock(page, 10);
    await page.getByRole('treeitem', { name: 'Top plane' }).click();
    await page.getByRole('button', { name: 'Plane', exact: true }).click();
    const dist = page.getByRole('spinbutton', { name: /Distance/ });
    await dist.fill('30');
    await dist.press('Tab');
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByRole('treeitem', { name: 'Plane1' })).toBeVisible();
    await store(page, `
      const pl = S().doc.features.find((f) => f.name === 'Plane1').id;
      S().beginSketch(pl); S().addRect({ at: { x: 0, y: 0 } }, { at: { x: 10, y: 10 } }); S().beginFeature('extrude');`);
    await page.getByRole('checkbox', { name: 'Use Direction 2' }).check();
    const d1 = page.getByRole('spinbutton', { name: 'Depth', exact: true });
    await d1.fill('5');
    await d1.press('Tab');
    const d2 = page.getByRole('spinbutton', { name: 'Depth (other side)' });
    await d2.fill('5');
    await d2.press('Tab');
    await settle(page);
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    expect(await volume(page)).toBeCloseTo(24000 + 1000, 0);
  });

  test('Equations: a variable drives a dimension', async ({ page }) => {
    await seedBlock(page, 10);
    await page.getByRole('button', { name: 'Tools' }).click();
    await page.getByRole('menuitem', { name: 'Equations…' }).click();
    const dlg = page.getByRole('dialog', { name: 'Equations' });
    await dlg.getByRole('button', { name: 'Add variable' }).click();
    await dlg.getByRole('textbox', { name: 'Name of variable 1' }).fill('width');
    await dlg.getByRole('textbox', { name: 'Formula of width' }).fill('40 * 2');
    await expect(dlg.getByText('80', { exact: true })).toBeVisible();
    await dlg.getByRole('button', { name: 'Apply' }).click();
    await page.getByRole('treeitem', { name: 'Sketch1' }).dblclick();
    await page.keyboard.press('d');
    await clickSketch(page, 30, 0);
    await typeDimension(page, '=width');
    await page.getByRole('button', { name: 'Finish sketch' }).first().click();
    expect(await volume(page)).toBeCloseTo(80 * 40 * 10, 0);
    // change the variable: the part follows
    await store(page, `S().setVariables([{ ...S().doc.variables[0], expression: '100' }]);`);
    expect(await volume(page)).toBeCloseTo(100 * 40 * 10, 0);
  });

  test('Equations: a circular reference is refused', async ({ page }) => {
    await page.getByRole('button', { name: 'Tools' }).click();
    await page.getByRole('menuitem', { name: 'Equations…' }).click();
    const dlg = page.getByRole('dialog', { name: 'Equations' });
    await dlg.getByRole('button', { name: 'Add variable' }).click();
    await dlg.getByRole('button', { name: 'Add variable' }).click();
    await dlg.getByRole('textbox', { name: 'Name of variable 1' }).fill('a');
    await dlg.getByRole('textbox', { name: 'Formula of a' }).fill('b + 1');
    await dlg.getByRole('textbox', { name: 'Name of variable 2' }).fill('b');
    await dlg.getByRole('textbox', { name: 'Formula of b' }).fill('a * 2');
    await expect(dlg.getByText('Circular reference').first()).toBeVisible();
    await expect(dlg.getByRole('button', { name: 'Apply' })).toBeDisabled();
  });

  test('Measure: two corners of the block', async ({ page }) => {
    await seedBlock(page, 25);
    await iso(page);
    await page.getByRole('tab', { name: 'Evaluate' }).click();
    await page.getByRole('button', { name: 'Measure' }).click();
    await clickWorld(page, [59.5, 0.5, 25]); // near the corner (60, 0, 25): snaps
    await clickWorld(page, [0.5, 0.5, 25]); // near (0, 0, 25)
    await expect(page.getByRole('region', { name: 'Measure' }).getByText('60.000 mm')).toBeVisible();
  });

  test('Mass properties: steel block', async ({ page }) => {
    await seedBlock(page, 25);
    await page.getByRole('tab', { name: 'Evaluate' }).click();
    await page.getByRole('button', { name: 'Mass properties' }).click();
    const dlg = page.getByRole('dialog', { name: 'Mass properties' });
    // 60000 mm³ × 7850 kg/m³ = 0.471 kg, shown in grams below 1 kg
    await expect(dlg.getByText('471.00 g')).toBeVisible();
    await expect(dlg.getByText('9800 mm²')).toBeVisible();
    await expect(dlg.getByText('30, 20, 12.5 mm')).toBeVisible();
  });

  test('Polygon and slot tools draw closed, extrudable outlines', async ({ page }) => {
    await page.getByRole('treeitem', { name: 'Front plane' }).dblclick();
    await page.keyboard.press('p');
    await expect(page.getByRole('region', { name: 'Polygon' })).toBeVisible();
    await clickSketch(page, 0, 0);
    await clickSketch(page, 10, 0);
    await page.keyboard.press('t');
    await clickSketch(page, 30, 0);
    await clickSketch(page, 50, 0);
    await clickSketch(page, 40, 5);
    await page.getByRole('button', { name: 'Extrude', exact: true }).click();
    await settle(page);
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    const v = await volume(page);
    const hexagon = (3 * Math.sqrt(3)) / 2 * 100 * 10;
    expect(v).toBeGreaterThan(hexagon + 20 * 10 * 10 * 0.9);
  });

  test('Rollback bar: arrow keys roll the part back and forward', async ({ page }) => {
    await seedBlock(page, 10);
    await store(page, `
      S().beginSketch(S().doc.features[1].id); S().addRect({ at: { x: 62, y: 0 } }, { at: { x: 72, y: 10 } });
      S().beginFeature('extrude'); S().updateDraft((d) => { d.direction1.depth = { expr: '10', value: 10 }; }); S().confirmFeature(); S().select(null);`);
    expect(await volume(page)).toBeCloseTo(25000, 0);
    const bar = page.getByRole('treeitem', { name: /Rollback bar/ });
    await bar.focus();
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    expect(await volume(page)).toBeCloseTo(24000, 0);
    // a feature added now goes in above the bar
    await expect(page.getByRole('treeitem', { name: 'Extrude2' })).toHaveAttribute('aria-selected', 'false');
    await page.getByRole('treeitem', { name: /Rollback bar/ }).focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    expect(await volume(page)).toBeCloseTo(25000, 0);
  });
});
