import { useEffect, useRef, useState, type ReactNode } from 'react';
import * as Menu from '@radix-ui/react-dropdown-menu';
import {
  Axis3D, Box, Circle, CircleDot, Eye, EyeOff, Hexagon, Layers, Maximize, Minus, MousePointer2, PenLine,
  RectangleHorizontal, Redo2, Rotate3D, Ruler, Scale3D, Scissors, Square, Trash2, Undo2, Pencil, Loader2,
  Spline, SquareDashed, Cylinder, MoveDiagonal, CircleDashed, PackageOpen, Columns3, RotateCw, FlipHorizontal2,
  Layers2, Slash, TriangleRight, Cable, Dot, Grid3x3, SquareDashedBottom, Pentagon, RectangleEllipsis, Variable as VariableIcon, SquareSplitHorizontal, Waves, ScissorsLineDashed, ArrowRightToLine, FileInput, Blend, Route,
} from 'lucide-react';
import { useDoc, consumedSketches, getSketch, type Tool } from '../store/docStore';
import { exportFile, startKernelSync, useKernel } from '../store/rebuild';
import { startAutosave, unsavedLocally } from '../store/autosave';
import { saveFile, saveVersion } from '../store/storage';
import { migrate } from '../model/migrate';
import { IMPORT_ACCEPT, prepareImport } from '../model/importFormats';
import { StartDialog, ErrorsDialog, VersionsDialog, useDialogs, useStartOnLaunch } from './Dialogs';
import { RelationsPanel } from './RelationsPanel';
import { CommandPalette, usePalette } from './CommandPalette';
import { referenceAxes } from './MorePanels';
import { ConfigPicker, ConfigurationsDialog, EquationsDialog, MassDialog, MeasurePanel, MoreFeatureOptions, OptionsDialog, PolygonOptions, SecondDirection, SectionPanel, ThinWall, DraftOption, FaceColour, needsPick, useToolDialogs } from './MorePanels';
import { RollbackBar } from '../ui/Tree';
import { docVars } from '../model/equations';
import { Viewport } from '../viewport/Viewport';
import { useView, type DisplayStyle } from '../viewport/viewStore';
import { Ribbon, RibbonButton, RibbonDivider, RibbonTabPanel, RibbonTabs } from '../ui/Ribbon';
import { Tree, TreeItem } from '../ui/Tree';
import { IconButton } from '../ui/Button';
import { ConfirmCorner, FeaturePanel, MessageBanner, PanelSection } from '../ui/Panel';
import { Checkbox, NumberField, Select, SelectionBox } from '../ui/Fields';
import { StatusBar, ToastProvider, TooltipProvider, useToast } from '../ui/Overlay';
import type { Feature, FeatureDraft } from '../model/types';
import { sketchesOf } from '../model/types';
import { edgeLabel, faceLabel } from '../model/refs';
import { frameForSketch, toWorld } from '../model/planes';
import { cn } from '../ui/cn';

let started = false;

// Dev-only hook so end-to-end tests drive the same store instances the app uses.
if (import.meta.env.DEV) {
  (window as unknown as { __pw: unknown }).__pw = { useDoc, useKernel, useView, frameForSketch, toWorld };
}

export function Workspace() {
  useEffect(() => {
    if (!started) {
      started = true;
      startKernelSync();
      startAutosave();
    }
  }, []);
  return (
    <TooltipProvider>
      <ToastProvider>
        <Shell />
      </ToastProvider>
    </TooltipProvider>
  );
}

function Shell() {
  useShortcuts();
  useToastBridge();
  useLeaveWarning();
  useStartOnLaunch();
  const mode = useDoc((s) => s.mode);
  const loading = useKernel((s) => s.loading);
  const loadError = useKernel((s) => s.loadError);
  return (
    <div className="flex flex-col h-full min-w-[1024px]">
      <MenuBar />
      <CommandRibbon />
      <div className="flex flex-1 min-h-0">
        <aside aria-label="Left panel" className="flex flex-col w-140 shrink-0 bg-surface-raised border-r border-border overflow-auto">
          {mode.kind === 'feature' ? (
            <FeatureOptions />
          ) : (
            <>
              <MeasurePanel />
              <SectionPanel />
              <PolygonOptions />
              <RelationsPanel />
              <FeatureTree />
            </>
          )}
        </aside>
        <main className="relative flex-1 min-w-0">
          <Viewport />
          <ViewToolbar />
          <div className="absolute top-4 right-4">
            {mode.kind === 'sketch' && (
              <ConfirmCorner mode="sketch" onConfirm={() => useDoc.getState().endSketch()} onCancel={() => useDoc.getState().cancelSketch()} />
            )}
            {mode.kind === 'feature' && <FeatureCorner />}
          </div>
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="flex items-center gap-4 px-8 py-6 rounded-md bg-surface-raised shadow-pop text-sm" role="status">
                <Loader2 size={16} className="animate-spin" aria-hidden /> Loading the geometry engine…
              </div>
            </div>
          )}
          {loadError && (
            <div className="absolute bottom-8 left-8 right-8">
              <MessageBanner tone="error">The geometry engine failed to load: {loadError}</MessageBanner>
            </div>
          )}
        </main>
      </div>
      <Status />
      <StartDialog />
      <ErrorsDialog />
      <VersionsDialog />
      <CommandPalette />
      <OptionsDialog />
      <ConfigurationsDialog />
      <EquationsDialog />
      <MassDialog />
    </div>
  );
}

/* ---------- menu bar ---------- */

function MenuBar() {
  const fileInput = useRef<HTMLInputElement>(null);
  const s = useDoc();
  const save = (saveAs = false) => saveDoc(saveAs);
  const open = async (file: File) => {
    try {
      const doc = migrate(JSON.parse(await file.text()));
      s.loadDoc({ ...doc, name: file.name.replace(/\.pwpart$/, '') });
      s.notify('success', `Opened ${file.name}`);
    } catch (e) {
      s.notify('error', `Could not open ${file.name}: ${e instanceof Error ? e.message : e}`);
    }
  };
  return (
    <nav aria-label="Menu" className="flex items-center h-14 px-4 gap-1 bg-surface-raised border-b border-border text-xs">
      <Box size={14} className="text-accent mr-2" aria-hidden />
      <MenuRoot label="File">
        <Item onSelect={() => useDialogs.getState().open('start')} shortcut="Ctrl+N">New part…</Item>
        <Item onSelect={() => fileInput.current?.click()} shortcut="Ctrl+O">Open file…</Item>
        <Item onSelect={() => useDialogs.getState().open('start')}>Recent parts…</Item>
        <Item onSelect={() => useDialogs.getState().open('versions')}>Version history…</Item>
        <Menu.Separator className="h-px my-2 bg-border" />
        <Item onSelect={() => save()} shortcut="Ctrl+S">Save</Item>
        <Item onSelect={() => save(true)} shortcut="Ctrl+Shift+S">Save as…</Item>
        <Menu.Separator className="h-px my-2 bg-border" />
        <Item onSelect={() => exportFile('stl')}>Export STL…</Item>
        <Item onSelect={() => exportFile('step')}>Export STEP…</Item>
        <Item onSelect={() => exportFile('3mf')}>Export 3MF (3D printing)…</Item>
        <Menu.Separator className="h-px my-2 bg-border" />
        <Item onSelect={() => document.getElementById('import-step-input')?.click()}>Import (STEP, STL, OBJ, 3MF)…</Item>
      </MenuRoot>
      <MenuRoot label="Edit">
        <Item onSelect={() => useDialogs.getState().open('errors')}>Rebuild errors…</Item>
        <Item onSelect={s.undo} disabled={!s.past.length} shortcut="Ctrl+Z">Undo</Item>
        <Item onSelect={s.redo} disabled={!s.future.length} shortcut="Ctrl+Y">Redo</Item>
      </MenuRoot>
      <MenuRoot label="Tools">
        <Item onSelect={() => useToolDialogs.getState().set({ equations: true })}>Equations…</Item>
        <Item onSelect={() => useToolDialogs.getState().set({ mass: true })}>Mass properties…</Item>
        <Item onSelect={() => useView.getState().setMeasuring(!useView.getState().measuring)}>Measure</Item>
        <Menu.Separator className="h-px my-2 bg-border" />
        <Item onSelect={() => useToolDialogs.getState().set({ options: true })}>Options…</Item>
      </MenuRoot>
      <MenuRoot label="View">
        {(['front', 'top', 'right', 'iso'] as const).map((v) => (
          <Item key={v} onSelect={() => useView.getState().go(v)}>
            {v === 'iso' ? 'Isometric' : v[0].toUpperCase() + v.slice(1)}
          </Item>
        ))}
        <Item onSelect={() => useView.getState().go('fit')} shortcut="F">Zoom to fit</Item>
        <Item onSelect={s.togglePlanes}>{s.showPlanes ? 'Hide planes' : 'Show planes'}</Item>
      </MenuRoot>
      <span className="ml-6 text-text-muted truncate">
        {s.doc.name}
        {s.dirty && ' •'}
      </span>
      <button onClick={() => usePalette.getState().set(true)} className="ml-auto mr-6 flex items-center gap-3 h-12 px-4 rounded-md border border-border text-text-muted hover:text-text">
        Search commands <kbd className="font-mono text-2xs">Ctrl+K</kbd>
      </button>
      <a href="#design" className="text-text-muted hover:text-text">Design system</a>
      <input
        id="import-step-input"
        aria-label="Import a 3D file"
        type="file"
        accept={IMPORT_ACCEPT}
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          if (f.size > 20 * 1024 * 1024) return s.notify('error', `${f.name} is over 20 MB; it would make the part file too big.`);
          const r = await prepareImport(f.name, new Uint8Array(await f.arrayBuffer()));
          if ('error' in r) return s.notify('error', r.error);
          s.addImport(f.name, r.data, r.format, r.parts);
          s.notify('success', `Imported ${f.name}${r.note ? ` (${r.note})` : ''}. It is a plain solid without history: add features on top of it.`);
        }}
      />
      <input
        ref={fileInput}
        id="open-file-input"
        aria-label="Open a part file"
        type="file"
        accept=".pwpart,application/json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) open(f);
          e.target.value = '';
        }}
      />
    </nav>
  );
}

function MenuRoot({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Menu.Root>
      <Menu.Trigger className="h-12 px-4 rounded-sm hover:bg-surface-sunken data-[state=open]:bg-surface-sunken">{label}</Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="start" sideOffset={2} className="min-w-100 rounded-md bg-surface-raised border border-border shadow-pop p-2 text-sm z-50">
          {children}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

function Item({ children, onSelect, disabled, shortcut }: { children: ReactNode; onSelect: () => void; disabled?: boolean; shortcut?: string }) {
  return (
    <Menu.Item
      onSelect={onSelect}
      disabled={disabled}
      className="flex items-center justify-between gap-8 h-14 px-4 rounded-sm outline-none cursor-default data-[highlighted]:bg-accent-soft data-[disabled]:opacity-40"
    >
      {children}
      {shortcut && <kbd className="font-mono text-2xs text-text-muted">{shortcut}</kbd>}
    </Menu.Item>
  );
}

/* ---------- ribbon ---------- */

function CommandRibbon() {
  const mode = useDoc((s) => s.mode);
  const selection = useDoc((s) => s.selection);
  const doc = useDoc((s) => s.doc);
  const [tab, setTab] = useState('Features');
  useEffect(() => {
    if (mode.kind === 'sketch') setTab('Sketch');
    else setTab('Features');
  }, [mode.kind]);

  const sel = doc.features.find((f) => f.id === selection);
  const pickedFace = useView((v) => v.pickedFace);
  const sketchSel = useView((v) => v.sketchSel);
  const s = useDoc.getState();
  const startSketch = () => {
    if (pickedFace) s.beginSketch({ kind: 'face', face: pickedFace });
    else if (sel?.type === 'plane') s.beginSketch(sel.id);
    else s.notify('info', 'Select a plane or a flat face, then choose Sketch. (Double-clicking a plane or face also works.)');
  };
  const tool = mode.kind === 'sketch' ? mode.tool : null;
  const toolBtn = (t: Tool, icon: ReactNode, label: string, key: string) => (
    <RibbonButton icon={icon} label={label} shortcut={key} active={tool === t} disabled={mode.kind !== 'sketch'} onClick={() => s.setTool(t)} />
  );
  const measuring = useView((v) => v.measuring);
  const feat = (t: FeatureDraft['type'], icon: ReactNode, label: string, key?: string) => (
    <RibbonButton icon={icon} label={label} shortcut={key} active={mode.kind === 'feature' && mode.draft.type === t} onClick={() => s.beginFeature(t)} />
  );
  return (
    <RibbonTabs tabs={['Features', 'Sketch', 'Evaluate']} value={tab} onValueChange={setTab}>
      <RibbonTabPanel value="Features">
        <Ribbon label="Feature commands">
          <RibbonButton icon={<PenLine size={24} />} label="Sketch" shortcut="S" disabled={mode.kind !== 'model'} onClick={startSketch} />
          <RibbonDivider />
          {feat('extrude', <Box size={24} />, 'Extrude', 'E')}
          {feat('revolve', <Rotate3D size={24} />, 'Revolve')}
          {feat('loft', <Blend size={24} />, 'Loft')}
          {feat('sweep', <Route size={24} />, 'Sweep')}
          {feat('rib', <TriangleRight size={24} />, 'Rib')}
          {feat('helix', <Cable size={24} />, 'Helix')}
          <RibbonDivider />
          {feat('cutExtrude', <Scissors size={24} />, 'Cut', 'X')}
          {feat('cutRevolve', <Cylinder size={24} />, 'Cut revolve')}
          <RibbonDivider />
          {feat('fillet', <CircleDot size={24} />, 'Fillet')}
          {feat('chamfer', <Hexagon size={24} />, 'Chamfer')}
          {feat('shell', <PackageOpen size={24} />, 'Shell')}
          {feat('hole', <CircleDashed size={24} />, 'Hole', 'H')}
          <RibbonDivider />
          {feat('linearPattern', <Columns3 size={24} />, 'Linear pattern')}
          {feat('circularPattern', <RotateCw size={24} />, 'Circular pattern')}
          {feat('mirror', <FlipHorizontal2 size={24} />, 'Mirror')}
          {feat('sketchPattern', <Grid3x3 size={24} />, 'Sketch pattern')}
          <RibbonDivider />
          {feat('plane', <Layers2 size={24} />, 'Plane')}
          {feat('axis', <Slash size={24} />, 'Axis')}
        </Ribbon>
      </RibbonTabPanel>
      <RibbonTabPanel value="Sketch">
        <Ribbon label="Sketch tools">
          {mode.kind !== 'sketch' ? (
            <RibbonButton icon={<PenLine size={24} />} label="Sketch" disabled={mode.kind !== 'model'} onClick={startSketch} />
          ) : (
            <RibbonButton icon={<PenLine size={24} />} label="Finish sketch" active onClick={() => s.endSketch()} />
          )}
          <RibbonDivider />
          {toolBtn('select', <MousePointer2 size={24} />, 'Select', 'Esc')}
          {toolBtn('point', <Dot size={24} />, 'Point', 'O')}
          {toolBtn('line', <Minus size={24} />, 'Line', 'L')}
          {toolBtn('centerline', <MoveDiagonal size={24} />, 'Centerline', 'K')}
          {toolBtn('rect', <RectangleHorizontal size={24} />, 'Rectangle', 'R')}
          {toolBtn('circle', <Circle size={24} />, 'Circle', 'C')}
          {toolBtn('arc', <Spline size={24} />, 'Arc', 'A')}
          {toolBtn('polygon', <Pentagon size={24} />, 'Polygon', 'P')}
          {toolBtn('slot', <RectangleEllipsis size={24} />, 'Slot', 'T')}
          {toolBtn('spline', <Waves size={24} />, 'Spline', 'N')}
          <RibbonDivider />
          {toolBtn('trim', <ScissorsLineDashed size={24} />, 'Trim', 'Y')}
          {toolBtn('extend', <ArrowRightToLine size={24} />, 'Extend', 'W')}
          <RibbonButton icon={<SquareDashedBottom size={24} />} label="Convert edges" disabled={mode.kind !== 'sketch'} onClick={() => void s.convertEdges()} />
          <RibbonDivider />
          {toolBtn('dimension', <Ruler size={24} />, 'Dimension', 'D')}
          <RibbonButton
            icon={<SquareDashed size={24} />}
            label="Construction"
            shortcut="G"
            disabled={mode.kind !== 'sketch' || !sketchSel.length}
            onClick={() => sketchSel.forEach((id) => s.toggleConstruction(id))}
          />
          <RibbonDivider />
          <RibbonButton icon={<Box size={24} />} label="Extrude" disabled={mode.kind !== 'sketch'} onClick={() => s.beginFeature('extrude')} />
          <RibbonButton icon={<Scissors size={24} />} label="Cut" disabled={mode.kind !== 'sketch'} onClick={() => s.beginFeature('cutExtrude')} />
          <RibbonButton icon={<Rotate3D size={24} />} label="Revolve" disabled={mode.kind !== 'sketch'} onClick={() => s.beginFeature('revolve')} />
        </Ribbon>
      </RibbonTabPanel>
      <RibbonTabPanel value="Evaluate">
        <Ribbon label="Evaluate tools">
          <RibbonButton icon={<Ruler size={24} />} label="Measure" active={measuring} disabled={mode.kind !== 'model'} onClick={() => useView.getState().setMeasuring(!measuring)} />
          <RibbonButton icon={<Scale3D size={24} />} label="Mass properties" onClick={() => useToolDialogs.getState().set({ mass: true })} />
          <RibbonButton icon={<VariableIcon size={24} />} label="Equations" onClick={() => useToolDialogs.getState().set({ equations: true })} />
        </Ribbon>
      </RibbonTabPanel>
    </RibbonTabs>
  );
}

/* ---------- feature tree ---------- */

const ICONS: Record<Feature['type'], ReactNode> = {
  plane: <Square size={16} />, axis: <Slash size={16} />, rib: <TriangleRight size={16} />, helix: <Cable size={16} />, sketch: <PenLine size={16} />, extrude: <Box size={16} />, cutExtrude: <Scissors size={16} />,
  revolve: <Rotate3D size={16} />, cutRevolve: <Cylinder size={16} />, fillet: <CircleDot size={16} />, chamfer: <Hexagon size={16} />,
  hole: <CircleDashed size={16} />, shell: <PackageOpen size={16} />, linearPattern: <Columns3 size={16} />,
  circularPattern: <RotateCw size={16} />, mirror: <FlipHorizontal2 size={16} />, sketchPattern: <Grid3x3 size={16} />, import: <FileInput size={16} />,
  loft: <Blend size={16} />, sweep: <Route size={16} />,
};
const iconFor = (f: Feature) => ICONS[f.type];

function FeatureTree() {
  const doc = useDoc((s) => s.doc);
  const selection = useDoc((s) => s.selection);
  const mode = useDoc((s) => s.mode);
  const statuses = useKernel((s) => s.statuses);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const s = useDoc.getState();
  const used = consumedSketches(doc);
  const sel = doc.features.find((f) => f.id === selection);
  const editing = mode.kind === 'sketch' ? mode.sketchId : null;

  const item = (f: Feature, level: number, expanded?: boolean) => {
    const st = statuses[f.id];
    return (
      <TreeItem
        key={f.id}
        icon={iconFor(f)}
        label={f.id === editing ? `${f.name} (editing)` : f.name}
        level={level}
        selected={selection === f.id}
        suppressed={f.suppressed}
        rolledBack={doc.features.indexOf(f) >= doc.rollbackIndex}
        status={st?.status}
        message={st?.message ?? (st?.ms !== undefined ? `Built in ${st.ms} ms${st.cached ? ', reused this time' : ''}` : undefined)}
        expanded={expanded}
        onToggle={() => {
          const n = new Set(collapsed);
          if (n.has(f.id)) n.delete(f.id);
          else n.add(f.id);
          setCollapsed(n);
        }}
        onSelect={() => s.select(f.id)}
        onActivate={() => (f.type === 'plane' && f.def.type === 'default' ? s.beginSketch(f.id) : s.editFeature(f.id))}
        onRename={f.type === 'plane' ? undefined : (n) => s.renameFeature(f.id, n)}
        // reorder: drop a feature here to put it just above this one; Alt+arrows move by one
        dragId={(f.type === 'plane' && f.def.type === 'default') || (f.type === 'sketch' && used.has(f.id)) || mode.kind !== 'model' ? undefined : f.id}
        onDropItem={mode.kind === 'model' ? (dragged) => s.moveFeature(dragged, doc.features.indexOf(f)) : undefined}
        onMove={
          (f.type === 'plane' && f.def.type === 'default') || (f.type === 'sketch' && used.has(f.id)) || mode.kind !== 'model'
            ? undefined
            : (dir) => {
                // step over a whole row of the tree (a feature with its sketches), not one feature
                const top = doc.features.filter((x) => !(x.type === 'sketch' && used.has(x.id)));
                const k = top.indexOf(f);
                const blockStart = (x: Feature) => Math.min(doc.features.indexOf(x), ...sketchesOf(x).map((id) => doc.features.findIndex((y) => y.id === id)));
                if (dir < 0) {
                  const prev = top[k - 1];
                  if (prev) s.moveFeature(f.id, blockStart(prev));
                } else {
                  const next = top[k + 1];
                  if (next) s.moveFeature(f.id, doc.features.indexOf(next) + 1);
                }
              }
        }
      />
    );
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 h-16 px-4 border-b border-border">
        <h2 className="flex-1 text-2xs font-semibold uppercase tracking-wide text-text-muted">{doc.name}</h2>
        <IconButton size="sm" label="Edit selected" disabled={!sel || (sel.type === 'plane' && sel.def.type === 'default') || mode.kind !== 'model'} onClick={() => sel && s.editFeature(sel.id)}>
          <Pencil size={14} />
        </IconButton>
        <IconButton size="sm" label={sel?.suppressed ? 'Unsuppress selected' : 'Suppress selected'} disabled={!sel || (sel.type === 'plane' && sel.def.type === 'default') || mode.kind !== 'model'} onClick={() => sel && s.toggleSuppress(sel.id)}>
          {sel?.suppressed ? <Eye size={14} /> : <EyeOff size={14} />}
        </IconButton>
        <IconButton size="sm" label="Delete selected" disabled={!sel || (sel.type === 'plane' && sel.def.type === 'default') || mode.kind !== 'model'} onClick={() => sel && s.deleteFeature(sel.id)}>
          <Trash2 size={14} />
        </IconButton>
      </div>
      <ConfigPicker />
      <Tree label="Feature tree" hasSelection={!!sel}>
        <TreeItem icon={<Axis3D size={16} />} label="Origin" />
        {doc.features.map((f, i) => {
          // the rollback bar sits after the last built feature
          const bar =
            i === doc.rollbackIndex && i >= 3 ? <RollbackBarRow key="rollback" index={doc.rollbackIndex} max={doc.features.length} /> : null;
          let row: ReactNode;
          if (f.type === 'sketch' && used.has(f.id)) row = null; // shown under the feature that uses it
          else if (sketchesOf(f).length) {
            const sks = sketchesOf(f).map((id) => getSketch(doc, id)).filter((x): x is NonNullable<typeof x> => !!x);
            const open = !collapsed.has(f.id);
            row = (
              <div key={f.id}>
                {item(f, 1, sks.length ? open : undefined)}
                {open && sks.map((sk) => item(sk, 2))}
              </div>
            );
          } else row = item(f, 1);
          return bar ? [bar, row] : row;
        })}
        {doc.rollbackIndex >= doc.features.length && doc.features.length > 3 && (
          <RollbackBarRow index={doc.rollbackIndex} max={doc.features.length} />
        )}
      </Tree>
      <p className="mt-auto p-6 text-2xs text-text-muted">
        Double-click a plane to sketch on it. Double-click a feature to edit it. F2 renames.
      </p>
    </div>
  );
}

/** Rollback bar: drag it up the tree (or focus it and use ↑/↓) to build the part only up to a point. */
function RollbackBarRow({ index, max }: { index: number; max: number }) {
  const set = (i: number) => useDoc.getState().setRollback(i);
  return (
    <div
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        const move = (ev: PointerEvent) => {
          // the feature row under the pointer: the bar goes just above it
          const el = document.elementsFromPoint(ev.clientX, ev.clientY).find((x) => x.getAttribute('role') === 'treeitem') as HTMLElement | undefined;
          const name = el?.textContent?.replace(/ \(editing\)$/, '');
          const doc = useDoc.getState().doc;
          const i = doc.features.findIndex((f) => f.name === name);
          if (i < 0) return;
          const r = el!.getBoundingClientRect();
          set(ev.clientY > r.top + r.height / 2 ? i + 1 : i);
        };
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      }}
    >
      <RollbackBar index={index} max={max} onChange={set} />
    </div>
  );
}

/* ---------- feature options panel ---------- */

const TITLES: Record<FeatureDraft['type'], string> = {
  extrude: 'Extrude', cutExtrude: 'Cut', revolve: 'Revolve', cutRevolve: 'Cut revolve', fillet: 'Fillet', chamfer: 'Chamfer',
  hole: 'Hole', shell: 'Shell', linearPattern: 'Linear pattern', circularPattern: 'Circular pattern', sketchPattern: 'Sketch-driven pattern', mirror: 'Mirror', plane: 'Plane', import: 'Imported solid',
  loft: 'Loft', sweep: 'Sweep', axis: 'Reference axis', rib: 'Rib', helix: 'Helix',
};

function FeatureOptions() {
  const mode = useDoc((s) => s.mode);
  const previewError = useKernel((s) => s.previewError);
  const doc = useDoc((s) => s.doc);
  if (mode.kind !== 'feature') return null;
  const { draft } = mode;
  const s = useDoc.getState();
  const editing = mode.editingId ? doc.features.find((f) => f.id === mode.editingId)?.name : null;
  const sketch = 'sketchId' in draft ? getSketch(doc, draft.sketchId) : undefined;
  const isEdgeFeature = draft.type === 'fillet' || draft.type === 'chamfer';
  const pending = needsPick(draft);
  const emptyEdges = !!pending;
  const vars = docVars(doc);
  const hint =
    pending ??
    (sketch
      ? `Using ${sketch.name}${sketch.on.kind === 'face' ? ` on ${faceLabel(doc, sketch.on.face)}` : ''}. The yellow shape shows the result.`
      : draft.type === 'plane'
        ? 'The yellow square shows the new plane.'
        : draft.type === 'axis'
          ? 'The yellow line shows the new axis.'
          : draft.type === 'helix'
            ? 'The yellow curve shows the helix. Use it as the path of a sweep.'
        : 'The yellow shape shows the result.');
  return (
    <div className="p-4">
      <FeaturePanel
        icon={draft.type === 'plane' ? <Layers2 size={18} /> : ICONS[draft.type]}
        title={editing ? `Edit ${editing}` : TITLES[draft.type]}
        canConfirm={!previewError && !emptyEdges}
        onConfirm={s.confirmFeature}
        onCancel={s.cancelFeature}
      >
        {previewError && !emptyEdges ? <MessageBanner tone="error">{previewError}</MessageBanner> : <MessageBanner tone="info">{hint}</MessageBanner>}

        {(draft.type === 'extrude' || draft.type === 'cutExtrude') && (
          <PanelSection title="Direction">
            <Select
              label="End condition"
              value={draft.direction1.type}
              onChange={(v) =>
                s.updateDraft((d) => {
                  if (!('direction1' in d)) return;
                  d.direction1 =
                    v === 'upToFace'
                      ? { type: 'upToFace', depth: d.direction1.depth, face: null }
                      : v === 'upToVertex'
                        ? { type: 'upToVertex', depth: d.direction1.depth, vertex: null }
                        : { type: v, depth: d.direction1.depth };
                })
              }
              options={[
                { value: 'blind', label: 'Fixed depth' },
                { value: 'midPlane', label: 'Symmetric about the plane' },
                { value: 'throughAll', label: 'Through everything' },
                { value: 'throughAllBoth', label: 'Through everything, both ways' },
                { value: 'upToFace', label: 'Up to a face' },
                { value: 'upToVertex', label: 'Up to a corner' },
              ]}
            />
            {(draft.direction1.type === 'blind' || draft.direction1.type === 'midPlane') && (
              <NumberField
                key={draft.direction1.type}
                label="Depth"
                lengthUnits={doc.units}
                vars={vars}
                value={draft.direction1.depth.expr}
                min={0.001}
                onCommit={(expr, value) => s.updateDraft((d) => void ('direction1' in d && (d.direction1.depth = { expr, value })))}
              />
            )}
            {(draft.direction1.type === 'blind' || draft.direction1.type === 'throughAll') && (
              <Checkbox label="Reverse direction" checked={draft.reverse} onChange={(v) => s.updateDraft((d) => void ('reverse' in d && (d.reverse = v)))} />
            )}
          </PanelSection>
        )}
        <SecondDirection draft={draft} />
        <ThinWall draft={draft} />
        <DraftOption draft={draft} />
        <FaceColour draft={draft} />
        <MoreFeatureOptions draft={draft} />

        {(draft.type === 'revolve' || draft.type === 'cutRevolve') && sketch && (
          <PanelSection title="Axis and angle">
            <Select
              label="Axis"
              value={draft.axisId ? `ref:${draft.axisId}` : draft.axisLineId}
              onChange={(v) =>
                s.updateDraft((d) => {
                  if (!('axisLineId' in d)) return;
                  if (v.startsWith('ref:')) d.axisId = v.slice(4);
                  else (d.axisLineId = v), (d.axisId = undefined);
                })
              }
              options={[
                ...referenceAxes(doc).map((a) => ({ value: `ref:${a.id}`, label: a.name })),
                ...sketch.sketch.entities
                .filter((e) => e.kind === 'line' && e.construction)
                .map((e, i) => ({ value: e.id, label: `Centerline ${i + 1}` }))]}
            />
            <NumberField
              label="Angle"
              unit="°"
              vars={vars}
              value={draft.angle.expr}
              min={0.001}
              onCommit={(expr, value) => s.updateDraft((d) => void ('angle' in d && (d.angle = { expr, value })))}
            />
            <Checkbox label="Reverse direction" checked={draft.reverse} onChange={(v) => s.updateDraft((d) => void ('reverse' in d && (d.reverse = v)))} />
          </PanelSection>
        )}

        {isEdgeFeature && (
          <PanelSection title="Edges">
            <SelectionBox
              label="Edges"
              prompt="Click edges on the model"
              focused
              items={draft.edges.map((e) => edgeLabel(doc, e))}
              onRemove={(i) => s.updateDraft((d) => void ('edges' in d && d.edges.splice(i, 1)))}
            />
            <NumberField
              label={draft.type === 'fillet' ? 'Radius' : 'Distance'}
              lengthUnits={doc.units}
              vars={vars}
              value={draft.size.expr}
              min={0.001}
              onCommit={(expr, value) => s.updateDraft((d) => void ('size' in d && (d.size = { expr, value })))}
            />
            {draft.type === 'fillet' && (
              <>
                <Checkbox
                  label="Different radius at the other end"
                  checked={!!draft.size2}
                  onChange={(v) => s.updateDraft((d) => void (d.type === 'fillet' && (d.size2 = v ? { ...d.size } : undefined)))}
                />
                {draft.size2 && (
                  <NumberField
                    label="End radius"
                    lengthUnits={doc.units}
                    vars={vars}
                    min={0.001}
                    value={draft.size2.expr}
                    onCommit={(expr, value) => s.updateDraft((d) => void (d.type === 'fillet' && (d.size2 = { expr, value })))}
                  />
                )}
              </>
            )}
          </PanelSection>
        )}
      </FeaturePanel>
    </div>
  );
}

function FeatureCorner() {
  const previewError = useKernel((s) => s.previewError);
  const mode = useDoc((s) => s.mode);
  const empty = mode.kind === 'feature' && !!needsPick(mode.draft);
  const s = useDoc.getState();
  return <ConfirmCorner mode="feature" canConfirm={!previewError && !empty} onConfirm={s.confirmFeature} onCancel={s.cancelFeature} />;
}

/* ---------- view toolbar ---------- */

function ViewToolbar() {
  const showPlanes = useDoc((s) => s.showPlanes);
  const style = useView((s) => s.displayStyle);
  const section = useView((s) => s.section.on);
  const go = useView((s) => s.go);
  return (
    <div role="toolbar" aria-label="View" className="absolute top-4 left-1/2 -translate-x-1/2 flex gap-1 p-1 rounded-lg bg-surface-raised/90 shadow-card">
      <IconButton size="sm" label="Zoom to fit (F)" onClick={() => go('fit')}><Maximize size={14} /></IconButton>
      <Menu.Root>
        <Menu.Trigger aria-label="Standard views" className="size-12 inline-flex items-center justify-center rounded-md text-text-muted hover:bg-surface-sunken">
          <Box size={14} />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content sideOffset={4} className="rounded-md bg-surface-raised border border-border shadow-pop p-2 text-sm z-50">
            {(['front', 'top', 'right', 'iso'] as const).map((v) => (
              <Item key={v} onSelect={() => go(v)}>{v === 'iso' ? 'Isometric' : v[0].toUpperCase() + v.slice(1)}</Item>
            ))}
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
      <IconButton size="sm" label={showPlanes ? 'Hide planes' : 'Show planes'} pressed={showPlanes} onClick={() => useDoc.getState().togglePlanes()}>
        <Layers size={14} />
      </IconButton>
      <Menu.Root>
        <Menu.Trigger aria-label="Display style" className="size-12 inline-flex items-center justify-center rounded-md text-text-muted hover:bg-surface-sunken">
          <Eye size={14} />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content sideOffset={4} className="rounded-md bg-surface-raised border border-border shadow-pop p-2 text-sm z-50">
            <Menu.RadioGroup value={style} onValueChange={(v) => useView.getState().setDisplayStyle(v as DisplayStyle)}>
              {([['shadedEdges', 'Shaded with edges'], ['shaded', 'Shaded'], ['wireframe', 'Wireframe']] as const).map(([v, label]) => (
                <Menu.RadioItem key={v} value={v} className="flex items-center gap-4 h-14 px-4 rounded-sm outline-none cursor-default data-[highlighted]:bg-accent-soft">
                  <span className="w-6">{style === v ? '✓' : ''}</span>
                  {label}
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
      <IconButton size="sm" label="Section view" pressed={section} onClick={() => useView.getState().setSection({ on: !section })}>
        <SquareSplitHorizontal size={14} />
      </IconButton>
      <IconButton size="sm" label="Undo (Ctrl+Z)" onClick={() => useDoc.getState().undo()}><Undo2 size={14} /></IconButton>
      <IconButton size="sm" label="Redo (Ctrl+Y)" onClick={() => useDoc.getState().redo()}><Redo2 size={14} /></IconButton>
    </div>
  );
}

/* ---------- status bar ---------- */

function Status() {
  const mode = useDoc((s) => s.mode);
  const solve = useDoc((s) => s.solve);
  const doc = useDoc((s) => s.doc);
  const busy = useKernel((s) => s.busy);
  const ms = useKernel((s) => s.ms);
  const statuses = useKernel((s) => s.statuses);
  const errors = Object.values(statuses).filter((x) => x.status === 'error').length;
  const hints: Record<string, string> = {
    select: 'Click a line, arc or circle to select it. Delete removes it; G toggles construction.',
    line: 'Click to place points. Click an existing point to close the outline. Esc stops the chain.',
    centerline: 'Click two points. Centerlines are axes for revolves and are not part of the outline.',
    circle: 'Click the centre, then a point on the circle.',
    arc: 'Click the start, the end, then a point the arc passes through.',
    polygon: 'Click the centre, then a corner. Set the number of sides on the left.',
    slot: 'Click the two end centres, then a point on one side to set the width.',
    spline: 'Click points the curve passes through. Press Enter, or click the last point again, to finish.',
    trim: 'Click the piece of a line to remove, between the lines or circles that cross it.',
    extend: 'Click near the end of a line to stretch it to the next line or circle.',
    rect: 'Click two opposite corners.',
    dimension: 'Click a line, arc or circle to dimension it, then type the value.',
  };
  const hint =
    mode.kind === 'sketch'
      ? hints[mode.tool]
      : mode.kind === 'feature'
        ? 'Set the options, then confirm (Enter) or cancel (Esc).'
        : 'Click a flat face or plane, then Sketch. Left-drag rotates, right-drag pans, wheel zooms.';
  const state = solve ? (solve.state === 'conflict' ? 'over' : solve.state) : undefined;
  return (
    <div className={cn('shrink-0')}>
      <StatusBar
        hint={hint}
        sketchState={mode.kind === 'sketch' ? state : undefined}
        dof={solve?.dof}
        units={doc.units === 'mm' ? 'Millimetres' : 'Inches'}
        rebuild={busy ? { state: 'busy' } : errors ? { state: 'errors', errors } : { state: 'idle', ms }}
        onErrorsClick={() => useDialogs.getState().open('errors')}
      />
    </div>
  );
}

/* ---------- shortcuts + toasts ---------- */

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return;
      const s = useDoc.getState();
      const k = e.key.toLowerCase();
      if (e.ctrlKey || e.metaKey) {
        if (k === 'z' && !e.shiftKey) (e.preventDefault(), s.undo());
        else if (k === 'y' || (k === 'z' && e.shiftKey)) (e.preventDefault(), s.redo());
        else if (k === 's') (e.preventDefault(), saveDoc(e.shiftKey));
        else if (k === 'o') (e.preventDefault(), document.getElementById('open-file-input')?.click());
        else if (k === 'n') (e.preventDefault(), useDialogs.getState().open('start'));
        else if (k === 'k') (e.preventDefault(), usePalette.getState().set(true));
        return;
      }
      if (s.mode.kind === 'sketch') {
        if (k === 'l') s.setTool('line');
        if (k === 'k') s.setTool('centerline');
        if (k === 'r') s.setTool('rect');
        if (k === 'c') s.setTool('circle');
        if (k === 'a') s.setTool('arc');
        if (k === 'p') s.setTool('polygon');
        if (k === 't') s.setTool('slot');
        if (k === 'n') s.setTool('spline');
        if (k === 'y') s.setTool('trim');
        if (k === 'w') s.setTool('extend');
        if (k === 'o') s.setTool('point');
        if (k === 'd') s.setTool('dimension');
        if (k === 'g') useView.getState().sketchSel.forEach((id) => s.toggleConstruction(id));
        if (k === 'escape' && !s.editingDimId) s.setTool('select');
      } else if (s.mode.kind === 'model') {
        const sel = s.doc.features.find((f) => f.id === s.selection);
        const face = useView.getState().pickedFace;
        if (k === 's' && face) s.beginSketch({ kind: 'face', face });
        else if (k === 's' && sel?.type === 'plane') s.beginSketch(sel.id);
        if (k === 'e') s.beginFeature('extrude');
        if (k === 'x') s.beginFeature('cutExtrude');
        if (k === 'h') s.beginFeature('hole');
        if (k === 'escape') useView.getState().setMeasuring(false);
        if (k === 'delete' && sel && sel.type !== 'plane') s.deleteFeature(sel.id);
      } else if (s.mode.kind === 'feature' && k === 'escape') s.cancelFeature();
      if (k === 'f') useView.getState().go('fit');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** Ask before closing or reloading while there are unsaved changes (no autosave yet). */
function useLeaveWarning() {
  useEffect(() => {
    // Work is autosaved to this browser; only ask while the last second of edits is not stored yet.
    const onLeave = (e: BeforeUnloadEvent) => {
      if (!unsavedLocally()) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, []);
}

function useToastBridge() {
  const toast = useToast();
  const message = useDoc((s) => s.message);
  useEffect(() => {
    if (message) toast(message.tone, message.text);
  }, [message, toast]);
}

/** Save to a file: in place where the browser allows it, else a download. */
async function saveDoc(saveAs = false) {
  const { doc, notify } = useDoc.getState();
  try {
    const name = await saveFile(doc, { saveAs });
    if (!name) return;
    saveVersion(doc, 'saved').catch(() => {});
    useDoc.setState({ dirty: false });
    notify('success', `Saved ${name}`);
  } catch (e) {
    notify('error', `Could not save: ${e instanceof Error ? e.message : e}`);
  }
}
