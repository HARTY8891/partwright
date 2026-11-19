// Shared helpers for the Partwright end-to-end specs.
// UI steps use roles and labels. The 3D view is a canvas, so clicks in it are
// placed by projecting world points through the live camera. Assertions read the
// app's stores through the dev-only window.__pw hook.
import { expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

export type V3 = [number, number, number];

/** Fail the test on any console error or 5xx response. */
export function guard(page: Page) {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/WebSocket connection to 'ws:\/\/localhost/.test(t)) return; // Vite HMR reconnect noise
    errors.push(t);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 500) errors.push(`${r.status()} on ${r.url()}`);
  });
  return () => expect(errors, 'console errors').toEqual([]);
}

export async function openApp(page: Page, opts: { keepPicker?: boolean } = {}) {
  // Chromium has the native save picker; tests use the download fallback unless they stub it.
  if (!opts.keepPicker) await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined }));
  await page.goto('/');
  await page.waitForFunction(() => {
    const pw = (window as any).__pw;
    return pw && !pw.useKernel.getState().loading && !pw.useKernel.getState().busy;
  }, null, { timeout: 60_000 });
}

/** Wait for rebuilds (and an open feature preview) to settle. */
export async function settle(page: Page) {
  await page.waitForTimeout(150);
  await page.waitForFunction(() => !(window as any).__pw.useKernel.getState().busy, null, { timeout: 30_000 });
  await page.waitForTimeout(250);
}

export async function volume(page: Page): Promise<number> {
  await settle(page);
  return page.evaluate(() => (window as any).__pw.useKernel.getState().volume);
}

export const featureNames = (page: Page) =>
  page.evaluate(() => (window as any).__pw.useDoc.getState().doc.features.map((f: any) => f.name) as string[]);

export const store = <T>(page: Page, fn: string) => page.evaluate(`(() => { const S = () => window.__pw.useDoc.getState(); const K = () => window.__pw.useKernel.getState(); ${fn} })()`) as Promise<T>;

/** Screen position of a world point through the current camera. */
export async function screenOf(page: Page, p: V3) {
  return page.evaluate(([x, y, z]) => {
    const scene = (window as any).__scene;
    const cam = scene.children.find((o: any) => o.isCamera);
    cam.updateMatrixWorld();
    const v = cam.position.clone().set(x, y, z).project(cam);
    const r = document.querySelector('canvas')!.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }, p);
}

export async function clickWorld(page: Page, p: V3) {
  const s = await screenOf(page, p);
  await page.mouse.move(s.x, s.y);
  await page.mouse.click(s.x, s.y);
  await page.waitForTimeout(60);
}

/** World position of a sketch-local point in the active sketch. */
export async function sketchToWorld(page: Page, x: number, y: number): Promise<V3> {
  return page.evaluate(([x, y]) => {
    const pw = (window as any).__pw;
    const s = pw.useDoc.getState();
    const f = pw.frameForSketch(s.doc, s.mode.sketchId);
    return pw.toWorld(f, { x, y }, 0);
  }, [x, y]);
}

export async function clickSketch(page: Page, x: number, y: number) {
  await clickWorld(page, await sketchToWorld(page, x, y));
}

/** Midpoints (sketch coords) of the lines in the active sketch, in creation order. */
export async function sketchLineMids(page: Page): Promise<{ id: string; x: number; y: number }[]> {
  return page.evaluate(() => {
    const s = (window as any).__pw.useDoc.getState();
    const sk = s.doc.features.find((f: any) => f.id === s.mode.sketchId).sketch;
    const P = (id: string) => sk.entities.find((e: any) => e.id === id).p;
    return sk.entities
      .filter((e: any) => e.kind === 'line' && !e.construction)
      .map((l: any) => ({ id: l.id, x: (P(l.p1).x + P(l.p2).x) / 2, y: (P(l.p1).y + P(l.p2).y) / 2 }));
  });
}

/** Type into the inline dimension editor that opens after placing a dimension. */
export async function typeDimension(page: Page, value: string) {
  const input = page.getByRole('dialog', { name: /^Change D\d+/ }).getByRole('textbox');
  await expect(input).toBeFocused();
  await input.fill(value);
  await input.press('Enter');
  await expect(input).toBeHidden();
}

/** Build a 60×40×h block on the Top plane through the store (setup for later flows). */
export async function seedBlock(page: Page, h = 25) {
  await store(page, `
    const top = S().doc.features[1].id;
    S().beginSketch(top);
    S().addRect({ at: { x: 0, y: 0 } }, { at: { x: 60, y: 40 } });
    S().beginFeature('extrude');
    S().updateDraft((d) => { d.direction1.depth = { expr: '${h}', value: ${h} }; });
    S().confirmFeature();
    S().select(null);
  `);
  await settle(page);
}

export async function iso(page: Page) {
  await page.evaluate(() => (window as any).__pw.useView.getState().go('iso'));
  await page.waitForTimeout(100);
}

/** axe scan; returns serious/critical violations only. */
export async function a11y(page: Page) {
  const res = await new AxeBuilder({ page }).analyze();
  return res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.length} × ${v.help}`);
}

export const toast = (page: Page, text: string | RegExp) => page.getByText(text).first();
