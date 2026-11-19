// Sketch modify tools: mirror across a centerline, fillet a corner, offset an
// outline. Each edits a sketch in place (an Immer draft) and returns an error
// message when the selection does not fit, or null when it worked.
import type { Constraint, Id, Pt, Sketch, SketchEntity } from '../model/types';

type S = Sketch;
const P = (s: S, id: Id): Pt => {
  const e = s.entities.find((x) => x.id === id);
  return e && e.kind === 'point' ? e.p : { x: 0, y: 0 };
};
const ent = (s: S, id: Id) => s.entities.find((x) => x.id === id);

/** Copy curves to the other side of a centerline (construction line). */
export function mirrorEntities(s: S, uid: () => Id, ids: Id[]): string | null {
  const axis = ids.map((id) => ent(s, id)).find((e) => e?.kind === 'line' && e.construction);
  if (!axis || axis.kind !== 'line') return 'Select a centerline to mirror across, plus the lines, arcs or circles to mirror.';
  const curves = ids.map((id) => ent(s, id)).filter((e): e is SketchEntity => !!e && e.id !== axis.id && e.kind !== 'point');
  if (!curves.length) return 'Select what to mirror as well as the centerline.';
  const a = P(s, axis.p1);
  const b = P(s, axis.p2);
  const d = { x: b.x - a.x, y: b.y - a.y };
  const len2 = d.x * d.x + d.y * d.y || 1;
  const reflect = (p: Pt): Pt => {
    const t = ((p.x - a.x) * d.x + (p.y - a.y) * d.y) / len2;
    const f = { x: a.x + t * d.x, y: a.y + t * d.y };
    return { x: 2 * f.x - p.x, y: 2 * f.y - p.y };
  };
  const copies = new Map<Id, Id>(); // point id -> its mirror point id
  const onAxis = (p: Pt) => Math.abs((p.x - a.x) * d.y - (p.y - a.y) * d.x) / Math.sqrt(len2) < 1e-6;
  const mirrorPoint = (id: Id): Id => {
    if (copies.has(id)) return copies.get(id)!;
    const p = P(s, id);
    if (onAxis(p)) return id; // points on the centerline are shared
    const nid = uid();
    const src = ent(s, id);
    s.entities.push({ id: nid, kind: 'point', p: reflect(p), construction: !!src?.construction });
    copies.set(id, nid);
    return nid;
  };
  for (const c of curves) {
    if (c.kind === 'line') s.entities.push({ id: uid(), kind: 'line', p1: mirrorPoint(c.p1), p2: mirrorPoint(c.p2), construction: c.construction });
    else if (c.kind === 'circle') {
      const nid = uid();
      s.entities.push({ id: nid, kind: 'circle', center: mirrorPoint(c.center), radius: c.radius, construction: c.construction });
      s.constraints.push({ id: uid(), kind: 'equal', entityIds: [c.id, nid] });
    } else if (c.kind === 'arc') {
      // a reflection reverses the direction of travel
      s.entities.push({ id: uid(), kind: 'arc', center: mirrorPoint(c.center), start: mirrorPoint(c.start), end: mirrorPoint(c.end), ccw: !c.ccw, construction: c.construction });
    }
  }
  return null;
}

/**
 * Round the corner where two lines meet. Selection: the corner point, or the two
 * lines. The corner point stays as a construction "virtual sharp" on both lines,
 * so dimensions to it still work.
 */
export function filletCorner(s: S, uid: () => Id, ids: Id[], r: number): { error: string } | { radiusDim: Id } {
  if (!(r > 0)) return { error: 'The radius must be more than zero.' };
  let corner: Id | undefined;
  const sel = ids.map((id) => ent(s, id));
  if (sel.length === 1 && sel[0]?.kind === 'point') corner = sel[0].id;
  if (sel.length === 2 && sel.every((e) => e?.kind === 'line')) {
    const [l1, l2] = sel as Extract<SketchEntity, { kind: 'line' }>[];
    corner = [l1.p1, l1.p2].find((p) => p === l2.p1 || p === l2.p2);
  }
  if (!corner) return { error: 'Select the corner point, or two lines that meet.' };
  const lines = s.entities.filter((e): e is Extract<SketchEntity, { kind: 'line' }> => e.kind === 'line' && !e.construction && (e.p1 === corner || e.p2 === corner));
  if (lines.length !== 2) return { error: 'A fillet needs a corner where exactly two lines meet.' };
  const pc = P(s, corner);
  const far = (l: (typeof lines)[number]) => (l.p1 === corner ? l.p2 : l.p1);
  const u = lines.map((l) => {
    const q = P(s, far(l));
    const len = Math.hypot(q.x - pc.x, q.y - pc.y);
    return { x: (q.x - pc.x) / len, y: (q.y - pc.y) / len, len };
  });
  const cos = u[0].x * u[1].x + u[0].y * u[1].y;
  const half = Math.acos(Math.max(-1, Math.min(1, cos))) / 2;
  if (half < 1e-3 || half > Math.PI / 2 - 1e-3) return { error: 'These lines are in line with each other; there is no corner to round.' };
  const t = r / Math.tan(half);
  if (t >= Math.min(u[0].len, u[1].len)) return { error: 'The radius is too big for these lines.' };
  const bis = { x: u[0].x + u[1].x, y: u[0].y + u[1].y };
  const bl = Math.hypot(bis.x, bis.y);
  const cen = { x: pc.x + (bis.x / bl) * (r / Math.sin(half)), y: pc.y + (bis.y / bl) * (r / Math.sin(half)) };
  const tp = u.map((v) => ({ x: pc.x + v.x * t, y: pc.y + v.y * t }));
  const t1 = uid();
  const t2 = uid();
  const c = uid();
  s.entities.push({ id: t1, kind: 'point', p: tp[0], construction: false });
  s.entities.push({ id: t2, kind: 'point', p: tp[1], construction: false });
  s.entities.push({ id: c, kind: 'point', p: cen, construction: true });
  // the lines now end at the tangent points
  lines.forEach((l, i) => {
    const tid = i === 0 ? t1 : t2;
    if (l.p1 === corner) l.p1 = tid;
    else l.p2 = tid;
  });
  // the corner becomes a construction point that stays on both lines
  const cornerEnt = ent(s, corner);
  if (cornerEnt && cornerEnt.kind === 'point') cornerEnt.construction = true;
  const cross = u[0].x * u[1].y - u[0].y * u[1].x;
  const arc = uid();
  s.entities.push({ id: arc, kind: 'arc', center: c, start: t1, end: t2, ccw: cross < 0, construction: false });
  // radius lines from the centre, square to each side: keeps the arc tangent while solving
  const r1 = uid();
  const r2 = uid();
  s.entities.push({ id: r1, kind: 'line', p1: c, p2: t1, construction: true });
  s.entities.push({ id: r2, kind: 'line', p1: c, p2: t2, construction: true });
  const cons: Constraint[] = [
    { id: uid(), kind: 'perpendicular', entityIds: [r1, lines[0].id] },
    { id: uid(), kind: 'perpendicular', entityIds: [r2, lines[1].id] },
    { id: uid(), kind: 'pointOnObject', entityIds: [corner, lines[0].id] },
    { id: uid(), kind: 'pointOnObject', entityIds: [corner, lines[1].id] },
  ];
  s.constraints.push(...cons);
  const dim = uid();
  const n = Math.max(0, ...s.dimensions.map((d) => Number(d.name.slice(1)) || 0)) + 1;
  s.dimensions.push({ id: dim, name: `D${n}`, kind: 'radius', entityIds: [arc], value: { expr: String(+r.toFixed(4)), value: r }, driving: true });
  return { radiusDim: dim };
}

/**
 * Offset a circle, or a closed outline made only of lines, by `d` (positive =
 * outward). The copy keeps parallel sides (or the same centre) and gets a
 * driving distance, so changing it later moves the whole copy.
 */
export function offsetEntities(s: S, uid: () => Id, ids: Id[], d: number): string | null {
  if (!d) return 'The offset distance cannot be zero.';
  const sel = ids.map((id) => ent(s, id)).filter((e): e is SketchEntity => !!e);
  const circles = sel.filter((e): e is Extract<SketchEntity, { kind: 'circle' }> => e.kind === 'circle');
  if (circles.length && circles.length === sel.length) {
    for (const c of circles) {
      const r = c.radius + d;
      if (r <= 0) return 'The offset is bigger than the circle.';
      const nid = uid();
      s.entities.push({ id: nid, kind: 'circle', center: c.center, radius: r, construction: false });
    }
    return null;
  }
  // a closed loop of lines, in order
  const lines = sel.filter((e): e is Extract<SketchEntity, { kind: 'line' }> => e.kind === 'line');
  if (lines.length !== sel.length || lines.length < 3) return 'Select a circle, or all the lines of one closed outline.';
  const order: typeof lines = [lines[0]];
  const pts: Id[] = [lines[0].p1, lines[0].p2];
  while (order.length < lines.length) {
    const last = pts[pts.length - 1];
    const next = lines.find((l) => !order.includes(l) && (l.p1 === last || l.p2 === last));
    if (!next) return 'The selected lines do not form one closed outline.';
    order.push(next);
    pts.push(next.p1 === last ? next.p2 : next.p1);
  }
  if (pts[pts.length - 1] !== pts[0]) return 'The selected lines do not form one closed outline.';
  const poly = pts.slice(0, -1).map((id) => P(s, id));
  const n = poly.length;
  const area = poly.reduce((a, p, i) => a + p.x * poly[(i + 1) % n].y - poly[(i + 1) % n].x * p.y, 0) / 2;
  const out = area > 0 ? 1 : -1; // outward normal side for a ccw loop is to the right
  // shift each side along its outward normal, then intersect neighbours
  const shifted = poly.map((p, i) => {
    const q = poly[(i + 1) % n];
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    const nx = ((q.y - p.y) / len) * out * d;
    const ny = (-(q.x - p.x) / len) * out * d;
    return { a: { x: p.x + nx, y: p.y + ny }, b: { x: q.x + nx, y: q.y + ny } };
  });
  const corners: Pt[] = shifted.map((cur, i) => {
    const prev = shifted[(i + n - 1) % n];
    const r = { x: prev.b.x - prev.a.x, y: prev.b.y - prev.a.y };
    const sv = { x: cur.b.x - cur.a.x, y: cur.b.y - cur.a.y };
    const den = r.x * sv.y - r.y * sv.x;
    if (Math.abs(den) < 1e-12) return cur.a;
    const t = ((cur.a.x - prev.a.x) * sv.y - (cur.a.y - prev.a.y) * sv.x) / den;
    return { x: prev.a.x + t * r.x, y: prev.a.y + t * r.y };
  });
  const ids2 = corners.map((p) => {
    const id = uid();
    s.entities.push({ id, kind: 'point', p, construction: false });
    return id;
  });
  const newLines = ids2.map((p, i) => {
    const id = uid();
    s.entities.push({ id, kind: 'line', p1: p, p2: ids2[(i + 1) % n], construction: false });
    s.constraints.push({ id: uid(), kind: 'parallel', entityIds: [order[i].id, id] });
    return id;
  });
  // each new side keeps its distance to its original side, so the copy follows the outline
  let dn = Math.max(0, ...s.dimensions.map((x) => Number(x.name.slice(1)) || 0));
  newLines.forEach((_, i) => {
    dn++;
    s.dimensions.push({ id: uid(), name: `D${dn}`, kind: 'pointLine', entityIds: [ids2[i], order[i].id], value: { expr: String(+Math.abs(d).toFixed(4)), value: Math.abs(d) }, driving: true });
  });
  return null;
}

/* ---------- trim and extend (lines) ---------- */

type Line = Extract<SketchEntity, { kind: 'line' }>;

/** Parameters t along line a→b where it crosses other lines and circles/arcs (inside (0,1), or beyond 1 as a ray). */
function crossings(s: S, line: Line, asRay = false): number[] {
  const a = P(s, line.p1);
  const b = P(s, line.p2);
  const d = { x: b.x - a.x, y: b.y - a.y };
  const ts: number[] = [];
  for (const e of s.entities) {
    if (e.id === line.id || e.kind === 'point' || e.construction) continue;
    if (e.kind === 'line') {
      const c = P(s, e.p1);
      const f = P(s, e.p2);
      const g = { x: f.x - c.x, y: f.y - c.y };
      const den = d.x * g.y - d.y * g.x;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((c.x - a.x) * g.y - (c.y - a.y) * g.x) / den;
      const u = ((c.x - a.x) * d.y - (c.y - a.y) * d.x) / den;
      if (u >= -1e-9 && u <= 1 + 1e-9) ts.push(t);
    } else if (e.kind === 'circle' || e.kind === 'arc') {
      const c = P(s, e.center);
      const r = e.kind === 'circle' ? e.radius : Math.hypot(P(s, e.start).x - c.x, P(s, e.start).y - c.y);
      const fx = a.x - c.x;
      const fy = a.y - c.y;
      const A = d.x * d.x + d.y * d.y;
      const B = 2 * (fx * d.x + fy * d.y);
      const C = fx * fx + fy * fy - r * r;
      const disc = B * B - 4 * A * C;
      if (disc < 0) continue;
      for (const t of [(-B - Math.sqrt(disc)) / (2 * A), (-B + Math.sqrt(disc)) / (2 * A)]) {
        if (e.kind === 'arc') {
          // keep only points on the drawn part of the arc
          const qa = Math.atan2(a.y + t * d.y - c.y, a.x + t * d.x - c.x);
          const ang = (p: Pt) => Math.atan2(p.y - c.y, p.x - c.x);
          const norm = (x: number) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
          const s0 = ang(P(s, e.start));
          const s1 = ang(P(s, e.end));
          const sweep = e.ccw ? norm(s1 - s0) : norm(s0 - s1);
          const at = e.ccw ? norm(qa - s0) : norm(s0 - qa);
          if (at > sweep + 1e-9) continue;
        }
        ts.push(t);
      }
    }
  }
  return ts.filter((t) => (asRay ? t > 1 + 1e-9 : t > 1e-9 && t < 1 - 1e-9)).sort((x, y) => x - y);
}

const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/**
 * Trim: remove the piece of a line between its nearest crossings on either side
 * of the clicked spot. With no crossings the whole line goes.
 */
export function trimLine(s: S, uid: () => Id, lineId: Id, click: Pt): string | null {
  const line = ent(s, lineId);
  if (!line || line.kind !== 'line') return 'Trim works on lines.';
  const a = P(s, line.p1);
  const b = P(s, line.p2);
  const d = { x: b.x - a.x, y: b.y - a.y };
  const tc = ((click.x - a.x) * d.x + (click.y - a.y) * d.y) / (d.x * d.x + d.y * d.y || 1);
  const ts = [0, ...crossings(s, line), 1];
  let i = 0;
  while (i < ts.length - 2 && ts[i + 1] < tc) i++;
  const ta = ts[i];
  const tb = ts[i + 1];
  // the length changes, so dimensions on this line no longer apply
  s.dimensions = s.dimensions.filter((dm) => dm.lineId !== lineId && !dm.entityIds.includes(lineId));
  if (ta <= 1e-9 && tb >= 1 - 1e-9) {
    s.entities = s.entities.filter((e) => e.id !== lineId);
    s.constraints = s.constraints.filter((c) => !c.entityIds.includes(lineId));
    return null;
  }
  const newPoint = (p: Pt) => {
    const id = uid();
    s.entities.push({ id, kind: 'point', p, construction: false });
    return id;
  };
  if (ta <= 1e-9) line.p1 = newPoint(lerp(a, b, tb));
  else if (tb >= 1 - 1e-9) line.p2 = newPoint(lerp(a, b, ta));
  else {
    // cut out the middle: this line keeps the first part, a new line takes the rest
    const m1 = newPoint(lerp(a, b, ta));
    const m2 = newPoint(lerp(a, b, tb));
    const oldEnd = line.p2;
    line.p2 = m1;
    const id = uid();
    s.entities.push({ id, kind: 'line', p1: m2, p2: oldEnd, construction: line.construction });
    for (const c of s.constraints.filter((c) => (c.kind === 'horizontal' || c.kind === 'vertical') && c.entityIds[0] === lineId))
      s.constraints.push({ id: uid(), kind: c.kind, entityIds: [id] });
  }
  return null;
}

/** Extend: lengthen the line end nearest the click to the next line or circle it would meet. */
export function extendLine(s: S, uid: () => Id, lineId: Id, click: Pt): string | null {
  const line = ent(s, lineId);
  if (!line || line.kind !== 'line') return 'Extend works on lines.';
  const a = P(s, line.p1);
  const b = P(s, line.p2);
  const nearEnd: 'p1' | 'p2' = Math.hypot(click.x - b.x, click.y - b.y) <= Math.hypot(click.x - a.x, click.y - a.y) ? 'p2' : 'p1';
  // look along the line beyond the chosen end
  const probe: Line = nearEnd === 'p2' ? line : { ...line, p1: line.p2, p2: line.p1 };
  const ts = crossings(s, probe, true);
  if (!ts.length) return 'Nothing to extend to in that direction.';
  const target = lerp(P(s, probe.p1), P(s, probe.p2), ts[0]);
  const endId = line[nearEnd];
  const shared = s.entities.some(
    (e) => e.id !== lineId && ((e.kind === 'line' && (e.p1 === endId || e.p2 === endId)) || (e.kind === 'arc' && (e.start === endId || e.end === endId || e.center === endId)) || (e.kind === 'circle' && e.center === endId)),
  );
  if (shared) {
    // the end point belongs to other geometry too: give this line its own new end
    const id = uid();
    s.entities.push({ id, kind: 'point', p: target, construction: false });
    line[nearEnd] = id;
  } else {
    const pe = ent(s, endId);
    if (pe && pe.kind === 'point') pe.p = target;
  }
  s.dimensions = s.dimensions.filter((dm) => dm.lineId !== lineId);
  return null;
}
