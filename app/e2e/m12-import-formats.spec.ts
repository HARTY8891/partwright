import { test, expect } from '@playwright/test';
import { featureNames, guard, openApp, store, volume } from './helpers';
import { asciiSTL, box3MFDeflated, boxOBJ, boxTris } from '../src/__tests__/meshFixtures';
import { writeBinarySTL } from '../src/model/importFormats';

/** a closed n-sided prism standing on z=0 (a faceted cylinder) */
function prism(r: number, h: number, n: number): number[] {
  const t: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI, b = ((i + 1) / n) * 2 * Math.PI;
    const [ax, ay, bx, by] = [r * Math.cos(a), r * Math.sin(a), r * Math.cos(b), r * Math.sin(b)];
    t.push(0, 0, 0, bx, by, 0, ax, ay, 0); // bottom, facing down
    t.push(0, 0, h, ax, ay, h, bx, by, h); // top, facing up
    t.push(ax, ay, 0, bx, by, 0, bx, by, h, ax, ay, 0, bx, by, h, ax, ay, h);
  }
  return t;
}

test.describe('importing other formats', () => {
  let check: () => void;
  test.beforeEach(async ({ page }) => {
    check = guard(page);
    await openApp(page);
  });
  test.afterEach(() => check());

  const put = (page: import('@playwright/test').Page, name: string, buffer: Buffer | Uint8Array) =>
    page.getByLabel('Import a 3D file').setInputFiles({ name, mimeType: 'application/octet-stream', buffer: Buffer.from(buffer) });

  test('binary STL: a box becomes a solid you can cut', async ({ page }) => {
    await put(page, 'box.stl', writeBinarySTL(boxTris(60, 40, 25)));
    await expect(page.getByText(/Imported box.stl \(1 body, 12 triangles\)/)).toBeVisible();
    expect(await featureNames(page)).toContain('Import1');
    expect(await volume(page)).toBeCloseTo(60000, 0);
    // flat triangles merge into faces, so a sketch on the top and a cut work as usual
    await store(page, `S().beginSketch(S().doc.features[1].id); S().addCircle({ at: { x: 30, y: 20 } }, 5); S().beginFeature('cutExtrude'); S().updateDraft((d) => { d.direction1.type = 'throughAllBoth'; }); S().confirmFeature();`);
    expect(await volume(page)).toBeCloseTo(60000 - Math.PI * 25 * 25, 0);
  });

  test('text STL with two bodies, OBJ and 3MF', async ({ page }) => {
    await put(page, 'pair.stl', Buffer.from(asciiSTL([...boxTris(10, 10, 10), ...boxTris(30, 10, 10, 20, 0, 0)])));
    await expect(page.getByText(/pair.stl \(2 bodies, 24 triangles\)/)).toBeVisible();
    expect(await volume(page)).toBeCloseTo(2000, 0);
    await put(page, 'block.obj', Buffer.from(boxOBJ(10, 10, 10).replace(/^v (\S+)/gm, (_, x) => `v ${+x + 50}`)));
    await expect(page.getByText(/Imported block.obj/)).toBeVisible();
    expect(await volume(page)).toBeCloseTo(3000, 0);
    await put(page, 'part.3mf', await box3MFDeflated(10, 10, 10));
    await expect(page.getByText(/Imported part.3mf/)).toBeVisible();
    // this one overlaps the first box exactly, so it adds nothing
    expect(await volume(page)).toBeCloseTo(3000, 0);
    expect(await featureNames(page)).toEqual(expect.arrayContaining(['Import1', 'Import2', 'Import3']));
  });

  test('a faceted cylinder of 256 triangles, and it survives save and reload', async ({ page }) => {
    const n = 64, r = 10, h = 20;
    await put(page, 'cyl.stl', writeBinarySTL(prism(r, h, n)));
    await expect(page.getByText(/cyl.stl \(1 body, 256 triangles\)/)).toBeVisible();
    const exact = 0.5 * n * r * r * Math.sin((2 * Math.PI) / n) * h;
    expect(await volume(page)).toBeCloseTo(exact, 0);
    await store(page, `const d = JSON.parse(JSON.stringify(S().doc)); S().newDoc(); S().loadDoc(d);`);
    expect(await volume(page)).toBeCloseTo(exact, 0);
  });

  test('refuses an open mesh and explains formats it cannot read', async ({ page }) => {
    await put(page, 'open.stl', writeBinarySTL(boxTris(1, 1, 1).slice(0, 99)));
    await expect(page.getByText(/open.stl: the mesh is not closed/)).toBeVisible();
    await put(page, 'bracket.x_t', Buffer.from('**ABCDEFGHIJKLMNOPQRSTUVWXYZ'));
    await expect(page.getByText(/bracket.x_t is a Parasolid file, which this app cannot read/)).toBeVisible();
    expect(await featureNames(page)).not.toContain('Import1');
  });
});
