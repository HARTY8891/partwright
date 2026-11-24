// Persistent naming for faces and edges. A face or edge is named by the feature and
// sketch element that produced it (see FaceRef / EdgeRef in types.ts). Its current
// position is recomputed from the feature's parameters, so the name survives edits
// such as changing a depth or a sketch dimension. Pure: no kernel, used on both threads.

import type {
  EdgeRef, ExtrudeFeature, FaceRef, Feature, Id, PartDocument, Pt, Sketch, SketchFeature, VertexRef,
} from './types';
import { produce } from 'immer';
import { add, cross, dot, frameForSketch, makeFrame, neg, norm, scale, sub, toWorld, type Frame, type Vec3 } from './planes';
import { bezierAt, sampleSpline, splineSpans } from './spline';

/** Through-all extrudes and cuts reach this far (mm). */
export const THROUGH_ALL = 2000;

export const pointOf = (sk: Sketch, id: Id): Pt => {
  const e = sk.entities.find((q) => q.id === id);
  return e && e.kind === 'point' ? e.p : { x: 0, y: 0 };
};

/**
 * Offsets [a, b] along the sketch normal that an extrude/cut spans.
 * Extrudes grow along the normal (out of a face); cuts go against it (into the material).
 */
export function extrudeExtent(f: Pick<ExtrudeFeature, 'direction1' | 'reverse'> & { type?: ExtrudeFeature['type']; direction2?: ExtrudeFeature['direction2'] }): [number, number] {
  const d = f.direction1.depth.value;
  const s = (f.reverse ? -1 : 1) * (f.type === 'cutExtrude' ? -1 : 1);
  const d2 = f.direction2?.depth.value ?? 0;
  switch (f.direction1.type) {
    case 'blind':
      return s > 0 ? [0 - d2, d] : [-d, d2];
    case 'midPlane':
      return [-d / 2, d / 2];
    case 'throughAll':
      return s > 0 ? [0, THROUGH_ALL] : [-THROUGH_ALL, 0];
    case 'throughAllBoth':
      return [-THROUGH_ALL, THROUGH_ALL];
    case 'upToFace':
      // the far end is trimmed by the face; for naming, treat it like through-all
      return s > 0 ? [0, THROUGH_ALL] : [-THROUGH_ALL, 0];
    case 'upToVertex':
      // depth is resolved from the vertex (resolveVertexDepths)
      return s > 0 ? [0, d] : [-d, 0];
  }
}

export const getSketchFeature = (doc: PartDocument, id: Id) =>
  doc.features.find((f): f is SketchFeature => f.id === id && f.type === 'sketch');

const getExtrude = (doc: PartDocument, id: Id) =>
  doc.features.find((f): f is ExtrudeFeature => f.id === id && (f.type === 'extrude' || f.type === 'cutExtrude'));

type ArcLike = { center: Id; start: Id; end: Id; ccw: boolean };

/** Points along an arc from start to end at fractions t in [0, 1]. */
export function arcAt(sk: Sketch, arc: ArcLike, ts: number[]): Pt[] {
  const c = pointOf(sk, arc.center);
  const a = pointOf(sk, arc.start);
  const b = pointOf(sk, arc.end);
  const r = Math.hypot(a.x - c.x, a.y - c.y);
  const a0 = Math.atan2(a.y - c.y, a.x - c.x);
  let a1 = Math.atan2(b.y - c.y, b.x - c.x);
  if (arc.ccw) while (a1 <= a0) a1 += 2 * Math.PI;
  else while (a1 >= a0) a1 -= 2 * Math.PI;
  return ts.map((t) => {
    const m = a0 + (a1 - a0) * t;
    return { x: c.x + r * Math.cos(m), y: c.y + r * Math.sin(m) };
  });
}

/** Point on an arc halfway between its start and end. */
export const arcMid = (sk: Sketch, arc: ArcLike): Pt => arcAt(sk, arc, [0.5])[0];

/** Frame of a named face, or undefined if it no longer exists. */
export function faceFrame(doc: PartDocument, ref: FaceRef, depth = 0): Frame | undefined {
  const ex = getExtrude(doc, ref.featureId);
  if (!ex) return undefined;
  const base = frameForSketch(doc, ex.sketchId, depth);
  const sk = getSketchFeature(doc, ex.sketchId);
  if (!base || !sk) return undefined;
  const [a, b] = extrudeExtent(ex);
  let f: Frame;
  if (ref.kind === 'cap') {
    const off = ref.cap === 'start' ? a : b;
    const n = ref.cap === 'start' ? neg(base.normal) : base.normal;
    f = makeFrame(add(base.origin, scale(base.normal, off)), base.xDir, n);
  } else {
    const line = sk.sketch.entities.find((e) => e.id === ref.segmentId);
    if (!line || line.kind !== 'line') return undefined;
    const p1 = toWorld(base, pointOf(sk.sketch, line.p1), a);
    const p2 = toWorld(base, pointOf(sk.sketch, line.p2), a);
    const x = norm(sub(p2, p1));
    f = makeFrame(p1, x, norm(cross(x, base.normal)));
  }
  return ref.flip ? makeFrame(f.origin, f.xDir, neg(f.normal)) : f;
}

/** World position of a picked face point, or undefined if the face is gone. */
export function facePointWorld(doc: PartDocument, fp: { face: FaceRef; at: Pt }): Vec3 | undefined {
  const f = faceFrame(doc, fp.face);
  return f ? toWorld(f, fp.at) : undefined;
}

/** Where a named edge is now: a point on it (its midpoint), or undefined if it no longer exists. */
export function edgePoint(doc: PartDocument, ref: EdgeRef): Vec3 | undefined {
  const ex = getExtrude(doc, ref.featureId);
  if (!ex) return undefined;
  const base = frameForSketch(doc, ex.sketchId);
  const sk = getSketchFeature(doc, ex.sketchId);
  if (!base || !sk) return undefined;
  const [a, b] = extrudeExtent(ex);
  if (ref.kind === 'sideEdge') return toWorld(base, pointOf(sk.sketch, ref.pointId), (a + b) / 2);
  const off = ref.cap === 'start' ? a : b;
  const seg = sk.sketch.entities.find((e) => e.id === ref.segmentId);
  if (!seg) return undefined;
  if (seg.kind === 'line') {
    const p = pointOf(sk.sketch, seg.p1);
    const q = pointOf(sk.sketch, seg.p2);
    return toWorld(base, { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }, off);
  }
  if (seg.kind === 'arc') return toWorld(base, arcMid(sk.sketch, seg), off);
  if (seg.kind === 'spline') {
    const spans = splineSpans(seg.points.map((id) => pointOf(sk.sketch, id)));
    const mid = spans[Math.floor(spans.length / 2)];
    return toWorld(base, spans.length % 2 ? bezierAt(mid, 0.5) : mid.p0, off);
  }
  if (seg.kind === 'circle') {
    const c = pointOf(sk.sketch, seg.center);
    return toWorld(base, { x: c.x + seg.radius, y: c.y }, off);
  }
  return undefined;
}

/* ---------- picking: from a click on the model to a name ---------- */

const solidFeatures = (doc: PartDocument): ExtrudeFeature[] =>
  doc.features
    .slice(0, doc.rollbackIndex)
    .filter((f): f is ExtrudeFeature => !f.suppressed && (f.type === 'extrude' || f.type === 'cutExtrude'));

function polygonOf(sk: Sketch): Pt[][] {
  // closed outlines as point lists, used only for "is this point on the cap" tests
  const loops: Pt[][] = [];
  for (const e of sk.entities) {
    if (e.kind === 'circle' && !e.construction) {
      const c = pointOf(sk, e.center);
      loops.push([...Array(48).keys()].map((i) => ({ x: c.x + e.radius * Math.cos((i / 48) * 2 * Math.PI), y: c.y + e.radius * Math.sin((i / 48) * 2 * Math.PI) })));
    }
  }
  const segs = sk.entities.filter((e) => (e.kind === 'line' || e.kind === 'arc' || e.kind === 'spline') && !e.construction);
  const ends = (e: (typeof segs)[number]) =>
    e.kind === 'line' ? [e.p1, e.p2] : e.kind === 'arc' ? [e.start, e.end] : e.kind === 'spline' ? [e.points[0], e.points[e.points.length - 1]] : [];
  const used = new Set<Id>();
  for (const s0 of segs) {
    if (used.has(s0.id)) continue;
    const pts: Pt[] = [];
    let seg = s0;
    let at = ends(seg)[0];
    let guard = 0;
    while (seg && !used.has(seg.id) && guard++ < 1000) {
      used.add(seg.id);
      const [u, v] = ends(seg);
      const next = at === u ? v : u;
      pts.push(pointOf(sk, at));
      if (seg.kind === 'arc') pts.push(arcMid(sk, seg));
      if (seg.kind === 'spline') pts.push(...sampleSpline(seg.points.map((id) => pointOf(sk, id)), 4).slice(1, -1));
      at = next;
      seg = segs.find((x) => !used.has(x.id) && ends(x).includes(at))!;
    }
    if (pts.length >= 3) loops.push(pts);
  }
  return loops;
}

function inLoops(p: Pt, loops: Pt[][]): boolean {
  let inside = false;
  for (const loop of loops) {
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
      const a = loop[i];
      const b = loop[j];
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
  }
  return inside;
}

/**
 * Name the planar face under a click: the latest extrude/cut cap or side face that
 * contains the hit point with a matching normal.
 */
export function pickFace(doc: PartDocument, hit: Vec3, hitNormal: Vec3, tol = 0.05): FaceRef | null {
  const feats = solidFeatures(doc).reverse();
  for (const ex of feats) {
    const base = frameForSketch(doc, ex.sketchId);
    const sk = getSketchFeature(doc, ex.sketchId);
    if (!base || !sk) continue;
    const [a, b] = extrudeExtent(ex);
    const candidates: FaceRef[] = [
      { kind: 'cap', featureId: ex.id, cap: 'start', flip: false },
      { kind: 'cap', featureId: ex.id, cap: 'end', flip: false },
      ...sk.sketch.entities
        .filter((e) => e.kind === 'line' && !e.construction)
        .map((e): FaceRef => ({ kind: 'side', featureId: ex.id, segmentId: e.id, flip: false })),
    ];
    for (const ref of candidates) {
      const f = faceFrame(doc, ref);
      if (!f) continue;
      const align = dot(f.normal, hitNormal);
      if (Math.abs(align) < 0.999) continue;
      if (Math.abs(dot(sub(hit, f.origin), f.normal)) > tol) continue;
      // inside the face's extent?
      const local = { x: dot(sub(hit, base.origin), base.xDir), y: dot(sub(hit, base.origin), base.yDir) };
      if (ref.kind === 'cap') {
        if (!inLoops(local, polygonOf(sk.sketch))) continue;
      } else {
        const along = dot(sub(hit, f.origin), f.xDir);
        const line = sk.sketch.entities.find((e) => e.id === ref.segmentId)!;
        if (line.kind !== 'line') continue;
        const len = Math.hypot(...(sub(toWorld(base, pointOf(sk.sketch, line.p2)), toWorld(base, pointOf(sk.sketch, line.p1))) as [number, number, number]));
        const h = dot(sub(hit, base.origin), base.normal);
        if (along < -tol || along > len + tol || h < a - tol || h > b + tol) continue;
      }
      return { ...ref, flip: align < 0 };
    }
  }
  return null;
}

/** All named edges of the current solid features, with where they are now. */
export function candidateEdges(doc: PartDocument): { ref: EdgeRef; at: Vec3; feature: Feature }[] {
  const out: { ref: EdgeRef; at: Vec3; feature: Feature }[] = [];
  for (const ex of solidFeatures(doc).reverse()) {
    const sk = getSketchFeature(doc, ex.sketchId);
    if (!sk) continue;
    const refs: EdgeRef[] = [];
    for (const e of sk.sketch.entities) {
      if (e.construction) continue;
      if (e.kind === 'line' || e.kind === 'arc' || e.kind === 'circle' || e.kind === 'spline') {
        refs.push({ kind: 'capEdge', featureId: ex.id, cap: 'start', segmentId: e.id });
        refs.push({ kind: 'capEdge', featureId: ex.id, cap: 'end', segmentId: e.id });
      }
      if (e.kind === 'point') {
        const onOutline = sk.sketch.entities.some(
          (l) => !l.construction && ((l.kind === 'line' && (l.p1 === e.id || l.p2 === e.id)) || (l.kind === 'arc' && (l.start === e.id || l.end === e.id)) || (l.kind === 'spline' && (l.points[0] === e.id || l.points[l.points.length - 1] === e.id))),
        );
        if (onOutline) refs.push({ kind: 'sideEdge', featureId: ex.id, pointId: e.id });
      }
    }
    for (const ref of refs) {
      const at = edgePoint(doc, ref);
      if (at) out.push({ ref, at, feature: ex });
    }
  }
  return out;
}

/** Distance from a point to a polyline given as flat xyz pairs of segments. */
export function distToSegments(p: Vec3, segs: ArrayLike<number>, start = 0, count = segs.length / 3): number {
  let best = Infinity;
  for (let i = start; i + 1 < start + count; i += 2) {
    const a: Vec3 = [segs[i * 3], segs[i * 3 + 1], segs[i * 3 + 2]];
    const b: Vec3 = [segs[i * 3 + 3], segs[i * 3 + 4], segs[i * 3 + 5]];
    const ab = sub(b, a);
    const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1)));
    const q = add(a, scale(ab, t));
    best = Math.min(best, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]));
  }
  return best;
}

export const sameEdge = (a: EdgeRef, b: EdgeRef) => JSON.stringify(a) === JSON.stringify(b);

export function edgeLabel(doc: PartDocument, ref: EdgeRef): string {
  const f = doc.features.find((x) => x.id === ref.featureId);
  const name = f?.name ?? '?';
  return ref.kind === 'sideEdge' ? `${name} side edge` : `${name} ${ref.cap} edge`;
}

export function faceLabel(doc: PartDocument, ref: FaceRef): string {
  const f = doc.features.find((x) => x.id === ref.featureId);
  return `${f?.name ?? '?'} ${ref.kind === 'cap' ? `${ref.cap} face` : 'side face'}`;
}

/* ---------- vertices (extrude up to a vertex) ---------- */

/** Where a model corner is now. */
export function vertexPoint(doc: PartDocument, ref: VertexRef): Vec3 | undefined {
  const ex = getExtrude(doc, ref.featureId);
  if (!ex || ex.suppressed) return undefined;
  const base = frameForSketch(doc, ex.sketchId);
  const sk = getSketchFeature(doc, ex.sketchId);
  if (!base || !sk || !sk.sketch.entities.some((e) => e.id === ref.pointId)) return undefined;
  const [a, b] = extrudeExtent(ex);
  return toWorld(base, pointOf(sk.sketch, ref.pointId), ref.cap === 'start' ? a : b);
}

const onOutline = (sk: Sketch, id: Id) =>
  sk.entities.some(
    (l) =>
      !l.construction &&
      ((l.kind === 'line' && (l.p1 === id || l.p2 === id)) ||
        (l.kind === 'arc' && (l.start === id || l.end === id)) ||
        (l.kind === 'spline' && (l.points[0] === id || l.points[l.points.length - 1] === id))),
  );

/** Every corner that can be picked: the ends of the side edges of each extrude. */
export function candidateVertices(doc: PartDocument, except?: Id): { ref: VertexRef; at: Vec3 }[] {
  const out: { ref: VertexRef; at: Vec3 }[] = [];
  for (const ex of solidFeatures(doc)) {
    if (ex.id === except || ex.direction1.type === 'throughAll' || ex.direction1.type === 'throughAllBoth' || ex.direction1.type === 'upToFace') continue;
    const sk = getSketchFeature(doc, ex.sketchId);
    if (!sk) continue;
    for (const e of sk.sketch.entities) {
      if (e.kind !== 'point' || e.construction || !onOutline(sk.sketch, e.id)) continue;
      for (const cap of ['start', 'end'] as const) {
        const ref: VertexRef = { kind: 'corner', featureId: ex.id, pointId: e.id, cap };
        const at = vertexPoint(doc, ref);
        if (at) out.push({ ref, at });
      }
    }
  }
  return out;
}

/**
 * Signed distance from an extrude's sketch plane to its vertex, along the
 * direction the extrude goes before `reverse` (cuts go against the normal).
 */
export function rawVertexDepth(doc: PartDocument, f: Pick<ExtrudeFeature, 'type' | 'sketchId' | 'direction1'>): number | undefined {
  if (f.direction1.type !== 'upToVertex' || !f.direction1.vertex) return undefined;
  const frame = frameForSketch(doc, f.sketchId);
  const v = vertexPoint(doc, f.direction1.vertex);
  if (!frame || !v) return undefined;
  return dot(sub(v, frame.origin), frame.normal) * (f.type === 'cutExtrude' ? -1 : 1);
}

/** The depth an up-to-vertex extrude goes to, with `reverse` applied (positive = in front). */
export function vertexDepth(doc: PartDocument, f: Pick<ExtrudeFeature, 'type' | 'sketchId' | 'direction1' | 'reverse'>): number | undefined {
  const raw = rawVertexDepth(doc, f);
  return raw === undefined ? undefined : raw * (f.reverse ? -1 : 1);
}

export function vertexLabel(doc: PartDocument, ref: VertexRef): string {
  const f = doc.features.find((x) => x.id === ref.featureId);
  return `Corner of ${f?.name ?? 'a deleted feature'} (${ref.cap === 'start' ? 'start' : 'end'})`;
}

/** Store each up-to-vertex extrude's depth, in history order, so later naming sees the real ends. */
export function resolveVertexDepths(doc: PartDocument): PartDocument {
  if (!doc.features.some((f) => (f.type === 'extrude' || f.type === 'cutExtrude') && f.direction1.type === 'upToVertex')) return doc;
  return produce(doc, (d) => {
    for (const f of d.features) {
      if ((f.type !== 'extrude' && f.type !== 'cutExtrude') || f.direction1.type !== 'upToVertex') continue;
      const depth = vertexDepth(d as PartDocument, f as ExtrudeFeature);
      if (depth === undefined) continue;
      const value = Math.round(depth * 1e9) / 1e9;
      if (f.direction1.depth.value !== value) f.direction1.depth = { expr: String(Math.round(value * 1e4) / 1e4), value };
    }
  });
}
