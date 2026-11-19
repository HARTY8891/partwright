// 3MF export (the 3D-printing format): an OPC zip with the mesh in
// 3D/3dmodel.model, in millimetres. Written by hand: a zip "store" archive
// (no compression) is a few dozen lines and avoids a dependency.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A zip archive with stored (uncompressed) entries. */
export function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // version needed
    local.setUint16(8, 0, true); // stored
    local.setUint32(14, crc, true);
    local.setUint32(18, f.data.length, true);
    local.setUint32(22, f.data.length, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, f.data);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, 20, true);
    cen.setUint16(6, 20, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, f.data.length, true);
    cen.setUint32(24, f.data.length, true);
    cen.setUint16(28, name.length, true);
    cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), name);
    offset += 30 + name.length + f.data.length;
  }
  const cenSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cenSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) out.set(p, at), (at += p.length);
  return out;
}

/** 3MF from an indexed triangle mesh (positions in mm). Vertices are welded so the mesh is watertight. */
export function make3MF(vertices: ArrayLike<number>, triangles: ArrayLike<number>, name: string): Uint8Array {
  // weld vertices that the mesher duplicated per face
  const key = (i: number) => `${vertices[i * 3].toFixed(5)},${vertices[i * 3 + 1].toFixed(5)},${vertices[i * 3 + 2].toFixed(5)}`;
  const map = new Map<string, number>();
  const remap: number[] = [];
  const verts: string[] = [];
  for (let i = 0; i < vertices.length / 3; i++) {
    const k = key(i);
    let j = map.get(k);
    if (j === undefined) {
      j = verts.length;
      map.set(k, j);
      verts.push(`<vertex x="${+vertices[i * 3].toFixed(5)}" y="${+vertices[i * 3 + 1].toFixed(5)}" z="${+vertices[i * 3 + 2].toFixed(5)}"/>`);
    }
    remap[i] = j;
  }
  const tris: string[] = [];
  for (let t = 0; t < triangles.length; t += 3) {
    const a = remap[triangles[t]], b = remap[triangles[t + 1]], c = remap[triangles[t + 2]];
    if (a !== b && b !== c && a !== c) tris.push(`<triangle v1="${a}" v2="${b}" v3="${c}"/>`);
  }
  const esc = (s: string) => s.replace(/[<>&"]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[ch]!);
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<metadata name="Title">${esc(name)}</metadata>
<metadata name="Application">Partwright</metadata>
<resources><object id="1" type="model" name="${esc(name)}"><mesh><vertices>${verts.join('')}</vertices><triangles>${tris.join('')}</triangles></mesh></object></resources>
<build><item objectid="1"/></build>
</model>`;
  const types = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`;
  const enc = new TextEncoder();
  return zipStore([
    { name: '[Content_Types].xml', data: enc.encode(types) },
    { name: '_rels/.rels', data: enc.encode(rels) },
    { name: '3D/3dmodel.model', data: enc.encode(model) },
  ]);
}
