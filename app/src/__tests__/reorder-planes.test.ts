import { describe, expect, it, beforeEach } from 'vitest';
import { useDoc } from '../store/docStore';
import { planeFrame } from '../model/planes';
import type { PlaneFeature } from '../model/types';

const S = () => useDoc.getState();
const names = () => S().doc.features.map((f) => f.name);

function block(depth: number) {
  S().beginSketch(S().doc.features[1].id);
  S().addRect({ at: { x: 0, y: 0 } }, { at: { x: 60, y: 40 } });
  S().beginFeature('extrude');
  S().updateDraft((d) => void ('direction1' in d && (d.direction1.depth = { expr: String(depth), value: depth })));
  S().confirmFeature();
}

describe('reordering features', () => {
  beforeEach(() => S().newDoc());

  it('moves a feature together with its sketch', () => {
    block(10); // Sketch1 Extrude1
    block(20); // Sketch2 Extrude2
    const e2 = S().doc.features.find((f) => f.name === 'Extrude2')!.id;
    expect(S().moveFeature(e2, 3)).toBe(true);
    expect(names().slice(3)).toEqual(['Sketch2', 'Extrude2', 'Sketch1', 'Extrude1']);
  });

  it('refuses to move a feature above what it depends on', () => {
    block(10);
    const ex = S().doc.features[4].id;
    S().beginSketch({ kind: 'face', face: { kind: 'cap', featureId: ex, cap: 'end', flip: false } });
    S().addCircle({ at: { x: 30, y: 20 } }, 5);
    S().beginFeature('cutExtrude');
    S().confirmFeature();
    const cut = S().doc.features.find((f) => f.name === 'Cut1')!.id;
    expect(S().moveFeature(cut, 3)).toBe(false); // Cut1's sketch sits on Extrude1's face
    expect(names().slice(3)).toEqual(['Sketch1', 'Extrude1', 'Sketch2', 'Cut1']);
  });

  it('default planes never move, and nothing goes above them', () => {
    block(10);
    expect(S().moveFeature(S().doc.features[0].id, 4)).toBe(false);
    const ex = S().doc.features[4].id;
    S().moveFeature(ex, 0);
    expect(names().slice(0, 3)).toEqual(['Front plane', 'Top plane', 'Right plane']);
  });
});

describe('angled planes', () => {
  it('turning the Top plane 90° about its x axis gives the Front plane orientation', () => {
    S().newDoc();
    const doc = S().doc;
    const pl: PlaneFeature = { id: 'p', name: 'Plane1', suppressed: false, type: 'plane', def: { type: 'angle', base: { kind: 'plane', featureId: doc.features[1].id }, axis: 'x', angle: { expr: '90', value: 90 } } };
    const f = planeFrame({ ...doc, features: [...doc.features, pl] }, pl)!;
    expect(f.normal[0]).toBeCloseTo(0, 9);
    expect(f.normal[1]).toBeCloseTo(-1, 9);
    expect(f.normal[2]).toBeCloseTo(0, 9);
    expect(f.xDir).toEqual([1, 0, 0]);
  });
  it('45° about the y axis tilts the normal halfway towards x', () => {
    S().newDoc();
    const doc = S().doc;
    const pl: PlaneFeature = { id: 'p', name: 'Plane1', suppressed: false, type: 'plane', def: { type: 'angle', base: { kind: 'plane', featureId: doc.features[1].id }, axis: 'y', angle: { expr: '45', value: 45 } } };
    const f = planeFrame({ ...doc, features: [...doc.features, pl] }, pl)!;
    expect(f.normal[0]).toBeCloseTo(Math.SQRT1_2, 9);
    expect(f.normal[2]).toBeCloseTo(Math.SQRT1_2, 9);
    // still a proper right-handed frame
    const c = [f.xDir[1] * f.yDir[2] - f.xDir[2] * f.yDir[1], f.xDir[2] * f.yDir[0] - f.xDir[0] * f.yDir[2], f.xDir[0] * f.yDir[1] - f.xDir[1] * f.yDir[0]];
    c.forEach((v, i) => expect(v).toBeCloseTo(f.normal[i], 9));
  });
});
