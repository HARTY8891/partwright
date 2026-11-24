import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import { addConvertedEdges, patternEntities } from '../solver/modify';
import { solveSketch, pointOf } from '../solver/solve';
import { sketchLoops, area } from '../kernel/profile';
import { patternPoints } from '../model/refs';
import type { Sketch } from '../model/types';

const ids = () => {
  let n = 0;
  return () => `n${n++}`;
};
const circleAt = (x: number, y: number, r: number): Sketch => ({
  entities: [
    { id: 'o', kind: 'point', p: { x: 0, y: 0 }, construction: true },
    { id: 'c', kind: 'point', p: { x, y }, construction: false },
    { id: 'k', kind: 'circle', center: 'c', radius: r, construction: false },
  ],
  constraints: [],
  dimensions: [],
});
const centres = (s: Sketch) => s.entities.filter((e) => e.kind === 'circle').map((e) => e.kind === 'circle' && pointOf(s, e.center));

describe('sketch patterns', () => {
  it('linear: copies in a row along a direction', () => {
    let err: unknown;
    const s = produce(circleAt(5, 0, 2), (d) => void (err = patternEntities(d, ids(), ['k'], { kind: 'linear', count: 3, spacing: 10, angle: 90 })));
    expect(err).toBeNull();
    const c = centres(s) as { x: number; y: number }[];
    expect(c.map((p) => [+p.x.toFixed(6), +p.y.toFixed(6)])).toEqual([[5, 0], [5, 10], [5, 20]]);
    expect(sketchLoops(s).loops.length).toBe(3);
  });

  it('circular: evenly round the origin, or round a selected point over a partial angle', () => {
    const full = produce(circleAt(10, 0, 1), (d) => void patternEntities(d, ids(), ['k'], { kind: 'circular', count: 4, total: 360 }));
    const c = centres(full) as { x: number; y: number }[];
    expect(c.map((p) => [Math.round(p.x) + 0, Math.round(p.y) + 0])).toEqual([[10, 0], [0, 10], [-10, 0], [0, -10]]);
    const base = circleAt(10, 0, 1);
    base.entities.push({ id: 'pc', kind: 'point', p: { x: 10, y: 5 }, construction: false });
    const part = produce(base, (d) => void patternEntities(d, ids(), ['k', 'pc'], { kind: 'circular', count: 3, total: 180 }));
    const q = centres(part) as { x: number; y: number }[];
    expect(q.map((p) => [Math.round(p.x) + 0, Math.round(p.y) + 0])).toEqual([[10, 0], [15, 5], [10, 10]]);
  });

  it('a square patterned keeps closed outlines and the solver is happy', () => {
    const sq: Sketch = {
      entities: [
        { id: 'a', kind: 'point', p: { x: 0, y: 0 }, construction: false },
        { id: 'b', kind: 'point', p: { x: 4, y: 0 }, construction: false },
        { id: 'c', kind: 'point', p: { x: 4, y: 4 }, construction: false },
        { id: 'ab', kind: 'line', p1: 'a', p2: 'b', construction: false },
        { id: 'bc', kind: 'line', p1: 'b', p2: 'c', construction: false },
        { id: 'ca', kind: 'line', p1: 'c', p2: 'a', construction: false },
      ],
      constraints: [],
      dimensions: [],
    };
    const s = produce(sq, (d) => void patternEntities(d, ids(), ['ab', 'bc', 'ca'], { kind: 'linear', count: 2, spacing: 10, angle: 0 }));
    const { loops } = sketchLoops(s);
    expect(loops.length).toBe(2);
    expect(loops.map((l) => Math.abs(area(l.poly)))).toEqual([8, 8]);
    expect(solveSketch(s).ok).toBe(true);
  });

  it('explains a bad selection', () => {
    const s = circleAt(0, 0, 1);
    expect(produce(s, (d) => void expect(patternEntities(d, ids(), ['c'], { kind: 'linear', count: 3, spacing: 5, angle: 0 })).toMatch(/Select the lines/))).toBeTruthy();
    produce(s, (d) => void expect(patternEntities(d, ids(), ['k'], { kind: 'linear', count: 1, spacing: 5, angle: 0 })).toMatch(/between 2 and 200/));
  });
});

describe('convert edges and pattern points', () => {
  it('converted lines share their ends, are fixed, and make a closed outline', () => {
    const empty: Sketch = { entities: [], constraints: [], dimensions: [] };
    const P = (x: number, y: number) => ({ x, y });
    const s = produce(empty, (d) =>
      void addConvertedEdges(d, ids(), [
        { kind: 'line', a: P(0, 0), b: P(10, 0) },
        { kind: 'line', a: P(10, 0), b: P(10, 10) },
        { kind: 'arc', a: P(10, 10), m: P(5, 15), b: P(0, 10) },
        { kind: 'line', a: P(0, 10), b: P(0, 0) },
        { kind: 'circle', c: P(5, 5), r: 2 },
      ]),
    );
    const { loops } = sketchLoops(s);
    expect(loops.length).toBe(2);
    const outer = Math.max(...loops.map((l) => Math.abs(area(l.poly))));
    expect(outer).toBeCloseTo(100 + (Math.PI * 25) / 2, 0); // the arc is measured as a polygon
    const r = solveSketch(s);
    expect(r.ok && r.state).toBe('full');
  });

  it('pattern points are free points and circle centres, not line ends or construction', () => {
    const s: Sketch = {
      entities: [
        { id: 'o', kind: 'point', p: { x: 0, y: 0 }, construction: true },
        { id: 'p', kind: 'point', p: { x: 3, y: 4 }, construction: false },
        { id: 'a', kind: 'point', p: { x: 1, y: 1 }, construction: false },
        { id: 'b', kind: 'point', p: { x: 2, y: 1 }, construction: false },
        { id: 'l', kind: 'line', p1: 'a', p2: 'b', construction: false },
        { id: 'c', kind: 'point', p: { x: 7, y: 7 }, construction: false },
        { id: 'k', kind: 'circle', center: 'c', radius: 1, construction: false },
      ],
      constraints: [],
      dimensions: [],
    };
    expect(patternPoints(s)).toEqual([{ x: 3, y: 4 }, { x: 7, y: 7 }]);
  });
});
