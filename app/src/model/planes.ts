// World is Z-up, millimetres. Each sketch has a frame: an origin, a local 2D basis
// (xDir, yDir) and a normal. The same frames are used by the viewport and the kernel
// worker so a sketch point (x, y) lands at the same 3D spot in both.

import type { PartDocument, PlaneFeature, PlaneWhich, Pt } from './types';
import { faceFrame } from './refs';

export type Vec3 = [number, number, number];

export interface Frame {
  origin: Vec3;
  xDir: Vec3;
  yDir: Vec3;
  normal: Vec3;
}

export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const neg = (a: Vec3): Vec3 => [-a[0], -a[1], -a[2]];
export const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

export function makeFrame(origin: Vec3, xDir: Vec3, normal: Vec3): Frame {
  return { origin, xDir, normal, yDir: cross(normal, xDir) };
}

export const DEFAULT_FRAMES: Record<PlaneWhich, Frame> = {
  front: makeFrame([0, 0, 0], [1, 0, 0], [0, -1, 0]), // looks along +Y; local y = world Z
  top: makeFrame([0, 0, 0], [1, 0, 0], [0, 0, 1]), // local y = world Y
  right: makeFrame([0, 0, 0], [0, 1, 0], [1, 0, 0]), // local y = world Z
};

export function toWorld(f: Frame, p: Pt, offset = 0): Vec3 {
  return [0, 1, 2].map((i) => f.origin[i] + f.xDir[i] * p.x + f.yDir[i] * p.y + f.normal[i] * offset) as Vec3;
}

export function toLocal(f: Frame, w: Vec3): Pt {
  const d = sub(w, f.origin);
  return { x: dot(d, f.xDir), y: dot(d, f.yDir) };
}

/** Frame of a plane feature: a default plane, or an offset from a plane or flat face. */
export function planeFrame(doc: PartDocument, plane: PlaneFeature, depth = 0): Frame | undefined {
  if (plane.def.type === 'default') return DEFAULT_FRAMES[plane.def.which];
  if (depth > 50) return undefined;
  const { base } = plane.def;
  const b =
    base.kind === 'plane'
      ? (() => {
          const p = doc.features.find((f): f is PlaneFeature => f.id === base.featureId && f.type === 'plane');
          return p ? planeFrame(doc, p, depth + 1) : undefined;
        })()
      : faceFrame(doc, base.face, depth + 1);
  if (!b) return undefined;
  if (plane.def.type === 'offset') return { ...b, origin: add(b.origin, scale(b.normal, plane.def.distance.value)) };
  // angle: rotate the normal (and the other in-plane axis) about the chosen in-plane axis
  const a = (plane.def.angle.value * Math.PI) / 180;
  const c = Math.cos(a);
  const sn = Math.sin(a);
  if (plane.def.axis === 'x') {
    const normal = add(scale(b.normal, c), scale(b.yDir, -sn));
    return makeFrame(b.origin, b.xDir, normal);
  }
  const normal = add(scale(b.normal, c), scale(b.xDir, sn));
  const xDir = add(scale(b.xDir, c), scale(b.normal, -sn));
  return makeFrame(b.origin, xDir, normal);
}

export const planeById = (doc: PartDocument, id: string) =>
  doc.features.find((f): f is PlaneFeature => f.id === id && f.type === 'plane');

/** Frame of the plane or face a sketch sits on (faces resolve through the features that made them). */
export function frameForSketch(doc: PartDocument, sketchId: string, depth = 0): Frame | undefined {
  const s = doc.features.find((f) => f.id === sketchId);
  if (!s || s.type !== 'sketch' || depth > 50) return undefined;
  if (s.on.kind === 'plane') {
    const pl = planeById(doc, s.on.featureId);
    return pl ? planeFrame(doc, pl, depth + 1) : undefined;
  }
  return faceFrame(doc, s.on.face, depth + 1);
}
