// Geometric constraint solver for point / line / circle / arc sketches.
// Unknowns: x, y of every point and the radius of every circle. Each constraint,
// dimension and arc adds residual equations. Solves with a damped minimum-norm
// Gauss-Newton step, so geometry that is not constrained moves as little as
// possible. Definition state comes from the null space of the Jacobian: an unknown
// is "defined" when no free motion changes it.
// Planned replacement once tangency and more relations land: PlaneGCS (architecture.md).

import type { Id, Pt, Sketch } from '../model/types';

export type SolveState = 'under' | 'full' | 'over' | 'conflict';

export interface SolveResult {
  ok: boolean; // converged
  sketch: Sketch; // with solved positions
  state: SolveState;
  dof: number;
  /** point / circle / arc ids whose unknowns are all fixed by constraints */
  defined: Set<Id>;
  /** constraint/dimension ids that are redundant (over-defining) */
  redundant: Set<Id>;
}

type Eq = { owner: Id; f: (v: Float64Array) => number };

const EPS = 1e-9;

interface Index {
  pt: Map<Id, number>; // -> index of x (y = +1)
  rad: Map<Id, number>; // circle id -> index of radius
  size: number;
}

function buildIndex(sk: Sketch): Index {
  const pt = new Map<Id, number>();
  const rad = new Map<Id, number>();
  let n = 0;
  for (const e of sk.entities) {
    if (e.kind === 'point') {
      pt.set(e.id, n);
      n += 2;
    }
  }
  for (const e of sk.entities) {
    if (e.kind === 'circle') rad.set(e.id, n++);
  }
  return { pt, rad, size: n };
}

function buildEquations(sk: Sketch, ix: Index): Eq[] {
  const eqs: Eq[] = [];
  const byId = new Map(sk.entities.map((e) => [e.id, e]));
  const X = (id: Id) => ix.pt.get(id)!;
  const Y = (id: Id) => ix.pt.get(id)! + 1;
  const pos = (id: Id) => {
    const e = byId.get(id);
    return e && e.kind === 'point' ? e.p : { x: 0, y: 0 };
  };
  const dist = (v: Float64Array, a: Id, b: Id) => Math.hypot(v[X(b)] - v[X(a)], v[Y(b)] - v[Y(a)]);
  /** line direction vector b - a */
  const dir = (v: Float64Array, l: { p1: Id; p2: Id }) => [v[X(l.p2)] - v[X(l.p1)], v[Y(l.p2)] - v[Y(l.p1)]] as const;
  /** centre id and current radius of a circle or arc */
  const round = (id: Id) => {
    const e = byId.get(id);
    if (e?.kind === 'circle') return { c: e.center, r: (v: Float64Array) => v[ix.rad.get(e.id)!] };
    if (e?.kind === 'arc') return { c: e.center, r: (v: Float64Array) => dist(v, e.center, e.start) };
    return null;
  };
  const lineOf = (id: Id) => {
    const e = byId.get(id);
    return e?.kind === 'line' ? e : null;
  };
  /** signed distance from point p to the infinite line l */
  const sdist = (v: Float64Array, p: Id, l: { p1: Id; p2: Id }) => {
    const [dx, dy] = dir(v, l);
    const len = Math.hypot(dx, dy) || 1e-12;
    return (dx * (v[Y(p)] - v[Y(l.p1)]) - dy * (v[X(p)] - v[X(l.p1)])) / len;
  };
  const vCur = (() => {
    const out = new Float64Array(ix.size);
    for (const e of sk.entities) {
      if (e.kind === 'point') {
        out[X(e.id)] = e.p.x;
        out[Y(e.id)] = e.p.y;
      } else if (e.kind === 'circle') out[ix.rad.get(e.id)!] = e.radius;
    }
    return out;
  })();
  const sign = (n: number) => (n < 0 ? -1 : 1);

  // Arcs: start and end stay the same distance from the center.
  for (const e of sk.entities) {
    if (e.kind === 'arc') eqs.push({ owner: e.id, f: (v) => dist(v, e.center, e.start) - dist(v, e.center, e.end) });
  }

  for (const c of sk.constraints) {
    if (c.kind === 'horizontal' || c.kind === 'vertical') {
      const l = byId.get(c.entityIds[0]);
      if (!l || l.kind !== 'line') continue;
      const k = c.kind === 'horizontal' ? Y : X;
      eqs.push({ owner: c.id, f: (v) => v[k(l.p1)] - v[k(l.p2)] });
    } else if (c.kind === 'coincident') {
      const [a, b] = c.entityIds;
      eqs.push({ owner: c.id, f: (v) => v[X(a)] - v[X(b)] });
      eqs.push({ owner: c.id, f: (v) => v[Y(a)] - v[Y(b)] });
    } else if (c.kind === 'fix') {
      const p = c.entityIds[0];
      const at = c.at ?? { x: 0, y: 0 };
      eqs.push({ owner: c.id, f: (v) => v[X(p)] - at.x });
      eqs.push({ owner: c.id, f: (v) => v[Y(p)] - at.y });
    } else if (c.kind === 'parallel' || c.kind === 'perpendicular') {
      const a = lineOf(c.entityIds[0]);
      const b = lineOf(c.entityIds[1]);
      if (!a || !b) continue;
      eqs.push({
        owner: c.id,
        f: (v) => {
          const [ax, ay] = dir(v, a);
          const [bx, by] = dir(v, b);
          const n = (Math.hypot(ax, ay) * Math.hypot(bx, by)) || 1e-12;
          return (c.kind === 'parallel' ? ax * by - ay * bx : ax * bx + ay * by) / n;
        },
      });
    } else if (c.kind === 'equal') {
      const la = lineOf(c.entityIds[0]);
      const lb = lineOf(c.entityIds[1]);
      if (la && lb) eqs.push({ owner: c.id, f: (v) => dist(v, la.p1, la.p2) - dist(v, lb.p1, lb.p2) });
      else {
        const ra = round(c.entityIds[0]);
        const rb = round(c.entityIds[1]);
        if (ra && rb) eqs.push({ owner: c.id, f: (v) => ra.r(v) - rb.r(v) });
      }
    } else if (c.kind === 'pointOnObject') {
      const [p, o] = c.entityIds;
      const l = lineOf(o);
      const r = round(o);
      if (l) eqs.push({ owner: c.id, f: (v) => sdist(v, p, l) });
      else if (r) eqs.push({ owner: c.id, f: (v) => dist(v, r.c, p) - r.r(v) });
    } else if (c.kind === 'tangent') {
      const [a, b] = c.entityIds;
      const l = lineOf(a) ?? lineOf(b);
      const ra = round(a);
      const rb = round(b);
      if (l && (ra || rb)) {
        const r = (ra ?? rb)!;
        const s = sign(sdist(vCur, r.c, l));
        eqs.push({ owner: c.id, f: (v) => s * sdist(v, r.c, l) - r.r(v) });
      } else if (ra && rb) {
        // inside or outside, whichever is closer to the current geometry
        const inside = dist(vCur, ra.c, rb.c) < Math.max(ra.r(vCur), rb.r(vCur));
        eqs.push({ owner: c.id, f: (v) => dist(v, ra.c, rb.c) - (inside ? Math.abs(ra.r(v) - rb.r(v)) : ra.r(v) + rb.r(v)) });
      }
    } else if (c.kind === 'concentric') {
      const ra = round(c.entityIds[0]);
      const rb = round(c.entityIds[1]);
      if (!ra || !rb) continue;
      eqs.push({ owner: c.id, f: (v) => v[X(ra.c)] - v[X(rb.c)] });
      eqs.push({ owner: c.id, f: (v) => v[Y(ra.c)] - v[Y(rb.c)] });
    } else if (c.kind === 'midpoint') {
      const p = c.entityIds[0];
      const l = lineOf(c.entityIds[1]);
      if (!l) continue;
      eqs.push({ owner: c.id, f: (v) => v[X(p)] - (v[X(l.p1)] + v[X(l.p2)]) / 2 });
      eqs.push({ owner: c.id, f: (v) => v[Y(p)] - (v[Y(l.p1)] + v[Y(l.p2)]) / 2 });
    }
  }
  for (const d of sk.dimensions) {
    if (!d.driving) continue;
    const target = d.value.value;
    if (d.kind === 'diameter' || d.kind === 'radius') {
      const e = byId.get(d.entityIds[0]);
      const k = d.kind === 'diameter' ? 2 : 1;
      if (e?.kind === 'circle') {
        const r = ix.rad.get(e.id)!;
        eqs.push({ owner: d.id, f: (v) => k * v[r] - target });
      } else if (e?.kind === 'arc') {
        eqs.push({ owner: d.id, f: (v) => k * dist(v, e.center, e.start) - target });
      }
      continue;
    }
    if (d.kind === 'angle') {
      const la = lineOf(d.entityIds[0]);
      const lb = lineOf(d.entityIds[1]);
      if (!la || !lb) continue;
      const rad = (target * Math.PI) / 180;
      eqs.push({
        owner: d.id,
        f: (v) => {
          const [ax, ay] = dir(v, la);
          const [bx, by] = dir(v, lb);
          // angle between the lines in [0, π], via atan2 for a smooth residual
          return Math.atan2(Math.abs(ax * by - ay * bx), ax * bx + ay * by) - rad;
        },
      });
      continue;
    }
    if (d.kind === 'pointLine') {
      const p = d.entityIds[0];
      const l = lineOf(d.entityIds[1]);
      if (!l) continue;
      const s = sign(sdist(vCur, p, l));
      eqs.push({ owner: d.id, f: (v) => s * sdist(v, p, l) - target });
      continue;
    }
    const [a, b] = d.entityIds;
    const pa = pos(a);
    const pb = pos(b);
    if (d.kind === 'distance') {
      eqs.push({ owner: d.id, f: (v) => dist(v, a, b) - target });
    } else if (d.kind === 'horizontalDistance') {
      const s = pb.x - pa.x < 0 ? -1 : 1;
      eqs.push({ owner: d.id, f: (v) => (v[X(b)] - v[X(a)]) * s - target });
    } else {
      const s = pb.y - pa.y < 0 ? -1 : 1;
      eqs.push({ owner: d.id, f: (v) => (v[Y(b)] - v[Y(a)]) * s - target });
    }
  }
  return eqs;
}

function jacobian(eqs: Eq[], v: Float64Array): number[][] {
  const h = 1e-7;
  const J: number[][] = [];
  for (const e of eqs) {
    const row = new Array(v.length).fill(0);
    const f0 = e.f(v);
    for (let j = 0; j < v.length; j++) {
      const old = v[j];
      v[j] = old + h;
      row[j] = (e.f(v) - f0) / h;
      v[j] = old;
    }
    J.push(row);
  }
  return J;
}

/** Solve A x = b for small dense A (Gauss-Jordan, partial pivoting). */
function solveDense(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const piv = M[c][c] || EPS;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / piv;
      if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / (r[i] || EPS));
}

/** Reduced row echelon form; returns pivot columns and which original rows became pivots. */
function rref(J: number[][], nCols: number) {
  const M = J.map((r) => [...r]);
  const rowOrder = M.map((_, i) => i);
  const pivots: number[] = [];
  const pivotRows: number[] = [];
  let row = 0;
  for (let c = 0; c < nCols && row < M.length; c++) {
    let p = row;
    for (let r = row + 1; r < M.length; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-6) continue;
    [M[row], M[p]] = [M[p], M[row]];
    [rowOrder[row], rowOrder[p]] = [rowOrder[p], rowOrder[row]];
    const piv = M[row][c];
    for (let k = 0; k < nCols; k++) M[row][k] /= piv;
    for (let r = 0; r < M.length; r++) {
      if (r === row) continue;
      const f = M[r][c];
      if (f) for (let k = 0; k < nCols; k++) M[r][k] -= f * M[row][k];
    }
    pivots.push(c);
    pivotRows.push(rowOrder[row]);
    row++;
  }
  return { M, pivots, pivotRows, rank: pivots.length };
}

export function solveSketch(input: Sketch): SolveResult {
  const ix = buildIndex(input);
  const v = new Float64Array(ix.size);
  for (const e of input.entities) {
    if (e.kind === 'point') {
      const i = ix.pt.get(e.id)!;
      v[i] = e.p.x;
      v[i + 1] = e.p.y;
    } else if (e.kind === 'circle') v[ix.rad.get(e.id)!] = e.radius;
  }

  const eqs = buildEquations(input, ix);
  let converged = eqs.length === 0;
  let lambda = 1e-6;
  for (let it = 0; it < 100 && eqs.length; it++) {
    const F = eqs.map((e) => e.f(v));
    const err = Math.max(...F.map(Math.abs));
    if (err < 1e-8) {
      converged = true;
      break;
    }
    const J = jacobian(eqs, v);
    // minimum-norm step: dx = -J^T (J J^T + λI)^-1 F
    const JJt = J.map((ri, i) => J.map((rj, j) => ri.reduce((s, x, k) => s + x * rj[k], 0) + (i === j ? lambda : 0)));
    const y = solveDense(JJt, F);
    for (let k = 0; k < v.length; k++) {
      let s = 0;
      for (let i = 0; i < eqs.length; i++) s += J[i][k] * y[i];
      v[k] -= s;
    }
    const after = Math.max(...eqs.map((e) => Math.abs(e.f(v))));
    lambda = after < err ? Math.max(lambda / 10, 1e-12) : lambda * 10;
  }

  const J = eqs.length ? jacobian(eqs, v) : [];
  const { M, pivots, pivotRows, rank } = rref(J, v.length);
  const dof = v.length - rank;

  const redundant = new Set<Id>();
  const pivotRowSet = new Set(pivotRows);
  eqs.forEach((e, i) => !pivotRowSet.has(i) && redundant.add(e.owner));

  const free = [...Array(v.length).keys()].filter((c) => !pivots.includes(c));
  const determined = new Array(v.length).fill(true);
  for (const fc of free) {
    determined[fc] = false;
    pivots.forEach((pc, r) => {
      if (Math.abs(M[r][fc]) > 1e-6) determined[pc] = false;
    });
  }
  const defined = new Set<Id>();
  const ptDefined = (id: Id) => {
    const i = ix.pt.get(id);
    return i !== undefined && determined[i] && determined[i + 1];
  };
  for (const e of input.entities) {
    if (e.kind === 'point' && ptDefined(e.id)) defined.add(e.id);
    if (e.kind === 'circle' && ptDefined(e.center) && determined[ix.rad.get(e.id)!]) defined.add(e.id);
    if (e.kind === 'arc' && ptDefined(e.center) && ptDefined(e.start) && ptDefined(e.end)) defined.add(e.id);
    if (e.kind === 'spline' && e.points.every(ptDefined)) defined.add(e.id);
    if (e.kind === 'text' && ptDefined(e.at)) defined.add(e.id);
  }

  const solved: Sketch = {
    ...input,
    entities: input.entities.map((e) => {
      if (e.kind === 'point') {
        const i = ix.pt.get(e.id)!;
        return { ...e, p: { x: clean(v[i]), y: clean(v[i + 1]) } };
      }
      if (e.kind === 'circle') return { ...e, radius: clean(Math.abs(v[ix.rad.get(e.id)!])) };
      return e;
    }),
  };

  const state: SolveState = !converged ? 'conflict' : redundant.size ? 'over' : dof === 0 ? 'full' : 'under';
  return { ok: converged, sketch: solved, state, dof, defined, redundant };
}

const clean = (n: number) => (Math.abs(n) < 1e-10 ? 0 : Math.round(n * 1e9) / 1e9);

export function pointOf(sk: Sketch, id: Id): Pt {
  const e = sk.entities.find((q) => q.id === id);
  return e && e.kind === 'point' ? e.p : { x: 0, y: 0 };
}
