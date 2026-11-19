// S07: relations and dimensions for the entities selected in the active sketch.
import { useState } from 'react';
import { X } from 'lucide-react';
import { NumberField } from '../ui/Fields';
import { useView as useViewStore } from '../viewport/viewStore';
import { Button, IconButton } from '../ui/Button';
import { PanelSection } from '../ui/Panel';
import { useDoc, getSketch } from '../store/docStore';
import { useView } from '../viewport/viewStore';
import type { ConstraintKind, Id, Sketch } from '../model/types';

const NAMES: Record<ConstraintKind, string> = {
  horizontal: 'Horizontal', vertical: 'Vertical', coincident: 'Coincident', fix: 'Fixed', parallel: 'Parallel',
  perpendicular: 'Perpendicular', equal: 'Equal', pointOnObject: 'On', tangent: 'Tangent', concentric: 'Concentric', midpoint: 'Midpoint',
};

type Kind = 'point' | 'line' | 'round';
const kindOf = (sk: Sketch, id: Id): Kind | null => {
  const e = sk.entities.find((x) => x.id === id);
  if (!e) return null;
  return e.kind === 'point' ? 'point' : e.kind === 'line' ? 'line' : 'round';
};

/** Label for an entity, numbered by kind in creation order: "Line 3", "Point 2", "Circle 1". */
export function entityLabel(sk: Sketch, id: Id): string {
  const e = sk.entities.find((x) => x.id === id);
  if (!e) return '?';
  const same = sk.entities.filter((x) => x.kind === e.kind);
  const n = same.indexOf(e) + (e.kind === 'point' ? 0 : 1); // point 0 is the origin
  if (e.kind === 'point') return n === 0 ? 'Origin' : `Point ${n}`;
  const word = e.kind === 'line' ? (e.construction ? 'Centerline' : 'Line') : e.kind === 'circle' ? 'Circle' : 'Arc';
  return `${word} ${n}`;
}

/** Relations that make sense for this selection, in order (entity ids reordered as the solver expects). */
export function applicable(sk: Sketch, ids: Id[]): { kind: ConstraintKind; ids: Id[] }[] {
  const ks = ids.map((id) => kindOf(sk, id));
  const out: { kind: ConstraintKind; ids: Id[] }[] = [];
  const by = (k: Kind) => ids.filter((_, i) => ks[i] === k);
  const [P, L, R] = [by('point'), by('line'), by('round')];
  const n = ids.length;
  if (n === 1 && L.length === 1) out.push({ kind: 'horizontal', ids: L }, { kind: 'vertical', ids: L });
  if (n === 1 && P.length === 1) out.push({ kind: 'fix', ids: P });
  if (n === 2 && L.length === 2)
    out.push({ kind: 'parallel', ids: L }, { kind: 'perpendicular', ids: L }, { kind: 'equal', ids: L });
  if (n === 2 && P.length === 2) out.push({ kind: 'coincident', ids: P });
  if (n === 2 && P.length === 1 && L.length === 1) out.push({ kind: 'pointOnObject', ids: [P[0], L[0]] }, { kind: 'midpoint', ids: [P[0], L[0]] });
  if (n === 2 && P.length === 1 && R.length === 1) out.push({ kind: 'pointOnObject', ids: [P[0], R[0]] });
  if (n === 2 && L.length === 1 && R.length === 1) out.push({ kind: 'tangent', ids: [L[0], R[0]] });
  if (n === 2 && R.length === 2) out.push({ kind: 'tangent', ids: R }, { kind: 'concentric', ids: R }, { kind: 'equal', ids: R });
  return out;
}

export function RelationsPanel() {
  const mode = useDoc((s) => s.mode);
  const doc = useDoc((s) => s.doc);
  const sel = useView((v) => v.sketchSel);
  if (mode.kind !== 'sketch' || sel.length === 0) return null;
  const sk = getSketch(doc, mode.sketchId)?.sketch;
  if (!sk) return null;
  const s = useDoc.getState();
  const ids = sel.filter((id) => sk.entities.some((e) => e.id === id));
  const options = applicable(sk, ids);
  const kinds = ids.map((id) => kindOf(sk, id));
  const originFix = (c: Sketch['constraints'][number]) => c.kind === 'fix' && sk.entities.find((e) => e.id === c.entityIds[0])?.construction;
  const existing = sk.constraints.filter((c) => !originFix(c) && c.entityIds.some((id) => ids.includes(id)));
  const canDistance = ids.length === 2 && ((kinds[0] === 'point' && kinds[1] === 'point') || kinds.includes('point') && kinds.includes('line'));
  const canAngle = ids.length === 2 && kinds[0] === 'line' && kinds[1] === 'line';

  return (
    <section aria-label="Relations" className="border-b border-border bg-surface-raised">
      <PanelSection title={`Selected (${ids.length})`}>
        <ul className="flex flex-wrap gap-2">
          {ids.map((id) => (
            <li key={id} className="inline-flex items-center gap-1 h-10 pl-3 pr-1 rounded-sm bg-surface-sunken text-xs">
              {entityLabel(sk, id)}
              <button
                aria-label={`Deselect ${entityLabel(sk, id)}`}
                onClick={() => useView.getState().toggleSketchSel(id)}
                className="size-8 inline-flex items-center justify-center rounded-sm text-text-muted hover:text-text"
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
        <p className="text-2xs text-text-muted">Shift-click to select more.</p>
      </PanelSection>

      <PanelSection title="Add relation">
        {options.length === 0 ? (
          <p className="text-xs text-text-muted">No relation fits this selection. Try two lines, a point and a line, or two circles.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {options.map((o) => (
              <Button key={o.kind + o.ids.join()} size="sm" onClick={() => s.addRelation(o.kind, o.ids)}>
                {NAMES[o.kind]}
              </Button>
            ))}
          </div>
        )}
        {(canDistance || canAngle) && (
          <div className="flex gap-2">
            {canDistance && <Button size="sm" variant="ghost" onClick={() => s.addDimensionBetween(ids[0], ids[1])}>Distance</Button>}
            {canAngle && <Button size="sm" variant="ghost" onClick={() => s.addDimensionBetween(ids[0], ids[1])}>Angle</Button>}
          </div>
        )}
      </PanelSection>

      <ModifySection ids={ids} sk={sk} />

      <PanelSection title="Existing relations">
        {existing.length === 0 ? (
          <p className="text-xs text-text-muted">None yet.</p>
        ) : (
          <ul className="flex flex-col">
            {existing.map((c) => (
              <li key={c.id} className="flex items-center gap-2 h-12 text-xs">
                <span className="flex-1 truncate">
                  {NAMES[c.kind]} <span className="text-text-muted">· {c.entityIds.map((id) => entityLabel(sk, id)).join(', ')}</span>
                </span>
                <IconButton size="sm" label={`Remove ${NAMES[c.kind]} relation`} tone="danger" onClick={() => s.removeConstraint(c.id)}>
                  <X size={12} />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
      </PanelSection>
    </section>
  );
}

/** Mirror, fillet and offset for the current selection. */
function ModifySection({ ids, sk }: { ids: Id[]; sk: Sketch }) {
  const units = useDoc((s) => s.doc.units);
  const k = units === 'in' ? 25.4 : 1;
  const [radius, setRadius] = useState(units === 'in' ? 0.1 * 25.4 : 2);
  const [dist, setDist] = useState(units === 'in' ? 0.1 * 25.4 : 2);
  const [inward, setInward] = useState(false);
  const s = useDoc.getState();
  const kinds = ids.map((id) => sk.entities.find((e) => e.id === id));
  const hasAxis = kinds.some((e) => e?.kind === 'line' && e.construction);
  const canMirror = hasAxis && kinds.some((e) => e && e.kind !== 'point' && !(e.kind === 'line' && e.construction));
  const canFillet = (kinds.length === 1 && kinds[0]?.kind === 'point') || (kinds.length === 2 && kinds.every((e) => e?.kind === 'line'));
  const canOffset = kinds.length > 0 && (kinds.every((e) => e?.kind === 'circle') || (kinds.length >= 3 && kinds.every((e) => e?.kind === 'line' && !e.construction)));
  if (!canMirror && !canFillet && !canOffset) return null;
  const done = () => useViewStore.getState().setSketchSel([]);
  return (
    <PanelSection title="Modify">
      {canMirror && (
        <Button size="sm" onClick={() => s.mirrorSelection(ids) && done()}>
          Mirror across the centerline
        </Button>
      )}
      {canFillet && (
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <NumberField key={`r${units}`} label="Fillet radius" lengthUnits={units} min={0.001} value={String(+(radius / k).toFixed(4))} onCommit={(_, v) => setRadius(v)} />
          </div>
          <Button size="sm" onClick={() => s.filletSelection(ids, radius) && done()}>
            Fillet corner
          </Button>
        </div>
      )}
      {canOffset && (
        <>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <NumberField key={`d${units}`} label="Offset distance" lengthUnits={units} min={0.001} value={String(+(dist / k).toFixed(4))} onCommit={(_, v) => setDist(v)} />
            </div>
            <Button size="sm" onClick={() => s.offsetSelection(ids, inward ? -dist : dist) && done()}>
              Offset
            </Button>
          </div>
          <label className="flex items-center gap-3 text-xs">
            <input type="checkbox" checked={inward} onChange={(e) => setInward(e.target.checked)} className="accent-accent" /> Inward
          </label>
        </>
      )}
    </PanelSection>
  );
}
