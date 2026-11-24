// Reference axes: where two planes meet, along a sketch line, or through the
// centre of a round extrude (its circle or arc). Pure: used on both threads.

import type { AxisFeature, Id, PartDocument } from './types';
import { cross, dot, frameForSketch, norm, planeById, planeFrame, scale, add, sub, toWorld, type Vec3 } from './planes';
import { getSketchFeature, pointOf } from './refs';

export interface AxisLine {
  origin: Vec3;
  /** unit direction */
  dir: Vec3;
}

export type AxisDef = AxisFeature['def'];

/** Where an axis is now, or a reason it cannot be found. */
export function resolveAxis(doc: PartDocument, def: AxisDef): AxisLine | { error: string } {
  if (def.type === 'planes') {
    const pa = planeById(doc, def.a);
    const pb = planeById(doc, def.b);
    const fa = pa && !pa.suppressed ? planeFrame(doc, pa) : undefined;
    const fb = pb && !pb.suppressed ? planeFrame(doc, pb) : undefined;
    if (!fa || !fb) return { error: 'One of the planes no longer exists.' };
    const d = cross(fa.normal, fb.normal);
    const len2 = dot(d, d);
    if (len2 < 1e-12) return { error: 'The two planes are parallel, so they do not meet.' };
    // the point on both planes nearest the world origin
    const d1 = dot(fa.normal, fa.origin);
    const d2 = dot(fb.normal, fb.origin);
    const p = scale(add(scale(cross(fb.normal, d), d1), scale(cross(d, fa.normal), d2)), 1 / len2);
    return { origin: p, dir: norm(d) };
  }
  if (def.type === 'sketchLine') {
    const sk = getSketchFeature(doc, def.sketchId);
    const frame = sk && frameForSketch(doc, sk.id);
    const line = sk?.sketch.entities.find((e) => e.id === def.lineId);
    if (!sk || !frame || !line || line.kind !== 'line') return { error: 'The sketch line no longer exists.' };
    const p1 = toWorld(frame, pointOf(sk.sketch, line.p1));
    const p2 = toWorld(frame, pointOf(sk.sketch, line.p2));
    const d = sub(p2, p1);
    if (dot(d, d) < 1e-12) return { error: 'The sketch line has no length.' };
    return { origin: p1, dir: norm(d) };
  }
  const ex = doc.features.find((f) => f.id === def.featureId);
  if (!ex || (ex.type !== 'extrude' && ex.type !== 'cutExtrude')) return { error: 'The round feature no longer exists.' };
  const sk = getSketchFeature(doc, ex.sketchId);
  const frame = sk && frameForSketch(doc, sk.id);
  const e = sk?.sketch.entities.find((x) => x.id === def.entityId);
  if (!sk || !frame || !e || (e.kind !== 'circle' && e.kind !== 'arc')) return { error: 'The circle or arc no longer exists.' };
  return { origin: toWorld(frame, pointOf(sk.sketch, e.center)), dir: frame.normal };
}

export function axisLine(doc: PartDocument, id: Id): AxisLine | undefined {
  const f = doc.features.find((x): x is AxisFeature => x.id === id && x.type === 'axis');
  if (!f || f.suppressed) return undefined;
  const r = resolveAxis(doc, f.def);
  return 'error' in r ? undefined : r;
}

/** Ids a reference axis is built from (for dependencies). */
export function axisInputs(def: AxisDef): Id[] {
  return def.type === 'planes' ? [def.a, def.b] : def.type === 'sketchLine' ? [def.sketchId] : [def.featureId];
}
