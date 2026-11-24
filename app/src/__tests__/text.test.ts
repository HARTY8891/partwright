import { beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error: tests run in Node; the app's types leave Node out
import { readFileSync } from 'node:fs';
import { setSketchFont, textContours } from '../model/text';
import { sketchLoops, nestLoops, area } from '../kernel/profile';
import type { Sketch } from '../model/types';

beforeAll(() => {
  const b = readFileSync('node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-500-normal.woff');
  setSketchFont(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
});

const box = (cs: { poly: { x: number; y: number }[] }[]) => {
  const all = cs.flatMap((c) => c.poly);
  return { x0: Math.min(...all.map((p) => p.x)), x1: Math.max(...all.map((p) => p.x)), y0: Math.min(...all.map((p) => p.y)), y1: Math.max(...all.map((p) => p.y)) };
};

describe('sketch text', () => {
  it('a capital H is as tall as asked, standing on the baseline, reading left to right', () => {
    const cs = textContours('H', { x: 10, y: 5 }, 8);
    if ('error' in cs) throw new Error(cs.error);
    expect(cs.length).toBe(1);
    const b = box(cs);
    expect(b.y0).toBeCloseTo(5, 6);
    expect(b.y1).toBeCloseTo(13, 6);
    expect(b.x0).toBeGreaterThan(10);
    const two = textContours('HI', { x: 10, y: 5 }, 8);
    if ('error' in two) throw new Error(two.error);
    expect(box(two).x1).toBeGreaterThan(b.x1 + 1);
  });

  it('turns with the angle: at 90° the text reads upwards', () => {
    const cs = textContours('HHH', { x: 0, y: 0 }, 5, 90);
    if ('error' in cs) throw new Error(cs.error);
    const b = box(cs);
    expect(b.y1 - b.y0).toBeGreaterThan(b.x1 - b.x0);
    expect(b.x1).toBeCloseTo(0, 6); // letters stand to the left of the baseline when turned anticlockwise
  });

  it('letters become profile loops, with holes: "O" is a ring, "AB" has holes', () => {
    const sk: Sketch = {
      entities: [
        { id: 'p', kind: 'point', p: { x: 0, y: 0 }, construction: false },
        { id: 't', kind: 'text', at: 'p', text: 'OB', height: 10, angle: 0, construction: false },
      ],
      constraints: [],
      dimensions: [],
    };
    const { loops, error } = sketchLoops(sk);
    expect(error).toBeUndefined();
    const groups = nestLoops(loops);
    expect(groups.length).toBe(2); // O and B
    expect(groups.map((g) => g.holes.length).sort()).toEqual([1, 2]);
    for (const g of groups) for (const h of g.holes) expect(Math.abs(area(h.poly))).toBeLessThan(Math.abs(area(g.outer.poly)));
  });

  it('explains empty text', () => {
    expect(textContours('  ', { x: 0, y: 0 }, 5)).toHaveProperty('error');
    expect(textContours('A', { x: 0, y: 0 }, 0)).toHaveProperty('error');
  });
});
