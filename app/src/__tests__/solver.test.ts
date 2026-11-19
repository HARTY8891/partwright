import { describe, expect, it } from 'vitest';
import { solveSketch, pointOf } from '../solver/solve';
import { sketchLoops, nestLoops, area } from '../kernel/profile';
import type { Sketch } from '../model/types';

/** Rectangle like the Rectangle tool makes: 4 points, 4 lines, H/V relations, plus the fixed origin. */
function rect(x0: number, y0: number, x1: number, y1: number): Sketch {
  const P = (id: string, x: number, y: number) => ({ id, kind: 'point' as const, p: { x, y }, construction: false });
  const L = (id: string, p1: string, p2: string) => ({ id, kind: 'line' as const, p1, p2, construction: false });
  return {
    entities: [
      { id: 'o', kind: 'point', p: { x: 0, y: 0 }, construction: true },
      P('a', x0, y0), P('b', x1, y0), P('c', x1, y1), P('d', x0, y1),
      L('ab', 'a', 'b'), L('bc', 'b', 'c'), L('cd', 'c', 'd'), L('da', 'd', 'a'),
    ],
    constraints: [
      { id: 'fix', kind: 'fix', entityIds: ['o'], at: { x: 0, y: 0 } },
      { id: 'h1', kind: 'horizontal', entityIds: ['ab'] },
      { id: 'v1', kind: 'vertical', entityIds: ['bc'] },
      { id: 'h2', kind: 'horizontal', entityIds: ['cd'] },
      { id: 'v2', kind: 'vertical', entityIds: ['da'] },
    ],
    dimensions: [],
  };
}
const dim = (id: string, a: string, b: string, value: number) => ({
  id, name: id, kind: 'distance' as const, entityIds: [a, b] as [string, string], value: { expr: String(value), value }, driving: true,
});

describe('solver', () => {
  it('a bare rectangle has 4 degrees of freedom', () => {
    const r = solveSketch(rect(0, 0, 10, 5));
    expect(r.ok).toBe(true);
    expect(r.state).toBe('under');
    expect(r.dof).toBe(4);
  });

  it('dimensions drive the size and remove freedom', () => {
    const s = rect(0, 0, 10, 5);
    s.dimensions.push(dim('D1', 'a', 'b', 60), dim('D2', 'b', 'c', 40));
    const r = solveSketch(s);
    expect(r.ok).toBe(true);
    expect(r.dof).toBe(2);
    const a = pointOf(r.sketch, 'a'), b = pointOf(r.sketch, 'b'), c = pointOf(r.sketch, 'c');
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(60, 6);
    expect(Math.hypot(c.x - b.x, c.y - b.y)).toBeCloseTo(40, 6);
    expect(b.y).toBeCloseTo(a.y, 9); // still horizontal
  });

  it('pinning a corner to the origin fully defines it', () => {
    const s = rect(0, 0, 10, 5);
    s.constraints.push({ id: 'co', kind: 'coincident', entityIds: ['a', 'o'] });
    s.dimensions.push(dim('D1', 'a', 'b', 60), dim('D2', 'b', 'c', 40));
    const r = solveSketch(s);
    expect(r.state).toBe('full');
    expect(r.dof).toBe(0);
    expect(['a', 'b', 'c', 'd'].every((p) => r.defined.has(p))).toBe(true);
  });

  it('a duplicate dimension over-defines the sketch', () => {
    const s = rect(0, 0, 10, 5);
    s.dimensions.push(dim('D1', 'a', 'b', 60), dim('D2', 'c', 'd', 60));
    const r = solveSketch(s);
    expect(r.state).toBe('over');
  });

  it('conflicting dimensions do not converge', () => {
    const s = rect(0, 0, 10, 5);
    s.dimensions.push(dim('D1', 'a', 'b', 60), dim('D2', 'c', 'd', 30));
    expect(solveSketch(s).ok).toBe(false);
  });
});

describe('profile', () => {
  it('finds one closed loop in a rectangle', () => {
    const { loops, error } = sketchLoops(rect(0, 0, 10, 5));
    expect(error).toBeUndefined();
    expect(loops).toHaveLength(1);
    expect(Math.abs(area(loops[0].poly))).toBeCloseTo(50);
  });

  it('reports an open outline', () => {
    const s = rect(0, 0, 10, 5);
    s.entities = s.entities.filter((e) => e.id !== 'da');
    expect(sketchLoops(s).error).toMatch(/open end/);
  });

  it('nests a hole inside an outline', () => {
    const outer = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const hole = [{ x: 4, y: 4 }, { x: 6, y: 4 }, { x: 6, y: 6 }, { x: 4, y: 6 }];
    const g = nestLoops([{ poly: hole }, { poly: outer }]);
    expect(g).toHaveLength(1);
    expect(g[0].holes).toHaveLength(1);
  });
});

describe('circles and arcs', () => {
  const base = (): Sketch => ({
    entities: [
      { id: 'o', kind: 'point', p: { x: 0, y: 0 }, construction: true },
      { id: 'c', kind: 'point', p: { x: 5, y: 5 }, construction: false },
      { id: 'circ', kind: 'circle', center: 'c', radius: 3, construction: false },
    ],
    constraints: [{ id: 'fix', kind: 'fix', entityIds: ['o'], at: { x: 0, y: 0 } }],
    dimensions: [],
  });

  it('a diameter dimension drives the radius', () => {
    const s = base();
    s.dimensions.push({ id: 'D1', name: 'D1', kind: 'diameter', entityIds: ['circ'], value: { expr: '20', value: 20 }, driving: true });
    const r = solveSketch(s);
    const c = r.sketch.entities.find((e) => e.id === 'circ');
    expect(c && c.kind === 'circle' && c.radius).toBeCloseTo(10, 6);
    expect(r.dof).toBe(2); // centre still free
  });

  it('a circle is its own closed outline', () => {
    const { loops, error } = sketchLoops(base());
    expect(error).toBeUndefined();
    expect(loops[0].kind).toBe('circle');
  });

  it('an arc keeps equal radii and closes an outline with two lines', () => {
    // a "D" shape: line a-b, line b-c... arc c->a around centre m
    const s: Sketch = {
      entities: [
        { id: 'a', kind: 'point', p: { x: 0, y: 0 }, construction: false },
        { id: 'b', kind: 'point', p: { x: 10, y: 0 }, construction: false },
        { id: 'm', kind: 'point', p: { x: 5, y: 0 }, construction: true },
        { id: 'ab', kind: 'line', p1: 'a', p2: 'b', construction: false },
        { id: 'arc', kind: 'arc', center: 'm', start: 'b', end: 'a', ccw: true, construction: false },
      ],
      constraints: [],
      dimensions: [{ id: 'R', name: 'D1', kind: 'radius', entityIds: ['arc'], value: { expr: '6', value: 6 }, driving: true }],
    };
    const r = solveSketch(s);
    expect(r.ok).toBe(true);
    const P = (id: string) => pointOf(r.sketch, id);
    const m = P('m');
    expect(Math.hypot(P('a').x - m.x, P('a').y - m.y)).toBeCloseTo(6, 6);
    expect(Math.hypot(P('b').x - m.x, P('b').y - m.y)).toBeCloseTo(6, 6);
    const { loops, error } = sketchLoops(r.sketch);
    expect(error).toBeUndefined();
    expect(loops).toHaveLength(1);
    // half disc of radius 6: area = pi*36/2
    expect(Math.abs(area(loops[0].poly))).toBeGreaterThan(50);
  });
});
