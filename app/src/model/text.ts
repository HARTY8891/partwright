// Text in a sketch: letter outlines from the bundled open font (IBM Plex Sans,
// SIL Open Font Licence), as closed outlines the profile code can build from.
// Pure once the font is loaded; the viewport and the kernel each load it once.
import { parse, type Font } from 'opentype.js';
import { useSyncExternalStore } from 'react';
import fontUrl from '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-500-normal.woff?url';
import type { Pt } from './types';
import type { Span } from './spline';

let font: Font | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

/** Load the font (once). Resolves when text can be built. */
export function loadSketchFont(): Promise<void> {
  loading ??= fetch(fontUrl)
    .then((r) => r.arrayBuffer())
    .then((buf) => setSketchFont(buf));
  return loading;
}

export function setSketchFont(buf: ArrayBuffer) {
  font = parse(buf);
  for (const l of listeners) l();
}

export const sketchFontReady = () => !!font;
/** React: re-render once the font has loaded (and start loading it). */
export function useSketchFont() {
  void loadSketchFont();
  return useSyncExternalStore(onSketchFont, sketchFontReady);
}
export function onSketchFont(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

export type TextStep = { kind: 'line'; to: Pt } | { kind: 'bezier'; to: Pt; spans: Span[] };
export interface TextContour {
  start: Pt;
  steps: TextStep[];
  /** points along it, for area and containment tests and for drawing */
  poly: Pt[];
}

/**
 * The outlines of `text` with its baseline starting at `at`. `height` is the
 * height of a capital letter; `angle` turns the text (degrees, anticlockwise).
 */
export function textContours(text: string, at: Pt, height: number, angle = 0): TextContour[] | { error: string } {
  if (!font) return { error: 'The text font is still loading. Try again in a moment.' };
  if (!text.trim()) return { error: 'The text is empty.' };
  if (!(height > 0)) return { error: 'The text height must be more than zero.' };
  const os2 = (font.tables as { os2?: { sCapHeight?: number } }).os2;
  const cap = os2?.sCapHeight || font.unitsPerEm * 0.7;
  const size = (height * font.unitsPerEm) / cap;
  const path = font.getPath(text, 0, 0, size);
  const [cs, sn] = [Math.cos((angle * Math.PI) / 180), Math.sin((angle * Math.PI) / 180)];
  // the font draws y downwards from the baseline
  const T = (x: number, y: number): Pt => ({ x: at.x + x * cs + y * sn, y: at.y + x * sn - y * cs });
  const out: TextContour[] = [];
  let cur: TextContour | null = null;
  let last: Pt = { x: 0, y: 0 };
  const same = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-9;
  const finish = () => {
    if (!cur) return;
    if (!same(last, cur.start)) {
      cur.steps.push({ kind: 'line', to: cur.start });
      cur.poly.push(cur.start);
    }
    cur.poly.pop(); // the closing point repeats the start
    if (cur.steps.length >= 2 && Math.abs(polyArea(cur.poly)) > 1e-12) out.push(cur);
    cur = null;
  };
  for (const c of path.commands) {
    if (c.type === 'M') {
      finish();
      last = T(c.x, c.y);
      cur = { start: last, steps: [], poly: [last] };
    } else if (!cur) continue;
    else if (c.type === 'L') {
      const to = T(c.x, c.y);
      if (same(to, last)) continue;
      cur.steps.push({ kind: 'line', to });
      cur.poly.push(to);
      last = to;
    } else if (c.type === 'Q' || c.type === 'C') {
      const to = T(c.x, c.y);
      const [c1, c2] =
        c.type === 'Q'
          ? (() => {
              const q = T(c.x1, c.y1);
              return [{ x: last.x + ((q.x - last.x) * 2) / 3, y: last.y + ((q.y - last.y) * 2) / 3 }, { x: to.x + ((q.x - to.x) * 2) / 3, y: to.y + ((q.y - to.y) * 2) / 3 }];
            })()
          : [T(c.x1, c.y1), T(c.x2, c.y2)];
      const span: Span = { p0: last, c1, c2, p3: to };
      cur.steps.push({ kind: 'bezier', to, spans: [span] });
      for (let i = 1; i <= 6; i++) cur.poly.push(cubic(span, i / 6));
      last = to;
    } else if (c.type === 'Z') {
      finish();
    }
  }
  finish();
  if (!out.length) return { error: 'The text has no letters to build (spaces only?).' };
  return out;
}

function cubic(s: Span, t: number): Pt {
  const u = 1 - t;
  return {
    x: u * u * u * s.p0.x + 3 * u * u * t * s.c1.x + 3 * u * t * t * s.c2.x + t * t * t * s.p3.x,
    y: u * u * u * s.p0.y + 3 * u * u * t * s.c1.y + 3 * u * t * t * s.c2.y + t * t * t * s.p3.y,
  };
}

function polyArea(p: Pt[]) {
  let a = 0;
  for (let i = 0; i < p.length; i++) a += p[i].x * p[(i + 1) % p.length].y - p[(i + 1) % p.length].x * p[i].y;
  return a / 2;
}
