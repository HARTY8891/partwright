// Builders for compound sketch shapes: regular polygon and slot. Each returns the
// entities and relations to add, so the result stays parametric (drag-free but
// dimensionable): a polygon keeps equal sides on a construction circle, a slot
// keeps tangent ends of equal radius.
import type { Constraint, Id, Pt, SketchEntity } from '../model/types';

type Out = { entities: SketchEntity[]; constraints: Constraint[] };

export function polygonShape(uid: () => Id, centerId: Id, c: Pt, vertex: Pt, sides: number): Out {
  const n = Math.max(3, Math.min(64, Math.round(sides)));
  const r = Math.hypot(vertex.x - c.x, vertex.y - c.y);
  const a0 = Math.atan2(vertex.y - c.y, vertex.x - c.x);
  const entities: SketchEntity[] = [];
  const constraints: Constraint[] = [];
  const circleId = uid();
  entities.push({ id: circleId, kind: 'circle', center: centerId, radius: r, construction: true });
  const pts = [...Array(n).keys()].map((i) => {
    const id = uid();
    const a = a0 + (2 * Math.PI * i) / n;
    entities.push({ id, kind: 'point', p: { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) }, construction: false });
    constraints.push({ id: uid(), kind: 'pointOnObject', entityIds: [id, circleId] });
    return id;
  });
  const lines = pts.map((p, i) => {
    const id = uid();
    entities.push({ id, kind: 'line', p1: p, p2: pts[(i + 1) % n], construction: false });
    return id;
  });
  for (let i = 0; i < n - 1; i++) constraints.push({ id: uid(), kind: 'equal', entityIds: [lines[i], lines[i + 1]] });
  return { entities, constraints };
}

/** Straight slot between two centres; `side` is any point on one long edge (sets the width). */
export function slotShape(uid: () => Id, c1Id: Id, c1: Pt, c2Id: Id, c2: Pt, side: Pt): Out | null {
  const len = Math.hypot(c2.x - c1.x, c2.y - c1.y);
  if (len < 1e-6) return null;
  const u = { x: (c2.x - c1.x) / len, y: (c2.y - c1.y) / len };
  const nrm = { x: -u.y, y: u.x };
  const w = Math.abs((side.x - c1.x) * nrm.x + (side.y - c1.y) * nrm.y);
  if (w < 1e-6) return null;
  const P = (q: Pt, s: number) => ({ x: q.x + nrm.x * s * w, y: q.y + nrm.y * s * w });
  const entities: SketchEntity[] = [];
  const constraints: Constraint[] = [];
  const mk = (p: Pt) => {
    const id = uid();
    entities.push({ id, kind: 'point', p, construction: false });
    return id;
  };
  const a1 = mk(P(c1, 1));
  const a2 = mk(P(c2, 1));
  const b2 = mk(P(c2, -1));
  const b1 = mk(P(c1, -1));
  const top = uid();
  const bottom = uid();
  entities.push({ id: top, kind: 'line', p1: a1, p2: a2, construction: false });
  entities.push({ id: bottom, kind: 'line', p1: b2, p2: b1, construction: false });
  // ends: from the top edge round the outside to the bottom edge
  const end2 = uid();
  const end1 = uid();
  // ccw from a2 to b2 around c2 passes the far end (c2 + u*w) when the turn u -> nrm is positive
  entities.push({ id: end2, kind: 'arc', center: c2Id, start: b2, end: a2, ccw: true, construction: false });
  entities.push({ id: end1, kind: 'arc', center: c1Id, start: a1, end: b1, ccw: true, construction: false });
  entities.push({ id: uid(), kind: 'line', p1: c1Id, p2: c2Id, construction: true });
  // Tangent ends without a tangent relation (tangency at an arc's own endpoint is
  // degenerate for the solver): a construction line across each end, through its
  // centre, perpendicular to the long edge, both the same length. Each arc already
  // keeps its ends equidistant from its centre, so the centre is the midpoint.
  const e1 = uid();
  const e2 = uid();
  entities.push({ id: e1, kind: 'line', p1: a1, p2: b1, construction: true });
  entities.push({ id: e2, kind: 'line', p1: a2, p2: b2, construction: true });
  constraints.push(
    { id: uid(), kind: 'pointOnObject', entityIds: [c1Id, e1] },
    { id: uid(), kind: 'pointOnObject', entityIds: [c2Id, e2] },
    { id: uid(), kind: 'perpendicular', entityIds: [e1, top] },
    { id: uid(), kind: 'perpendicular', entityIds: [e2, top] },
    { id: uid(), kind: 'equal', entityIds: [e1, e2] },
  );
  return { entities, constraints };
}
