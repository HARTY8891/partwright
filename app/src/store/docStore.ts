// Document store. Every change to the part goes through a command here, which
// gives undo/redo (document snapshots) and one place that runs the sketch solver.
import { create } from 'zustand';
import { produce, type Draft } from 'immer';
import type {
  ConstraintKind, Dimension, EdgeRef, Feature, FeatureDraft, Id, PartDocument, PlaneWhich, Pt, Sketch, SketchFeature,
  SketchSupport, Variable, FacePoint, FaceRef, Configuration, VertexRef,
} from '../model/types';
import { SCHEMA_VERSION, sketchesOf, isSeedType } from '../model/types';
import { solveSketch, pointOf, type SolveResult } from '../solver/solve';
import { sameEdge } from '../model/refs';
import { applyEquations } from '../model/equations';
import { axisInputs } from '../model/axes';
import { rawVertexDepth, resolveVertexDepths } from '../model/refs';
import { polygonShape, slotShape } from '../solver/shapes';
import { addConvertedEdges, extendLine, filletCorner, mirrorEntities, offsetEntities, patternEntities, trimLine, type SketchPatternOptions } from '../solver/modify';
import { kernel } from '../kernel/client';
import { useView } from '../viewport/viewStore';
import { useSettings } from './settings';
import { exprFor, type Units } from '../model/units';

export type Tool = 'select' | 'point' | 'text' | 'line' | 'centerline' | 'rect' | 'circle' | 'arc' | 'polygon' | 'slot' | 'spline' | 'trim' | 'extend' | 'dimension';

export type Mode =
  | { kind: 'model' }
  | { kind: 'sketch'; sketchId: Id; tool: Tool; isNew: boolean; snapshot: PartDocument }
  | { kind: 'feature'; draft: FeatureDraft; editingId?: Id };

/** A sketch point picked on screen: either an existing point (snap) or a new position. */
export type PointPick = { id: Id } | { at: Pt };

interface State {
  doc: PartDocument;
  past: PartDocument[];
  future: PartDocument[];
  dirty: boolean;
  selection: Id | null;
  mode: Mode;
  solve: SolveResult | null;
  editingDimId: Id | null;
  showPlanes: boolean;
  message: { tone: 'info' | 'success' | 'error'; text: string; n: number } | null;

  newDoc(units?: Units): void;
  loadDoc(doc: PartDocument): void;
  undo(): void;
  redo(): void;
  select(id: Id | null): void;
  togglePlanes(): void;
  notify(tone: 'info' | 'success' | 'error', text: string): void;

  renameFeature(id: Id, name: string): void;
  toggleSuppress(id: Id): void;
  deleteFeature(id: Id): void;

  beginSketch(on: Id | SketchSupport): void;
  editSketch(sketchId: Id): void;
  setTool(tool: Tool): void;
  addLine(a: PointPick, b: PointPick, opts?: { construction?: boolean }): Id | null;
  addRect(a: PointPick, b: PointPick): void;
  addCircle(center: PointPick, radius: number): void;
  addArc(start: PointPick, end: PointPick, through: Pt): void;
  addPolygon(center: PointPick, vertex: Pt, sides: number): void;
  addSlot(c1: PointPick, c2: PointPick, side: Pt): void;
  /** spline through the picked points (at least 2, ends different) */
  addSpline(points: PointPick[]): boolean;
  trimAt(lineId: Id, click: Pt): void;
  extendAt(lineId: Id, click: Pt): void;
  addDimension(entityId: Id): void;
  /** distance between two points, point-to-line distance, or angle between two lines */
  addDimensionBetween(a: Id, b: Id): void;
  addRelation(kind: ConstraintKind, entityIds: Id[]): boolean;
  /** sketch modify tools on the selected entities; return false (with a message) when the selection does not fit */
  mirrorSelection(ids: Id[]): boolean;
  /** repeat the selected sketch curves in a row or round a centre */
  patternSelection(ids: Id[], o: SketchPatternOptions): boolean;
  /** copy the edges of the part's faces in the sketch plane into the sketch, fixed */
  convertEdges(): Promise<boolean>;
  addPoint(at: PointPick): void;
  /** text with its baseline starting at the pick; returns the text's id */
  addText(at: PointPick): Id | null;
  updateText(id: Id, patch: { text?: string; height?: number; angle?: number }): void;
  filletSelection(ids: Id[], radius: number): boolean;
  offsetSelection(ids: Id[], distance: number): boolean;
  removeConstraint(id: Id): void;
  setDimension(dimId: Id, expr: string, value: number): boolean;
  setEditingDim(id: Id | null): void;
  toggleConstruction(entityId: Id): void;
  deleteSketchEntity(id: Id): void;
  endSketch(): void;
  cancelSketch(): void;

  beginFeature(type: FeatureDraft['type'], sketchId?: Id): void;
  /** hole: place at a picked face point */
  setHolePoint(fp: FacePoint): void;
  /** extrude up to: the picked face */
  setUpToFace(face: FaceRef): void;
  /** extrude up to: the picked model corner (also sets the direction towards it) */
  setUpToVertex(v: VertexRef): void;
  /** colour of the faces a feature made; undefined = the part colour */
  setFeatureColor(id: Id, color: string | undefined): void;
  setConfigurations(configs: Configuration[], active?: Id): void;
  setActiveConfig(id: Id | undefined): void;
  /** shell: add or remove a face to open */
  toggleShellFace(fp: FacePoint): void;
  /** pattern / mirror: add or remove a feature to repeat */
  toggleSeed(id: Id): void;
  setRollback(index: number): void;
  /**
   * Move a feature (with the sketch it uses) so it sits just before the feature now at
   * `toIndex`. Refused when it would come before something it depends on, or after
   * something that depends on it.
   */
  moveFeature(id: Id, toIndex: number): boolean;
  setVariables(vars: Variable[]): void;
  /** add a solid read from another program's file (see model/importFormats) */
  addImport(fileName: string, step: string, format?: 'step' | 'brep' | 'stl', parts?: number[]): void;
  updateDraft(fn: (d: Draft<FeatureDraft>) => void): void;
  toggleEdge(ref: EdgeRef): void;
  confirmFeature(): void;
  cancelFeature(): void;
  editFeature(id: Id): void;
}

const uid = () => crypto.randomUUID();

export function makeDoc(units: Units = 'mm'): PartDocument {
  const now = new Date().toISOString();
  const plane = (which: PlaneWhich, name: string): Feature => ({
    id: uid(), name, suppressed: false, type: 'plane', def: { type: 'default', which },
  });
  const features = [plane('front', 'Front plane'), plane('top', 'Top plane'), plane('right', 'Right plane')];
  return {
    schemaVersion: SCHEMA_VERSION, id: uid(), name: 'Part1', units,
    createdAt: now, updatedAt: now, features, rollbackIndex: features.length,
  };
}

const BASE_NAMES: Record<FeatureDraft['type'], string> = {
  extrude: 'Extrude', cutExtrude: 'Cut', revolve: 'Revolve', cutRevolve: 'CutRevolve', fillet: 'Fillet', chamfer: 'Chamfer',
  hole: 'Hole', shell: 'Shell', linearPattern: 'LPattern', circularPattern: 'CPattern', sketchPattern: 'SketchPattern', mirror: 'Mirror', plane: 'Plane', import: 'Import',
  loft: 'Loft', sweep: 'Sweep', axis: 'Axis', rib: 'Rib', helix: 'Helix', dome: 'Dome', wrap: 'Wrap', splitLine: 'SplitLine',
};

/** Insert a new feature at the rollback bar and move the bar past it. */
function insertAtRollback(d: Draft<PartDocument>, f: Draft<Feature>) {
  const at = Math.min(d.rollbackIndex, d.features.length);
  d.features.splice(at, 0, f);
  d.rollbackIndex = at + 1;
}

function nextName(doc: PartDocument, base: string) {
  const re = new RegExp(`^${base}(\\d+)$`);
  const n = Math.max(0, ...doc.features.map((f) => Number(f.name.match(re)?.[1] ?? 0)));
  return `${base}${n + 1}`;
}

export const getSketch = (doc: PartDocument, id: Id) =>
  doc.features.find((f): f is SketchFeature => f.id === id && f.type === 'sketch');

/** Round faces made by an extrude or cut of a circle or arc, for Wrap to wrap onto. */
export function roundFaces(doc: PartDocument): { label: string; value: { featureId: Id; entityId: Id } }[] {
  const out: { label: string; value: { featureId: Id; entityId: Id } }[] = [];
  for (const f of doc.features.slice(0, doc.rollbackIndex)) {
    if ((f.type !== 'extrude' && f.type !== 'cutExtrude') || f.suppressed) continue;
    const sk = getSketch(doc, f.sketchId);
    sk?.sketch.entities.forEach((e) => {
      if ((e.kind === 'circle' || e.kind === 'arc') && !e.construction) out.push({ label: `${f.name}: ${e.kind === 'circle' ? 'circle' : 'arc'} ${out.filter((o) => o.value.featureId === f.id).length + 1}`, value: { featureId: f.id, entityId: e.id } });
    });
  }
  return out;
}

/** Sketches already used by a feature (shown nested under it in the tree). */
export function consumedSketches(doc: PartDocument): Set<Id> {
  return new Set(doc.features.flatMap((f) => sketchesOf(f)));
}

/** Features that depend directly on feature `id`. */
export function directDependents(doc: PartDocument, id: Id): Feature[] {
  return doc.features.filter((x) => {
    if (sketchesOf(x).includes(id)) return true;
    if (x.type === 'sketch') return x.on.kind === 'plane' ? x.on.featureId === id : x.on.face.featureId === id;
    if (x.type === 'fillet' || x.type === 'chamfer') return x.edges.some((e) => e.featureId === id);
    if (x.type === 'linearPattern' || x.type === 'circularPattern') return x.seeds.includes(id) || x.axisId === id;
    if (x.type === 'mirror') return x.seeds.includes(id) || x.planeId === id;
    if (x.type === 'sketchPattern') return x.seeds.includes(id);
    if (x.type === 'wrap') return x.cylinder.featureId === id;
    if (x.type === 'dome') return x.at?.face.featureId === id;
    if (x.type === 'hole') return x.at?.face.featureId === id;
    if (x.type === 'shell') return x.faces.some((fp) => fp.face.featureId === id);
    if (x.type === 'axis') return axisInputs(x.def).includes(id);
    if ((x.type === 'revolve' || x.type === 'cutRevolve') && x.axisId === id) return true;
    if (x.type === 'plane' && x.def.type !== 'default')
      return x.def.base.kind === 'plane' ? x.def.base.featureId === id : x.def.base.face.featureId === id;
    return false;
  });
}

export function dependentsOf(doc: PartDocument, id: Id): Set<Id> {
  const out = new Set<Id>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const d of directDependents(doc, cur)) if (!out.has(d.id)) out.add(d.id), stack.push(d.id);
  }
  return out;
}

const fmt = (n: number) => String(+n.toFixed(3));

/** Circle through three points, or null if they are in a line. */
function circleThrough(a: Pt, b: Pt, c: Pt): { center: Pt; r: number } | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, c2 = c.x * c.x + c.y * c.y;
  const center = { x: (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d, y: (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d };
  return { center, r: Math.hypot(a.x - center.x, a.y - center.y) };
}

/**
 * Make another configuration active. Suppression is per configuration: the
 * current suppressed features are saved into the one being left, and the new
 * one's list (or the base list, if it has none yet) is applied.
 */
function switchConfig(d: Draft<PartDocument>, to: Id | undefined) {
  const from = d.activeConfig;
  const into = d.configurations?.find((c) => c.id === to);
  if (from === (into ? to : undefined)) return;
  const now = d.features.filter((f) => f.suppressed).map((f) => f.id);
  const out = d.configurations?.find((c) => c.id === from);
  if (out) out.suppressed = now;
  else if (!from) d.baseSuppressed = now;
  const list = new Set(into ? (into.suppressed ?? d.baseSuppressed ?? now) : (d.baseSuppressed ?? now));
  for (const f of d.features) if (f.type !== 'plane') f.suppressed = list.has(f.id);
  d.activeConfig = into ? to : undefined;
}

export const useDoc = create<State>((set, get) => {
  /** Apply a document change as one undoable step. */
  const commit = (recipe: (d: Draft<PartDocument>) => void, extra: Partial<State> = {}) => {
    const prev = get().doc;
    const next = resolveVertexDepths(
      applyEquations(
        produce(prev, (d) => {
          recipe(d);
          d.updatedAt = new Date().toISOString();
        }),
      ),
    );
    set({ doc: next, past: [...get().past.slice(-99), prev], future: [], dirty: true, ...extra });
  };

  /**
   * Change the active sketch, then solve it. If the result cannot be solved the
   * change is rejected and an error is shown. Returns the solve result or null.
   */
  const sketchChange = (recipe: (s: Draft<Sketch>) => void): SolveResult | null => {
    const m = get().mode;
    if (m.kind !== 'sketch') return null;
    const cur = getSketch(get().doc, m.sketchId);
    if (!cur) return null;
    const changed = produce(cur.sketch, recipe);
    if (changed === cur.sketch) return null;
    const res = solveSketch(changed);
    if (!res.ok) {
      get().notify('error', 'That change cannot be solved: it conflicts with existing dimensions or relations.');
      return null;
    }
    commit((d) => {
      const f = d.features.find((x) => x.id === m.sketchId) as Draft<SketchFeature>;
      f.sketch = res.sketch as Draft<Sketch>;
    }, { solve: res });
    return res;
  };

  const resolvePick = (s: Draft<Sketch>, p: PointPick): Id => {
    if ('id' in p) return p.id;
    const id = uid();
    s.entities.push({ id, kind: 'point', p: { ...p.at }, construction: false });
    return id;
  };

  const solveActive = (doc: PartDocument, mode: Mode) => {
    if (mode.kind !== 'sketch') return null;
    const sk = getSketch(doc, mode.sketchId);
    return sk ? solveSketch(sk.sketch) : null;
  };

  /** A default length: `mm` in millimetre parts, `inch` inches in inch parts. */
  const defaultLen = (mm: number, inch: number) =>
    get().doc.units === 'in' ? { expr: String(inch), value: inch * 25.4 } : { expr: String(mm), value: mm };

  const pickSketch = (sketchId?: Id): Id | undefined => {
    const doc = get().doc;
    const used = consumedSketches(doc);
    let id = sketchId;
    const sel = get().selection;
    id ??= sel && getSketch(doc, sel) ? sel : undefined;
    id ??= [...doc.features].reverse().find((f) => f.type === 'sketch' && !used.has(f.id))?.id;
    if (!id || !getSketch(doc, id)) {
      get().notify('info', 'Draw a sketch first, or select one in the tree.');
      return undefined;
    }
    if (used.has(id)) {
      get().notify('info', 'That sketch is already used by a feature. Edit that feature instead.');
      return undefined;
    }
    return id;
  };

  return {
    doc: makeDoc(),
    past: [],
    future: [],
    dirty: false,
    selection: null,
    mode: { kind: 'model' },
    solve: null,
    editingDimId: null,
    showPlanes: true,
    message: null,

    newDoc: (units) => set({ doc: { ...makeDoc(units), color: useSettings.getState().defaultColor }, showPlanes: useSettings.getState().showPlanes, past: [], future: [], dirty: false, selection: null, mode: { kind: 'model' }, solve: null }),
    loadDoc: (doc) => set({ doc, past: [], future: [], dirty: false, selection: null, mode: { kind: 'model' }, solve: null }),

    undo: () => {
      const { past, doc, future, mode } = get();
      if (!past.length) return;
      const prev = past[past.length - 1];
      const m: Mode = mode.kind === 'sketch' && !getSketch(prev, mode.sketchId) ? { kind: 'model' } : mode;
      set({ doc: prev, past: past.slice(0, -1), future: [doc, ...future], mode: m, solve: solveActive(prev, m), editingDimId: null });
    },
    redo: () => {
      const { past, doc, future, mode } = get();
      if (!future.length) return;
      const next = future[0];
      set({ doc: next, past: [...past, doc], future: future.slice(1), solve: solveActive(next, mode), editingDimId: null });
    },

    select: (id) => set({ selection: id }),
    togglePlanes: () => set({ showPlanes: !get().showPlanes }),
    notify: (tone, text) => set({ message: { tone, text, n: (get().message?.n ?? 0) + 1 } }),

    renameFeature: (id, name) => {
      if (get().doc.features.some((f) => f.name === name && f.id !== id)) {
        get().notify('error', `There is already a feature called ${name}.`);
        return;
      }
      commit((d) => {
        const f = d.features.find((x) => x.id === id);
        if (f) f.name = name;
      });
    },
    toggleSuppress: (id) => commit((d) => {
      const f = d.features.find((x) => x.id === id);
      if (f && f.type !== 'plane') f.suppressed = !f.suppressed;
    }),
    deleteFeature: (id) => {
      const doc = get().doc;
      const f = doc.features.find((x) => x.id === id);
      if (!f || f.type === 'plane') return;
      const remove = new Set([id, ...dependentsOf(doc, id)]);
      // Deleting a feature also deletes the sketch it used.
      for (const sk of sketchesOf(f)) remove.add(sk);
      const also = doc.features.filter((x) => remove.has(x.id) && x.id !== id && !sketchesOf(f).includes(x.id));
      commit((d) => {
        const before = d.features.slice(0, d.rollbackIndex).filter((x) => remove.has(x.id)).length;
        d.rollbackIndex = Math.max(3, d.rollbackIndex - before);
        d.features = d.features.filter((x) => !remove.has(x.id));
        d.rollbackIndex = Math.min(d.rollbackIndex, d.features.length);
      }, { selection: null });
      if (also.length) get().notify('info', `Also deleted ${also.map((u) => u.name).join(', ')}, which depended on ${f.name}.`);
    },

    beginSketch: (on) => {
      const support: SketchSupport = typeof on === 'string' ? { kind: 'plane', featureId: on } : on;
      const id = uid();
      const originId = uid();
      const before = get().doc;
      commit((d) => {
        insertAtRollback(d, {
          id, type: 'sketch', name: nextName(before, 'Sketch'), suppressed: false, on: support,
          sketch: {
            // The sketch origin is a fixed construction point so geometry can snap to it.
            entities: [{ id: originId, kind: 'point', p: { x: 0, y: 0 }, construction: true }],
            constraints: [{ id: uid(), kind: 'fix', entityIds: [originId], at: { x: 0, y: 0 } }],
            dimensions: [],
          },
        });
      });
      const doc = get().doc;
      const mode: Mode = { kind: 'sketch', sketchId: id, tool: 'rect', isNew: true, snapshot: before };
      set({ mode, selection: id, solve: solveActive(doc, mode) });
    },
    editSketch: (sketchId) => {
      const doc = get().doc;
      if (!getSketch(doc, sketchId)) return;
      const mode: Mode = { kind: 'sketch', sketchId, tool: 'select', isNew: false, snapshot: doc };
      set({ mode, selection: sketchId, solve: solveActive(doc, mode) });
    },
    setTool: (tool) => {
      const m = get().mode;
      if (m.kind === 'sketch') set({ mode: { ...m, tool } });
    },

    addLine: (a, b, opts) => {
      let lineId: Id | null = null;
      const res = sketchChange((s) => {
        const p1 = resolvePick(s, a);
        const p2 = resolvePick(s, b);
        if (p1 === p2) return;
        lineId = uid();
        s.entities.push({ id: lineId, kind: 'line', p1, p2, construction: !!opts?.construction });
        // Automatic relations: nearly horizontal / vertical lines get the relation.
        const A = pointOf(s as Sketch, p1);
        const B = pointOf(s as Sketch, p2);
        const ang = Math.abs(Math.atan2(B.y - A.y, B.x - A.x));
        const tol = (3 * Math.PI) / 180;
        if (ang < tol || Math.abs(ang - Math.PI) < tol) s.constraints.push({ id: uid(), kind: 'horizontal', entityIds: [lineId] });
        else if (Math.abs(ang - Math.PI / 2) < tol) s.constraints.push({ id: uid(), kind: 'vertical', entityIds: [lineId] });
      });
      return res ? lineId : null;
    },

    addRect: (a, b) => {
      sketchChange((s) => {
        const p0 = resolvePick(s, a);
        const p2 = resolvePick(s, b);
        const A = pointOf(s as Sketch, p0);
        const C = pointOf(s as Sketch, p2);
        if (Math.abs(A.x - C.x) < 1e-6 || Math.abs(A.y - C.y) < 1e-6) return;
        const p1 = uid();
        const p3 = uid();
        s.entities.push({ id: p1, kind: 'point', p: { x: C.x, y: A.y }, construction: false });
        s.entities.push({ id: p3, kind: 'point', p: { x: A.x, y: C.y }, construction: false });
        const corners = [p0, p1, p2, p3];
        corners.forEach((p, i) => {
          const id = uid();
          s.entities.push({ id, kind: 'line', p1: p, p2: corners[(i + 1) % 4], construction: false });
          s.constraints.push({ id: uid(), kind: i % 2 === 0 ? 'horizontal' : 'vertical', entityIds: [id] });
        });
      });
    },

    addCircle: (center, radius) => {
      if (!(radius > 1e-6)) return;
      sketchChange((s) => {
        const c = resolvePick(s, center);
        s.entities.push({ id: uid(), kind: 'circle', center: c, radius, construction: false });
      });
    },

    addArc: (start, end, through) => {
      sketchChange((s) => {
        const a = resolvePick(s, start);
        const b = resolvePick(s, end);
        if (a === b) return;
        const A = pointOf(s as Sketch, a);
        const B = pointOf(s as Sketch, b);
        const circ = circleThrough(A, B, through);
        if (!circ) return;
        const cId = uid();
        s.entities.push({ id: cId, kind: 'point', p: circ.center, construction: true });
        // ccw if the through point is on the left going around from A to B
        const ang = (p: Pt) => Math.atan2(p.y - circ.center.y, p.x - circ.center.x);
        const norm = (x: number) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        const ccw = norm(ang(through) - ang(A)) < norm(ang(B) - ang(A));
        s.entities.push({ id: uid(), kind: 'arc', center: cId, start: a, end: b, ccw, construction: false });
      });
    },

    addPolygon: (center, vertex, sides) => {
      sketchChange((s) => {
        const c = resolvePick(s, center);
        const C = pointOf(s as Sketch, c);
        if (Math.hypot(vertex.x - C.x, vertex.y - C.y) < 1e-6) return;
        const shape = polygonShape(uid, c, C, vertex, sides);
        s.entities.push(...(shape.entities as Draft<Sketch['entities'][number]>[]));
        s.constraints.push(...(shape.constraints as Draft<Sketch['constraints'][number]>[]));
      });
    },
    addSlot: (c1, c2, side) => {
      sketchChange((s) => {
        const a = resolvePick(s, c1);
        const b = resolvePick(s, c2);
        if (a === b) return;
        // slot centres are construction points
        for (const id of [a, b]) {
          const e = s.entities.find((x) => x.id === id);
          if (e && e.kind === 'point' && !s.entities.some((x) => x.kind !== 'point' && JSON.stringify(x).includes(id))) e.construction = true;
        }
        const shape = slotShape(uid, a, pointOf(s as Sketch, a), b, pointOf(s as Sketch, b), side);
        if (!shape) return;
        s.entities.push(...(shape.entities as Draft<Sketch['entities'][number]>[]));
        s.constraints.push(...(shape.constraints as Draft<Sketch['constraints'][number]>[]));
      });
    },

    addSpline: (picks) => {
      if (picks.length < 2) return false;
      const res = sketchChange((s) => {
        const ids = picks.map((pk) => resolvePick(s, pk));
        if (ids[0] === ids[ids.length - 1] || new Set(ids).size < ids.length) return;
        s.entities.push({ id: uid(), kind: 'spline', points: ids, construction: false });
      });
      return !!res;
    },
    trimAt: (lineId, click) => {
      let err: string | null = null;
      sketchChange((s) => void (err = trimLine(s as Sketch, uid, lineId, click)));
      if (err) get().notify('info', err);
    },
    extendAt: (lineId, click) => {
      let err: string | null = null;
      sketchChange((s) => void (err = extendLine(s as Sketch, uid, lineId, click)));
      if (err) get().notify('info', err);
    },

    addDimension: (entityId) => {
      const m = get().mode;
      if (m.kind !== 'sketch') return;
      const sk = getSketch(get().doc, m.sketchId)!.sketch;
      const ent = sk.entities.find((e) => e.id === entityId);
      if (!ent || ent.kind === 'point') return;
      if (sk.dimensions.some((d) => d.lineId === entityId || (d.entityIds.length === 1 && d.entityIds[0] === entityId))) {
        get().notify('info', 'This already has a dimension. Double-click its value to change it.');
        return;
      }
      const n = Math.max(0, ...sk.dimensions.map((d) => Number(d.name.slice(1)))) + 1;
      let dim: Dimension;
      if (ent.kind === 'line') {
        const A = pointOf(sk, ent.p1);
        const B = pointOf(sk, ent.p2);
        const len = Math.hypot(B.x - A.x, B.y - A.y);
        dim = { id: uid(), name: `D${n}`, kind: 'distance', entityIds: [ent.p1, ent.p2], lineId: ent.id, value: { expr: exprFor(len, get().doc.units), value: len }, driving: true };
      } else if (ent.kind === 'circle') {
        const d = ent.radius * 2;
        dim = { id: uid(), name: `D${n}`, kind: 'diameter', entityIds: [ent.id], value: { expr: exprFor(d, get().doc.units), value: d }, driving: true };
      } else if (ent.kind === 'spline') {
        get().notify('info', 'Splines are shaped by their points: dimension the points instead.');
        return;
      } else if (ent.kind === 'text') {
        get().notify('info', "Set the letter height in the Text panel; dimension the text's point to place it.");
        return;
      } else {
        const c = pointOf(sk, ent.center);
        const a = pointOf(sk, ent.start);
        const r = Math.hypot(a.x - c.x, a.y - c.y);
        dim = { id: uid(), name: `D${n}`, kind: 'radius', entityIds: [ent.id], value: { expr: exprFor(r, get().doc.units), value: r }, driving: true };
      }
      const trial = solveSketch({ ...sk, dimensions: [...sk.dimensions, dim] });
      if (trial.state === 'over' || !trial.ok) {
        dim.driving = false;
        get().notify('info', `${dim.name} would over-define the sketch, so it was added as a reference dimension.`);
      }
      const res = sketchChange((s) => {
        s.dimensions.push(dim);
      });
      if (res && dim.driving) set({ editingDimId: dim.id });
    },

    addDimensionBetween: (a, b) => {
      const m = get().mode;
      if (m.kind !== 'sketch' || a === b) return;
      const sk = getSketch(get().doc, m.sketchId)!.sketch;
      const ea = sk.entities.find((e) => e.id === a);
      const eb = sk.entities.find((e) => e.id === b);
      if (!ea || !eb) return;
      const n = Math.max(0, ...sk.dimensions.map((d) => Number(d.name.slice(1)))) + 1;
      let dim: Dimension | null = null;
      if (ea.kind === 'point' && eb.kind === 'point') {
        const len = Math.hypot(eb.p.x - ea.p.x, eb.p.y - ea.p.y);
        if (len < 1e-9) return get().notify('info', 'Those two points are at the same place.');
        dim = { id: uid(), name: `D${n}`, kind: 'distance', entityIds: [a, b], value: { expr: exprFor(len, get().doc.units), value: len }, driving: true };
      } else if ((ea.kind === 'point' && eb.kind === 'line') || (ea.kind === 'line' && eb.kind === 'point')) {
        const [p, l] = ea.kind === 'point' ? [ea, eb as Extract<typeof eb, { kind: 'line' }>] : [eb as Extract<typeof eb, { kind: 'point' }>, ea];
        const A = pointOf(sk, l.p1);
        const B = pointOf(sk, l.p2);
        const len = Math.abs((B.x - A.x) * (p.p.y - A.y) - (B.y - A.y) * (p.p.x - A.x)) / (Math.hypot(B.x - A.x, B.y - A.y) || 1);
        if (len < 1e-9) return get().notify('info', 'The point is on the line. Use the "On line" relation instead.');
        dim = { id: uid(), name: `D${n}`, kind: 'pointLine', entityIds: [p.id, l.id], value: { expr: exprFor(len, get().doc.units), value: len }, driving: true };
      } else if (ea.kind === 'line' && eb.kind === 'line') {
        const d1 = [pointOf(sk, ea.p2).x - pointOf(sk, ea.p1).x, pointOf(sk, ea.p2).y - pointOf(sk, ea.p1).y];
        const d2 = [pointOf(sk, eb.p2).x - pointOf(sk, eb.p1).x, pointOf(sk, eb.p2).y - pointOf(sk, eb.p1).y];
        const deg = (Math.atan2(Math.abs(d1[0] * d2[1] - d1[1] * d2[0]), d1[0] * d2[0] + d1[1] * d2[1]) * 180) / Math.PI;
        if (deg < 0.01 || deg > 179.99) return get().notify('info', 'Those lines are parallel. Use a distance or the Parallel relation.');
        dim = { id: uid(), name: `D${n}`, kind: 'angle', entityIds: [a, b], value: { expr: fmt(deg), value: deg }, driving: true };
      } else {
        return get().notify('info', 'Pick two points, a point and a line, or two lines.');
      }
      const trial = solveSketch({ ...sk, dimensions: [...sk.dimensions, dim] });
      if (trial.state === 'over' || !trial.ok) {
        dim.driving = false;
        get().notify('info', `${dim.name} would over-define the sketch, so it was added as a reference dimension.`);
      }
      const res = sketchChange((s) => {
        s.dimensions.push(dim!);
      });
      if (res && dim.driving) set({ editingDimId: dim.id });
    },

    addRelation: (kind, entityIds) => {
      const m = get().mode;
      if (m.kind !== 'sketch') return false;
      const sk = getSketch(get().doc, m.sketchId)!.sketch;
      const key = (ids: Id[]) => [...ids].sort().join('|');
      if (sk.constraints.some((c) => c.kind === kind && key(c.entityIds) === key(entityIds))) {
        get().notify('info', 'That relation is already there.');
        return false;
      }
      const at = kind === 'fix' ? pointOf(sk, entityIds[0]) : undefined;
      const trial = solveSketch({ ...sk, constraints: [...sk.constraints, { id: 'trial', kind, entityIds, at }] });
      if (!trial.ok) {
        get().notify('error', 'That relation conflicts with existing relations or dimensions.');
        return false;
      }
      if (trial.state === 'over') {
        get().notify('error', 'That relation would over-define the sketch: something already fixes it.');
        return false;
      }
      return !!sketchChange((s) => {
        s.constraints.push({ id: uid(), kind, entityIds, ...(at ? { at } : {}) });
      });
    },
    patternSelection: (ids, o) => {
      let err: string | null = null;
      const res = sketchChange((s) => void (err = patternEntities(s as Sketch, uid, ids, o)));
      if (err) get().notify('info', err);
      return !err && !!res;
    },
    convertEdges: async () => {
      const m = get().mode;
      if (m.kind !== 'sketch') return false;
      const edges = await kernel.planarEdges(get().doc, m.sketchId);
      if ('error' in edges) {
        get().notify('info', edges.error);
        return false;
      }
      let err: string | null = null;
      const res = sketchChange((s) => void (err = addConvertedEdges(s as Sketch, uid, edges)));
      if (err) get().notify('info', err);
      else if (res) get().notify('success', `Converted ${edges.length} edge${edges.length === 1 ? '' : 's'} into the sketch. They are fixed in place.`);
      return !err && !!res;
    },
    addText: (at) => {
      const id = uid();
      const h = get().doc.units === 'in' ? 0.25 * 25.4 : 5;
      const res = sketchChange((s) => {
        const p = resolvePick(s, at);
        s.entities.push({ id, kind: 'text', at: p, text: 'Text', height: h, angle: 0, construction: false });
      });
      return res ? id : null;
    },
    updateText: (id, patch) => {
      if (patch.height !== undefined && !(patch.height > 0)) return get().notify('error', 'The text height must be more than zero.');
      sketchChange((s) => {
        const e = s.entities.find((x) => x.id === id);
        if (e?.kind === 'text') Object.assign(e, patch);
      });
    },
    addPoint: (at) => {
      if ('id' in at) return;
      sketchChange((s) => void s.entities.push({ id: uid(), kind: 'point', p: { ...at.at }, construction: false }));
    },
    mirrorSelection: (ids) => {
      let err: string | null = null;
      const res = sketchChange((s) => void (err = mirrorEntities(s as Sketch, uid, ids)));
      if (err) get().notify('info', err);
      return !err && !!res;
    },
    filletSelection: (ids, radius) => {
      let err: string | null = null;
      const res = sketchChange((s) => {
        const r = filletCorner(s as Sketch, uid, ids, radius);
        if ('error' in r) err = r.error;
      });
      if (err) get().notify('info', err);
      return !err && !!res;
    },
    offsetSelection: (ids, distance) => {
      let err: string | null = null;
      const res = sketchChange((s) => void (err = offsetEntities(s as Sketch, uid, ids, distance)));
      if (err) get().notify('info', err);
      return !err && !!res;
    },
    removeConstraint: (id) => {
      sketchChange((s) => {
        s.constraints = s.constraints.filter((c) => c.id !== id);
      });
    },

    setDimension: (dimId, expr, value) => {
      if (!(value > 0)) {
        get().notify('error', 'A size must be more than zero.');
        return false;
      }
      const res = sketchChange((s) => {
        const d = s.dimensions.find((x) => x.id === dimId);
        if (d) d.value = { expr, value };
      });
      if (res) set({ editingDimId: null });
      return !!res;
    },
    setEditingDim: (id) => set({ editingDimId: id }),

    toggleConstruction: (entityId) => {
      sketchChange((s) => {
        const e = s.entities.find((x) => x.id === entityId);
        if (e && e.kind !== 'point') e.construction = !e.construction;
      });
    },

    deleteSketchEntity: (id) => {
      sketchChange((s) => {
        const e = s.entities.find((x) => x.id === id);
        if (!e) return;
        const removeIds = new Set([id]);
        const pts = e.kind === 'point' ? [] : e.kind === 'line' ? [e.p1, e.p2] : e.kind === 'arc' ? [e.start, e.end, e.center] : e.kind === 'spline' ? [...e.points] : e.kind === 'text' ? [e.at] : [e.center];
        if (e.kind === 'point') {
          // only a loose point (not the origin, not an end or centre of anything)
          const usedBy = s.entities.some((x) => x.kind !== 'point' && JSON.stringify(x).includes(`"${id}"`));
          if (usedBy || s.constraints.some((c) => c.kind === 'fix' && c.entityIds[0] === id && e.construction)) return;
        }
        for (const p of pts) {
          const used = s.entities.some(
            (x) => x.id !== id && ((x.kind === 'line' && (x.p1 === p || x.p2 === p)) || (x.kind === 'arc' && (x.start === p || x.end === p || x.center === p)) || (x.kind === 'circle' && x.center === p) || (x.kind === 'spline' && x.points.includes(p)) || (x.kind === 'text' && x.at === p)),
          );
          const isOrigin = s.constraints.some((c) => c.kind === 'fix' && c.entityIds[0] === p);
          if (!used && !isOrigin) removeIds.add(p);
        }
        s.entities = s.entities.filter((x) => !removeIds.has(x.id));
        s.constraints = s.constraints.filter((c) => !c.entityIds.some((x) => removeIds.has(x)));
        s.dimensions = s.dimensions.filter((d) => !d.entityIds.some((x) => removeIds.has(x)) && d.lineId !== id);
      });
    },

    endSketch: () => {
      const m = get().mode;
      if (m.kind !== 'sketch') return;
      const sk = getSketch(get().doc, m.sketchId);
      const empty = !sk || !sk.sketch.entities.some((e) => e.kind !== 'point' || !e.construction); // the origin point is construction
      if (empty && m.isNew) {
        // Nothing drawn: leave no empty sketch behind.
        set({ doc: m.snapshot, mode: { kind: 'model' }, solve: null, editingDimId: null, selection: null });
        return;
      }
      set({ mode: { kind: 'model' }, solve: null, editingDimId: null, selection: m.sketchId });
    },
    cancelSketch: () => {
      const m = get().mode;
      if (m.kind !== 'sketch') return;
      set({ doc: m.snapshot, past: [...get().past, get().doc], mode: { kind: 'model' }, solve: null, editingDimId: null });
    },

    beginFeature: (type, sketchId) => {
      const s = get();
      if (s.mode.kind === 'feature') s.cancelFeature();
      let sid = sketchId;
      if (s.mode.kind === 'sketch') {
        if (type !== 'fillet' && type !== 'chamfer') sid ??= s.mode.sketchId;
        s.endSketch();
      }
      let draft: FeatureDraft;
      const doc0 = get().doc;
      const hasSolid = doc0.features.slice(0, doc0.rollbackIndex).some((f) => f.type === 'import' || (isSeedType(f.type) && f.type !== 'cutExtrude' && f.type !== 'cutRevolve' && f.type !== 'hole'));
      const seedsFromSelection = () => {
        const sel = doc0.features.find((f) => f.id === get().selection);
        if (sel && isSeedType(sel.type)) return [sel.id];
        const last = [...doc0.features.slice(0, doc0.rollbackIndex)].reverse().find((f) => isSeedType(f.type));
        return last ? [last.id] : [];
      };
      if (type === 'plane') {
        const face = useView.getState().pickedFace;
        const sel = doc0.features.find((f) => f.id === get().selection);
        const base = face ? { kind: 'face' as const, face } : sel?.type === 'plane' ? { kind: 'plane' as const, featureId: sel.id } : null;
        if (!base) {
          get().notify('info', 'Select a plane or a flat face first, then choose Plane.');
          return;
        }
        set({ mode: { kind: 'feature', draft: { type: 'plane', def: { type: 'offset', base, distance: defaultLen(20, 1) } } } });
        return;
      }
      if (type === 'axis') {
        // start from what is selected: a sketch with a line, or two planes (default: Front and Top)
        const sel = doc0.features.find((f) => f.id === get().selection);
        const line = sel?.type === 'sketch' ? sel.sketch.entities.find((e) => e.kind === 'line') : undefined;
        const planes = doc0.features.slice(0, doc0.rollbackIndex).filter((f) => f.type === 'plane' && !f.suppressed);
        const def =
          sel?.type === 'sketch' && line
            ? { type: 'sketchLine' as const, sketchId: sel.id, lineId: line.id }
            : { type: 'planes' as const, a: sel?.type === 'plane' ? sel.id : planes[0].id, b: planes.find((p) => p.id !== (sel?.type === 'plane' ? sel.id : planes[0].id))!.id };
        set({ mode: { kind: 'feature', draft: { type: 'axis', def } } });
        return;
      }
      if (type === 'sketchPattern') {
        if (!hasSolid) {
          get().notify('info', 'Make a solid first.');
          return;
        }
        const used = consumedSketches(doc0);
        const sel = doc0.features.find((f) => f.id === get().selection);
        const sk = sel?.type === 'sketch' && !used.has(sel.id) ? sel : doc0.features.slice(0, doc0.rollbackIndex).reverse().find((f) => f.type === 'sketch' && !used.has(f.id));
        if (!sk) {
          get().notify('info', 'Draw a sketch with points where the copies go, then choose Sketch pattern.');
          return;
        }
        set({ mode: { kind: 'feature', draft: { type, seeds: seedsFromSelection(), sketchId: sk.id } } });
        return;
      }
      if (type === 'hole' || type === 'shell' || type === 'linearPattern' || type === 'circularPattern' || type === 'mirror') {
        if (!hasSolid) {
          get().notify('info', 'Make a solid first.');
          return;
        }
        const face = useView.getState().pickedFace;
        if (type === 'hole') draft = { type, at: null, diameter: defaultLen(6, 0.25), end: { type: 'throughAll' } };
        else if (type === 'shell') draft = { type, faces: [], thickness: defaultLen(2, 0.08) };
        else if (type === 'mirror') draft = { type, seeds: seedsFromSelection(), planeId: doc0.features[2].id };
        else
          draft = {
            type, seeds: seedsFromSelection(), axis: 'x', count: type === 'linearPattern' ? 3 : 6, reverse: false,
            spacing: type === 'linearPattern' ? defaultLen(20, 1) : { expr: '360', value: 360 },
          };
        void face;
        set({ mode: { kind: 'feature', draft } });
        return;
      }
      if (type === 'dome') {
        if (!hasSolid) {
          get().notify('info', 'Make a solid first.');
          return;
        }
        set({ mode: { kind: 'feature', draft: { type, at: null, height: defaultLen(5, 0.2), reverse: false } } });
        return;
      }
      if (type === 'import') {
        get().notify('info', 'Use File ▸ Import to bring in a solid from a STEP, STL, OBJ, 3MF or BREP file.');
        return;
      }
      if (type === 'loft' || type === 'sweep') {
        // sketches not yet used by another feature, in history order
        const used = consumedSketches(doc0);
        const free = doc0.features.slice(0, doc0.rollbackIndex).filter((f) => f.type === 'sketch' && !used.has(f.id)).map((f) => f.id);
        const helix = [...doc0.features.slice(0, doc0.rollbackIndex)].reverse().find((f) => f.type === 'helix' && !used.has(f.id));
        if (type === 'sweep' && helix && free.length >= 1) {
          set({ mode: { kind: 'feature', draft: { type, profileId: free[free.length - 1], pathId: helix.id } } });
          return;
        }
        if (free.length < 2) {
          get().notify('info', type === 'loft' ? 'A loft needs two or more sketches with closed outlines.' : 'A sweep needs two sketches (an outline and a path), or an outline and a helix.');
          return;
        }
        draft = type === 'loft' ? { type, sketchIds: free.slice(-2), ruled: false } : { type, profileId: free[free.length - 2], pathId: free[free.length - 1] };
        set({ mode: { kind: 'feature', draft } });
        return;
      }
      if (type === 'fillet' || type === 'chamfer') {
        if (!useDoc.getState().doc.features.some((f) => f.type === 'extrude' || f.type === 'revolve' || f.type === 'import')) {
          get().notify('info', 'Make a solid first.');
          return;
        }
        draft = { type, edges: [], size: defaultLen(type === 'fillet' ? 2 : 1, type === 'fillet' ? 0.1 : 0.05) };
      } else {
        const id = pickSketch(sid);
        if (!id) return;
        if (type === 'splitLine') {
          if (!hasSolid) {
            get().notify('info', 'Make a solid first, then draw the outline on one of its faces.');
            return;
          }
          set({ mode: { kind: 'feature', draft: { type, sketchId: id } } });
          return;
        }
        if (type === 'wrap') {
          const rounds = roundFaces(get().doc);
          if (!hasSolid || !rounds.length) {
            get().notify('info', 'Wrap needs a round face: extrude a circle first.');
            return;
          }
          set({ mode: { kind: 'feature', draft: { type, sketchId: id, cylinder: rounds[0].value, depth: defaultLen(1, 0.04), mode: 'emboss', flip: false } } });
          return;
        }
        if (type === 'rib') {
          if (!hasSolid) {
            get().notify('info', 'A rib grows into a solid. Make a solid first.');
            return;
          }
          set({ mode: { kind: 'feature', draft: { type, sketchId: id, thickness: defaultLen(4, 0.15), flip: false } } });
          return;
        }
        if (type === 'helix') {
          const sk = getSketch(get().doc, id)!;
          if (!sk.sketch.entities.some((e) => e.kind === 'circle' && !e.construction)) {
            get().notify('info', 'A helix is built on a circle: draw a circle in the sketch first.');
            return;
          }
          set({ mode: { kind: 'feature', draft: { type, sketchId: id, pitch: defaultLen(5, 0.2), turns: { expr: '4', value: 4 }, reverse: false, leftHand: false } } });
          return;
        }
        if (type === 'revolve' || type === 'cutRevolve') {
          const sk = getSketch(get().doc, id)!;
          const axis = sk.sketch.entities.find((e) => e.kind === 'line' && e.construction);
          const ref = get().doc.features.slice(0, get().doc.rollbackIndex).find((f) => f.type === 'axis' && !f.suppressed);
          if (!axis && !ref) {
            get().notify('info', 'A revolve needs an axis: draw a centerline in the sketch, or add a reference axis.');
            return;
          }
          draft = { type, sketchId: id, axisLineId: axis?.id ?? '', axisId: axis ? undefined : ref!.id, angle: { expr: '360', value: 360 }, reverse: false };
        } else {
          const cut = type === 'cutExtrude';
          draft = {
            type, sketchId: id, reverse: false, merge: true,
            direction1: { type: cut ? 'throughAll' : 'blind', depth: defaultLen(10, 0.5) },
          };
        }
      }
      set({ mode: { kind: 'feature', draft } });
    },
    updateDraft: (fn) => {
      const m = get().mode;
      if (m.kind !== 'feature') return;
      set({ mode: { ...m, draft: produce(m.draft, fn) } });
    },
    toggleEdge: (ref) => {
      get().updateDraft((d) => {
        if (d.type !== 'fillet' && d.type !== 'chamfer') return;
        const i = d.edges.findIndex((e) => sameEdge(e as EdgeRef, ref));
        if (i >= 0) d.edges.splice(i, 1);
        else d.edges.push(ref as Draft<EdgeRef>);
      });
    },
    confirmFeature: () => {
      const m = get().mode;
      if (m.kind !== 'feature') return;
      if (m.editingId) {
        const id = m.editingId;
        commit((d) => {
          const i = d.features.findIndex((f) => f.id === id);
          const old = d.features[i];
          d.features[i] = { ...m.draft, id, name: old.name, suppressed: old.suppressed } as Draft<Feature>;
        }, { mode: { kind: 'model' }, selection: id });
        return;
      }
      const id = uid();
      const name = nextName(get().doc, BASE_NAMES[m.draft.type]);
      commit((d) => {
        insertAtRollback(d, { ...m.draft, id, name, suppressed: false } as Draft<Feature>);
      }, { mode: { kind: 'model' }, selection: id });
    },
    setUpToFace: (face) =>
      get().updateDraft((d) => void ('direction1' in d && d.direction1.type === 'upToFace' && (d.direction1.face = face as Draft<FaceRef>))),
    setUpToVertex: (v) => {
      const m = get().mode;
      if (m.kind !== 'feature' || (m.draft.type !== 'extrude' && m.draft.type !== 'cutExtrude')) return;
      const raw = rawVertexDepth(get().doc, { ...m.draft, direction1: { type: 'upToVertex', depth: m.draft.direction1.depth, vertex: v } });
      get().updateDraft((d) => {
        if (!('direction1' in d) || d.direction1.type !== 'upToVertex') return;
        d.direction1.vertex = v as Draft<VertexRef>;
        if (raw !== undefined && Math.abs(raw) > 1e-9) d.reverse = raw < 0;
      });
    },
    setFeatureColor: (id, color) =>
      commit((d) => {
        const f = d.features.find((x) => x.id === id);
        if (f) f.color = color;
      }),
    setConfigurations: (configs, active) =>
      commit((d) => {
        // keep each configuration's saved suppression list
        d.configurations = configs.map((c) => ({ ...c, suppressed: c.suppressed ?? d.configurations?.find((o) => o.id === c.id)?.suppressed })) as Draft<Configuration>[];
        switchConfig(d, configs.some((c) => c.id === active) ? active : undefined);
      }),
    setActiveConfig: (id) => commit((d) => switchConfig(d, id)),
    setHolePoint: (fp) => get().updateDraft((d) => void (d.type === 'hole' && (d.at = fp as Draft<FacePoint>))),
    toggleShellFace: (fp) =>
      get().updateDraft((d) => {
        if (d.type !== 'shell') return;
        const key = JSON.stringify(fp.face);
        const i = d.faces.findIndex((x) => JSON.stringify(x.face) === key);
        if (i >= 0) d.faces.splice(i, 1);
        else d.faces.push(fp as Draft<FacePoint>);
      }),
    toggleSeed: (id) =>
      get().updateDraft((d) => {
        if (d.type !== 'linearPattern' && d.type !== 'circularPattern' && d.type !== 'mirror' && d.type !== 'sketchPattern') return;
        const i = d.seeds.indexOf(id);
        if (i >= 0) d.seeds.splice(i, 1);
        else d.seeds.push(id);
      }),
    setRollback: (index) => {
      const n = get().doc.features.length;
      const i = Math.max(3, Math.min(n, Math.round(index)));
      if (i === get().doc.rollbackIndex) return;
      commit((d) => void (d.rollbackIndex = i));
    },
    moveFeature: (id, toIndex) => {
      const doc = get().doc;
      const f = doc.features.find((x) => x.id === id);
      if (!f || f.type === 'plane' && f.def.type === 'default') return false;
      // the block that moves: a sketch-based feature takes its sketch along
      const block = [...sketchesOf(f), f.id];
      const rest = doc.features.filter((x) => !block.includes(x.id));
      const target = doc.features[toIndex];
      let at = target ? rest.indexOf(target) : rest.length;
      if (at < 0) at = rest.length;
      at = Math.max(3, at);
      const next = [...rest.slice(0, at), ...block.map((b) => doc.features.find((x) => x.id === b)!), ...rest.slice(at)];
      // check every dependency still points backwards
      const pos = new Map(next.map((x, i) => [x.id, i]));
      for (const x of next) {
        for (const dep of directDependents({ ...doc, features: next }, x.id)) {
          if (pos.get(dep.id)! < pos.get(x.id)!) {
            get().notify('info', `${dep.name} uses ${x.name}, so ${dep.name} has to stay below it.`);
            return false;
          }
        }
      }
      if (next.every((x, i) => x === doc.features[i])) return false;
      // fully built stays fully built; otherwise the bar stays after the same feature
      const full = doc.rollbackIndex >= doc.features.length;
      const lastBuilt = doc.features[doc.rollbackIndex - 1];
      commit((d) => {
        d.features = next as Draft<Feature>[];
        d.rollbackIndex = full || !lastBuilt ? next.length : next.indexOf(lastBuilt) + 1;
      });
      return true;
    },
    addImport: (fileName, step, format, parts) => {
      const id = uid();
      const name = nextName(get().doc, 'Import');
      const f = { id, name, suppressed: false, type: 'import', fileName, step, ...(format && format !== 'step' ? { format } : {}), ...(parts ? { parts } : {}) };
      commit((d) => insertAtRollback(d, f as Draft<Feature>), { selection: id });
    },
    setVariables: (vars) => commit((d) => void (d.variables = vars as Draft<Variable>[])),
    cancelFeature: () => set({ mode: { kind: 'model' } }),
    editFeature: (id) => {
      const f = get().doc.features.find((x) => x.id === id);
      if (!f || (f.type === 'plane' && f.def.type === 'default')) return;
      if (f.type === 'sketch') return get().editSketch(id);
      const { id: _i, name: _n, suppressed: _s, ...draft } = f;
      set({ mode: { kind: 'feature', draft: draft as FeatureDraft, editingId: id } });
    },
  };
});
