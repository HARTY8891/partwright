import { describe, expect, it } from 'vitest';
import { crc32, make3MF } from '../model/threemf';

/** Read a stored zip back: name -> text. */
function unzip(buf: Uint8Array): Record<string, string> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out: Record<string, string> = {};
  let at = 0;
  while (dv.getUint32(at, true) === 0x04034b50) {
    const size = dv.getUint32(at + 18, true);
    const nameLen = dv.getUint16(at + 26, true);
    const name = new TextDecoder().decode(buf.subarray(at + 30, at + 30 + nameLen));
    const data = buf.subarray(at + 30 + nameLen, at + 30 + nameLen + size);
    expect(dv.getUint32(at + 14, true)).toBe(crc32(data));
    out[name] = new TextDecoder().decode(data);
    at += 30 + nameLen + size;
  }
  expect(dv.getUint32(buf.length - 22, true)).toBe(0x06054b50);
  return out;
}

describe('3MF export', () => {
  it('crc32 matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('a tetrahedron with duplicated vertices becomes a welded, valid package', () => {
    // 4 faces, each with its own 3 vertices (as a mesher outputs them)
    const P = [[0, 0, 0], [10, 0, 0], [0, 10, 0], [0, 0, 10]];
    const faces = [[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]];
    const vertices = faces.flatMap((f) => f.flatMap((i) => P[i]));
    const triangles = faces.flatMap((_, k) => [k * 3, k * 3 + 1, k * 3 + 2]);
    const files = unzip(make3MF(vertices, triangles, 'Tetra & "co"'));
    expect(Object.keys(files)).toEqual(['[Content_Types].xml', '_rels/.rels', '3D/3dmodel.model']);
    const model = files['3D/3dmodel.model'];
    expect(model).toContain('unit="millimeter"');
    expect(model.match(/<vertex /g)).toHaveLength(4); // welded from 12
    expect(model.match(/<triangle /g)).toHaveLength(4);
    expect(model).toContain('Tetra &amp; &quot;co&quot;');
  });
});
