import { describe, expect, it } from 'vitest';
import { edgePoint, extrudeExtent, faceFrame, pickFace, candidateEdges } from '../model/refs';
import { frameForSketch } from '../model/planes';
import type { ExtrudeFeature, PartDocument, Sketch } from '../model/types';

const P = (id: string, x: number, y: number) => ({ id, kind: 'point' as const, p: { x, y }, construction: false });
const L = (id: string, p1: string, p2: string) => ({ id, kind: 'line' as const, p1, p2, construction: false });
const rect: Sketch = {
  entities: [P('a', 0, 0), P('b', 60, 0), P('c', 60, 40), P('d', 0, 40), L('ab', 'a', 'b'), L('bc', 'b', 'c'), L('cd', 'c', 'd'), L('da', 'd', 'a')],
  constraints: [],
  dimensions: [],
};

function doc(depth = 25): PartDocument {
  const ex: ExtrudeFeature = {
    id: 'ex', name: 'Extrude1', suppressed: false, type: 'extrude', sketchId: 'sk', reverse: false, merge: true,
    direction1: { type: 'blind', depth: { expr: String(depth), value: depth } },
  };
  return {
    schemaVersion: 1, id: 'd', name: 'P', units: 'mm', createdAt: '', updatedAt: '', rollbackIndex: 5,
    features: [
      { id: 'front', name: 'Front plane', suppressed: false, type: 'plane', def: { type: 'default', which: 'front' } },
      { id: 'top', name: 'Top plane', suppressed: false, type: 'plane', def: { type: 'default', which: 'top' } },
      { id: 'right', name: 'Right plane', suppressed: false, type: 'plane', def: { type: 'default', which: 'right' } },
      { id: 'sk', name: 'Sketch1', suppressed: false, type: 'sketch', on: { kind: 'plane', featureId: 'top' }, sketch: rect },
      ex,
    ],
  };
}

describe('persistent face and edge names', () => {
  it('extents follow the end condition', () => {
    const f = (type: 'blind' | 'midPlane', reverse = false) => ({ direction1: { type, depth: { expr: '10', value: 10 } }, reverse });
    expect(extrudeExtent(f('blind'))).toEqual([0, 10]);
    expect(extrudeExtent(f('blind', true))).toEqual([-10, 0]);
    expect(extrudeExtent(f('midPlane'))).toEqual([-5, 5]);
  });

  it('the end cap moves with the depth', () => {
    const ref = { kind: 'cap' as const, featureId: 'ex', cap: 'end' as const, flip: false };
    expect(faceFrame(doc(25), ref)!.origin[2]).toBeCloseTo(25);
    expect(faceFrame(doc(40), ref)!.origin[2]).toBeCloseTo(40);
  });

  it('a sketch on the end cap follows it', () => {
    const d = doc(25);
    d.features.push({ id: 'sk2', name: 'Sketch2', suppressed: false, type: 'sketch', on: { kind: 'face', face: { kind: 'cap', featureId: 'ex', cap: 'end', flip: false } }, sketch: { entities: [], constraints: [], dimensions: [] } });
    expect(frameForSketch(d, 'sk2')!.origin[2]).toBeCloseTo(25);
    expect(frameForSketch(d, 'sk2')!.normal).toEqual([0, 0, 1]);
  });

  it('picks the top face and a side face from a click', () => {
    const top = pickFace(doc(), [30, 20, 25], [0, 0, 1]);
    expect(top).toEqual({ kind: 'cap', featureId: 'ex', cap: 'end', flip: false });
    const side = pickFace(doc(), [30, 0, 10], [0, -1, 0]);
    expect(side?.kind).toBe('side');
    expect(side && side.kind === 'side' && side.segmentId).toBe('ab');
    expect(pickFace(doc(), [100, 100, 25], [0, 0, 1])).toBeNull();
  });

  it('edge midpoints are recomputed from parameters', () => {
    const ref = { kind: 'capEdge' as const, featureId: 'ex', cap: 'end' as const, segmentId: 'ab' };
    expect(edgePoint(doc(25), ref)).toEqual([30, 0, 25]);
    expect(edgePoint(doc(10), ref)).toEqual([30, 0, 10]);
    const side = { kind: 'sideEdge' as const, featureId: 'ex', pointId: 'b' };
    expect(edgePoint(doc(20), side)).toEqual([60, 0, 10]);
  });

  it('a box has 12 named edges', () => {
    expect(candidateEdges(doc())).toHaveLength(12);
  });
});
