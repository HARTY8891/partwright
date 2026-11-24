// Equations (S16): global variables, and any value typed as "=expression".
// Variables are in the part's display units. Every Param whose expr starts with
// "=" is re-evaluated after each change, then affected sketches are re-solved.
import { produce, type Draft } from 'immer';
import type { Dimension, Feature, Param, PartDocument, Sketch, Variable } from './types';
import { parseValue } from '../ui/Fields';
import { fromDisplay } from './units';
import { solveSketch } from '../solver/solve';

export const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Evaluate variables in dependency order. Returns values (display units) and per-variable errors. */
export function evalVariables(vars: Variable[] = []): { values: Record<string, number>; errors: Record<string, string> } {
  const values: Record<string, number> = {};
  const errors: Record<string, string> = {};
  const seen = new Set<string>();
  for (const v of vars) {
    if (!NAME_RE.test(v.name)) errors[v.id] = 'Names start with a letter and use letters, digits and _';
    else if (seen.has(v.name)) errors[v.id] = `The name ${v.name} is used twice`;
    seen.add(v.name);
  }
  let pending = vars.filter((v) => !errors[v.id]);
  // repeat until nothing new resolves: handles any order, detects cycles
  for (let pass = 0; pass <= vars.length && pending.length; pass++) {
    const next: Variable[] = [];
    for (const v of pending) {
      const text = v.expression.trim().startsWith('=') ? v.expression : `=${v.expression}`;
      const r = parseValue(text, values);
      if (r.value !== undefined) values[v.name] = r.value;
      else if (r.error?.startsWith('Unknown variable')) next.push(v);
      else errors[v.id] = r.error ?? 'Cannot read this expression';
    }
    if (next.length === pending.length) {
      for (const v of next) {
        const r = parseValue(v.expression.trim().startsWith('=') ? v.expression : `=${v.expression}`, values);
        const missing = r.error?.match(/"(.+)"/)?.[1];
        errors[v.id] = missing && vars.some((x) => x.name === missing) ? 'Circular reference' : (r.error ?? 'Cannot read this expression');
      }
      break;
    }
    pending = next;
  }
  return { values, errors };
}

/** The variables in force: the base list with the active configuration's values on top. */
export function effectiveVariables(doc: PartDocument): Variable[] {
  const cfg = doc.configurations?.find((c) => c.id === doc.activeConfig);
  return (doc.variables ?? []).map((v) => (cfg && cfg.values[v.name] !== undefined ? { ...v, expression: cfg.values[v.name] } : v));
}

/** The variable values of a document, for evaluating expressions as the user types. */
export const docVars = (doc: PartDocument) => evalVariables(effectiveVariables(doc)).values;

type Kind = 'length' | 'angle' | 'count';

/** Re-evaluate one Param if it is an expression. Returns true if its value changed. */
function evalParam(p: Draft<Param> | undefined, kind: Kind, vars: Record<string, number>, units: PartDocument['units']): boolean {
  if (!p || !p.expr.trim().startsWith('=')) return false;
  const r = parseValue(p.expr, vars);
  if (r.value === undefined) return false;
  const value = kind === 'length' ? fromDisplay(r.value, units) : r.value;
  if (Math.abs(value - p.value) < 1e-12) return false;
  p.value = value;
  return true;
}

function featureParams(f: Draft<Feature>, each: (p: Draft<Param> | undefined, kind: Kind) => void) {
  switch (f.type) {
    case 'extrude':
    case 'cutExtrude':
      each(f.direction1.depth, 'length');
      each(f.direction2?.depth, 'length');
      each(f.thin?.thickness, 'length');
      each(f.draft?.angle, 'angle');
      break;
    case 'revolve':
    case 'cutRevolve':
      each(f.angle, 'angle');
      break;
    case 'fillet':
    case 'chamfer':
      each(f.size, 'length');
      each(f.size2, 'length');
      break;
    case 'hole':
      each(f.diameter, 'length');
      if (f.end.type === 'blind') each(f.end.depth, 'length');
      each(f.cbore?.diameter, 'length');
      each(f.cbore?.depth, 'length');
      each(f.csink?.diameter, 'length');
      each(f.csink?.angle, 'angle');
      break;
    case 'rib':
      each(f.thickness, 'length');
      break;
    case 'helix':
      each(f.pitch, 'length');
      each(f.turns, 'count');
      break;
    case 'dome':
      each(f.height, 'length');
      break;
    case 'wrap':
      each(f.depth, 'length');
      break;
    case 'shell':
      each(f.thickness, 'length');
      break;
    case 'linearPattern':
      each(f.spacing, 'length');
      break;
    case 'circularPattern':
      each(f.spacing, 'angle');
      break;
    case 'plane':
      if (f.def.type === 'offset') each(f.def.distance, 'length');
      if (f.def.type === 'angle') each(f.def.angle, 'angle');
      break;
  }
}

/** Apply all expressions in the document (pure). Sketches with changed dimensions are re-solved. */
export function applyEquations(doc: PartDocument): PartDocument {
  const hasExpr = JSON.stringify(doc.features).includes('"expr":"=');
  if (!hasExpr && !doc.variables?.length) return doc;
  const { values, errors } = evalVariables(effectiveVariables(doc));
  return produce(doc, (d) => {
    for (const v of d.variables ?? []) v.value = errors[v.id] ? undefined : values[v.name];
    for (const f of d.features) {
      featureParams(f, (p, kind) => evalParam(p, kind, values, d.units));
      if (f.type === 'sketch') {
        let changed = false;
        for (const dim of f.sketch.dimensions as Draft<Dimension>[]) {
          changed = evalParam(dim.value, dim.kind === 'angle' ? 'angle' : 'length', values, d.units) || changed;
        }
        if (changed) {
          const res = solveSketch(f.sketch as Sketch);
          if (res.ok) f.sketch = res.sketch as Draft<Sketch>;
        }
      }
    }
  });
}
