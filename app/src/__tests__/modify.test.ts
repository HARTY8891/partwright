import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import { extendLine, filletCorner, mirrorEntities, offsetEntities, trimLine } from '../solver/modify';
import { solveSketch, pointOf } from '../solver/solve';
import { sketchLoops, area } from '../kernel/profile';
import type { Sketch } from '../model/types';

const ids = () => {
  let n = 0;
  return () => `n${n++}`;
};
const square = (): Sketch => ({
  entities: [
    { id: 'a', kind: 'point', p: { x: 0, y: 0 }, construction: false },
    { id: 'b', kind: 'point', p: { x: 20, y: 0 }, construction: false },
    { id: 'c', kind: 'point', p: { x: 20, y: 20 }, construction: false },
    { id: 'd', kind: 'point', p: { x: 0, y: 20 }, construction: false },
    { id: 'ab', kind: 'line', p1: 'a', p2: 'b', construction: false },
    { id: 'bc', kind: 'line', p1: 'b', p2: 'c', construction: false },
    { id: 'cd', kind: 'line', p1: 'c', p2: 'd', construction: false },
    { id: 'da', kind: 'line', p1: 'd', p2: 'a', construction: false },
  ],
  constraints: [],
  dimensions: [],
});

describe('sketch modify tools', () => {
  it('fillet: the corner becomes a tangent arc and the outline stays closed', () => {
    let err: unknown;
    const s = produce(square(), (d) => void (err = filletCorner(d, ids(), ['b'], 5)));
    expect(err).toHaveProperty('radiusDim');
    const r = solveSketch(s);
    expect(r.ok).toBe(true);
    const { loops, error } = sketchLoops(r.sketch);
    expect(error).toBeUndefined();
    // a square with one corner rounded: 400 - (25 - π·25/4)
    expect(Math.abs(area(loops[0].poly))).toBeCloseTo(400 - (25 - (Math.PI * 25) / 4), 0);
    // tangent points sit 5 from the old corner
    const arc = r.sketch.entities.find((e) => e.kind === 'arc')!;
    if (arc.kind !== 'arc') throw new Error();
    expect(pointOf(r.sketch, arc.start)).toEqual({ x: 15, y: 0 });
  });

  it('fillet: refuses a radius too big for the lines', () => {
    let err: unknown;
    produce(square(), (d) => void (err = filletCorner(d, ids(), ['b'], 50)));
    expect(err).toEqual({ error: 'The radius is too big for these lines.' });
  });

  it('offset: a square grows by 3 on every side and stays defined by its distances', () => {
    let err: unknown;
    const s = produce(square(), (d) => void (err = offsetEntities(d, ids(), ['ab', 'bc', 'cd', 'da'], 3)));
    expect(err).toBeNull();
    const r = solveSketch(s);
    expect(r.ok).toBe(true);
    const { loops } = sketchLoops(r.sketch);
    const areas = loops.map((l) => Math.abs(area(l.poly))).sort((x, y) => x - y);
    expect(areas[1]).toBeCloseTo(26 * 26, 6);
  });

  it('mirror: copies across a centerline, sharing points on the line', () => {
    const base = produce(square(), (d) => {
      d.entities.push({ id: 'm1', kind: 'point', p: { x: 0, y: -5 }, construction: false }, { id: 'm2', kind: 'point', p: { x: 0, y: 30 }, construction: false });
      d.entities.push({ id: 'axis', kind: 'line', p1: 'm1', p2: 'm2', construction: true });
    });
    let err: unknown;
    const s = produce(base, (d) => void (err = mirrorEntities(d, ids(), ['axis', 'ab', 'bc', 'cd'])));
    expect(err).toBeNull();
    const xs = s.entities.filter((e) => e.kind === 'point').map((e) => (e.kind === 'point' ? e.p.x : 0));
    expect(xs).toContain(-20); // b and c mirrored
    // a and d lie on the centerline: shared, not copied
    expect(s.entities.filter((e) => e.kind === 'point' && e.p.x === 0 && (e.p.y === 0 || e.p.y === 20))).toHaveLength(2);
  });
});

describe('trim and extend', () => {
  /** a horizontal line from 0 to 40 crossed by vertical lines at x = 10 and x = 30; another at x = 50 */
  const cross = (): Sketch => ({
    entities: [
      { id: 'a', kind: 'point', p: { x: 0, y: 0 }, construction: false },
      { id: 'b', kind: 'point', p: { x: 40, y: 0 }, construction: false },
      { id: 'h', kind: 'line', p1: 'a', p2: 'b', construction: false },
      { id: 'c', kind: 'point', p: { x: 10, y: -5 }, construction: false },
      { id: 'd', kind: 'point', p: { x: 10, y: 5 }, construction: false },
      { id: 'v1', kind: 'line', p1: 'c', p2: 'd', construction: false },
      { id: 'e', kind: 'point', p: { x: 30, y: -5 }, construction: false },
      { id: 'f', kind: 'point', p: { x: 30, y: 5 }, construction: false },
      { id: 'v2', kind: 'line', p1: 'e', p2: 'f', construction: false },
      { id: 'g', kind: 'point', p: { x: 50, y: -5 }, construction: false },
      { id: 'k', kind: 'point', p: { x: 50, y: 5 }, construction: false },
      { id: 'v3', kind: 'line', p1: 'g', p2: 'k', construction: false },
    ],
    constraints: [{ id: 'hz', kind: 'horizontal', entityIds: ['h'] }],
    dimensions: [],
  });
  const horizontals = (s: Sketch) =>
    s.entities
      .filter((e) => e.kind === 'line' && !['v1', 'v2', 'v3'].includes(e.id))
      .map((l) => (l.kind === 'line' ? [pointOf(s, l.p1).x, pointOf(s, l.p2).x].sort((x, y) => x - y) : []))
      .sort((p, q) => p[0] - q[0]);

  it('trims the middle piece between two crossings, keeping both ends', () => {
    const s = produce(cross(), (d) => void trimLine(d, ids(), 'h', { x: 20, y: 0 }));
    expect(horizontals(s)).toEqual([[0, 10], [30, 40]]);
    expect(s.constraints.filter((c) => c.kind === 'horizontal')).toHaveLength(2); // the new piece keeps it
  });

  it('trims an end piece', () => {
    const s = produce(cross(), (d) => void trimLine(d, ids(), 'h', { x: 35, y: 0 }));
    expect(horizontals(s)).toEqual([[0, 30]]);
  });

  it('removes a line that crosses nothing', () => {
    const s = produce(cross(), (d) => void trimLine(d, ids(), 'v3', { x: 50, y: 0 }));
    expect(s.entities.some((e) => e.id === 'v3')).toBe(false);
  });

  it('extends the nearer end to the next line', () => {
    const s = produce(cross(), (d) => void extendLine(d, ids(), 'h', { x: 39, y: 0 }));
    expect(horizontals(s)).toEqual([[0, 50]]);
  });

  it('says so when there is nothing to extend to', () => {
    let err: unknown;
    produce(cross(), (d) => void (err = extendLine(d, ids(), 'v1', { x: 10, y: 5 })));
    expect(err).toBe('Nothing to extend to in that direction.');
  });
});
