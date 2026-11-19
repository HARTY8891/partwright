// Options for hole, shell, patterns, mirror and reference planes, plus the
// Equations (S16), Mass properties (S17) and Measure panels.
import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { create } from 'zustand';
import { Button, IconButton } from '../ui/Button';
import { Checkbox, NumberField, Select, SelectionBox } from '../ui/Fields';
import { MessageBanner, PanelSection } from '../ui/Panel';
import { Modal } from '../ui/Overlay';
import { useDoc } from '../store/docStore';
import { useKernel } from '../store/rebuild';
import { kernel } from '../kernel/client';
import { useView } from '../viewport/viewStore';
import { faceLabel } from '../model/refs';
import { docVars, evalVariables, NAME_RE } from '../model/equations';
import { isSeedType, type FeatureDraft, type Variable } from '../model/types';
import { unitLabel } from '../model/units';
import { PART_COLORS, useSettings } from '../store/settings';
import tokens from '../../../replica/design/tokens.json';

type D = FeatureDraft;

/** Option sections for the new feature types. Returns null for other types. */
export function MoreFeatureOptions({ draft }: { draft: D }) {
  const doc = useDoc((s) => s.doc);
  const s = useDoc.getState();
  const vars = docVars(doc);
  const len = { lengthUnits: doc.units, vars, min: 0.001 } as const;

  if (draft.type === 'hole')
    return (
      <PanelSection title="Hole">
        <SelectionBox
          label="Position"
          prompt="Click a flat face where the hole starts"
          focused
          items={draft.at ? [faceLabel(doc, draft.at.face)] : []}
          onRemove={() => s.updateDraft((d) => void (d.type === 'hole' && (d.at = null)))}
        />
        <NumberField label="Diameter" value={draft.diameter.expr} {...len} onCommit={(expr, value) => s.updateDraft((d) => void (d.type === 'hole' && (d.diameter = { expr, value })))} />
        <Select
          label="End condition"
          value={draft.end.type}
          onChange={(v) => s.updateDraft((d) => void (d.type === 'hole' && (d.end = v === 'throughAll' ? { type: 'throughAll' } : { type: 'blind', depth: d.end.type === 'blind' ? d.end.depth : { expr: '10', value: 10 } })))}
          options={[
            { value: 'throughAll', label: 'Through everything' },
            { value: 'blind', label: 'Fixed depth' },
          ]}
        />
        {draft.end.type === 'blind' && (
          <NumberField label="Depth" value={draft.end.depth.expr} {...len} onCommit={(expr, value) => s.updateDraft((d) => void (d.type === 'hole' && d.end.type === 'blind' && (d.end.depth = { expr, value })))} />
        )}
      </PanelSection>
    );

  if (draft.type === 'shell')
    return (
      <PanelSection title="Shell">
        <SelectionBox
          label="Faces to remove"
          prompt="Click the faces to open"
          focused
          items={draft.faces.map((fp) => faceLabel(doc, fp.face))}
          onRemove={(i) => s.updateDraft((d) => void (d.type === 'shell' && d.faces.splice(i, 1)))}
        />
        <NumberField label="Wall thickness" value={draft.thickness.expr} {...len} onCommit={(expr, value) => s.updateDraft((d) => void (d.type === 'shell' && (d.thickness = { expr, value })))} />
      </PanelSection>
    );

  if (draft.type === 'linearPattern' || draft.type === 'circularPattern' || draft.type === 'mirror') {
    const candidates = doc.features.slice(0, doc.rollbackIndex).filter((f) => isSeedType(f.type));
    return (
      <>
        <PanelSection title="Features to repeat">
          {candidates.length === 0 && <p className="text-xs text-text-muted">There are no extrudes, cuts, revolves or holes to repeat yet.</p>}
          {candidates.map((f) => (
            <Checkbox key={f.id} label={f.name} checked={draft.seeds.includes(f.id)} onChange={() => s.toggleSeed(f.id)} />
          ))}
        </PanelSection>
        {draft.type === 'mirror' ? (
          <PanelSection title="Mirror plane">
            <Select
              label="Plane"
              value={draft.planeId}
              onChange={(v) => s.updateDraft((d) => void (d.type === 'mirror' && (d.planeId = v)))}
              options={doc.features.slice(0, doc.rollbackIndex).filter((f) => f.type === 'plane').map((f) => ({ value: f.id, label: f.name }))}
            />
          </PanelSection>
        ) : (
          <PanelSection title={draft.type === 'linearPattern' ? 'Direction and spacing' : 'Axis and angle'}>
            <Select
              label={draft.type === 'linearPattern' ? 'Direction' : 'Axis (through the origin)'}
              value={draft.axis}
              onChange={(v) => s.updateDraft((d) => void ('axis' in d && (d.axis = v)))}
              options={[
                { value: 'x', label: 'X axis' },
                { value: 'y', label: 'Y axis' },
                { value: 'z', label: 'Z axis' },
              ]}
            />
            <NumberField
              label="Number of copies (including the original)"
              unit=""
              value={String(draft.count)}
              min={2}
              onCommit={(_, value) => s.updateDraft((d) => void ('count' in d && (d.count = Math.round(value))))}
            />
            {draft.type === 'linearPattern' ? (
              <NumberField label="Spacing" value={draft.spacing.expr} {...len} onCommit={(expr, value) => s.updateDraft((d) => void ('spacing' in d && (d.spacing = { expr, value })))} />
            ) : (
              <NumberField label="Total angle" unit="°" vars={vars} value={draft.spacing.expr} min={0.001} onCommit={(expr, value) => s.updateDraft((d) => void ('spacing' in d && (d.spacing = { expr, value })))} />
            )}
            <Checkbox label="Reverse direction" checked={draft.reverse} onChange={(v) => s.updateDraft((d) => void ('reverse' in d && (d.reverse = v)))} />
          </PanelSection>
        )}
      </>
    );
  }

  if (draft.type === 'plane') {
    const def = draft.def;
    const baseName = def.base.kind === 'face' ? faceLabel(doc, def.base.face) : doc.features.find((f) => f.id === (def.base as { featureId: string }).featureId)?.name;
    return (
      <PanelSection title="Plane">
        <p className="text-xs">From <strong>{baseName}</strong>.</p>
        <Select
          label="Kind"
          value={def.type}
          onChange={(v) =>
            s.updateDraft((d) => {
              if (d.type !== 'plane') return;
              const base = d.def.base;
              d.def = v === 'offset' ? { type: 'offset', base, distance: { expr: '20', value: 20 } } : { type: 'angle', base, axis: 'x', angle: { expr: '45', value: 45 } };
            })
          }
          options={[
            { value: 'offset', label: 'Parallel, at a distance' },
            { value: 'angle', label: 'At an angle' },
          ]}
        />
        {def.type === 'offset' ? (
          <NumberField
            key="dist"
            label="Distance (negative for the other side)"
            value={def.distance.expr}
            lengthUnits={doc.units}
            vars={vars}
            onCommit={(expr, value) => s.updateDraft((d) => void (d.type === 'plane' && d.def.type === 'offset' && (d.def.distance = { expr, value })))}
          />
        ) : (
          <>
            <Select
              label="Turn about"
              value={def.axis}
              onChange={(v) => s.updateDraft((d) => void (d.type === 'plane' && d.def.type === 'angle' && (d.def.axis = v)))}
              options={[
                { value: 'x', label: "The base plane's horizontal axis" },
                { value: 'y', label: "The base plane's vertical axis" },
              ]}
            />
            <NumberField
              key="angle"
              label="Angle"
              unit="°"
              vars={vars}
              value={def.angle.expr}
              onCommit={(expr, value) => s.updateDraft((d) => void (d.type === 'plane' && d.def.type === 'angle' && (d.def.angle = { expr, value })))}
            />
          </>
        )}
      </PanelSection>
    );
  }
  return null;
}

/** True while a feature still needs the user to pick something (confirm disabled, hint shown). */
export function needsPick(d: D): string | null {
  if (d.type === 'fillet' || d.type === 'chamfer') return d.edges.length ? null : 'Click edges on the model to add or remove them.';
  if (d.type === 'hole') return d.at ? null : 'Click a flat face where the hole should start.';
  if (d.type === 'shell') return d.faces.length ? null : 'Click the faces to open. The rest becomes a wall.';
  if (d.type === 'linearPattern' || d.type === 'circularPattern' || d.type === 'mirror') return d.seeds.length ? null : 'Tick the features to repeat.';
  return null;
}

/* ---------- second direction (extrude) ---------- */

export function SecondDirection({ draft }: { draft: D }) {
  const doc = useDoc((s) => s.doc);
  const s = useDoc.getState();
  if ((draft.type !== 'extrude' && draft.type !== 'cutExtrude') || draft.direction1.type !== 'blind') return null;
  const on = !!draft.direction2;
  return (
    <PanelSection
      title="Direction 2"
      toggle={{
        checked: on,
        onChange: (v) => s.updateDraft((d) => void ('direction1' in d && (d.direction2 = v ? { depth: { ...d.direction1.depth } } : undefined))),
      }}
    >
      {on && (
        <NumberField
          label="Depth (other side)"
          lengthUnits={doc.units}
          vars={docVars(doc)}
          min={0.001}
          value={draft.direction2!.depth.expr}
          onCommit={(expr, value) => s.updateDraft((d) => void ('direction2' in d && d.direction2 && (d.direction2.depth = { expr, value })))}
        />
      )}
    </PanelSection>
  );
}

/* ---------- dialogs: equations, mass ---------- */

export const useToolDialogs = create<{ equations: boolean; mass: boolean; options: boolean; set(p: Partial<{ equations: boolean; mass: boolean; options: boolean }>): void }>((set) => ({
  equations: false,
  mass: false,
  options: false,
  set: (p) => set(p),
}));

export function EquationsDialog() {
  const open = useToolDialogs((d) => d.equations);
  const doc = useDoc((s) => s.doc);
  const [rows, setRows] = useState<Variable[]>([]);
  useEffect(() => {
    if (open) setRows(doc.variables?.map((v) => ({ ...v })) ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const { values, errors } = evalVariables(rows);
  const close = () => useToolDialogs.getState().set({ equations: false });
  const apply = () => {
    useDoc.getState().setVariables(rows.map(({ value: _v, ...r }) => r));
    close();
  };
  const update = (i: number, patch: Partial<Variable>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <Modal
      open={open}
      onOpenChange={(v) => !v && close()}
      title="Equations"
      size="lg"
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" onClick={apply} disabled={Object.keys(errors).length > 0}>
            Apply
          </Button>
        </>
      }
    >
      <p className="text-xs text-text-muted mb-6">
        Name values once and use them anywhere: type <code className="font-mono">=width/2</code> in a dimension or a feature field. Values are in {unitLabel(doc.units)}.
      </p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-2xs uppercase tracking-wide text-text-muted">
            <th className="pb-2 font-semibold">Name</th>
            <th className="pb-2 font-semibold">Value or formula</th>
            <th className="pb-2 font-semibold">Result</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={4} className="py-6 text-text-muted text-xs">No variables yet.</td>
            </tr>
          )}
          {rows.map((r, i) => (
            <tr key={r.id} className="align-top">
              <td className="pr-4 py-1">
                <input
                  aria-label={`Name of variable ${i + 1}`}
                  value={r.name}
                  onChange={(e) => update(i, { name: e.target.value.trim() })}
                  className={`w-full h-14 px-3 rounded-md border bg-bg font-mono ${NAME_RE.test(r.name) ? 'border-border-input' : 'border-danger'}`}
                />
              </td>
              <td className="pr-4 py-1">
                <input
                  aria-label={`Formula of ${r.name || `variable ${i + 1}`}`}
                  value={r.expression}
                  onChange={(e) => update(i, { expression: e.target.value })}
                  className={`w-full h-14 px-3 rounded-md border bg-bg font-mono ${errors[r.id] ? 'border-danger' : 'border-border-input'}`}
                />
                {errors[r.id] && <div className="text-xs text-danger mt-1">{errors[r.id]}</div>}
              </td>
              <td className="pr-4 py-1 font-mono leading-[28px]">{values[r.name] !== undefined && !errors[r.id] ? +values[r.name].toFixed(4) : '—'}</td>
              <td className="py-1">
                <IconButton label={`Delete ${r.name || 'variable'}`} tone="danger" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                  <Trash2 size={14} />
                </IconButton>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Button
        className="mt-6"
        size="sm"
        icon={<Plus size={14} />}
        onClick={() => setRows([...rows, { id: crypto.randomUUID(), name: `v${rows.length + 1}`, expression: '10' }])}
      >
        Add variable
      </Button>
    </Modal>
  );
}

const MATERIALS = [
  { id: 'steel', name: 'Steel', density: 7850 },
  { id: 'stainless', name: 'Stainless steel', density: 8000 },
  { id: 'aluminium', name: 'Aluminium', density: 2700 },
  { id: 'brass', name: 'Brass', density: 8500 },
  { id: 'pla', name: 'PLA plastic', density: 1240 },
  { id: 'abs', name: 'ABS plastic', density: 1050 },
  { id: 'wood', name: 'Wood (oak)', density: 750 },
];

export function MassDialog() {
  const open = useToolDialogs((d) => d.mass);
  const doc = useDoc((s) => s.doc);
  const ms = useKernel((s) => s.ms);
  const [props, setProps] = useState<{ volume: number; area: number; centre: [number, number, number] } | null | 'loading'>('loading');
  useEffect(() => {
    if (!open) return;
    setProps('loading');
    kernel.massProps().then(setProps).catch(() => setProps(null));
  }, [open, ms]);
  const mat = MATERIALS.find((m) => m.id === (doc.material ?? 'steel'))!;
  const k = doc.units === 'in' ? 25.4 : 1;
  const u = unitLabel(doc.units);
  const close = () => useToolDialogs.getState().set({ mass: false });
  return (
    <Modal open={open} onOpenChange={(v) => !v && close()} title="Mass properties" footer={<Button variant="primary" onClick={close}>Close</Button>}>
      <div className="flex flex-col gap-8">
        <Select
          label="Material"
          value={mat.id}
          onChange={(v) => useDoc.setState({ doc: { ...doc, material: v }, dirty: true })}
          options={MATERIALS.map((m) => ({ value: m.id, label: `${m.name} (${m.density} kg/m³)` }))}
        />
        {props === 'loading' && <p className="text-text-muted">Measuring…</p>}
        {props === null && <MessageBanner tone="info">There is no solid to measure yet.</MessageBanner>}
        {props && props !== 'loading' && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-8 gap-y-3 font-mono text-sm">
            <dt className="font-sans text-text-muted">Mass</dt>
            <dd>{fmtMass((props.volume * 1e-9) * mat.density)}</dd>
            <dt className="font-sans text-text-muted">Volume</dt>
            <dd>{+(props.volume / k ** 3).toFixed(3)} {u}³</dd>
            <dt className="font-sans text-text-muted">Surface area</dt>
            <dd>{+(props.area / k ** 2).toFixed(3)} {u}²</dd>
            <dt className="font-sans text-text-muted">Centre of mass</dt>
            <dd>{props.centre.map((c) => +(c / k).toFixed(3)).join(', ')} {u}</dd>
          </dl>
        )}
      </div>
    </Modal>
  );
}

const fmtMass = (kg: number) => (kg >= 1 ? `${kg.toFixed(3)} kg` : `${(kg * 1000).toFixed(2)} g`);

/* ---------- measure ---------- */

export function MeasurePanel() {
  const on = useView((s) => s.measuring);
  const pts = useView((s) => s.measurePoints);
  const units = useDoc((s) => s.doc.units);
  if (!on) return null;
  const k = units === 'in' ? 25.4 : 1;
  const f = (n: number) => (n / k).toFixed(units === 'in' ? 4 : 3);
  const d = pts.length === 2 ? [pts[1][0] - pts[0][0], pts[1][1] - pts[0][1], pts[1][2] - pts[0][2]] : null;
  return (
    <section aria-label="Measure" className="border-b border-border bg-surface-raised">
      <PanelSection title="Measure">
        <p className="text-xs text-text-muted">Click two points on the model. Corners snap.</p>
        {d ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 font-mono text-xs" aria-live="polite">
            <dt className="font-sans text-text-muted">Distance</dt>
            <dd>{f(Math.hypot(d[0], d[1], d[2]))} {units}</dd>
            <dt className="font-sans text-text-muted">ΔX ΔY ΔZ</dt>
            <dd>{d.map(f).join(', ')}</dd>
          </dl>
        ) : (
          <p className="text-xs">{pts.length === 1 ? 'Now click the second point.' : 'Click the first point.'}</p>
        )}
        <Button size="sm" onClick={() => useView.getState().setMeasuring(false)}>
          Stop measuring
        </Button>
      </PanelSection>
    </section>
  );
}

/* ---------- polygon tool option ---------- */

export function PolygonOptions() {
  const mode = useDoc((s) => s.mode);
  const sides = useView((s) => s.polygonSides);
  if (mode.kind !== 'sketch' || mode.tool !== 'polygon') return null;
  return (
    <section aria-label="Polygon" className="border-b border-border bg-surface-raised">
      <PanelSection title="Polygon">
        <NumberField key={sides} label="Sides" unit="" value={String(sides)} min={3} onCommit={(_, v) => useView.getState().setPolygonSides(Math.max(3, Math.min(64, Math.round(v))))} />
        <p className="text-xs text-text-muted">Click the centre, then a corner.</p>
      </PanelSection>
    </section>
  );
}

/* ---------- section view ---------- */

export function SectionPanel() {
  const sec = useView((s) => s.section);
  const units = useDoc((s) => s.doc.units);
  if (!sec.on) return null;
  const set = useView.getState().setSection;
  const k = units === 'in' ? 25.4 : 1;
  return (
    <section aria-label="Section view" className="border-b border-border bg-surface-raised">
      <PanelSection title="Section view">
        <Select
          label="Cut along"
          value={sec.plane}
          onChange={(v) => set({ plane: v })}
          options={[
            { value: 'front', label: 'Front plane' },
            { value: 'top', label: 'Top plane' },
            { value: 'right', label: 'Right plane' },
          ]}
        />
        <label className="flex flex-col gap-1 text-xs text-text-muted">
          Offset ({unitLabel(units)})
          <input
            type="range"
            min={-200 / k}
            max={200 / k}
            step={units === 'in' ? 0.05 : 1}
            value={sec.offset / k}
            onChange={(e) => set({ offset: Number(e.target.value) * k })}
            aria-valuetext={`${+(sec.offset / k).toFixed(3)} ${units}`}
            className="accent-accent"
          />
        </label>
        <NumberField key={sec.offset} label="Offset" lengthUnits={units} value={String(+(sec.offset / k).toFixed(4))} onCommit={(_, v) => set({ offset: v })} />
        <Checkbox label="Flip the side shown" checked={sec.flip} onChange={(v) => set({ flip: v })} />
        <p className="text-2xs text-text-muted">The section only changes the view. The part is not cut.</p>
        <Button size="sm" onClick={() => set({ on: false })}>Close section view</Button>
      </PanelSection>
    </section>
  );
}

/* ---------- thin wall (extrude) ---------- */

export function ThinWall({ draft }: { draft: D }) {
  const doc = useDoc((s) => s.doc);
  const s = useDoc.getState();
  if (draft.type !== 'extrude' && draft.type !== 'cutExtrude') return null;
  const on = !!draft.thin;
  return (
    <PanelSection
      title="Thin wall"
      toggle={{
        checked: on,
        onChange: (v) => s.updateDraft((d) => void ('direction1' in d && (d.thin = v ? { thickness: { expr: doc.units === 'in' ? '0.08' : '2', value: 2 }, side: 'inside' } : undefined))),
      }}
    >
      {on && (
        <>
          <NumberField
            label="Wall thickness"
            lengthUnits={doc.units}
            vars={docVars(doc)}
            min={0.001}
            value={draft.thin!.thickness.expr}
            onCommit={(expr, value) => s.updateDraft((d) => void ('thin' in d && d.thin && (d.thin.thickness = { expr, value })))}
          />
          <Select
            label="Wall side"
            value={draft.thin!.side}
            onChange={(v) => s.updateDraft((d) => void ('thin' in d && d.thin && (d.thin.side = v)))}
            options={[
              { value: 'inside', label: 'Inside the outline' },
              { value: 'outside', label: 'Outside the outline' },
              { value: 'both', label: 'Centred on the outline' },
            ]}
          />
        </>
      )}
    </PanelSection>
  );
}

/* ---------- options (S20) ---------- */

export function OptionsDialog() {
  const open = useToolDialogs((d) => d.options);
  const settings = useSettings();
  const doc = useDoc((s) => s.doc);
  const close = () => useToolDialogs.getState().set({ options: false });
  const swatch = (id: string) => (tokens.color as Record<string, string>)[id];
  return (
    <Modal open={open} onOpenChange={(v) => !v && close()} title="Options" footer={<Button variant="primary" onClick={close}>Done</Button>}>
      <div className="flex flex-col gap-10">
        <section className="flex flex-col gap-6" aria-labelledby="opt-part">
          <h3 id="opt-part" className="text-sm font-semibold">This part</h3>
          <fieldset>
            <legend className="text-xs text-text-muted mb-2">Colour</legend>
            <div className="flex gap-4">
              {PART_COLORS.map((c) => (
                <label key={c.id} className="flex flex-col items-center gap-1 text-2xs cursor-default">
                  <input
                    type="radio"
                    name="part-colour"
                    className="sr-only peer"
                    checked={(doc.color ?? 'part-steel') === c.id}
                    onChange={() => useDoc.setState({ doc: { ...doc, color: c.id, updatedAt: new Date().toISOString() }, dirty: true })}
                  />
                  <span className="size-16 rounded-md border-2 border-border peer-checked:border-accent peer-focus-visible:ring-2 peer-focus-visible:ring-focus" style={{ background: swatch(c.id) }} />
                  {c.label}
                </label>
              ))}
            </div>
          </fieldset>
        </section>
        <section className="flex flex-col gap-6" aria-labelledby="opt-app">
          <h3 id="opt-app" className="text-sm font-semibold">All parts (this browser)</h3>
          <Select
            label="Units for new parts"
            value={settings.defaultUnits}
            onChange={(v) => settings.update({ defaultUnits: v })}
            options={[
              { value: 'mm', label: 'Millimetres' },
              { value: 'in', label: 'Inches' },
            ]}
          />
          <Select
            label="Colour for new parts"
            value={settings.defaultColor}
            onChange={(v) => settings.update({ defaultColor: v })}
            options={PART_COLORS.map((c) => ({ value: c.id, label: c.label }))}
          />
          <Checkbox label="Show the reference planes in new parts" checked={settings.showPlanes} onChange={(v) => settings.update({ showPlanes: v })} />
          <Select
            label="Save to this browser after"
            value={String(settings.autosaveSeconds)}
            onChange={(v) => settings.update({ autosaveSeconds: Number(v) })}
            options={[
              { value: '1', label: '1 second' },
              { value: '5', label: '5 seconds' },
              { value: '30', label: '30 seconds' },
            ]}
          />
        </section>
      </div>
    </Modal>
  );
}
