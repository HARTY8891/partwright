import { describe, expect, it } from 'vitest';
import { solveSketch, pointOf } from '../solver/solve';
import type { Constraint, Dimension, Sketch, SketchEntity } from '../model/types';

const P = (id: string, x: number, y: number): SketchEntity => ({ id, kind: 'point', p: { x, y }, construction: false });
const L = (id: string, p1: string, p2: string): SketchEntity => ({ id, kind: 'line', p1, p2, construction: false });
const C = (id: string, kind: Constraint['kind'], ...entityIds: string[]): Constraint => ({ id, kind, entityIds });
const D = (id: string, kind: Dimension['kind'], entityIds: string[], value: number): Dimension => ({
  id, name: id, kind, entityIds, value: { expr: String(value), value }, driving: true,
});

/** two loose lines: a-b roughly along x, c-d at some angle */
const twoLines = (): Sketch => ({
  entities: [P('a', 0, 0), P('b', 10, 1), P('c', 0, 5), P('d', 8, 9), L('l1', 'a', 'b'), L('l2', 'c', 'd')],
  constraints: [],
  dimensions: [],
});
const dirOf = (s: Sketch, p: string, q: string) => {
  const A = pointOf(s, p), B = pointOf(s, q);
  return [B.x - A.x, B.y - A.y];
};
const cross = (u: number[], v: number[]) => u[0] * v[1] - u[1] * v[0];
const dotp = (u: number[], v: number[]) => u[0] * v[0] + u[1] * v[1];

describe('relations', () => {
  it('parallel', () => {
    const s = twoLines();
    s.constraints.push(C('k', 'parallel', 'l1', 'l2'));
    const r = solveSketch(s);
    expect(r.ok).toBe(true);
    expect(cross(dirOf(r.sketch, 'a', 'b'), dirOf(r.sketch, 'c', 'd'))).toBeCloseTo(0, 6);
  });

  it('perpendicular', () => {
    const s = twoLines();
    s.constraints.push(C('k', 'perpendicular', 'l1', 'l2'));
    const r = solveSketch(s);
    expect(dotp(dirOf(r.sketch, 'a', 'b'), dirOf(r.sketch, 'c', 'd'))).toBeCloseTo(0, 6);
  });

  it('equal length', () => {
    const s = twoLines();
    s.constraints.push(C('k', 'equal', 'l1', 'l2'));
    const r = solveSketch(s);
    expect(Math.hypot(...dirOf(r.sketch, 'a', 'b'))).toBeCloseTo(Math.hypot(...dirOf(r.sketch, 'c', 'd')), 6);
  });

  it('midpoint and point on line', () => {
    const s = twoLines();
    s.entities.push(P('m', 3, 3));
    s.constraints.push(C('k', 'midpoint', 'm', 'l1'), C('k2', 'pointOnObject', 'c', 'l1'));
    const r = solveSketch(s);
    const A = pointOf(r.sketch, 'a'), B = pointOf(r.sketch, 'b'), M = pointOf(r.sketch, 'm'), Cc = pointOf(r.sketch, 'c');
    expect(M.x).toBeCloseTo((A.x + B.x) / 2, 6);
    expect(M.y).toBeCloseTo((A.y + B.y) / 2, 6);
    expect(cross([B.x - A.x, B.y - A.y], [Cc.x - A.x, Cc.y - A.y])).toBeCloseTo(0, 6);
  });

  it('tangent line–circle, concentric and equal circles', () => {
    const s = twoLines();
    s.entities.push(P('o1', 5, 6), { id: 'c1', kind: 'circle', center: 'o1', radius: 2, construction: false });
    s.entities.push(P('o2', 20, 20), { id: 'c2', kind: 'circle', center: 'o2', radius: 4, construction: false });
    s.constraints.push(C('t', 'tangent', 'l1', 'c1'), C('q', 'concentric', 'c1', 'c2'));
    let r = solveSketch(s);
    expect(r.ok).toBe(true);
    const O1 = pointOf(r.sketch, 'o1'), O2 = pointOf(r.sketch, 'o2'), A = pointOf(r.sketch, 'a'), B = pointOf(r.sketch, 'b');
    const c1 = r.sketch.entities.find((e) => e.id === 'c1') as { radius: number };
    const d = Math.abs(cross([B.x - A.x, B.y - A.y], [O1.x - A.x, O1.y - A.y])) / Math.hypot(B.x - A.x, B.y - A.y);
    expect(d).toBeCloseTo(c1.radius, 6);
    expect(O1.x).toBeCloseTo(O2.x, 6);
    s.constraints.push(C('e', 'equal', 'c1', 'c2'));
    r = solveSketch(s);
    const r1 = (r.sketch.entities.find((e) => e.id === 'c1') as { radius: number }).radius;
    const r2 = (r.sketch.entities.find((e) => e.id === 'c2') as { radius: number }).radius;
    expect(r1).toBeCloseTo(r2, 6);
  });
});

describe('new dimensions', () => {
  it('angle between two lines, in degrees', () => {
    const s = twoLines();
    s.dimensions.push(D('A', 'angle', ['l1', 'l2'], 30));
    const r = solveSketch(s);
    const u = dirOf(r.sketch, 'a', 'b'), v = dirOf(r.sketch, 'c', 'd');
    const ang = (Math.acos(dotp(u, v) / (Math.hypot(...u) * Math.hypot(...v))) * 180) / Math.PI;
    expect(ang).toBeCloseTo(30, 4);
  });

  it('point-to-point distance', () => {
    const s = twoLines();
    s.dimensions.push(D('P', 'distance', ['a', 'd'], 15));
    const r = solveSketch(s);
    expect(Math.hypot(...dirOf(r.sketch, 'a', 'd'))).toBeCloseTo(15, 6);
  });

  it('point-to-line distance', () => {
    const s = twoLines();
    s.dimensions.push(D('Q', 'pointLine', ['c', 'l1'], 7));
    const r = solveSketch(s);
    const A = pointOf(r.sketch, 'a'), B = pointOf(r.sketch, 'b'), Cc = pointOf(r.sketch, 'c');
    expect(Math.abs(cross([B.x - A.x, B.y - A.y], [Cc.x - A.x, Cc.y - A.y])) / Math.hypot(B.x - A.x, B.y - A.y)).toBeCloseTo(7, 6);
  });

  it('parallel plus perpendicular on the same pair conflicts', () => {
    const s = twoLines();
    s.constraints.push(C('k', 'parallel', 'l1', 'l2'), C('k2', 'perpendicular', 'l1', 'l2'));
    expect(solveSketch(s).ok).toBe(false);
  });
});

import { polygonShape, slotShape } from '../solver/shapes';
import { sketchLoops, area } from '../kernel/profile';

describe('compound shapes', () => {
  const ids = () => {
    let n = 0;
    return () => `g${n++}`;
  };
  it('a hexagon has 4 degrees of freedom (centre, size, rotation) and closes', () => {
    const uid = ids();
    const shape = polygonShape(uid, 'c', { x: 0, y: 0 }, { x: 10, y: 0 }, 6);
    const s: Sketch = { entities: [P('c', 0, 0), ...shape.entities], constraints: shape.constraints, dimensions: [] };
    const r = solveSketch(s);
    expect(r.ok).toBe(true);
    expect(r.state).toBe('under');
    expect(r.dof).toBe(4);
    const { loops, error } = sketchLoops(r.sketch);
    expect(error).toBeUndefined();
    expect(Math.abs(area(loops[0].poly))).toBeCloseTo((3 * Math.sqrt(3) / 2) * 100, 3);
  });
  it('a slot has 5 degrees of freedom (two centres, width) and the right area', () => {
    const uid = ids();
    const shape = slotShape(uid, 'c1', { x: 0, y: 0 }, 'c2', { x: 30, y: 0 }, { x: 10, y: 5 })!;
    const s: Sketch = {
      entities: [{ id: 'c1', kind: 'point', p: { x: 0, y: 0 }, construction: true }, { id: 'c2', kind: 'point', p: { x: 30, y: 0 }, construction: true }, ...shape.entities],
      constraints: shape.constraints,
      dimensions: [],
    };
    const r = solveSketch(s);
    expect(r.ok).toBe(true);
    expect(r.state).toBe('under');
    expect(r.dof).toBe(5);
    const { loops, error } = sketchLoops(r.sketch);
    expect(error).toBeUndefined();
    // 30 × 10 rectangle + a full circle of radius 5
    // (the outline polygon samples each arc, so allow a little under the exact area)
    expect(Math.abs(area(loops[0].poly))).toBeCloseTo(300 + Math.PI * 25, -1);
  });
});
