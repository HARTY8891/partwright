import { test, expect } from '@playwright/test';
import { clickSketch, featureNames, guard, openApp, seedBlock, settle, sketchLineMids, store, typeDimension, volume } from './helpers';

test.describe('milestone 3: finishing the must-haves', () => {
  let check: () => void;
  test.afterEach(() => check());

  async function rectSketch(page: import('@playwright/test').Page) {
    await page.getByRole('treeitem', { name: 'Front plane' }).dblclick();
    await clickSketch(page, 5, 5);
    await clickSketch(page, 45, 25);
  }

  test('F04-E2 select two lines, add Parallel, see it listed, remove it', async ({ page }) => {
    check = guard(page);
    await openApp(page);
    await page.getByRole('treeitem', { name: 'Front plane' }).dblclick();
    await page.keyboard.press('l');
    await clickSketch(page, 5, 5);
    await clickSketch(page, 40, 12);
    await page.keyboard.press('Escape');
    await clickSketch(page, 5, 25);
    await clickSketch(page, 35, 40);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape'); // select tool
    const mids = await sketchLineMids(page);
    await clickSketch(page, mids[0].x, mids[0].y);
    const second = await (async () => {
      const { x, y } = mids[1];
      return { x, y };
    })();
    await page.keyboard.down('Shift');
    await clickSketch(page, second.x, second.y);
    await page.keyboard.up('Shift');
    const panel = page.getByRole('region', { name: 'Relations' });
    await expect(panel.getByText('Selected (2)')).toBeVisible();
    await panel.getByRole('button', { name: 'Parallel', exact: true }).click();
    await expect(panel.getByText(/Parallel · Line 1, Line 2/)).toBeVisible();
    const kinds = await store<string[]>(page, `return S().doc.features[3].sketch.constraints.map((c) => c.kind);`);
    expect(kinds).toContain('parallel');
    await panel.getByRole('button', { name: 'Remove Parallel relation' }).click();
    expect(await store<string[]>(page, `return S().doc.features[3].sketch.constraints.map((c) => c.kind);`)).not.toContain('parallel');
  });

  test('F04-E3 conflicting relation is refused', async ({ page }) => {
    check = guard(page);
    await openApp(page);
    await rectSketch(page);
    const ok = await store<boolean>(page, `
      const sk = S().doc.features[3].sketch; const L = sk.entities.filter((e) => e.kind === 'line');
      return S().addRelation('perpendicular', [L[0].id, L[2].id]);`);
    expect(ok).toBe(false);
    await expect(page.getByText(/conflicts|over-define/)).toBeVisible();
  });

  test('F04-E4 point-to-point and angle dimensions', async ({ page }) => {
    check = guard(page);
    await openApp(page);
    await page.getByRole('treeitem', { name: 'Front plane' }).dblclick();
    await page.keyboard.press('l');
    await clickSketch(page, 5, 5);
    await clickSketch(page, 40, 12);
    await clickSketch(page, 30, 35);
    await page.keyboard.press('Escape');
    await page.keyboard.press('d');
    await clickSketch(page, 5, 5); // point
    await clickSketch(page, 30, 35); // point
    await typeDimension(page, '30');
    const dist = await store<number>(page, `
      const sk = S().doc.features[3].sketch; const P = sk.entities.filter((e) => e.kind === 'point' && !e.construction);
      return Math.hypot(P[0].p.x - P[2].p.x, P[0].p.y - P[2].p.y);`);
    expect(dist).toBeCloseTo(30, 4);
    // angle between the two lines via the relations panel
    await page.keyboard.press('Escape');
    const mids = await sketchLineMids(page);
    await clickSketch(page, mids[0].x, mids[0].y);
    await page.keyboard.down('Shift');
    await clickSketch(page, mids[1].x, mids[1].y);
    await page.keyboard.up('Shift');
    await page.getByRole('region', { name: 'Relations' }).getByRole('button', { name: 'Angle' }).click();
    await typeDimension(page, '90');
    const dotp = await store<number>(page, `
      const sk = S().doc.features[3].sketch; const P = (id) => sk.entities.find((e) => e.id === id).p;
      const L = sk.entities.filter((e) => e.kind === 'line');
      const d = (l) => [P(l.p2).x - P(l.p1).x, P(l.p2).y - P(l.p1).y];
      const [a, b] = [d(L[0]), d(L[1])]; return (a[0] * b[0] + a[1] * b[1]) / (Math.hypot(...a) * Math.hypot(...b));`);
    expect(dotp).toBeCloseTo(0, 4);
    await expect(page.getByRole('button', { name: /angle 90\.0 degrees/ })).toBeVisible();
  });

  test('F01-E10 inference: a new point lines up with an existing one', async ({ page }) => {
    check = guard(page);
    await openApp(page);
    await rectSketch(page);
    await page.keyboard.press('l');
    await clickSketch(page, 70, 5.8); // close to the corner's height (y = 5)
    await clickSketch(page, 90, 40);
    await page.keyboard.press('Escape');
    const [corner, picked] = await store<number[]>(page, `
      const sk = S().doc.features[3].sketch; const P = sk.entities.filter((e) => e.kind === 'point' && !e.construction);
      const rectBottom = Math.min(...P.filter((e) => e.p.x < 60).map((e) => e.p.y));
      return [rectBottom, P.find((e) => e.p.x > 60).p.y];`);
    expect(picked).toBeCloseTo(corner, 6); // snapped to the corner's height, not the clicked 5.8
  });

  test('F03-E3 rebuild errors are listed and can be edited from the list', async ({ page }) => {
    check = guard(page);
    await openApp(page);
    await seedBlock(page, 25);
    await store(page, `
      const ex = S().doc.features[4].id; const sk = S().doc.features[3].sketch;
      S().beginFeature('fillet');
      for (const l of sk.entities.filter((e) => e.kind === 'line')) S().toggleEdge({ kind: 'capEdge', featureId: ex, cap: 'end', segmentId: l.id });
      S().updateDraft((d) => { d.size = { expr: '8', value: 8 }; }); S().confirmFeature();
      S().editFeature(ex); S().updateDraft((d) => { d.direction1.depth = { expr: '5', value: 5 }; }); S().confirmFeature();`);
    await settle(page);
    await page.getByRole('button', { name: '1 rebuild error' }).click();
    const dialog = page.getByRole('dialog', { name: 'What went wrong' });
    await expect(dialog.getByText('Fillet1')).toBeVisible();
    await dialog.getByRole('button', { name: 'Edit Fillet1' }).click();
    await expect(page.getByRole('heading', { name: 'Edit Fillet1' })).toBeVisible();
  });

  test('F01-E11 inch part: dimensions and depth in inches', async ({ page }) => {
    check = guard(page);
    await openApp(page);
    await page.keyboard.press('Control+n');
    const start = page.getByRole('dialog', { name: 'Start' });
    await start.getByLabel(/Inches/).check();
    await start.getByRole('button', { name: 'Create part' }).click();
    await expect(page.getByText('Inches', { exact: true })).toBeVisible(); // status bar
    await page.getByRole('treeitem', { name: 'Front plane' }).dblclick();
    await clickSketch(page, 5, 5);
    await clickSketch(page, 45, 25);
    await page.keyboard.press('d');
    let mids = await sketchLineMids(page);
    await clickSketch(page, mids[0].x, mids[0].y);
    await typeDimension(page, '2');
    mids = await sketchLineMids(page);
    await clickSketch(page, mids[1].x, mids[1].y);
    await typeDimension(page, '1');
    await expect(page.getByRole('button', { name: /2\.000 inches/ })).toBeVisible();
    await page.getByRole('button', { name: 'Extrude', exact: true }).click();
    await expect(page.getByRole('spinbutton', { name: 'Depth' })).toHaveValue('0.5');
    await settle(page);
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    expect(await volume(page)).toBeCloseTo(2 * 1 * 0.5 * 25.4 ** 3, 0);
  });

  test('F09-E3 autosave: reload and pick the part from Recent parts', async ({ page }) => {
    check = guard(page);
    await openApp(page);
    await seedBlock(page, 25);
    await page.waitForTimeout(1500); // autosave runs one second after the last edit
    await page.reload();
    const start = page.getByRole('dialog', { name: 'Start' });
    await expect(start).toBeVisible({ timeout: 30_000 });
    await start.getByRole('button', { name: /^Part1/ }).click();
    await expect(page.getByText('Opened Part1')).toBeVisible();
    expect(await featureNames(page)).toEqual(['Front plane', 'Top plane', 'Right plane', 'Sketch1', 'Extrude1']);
    expect(await volume(page)).toBeCloseTo(60000, 0);
  });

  test('F09-E4 save in place: the second Save writes the same file without asking', async ({ page }) => {
    check = guard(page);
    await page.addInitScript(() => {
      const w = window as any;
      w.__writes = [];
      w.__picks = 0;
      w.showSaveFilePicker = async () => {
        w.__picks++;
        return { name: 'Bracket.pwpart', createWritable: async () => ({ write: async (b: Blob) => w.__writes.push(await b.text()), close: async () => {} }) };
      };
    });
    await openApp(page, { keepPicker: true });
    await seedBlock(page, 25);
    await page.keyboard.press('Control+s');
    await expect(page.getByText('Saved Bracket.pwpart')).toBeVisible();
    await store(page, `S().renameFeature(S().doc.features[4].id, 'Base');`);
    await page.keyboard.press('Control+s');
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => ({ picks: (window as any).__picks, writes: (window as any).__writes.length, last: (window as any).__writes.at(-1) }));
    expect(r.picks).toBe(1);
    expect(r.writes).toBe(2);
    expect(JSON.parse(r.last).features.map((f: any) => f.name)).toContain('Base');
  });
});
