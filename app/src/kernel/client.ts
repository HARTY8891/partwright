import { wrap } from 'comlink';
import type { KernelApi } from './kernel.worker';

export const kernel = wrap<KernelApi>(new Worker(new URL('./kernel.worker.ts', import.meta.url), { type: 'module' }));
export type { MeshData, RebuildResult, FeatureStatus } from './kernel.worker';
