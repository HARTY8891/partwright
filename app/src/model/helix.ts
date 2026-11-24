// A helix (for springs and threads), built on a circle in a sketch: it starts at
// the circle's point on the sketch's +x side and climbs along the sketch normal.
// Pure: used by the kernel (to build it) and the viewport (to draw it).

import type { HelixFeature, PartDocument } from './types';
import { add, cross, frameForSketch, neg, scale, type Vec3 } from './planes';
import { getSketchFeature, pointOf } from './refs';

export interface HelixGeom {
  centre: Vec3;
  radius: number;
  /** from the centre to the start point */
  xDir: Vec3;
  /** the way it climbs */
  dir: Vec3;
  pitch: number;
  turns: number;
  leftHand: boolean;
}

export function helixGeom(doc: PartDocument, f: Pick<HelixFeature, 'sketchId' | 'pitch' | 'turns' | 'reverse' | 'leftHand'>): HelixGeom | { error: string } {
  const sk = getSketchFeature(doc, f.sketchId);
  const frame = sk && frameForSketch(doc, sk.id);
  const circle = sk?.sketch.entities.find((e) => e.kind === 'circle' && !e.construction);
  if (!sk || !frame || !circle || circle.kind !== 'circle') return { error: 'The helix needs a sketch with a circle (its diameter and centre).' };
  if (!(f.pitch.value > 0)) return { error: 'The pitch must be more than zero.' };
  if (!(f.turns.value > 0 && f.turns.value <= 500)) return { error: 'The number of turns must be between 0 and 500.' };
  const c = pointOf(sk.sketch, circle.center);
  return {
    centre: add(add(frame.origin, scale(frame.xDir, c.x)), scale(frame.yDir, c.y)),
    radius: circle.radius,
    xDir: frame.xDir,
    dir: f.reverse ? neg(frame.normal) : frame.normal,
    pitch: f.pitch.value,
    turns: f.turns.value,
    leftHand: f.leftHand,
  };
}

/** Points along the helix, for drawing it. */
export function helixPoints(g: HelixGeom, perTurn = 48): Vec3[] {
  const y = scale(cross(g.dir, g.xDir), g.leftHand ? -1 : 1);
  const n = Math.max(8, Math.ceil(g.turns * perTurn));
  const out: Vec3[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * g.turns * 2 * Math.PI;
    out.push(add(add(add(g.centre, scale(g.xDir, g.radius * Math.cos(a))), scale(y, g.radius * Math.sin(a))), scale(g.dir, (g.pitch * a) / (2 * Math.PI))));
  }
  return out;
}
