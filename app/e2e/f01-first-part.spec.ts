import { test, expect } from '@playwright/test';
import { a11y, clickSketch, featureNames, guard, openApp, settle, sketchLineMids, store, typeDimension, volume } from './helpers';

test.describe('F01 make a first part', () => {
  let check: () => void;
  test.beforeEach(async ({ page }) => {
    check = guard(page);
    await openApp(page);
  });
  test.afterEach(() => check());

  async function sketchRect(page: import('@playwright/test').Page) {
    await page.getByRole('treeitem', { name: 'Front plane' }).dblclick();
    await expect(page.getByText(/Under-defined|Fully defined/)).toBeVisible();
    await clickSketch(page, 5, 5);
    await clickSketch(page, 55, 35);
    await page.keyboard.press('d');
    let mids = await sketchLineMids(page);
    await clickSketch(page, mids[0].x, mids[0].y); // bottom line
    await typeDimension(page, '60');
    mids = await sketchLineMids(page);
    await clickSketch(page, mids[1].x, mids[1].y); // right line
    await typeDimension(page, '40');
  }

  test('F01-H1 happy path: rectangle → dimensions → extrude', async ({ page }) => {
    await sketchRect(page);
    await page.getByRole('button', { name: 'Extrude' }).click();
    const depth = page.getByRole('spinbutton', { name: 'Depth' });
    await depth.fill('25');
    await depth.press('Enter');
    await settle(page);
    expect(await featureNames(page)).toEqual(['Front plane', 'Top plane', 'Right plane', 'Sketch1', 'Extrude1']);
    await expect(page.getByRole('treeitem', { name: 'Extrude1' })).toBeVisible();
    expect(await volume(page)).toBeCloseTo(60000, 0);
  });

  test('F01-E1 open outline cannot be extruded', async ({ page }) => {
    await page.getByRole('treeitem', { name: 'Front plane' }).dblclick();
    await page.keyboard.press('l');
    await clickSketch(page, 5, 5);
    await clickSketch(page, 40, 5);
    await clickSketch(page, 40, 30);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Extrude' }).click();
    await settle(page);
    await expect(page.getByRole('alert').filter({ hasText: /open end/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeDisabled();
  });

  test('F01-E2 zero, negative and text depth are rejected', async ({ page }) => {
    await sketchRect(page);
    await page.getByRole('button', { name: 'Extrude' }).click();
    const depth = page.getByRole('spinbutton', { name: 'Depth' });
    for (const bad of ['0', '-5', 'abc']) {
      await depth.fill(bad);
      await depth.press('Tab');
      await expect(depth).toHaveAttribute('aria-invalid', 'true');
    }
    const applied = await store<number>(page, `return S().mode.draft.direction1.depth.value;`);
    expect(applied).toBe(10); // the default stays
  });

  test('F01-E3 finishing an empty sketch leaves nothing behind', async ({ page }) => {
    await page.getByRole('treeitem', { name: 'Front plane' }).dblclick();
    await page.getByRole('button', { name: 'Finish sketch' }).first().click();
    expect(await featureNames(page)).toEqual(['Front plane', 'Top plane', 'Right plane']);
  });

  test('F01-E4 double click on confirm makes one feature', async ({ page }) => {
    await sketchRect(page);
    await page.getByRole('button', { name: 'Extrude' }).click();
    await settle(page);
    await page.getByRole('button', { name: 'Confirm', exact: true }).dblclick();
    await settle(page);
    expect((await featureNames(page)).filter((n) => n.startsWith('Extrude'))).toEqual(['Extrude1']);
  });

  test('F01-E5 undo and redo', async ({ page }) => {
    await sketchRect(page);
    await page.getByRole('button', { name: 'Extrude' }).click();
    await settle(page);
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    expect(await volume(page)).toBeGreaterThan(0);
    await page.keyboard.press('Control+z');
    expect(await volume(page)).toBe(0);
    await page.keyboard.press('Control+y');
    expect(await volume(page)).toBeGreaterThan(0);
  });

  test('F01-E6 leaving within a second of an edit asks first', async ({ page }) => {
    await sketchRect(page);
    await store(page, `S().addCircle({ at: { x: 20, y: 20 } }, 3);`); // an edit not autosaved yet
    let asked = false;
    page.on('dialog', async (d) => {
      if (d.type() === 'beforeunload') asked = true;
      await d.dismiss();
    });
    await page.close({ runBeforeUnload: true });
    await new Promise((r) => setTimeout(r, 500));
    expect(asked).toBe(true);
  });

  test('F01-E8 accessibility: workspace, sketch, feature panel', async ({ page }) => {
    expect(await a11y(page), 'workspace').toEqual([]);
    await sketchRect(page);
    expect(await a11y(page), 'sketch mode').toEqual([]);
    await page.getByRole('button', { name: 'Extrude' }).click();
    await settle(page);
    expect(await a11y(page), 'feature panel').toEqual([]);
  });

  test('F01-E9 long name with emoji and accents', async ({ page }) => {
    await sketchRect(page);
    await page.getByRole('button', { name: 'Extrude' }).click();
    await settle(page);
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    const name = 'Bracket für Größe 🚀 — a very long feature name that keeps going';
    const row = page.getByRole('treeitem', { name: 'Extrude1' });
    await row.click();
    await row.press('F2');
    const input = page.getByRole('textbox', { name: 'Feature name' });
    await input.fill(name);
    await input.press('Enter');
    expect(await featureNames(page)).toContain(name);
    const renamed = page.getByRole('treeitem', { name });
    const box = await renamed.boundingBox();
    const aside = await page.getByRole('complementary', { name: 'Left panel' }).boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(aside!.x + aside!.width + 1);
  });
});
