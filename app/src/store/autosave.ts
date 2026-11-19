// Autosave: every document change is written to IndexedDB one second after the
// last edit, so closing the tab never loses more than a second of work.
import { create } from 'zustand';
import { useDoc } from './docStore';
import { saveLocal, saveVersion } from './storage';
import { useSettings } from './settings';

/** A timed copy goes into the version history at most this often. */
const VERSION_EVERY_MS = 10 * 60 * 1000;
const lastVersion = new Map<string, number>();

interface AutosaveState {
  /** updatedAt of the document version last written locally */
  savedAt: string | null;
  error: string | null;
}

export const useAutosave = create<AutosaveState>(() => ({ savedAt: null, error: null }));

/** True when the latest change is not in local storage yet. */
export const unsavedLocally = () => {
  const { doc } = useDoc.getState();
  const hasWork = doc.features.length > 3;
  return hasWork && useAutosave.getState().savedAt !== doc.updatedAt;
};

let timer: ReturnType<typeof setTimeout> | undefined;

export async function flushAutosave() {
  clearTimeout(timer);
  const { doc } = useDoc.getState();
  if (doc.features.length <= 3) return; // nothing worth keeping yet
  try {
    await saveLocal(doc);
    useAutosave.setState({ savedAt: doc.updatedAt, error: null });
    const last = lastVersion.get(doc.id);
    // a restore point at the first save of each session, then every 10 minutes of work
    if (last === undefined || Date.now() - last >= VERSION_EVERY_MS) {
      lastVersion.set(doc.id, Date.now());
      await saveVersion(doc, 'timed');
    }
  } catch (e) {
    useAutosave.setState({ error: e instanceof Error ? e.message : String(e) });
  }
}

export function startAutosave(delay = 1000) {
  let last = useDoc.getState().doc;
  useDoc.subscribe((s) => {
    if (s.doc === last) return;
    last = s.doc;
    clearTimeout(timer);
    timer = setTimeout(flushAutosave, (useSettings.getState().autosaveSeconds || delay / 1000) * 1000);
  });
  // Last chance when the tab is hidden or closed.
  addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flushAutosave());
}
