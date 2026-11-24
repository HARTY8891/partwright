import { describe, expect, it } from 'vitest';
import { holeProfile, holeSize, ISO_HOLES } from '../model/holes';

describe('hole wizard', () => {
  it('every ISO size has a tap drill < clearance < counterbore and countersink', () => {
    for (const h of ISO_HOLES) {
      expect(h.tap).toBeLessThan(h.clearance);
      expect(h.clearance).toBeLessThan(h.cboreD);
      expect(h.clearance).toBeLessThan(h.csinkD);
    }
    expect(holeSize('M6')?.clearance).toBe(6.6);
    expect(holeSize('M7')).toBeUndefined();
  });

  it('a simple hole is a rectangle from the axis', () => {
    expect(holeProfile('simple', 10, 20)).toEqual([[0, 0], [5, 0], [5, 20], [0, 20]]);
  });

  it('a 90° countersink is as deep as it is wide over the hole', () => {
    const p = holeProfile('countersink', 6, 20, undefined, { d: 12, angle: 90 });
    expect(Array.isArray(p) && p[2][0]).toBe(3);
    expect(Array.isArray(p) && p[2][1]).toBeCloseTo(3, 9);
  });

  it('explains impossible sizes', () => {
    expect(holeProfile('counterbore', 6, 20, { d: 5, depth: 3 })).toEqual({ error: 'The counterbore must be wider than the hole.' });
    expect(holeProfile('counterbore', 6, 20, { d: 10, depth: 25 })).toHaveProperty('error');
    expect(holeProfile('countersink', 6, 2, undefined, { d: 20, angle: 90 })).toEqual({ error: 'The countersink is deeper than the hole.' });
    expect(holeProfile('simple', 0, 20)).toHaveProperty('error');
  });
});
