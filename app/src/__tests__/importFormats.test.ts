import { describe, expect, it } from 'vitest';
import { fromBase64, meshToSolids, parse3MF, parseOBJ, parseSTL, prepareImport, stlPart, writeBinarySTL } from '../model/importFormats';
import { asciiSTL, box3MF, box3MFDeflated, boxOBJ, boxTris } from './meshFixtures';

const enc = (s: string) => new TextEncoder().encode(s);

/** signed volume of a triangle list */
function volume(t: number[]) {
  let v = 0;
  for (let i = 0; i < t.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = t.slice(i, i + 9);
    v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return v;
}

describe('mesh import', () => {
  it('reads binary and text STL alike', () => {
    const tris = boxTris(10, 20, 30);
    const bin = parseSTL(writeBinarySTL(tris));
    const txt = parseSTL(enc(asciiSTL(tris)));
    expect('tris' in bin && bin.tris).toEqual(tris);
    expect('tris' in txt && txt.tris).toEqual(tris);
    expect(volume(tris)).toBeCloseTo(6000, 6);
  });

  it('reads an OBJ with quads, v/vt/vn indices and negative indices', () => {
    const m = parseOBJ(boxOBJ(10, 20, 30));
    expect('tris' in m && volume(m.tris)).toBeCloseTo(6000, 6);
    const neg = parseOBJ('v 0 0 0\nv 1 0 0\nv 0 1 0\nf -3 -2 -1\n');
    expect('tris' in neg && neg.tris).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(parseOBJ('v 0 0 0\nf 1 2 3\n')).toHaveProperty('error');
  });

  it('reads a 3MF, its unit and its build transform', async () => {
    const mm = await parse3MF(box3MF(10, 20, 30));
    expect('tris' in mm && volume(mm.tris)).toBeCloseTo(6000, 6);
    const inch = await parse3MF(box3MF(1, 1, 1, 'inch', '1 0 0 0 1 0 0 0 1 5 0 0'));
    expect('tris' in inch && volume(inch.tris)).toBeCloseTo(25.4 ** 3, 3);
    const packed = await parse3MF(await box3MFDeflated(10, 20, 30));
    expect('tris' in packed && volume(packed.tris)).toBeCloseTo(6000, 6);
    expect('tris' in inch && Math.min(...inch.tris.filter((_, i) => i % 3 === 0))).toBeCloseTo(5 * 25.4, 6);
  });

  it('turns inside-out and mixed-up triangles outward, and splits separate bodies', () => {
    const a = boxTris(10, 10, 10);
    // flip every triangle of a second box, and just one of the first
    const b = boxTris(30, 10, 10, 20, 0, 0);
    for (let i = 0; i < b.length; i += 9) b.splice(i + 3, 6, ...b.slice(i + 6, i + 9), ...b.slice(i + 3, i + 6));
    a.splice(3, 6, ...a.slice(6, 9), ...a.slice(3, 6));
    const r = meshToSolids({ tris: [...a, ...b], scale: 1, unit: 'mm' });
    expect('parts' in r && r.parts).toEqual([12, 12]);
    expect('tris' in r && volume(r.tris.slice(0, 108))).toBeCloseTo(1000, 6);
    expect('tris' in r && volume(r.tris.slice(108))).toBeCloseTo(1000, 6);
  });

  it('refuses an open mesh', () => {
    const r = meshToSolids({ tris: boxTris(1, 1, 1).slice(0, 99), scale: 1, unit: 'mm' });
    expect('error' in r && r.error).toMatch(/not closed \(3 edges/);
  });

  it('prepares a mesh as stored STL, one piece per body', async () => {
    const tris = [...boxTris(10, 10, 10), ...boxTris(30, 10, 10, 20, 0, 0)];
    const r = await prepareImport('two.stl', writeBinarySTL(tris));
    if ('error' in r) throw new Error(r.error);
    expect(r.format).toBe('stl');
    expect(r.note).toBe('2 bodies, 24 triangles');
    const piece = parseSTL(stlPart(fromBase64(r.data), r.parts!, 1));
    expect('tris' in piece && volume(piece.tris)).toBeCloseTo(1000, 3);
  });

  it('explains formats it cannot read, and checks STEP and BREP', async () => {
    expect(await prepareImport('bracket.x_t', enc('**ABC'))).toEqual({ error: expect.stringMatching(/Parasolid file, which this app cannot read. Save it as STEP/) });
    expect(await prepareImport('plate.IGS', enc('S'))).toHaveProperty('error', expect.stringMatching(/IGES/));
    expect(await prepareImport('a.sldprt', enc(''))).toHaveProperty('error', expect.stringMatching(/SOLIDWORKS part/));
    expect(await prepareImport('a.step', enc('hello'))).toEqual({ error: 'a.step does not look like a STEP file.' });
    expect(await prepareImport('a.brep', enc('\nCASCADE Topology V1, (c) Matra-Datavision\n'))).toMatchObject({ format: 'brep' });
    expect(await prepareImport('a.dwg', enc(''))).toHaveProperty('error');
  });
});
