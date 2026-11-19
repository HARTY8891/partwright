// Keeps the kernel's view in sync with the document: rebuilds on every document
// change and recomputes the extrude preview while the feature panel is open.
import { create } from 'zustand';
import { make3MF } from '../model/threemf';
import { kernel, type FeatureStatus, type MeshData } from '../kernel/client';
import { useDoc } from './docStore';

interface KernelState {
  loading: boolean;
  loadError: string | null;
  busy: boolean;
  ms: number;
  /** solid volume in mm³ */
  volume: number;
  statuses: Record<string, FeatureStatus>;
  mesh: MeshData | null;
  preview: MeshData | null;
  previewError: string | null;
}

export const useKernel = create<KernelState>(() => ({
  loading: true,
  loadError: null,
  busy: false,
  ms: 0,
  volume: 0,
  statuses: {},
  mesh: null,
  preview: null,
  previewError: null,
}));

let seq = 0;
let previewSeq = 0;

async function rebuild() {
  const my = ++seq;
  useKernel.setState({ busy: true });
  try {
    const res = await kernel.rebuild(useDoc.getState().doc);
    if (my !== seq) return;
    useKernel.setState({
      busy: false,
      ms: res.ms,
      volume: res.volume,
      mesh: res.mesh,
      statuses: Object.fromEntries(res.statuses.map((s) => [s.id, s])),
    });
  } catch (e) {
    if (my !== seq) return;
    useKernel.setState({ busy: false });
    useDoc.getState().notify('error', `Rebuild failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function preview() {
  const m = useDoc.getState().mode;
  if (m.kind !== 'feature') {
    previewSeq++; // drop any preview still in flight
    useKernel.setState({ preview: null, previewError: null });
    return;
  }
  const my = ++previewSeq;
  const doc = useDoc.getState().doc;
  // When editing, preview the document without the feature being edited.
  const features = m.editingId ? doc.features.filter((f) => f.id !== m.editingId) : doc.features;
  const base = { ...doc, features, rollbackIndex: Math.min(doc.rollbackIndex, features.length) };
  try {
    const res = await kernel.preview(base, m.draft);
    if (my !== previewSeq) return;
    useKernel.setState({ preview: res.mesh, previewError: res.error ?? null });
  } catch (e) {
    if (my !== previewSeq) return;
    useKernel.setState({ preview: null, previewError: e instanceof Error ? e.message : String(e) });
  }
}

export function startKernelSync() {
  kernel
    .init()
    .then(() => useKernel.setState({ loading: false }))
    .catch((e) => useKernel.setState({ loading: false, loadError: String(e) }));
  rebuild();
  let lastDoc = useDoc.getState().doc;
  let lastMode = useDoc.getState().mode;
  useDoc.subscribe((s) => {
    if (s.doc !== lastDoc) {
      lastDoc = s.doc;
      rebuild();
    }
    if (s.mode !== lastMode) {
      lastMode = s.mode;
      preview();
    }
  });
}

export async function exportFile(format: 'stl' | 'step' | '3mf') {
  const { doc, notify } = useDoc.getState();
  if (format === '3mf') {
    const m = useKernel.getState().mesh;
    if (!m || !m.triangles.length) return notify('error', 'There is no solid to export yet. Extrude a sketch first.');
    download(new Blob([make3MF(m.vertices, m.triangles, doc.name)], { type: 'model/3mf' }), `${doc.name}.3mf`);
    return notify('success', `Exported ${doc.name}.3mf`);
  }
  const buf = await kernel.exportFile(format);
  if (!buf) {
    notify('error', 'There is no solid to export yet. Extrude a sketch first.');
    return;
  }
  download(new Blob([buf], { type: format === 'stl' ? 'model/stl' : 'model/step' }), `${doc.name}.${format}`);
  notify('success', `Exported ${doc.name}.${format}`);
}

export function download(blob: Blob, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
