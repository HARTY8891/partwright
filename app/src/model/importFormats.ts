// Reading 3D files from other programs into a part. Pure (no kernel): it works out
// the format, checks that a mesh can become a solid, and returns what the part
// stores. The kernel then turns that into a solid (see kernel.worker.ts).
//
//   STEP (.step .stp)        stored as text, read by the kernel
//   BREP (.brep)             OpenCascade's own text format, stored as text
//   STL, OBJ, 3MF            meshes: welded, checked watertight, faced outward,
//                            split into separate bodies, stored as binary STL

export type ImportFormat = 'step' | 'brep' | 'stl';

export interface PreparedImport {
  format: ImportFormat;
  /** text for STEP and BREP; base64 binary STL for meshes */
  data: string;
  /** meshes: triangles in each separate body, in order */
  parts?: number[];
  /** a short line for the user, e.g. "2 bodies, 1,204 triangles" */
  note?: string;
}

export const IMPORT_ACCEPT = '.step,.stp,.brep,.brp,.stl,.obj,.3mf,.igs,.iges,.x_t,.x_b,.xmt_txt,.sldprt,.sldasm';

/** Meshes with more triangles than this are refused: every triangle becomes a face. */
export const MAX_TRIANGLES = 40000;

const NOT_READABLE: Record<string, string> = {
  igs: 'IGES', iges: 'IGES',
  x_t: 'Parasolid', x_b: 'Parasolid', xmt_txt: 'Parasolid',
  sldprt: 'SOLIDWORKS part', sldasm: 'SOLIDWORKS assembly',
};

const ext = (name: string) => (name.toLowerCase().match(/\.([a-z0-9_]+)$/)?.[1] ?? '');

export async function prepareImport(name: string, bytes: Uint8Array): Promise<PreparedImport | { error: string }> {
  const e = ext(name);
  if (NOT_READABLE[e])
    return { error: `${name} is a ${NOT_READABLE[e]} file, which this app cannot read. Save it as STEP (or STL) from the program that made it, then import that.` };
  const head = latin1(bytes.subarray(0, 400));
  if (e === 'step' || e === 'stp' || /ISO-10303-21/.test(head)) {
    const text = new TextDecoder().decode(bytes);
    if (!/ISO-10303-21/.test(text.slice(0, 400))) return { error: `${name} does not look like a STEP file.` };
    return { format: 'step', data: text };
  }
  if (e === 'brep' || e === 'brp') {
    const text = new TextDecoder().decode(bytes);
    if (!/CASCADE Topology/.test(text.slice(0, 400))) return { error: `${name} does not look like a BREP file.` };
    return { format: 'brep', data: text };
  }
  let mesh: Mesh | { error: string };
  if (e === 'stl') mesh = parseSTL(bytes);
  else if (e === 'obj') mesh = parseOBJ(new TextDecoder().decode(bytes));
  else if (e === '3mf') mesh = await parse3MF(bytes);
  else return { error: `${name}: this app imports STEP, BREP, STL, OBJ and 3MF files.` };
  if ('error' in mesh) return { error: `${name}: ${mesh.error}` };
  const solid = meshToSolids(mesh);
  if ('error' in solid) return { error: `${name}: ${solid.error}` };
  const n = solid.tris.length / 9;
  return {
    format: 'stl',
    data: toBase64(writeBinarySTL(solid.tris)),
    parts: solid.parts,
    note: `${solid.parts.length === 1 ? '1 body' : `${solid.parts.length} bodies`}, ${n.toLocaleString('en')} triangles${mesh.scale !== 1 ? `, converted from ${mesh.unit}` : ''}${n > 5000 ? `; a mesh this size takes about ${Math.max(5, Math.round(n / 1300 / 5) * 5)} seconds to become a solid` : ''}`,
  };
}

/* ---------- meshes ---------- */

/** Triangles as a flat list of xyz, 9 numbers per triangle. */
export interface Mesh {
  tris: number[];
  /** what the file's lengths were multiplied by to get millimetres */
  scale: number;
  unit: string;
}

export function parseSTL(bytes: Uint8Array): Mesh | { error: string } {
  const n = bytes.length >= 84 ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(80, true) : -1;
  const binary = n >= 0 && bytes.length === 84 + n * 50;
  if (!binary && /^\s*solid/.test(latin1(bytes.subarray(0, 80))) && /facet/.test(latin1(bytes.subarray(0, 1000)))) {
    const text = new TextDecoder().decode(bytes);
    const tris: number[] = [];
    const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g;
    for (let m = re.exec(text); m; m = re.exec(text)) tris.push(+m[1], +m[2], +m[3]);
    if (tris.length % 9 || tris.some((v) => !Number.isFinite(v))) return { error: 'the text STL has a malformed vertex line.' };
    if (!tris.length) return { error: 'the STL has no triangles.' };
    return { tris, scale: 1, unit: 'mm' };
  }
  if (n < 0 || bytes.length < 84 + n * 50) return { error: 'the STL file is cut short or is not an STL.' };
  if (n === 0) return { error: 'the STL has no triangles.' };
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tris = new Array<number>(n * 9);
  for (let i = 0; i < n; i++) for (let k = 0; k < 9; k++) tris[i * 9 + k] = dv.getFloat32(84 + i * 50 + 12 + k * 4, true);
  if (tris.some((v) => !Number.isFinite(v))) return { error: 'the STL has a vertex that is not a number.' };
  return { tris, scale: 1, unit: 'mm' };
}

export function parseOBJ(text: string): Mesh | { error: string } {
  const v: number[][] = [];
  const tris: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('v ')) {
      const p = line.split(/\s+/).slice(1, 4).map(Number);
      if (p.length < 3 || p.some((x) => !Number.isFinite(x))) return { error: `a vertex line is malformed: "${line.slice(0, 40)}".` };
      v.push(p);
    } else if (line.startsWith('f ')) {
      const idx = line.split(/\s+/).slice(1).map((t) => {
        const i = parseInt(t.split('/')[0], 10);
        return i < 0 ? v.length + i : i - 1;
      });
      if (idx.length < 3 || idx.some((i) => !(i >= 0 && i < v.length))) return { error: `a face refers to a vertex that does not exist: "${line.slice(0, 40)}".` };
      for (let k = 1; k + 1 < idx.length; k++) tris.push(...v[idx[0]], ...v[idx[k]], ...v[idx[k + 1]]);
    }
  }
  if (!tris.length) return { error: 'the OBJ has no faces.' };
  return { tris, scale: 1, unit: 'mm' };
}

const UNITS: Record<string, number> = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 };

export async function parse3MF(bytes: Uint8Array): Promise<Mesh | { error: string }> {
  const files = await unzip(bytes);
  if ('error' in files && typeof files.error === 'string') return { error: files.error };
  const zip = files as Record<string, Uint8Array>;
  const modelName = Object.keys(zip).find((f) => /^3D\/.*\.model$/i.test(f)) ?? Object.keys(zip).find((f) => /\.model$/i.test(f));
  if (!modelName) return { error: 'the 3MF has no 3D model inside.' };
  const xml = new TextDecoder().decode(zip[modelName]);
  const unit = /<model\b[^>]*\bunit="([a-z]+)"/i.exec(xml)?.[1] ?? 'millimeter';
  const scale = UNITS[unit] ?? 1;
  const attr = (tag: string, a: string) => new RegExp(`\\b${a}="([^"]*)"`).exec(tag)?.[1];
  type Obj = { tris: number[]; comps: { id: string; m: number[] }[] };
  const objects = new Map<string, Obj>();
  const objRe = /<object\b([^>]*)>([\s\S]*?)<\/object>/g;
  for (let m = objRe.exec(xml); m; m = objRe.exec(xml)) {
    const id = attr(m[1], 'id')!;
    const body = m[2];
    const vs: number[][] = [];
    for (const t of body.match(/<vertex\b[^>]*\/?>/g) ?? []) vs.push(['x', 'y', 'z'].map((a) => Number(attr(t, a))));
    const tris: number[] = [];
    for (const t of body.match(/<triangle\b[^>]*\/?>/g) ?? []) {
      const ix = ['v1', 'v2', 'v3'].map((a) => Number(attr(t, a)));
      if (ix.some((i) => !vs[i])) return { error: 'a triangle refers to a vertex that does not exist.' };
      for (const i of ix) tris.push(...vs[i]);
    }
    const comps = (body.match(/<component\b[^>]*\/?>/g) ?? []).map((t) => ({ id: attr(t, 'objectid')!, m: matrix(attr(t, 'transform')) }));
    objects.set(id, { tris, comps });
  }
  const out: number[] = [];
  const emit = (id: string, m: number[], depth: number): void => {
    const o = objects.get(id);
    if (!o || depth > 20) return;
    for (let i = 0; i < o.tris.length; i += 3) {
      const [x, y, z] = [o.tris[i], o.tris[i + 1], o.tris[i + 2]];
      out.push((m[0] * x + m[3] * y + m[6] * z + m[9]) * scale, (m[1] * x + m[4] * y + m[7] * z + m[10]) * scale, (m[2] * x + m[5] * y + m[8] * z + m[11]) * scale);
    }
    for (const c of o.comps) emit(c.id, compose(m, c.m), depth + 1);
  };
  const items = xml.match(/<item\b[^>]*\/?>/g) ?? [];
  for (const t of items) emit(attr(t, 'objectid')!, matrix(attr(t, 'transform')), 0);
  if (!out.length) return { error: 'the 3MF has no triangles to build.' };
  if (out.some((v) => !Number.isFinite(v))) return { error: 'the 3MF has a vertex that is not a number.' };
  return { tris: out, scale, unit };
}

/** a 3MF transform: 12 numbers, columns of a 3×3 then the translation */
function matrix(s: string | undefined): number[] {
  const m = s?.trim().split(/\s+/).map(Number);
  return m && m.length === 12 && m.every(Number.isFinite) ? m : [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
}
/** apply b, then a */
function compose(a: number[], b: number[]): number[] {
  const r = new Array<number>(12);
  for (let row = 0; row < 4; row++)
    for (let col = 0; col < 3; col++) r[row * 3 + col] = b[row * 3] * a[col] + b[row * 3 + 1] * a[3 + col] + b[row * 3 + 2] * a[6 + col] + (row === 3 ? a[9 + col] : 0);
  return r;
}

/**
 * Weld the corners, check every edge is shared by exactly two triangles, make
 * neighbours face the same way, split into separate bodies and turn each one
 * outward. Returns the triangles grouped by body.
 */
export function meshToSolids(mesh: Mesh): { tris: number[]; parts: number[] } | { error: string } {
  const src = mesh.tris;
  let lo = Infinity, hi = -Infinity;
  for (const v of src) (lo = Math.min(lo, v)), (hi = Math.max(hi, v));
  const tol = Math.max((hi - lo) * 1e-7, 1e-9);
  const ids = new Map<string, number>();
  const pts: number[] = [];
  const corner = (i: number) => {
    const key = `${Math.round(src[i] / tol)},${Math.round(src[i + 1] / tol)},${Math.round(src[i + 2] / tol)}`;
    let id = ids.get(key);
    if (id === undefined) ids.set(key, (id = pts.length / 3)), pts.push(src[i], src[i + 1], src[i + 2]);
    return id;
  };
  const tri: number[][] = [];
  for (let i = 0; i + 8 < src.length; i += 9) {
    const t = [corner(i), corner(i + 3), corner(i + 6)];
    if (t[0] !== t[1] && t[1] !== t[2] && t[0] !== t[2]) tri.push(t);
  }
  if (!tri.length) return { error: 'every triangle is too small to keep.' };
  if (tri.length > MAX_TRIANGLES)
    return { error: `it has ${tri.length.toLocaleString('en')} triangles; the most this app can turn into a solid is ${MAX_TRIANGLES.toLocaleString('en')}. Reduce it in a mesh program first.` };

  // edge -> the triangles using it
  const ek = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
  const edges = new Map<string, number[]>();
  tri.forEach((t, i) => {
    for (let k = 0; k < 3; k++) {
      const key = ek(t[k], t[(k + 1) % 3]);
      const list = edges.get(key);
      if (list) list.push(i);
      else edges.set(key, [i]);
    }
  });
  let open = 0, multi = 0;
  for (const l of edges.values()) l.length === 1 ? open++ : l.length > 2 && multi++;
  if (open) return { error: `the mesh is not closed (${open.toLocaleString('en')} edges belong to only one triangle). A solid needs a watertight mesh.` };
  if (multi) return { error: `${multi.toLocaleString('en')} edges are shared by more than two triangles, so the mesh is not a clean solid.` };

  // walk each body, flipping neighbours so a shared edge runs opposite ways
  const has = (t: number[], a: number, b: number) => [0, 1, 2].some((k) => t[k] === a && t[(k + 1) % 3] === b);
  const body = new Array<number>(tri.length).fill(-1);
  const parts: number[][] = [];
  for (let s = 0; s < tri.length; s++) {
    if (body[s] >= 0) continue;
    const members = [s];
    body[s] = parts.length;
    for (let q = 0; q < members.length; q++) {
      const t = tri[members[q]];
      for (let k = 0; k < 3; k++) {
        const a = t[k], b = t[(k + 1) % 3];
        for (const j of edges.get(ek(a, b))!) {
          if (j === members[q]) continue;
          if (body[j] < 0) {
            if (has(tri[j], a, b)) tri[j].reverse(); // same direction: flip it
            body[j] = parts.length;
            members.push(j);
          } else if (has(tri[j], a, b)) return { error: 'the mesh cannot be made to face one way (it is one-sided, like a Möbius strip).' };
        }
      }
    }
    // outward: positive volume
    let vol = 0;
    for (const i of members) {
      const [a, b, c] = tri[i].map((p) => [pts[p * 3], pts[p * 3 + 1], pts[p * 3 + 2]]);
      vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    }
    if (vol < 0) for (const i of members) tri[i].reverse();
    if (Math.abs(vol) < 1e-12) return { error: 'a closed part of the mesh has no volume.' };
    parts.push(members);
  }
  const tris: number[] = [];
  for (const m of parts) for (const i of m) for (const p of tri[i]) tris.push(pts[p * 3], pts[p * 3 + 1], pts[p * 3 + 2]);
  return { tris, parts: parts.map((m) => m.length) };
}

export function writeBinarySTL(tris: number[]): Uint8Array {
  const n = tris.length / 9;
  const out = new Uint8Array(84 + n * 50);
  const dv = new DataView(out.buffer);
  dv.setUint32(80, n, true);
  for (let i = 0; i < n; i++) {
    const t = tris.slice(i * 9, i * 9 + 9);
    const u = [t[3] - t[0], t[4] - t[1], t[5] - t[2]], w = [t[6] - t[0], t[7] - t[1], t[8] - t[2]];
    const nr = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const l = Math.hypot(...nr) || 1;
    const o = 84 + i * 50;
    nr.forEach((x, k) => dv.setFloat32(o + k * 4, x / l, true));
    t.forEach((x, k) => dv.setFloat32(o + 12 + k * 4, x, true));
  }
  return out;
}

/** The binary STL of one body, out of the stored STL of all of them. */
export function stlPart(all: Uint8Array, parts: number[], index: number): Uint8Array {
  const start = parts.slice(0, index).reduce((a, b) => a + b, 0);
  const n = parts[index];
  const out = new Uint8Array(84 + n * 50);
  new DataView(out.buffer).setUint32(80, n, true);
  out.set(all.subarray(84 + start * 50, 84 + (start + n) * 50), 84);
  return out;
}

/* ---------- bytes ---------- */

function latin1(b: Uint8Array) {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
}

export function toBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The files in a zip (stored or deflated), by name. */
async function unzip(bytes: Uint8Array): Promise<Record<string, Uint8Array> | { error: string }> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // the end-of-central-directory record, searched from the end
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) return { error: 'the 3MF is not a valid zip package.' };
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out: Record<string, Uint8Array> = {};
  for (let k = 0; k < count; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) return { error: 'the 3MF zip directory is damaged.' };
    const method = dv.getUint16(p + 10, true);
    const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!/\.model$/i.test(name)) continue;
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const raw = bytes.subarray(start, start + size);
    if (method === 0) out[name] = raw;
    else if (method === 8) {
      const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      out[name] = new Uint8Array(await new Response(stream).arrayBuffer());
    } else return { error: `the 3MF uses a zip compression this app cannot read (method ${method}).` };
  }
  return out;
}
