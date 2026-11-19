// File format versions. A part file carries `schemaVersion`. Every newer
// Partwright opens every older file: each format change adds one step here that
// upgrades version N to N+1, and steps run in order. Files from a newer
// Partwright are refused with a clear message instead of being half-read.
// The format is documented in app/docs/file-format.md.
import type { PartDocument } from './types';
import { SCHEMA_VERSION } from './types';

export class FormatError extends Error {}

type Step = (doc: Record<string, unknown>) => Record<string, unknown>;

/** steps[n] upgrades a version-n document to version n+1. */
const steps: Record<number, Step> = {
  // v0 → v1: files written before the format had a version number
  0: (d) => ({ ...d, schemaVersion: 1 }),
};

export function migrate(raw: unknown): PartDocument {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new FormatError('This is not a Partwright part file.');
  let d = raw as Record<string, unknown>;
  if (!Array.isArray(d.features)) throw new FormatError('This is not a Partwright part file (it has no feature list).');
  let v = typeof d.schemaVersion === 'number' ? d.schemaVersion : 0;
  if (v > SCHEMA_VERSION)
    throw new FormatError(`This part was saved by a newer Partwright (file format ${v}; this app reads up to ${SCHEMA_VERSION}). Reload the page to get the latest version.`);
  while (v < SCHEMA_VERSION) {
    const step = steps[v];
    if (!step) throw new FormatError(`No upgrade from file format ${v}.`);
    d = step(d);
    v = d.schemaVersion as number;
  }
  // fill optional fields so the rest of the app can rely on them
  const features = d.features as PartDocument['features'];
  const now = new Date().toISOString();
  return {
    ...(d as unknown as PartDocument),
    id: typeof d.id === 'string' ? d.id : crypto.randomUUID(),
    name: typeof d.name === 'string' ? d.name : 'Part',
    units: d.units === 'in' ? 'in' : 'mm',
    createdAt: typeof d.createdAt === 'string' ? d.createdAt : now,
    updatedAt: typeof d.updatedAt === 'string' ? d.updatedAt : now,
    rollbackIndex: typeof d.rollbackIndex === 'number' ? Math.min(d.rollbackIndex, features.length) : features.length,
    variables: Array.isArray(d.variables) ? (d.variables as PartDocument['variables']) : [],
    features,
  };
}
