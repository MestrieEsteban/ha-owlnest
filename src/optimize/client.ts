/**
 * client.ts — le côté carte du worker d'optimisation.
 *
 * Le worker est un fichier à part, servi par l'intégration à côté de la carte
 * (`/owlnest_frontend/owlnest-optimizer.js`). On le lit puis on le lance depuis
 * une URL blob : en développement, la carte vient du serveur Vite et la page
 * de Home Assistant, et un worker ne se lance pas depuis une autre origine.
 */

import type { ModelReport, OpResult, Params, ProtectSpec } from './types';

const FILE = 'owlnest-optimizer.js';

/** Où chercher le worker : à côté de la carte, sinon là où l'intégration la sert. */
function candidates(): string[] {
  const out: string[] = [];
  try {
    const card = import.meta.url;
    const url = new URL(FILE, card);
    url.search = new URL(card).search;
    if (!/\/src\//.test(url.pathname)) out.push(url.href);
  } catch { /* hors module */ }
  out.push(`/owlnest_frontend/${FILE}`);
  return out;
}

export class OptimizerUnavailable extends Error {}

export interface OptimizeOutput {
  glb: ArrayBuffer;
  report: ModelReport;
  results: OpResult[];
}

type Pending = {
  resolve(v: unknown): void;
  reject(e: Error): void;
  progress?: (step: string, index: number, total: number) => void;
};

export class OptimizerClient {
  private worker: Worker | null = null;
  private blobUrl = '';
  private seq = 0;
  private pending = new Map<number, Pending>();

  private async start(): Promise<Worker> {
    if (this.worker) return this.worker;
    let code = '';
    for (const url of candidates()) {
      try {
        const res = await fetch(url, { cache: 'no-cache' });
        if (res.ok) { code = await res.text(); break; }
      } catch { /* suivant */ }
    }
    if (!code) throw new OptimizerUnavailable(FILE);
    this.blobUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    const w = new Worker(this.blobUrl);
    w.onmessage = (e: MessageEvent<{ id: number; type: string; message?: string; step?: string; index?: number; total?: number }>) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      if (e.data.type === 'progress') { p.progress?.(e.data.step ?? '', e.data.index ?? 0, e.data.total ?? 1); return; }
      this.pending.delete(e.data.id);
      if (e.data.type === 'error') p.reject(new Error(e.data.message));
      else p.resolve(e.data);
    };
    // Un worker qui meurt (mémoire épuisée sur la tablette) ne répond plus : on le dit.
    w.onerror = (e) => {
      const err = new Error(e.message || 'Optimizer worker crashed');
      this.pending.forEach((p) => p.reject(err));
      this.pending.clear();
      this.dispose();
    };
    this.worker = w;
    return w;
  }

  private async call<T>(msg: Record<string, unknown>, transfer: Transferable[] = [], progress?: Pending['progress']): Promise<T> {
    const w = await this.start();
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, progress });
      w.postMessage({ ...msg, id }, transfer);
    });
  }

  /** Analyse un modèle ; le worker le garde pour l'optimiser ensuite. */
  async analyze(glb: ArrayBuffer, protect: ProtectSpec): Promise<ModelReport> {
    const r = await this.call<{ report: ModelReport }>({ type: 'analyze', glb, protect }, [glb]);
    return r.report;
  }

  async optimize(
    ops: { id: string; params: Params }[], protect: ProtectSpec,
    progress?: (step: string, index: number, total: number) => void,
  ): Promise<OptimizeOutput> {
    return this.call<OptimizeOutput>({ type: 'optimize', ops, protect }, [], progress);
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    if (this.blobUrl) URL.revokeObjectURL(this.blobUrl);
    this.blobUrl = '';
  }
}

/**
 * Prévenir avant d'analyser un gros modèle sur un appareil modeste : décodé,
 * un modèle de 37 Mo occupe plusieurs centaines de Mo.
 */
export function lowMemoryRisk(fileBytes: number): boolean {
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return fileBytes > 30 * 1024 * 1024 && (mem === undefined ? /Android|iPad|iPhone/i.test(navigator.userAgent) : mem <= 4);
}
