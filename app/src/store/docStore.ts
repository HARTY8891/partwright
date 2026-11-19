// Document store. Every change to the part goes through a command here, which
// gives undo/redo (document snapshots) and one place that runs the sketch solver.
import { create } from 'zustand';
import { produce, type Draft } from 'immer';
import type {
  ConstraintKind, Dimension, EdgeRef, Feature, FeatureDraft, Id, PartDocument, PlaneWhich, Pt, Sketch, SketchFeature,
  SketchSupport, Variable, FacePoint,
} from '../model/types';
import { SCHEMA_VERSION, usesSketch, isSeedType } from '../model/types';
import { solveSketch, pointOf, type SolveResult } from '../solver/solve';
import { sameEdge } from '../model/refs';
import { applyEquations } from '../model/equations';
import { polygonShape, slotShape } from '../solver/shapes';
import { extendLine, filletCorner, mirrorEntities, offsetEntities, trimLine } from '../solver/modify';
import { useView } from '../viewport/viewStore';
import { useSettings } from './settings';
import { exprFor, type Units } from '../model/units';

export type Tool = 'select' | 'line' | 'centerline' | 'rect' | 'circle' | 'arc' | 'polygon' | 'slot' | 'spline' | 'trim' | 'extend' | 'dimension';

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
  /** add a solid read from a STEP file */
  addImport(fileName: string, step: string): void;
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
  hole: 'Hole', shell: 'Shell', linearPattern: 'LPattern', circularPattern: 'CPattern', mirror: 'Mirror', plane: 'Plane', import: 'Import',
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

/** Sketches already used by a feature (shown nested under it in the tree). */
export function consumedSketches(doc: PartDocument): Set<Id> {
  return new Set(doc.features.flatMap((f) => (usesSketch(f) ? [f.sketchId] : [])));
}

/** Features that depend directly on feature `id`. */
export function directDependents(doc: PartDocument, id: Id): Feature[] {
  return doc.features.filter((x) => {
    if (usesSketch(x) && x.sketchId === id) return true;
    if (x.type === 'sketch') return x.on.kind === 'plane' ? x.on.featureId === id : x.on.face.featureId === id;
    if (x.type === 'fillet' || x.type === 'chamfer') return x.edges.some((e) => e.featureId === id);
    if (x.type === 'linearPattern' || x.type === 'circularPattern') return x.seeds.includes(id);
    if (x.type === 'mirror') return x.seeds.includes(id) || x.planeId === id;
    if (x.type === 'hole') return x.at?.face.featureId === id;
    if (x.type === 'shell') return x.faces.some((fp) => fp.face.featureId === id);
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

export const useDoc = create<State>((set, get) => {
  /** Apply a document change as one undoable step. */
  const commit = (recipe: (d: Draft<PartDocument>) => void, extra: Partial<State> = {}) => {
    const prev = get().doc;
    const next = applyEquations(
      produce(prev, (d) => {
        recipe(d);
        d.updatedAt = new Date().toISOString();
      }),
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
      if (usesSketch(f)) remove.add(f.sketchId);
      const also = doc.features.filter((x) => remove.has(x.id) && x.id !== id && !(usesSketch(f) && x.id === f.sketchId));
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
        if (!e || e.kind === 'point') return;
        const removeIds = new Set([id]);
        const pts = e.kind === 'line' ? [e.p1, e.p2] : e.kind === 'arc' ? [e.start, e.end, e.center] : e.kind === 'spline' ? [...e.points] : [e.center];
        for (const p of pts) {
          const used = s.entities.some(
            (x) => x.id !== id && ((x.kind === 'line' && (x.p1 === p || x.p2 === p)) || (x.kind === 'arc' && (x.start === p || x.end === p || x.center === p)) || (x.kind === 'circle' && x.center === p) || (x.kind === 'spline' && x.points.includes(p))),
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
      const empty = !sk || !sk.sketch.entities.some((e) => e.kind !== 'point');
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
      if (type === 'import') {
        get().notify('info', 'Use File ▸ Import STEP to bring in a solid.');
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
        if (type === 'revolve' || type === 'cutRevolve') {
          const sk = getSketch(get().doc, id)!;
          const axis = sk.sketch.entities.find((e) => e.kind === 'line' && e.construction);
          if (!axis) {
            get().notify('info', 'A revolve needs an axis: draw a centerline in the sketch first.');
            return;
          }
          draft = { type, sketchId: id, axisLineId: axis.id, angle: { expr: '360', value: 360 }, reverse: false };
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
        if (d.type !== 'linearPattern' && d.type !== 'circularPattern' && d.type !== 'mirror') return;
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
      const block = usesSketch(f) ? [f.sketchId, f.id] : [f.id];
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
    addImport: (fileName, step) => {
      const id = uid();
      const name = nextName(get().doc, 'Import');
      commit((d) => insertAtRollback(d, { id, name, suppressed: false, type: 'import', fileName, step } as Draft<Feature>), { selection: id });
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
