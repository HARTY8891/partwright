// S21: command search. Ctrl+K opens it; type part of a command's name and press
// Enter. Commands that do not apply right now are listed but disabled.
import { useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { create } from 'zustand';
import { useDoc, type Tool } from '../store/docStore';
import { exportFile } from '../store/rebuild';
import { useView } from '../viewport/viewStore';
import { useDialogs } from './Dialogs';
import { useToolDialogs } from './MorePanels';
import type { FeatureDraft } from '../model/types';
import { cn } from '../ui/cn';

export const usePalette = create<{ open: boolean; set(open: boolean): void }>((set) => ({ open: false, set: (open) => set({ open }) }));

interface Command {
  id: string;
  label: string;
  group: string;
  keys?: string;
  enabled: boolean;
  run(): void;
}

function useCommands(): Command[] {
  const mode = useDoc((s) => s.mode);
  const past = useDoc((s) => s.past.length);
  const future = useDoc((s) => s.future.length);
  const s = useDoc.getState();
  const model = mode.kind === 'model';
  const sketching = mode.kind === 'sketch';
  const feat = (t: FeatureDraft['type'], label: string, keys?: string): Command => ({
    id: `feature:${t}`, label, group: 'Features', keys, enabled: mode.kind !== 'feature' || mode.draft.type !== t, run: () => s.beginFeature(t),
  });
  const tool = (t: Tool, label: string, keys: string): Command => ({
    id: `tool:${t}`, label, group: 'Sketch', keys, enabled: sketching, run: () => s.setTool(t),
  });
  const view = useView.getState();
  return [
    { id: 'sketch', label: 'Sketch on the selected plane or face', group: 'Sketch', keys: 'S', enabled: model, run: () => {
      const face = view.pickedFace;
      const sel = s.doc.features.find((f) => f.id === s.selection);
      if (face) s.beginSketch({ kind: 'face', face });
      else if (sel?.type === 'plane') s.beginSketch(sel.id);
      else s.notify('info', 'Select a plane or a flat face first.');
    } },
    { id: 'finish', label: 'Finish sketch', group: 'Sketch', enabled: sketching, run: () => s.endSketch() },
    tool('line', 'Line', 'L'), tool('centerline', 'Centerline', 'K'), tool('rect', 'Rectangle', 'R'), tool('circle', 'Circle', 'C'),
    tool('arc', 'Arc', 'A'), tool('polygon', 'Polygon', 'P'), tool('slot', 'Slot', 'T'), tool('spline', 'Spline', 'N'),
    tool('trim', 'Trim', 'Y'), tool('extend', 'Extend', 'W'), tool('dimension', 'Dimension', 'D'),
    feat('extrude', 'Extrude', 'E'), feat('cutExtrude', 'Cut', 'X'), feat('revolve', 'Revolve'), feat('cutRevolve', 'Cut revolve'),
    feat('fillet', 'Fillet'), feat('chamfer', 'Chamfer'), feat('shell', 'Shell'), feat('hole', 'Hole', 'H'),
    feat('linearPattern', 'Linear pattern'), feat('circularPattern', 'Circular pattern'), feat('mirror', 'Mirror'), feat('plane', 'Reference plane'), feat('axis', 'Reference axis'),
    { id: 'measure', label: 'Measure', group: 'Evaluate', enabled: model, run: () => view.setMeasuring(true) },
    { id: 'mass', label: 'Mass properties', group: 'Evaluate', enabled: true, run: () => useToolDialogs.getState().set({ mass: true }) },
    { id: 'equations', label: 'Equations', group: 'Evaluate', enabled: true, run: () => useToolDialogs.getState().set({ equations: true }) },
    { id: 'section', label: 'Section view', group: 'View', enabled: true, run: () => view.setSection({ on: !view.section.on }) },
    { id: 'shaded-edges', label: 'Shaded with edges', group: 'View', enabled: true, run: () => view.setDisplayStyle('shadedEdges') },
    { id: 'shaded', label: 'Shaded', group: 'View', enabled: true, run: () => view.setDisplayStyle('shaded') },
    { id: 'wireframe', label: 'Wireframe', group: 'View', enabled: true, run: () => view.setDisplayStyle('wireframe') },
    ...(['front', 'top', 'right', 'iso'] as const).map((v) => ({
      id: `view:${v}`, label: `${v === 'iso' ? 'Isometric' : v[0].toUpperCase() + v.slice(1)} view`, group: 'View', enabled: true, run: () => view.go(v),
    })),
    { id: 'fit', label: 'Zoom to fit', group: 'View', keys: 'F', enabled: true, run: () => view.go('fit') },
    { id: 'planes', label: 'Show or hide planes', group: 'View', enabled: true, run: () => s.togglePlanes() },
    { id: 'undo', label: 'Undo', group: 'Edit', keys: 'Ctrl+Z', enabled: past > 0, run: () => s.undo() },
    { id: 'redo', label: 'Redo', group: 'Edit', keys: 'Ctrl+Y', enabled: future > 0, run: () => s.redo() },
    { id: 'errors', label: 'Rebuild errors', group: 'Edit', enabled: true, run: () => useDialogs.getState().open('errors') },
    { id: 'new', label: 'New part', group: 'File', keys: 'Ctrl+N', enabled: true, run: () => useDialogs.getState().open('start') },
    { id: 'recent', label: 'Recent parts', group: 'File', enabled: true, run: () => useDialogs.getState().open('start') },
    { id: 'versions', label: 'Version history', group: 'File', enabled: true, run: () => useDialogs.getState().open('versions') },
    { id: 'open', label: 'Open file', group: 'File', keys: 'Ctrl+O', enabled: true, run: () => document.getElementById('open-file-input')?.click() },
    { id: 'stl', label: 'Export STL', group: 'File', enabled: true, run: () => exportFile('stl') },
    { id: 'step', label: 'Export STEP', group: 'File', enabled: true, run: () => exportFile('step') },
    { id: '3mf', label: 'Export 3MF', group: 'File', enabled: true, run: () => exportFile('3mf') },
    { id: 'import', label: 'Import STEP', group: 'File', enabled: true, run: () => document.getElementById('import-step-input')?.click() },
    { id: 'options', label: 'Options', group: 'Tools', enabled: true, run: () => useToolDialogs.getState().set({ options: true }) },
  ];
}

/** Every word typed must start a word of the label (or appear in it). */
function matches(label: string, q: string) {
  const l = label.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => l.includes(w));
}

export function CommandPalette() {
  const open = usePalette((p) => p.open);
  const commands = useCommands();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useMemo(() => commands.filter((c) => matches(`${c.label} ${c.group}`, q)), [commands, q]);
  useEffect(() => {
    if (open) (setQ(''), setActive(0));
  }, [open]);
  useEffect(() => setActive(0), [q]);
  const close = () => usePalette.getState().set(false);
  const run = (c: Command | undefined) => {
    if (!c || !c.enabled) return;
    close();
    // let the dialog close before the command opens anything of its own
    setTimeout(() => c.run(), 0);
  };
  return (
    <Dialog.Root open={open} onOpenChange={(v) => usePalette.getState().set(v)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-text/20" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-[15%] -translate-x-1/2 w-280 rounded-lg bg-surface-raised border border-border shadow-pop overflow-hidden"
          onOpenAutoFocus={(e) => (e.preventDefault(), input.current?.focus())}
        >
          <Dialog.Title className="sr-only">Command search</Dialog.Title>
          <input
            ref={input}
            role="combobox"
            aria-expanded
            aria-controls="palette-list"
            aria-activedescendant={list[active] ? `cmd-${list[active].id}` : undefined}
            aria-label="Search commands"
            placeholder="Type a command…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') (e.preventDefault(), setActive((a) => Math.min(list.length - 1, a + 1)));
              if (e.key === 'ArrowUp') (e.preventDefault(), setActive((a) => Math.max(0, a - 1)));
              if (e.key === 'Enter') (e.preventDefault(), run(list[active]));
            }}
            className="w-full h-20 px-8 text-base bg-bg border-b border-border outline-none"
          />
          <ul id="palette-list" role="listbox" aria-label="Commands" className="max-h-[50vh] overflow-auto p-2">
            {list.length === 0 && <li className="px-6 py-4 text-sm text-text-muted">No command matches “{q}”.</li>}
            {list.map((c, i) => (
              <li
                key={c.id}
                id={`cmd-${c.id}`}
                role="option"
                aria-selected={i === active}
                aria-disabled={!c.enabled}
                onMouseEnter={() => setActive(i)}
                onClick={() => run(c)}
                className={cn(
                  'flex items-center gap-6 h-16 px-6 rounded-md text-sm cursor-default',
                  i === active && 'bg-accent-soft',
                  !c.enabled && 'opacity-40',
                )}
              >
                <span className="flex-1">{c.label}</span>
                <span className="text-2xs text-text-muted">{c.group}</span>
                {c.keys && <kbd className="font-mono text-2xs text-text-muted">{c.keys}</kbd>}
              </li>
            ))}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
