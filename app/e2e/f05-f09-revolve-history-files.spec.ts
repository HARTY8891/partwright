import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clickSketch, featureNames, guard, openApp, seedBlock, settle, store, volume } from './helpers';

test.describe('F05 revolve a turned part', () => {
  let check: () => void;
  test.beforeEach(async ({ page }) => {
    check = guard(page);
    await openApp(page);
  });
  test.afterEach(() => check());

  test('F05-H1 profile + centerline → revolve', async ({ page }) => {
    await page.getByRole('treeitem', { name: 'Front plane' }).dblclick();
    await clickSketch(page, 10, 1);
    await clickSketch(page, 20, 21);
    await page.keyboard.press('k');
    await clickSketch(page, 0, 0);
    await clickSketch(page, 0, 15);
    await page.getByRole('button', { name: 'Revolve', exact: true }).click();
    await settle(page);
    // clicks land to the pixel, so compute the ring from the corners actually drawn
    const xs = await store<number[]>(page, `
      const sk = S().doc.features.find((f) => f.type === 'sketch').sketch;
      const ids = new Set(sk.entities.filter((e) => e.kind === 'line' && !e.construction).flatMap((l) => [l.p1, l.p2]));
      const p = sk.entities.filter((e) => ids.has(e.id)).map((e) => e.p);
      return [Math.min(...p.map((q) => q.x)), Math.max(...p.map((q) => q.x)), Math.min(...p.map((q) => q.y)), Math.max(...p.map((q) => q.y))];`);
    const [x0, x1, y0, y1] = xs;
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    expect(x0).toBeCloseTo(10, 0);
    expect(await volume(page)).toBeCloseTo(Math.PI * (x1 * x1 - x0 * x0) * (y1 - y0), 0);
    expect(await featureNames(page)).toContain('Revolve1');
  });

  test('F05-E1 revolve without a centerline asks for one', async ({ page }) => {
    await store(page, `S().beginSketch(S().doc.features[0].id); S().addRect({ at: { x: 10, y: 0 } }, { at: { x: 20, y: 20 } }); S().beginFeature('revolve');`);
    await expect(page.getByText(/needs an axis/)).toBeVisible();
    expect(await store<string>(page, `return S().mode.kind;`)).toBe('model');
  });

  test('F05-E2 a profile crossing the axis is refused', async ({ page }) => {
    await store(page, `S().beginSketch(S().doc.features[0].id); S().addRect({ at: { x: -10, y: 0 } }, { at: { x: 20, y: 20 } }); S().addLine({ at: { x: 0, y: 0 } }, { at: { x: 0, y: 10 } }, { construction: true }); S().beginFeature('revolve');`);
    await settle(page);
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeDisabled();
  });

  test('F05-E3 angle 0 and 400 are refused', async ({ page }) => {
    await store(page, `S().beginSketch(S().doc.features[0].id); S().addRect({ at: { x: 10, y: 0 } }, { at: { x: 20, y: 20 } }); S().addLine({ at: { x: 0, y: 0 } }, { at: { x: 0, y: 10 } }, { construction: true }); S().beginFeature('revolve');`);
    const angle = page.getByRole('spinbutton', { name: 'Angle' });
    await angle.fill('0');
    await angle.press('Tab');
    await expect(angle).toHaveAttribute('aria-invalid', 'true');
    await angle.fill('400');
    await angle.press('Tab');
    await settle(page);
    await expect(page.getByRole('alert').filter({ hasText: /between 0 and 360/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeDisabled();
  });
});

test.describe('F07 edit history', () => {
  let check: () => void;
  test.beforeEach(async ({ page }) => {
    check = guard(page);
    await openApp(page);
  });
  test.afterEach(() => check());

  test('F07-H1 rename, suppress, unsuppress', async ({ page }) => {
    await seedBlock(page, 10);
    const row = page.getByRole('treeitem', { name: 'Extrude1' });
    await row.click();
    await row.press('F2');
    await page.getByRole('textbox', { name: 'Feature name' }).fill('Base');
    await page.keyboard.press('Enter');
    await page.getByRole('treeitem', { name: 'Base' }).click();
    await page.getByRole('button', { name: 'Suppress selected' }).click();
    expect(await volume(page)).toBe(0);
    await page.getByRole('button', { name: 'Unsuppress selected' }).click();
    expect(await volume(page)).toBeCloseTo(24000, 0);
  });

  test('F07-E1 duplicate names are refused', async ({ page }) => {
    await seedBlock(page, 10);
    const row = page.getByRole('treeitem', { name: 'Extrude1' });
    await row.click();
    await row.press('F2');
    await page.getByRole('textbox', { name: 'Feature name' }).fill('Sketch1');
    await page.keyboard.press('Enter');
    await expect(page.getByText(/already a feature called Sketch1/)).toBeVisible();
    expect(await featureNames(page)).toContain('Extrude1');
  });

  test('F07-E2 deleting a feature takes its dependents, undo brings them back', async ({ page }) => {
    await seedBlock(page, 25);
    await store(page, `
      const ex = S().doc.features[4].id;
      S().beginSketch({ kind: 'face', face: { kind: 'cap', featureId: ex, cap: 'end', flip: false } });
      S().addCircle({ at: { x: 30, y: 20 } }, 5); S().beginFeature('cutExtrude'); S().confirmFeature(); S().select(null);
    `);
    await page.getByRole('treeitem', { name: 'Extrude1' }).click();
    await page.getByRole('button', { name: 'Delete selected' }).click();
    await expect(page.getByText(/Also deleted .*Cut1/)).toBeVisible();
    expect(await featureNames(page)).toEqual(['Front plane', 'Top plane', 'Right plane']);
    await page.keyboard.press('Control+z');
    expect(await featureNames(page)).toEqual(['Front plane', 'Top plane', 'Right plane', 'Sketch1', 'Extrude1', 'Sketch2', 'Cut1']);
  });
});

test.describe('F09 inspect and export', () => {
  let check: () => void;
  test.beforeEach(async ({ page }) => {
    check = guard(page);
    await openApp(page);
  });
  test.afterEach(() => check());

  test('F09-H1 export STL and STEP', async ({ page }) => {
    await seedBlock(page, 25);
    await page.getByRole('button', { name: 'File' }).click();
    const [stl] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: /Export STL/ }).click()]);
    expect(stl.suggestedFilename()).toBe('Part1.stl');
    const buf = readFileSync((await stl.path())!);
    const n = buf.readUInt32LE(80);
    expect(n).toBe(12);
    expect(buf.length).toBe(84 + 50 * n);
    await page.getByRole('button', { name: 'File' }).click();
    const [step] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: /Export STEP/ }).click()]);
    expect(readFileSync((await step.path())!, 'utf8').startsWith('ISO-10303-21')).toBe(true);
  });

  test('F09-E1 export with no solid is refused', async ({ page }) => {
    let downloaded = false;
    page.on('download', () => (downloaded = true));
    await page.getByRole('button', { name: 'File' }).click();
    await page.getByRole('menuitem', { name: /Export STL/ }).click();
    await expect(page.getByText(/no solid to export/)).toBeVisible();
    expect(downloaded).toBe(false);
  });

  test('F09-E2 save and reopen gives the same part', async ({ page }) => {
    await seedBlock(page, 25);
    await page.getByRole('button', { name: 'File' }).click();
    const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: /^Save\s*Ctrl\+S$/ }).click()]);
    const saved = (await file.path())!;
    await store(page, `S().newDoc();`);
    expect(await volume(page)).toBe(0);
    await page.getByLabel('Open a part file').setInputFiles({ name: 'Bracket.pwpart', mimeType: 'application/json', buffer: readFileSync(saved) });
    await settle(page);
    expect(await featureNames(page)).toEqual(['Front plane', 'Top plane', 'Right plane', 'Sketch1', 'Extrude1']);
    expect(await volume(page)).toBeCloseTo(60000, 0);
  });

  test('F09-N1 opening a bad file keeps the current part', async ({ page }) => {
    await seedBlock(page, 25);
    const dir = mkdtempSync(join(tmpdir(), 'pw-'));
    const bad = join(dir, 'broken.pwpart');
    writeFileSync(bad, 'this is not a part');
    await page.getByLabel('Open a part file').setInputFiles(bad);
    await expect(page.getByText(/Could not open broken.pwpart/)).toBeVisible();
    expect(await featureNames(page)).toContain('Extrude1');
  });
});
