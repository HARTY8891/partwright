// Display units. Everything is stored in millimetres; a part's `units` only
// changes what the user sees and types. Angles are always degrees.
import type { DimensionKind, PartDocument } from './types';

export type Units = PartDocument['units'];

export const MM_PER: Record<Units, number> = { mm: 1, in: 25.4 };

export const unitLabel = (u: Units) => (u === 'mm' ? 'mm' : 'in');
export const unitWord = (u: Units) => (u === 'mm' ? 'millimetres' : 'inches');

/** mm → display number */
export const toDisplay = (mm: number, u: Units) => mm / MM_PER[u];
/** display number → mm */
export const fromDisplay = (v: number, u: Units) => v * MM_PER[u];

/** Format a stored value for a dimension label. */
export function formatDim(kind: DimensionKind, value: number, u: Units): string {
  if (kind === 'angle') return `${value.toFixed(1)}°`;
  return toDisplay(value, u).toFixed(u === 'mm' ? 2 : 3);
}

/** Text for an expression the user will see, given a stored mm value. */
export const exprFor = (mm: number, u: Units) => String(+toDisplay(mm, u).toFixed(u === 'mm' ? 3 : 4));
