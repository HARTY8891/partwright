import { describe, expect, it } from 'vitest';
import { applyEquations, evalVariables } from '../model/equations';
import { extrudeExtent } from '../model/refs';
import { planeFrame } from '../model/planes';
import type { ExtrudeFeature, PartDocument, PlaneFeature, Sketch } from '../model/types';
import { pointOf } from '../solver/solve';

const v = (id: string, name: string, expression: string) => ({ id, name, expression });

describe('variables', () => {
  it('evaluates in any order', () => {
    const r = evalVariables([v('1', 'h', 'w / 2'), v('2', 'w', '50')]);
    expect(r.values).toEqual({ w: 50, h: 25 });
    expect(r.errors).toEqual({});
  });
  it('reports circular references, bad names and duplicates', () => {
    const r = evalVariables([v('1', 'a', 'b + 1'), v('2', 'b', 'a * 2'), v('3', '2x', '1'), v('4', 'c', '1'), v('5', 'c', '2')]);
    expect(r.errors['1']).toMatch(/Circular/);
    expect(r.errors['2']).toMatch(/Circular/);
    expect(r.errors['3']).toMatch(/Names start/);
    expect(r.errors['5']).toMatch(/twice/);
  });
});

function doc(units: 'mm' | 'in' = 'mm'): PartDocument {
  const P = (id: string, x: number, y: number) => ({ id, kind: 'point' as const, p: { x, y }, construction: false });
  const L = (id: string, p1: string, p2: string) => ({ id, kind: 'line' as const, p1, p2, construction: false });
  const sketch: Sketch = {
    entities: [P('a', 0, 0), P('b', 10, 0), L('ab', 'a', 'b')],
    constraints: [{ id: 'h', kind: 'horizontal', entityIds: ['ab'] }, { id: 'f', kind: 'fix', entityIds: ['a'], at: { x: 0, y: 0 } }],
    dimensions: [{ id: 'D1', name: 'D1', kind: 'distance', entityIds: ['a', 'b'], lineId: 'ab', value: { expr: '=width', value: 10 }, driving: true }],
  };
  const ex: ExtrudeFeature = {
    id: 'ex', name: 'Extrude1', suppressed: false, type: 'extrude', sketchId: 'sk', reverse: false, merge: true,
    direction1: { type: 'blind', depth: { expr: '=width / 2', value: 5 } },
  };
  return {
    schemaVersion: 1, id: 'd', name: 'P', units, createdAt: '', updatedAt: '', rollbackIndex: 5,
    variables: [v('w', 'width', '40')],
    features: [
      { id: 'front', name: 'Front plane', suppressed: false, type: 'plane', def: { type: 'default', which: 'front' } },
      { id: 'top', name: 'Top plane', suppressed: false, type: 'plane', def: { type: 'default', which: 'top' } },
      { id: 'right', name: 'Right plane', suppressed: false, type: 'plane', def: { type: 'default', which: 'right' } },
      { id: 'sk', name: 'Sketch1', suppressed: false, type: 'sketch', on: { kind: 'plane', featureId: 'top' }, sketch },
      ex,
    ],
  };
}

describe('applyEquations', () => {
  it('drives a sketch dimension and a feature depth from a variable', () => {
    const d = applyEquations(doc());
    const sk = d.features[3] as { sketch: Sketch };
    expect(pointOf(sk.sketch, 'b').x).toBeCloseTo(40, 6);
    expect((d.features[4] as ExtrudeFeature).direction1.depth.value).toBeCloseTo(20, 9);
  });
  it('uses the part units: in an inch part, width = 2 means 50.8 mm', () => {
    const base = doc('in');
    base.variables = [v('w', 'width', '2')];
    const d = applyEquations(base);
    expect((d.features[4] as ExtrudeFeature).direction1.depth.value).toBeCloseTo(25.4, 9);
  });
});

describe('extents and planes', () => {
  it('a second direction extends the other way', () => {
    const f = { direction1: { type: 'blind' as const, depth: { expr: '10', value: 10 } }, direction2: { depth: { expr: '4', value: 4 } }, reverse: false };
    expect(extrudeExtent(f)).toEqual([-4, 10]);
    expect(extrudeExtent({ ...f, reverse: true })).toEqual([-10, 4]);
  });
  it('an offset plane sits parallel to its base', () => {
    const d = doc();
    const pl: PlaneFeature = { id: 'p4', name: 'Plane1', suppressed: false, type: 'plane', def: { type: 'offset', base: { kind: 'plane', featureId: 'top' }, distance: { expr: '15', value: 15 } } };
    d.features.push(pl);
    const f = planeFrame(d, pl)!;
    expect(f.origin).toEqual([0, 0, 15]);
    expect(f.normal).toEqual([0, 0, 1]);
  });
});
