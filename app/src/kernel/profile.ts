// Turns a sketch into closed outlines (pure, testable, no kernel).
import type { Id, Pt, Sketch } from '../model/types';
import { arcAt, arcMid, pointOf } from '../model/refs';
import { bezierAt, reverseSpans, splineSpans, type Span } from '../model/spline';

/** One step of an outline: a straight line or an arc through `mid`, ending at `to`. */
export type Step = { kind: 'line'; to: Pt } | { kind: 'arc'; to: Pt; mid: Pt } | { kind: 'bezier'; to: Pt; spans: Span[] };

export type Loop =
  | { kind: 'path'; start: Pt; steps: Step[]; poly: Pt[] }
  | { kind: 'circle'; center: Pt; radius: number; poly: Pt[] };

export interface ProfileResult {
  loops: Loop[];
  error?: string;
}

export function sketchLoops(sk: Sketch): ProfileResult {
  const loops: Loop[] = [];
  for (const e of sk.entities) {
    if (e.kind !== 'circle' || e.construction) continue;
    const c = pointOf(sk, e.center);
    if (e.radius <= 1e-9) return { loops: [], error: 'A circle has zero size.' };
    const poly = [...Array(64).keys()].map((i) => ({
      x: c.x + e.radius * Math.cos((i / 64) * 2 * Math.PI),
      y: c.y + e.radius * Math.sin((i / 64) * 2 * Math.PI),
    }));
    loops.push({ kind: 'circle', center: c, radius: e.radius, poly });
  }

  const segs = sk.entities.filter(
    (e): e is Extract<Sketch['entities'][number], { kind: 'line' | 'arc' | 'spline' }> =>
      (e.kind === 'line' || e.kind === 'arc' || e.kind === 'spline') && !e.construction,
  );
  if (!segs.length && !loops.length) return { loops: [], error: 'The sketch has no solid lines to build from.' };
  const ends = (s: (typeof segs)[number]): [Id, Id] =>
    s.kind === 'line' ? [s.p1, s.p2] : s.kind === 'arc' ? [s.start, s.end] : [s.points[0], s.points[s.points.length - 1]];

  const adj = new Map<Id, Id[]>();
  for (const s of segs) for (const p of ends(s)) adj.set(p, [...(adj.get(p) ?? []), s.id]);
  for (const [, ls] of adj) {
    if (ls.length === 1) return { loops: [], error: 'The sketch has an open end. Close every outline first.' };
    if (ls.length > 2) return { loops: [], error: 'Three or more lines meet at one point. Each corner must join exactly two lines.' };
  }

  const used = new Set<Id>();
  for (const first of segs) {
    if (used.has(first.id)) continue;
    let seg = first;
    let at = ends(first)[0];
    const start = pointOf(sk, at);
    const steps: Step[] = [];
    const poly: Pt[] = [start];
    while (!used.has(seg.id)) {
      used.add(seg.id);
      const [u, v] = ends(seg);
      const next = at === u ? v : u;
      const to = pointOf(sk, next);
      if (seg.kind === 'line') steps.push({ kind: 'line', to });
      else if (seg.kind === 'spline') {
        const fwd = splineSpans(seg.points.map((id) => pointOf(sk, id)));
        const spans = at === seg.points[0] ? fwd : reverseSpans(fwd);
        steps.push({ kind: 'bezier', to, spans });
        for (const sp of spans) for (let i = 1; i <= 8; i++) poly.push(bezierAt(sp, i / 8));
        poly.pop(); // the last sample is `to`, pushed below
      } else {
        const mid = arcMid(sk, seg);
        steps.push({ kind: 'arc', to, mid });
        // sample the arc in walking direction for area / containment tests
        const forward = at === seg.start;
        const ts = [...Array(15).keys()].map((i) => (i + 1) / 16);
        poly.push(...arcAt(sk, seg, forward ? ts : ts.map((t) => 1 - t)));
      }
      poly.push(to);
      at = next;
      const nid = adj.get(at)!.find((id) => id !== seg.id)!;
      seg = segs.find((s) => s.id === nid)!;
    }
    poly.pop(); // closing point repeats start
    if (poly.length >= 2 && Math.abs(area(poly)) > 1e-9) loops.push({ kind: 'path', start, steps, poly });
  }
  if (!loops.length) return { loops: [], error: 'The outline has no area.' };
  return { loops };
}

export function area(loop: Pt[]): number {
  let a = 0;
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i];
    const q = loop[(i + 1) % loop.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function pointInLoop(p: Pt, loop: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i];
    const b = loop[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Group outlines into outer outlines with their holes (one nesting level). */
export function nestLoops<T extends { poly: Pt[] }>(loops: T[]): { outer: T; holes: T[] }[] {
  const sorted = [...loops].sort((a, b) => Math.abs(area(b.poly)) - Math.abs(area(a.poly)));
  const groups: { outer: T; holes: T[] }[] = [];
  for (const l of sorted) {
    const parent = groups.find((g) => pointInLoop(l.poly[0], g.outer.poly) && !g.holes.some((h) => pointInLoop(l.poly[0], h.poly)));
    if (parent) parent.holes.push(l);
    else groups.push({ outer: l, holes: [] });
  }
  return groups;
}
