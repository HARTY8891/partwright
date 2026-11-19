// App-wide preferences (Options dialog, S20). Per-browser conveniences, kept in
// localStorage; the app works the same if storage is unavailable.
import { create } from 'zustand';
import type { Units } from '../model/units';

export interface Settings {
  /** units preselected for a new part */
  defaultUnits: Units;
  /** show the three default planes when a part opens */
  showPlanes: boolean;
  /** colour for new parts (token name) */
  defaultColor: string;
  /** autosave delay after the last edit, seconds */
  autosaveSeconds: number;
}

const KEY = 'partwright.settings';
const DEFAULTS: Settings = { defaultUnits: 'mm', showPlanes: true, defaultColor: 'part-steel', autosaveSeconds: 1 };

function load(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return DEFAULTS;
  }
}

export const useSettings = create<Settings & { update(p: Partial<Settings>): void }>((set, get) => ({
  ...load(),
  update: (p) => {
    set(p);
    try {
      const { update: _u, ...plain } = { ...get(), ...p };
      localStorage.setItem(KEY, JSON.stringify(plain));
    } catch {
      /* storage blocked: keep the setting for this session only */
    }
  },
}));

export const PART_COLORS: { id: string; label: string }[] = [
  { id: 'part-steel', label: 'Steel grey' },
  { id: 'part-blue', label: 'Blue' },
  { id: 'part-green', label: 'Green' },
  { id: 'part-orange', label: 'Orange' },
  { id: 'part-sand', label: 'Sand' },
];
