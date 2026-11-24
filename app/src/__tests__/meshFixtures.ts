// Small mesh files for the import tests (unit and e2e).

/** A box from (x0,y0,z0) to (x1,y1,z1) as 12 outward triangles, 9 numbers each. */
export function boxTris(x1: number, y1: number, z1: number, x0 = 0, y0 = 0, z0 = 0): number[] {
  const P = (i: number) => [i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0];
  // quads with corners counter-clockwise seen from outside
  const quads = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
  return quads.flatMap(([a, b, c, d]) => [...P(a), ...P(b), ...P(c), ...P(a), ...P(c), ...P(d)]);
}

export function asciiSTL(tris: number[]): string {
  let s = 'solid test\n';
  for (let i = 0; i < tris.length; i += 9) {
    s += ' facet normal 0 0 0\n  outer loop\n';
    for (let k = 0; k < 9; k += 3) s += `   vertex ${tris[i + k]} ${tris[i + k + 1]} ${tris[i + k + 2]}\n`;
    s += '  endloop\n endfacet\n';
  }
  return s + 'endsolid test\n';
}

/** An OBJ of a box written as 6 quads (1-based indices, v/vt/vn style on one face). */
export function boxOBJ(x: number, y: number, z: number): string {
  const v: string[] = [];
  for (let i = 0; i < 8; i++) v.push(`v ${i & 1 ? x : 0} ${i & 2 ? y : 0} ${i & 4 ? z : 0}`);
  const quads = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
  const f = quads.map((q, n) => 'f ' + q.map((i) => (n === 0 ? `${i + 1}/1/1` : `${i + 1}`)).join(' '));
  return ['# box', ...v, ...f].join('\n') + '\n';
}

/** A 3MF (zip, stored without compression) holding one box object, in the given unit. */
export function box3MF(x: number, y: number, z: number, unit = 'millimeter', transform?: string): Uint8Array {
  return zipStored(box3MFFiles(x, y, z, unit, transform));
}

/** The same, compressed the way real 3MF files are. */
export async function box3MFDeflated(x: number, y: number, z: number): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  for (const [name, text] of Object.entries(box3MFFiles(x, y, z))) {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    files[name] = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return zipStored(files, 8);
}

function box3MFFiles(x: number, y: number, z: number, unit = 'millimeter', transform?: string): Record<string, string> {
  const vs: string[] = [];
  for (let i = 0; i < 8; i++) vs.push(`<vertex x="${i & 1 ? x : 0}" y="${i & 2 ? y : 0}" z="${i & 4 ? z : 0}"/>`);
  const quads = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
  const ts = quads.flatMap(([a, b, c, d]) => [`<triangle v1="${a}" v2="${b}" v3="${c}"/>`, `<triangle v1="${a}" v2="${c}" v3="${d}"/>`]);
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="${unit}" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <resources><object id="1" type="model"><mesh><vertices>${vs.join('')}</vertices><triangles>${ts.join('')}</triangles></mesh></object></resources>
 <build><item objectid="1"${transform ? ` transform="${transform}"` : ''}/></build>
</model>`;
  return { '[Content_Types].xml': '<Types/>', '3D/3dmodel.model': model };
}

function zipStored(files: Record<string, string | Uint8Array>, method = 0): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const n = enc.encode(name), d = typeof text === 'string' ? enc.encode(text) : text;
    const local = new Uint8Array(30 + n.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, method, true);
    lv.setUint32(18, d.length, true);
    lv.setUint32(22, d.length, true);
    lv.setUint16(26, n.length, true);
    local.set(n, 30);
    const c = new Uint8Array(46 + n.length);
    const cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, method, true);
    cv.setUint32(20, d.length, true);
    cv.setUint32(24, d.length, true);
    cv.setUint16(28, n.length, true);
    cv.setUint32(42, offset, true);
    c.set(n, 46);
    chunks.push(local, d);
    central.push(c);
    offset += local.length + d.length;
  }
  const cdSize = central.reduce((a, c) => a + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, central.length, true);
  ev.setUint16(10, central.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const all = [...chunks, ...central, end];
  const out = new Uint8Array(all.reduce((a, c) => a + c.length, 0));
  let p = 0;
  for (const c of all) out.set(c, p), (p += c.length);
  return out;
}
