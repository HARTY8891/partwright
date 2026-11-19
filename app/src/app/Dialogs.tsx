import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { FileBox, History, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { Button, IconButton } from '../ui/Button';
import { IssueRow, Modal } from '../ui/Overlay';
import { useDoc } from '../store/docStore';
import { useKernel } from '../store/rebuild';
import { deleteLocal, listVersions, loadLocal, recentParts, saveVersion, type PartVersion, type RecentPart } from '../store/storage';
import { dependentsOf } from '../store/docStore';
import { migrate } from '../model/migrate';
import { flushAutosave, useAutosave } from '../store/autosave';
import { useSettings } from '../store/settings';
import type { Units } from '../model/units';
import { cn } from '../ui/cn';

type DialogName = 'start' | 'errors' | 'versions';
export const useDialogs = create<{ start: boolean; errors: boolean; versions: boolean; open(d: DialogName): void; close(): void }>((set) => ({
  start: false,
  errors: false,
  versions: false,
  open: (d) => set({ start: d === 'start', errors: d === 'errors', versions: d === 'versions' }),
  close: () => set({ start: false, errors: false, versions: false }),
}));

/** Show the start dialog on launch when there are parts to come back to. */
export function useStartOnLaunch() {
  useEffect(() => {
    recentParts(1)
      .then((r) => r.length && useDialogs.getState().open('start'))
      .catch(() => {});
  }, []);
}

const ago = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
};

/** S01 + S02: new part with units, or reopen a recent part. */
export function StartDialog() {
  const open = useDialogs((d) => d.start);
  const [units, setUnits] = useState<Units>(useSettings.getState().defaultUnits);
  const [recents, setRecents] = useState<RecentPart[] | null>(null);
  const currentId = useDoc((s) => s.doc.id);

  const refresh = () => recentParts().then(setRecents).catch(() => setRecents([]));
  useEffect(() => {
    if (!open) return;
    // pick up the current "units for new parts" setting each time the dialog opens
    setUnits(useSettings.getState().defaultUnits);
    flushAutosave().then(refresh);
  }, [open]);

  const create = () => {
    useDoc.getState().newDoc(units);
    useDialogs.getState().close();
  };
  const reopen = async (id: string) => {
    const doc = await loadLocal(id);
    if (!doc) return useDoc.getState().notify('error', 'That part is no longer in this browser.');
    useDoc.getState().loadDoc(doc);
    useAutosave.setState({ savedAt: doc.updatedAt });
    useDialogs.getState().close();
    useDoc.getState().notify('success', `Opened ${doc.name}`);
  };

  return (
    <Modal open={open} onOpenChange={(v) => !v && useDialogs.getState().close()} title="Start" size="md">
      <section aria-labelledby="new-part" className="flex flex-col gap-6">
        <h3 id="new-part" className="text-sm font-semibold">New part</h3>
        <fieldset className="flex gap-4">
          <legend className="sr-only">Units</legend>
          {(['mm', 'in'] as const).map((u) => (
            <label
              key={u}
              className={cn(
                'flex-1 flex items-center gap-4 p-6 rounded-md border cursor-default',
                units === u ? 'border-accent bg-accent-soft' : 'border-border-input',
              )}
            >
              <input type="radio" name="units" value={u} checked={units === u} onChange={() => setUnits(u)} className="accent-accent" />
              <span>
                <span className="block font-medium">{u === 'mm' ? 'Millimetres' : 'Inches'}</span>
                <span className="block text-xs text-text-muted">{u === 'mm' ? 'Lengths in mm' : 'Lengths in inches'}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <div>
          <Button variant="primary" onClick={create}>
            Create part
          </Button>
        </div>
      </section>

      <section aria-labelledby="recent-parts" className="flex flex-col gap-4 mt-12">
        <h3 id="recent-parts" className="text-sm font-semibold">Recent parts</h3>
        {recents === null && <p className="text-xs text-text-muted">Loading…</p>}
        {recents?.length === 0 && <p className="text-xs text-text-muted">No recent parts yet. Parts are kept in this browser automatically as you work.</p>}
        <ul className="flex flex-col gap-2">
          {recents?.map((r) => (
            <li key={r.id} className="flex items-center gap-2">
              <button
                onClick={() => reopen(r.id)}
                className="flex-1 flex items-center gap-4 p-4 rounded-md border border-border hover:bg-surface-sunken text-left"
              >
                <FileBox size={20} className="text-text-muted shrink-0" aria-hidden />
                <span className="min-w-0">
                  <span className="block font-medium truncate">
                    {r.name}
                    {r.id === currentId && <span className="ml-3 text-xs text-text-muted font-normal">(open now)</span>}
                  </span>
                  <span className="block text-xs text-text-muted">
                    {r.features} {r.features === 1 ? 'feature' : 'features'} · {r.units} · {ago(r.updatedAt)}
                  </span>
                </span>
              </button>
              <IconButton
                label={`Remove ${r.name} from this browser`}
                tone="danger"
                disabled={r.id === currentId}
                onClick={async () => {
                  await deleteLocal(r.id);
                  refresh();
                }}
              >
                <Trash2 size={16} />
              </IconButton>
            </li>
          ))}
        </ul>
      </section>
    </Modal>
  );
}

/**
 * S15: every rebuild error and warning in one list, root causes first. A feature
 * that fails because an earlier feature failed is listed under it ("caused by"),
 * so you fix the first one and the rest often clear on their own.
 */
export function ErrorsDialog() {
  const open = useDialogs((d) => d.errors);
  const statuses = useKernel((s) => s.statuses);
  const doc = useDoc((s) => s.doc);
  const failing = doc.features.filter((f) => statuses[f.id] && statuses[f.id].status !== 'ok');
  const failingIds = new Set(failing.map((f) => f.id));
  // the earliest failing feature this one depends on, if any
  const causeOf = (id: string) => failing.find((f) => f.id !== id && failingIds.has(f.id) && dependentsOf(doc, f.id).has(id));
  const roots = failing.filter((f) => !causeOf(f.id));
  const close = () => useDialogs.getState().close();
  return (
    <Modal open={open} onOpenChange={(v) => !v && close()} title="What went wrong" footer={<Button variant="primary" onClick={close}>Close</Button>}>
      {failing.length === 0 ? (
        <p className="text-text-muted">Everything rebuilt without errors.</p>
      ) : (
        <>
          <p className="text-xs text-text-muted mb-4">
            {roots.length === 1 ? 'Start with the first problem below.' : `Start with these ${roots.length} problems.`} Problems caused by them are listed underneath and often clear once it is fixed.
          </p>
          {roots.map((f, i) => (
            <div key={f.id} className="mb-4">
              <IssueBlock id={f.id} first={i === 0} />
              {failing
                .filter((x) => causeOf(x.id)?.id === f.id)
                .map((x) => (
                  <div key={x.id} className="ml-10 border-l-2 border-border pl-4">
                    <IssueBlock id={x.id} causedBy={f.name} />
                  </div>
                ))}
            </div>
          ))}
        </>
      )}
    </Modal>
  );
}

function IssueBlock({ id, first, causedBy }: { id: string; first?: boolean; causedBy?: string }) {
  const doc = useDoc((s) => s.doc);
  const st = useKernel((s) => s.statuses[id]);
  const f = doc.features.find((x) => x.id === id)!;
  const s = useDoc.getState();
  const message = st?.message ?? '';
  // features that point at faces or edges can drop the lost ones and be re-picked
  let repick: (() => void) | null = null;
  // the kernel names lost references by position: "Edge 2 (...) no longer exists"
  const lostAt = (word: string) => [...message.matchAll(new RegExp(word + ' (\\d+) \\(', 'g'))].map((m) => Number(m[1]) - 1);
  if (f.type === 'fillet' || f.type === 'chamfer') {
    const lost = lostAt('Edge');
    if (lost.length)
      repick = () => {
        s.editFeature(id);
        s.updateDraft((d) => void ('edges' in d && (d.edges = d.edges.filter((_, i) => !lost.includes(i)))));
      };
  } else if (f.type === 'shell' && lostAt('Face').length) {
    const lost = lostAt('Face');
    repick = () => {
      s.editFeature(id);
      s.updateDraft((d) => void (d.type === 'shell' && (d.faces = d.faces.filter((_, i) => !lost.includes(i)))));
    };
  } else if (f.type === 'hole' && message.includes('no longer exists')) {
    repick = () => {
      s.editFeature(id);
      s.updateDraft((d) => void (d.type === 'hole' && (d.at = null)));
    };
  }
  const close = () => useDialogs.getState().close();
  return (
    <div className="flex items-start gap-4">
      <div className="flex-1">
        {first && <div className="text-2xs font-semibold uppercase tracking-wide text-danger mt-2">Start here</div>}
        <IssueRow kind={st?.status === 'error' ? 'error' : 'warning'} feature={f.name} message={causedBy ? `${message} (Caused by ${causedBy}.)` : message} />
      </div>
      {repick && (
        <Button size="sm" className="mt-3" onClick={() => (close(), repick!())}>
          Re-pick
        </Button>
      )}
      {f.type !== 'plane' && (
        <IconButton label={`Edit ${f.name}`} className="mt-3" onClick={() => (close(), s.editFeature(id))}>
          <Pencil size={14} />
        </IconButton>
      )}
    </div>
  );
}

const REASONS: Record<PartVersion['reason'], string> = {
  saved: 'Saved to a file',
  timed: 'Automatic',
  manual: 'Kept by you',
  'before restore': 'Before a restore',
};

/** Every part keeps restore points: at each file save, at the first change and every 10 minutes of work, and on request. */
export function VersionsDialog() {
  const open = useDialogs((d) => d.versions);
  const doc = useDoc((s) => s.doc);
  const [list, setList] = useState<PartVersion[] | null>(null);
  const refresh = () => listVersions(doc.id).then(setList).catch(() => setList([]));
  useEffect(() => {
    if (open) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, doc.id]);
  const close = () => useDialogs.getState().close();
  const keepNow = async () => {
    await saveVersion(useDoc.getState().doc, 'manual');
    refresh();
  };
  const restore = async (v: PartVersion) => {
    await saveVersion(useDoc.getState().doc, 'before restore');
    const restored = migrate(v.doc);
    useDoc.getState().loadDoc({ ...restored, updatedAt: new Date().toISOString() });
    await flushAutosave();
    close();
    useDoc.getState().notify('success', `Restored the version from ${new Date(v.at).toLocaleString()}. What you had open is kept in the history.`);
  };
  return (
    <Modal
      open={open}
      onOpenChange={(v) => !v && close()}
      title="Version history"
      footer={
        <>
          <Button icon={<History size={14} />} onClick={keepNow} disabled={doc.features.length <= 3}>
            Keep a version now
          </Button>
          <Button variant="primary" onClick={close}>Close</Button>
        </>
      }
    >
      <p className="text-xs text-text-muted mb-6">
        A copy of {doc.name} is kept each time you save it to a file, at your first change and then every 10 minutes while you work. The last 50 are kept, in this browser.
      </p>
      {list === null && <p className="text-text-muted">Loading…</p>}
      {list?.length === 0 && <p className="text-text-muted">No versions yet. One is kept automatically after your first change.</p>}
      <ul className="flex flex-col">
        {list?.map((v) => (
          <li key={v.key} className="flex items-center gap-4 py-3 border-b border-border last:border-b-0">
            <span className="flex-1">
              <span className="block font-medium">{new Date(v.at).toLocaleString()}</span>
              <span className="block text-xs text-text-muted">
                {REASONS[v.reason]} · {v.features} {v.features === 1 ? 'feature' : 'features'}
              </span>
            </span>
            <Button size="sm" icon={<RotateCcw size={14} />} onClick={() => restore(v)}>
              Restore
            </Button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
