import { create } from 'zustand';
import type { FaceRef, Id } from '../model/types';

export type ViewName = 'front' | 'top' | 'right' | 'iso' | 'fit';

interface ViewState {
  /** Requests from the toolbar to the camera rig (inside the Canvas). */
  request: { view: ViewName; n: number } | null;
  go(view: ViewName): void;
  /** Planar model face picked in the view (for "sketch on this face"). */
  pickedFace: FaceRef | null;
  setPickedFace(f: FaceRef | null): void;
  /** Entities selected inside the active sketch (points, lines, circles, arcs). */
  sketchSel: Id[];
  setSketchSel(ids: Id[]): void;
  /** add or remove one entity (Shift/Ctrl click) */
  toggleSketchSel(id: Id): void;
  /** sides for the Polygon tool */
  polygonSides: number;
  setPolygonSides(n: number): void;
  /** Measure tool: on, and the picked points (world mm) */
  measuring: boolean;
  measurePoints: [number, number, number][];
  setMeasuring(on: boolean): void;
  addMeasurePoint(p: [number, number, number]): void;
  /** how the solid is drawn */
  displayStyle: DisplayStyle;
  setDisplayStyle(s: DisplayStyle): void;
  /** section view: cut the view (not the part) at a default plane, moved by offset mm */
  section: { on: boolean; plane: 'front' | 'top' | 'right'; offset: number; flip: boolean };
  setSection(p: Partial<ViewState['section']>): void;
}

export type DisplayStyle = 'shadedEdges' | 'shaded' | 'wireframe';

export const useView = create<ViewState>((set, get) => ({
  request: null,
  go: (view) => set({ request: { view, n: (get().request?.n ?? 0) + 1 } }),
  pickedFace: null,
  setPickedFace: (pickedFace) => set({ pickedFace }),
  sketchSel: [],
  setSketchSel: (sketchSel) => set({ sketchSel }),
  polygonSides: 6,
  setPolygonSides: (polygonSides) => set({ polygonSides }),
  measuring: false,
  measurePoints: [],
  setMeasuring: (measuring) => set({ measuring, measurePoints: [] }),
  addMeasurePoint: (p) => {
    const cur = get().measurePoints;
    set({ measurePoints: cur.length >= 2 ? [p] : [...cur, p] });
  },
  displayStyle: 'shadedEdges',
  setDisplayStyle: (displayStyle) => set({ displayStyle }),
  section: { on: false, plane: 'front', offset: 0, flip: false },
  setSection: (p) => set({ section: { ...get().section, ...p } }),
  toggleSketchSel: (id) => {
    const cur = get().sketchSel;
    set({ sketchSel: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
  },
}));
