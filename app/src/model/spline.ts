// Splines pass through their points. Each span is a cubic Bézier built the
// Catmull-Rom way, so the curve is smooth through every point. The viewport and
// the kernel use the same spans, so what you see is what gets built.
import type { Pt } from './types';

export interface Span {
  p0: Pt;
  c1: Pt;
  c2: Pt;
  p3: Pt;
}

export function splineSpans(pts: Pt[]): Span[] {
  const spans: Span[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i - 1] ?? pts[i];
    const b = pts[i];
    const c = pts[i + 1];
    const d = pts[i + 2] ?? pts[i + 1];
    spans.push({
      p0: b,
      c1: { x: b.x + (c.x - a.x) / 6, y: b.y + (c.y - a.y) / 6 },
      c2: { x: c.x - (d.x - b.x) / 6, y: c.y - (d.y - b.y) / 6 },
      p3: c,
    });
  }
  return spans;
}

export function bezierAt(s: Span, t: number): Pt {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return { x: a * s.p0.x + b * s.c1.x + c * s.c2.x + d * s.p3.x, y: a * s.p0.y + b * s.c1.y + c * s.c2.y + d * s.p3.y };
}

/** Points along the whole spline, `per` samples per span (ends included). */
export function sampleSpline(pts: Pt[], per = 16): Pt[] {
  const spans = splineSpans(pts);
  if (!spans.length) return [...pts];
  const out: Pt[] = [spans[0].p0];
  for (const s of spans) for (let i = 1; i <= per; i++) out.push(bezierAt(s, i / per));
  return out;
}

/** The spans of the same curve walked the other way. */
export const reverseSpans = (spans: Span[]): Span[] => [...spans].reverse().map((s) => ({ p0: s.p3, c1: s.c2, c2: s.c1, p3: s.p0 }));
