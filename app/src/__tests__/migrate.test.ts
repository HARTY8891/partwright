import { describe, expect, it } from 'vitest';
import { FormatError, migrate } from '../model/migrate';
import { SCHEMA_VERSION } from '../model/types';

const planes = [
  { id: 'f', name: 'Front plane', suppressed: false, type: 'plane', def: { type: 'default', which: 'front' } },
  { id: 't', name: 'Top plane', suppressed: false, type: 'plane', def: { type: 'default', which: 'top' } },
  { id: 'r', name: 'Right plane', suppressed: false, type: 'plane', def: { type: 'default', which: 'right' } },
];

describe('file format migrations', () => {
  it('opens a file from before the format had a version number', () => {
    const d = migrate({ name: 'Old', features: planes });
    expect(d.schemaVersion).toBe(SCHEMA_VERSION);
    expect(d.units).toBe('mm');
    expect(d.rollbackIndex).toBe(3);
    expect(d.variables).toEqual([]);
    expect(typeof d.id).toBe('string');
  });

  it('keeps everything in a current file', () => {
    const src = { schemaVersion: 1, id: 'x', name: 'Box', units: 'in', createdAt: 'a', updatedAt: 'b', features: planes, rollbackIndex: 2, variables: [{ id: 'v', name: 'w', expression: '2' }] };
    const d = migrate(src);
    expect(d).toMatchObject({ id: 'x', name: 'Box', units: 'in', rollbackIndex: 2 });
    expect(d.variables).toHaveLength(1);
  });

  it('refuses a file from a newer Partwright with a clear message', () => {
    expect(() => migrate({ schemaVersion: SCHEMA_VERSION + 1, features: planes })).toThrow(/newer Partwright/);
  });

  it('refuses things that are not part files', () => {
    expect(() => migrate('hello')).toThrow(FormatError);
    expect(() => migrate({ name: 'no features' })).toThrow(/not a Partwright part file/);
    expect(() => migrate([1, 2])).toThrow(FormatError);
  });
});
