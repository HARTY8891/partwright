/// <reference lib="webworker" />
// Geometry kernel worker: replays the feature history on OpenCascade (via replicad)
// and returns meshes + per-feature status. Runs off the UI thread.
import { expose, transfer } from 'comlink';
import opencascade from 'replicad-opencascadejs';
import wasmUrl from 'replicad-opencascadejs/wasm?url';
import { DistanceQuery, makeBox, makeHelix, makeVertex, draw, drawCircle, drawRectangle, EdgeFinder, genericSweep, importSTEP, deserializeShape, makePolygon, makeSolid, getOC, cast, FaceFinder, measureArea, measureShapeVolumeProperties, measureVolume, Plane, setOC, type Drawing, type Shape3D } from 'replicad';
import type { EdgeRef, FeatureDraft, HelixFeature, PartDocument, PatternAxis, RibFeature, SketchFeature } from '../model/types';
import { isSeedType } from '../model/types';
import { frameForSketch, planeById, planeFrame, add, cross, dot, neg, scale, toWorld, sub, type Vec3 } from '../model/planes';
import { edgeLabel, edgePoint, extrudeExtent, facePointWorld, faceFrame, faceLabel, getSketchFeature, pointOf, THROUGH_ALL, vertexDepth, vertexLabel } from '../model/refs';
import { nestLoops, sketchLoops, sketchPath, type Loop } from './profile';
import { axisLine, resolveAxis } from '../model/axes';
import { holeProfile } from '../model/holes';
import { helixGeom } from '../model/helix';
import { fromBase64, parseSTL, stlPart } from '../model/importFormats';

export interface FeatureStatus {
  id: string;
  status: 'ok' | 'warning' | 'error';
  message?: string;
  /** time to build this feature, ms (from when it was last actually built) */
  ms?: number;
  /** reused from the rebuild cache this time */
  cached?: boolean;
}
export interface MeshData {
  vertices: Float32Array;
  normals: Float32Array;
  triangles: Uint32Array;
  edges: Float32Array;
  /** per model edge: first vertex index into `edges` (xyz triples) and vertex count */
  edgeGroups: Uint32Array;
  /** per model face: first index into `triangles` and index count */
  faceGroups: Uint32Array;
  /** per model face: id of the coloured feature whose solid it lies on ('' = none); only when a feature has a colour */
  faceOwners?: string[];
}
export interface RebuildResult {
  ms: number;
  statuses: FeatureStatus[];
  mesh: MeshData | null;
  /** mm³, for mass properties and tests */
  volume: number;
}

let ready: Promise<void> | null = null;
function init() {
  ready ??= opencascade({ locateFile: () => wasmUrl }).then((oc) => setOC(oc));
  return ready;
}

let lastBody: Shape3D | null = null;

/* ---------- sketch -> drawing ---------- */

function loopDrawing(loop: Loop): Drawing {
  if (loop.kind === 'circle') return drawCircle(loop.radius).translate(loop.center.x, loop.center.y);
  let pen = draw([loop.start.x, loop.start.y]);
  loop.steps.forEach((s, i) => {
    if (i === loop.steps.length - 1 && s.kind === 'line') return; // close() draws the last line
    if (s.kind === 'line') pen = pen.lineTo([s.to.x, s.to.y]);
    else if (s.kind === 'arc') pen = pen.threePointsArcTo([s.to.x, s.to.y], [s.mid.x, s.mid.y]);
    else for (const sp of s.spans) pen = pen.cubicBezierCurveTo([sp.p3.x, sp.p3.y], [sp.c1.x, sp.c1.y], [sp.c2.x, sp.c2.y]);
  });
  return pen.close();
}

function profileDrawing(sk: SketchFeature): Drawing {
  const { loops, error } = sketchLoops(sk.sketch);
  if (error) throw new Error(error);
  let result: Drawing | null = null;
  for (const g of nestLoops(loops)) {
    let d = loopDrawing(g.outer);
    for (const h of g.holes) d = d.cut(loopDrawing(h));
    result = result ? result.fuse(d) : d;
  }
  return result!;
}

function planeFor(doc: PartDocument, sk: SketchFeature, offset = 0): Plane {
  const f = frameForSketch(doc, sk.id);
  if (!f) throw new Error('The face or plane this sketch is on no longer exists.');
  return new Plane(add(f.origin, scale(f.normal, offset)), f.xDir, f.normal);
}

function sketchOf(doc: PartDocument, id: string): SketchFeature {
  const sk = getSketchFeature(doc, id);
  if (!sk) throw new Error('The sketch this feature uses is missing.');
  return sk;
}

/* ---------- features ---------- */

/** A feature's own solid and whether it adds or removes material. */
type Tool = { solid: Shape3D; cut: boolean };

function combine(body: Shape3D | null, tool: Shape3D, cut: boolean, strict = true): Shape3D {
  if (cut) {
    if (!body) throw new Error('There is no solid to cut yet. Make a solid first.');
    const before = measureVolume(body);
    const result = body.cut(tool) as Shape3D;
    if (strict && Math.abs(measureVolume(result) - before) < 1e-6 * Math.max(1, before))
      throw new Error('The cut does not touch the solid. Move the sketch or change the direction.');
    return result;
  }
  return body ? (body.fuse(tool) as Shape3D) : tool;
}

function findEdges(doc: PartDocument, body: Shape3D, refs: EdgeRef[]) {
  if (!refs.length) throw new Error('Pick at least one edge.');
  const pts: Vec3[] = [];
  for (const [i, r] of refs.entries()) {
    const p = edgePoint(doc, r);
    const found = p && new EdgeFinder().near(p, 1e-4).find(body).length > 0;
    // "Edge N" is the position in the feature's edge list, so Re-pick can drop exactly that one
    if (!p || !found) throw new Error(`Edge ${i + 1} (${edgeLabel(doc, r)}) no longer exists. Re-pick it or remove it from the list.`);
    pts.push(p);
  }
  return new EdgeFinder().either(pts.map((p) => (f: EdgeFinder) => f.near(p, 1e-4)));
}

const AXES: Record<PatternAxis, Vec3> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

function toolOf(doc: PartDocument, f: FeatureDraft): Tool {
  switch (f.type) {
    case 'extrude':
    case 'cutExtrude': {
      const sk = sketchOf(doc, f.sketchId);
      let vd: number | undefined;
      if (f.direction1.type === 'upToVertex') {
        if (!f.direction1.vertex) throw new Error('Click a corner of the model to extrude up to.');
        const d = vertexDepth(doc, f);
        if (d === undefined) throw new Error(`${vertexLabel(doc, f.direction1.vertex)} no longer exists. Pick the corner again.`);
        if (Math.abs(d) < 1e-6) throw new Error('That corner is on the sketch plane. Pick another corner.');
        if (d < 0) throw new Error('That corner is behind the sketch. Reverse the direction or pick another corner.');
        vd = d;
      }
      if (f.direction1.type !== 'throughAll' && f.direction1.type !== 'throughAllBoth' && f.direction1.type !== 'upToVertex' && !(f.direction1.depth.value > 0))
        throw new Error('Depth must be more than zero.');
      if (f.direction2 && !(f.direction2.depth.value > 0)) throw new Error('The second depth must be more than zero.');
      const [a, b] = extrudeExtent(vd === undefined ? f : { ...f, direction1: { type: 'blind', depth: { expr: String(vd), value: vd } } });
      let drawing = profileDrawing(sk);
      if (f.thin) {
        const t = f.thin.thickness.value;
        if (!(t > 0)) throw new Error('The wall thickness must be more than zero.');
        try {
          const grow = (d: number) => (d === 0 ? drawing : drawing.offset(d));
          const [outer, inner] = f.thin.side === 'outside' ? [t, 0] : f.thin.side === 'inside' ? [0, -t] : [t / 2, -t / 2];
          drawing = grow(outer).cut(grow(inner));
        } catch {
          throw new Error('The thin wall could not be built. Try a thinner wall.');
        }
      }
      let solid = drawing.sketchOnPlane(planeFor(doc, sk, a)).extrude(b - a) as Shape3D;
      if (f.draft && f.draft.angle.value !== 0) {
        const ang = f.draft.angle.value;
        if (f.direction1.type === 'throughAll' || f.direction1.type === 'throughAllBoth')
          throw new Error('A draft needs an end: use a fixed depth, up to a face or up to a corner.');
        if (!(Math.abs(ang) < 89)) throw new Error('The draft angle must be less than 89 degrees.');
        // neutral plane: the sketch plane, its normal pointing the way the extrude goes
        const frame = frameForSketch(doc, sk.id)!;
        const dir = b > -a ? frame.normal : neg(frame.normal);
        const neutral = new Plane(frame.origin, frame.xDir, dir);
        try {
          solid = solid.draft(f.draft.outward ? -ang : ang, (ff) => ff.not((x) => x.parallelTo(neutral)), neutral);
        } catch {
          throw new Error('The draft could not be applied. Drafts work on straight and round sides; try a smaller angle.');
        }
      }
      if (f.direction1.type === 'upToFace') {
        if (!f.direction1.face) throw new Error('Click the flat face to extrude up to.');
        const ff = faceFrame(doc, f.direction1.face);
        if (!ff) throw new Error(`${faceLabel(doc, f.direction1.face)} no longer exists. Pick the face again.`);
        // a huge block on the far side of the face's plane (away from the sketch) is cut off
        const skf = frameForSketch(doc, sk.id)!;
        const away = dot(sub(ff.origin, skf.origin), ff.normal) >= 0 ? ff.normal : neg(ff.normal);
        const plane = new Plane(ff.origin, ff.xDir, away);
        const block = drawRectangle(4 * THROUGH_ALL, 4 * THROUGH_ALL).sketchOnPlane(plane).extrude(THROUGH_ALL) as Shape3D;
        solid = solid.cut(block) as Shape3D;
        if (measureVolume(solid) < 1e-9) throw new Error('The face is behind the sketch. Reverse the direction or pick another face.');
      }
      return { solid, cut: f.type === 'cutExtrude' };
    }
    case 'revolve':
    case 'cutRevolve': {
      const sk = sketchOf(doc, f.sketchId);
      const frame = frameForSketch(doc, sk.id)!;
      let p1: Vec3, p2: Vec3;
      if (!f.axisId) {
        const axis = sk.sketch.entities.find((e) => e.id === f.axisLineId);
        if (!axis || axis.kind !== 'line') throw new Error('Pick a centerline in the sketch as the axis.');
        p1 = toWorld(frame, pointOf(sk.sketch, axis.p1));
        p2 = toWorld(frame, pointOf(sk.sketch, axis.p2));
      } else {
        const ax = axisLine(doc, f.axisId);
        if (!ax) throw new Error('The reference axis no longer exists. Pick another axis.');
        if (Math.abs(dot(ax.dir, frame.normal)) > 1e-6) throw new Error('The reference axis must lie in the sketch plane.');
        p1 = ax.origin;
        p2 = add(ax.origin, ax.dir);
      }
      const angle = f.angle.value;
      if (!(angle > 0 && angle <= 360)) throw new Error('The angle must be between 0 and 360 degrees.');
      const solid = profileDrawing(sk)
        .sketchOnPlane(planeFor(doc, sk))
        .revolve(sub(p2, p1), { origin: p1, angle: f.reverse ? -angle : angle }) as Shape3D;
      return { solid, cut: f.type === 'cutRevolve' };
    }
    case 'hole': {
      if (!f.at) throw new Error('Click a flat face to place the hole.');
      const frame = faceFrame(doc, f.at.face);
      if (!frame) throw new Error(`${faceLabel(doc, f.at.face)} no longer exists. Edit the hole and place it again.`);
      const depth = f.end.type === 'throughAll' ? THROUGH_ALL : f.end.depth.value;
      const prof = holeProfile(
        f.kind ?? 'simple',
        f.diameter.value,
        depth,
        f.cbore && { d: f.cbore.diameter.value, depth: f.cbore.depth.value },
        f.csink && { d: f.csink.diameter.value, angle: f.csink.angle.value },
      );
      if ('error' in prof) throw new Error(prof.error);
      const centre = toWorld(frame, f.at.at);
      // drill into the material, against the face's outward normal: the cross-section
      // (radius, depth) lies in a plane through the axis and is turned about it
      const down = neg(frame.normal);
      const plane = new Plane(centre, frame.xDir, cross(frame.xDir, down));
      let pen = draw(prof[0]);
      for (const p of prof.slice(1)) pen = pen.lineTo(p);
      const solid = pen.close().sketchOnPlane(plane).revolve(down, { origin: centre }) as Shape3D;
      return { solid, cut: true };
    }
    case 'loft': {
      if (f.sketchIds.length < 2) throw new Error('Tick at least two sketches to loft between.');
      const sketches = f.sketchIds.map((id) => {
        const sk = sketchOf(doc, id);
        const { loops, error } = sketchLoops(sk.sketch);
        if (error) throw new Error(`${sk.name}: ${error}`);
        if (loops.length !== 1) throw new Error(`${sk.name} must be one closed outline (no holes) to loft.`);
        return loopDrawing(loops[0]).sketchOnPlane(planeFor(doc, sk));
      });
      try {
        const [first, ...rest] = sketches as unknown as { loftWith(o: unknown[], c: { ruled: boolean }): Shape3D }[];
        return { solid: first.loftWith(rest, { ruled: f.ruled }), cut: false };
      } catch {
        throw new Error('The loft could not be built. Check the outlines are in order and do not cross.');
      }
    }
    case 'sweep': {
      const prof = sketchOf(doc, f.profileId);
      const helixPath = doc.features.find((x): x is HelixFeature => x.id === f.pathId && x.type === 'helix');
      const path = helixPath ?? sketchOf(doc, f.pathId);
      if (prof.id === path.id) throw new Error('The profile and the path must be different sketches.');
      const { loops, error } = sketchLoops(prof.sketch);
      if (error) throw new Error(`${prof.name}: ${error}`);
      if (loops.length !== 1) throw new Error(`${prof.name} must be one closed outline (no holes) to sweep.`);
      if (path.type !== 'helix' && path.type !== 'sketch') throw new Error('The path must be a sketch or a helix.');
      let spine: { wire: Parameters<typeof genericSweep>[1] };
      if (path.type === 'helix') spine = { wire: helixWire(doc, path) as unknown as Parameters<typeof genericSweep>[1] };
      else {
        const chain = sketchPath(path.sketch);
        if ('error' in chain) throw new Error(`${path.name}: ${chain.error}`);
        let pen = draw([chain.start.x, chain.start.y]);
        for (const s of chain.steps) {
          if (s.kind === 'line') pen = pen.lineTo([s.to.x, s.to.y]);
          else if (s.kind === 'arc') pen = pen.threePointsArcTo([s.to.x, s.to.y], [s.mid.x, s.mid.y]);
          else for (const sp of s.spans) pen = pen.cubicBezierCurveTo([sp.p3.x, sp.p3.y], [sp.c1.x, sp.c1.y], [sp.c2.x, sp.c2.y]);
        }
        spine = (chain.closed ? pen.close() : pen.done()).sketchOnPlane(planeFor(doc, path)) as unknown as { wire: Parameters<typeof genericSweep>[1] };
      }
      const profile = loopDrawing(loops[0]).sketchOnPlane(planeFor(doc, prof)) as unknown as { wire: Parameters<typeof genericSweep>[0] };
      try {
        return { solid: genericSweep(profile.wire, spine.wire, { frenet: true }) as Shape3D, cut: false };
      } catch {
        throw new Error('The sweep could not be built. Put the profile at the start of the path, square to it.');
      }
    }
    default:
      throw new Error('This feature cannot be repeated.');
  }
}

/** Tools of the seed features of a pattern or mirror. */
function seedTools(doc: PartDocument, seeds: string[]): Tool[] {
  if (!seeds.length) throw new Error('Pick at least one feature to repeat.');
  return seeds.map((id) => {
    const s = doc.features.find((x) => x.id === id);
    if (!s || !isSeedType(s.type)) throw new Error('A feature to repeat is missing.');
    if (s.suppressed) throw new Error(`${s.name} is suppressed.`);
    return toolOf(doc, s as FeatureDraft);
  });
}

function apply(doc: PartDocument, body: Shape3D | null, f: FeatureDraft): Shape3D | null {
  switch (f.type) {
    case 'plane':
    case 'axis':
      return body;
    case 'helix': {
      const g = helixGeom(doc, f);
      if ('error' in g) throw new Error(g.error);
      return body;
    }
    case 'rib':
      return combine(body, ribSolid(doc, body, f), false);
    case 'import': {
      const shape = imported.get(importKey(f));
      if (!shape) throw new Error(`${f.fileName} could not be turned into a solid${importErrors.has(importKey(f)) ? ` (${importErrors.get(importKey(f))})` : ''}.`);
      return combine(body, shape.clone() as Shape3D, false);
    }
    case 'extrude':
    case 'cutExtrude':
    case 'revolve':
    case 'cutRevolve':
    case 'hole':
    case 'loft':
    case 'sweep': {
      const t = toolOf(doc, f);
      return combine(body, t.solid, t.cut);
    }
    case 'fillet':
    case 'chamfer': {
      if (!body) throw new Error('There is no solid yet.');
      const size = f.size.value;
      if (!(size > 0)) throw new Error(`${f.type === 'fillet' ? 'Radius' : 'Distance'} must be more than zero.`);
      const filter = findEdges(doc, body, f.edges);
      try {
        if (f.type === 'fillet' && f.size2) {
          if (!(f.size2.value > 0)) throw new Error('The end radius must be more than zero.');
          return body.fillet({ filter, radius: [size, f.size2.value] });
        }
        return f.type === 'fillet' ? body.fillet({ filter, radius: size }) : body.chamfer({ filter, radius: size });
      } catch {
        throw new Error(`The ${f.type} could not be built. The size is probably too large for these edges.`);
      }
    }
    case 'shell': {
      if (!body) throw new Error('There is no solid to shell yet.');
      const t = f.thickness.value;
      if (!(t > 0)) throw new Error('The wall thickness must be more than zero.');
      if (!f.faces.length) throw new Error('Click at least one face to remove (the opening).');
      const pts = f.faces.map((fp, i) => {
        const p = facePointWorld(doc, fp);
        if (!p) throw new Error(`Face ${i + 1} (${faceLabel(doc, fp.face)}) no longer exists. Re-pick it or remove it from the list.`);
        return p;
      });
      const filter = new FaceFinder().either(pts.map((p) => (q: FaceFinder) => q.near(p, 1e-3)));
      try {
        // replicad: a positive thickness keeps the outside and grows the wall inward
        return body.shell({ filter, thickness: t });
      } catch {
        throw new Error('The shell could not be built. The wall is probably too thick for this shape.');
      }
    }
    case 'linearPattern':
    case 'circularPattern': {
      if (!body) throw new Error('There is no solid yet.');
      const n = Math.round(f.count);
      if (!(n >= 2 && n <= 200)) throw new Error('The count must be between 2 and 200.');
      const tools = seedTools(doc, f.seeds);
      let axis = AXES[f.axis];
      let centre: Vec3 = [0, 0, 0];
      if (f.axisId) {
        const ax = axisLine(doc, f.axisId);
        if (!ax) throw new Error('The reference axis no longer exists. Pick another axis.');
        axis = ax.dir;
        centre = ax.origin;
      }
      const s = f.reverse ? -1 : 1;
      let out: Shape3D = body;
      for (let i = 1; i < n; i++) {
        for (const t of tools) {
          let copy: Shape3D;
          if (f.type === 'linearPattern') {
            if (!(f.spacing.value > 0)) throw new Error('The spacing must be more than zero.');
            copy = t.solid.clone().translate(scale(axis, s * f.spacing.value * i)) as Shape3D;
          } else {
            const total = f.spacing.value;
            if (!(total > 0 && total <= 360)) throw new Error('The angle must be between 0 and 360 degrees.');
            const step = total >= 360 ? total / n : total / (n - 1);
            copy = t.solid.clone().rotate(s * step * i, centre, axis) as Shape3D;
          }
          out = combine(out, copy, t.cut, false);
        }
      }
      return out;
    }
    case 'mirror': {
      if (!body) throw new Error('There is no solid yet.');
      const pl = planeById(doc, f.planeId);
      const frame = pl && planeFrame(doc, pl);
      if (!frame) throw new Error('The mirror plane no longer exists.');
      let out: Shape3D = body;
      for (const t of seedTools(doc, f.seeds)) out = combine(out, t.solid.clone().mirror(frame.normal, frame.origin) as Shape3D, t.cut, false);
      return out;
    }
  }
}

/* ---------- imported STEP solids ---------- */

/** file hash -> solid. Reading files is asynchronous, so it happens before the rebuild. */
const imported = new Map<string, Shape3D>();
const importErrors = new Map<string, string>();
const importKey = (f: { step: string; format?: string }) => (f.format ?? 'step') + fnv(f.step).toString(36);

/** One closed body of a mesh as a solid: a face per triangle, sewn, then flat neighbours merged. */
function meshSolid(stl: Uint8Array): Shape3D {
  const m = parseSTL(stl);
  if ('error' in m) throw new Error(m.error);
  const t = m.tris;
  const faces = [];
  for (let i = 0; i < t.length; i += 9) faces.push(makePolygon([[t[i], t[i + 1], t[i + 2]], [t[i + 3], t[i + 4], t[i + 5]], [t[i + 6], t[i + 7], t[i + 8]]]));
  const solid = makeSolid(faces);
  for (const fc of faces) fc.delete();
  const oc = getOC();
  const unify = new oc.ShapeUpgrade_UnifySameDomain(solid.wrapped, true, true, false);
  unify.Build();
  const merged = cast(unify.Shape()) as Shape3D;
  unify.delete();
  solid.delete();
  if (!(measureVolume(merged) > 0)) throw new Error('a mesh body did not close into a solid');
  return merged;
}

async function readImport(f: Extract<FeatureDraft, { type: 'import' }>): Promise<Shape3D> {
  if (f.format === 'brep') return deserializeShape(f.step) as Shape3D;
  if (f.format === 'stl') {
    const all = fromBase64(f.step);
    const parts = f.parts ?? [(all.length - 84) / 50];
    let body: Shape3D | null = null;
    for (let i = 0; i < parts.length; i++) {
      const piece = meshSolid(stlPart(all, parts, i));
      body = body ? (body.fuse(piece) as Shape3D) : piece;
    }
    if (!body) throw new Error('empty mesh');
    return body;
  }
  return (await importSTEP(new Blob([f.step]))) as Shape3D;
}

async function loadImports(doc: PartDocument, extra?: FeatureDraft) {
  const steps = [...doc.features, ...(extra ? [extra] : [])].filter((f): f is Extract<FeatureDraft, { type: 'import' }> => f.type === 'import');
  for (const f of steps) {
    const key = importKey(f);
    if (imported.has(key)) continue;
    try {
      imported.set(key, await readImport(f));
    } catch (e) {
      importErrors.set(key, e instanceof Error ? e.message : String(e)); // reported by apply()
    }
  }
}

/* ---------- rebuild cache ---------- */

/**
 * The solid after each feature, keyed by a hash of every feature up to and
 * including it. A change to feature N leaves features 0..N-1 cached, so a rebuild
 * only redoes the history from the first changed feature on.
 */
type Cached = { body: Shape3D | null; status: FeatureStatus };
const cache = new Map<string, Cached>();
const CACHE_LIMIT = 400;

function fnv(s: string, h = 0x811c9dc5): number {
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

function trimCache(keep: Shape3D | null, force = false) {
  if (!force && cache.size <= CACHE_LIMIT) return;
  // free the WASM memory of every cached solid except the one in use
  const bodies = new Set<Shape3D>();
  for (const c of cache.values()) if (c.body && c.body !== keep) bodies.add(c.body);
  cache.clear();
  for (const b of bodies) {
    try {
      b.delete();
    } catch {
      /* already freed */
    }
  }
}

function replay(doc: PartDocument, extra?: FeatureDraft) {
  const statuses: FeatureStatus[] = [];
  let body: Shape3D | null = null;
  let key = 0x811c9dc5;
  for (const f of doc.features.slice(0, doc.rollbackIndex)) {
    key = fnv(JSON.stringify({ ...f, color: undefined }), key);
    const k = key.toString(36);
    const hit = cache.get(k);
    if (hit) {
      body = hit.body;
      if (hit.status.id) statuses.push({ ...hit.status, cached: true });
      continue;
    }
    const t0 = performance.now();
    let status: FeatureStatus = { id: '', status: 'ok' };
    if (f.suppressed) {
      // nothing to build
    } else if (f.type === 'plane') {
      if (f.def.type === 'offset') status = planeFrame(doc, f) ? { id: f.id, status: 'ok' } : { id: f.id, status: 'error', message: 'The plane or face this plane is offset from no longer exists.' };
    } else if (f.type === 'axis') {
      const r = resolveAxis(doc, f.def);
      status = 'error' in r ? { id: f.id, status: 'error', message: r.error } : { id: f.id, status: 'ok' };
    } else if (f.type === 'sketch') {
      status = frameForSketch(doc, f.id) ? { id: f.id, status: 'ok' } : { id: f.id, status: 'error', message: 'The face this sketch was on no longer exists.' };
    } else {
      try {
        body = apply(doc, body, f);
        status = { id: f.id, status: 'ok' };
      } catch (e) {
        status = { id: f.id, status: 'error', message: messageOf(e) };
      }
    }
    if (status.id) status.ms = Math.round((performance.now() - t0) * 10) / 10;
    cache.set(k, { body, status });
    if (status.id) statuses.push(status);
  }
  let extraError: string | undefined;
  if (extra) {
    try {
      body = apply(doc, body, extra);
    } catch (e) {
      extraError = messageOf(e);
    }
  }
  trimCache(body);
  return { body, statuses, extraError };
}

/**
 * Which coloured feature made each face: a point on the face (the centre of its
 * biggest triangle) lying on the boundary of that feature's own solid. The
 * latest feature wins, as later features cut into or build over earlier ones.
 */
function faceOwners(doc: PartDocument, mesh: MeshData): string[] | undefined {
  const coloured = doc.features
    .slice(0, doc.rollbackIndex)
    .filter((f) => f.color && !f.suppressed && isSeedType(f.type))
    .reverse();
  if (!coloured.length) return undefined;
  const v = mesh.vertices, t = mesh.triangles;
  const P = (i: number): Vec3 => [v[i * 3], v[i * 3 + 1], v[i * 3 + 2]];
  const samples: Vec3[] = [];
  for (let k = 0; k < mesh.faceGroups.length; k += 2) {
    const start = mesh.faceGroups[k], count = mesh.faceGroups[k + 1];
    let best: Vec3 = [NaN, NaN, NaN], area = -1;
    for (let j = start; j + 2 < start + count; j += 3) {
      const a = P(t[j]), b = P(t[j + 1]), c = P(t[j + 2]);
      const n = cross(sub(b, a), sub(c, a));
      const ar = dot(n, n);
      if (ar > area) (area = ar), (best = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3]);
    }
    samples.push(best);
  }
  const owners = samples.map(() => '');
  for (const f of coloured) {
    let tool: Shape3D;
    try {
      tool = toolOf(doc, f as FeatureDraft).solid;
    } catch {
      continue;
    }
    const queries = tool.faces.map((face) => new DistanceQuery(face));
    samples.forEach((p, i) => {
      if (owners[i] || Number.isNaN(p[0])) return;
      const vx = makeVertex(p);
      if (queries.some((q) => q.distanceTo(vx) < 0.06)) owners[i] = f.id;
      vx.delete();
    });
    for (const q of queries) q.delete();
  }
  return owners;
}

/** A helix as a wire, turned so it starts where the viewport draws it (the circle's +x point). */
function helixWire(doc: PartDocument, f: HelixFeature) {
  const g = helixGeom(doc, f);
  if ('error' in g) throw new Error(g.error);
  let w = makeHelix(g.pitch, g.pitch * g.turns, g.radius, g.centre, g.dir, g.leftHand);
  const sp = w.startPoint;
  const a = sub([sp.x, sp.y, sp.z], g.centre);
  const turn = Math.atan2(dot(cross(a, g.xDir), g.dir), dot(a, g.xDir));
  if (Math.abs(turn) > 1e-9) w = w.rotate((turn * 180) / Math.PI, g.centre, g.dir);
  return w;
}

/**
 * A rib: the open line in the sketch, grown sideways (in the sketch plane) far
 * enough to reach the part, `thickness` thick about the sketch plane, then cut
 * back to the part's bounding box so it stops at the walls it meets.
 */
function ribSolid(doc: PartDocument, body: Shape3D | null, f: Pick<RibFeature, 'sketchId' | 'thickness' | 'flip'>): Shape3D {
  if (!body) throw new Error('A rib needs a solid to grow into. Make a solid first.');
  const sk = sketchOf(doc, f.sketchId);
  const t = f.thickness.value;
  if (!(t > 0)) throw new Error('The rib thickness must be more than zero.');
  const chain = sketchPath(sk.sketch);
  if ('error' in chain) throw new Error(`${sk.name}: ${chain.error}`);
  if (chain.closed) throw new Error(`${sk.name}: a rib is drawn as an open line, not a closed outline.`);
  const pts = [chain.start, ...chain.steps.map((s) => s.to)];
  const a = pts[0], b = pts[pts.length - 1];
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 1e-9) throw new Error(`${sk.name}: the rib line has no length.`);
  // sideways, square to the line from its start to its end; towards the part unless flipped
  let n = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
  const frame = frameForSketch(doc, sk.id)!;
  const com = measureShapeVolumeProperties(body).centerOfMass as unknown as Vec3;
  const rel = sub(com, frame.origin);
  const c = { x: dot(rel, frame.xDir), y: dot(rel, frame.yDir) };
  if ((c.x - a.x) * n.x + (c.y - a.y) * n.y < 0) n = { x: -n.x, y: -n.y };
  if (f.flip) n = { x: -n.x, y: -n.y };
  const far = 4 * THROUGH_ALL;
  let pen = draw([a.x, a.y]);
  for (const s of chain.steps) {
    if (s.kind === 'line') pen = pen.lineTo([s.to.x, s.to.y]);
    else if (s.kind === 'arc') pen = pen.threePointsArcTo([s.to.x, s.to.y], [s.mid.x, s.mid.y]);
    else for (const sp of s.spans) pen = pen.cubicBezierCurveTo([sp.p3.x, sp.p3.y], [sp.c1.x, sp.c1.y], [sp.c2.x, sp.c2.y]);
  }
  pen = pen.lineTo([b.x + n.x * far, b.y + n.y * far]).lineTo([a.x + n.x * far, a.y + n.y * far]);
  const slab = pen.close().sketchOnPlane(planeFor(doc, sk, -t / 2)).extrude(t) as Shape3D;
  const [lo, hi] = body.boundingBox.bounds;
  const rib = slab.intersect(makeBox(lo, hi)) as Shape3D;
  if (measureVolume(rib) < 1e-9) throw new Error('The rib does not reach the part. Flip its side or move the line.');
  return rib;
}

function meshOf(body: Shape3D | null): MeshData | null {
  if (!body) return null;
  const m = body.mesh({ tolerance: 0.05, angularTolerance: 15 });
  const e = body.meshEdges({ tolerance: 0.05, angularTolerance: 15 });
  return {
    vertices: new Float32Array(m.vertices),
    normals: new Float32Array(m.normals),
    triangles: new Uint32Array(m.triangles),
    edges: new Float32Array(e.lines),
    edgeGroups: new Uint32Array(e.edgeGroups.flatMap((g) => [g.start, g.count])),
    faceGroups: new Uint32Array(m.faceGroups.flatMap((g) => [g.start, g.count])),
  };
}

const transferables = (m: MeshData | null) =>
  m ? [m.vertices.buffer, m.normals.buffer, m.triangles.buffer, m.edges.buffer, m.edgeGroups.buffer, m.faceGroups.buffer] : [];

function messageOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'number') return 'The geometry kernel could not build this feature.';
  return String(e);
}

const api = {
  async init() {
    await init();
    return true;
  },
  async rebuild(doc: PartDocument): Promise<RebuildResult> {
    await init();
    await loadImports(doc);
    const t0 = performance.now();
    const { body, statuses } = replay(doc);
    lastBody = body;
    const mesh = meshOf(body);
    if (mesh) mesh.faceOwners = faceOwners(doc, mesh);
    const volume = body ? measureVolume(body) : 0;
    const res: RebuildResult = { ms: Math.round(performance.now() - t0), statuses, mesh, volume };
    return transfer(res, transferables(mesh));
  },
  async preview(doc: PartDocument, draft: FeatureDraft): Promise<{ mesh: MeshData | null; error?: string }> {
    await init();
    await loadImports(doc, draft);
    const { body, extraError } = replay(doc, draft);
    if (extraError) return { mesh: null, error: extraError };
    const mesh = meshOf(body);
    return transfer({ mesh }, transferables(mesh));
  },
  async massProps(): Promise<{ volume: number; area: number; centre: [number, number, number] } | null> {
    await init();
    if (!lastBody) return null;
    const p = measureShapeVolumeProperties(lastBody);
    return { volume: p.volume, area: measureArea(lastBody), centre: p.centerOfMass };
  },
  /** Test hook: drop every cached solid so the next rebuild starts from scratch. */
  async clearCache() {
    trimCache(lastBody, true);
    return true;
  },
  async exportFile(format: 'stl' | 'step'): Promise<ArrayBuffer | null> {
    await init();
    if (!lastBody) return null;
    const blob = format === 'stl' ? lastBody.blobSTL({ tolerance: 0.01, angularTolerance: 5, binary: true }) : lastBody.blobSTEP();
    const buf = await blob.arrayBuffer();
    return transfer(buf, [buf]);
  },
};

export type KernelApi = typeof api;
expose(api);
