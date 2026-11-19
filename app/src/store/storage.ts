// Local persistence: autosave every part to IndexedDB (store "documents") and
// list them as recent parts. Also save-in-place to a file on disk where the
// browser has the File System Access API, with a download fallback.
import type { PartDocument } from '../model/types';
import { migrate } from '../model/migrate';

const DB = 'partwright';
const STORE = 'documents';
const VERSIONS = 'versions';

export interface RecentPart {
  id: string;
  name: string;
  updatedAt: string;
  units: PartDocument['units'];
  features: number;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' }).createIndex('updatedAt', 'updatedAt');
      if (!db.objectStoreNames.contains(VERSIONS)) db.createObjectStore(VERSIONS, { keyPath: 'key' }).createIndex('docId', 'docId');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>, store = STORE): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    t.oncomplete = () => db.close();
  });
}

export async function saveLocal(doc: PartDocument): Promise<void> {
  await tx('readwrite', (s) => s.put(JSON.parse(JSON.stringify(doc))));
}

export async function loadLocal(id: string): Promise<PartDocument | undefined> {
  const raw = await tx('readonly', (s) => s.get(id) as IDBRequest<unknown>);
  return raw ? migrate(raw) : undefined;
}

/* ---------- version history ---------- */

export interface PartVersion {
  key: string;
  docId: string;
  at: string;
  reason: 'saved' | 'timed' | 'manual' | 'before restore';
  name: string;
  features: number;
  doc: PartDocument;
}

const KEEP_VERSIONS = 50;

/** Keep a copy of the part. Oldest timed copies are dropped beyond 50. */
export async function saveVersion(doc: PartDocument, reason: PartVersion['reason']): Promise<void> {
  const v: PartVersion = {
    key: `${doc.id}:${Date.now()}`, docId: doc.id, at: new Date().toISOString(), reason,
    name: doc.name, features: doc.features.length - 3, doc: JSON.parse(JSON.stringify(doc)),
  };
  await tx('readwrite', (s) => s.put(v), VERSIONS);
  const all = await listVersions(doc.id);
  for (const old of all.slice(KEEP_VERSIONS)) await tx('readwrite', (s) => s.delete(old.key), VERSIONS);
}

/** Newest first. */
export async function listVersions(docId: string): Promise<PartVersion[]> {
  const all = await tx('readonly', (s) => s.index('docId').getAll(docId) as IDBRequest<PartVersion[]>, VERSIONS);
  return all.sort((a, b) => b.at.localeCompare(a.at));
}

export async function deleteLocal(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id));
}

export async function recentParts(limit = 8): Promise<RecentPart[]> {
  const all = await tx('readonly', (s) => s.getAll() as IDBRequest<PartDocument[]>);
  return all
    .filter((d) => d.features.length > 3) // skip parts with nothing in them
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit)
    .map((d) => ({ id: d.id, name: d.name, updatedAt: d.updatedAt, units: d.units, features: d.features.length - 3 }));
}

/* ---------- files ---------- */

type Handle = { name: string; createWritable(): Promise<{ write(d: Blob): Promise<void>; close(): Promise<void> }> };
type PickerWindow = Window & {
  showSaveFilePicker?: (o: unknown) => Promise<Handle>;
};

/** File handle per document id, so Save writes back to the same file. */
const handles = new Map<string, Handle>();

export const canSaveInPlace = () => typeof (window as PickerWindow).showSaveFilePicker === 'function';

/**
 * Save a part as a .pwpart file. With the File System Access API the first save
 * asks where, and later saves write to the same file. Otherwise it downloads.
 * Returns the file name used, or null if the user cancelled.
 */
export async function saveFile(doc: PartDocument, opts: { saveAs?: boolean } = {}): Promise<string | null> {
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
  const w = window as PickerWindow;
  if (w.showSaveFilePicker) {
    let h = opts.saveAs ? undefined : handles.get(doc.id);
    if (!h) {
      try {
        h = await w.showSaveFilePicker({
          suggestedName: `${doc.name}.pwpart`,
          types: [{ description: 'Partwright part', accept: { 'application/json': ['.pwpart'] } }],
        });
      } catch {
        return null; // cancelled
      }
      handles.set(doc.id, h);
    }
    const out = await h.createWritable();
    await out.write(blob);
    await out.close();
    return h.name;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${doc.name}.pwpart`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return a.download;
}
