/**
 * optimizer-panel.ts — le panneau « Optimiser le modèle ».
 *
 * Trois listes, une par catégorie du catalogue (optimize/catalog.ts) : rendu,
 * modèle sans perte, modèle avec perte. Chaque ligne dit ce qu'elle coûte et
 * ce qu'elle rapporte sur ce modèle-ci, après analyse.
 *
 * Le rendu s'applique en direct et se défait en fermant sans enregistrer. Le
 * modèle, lui, ne change qu'en aperçu (en mémoire) tant qu'on n'enregistre
 * pas, et l'original reste sur le serveur : on y revient d'un bouton.
 *
 * Un panneau à part de l'éditeur : charger un aperçu recharge la scène, ce
 * qui fermerait l'éditeur et tout ce qu'il contient.
 */

import { t, type StringKey } from '../i18n';
import { EDITOR_VARS } from '../ui/theme';
import type { Hass, OptimizationRecord, OwlnestScene, RenderingConfig } from '../types';
import {
  CATALOG, byId, hasDestructive, modelOps, presetSelection, renderingFromSelection, selectionFromRendering, sumGains,
  type EstimateContext, type OptimizationDef, type PresetName,
} from '../optimize/catalog';
import { protectFromScene } from '../optimize/protected';
import { OptimizerClient, OptimizerUnavailable, lowMemoryRisk } from '../optimize/client';
import { benchDelta } from '../optimize/bench';
import type { BenchResult, Category, Gain, ModelReport, ModelStats, OpResult, ParamDef, QualityCost, Selection } from '../optimize/types';
import { modelInUse, scenesForModel, type ModelListResult } from '../optimize/backups';

/** Options du toast partagé avec la carte (`sticky` = pas d’auto-fermeture). */
export type ToastOptions = {
  error?: boolean;
  sticky?: boolean;
  title?: string;
};

/** Ce que le panneau demande à la carte. */
export interface OptimizerHost {
  hass(): Hass | null;
  isAdmin(): boolean;
  scene(): OwlnestScene | null;
  /** Le modèle enregistré dans la scène (pas l'aperçu), ou `null` sans modèle importé. */
  modelUrl(): string | null;
  /** Message d'échec du chargement GLB, si la scène est ouverte sans maillage. */
  modelLoadError?(): string | null;
  rendering(): RenderingConfig;
  /** Pose des champs de rendu, en direct, sans enregistrer. */
  setRendering(patch: Partial<RenderingConfig>): void;
  saveScene(): Promise<void>;
  estimateContext(): EstimateContext;
  fetchModel(): Promise<ArrayBuffer>;
  bench(label: string): Promise<BenchResult>;
  downloadBench(results: BenchResult[]): void;
  /** Affiche un modèle en aperçu (`null` : revient à celui de la scène) ; rend ce que la scène n'y trouve plus. */
  preview(glb: ArrayBuffer | null): Promise<{ parts: string[]; effects: string[]; lights: string[] }>;
  saveModel(glb: ArrayBuffer, record: Pick<OptimizationRecord, 'ops' | 'stats_before' | 'stats_after' | 'bench_before' | 'bench_after'>,
    keepCopy: boolean, onProgress: (f: number) => void): Promise<string>;
  restoreOriginal(): Promise<void>;
  /** Pose un fichier serveur comme `model_url` de la scène courante, enregistre et recharge. */
  activateModel(url: string): Promise<void>;
  listModels(): Promise<ModelListResult>;
  deleteModel(url: string): Promise<boolean>;
  /** `true` = erreur ; objet = options (`sticky`, `title`, …). */
  toast(msg: string, errorOrOpts?: boolean | ToastOptions): void;
}

const CSS = `
.ow-opt { position:absolute; top:0; right:0; bottom:0; width:min(440px,100%); z-index:90; display:flex; flex-direction:column;
  background:var(--ow-chrome); color:var(--ow-text); border-left:1px solid var(--ow-line); box-shadow:var(--ow-shadow);
  font:12.5px/1.45 var(--primary-font-family, Inter, system-ui, sans-serif); pointer-events:auto; }
.ow-opt header { display:flex; align-items:center; gap:8px; padding:12px 14px; border-bottom:1px solid var(--ow-line); font-weight:700; font-size:14px; }
.ow-opt header b { flex:1; }
.ow-opt .ow-opt-body { flex:1; overflow:auto; padding:12px 14px 16px; display:flex; flex-direction:column; gap:12px; }
.ow-opt footer { padding:10px 14px; border-top:1px solid var(--ow-line); display:flex; flex-direction:column; gap:8px; }
.ow-opt .ow-opt-row { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
.ow-opt .ow-opt-muted { color:var(--ow-muted); font-size:11.5px; }
.ow-opt .ow-opt-warn { color:#fbbf24; font-size:11.5px; }
.ow-opt .ow-opt-err { color:#fca5a5; font-size:11.5px; }
.ow-opt h5 { margin:4px 0 0; font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:.07em; color:var(--ow-muted); }
.ow-opt .ow-opt-item { border:1px solid var(--ow-line); border-radius:10px; padding:8px 10px; background:var(--ow-chrome2); }
.ow-opt .ow-opt-item.ow-off { opacity:.55; }
.ow-opt .ow-opt-head { display:flex; gap:8px; align-items:flex-start; cursor:pointer; }
.ow-opt .ow-opt-head input { margin-top:2px; }
.ow-opt .ow-opt-title { flex:1; font-weight:600; }
.ow-opt .ow-opt-badge { font-size:10px; font-weight:700; padding:1px 6px; border-radius:999px; white-space:nowrap; }
.ow-opt .ow-opt-gain { font-size:11px; color:var(--ow-muted); margin-top:4px; font-variant-numeric:tabular-nums; }
.ow-opt .ow-opt-bar { height:3px; border-radius:2px; background:rgba(255,255,255,0.08); margin-top:5px; overflow:hidden; }
.ow-opt .ow-opt-bar i { display:block; height:100%; background:var(--ow-acc); }
.ow-opt .ow-opt-params { display:grid; grid-template-columns:1fr 1fr; gap:6px 10px; margin-top:8px; }
.ow-opt .ow-opt-params label { display:flex; flex-direction:column; gap:2px; font-size:10.5px; color:var(--ow-muted); }
.ow-opt .ow-opt-params input, .ow-opt .ow-opt-params select { background:var(--ow-chrome); color:var(--ow-text); border:1px solid var(--ow-line);
  border-radius:6px; padding:4px 6px; font:inherit; font-size:12px; min-width:0; }
.ow-opt .ow-opt-params label.ow-wide { grid-column:1 / -1; }
.ow-opt table { width:100%; border-collapse:collapse; font-size:11.5px; font-variant-numeric:tabular-nums; }
.ow-opt td, .ow-opt th { padding:3px 4px; text-align:right; border-bottom:1px solid var(--ow-line); }
.ow-opt td:first-child, .ow-opt th:first-child { text-align:left; color:var(--ow-muted); font-weight:400; }
.ow-opt .ow-opt-file { display:flex; gap:6px; align-items:center; flex-wrap:wrap; font-size:11.5px; padding:6px 0; border-bottom:1px solid var(--ow-line); }
.ow-opt .ow-opt-file > span { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ow-opt .ow-opt-file.ow-active > span { font-weight:700; color:var(--ow-acc); }
.ow-opt .ow-opt-actions { display:flex; gap:4px; flex-wrap:wrap; align-items:center; }
`;

const COST_COLOR: Record<QualityCost, string> = { none: '#34d399', low: '#a3e635', medium: '#fbbf24', high: '#f87171' };
const COST_KEY: Record<QualityCost, StringKey> = { none: 'optCostNone', low: 'optCostLow', medium: 'optCostMedium', high: 'optCostHigh' };
const CAT_KEY: Record<Category, StringKey> = { render: 'optCatRender', lossless: 'optCatLossless', destructive: 'optCatDestructive' };
const CAT_BADGE: Record<Category, StringKey> = { render: 'optBadgeRender', lossless: 'optBadgeLossless', destructive: 'optBadgeDestructive' };
const CAT_COLOR: Record<Category, string> = { render: '#38bdf8', lossless: '#34d399', destructive: '#f97316' };

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};
const btn = (label: string, cls = 'ow-btn ow-small') => {
  const b = el('button', cls, label);
  b.type = 'button';
  return b;
};
const fmtN = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)} M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)} k` : String(Math.round(n)));
const fmtMB = (n: number) => n.toFixed(n < 10 ? 1 : 0);

/** Les gains d'une ligne, en clair : « −2,5 M triangles · −91 Mo GPU · ~35 % d'image ». */
export function gainText(g: Gain): string {
  const out: string[] = [];
  if (g.triangles) out.push(`−${fmtN(g.triangles)} ${t('optGainTris')}`);
  if (g.drawCalls) out.push(`−${fmtN(g.drawCalls)} ${t('optGainCalls')}`);
  if (g.passes) out.push(`−${g.passes} ${t('optGainPasses')}`);
  if (g.gpuMB) out.push(`${g.gpuMB > 0 ? '−' : '+'}${fmtMB(Math.abs(g.gpuMB))} ${t('optGainGpu')}`);
  if (g.fileMB) out.push(`${g.fileMB > 0 ? '−' : '+'}${fmtMB(Math.abs(g.fileMB))} ${t('optGainFile')}`);
  if (g.fpsHint) out.push(`~${Math.round(g.fpsHint * 100)} % ${t('optGainFrame')}`);
  return out.join(' · ');
}

function statsText(s: ModelStats): string {
  return [
    `${fmtMB(s.fileMB)} ${t('optGainFile')}`,
    `${fmtN(s.triangles)} ${t('optGainTris')}`,
    `${s.primitives} ${t('optGainCalls')}`,
    `${s.textures} tex. (${fmtMB(s.textureGpuMB)} ${t('optGainGpu')})`,
    `${t('optGeometry')} ${fmtMB(s.geometryGpuMB)} ${t('optGainGpu')}`,
    `${s.materials} mat. (${s.physical} phys., ${s.transmission} transm., ${s.doubleSided} 2×)`,
    s.compression,
  ].join(' · ');
}

export class OptimizerPanel {
  private root: HTMLDivElement;
  private body: HTMLDivElement;
  private foot: HTMLElement;
  private client: OptimizerClient | null = null;
  private report: ModelReport | null = null;
  private fileBytes = 0;
  private sel: Selection;
  /** Le rendu à l'ouverture : fermer sans enregistrer le rend. */
  private snapshot: RenderingConfig;
  private renderDirty = false;
  private preview: { glb: ArrayBuffer; report: ModelReport; results: OpResult[]; missing: { parts: string[]; effects: string[]; lights: string[] } } | null = null;
  private benchBefore: BenchResult | null = null;
  private benchAfter: BenchResult | null = null;
  private benches: BenchResult[] = [];
  private busy = '';
  private error = '';
  private files: ModelListResult | null = null;
  /** Ouvre la liste des fichiers serveur dès l'ouverture (récupération d'un GLB cassé). */
  private focusFiles = false;

  constructor(
    container: HTMLElement,
    private host: OptimizerHost,
    private onClose: () => void,
    opts?: { focusFiles?: boolean },
  ) {
    this.focusFiles = !!opts?.focusFiles;
    this.snapshot = { ...host.rendering() };
    this.sel = selectionFromRendering(this.snapshot);
    this.root = el('div', 'ow-opt');
    this.root.style.cssText = EDITOR_VARS;
    const style = el('style');
    style.textContent = CSS;
    const head = el('header');
    const close = btn('✕', 'ow-btn ow-ghost ow-small');
    close.title = t('importClose');
    close.addEventListener('click', () => void this.close());
    head.append(el('b', '', t('optTitle')), close);
    this.body = el('div', 'ow-opt-body');
    this.foot = el('footer');
    this.root.append(style, head, this.body, this.foot);
    container.appendChild(this.root);
    this.render();
    if (this.focusFiles) void this.loadFiles();
  }

  /** Ferme ; le rendu non enregistré et l'aperçu sont défaits. */
  async close(): Promise<void> {
    if (this.busy) return;
    if (this.renderDirty) {
      const reset = renderingFromSelection({}) as Record<string, unknown>;
      for (const k of Object.keys(reset)) reset[k] = (this.snapshot as Record<string, unknown>)[k];
      this.host.setRendering(reset as Partial<RenderingConfig>);
    }
    if (this.preview) await this.host.preview(null).catch(() => undefined);
    this.client?.dispose();
    this.root.remove();
    this.onClose();
  }

  // ── Actions ──────────────────────────────────────────────────────────

  private async run(label: string, task: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = label;
    this.error = '';
    this.render();
    try {
      await task();
    } catch (err) {
      console.error('[Owlnest] optimizer:', err);
      this.error = err instanceof OptimizerUnavailable
        ? t('optWorkerMissing')
        : t('optError').replace('{msg}', err instanceof Error ? err.message : String(err));
    } finally {
      this.busy = '';
      this.render();
    }
  }

  private protect() {
    return protectFromScene(this.host.scene());
  }

  private analyze() {
    return this.run(t('optAnalyzing'), async () => {
      const buf = await this.host.fetchModel();
      this.fileBytes = buf.byteLength;
      this.client ??= new OptimizerClient();
      this.report = await this.client.analyze(buf, this.protect());
    });
  }

  private applyPreset(name: PresetName) {
    this.sel = presetSelection(name);
    this.renderChanged();
  }

  /** Le rendu suit la sélection, en direct. */
  private renderChanged() {
    this.host.setRendering(renderingFromSelection(this.sel));
    this.renderDirty = true;
    this.render();
  }

  private compare() {
    const ops = modelOps(this.sel);
    if (!this.report || !this.client || !ops.length) return Promise.resolve();
    return this.run(t('optPreviewing'), async () => {
      // La mesure « avant » se fait sur le modèle enregistré.
      if (this.preview) { await this.host.preview(null); this.preview = null; }
      this.status(t('optBenchRunning'));
      this.benchBefore = await this.host.bench('before');
      this.benches.push(this.benchBefore);
      const out = await this.client!.optimize(ops, this.protect(), (step, i, n) => {
        const def = byId(step);
        this.status(`${t('optPreviewing')} ${def ? `${def.id} ${t(def.title as StringKey)}` : step} (${Math.min(i + 1, n)}/${n})`);
      });
      this.status(t('importLoading'));
      const missing = await this.host.preview(out.glb);
      this.preview = { glb: out.glb, report: out.report, results: out.results, missing };
      this.status(t('optBenchRunning'));
      this.benchAfter = await this.host.bench('after');
      this.benches.push(this.benchAfter);
    });
  }

  private benchOnly() {
    return this.run(t('optBenchRunning'), async () => {
      const r = await this.host.bench(this.preview ? 'preview' : 'current');
      this.benches.push(r);
    });
  }

  private save(keepCopy: boolean) {
    const p = this.preview;
    const miss = p ? [...p.missing.parts, ...p.missing.effects, ...p.missing.lights] : [];
    if (miss.length && !confirm(`${t('optMissing').replace('{list}', miss.join(', '))}\n\n${t('optSaveMissingConfirm')}`)) return Promise.resolve();
    return this.run(t('optSaving'), async () => {
      if (this.preview && this.report) {
        await this.host.saveModel(this.preview.glb, {
          ops: modelOps(this.sel),
          stats_before: this.report.stats, stats_after: this.preview.report.stats,
          bench_before: this.benchBefore ?? undefined, bench_after: this.benchAfter ?? undefined,
        }, keepCopy, (f) => this.status(`${t('optSaving')} ${Math.round(f * 100)} %`));
        // L'analyse portait sur l'ancien fichier : à refaire sur le nouveau.
        this.preview = null;
        this.report = null;
        this.client?.dispose();
        this.client = null;
        this.benchBefore = this.benchAfter = null;
      } else {
        await this.host.saveScene();
      }
      this.snapshot = { ...this.host.rendering() };
      this.renderDirty = false;
      this.files = null;
      this.host.toast(t('optSaved'));
    });
  }

  private restore() {
    if (!confirm(t('optRestoreConfirm'))) return Promise.resolve();
    return this.run(t('optSaving'), async () => {
      if (this.preview) { await this.host.preview(null); this.preview = null; }
      await this.host.restoreOriginal();
      this.report = null;
      this.client?.dispose();
      this.client = null;
      this.files = null;
      this.host.toast(t('optRestored'));
    });
  }

  private loadFiles() {
    return this.run(t('optFiles'), async () => { this.files = await this.host.listModels(); });
  }

  private status(text: string) {
    this.busy = text;
    const s = this.foot.querySelector('.ow-opt-status');
    if (s) s.textContent = text;
  }

  // ── Affichage ────────────────────────────────────────────────────────

  private render() {
    const body = this.body;
    const scroll = body.scrollTop;
    body.replaceChildren();
    const url = this.host.modelUrl();
    const loadErr = this.host.modelLoadError?.() ?? null;
    const r = this.report;

    // GLB cassé : on privilégie la liste Activer plutôt que l'analyse.
    if (loadErr) {
      body.append(el('div', 'ow-opt-err', `${loadErr}. ${t('modelErrRecover')}`));
      if (url) {
        body.append(el('div', 'ow-opt-muted', decodeURIComponent(url.split('/').pop() ?? url)));
      } else {
        body.append(el('div', 'ow-opt-muted', t('optNoModel')));
      }
      if (this.host.scene()) body.append(this.renderFiles());
      this.renderFoot();
      return;
    }

    if (!url) {
      body.append(el('div', 'ow-opt-muted', t('optNoModel')));
      // Sans URL active, la liste serveur reste le moyen d'en activer une.
      if (this.host.scene()) body.append(this.renderFiles());
      this.renderFoot();
      return;
    }

    // Synthèse
    const sum = el('div');
    sum.append(el('div', 'ow-opt-muted', decodeURIComponent(url.split('/').pop() ?? url)));
    if (r) {
      sum.append(el('div', '', statsText(r.stats)));
      if (r.protectedNames.length) {
        sum.append(el('div', 'ow-opt-muted', t('optProtected').replace('{n}', String(r.protectedNames.length))));
      }
    } else {
      const row = el('div', 'ow-opt-row');
      const go = btn(t('optAnalyze'), 'ow-btn ow-primary ow-small');
      go.disabled = !!this.busy;
      go.addEventListener('click', () => void this.analyze());
      row.append(go, el('span', 'ow-opt-muted', t('optAnalyzeHint')));
      sum.append(row);
      if (this.fileBytes ? lowMemoryRisk(this.fileBytes) : lowMemoryRisk(31 * 1024 * 1024)) {
        sum.append(el('div', 'ow-opt-warn', t('optLowMemory')));
      }
    }
    body.append(sum);

    // Préréglages
    const presets = el('div', 'ow-opt-row');
    presets.append(el('span', 'ow-opt-muted', t('optPresets')));
    for (const [name, key] of [['safe', 'optPresetSafe'], ['balanced', 'optPresetBalanced'], ['aggressive', 'optPresetAggressive']] as const) {
      const b = btn(t(key));
      b.disabled = !!this.busy;
      b.addEventListener('click', () => this.applyPreset(name));
      presets.append(b);
    }
    body.append(presets);

    // Total
    const ctx = this.host.estimateContext();
    const gains = new Map<string, Gain>();
    if (r) for (const d of CATALOG) gains.set(d.id, d.estimate(r, this.sel[d.id].params, ctx));
    if (r) {
      const total = sumGains(CATALOG.filter((d) => this.sel[d.id]?.enabled).map((d) => gains.get(d.id)!));
      const tot = el('div', 'ow-opt-item');
      tot.append(el('b', '', t('optTotal')), el('div', 'ow-opt-gain', gainText(total) || '—'));
      body.append(tot);
    }

    for (const cat of ['render', 'lossless', 'destructive'] as Category[]) {
      body.append(el('h5', '', t(CAT_KEY[cat])));
      for (const d of CATALOG.filter((x) => x.category === cat)) body.append(this.renderItem(d, gains.get(d.id), r));
    }

    // Comparaison
    if (this.preview || this.benches.length) body.append(this.renderCompare());

    // Historique et fichiers
    const scene = this.host.scene();
    if (scene?.optimizations?.length) {
      body.append(el('h5', '', t('optHistory')));
      for (const o of [...scene.optimizations].reverse().slice(0, 6)) {
        const what = o.restored ? t('optRestored')
          : o.switched ? t('optSwitched')
          : o.ops.map((x) => x.id).join(', ');
        body.append(el('div', 'ow-opt-muted', `${o.date.slice(0, 16).replace('T', ' ')} · ${what}`));
      }
    }
    body.append(this.renderFiles());
    body.scrollTop = scroll;
    this.renderFoot();
  }

  private renderItem(d: OptimizationDef, gain: Gain | undefined, r: ModelReport | null): HTMLElement {
    const choice = this.sel[d.id];
    const box = el('div', `ow-opt-item${choice.enabled ? '' : ' ow-off'}`);
    const head = el('label', 'ow-opt-head');
    const check = el('input');
    check.type = 'checkbox';
    check.checked = choice.enabled;
    // Le modèle ne se transforme qu'après analyse ; C5 demande un outil externe.
    check.disabled = !!this.busy || !!d.cliOnly || (d.category !== 'render' && !r);
    check.addEventListener('change', () => {
      choice.enabled = check.checked;
      if (d.category === 'render') this.renderChanged();
      else this.render();
    });
    const title = el('span', 'ow-opt-title', `${d.id} · ${t(d.title as StringKey)}`);
    const cost = el('span', 'ow-opt-badge', t(COST_KEY[d.cost]));
    cost.style.cssText = `background:${COST_COLOR[d.cost]}22;color:${COST_COLOR[d.cost]};`;
    const cat = el('span', 'ow-opt-badge', t(CAT_BADGE[d.category]));
    cat.style.cssText = `background:${CAT_COLOR[d.category]}22;color:${CAT_COLOR[d.category]};`;
    head.append(check, title, cost, cat);
    box.append(head, el('div', 'ow-opt-muted', t(d.hint as StringKey)));
    if (d.structural) box.append(el('div', 'ow-opt-warn', t('optStructural')));
    if (d.cliOnly) box.append(el('div', 'ow-opt-muted', t('optCliOnly')));

    if (gain && r) {
      const parts = [gainText(gain)];
      if (gain.affected !== undefined) parts.push(t('optAffected').replace('{n}', String(gain.affected)));
      if (gain.skipped) parts.push(t('optSkipped').replace('{n}', String(gain.skipped)));
      box.append(el('div', 'ow-opt-gain', parts.filter(Boolean).join(' · ') || '—'));
      // La barre : la plus forte des parts gagnées (image, mémoire, fichier).
      const gpuTotal = r.stats.textureGpuMB + r.stats.geometryGpuMB;
      const score = Math.max(gain.fpsHint ?? 0, gpuTotal ? (gain.gpuMB ?? 0) / gpuTotal : 0, r.stats.fileMB ? (gain.fileMB ?? 0) / r.stats.fileMB : 0);
      const bar = el('div', 'ow-opt-bar');
      const fill = el('i');
      fill.style.width = `${Math.round(Math.min(1, Math.max(0, score)) * 100)}%`;
      bar.append(fill);
      box.append(bar);
    }

    if (choice.enabled && d.params.length) {
      const grid = el('div', 'ow-opt-params');
      for (const p of d.params) grid.append(this.renderParam(d, p));
      box.append(grid);
    }
    return box;
  }

  private renderParam(d: OptimizationDef, p: ParamDef): HTMLElement {
    const params = this.sel[d.id].params;
    const label = el('label', p.kind === 'text' ? 'ow-wide' : '', t(p.label as StringKey));
    const changed = () => (d.category === 'render' ? this.renderChanged() : this.render());
    if (p.kind === 'select') {
      const s = el('select');
      for (const o of p.options ?? []) {
        const opt = el('option', '', t(`optPolicy_${o.replace('-', '_')}` as StringKey));
        opt.value = o;
        opt.selected = params[p.key] === o;
        s.append(opt);
      }
      s.addEventListener('change', () => { params[p.key] = s.value; changed(); });
      label.append(s);
    } else {
      const i = el('input');
      i.type = p.kind === 'number' ? 'number' : 'text';
      if (p.kind === 'number') {
        if (p.min !== undefined) i.min = String(p.min);
        if (p.max !== undefined) i.max = String(p.max);
        if (p.step !== undefined) i.step = String(p.step);
      }
      i.value = String(params[p.key] ?? p.default ?? '');
      i.addEventListener('change', () => {
        params[p.key] = p.kind === 'number' ? Number(i.value) || Number(p.default) : i.value;
        changed();
      });
      label.append(i);
    }
    return label;
  }

  private renderCompare(): HTMLElement {
    const box = el('div', 'ow-opt-item');
    box.append(el('b', '', t('optCompare')));
    const p = this.preview;
    if (p && this.report) {
      const a = this.report.stats, b = p.report.stats;
      const table = el('table');
      const row = (label: string, x: string, y: string) => {
        const tr = el('tr');
        tr.append(el('td', '', label), el('td', '', x), el('td', '', y));
        table.append(tr);
      };
      const th = el('tr');
      th.append(el('th'), el('th', '', t('optBefore')), el('th', '', t('optAfter')));
      table.append(th);
      row(t('optGainFile'), fmtMB(a.fileMB), fmtMB(b.fileMB));
      row(t('optGainTris'), fmtN(a.triangles), fmtN(b.triangles));
      row(t('optGainCalls'), String(a.primitives), String(b.primitives));
      row(`tex. ${t('optGainGpu')}`, fmtMB(a.textureGpuMB), fmtMB(b.textureGpuMB));
      row(`${t('optGeometry')} ${t('optGainGpu')}`, fmtMB(a.geometryGpuMB), fmtMB(b.geometryGpuMB));
      const ba = this.benchBefore, bb = this.benchAfter;
      if (ba && bb) {
        row('img/s', ba.avgFps.toFixed(1), bb.avgFps.toFixed(1));
        row('p95 ms', ba.p95FrameMs.toFixed(1), bb.p95FrameMs.toFixed(1));
        row(t('optGainCalls'), String(ba.calls), String(bb.calls));
        row(`GPU (${t('optMeasured')})`, fmtMB(ba.gpuMB), fmtMB(bb.gpuMB));
        const d = benchDelta(ba, bb);
        box.append(table, el('div', 'ow-opt-gain', `img/s ${d.fps >= 0 ? '+' : ''}${Math.round(d.fps * 100)} % · p95 ${d.p95 >= 0 ? '+' : ''}${Math.round(d.p95 * 100)} %`));
      } else {
        box.append(table);
      }
      const results = p.results.map((x) => `${x.id}: ${x.affected}${x.skipped ? ` (+${x.skipped})` : ''}${x.note ? ` [${x.note}]` : ''}`).join(' · ');
      box.append(el('div', 'ow-opt-muted', results));
      const miss = [...p.missing.parts, ...p.missing.effects, ...p.missing.lights];
      box.append(miss.length
        ? el('div', 'ow-opt-err', t('optMissing').replace('{list}', miss.join(', ')))
        : el('div', 'ow-opt-muted', t('optMissingNone')));
    }
    if (this.benches.length) {
      const last = this.benches[this.benches.length - 1];
      box.append(el('div', 'ow-opt-gain',
        `${last.label ?? ''} ${last.avgFps.toFixed(1)} img/s · p95 ${last.p95FrameMs.toFixed(1)} ms · ${last.calls} ${t('optGainCalls')} · ${fmtN(last.triangles)} ${t('optGainTris')} · ${last.width}×${last.height}`));
      box.append(el('div', 'ow-opt-muted', t('optFpsNote')));
      const exp = btn(t('optBenchExport'));
      exp.addEventListener('click', () => this.host.downloadBench(this.benches));
      box.append(exp);
    }
    return box;
  }

  private renderFiles(): HTMLElement {
    const box = el('details');
    const sum = el('summary', 'ow-opt-muted', t('optFiles'));
    sum.style.cursor = 'pointer';
    box.append(sum);
    box.addEventListener('toggle', () => { if (box.open && !this.files && !this.busy) void this.loadFiles(); });
    if (this.focusFiles || this.files) box.open = true;
    if (this.focusFiles && !this.files && !this.busy) {
      // Premier rendu : on ouvre tout de suite (récupération d'un modèle cassé).
      queueMicrotask(() => { if (!this.files && !this.busy) void this.loadFiles(); });
    }
    if (this.files) {
      const activeBare = (this.host.modelUrl() ?? '').split(/[?#]/)[0];
      const admin = this.host.isAdmin();
      const hasScene = !!this.host.scene();
      for (const m of this.files.models) {
        const row = el('div', 'ow-opt-file');
        const isActive = !!activeBare && m.url.split(/[?#]/)[0] === activeBare;
        if (isActive) row.classList.add('ow-active');
        const used = modelInUse(this.files, m.url);
        row.append(el('span', '', m.name), el('small', 'ow-opt-muted', `${fmtMB(m.size / 1048576)} Mo`));
        if (isActive) row.append(el('small', 'ow-opt-muted', t('optActive')));
        else if (used) row.append(el('small', 'ow-opt-muted', t('optInUse')));

        const actions = el('div', 'ow-opt-actions');
        const activate = btn(t('optActivate'), 'ow-btn ow-small');
        activate.disabled = !!this.busy || isActive || !admin || !hasScene;
        activate.title = isActive ? t('optActive') : t('optActivate');
        activate.addEventListener('click', () => void this.activateFile(m.url));

        const download = btn(t('optDownload'), 'ow-btn ow-small');
        download.disabled = !!this.busy;
        download.addEventListener('click', () => void this.downloadFile(m.url));

        const info = btn(t('optInfo'), 'ow-btn ow-ghost ow-small');
        info.disabled = !!this.busy;
        info.addEventListener('click', () => this.showFileInfo(m.url));

        actions.append(activate, download, info);
        if (!used && admin) {
          const del = btn(t('optDelete'), 'ow-btn ow-danger ow-small');
          del.disabled = !!this.busy;
          del.addEventListener('click', () => {
            if (!confirm(t('optDeleteConfirm'))) return;
            void this.run(t('optDelete'), async () => {
              await this.host.deleteModel(m.url);
              this.files = await this.host.listModels();
            });
          });
          actions.append(del);
        }
        row.append(actions);
        box.append(row);
      }
    }
    return box;
  }

  private activateFile(url: string) {
    if (this.preview && !confirm(t('optActivateConfirm'))) return Promise.resolve();
    return this.run(t('optSaving'), async () => {
      if (this.preview) { await this.host.preview(null); this.preview = null; }
      await this.host.activateModel(url);
      this.report = null;
      this.client?.dispose();
      this.client = null;
      this.benchBefore = this.benchAfter = null;
      this.files = await this.host.listModels();
      this.host.toast(t('optActivated'));
    });
  }

  private downloadFile(url: string) {
    return this.run(t('optDownload'), async () => {
      const name = decodeURIComponent(url.split(/[?#]/)[0].split('/').pop() ?? 'model.glb');
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
  }

  private showFileInfo(url: string) {
    if (!this.files) return;
    const bare = url.split(/[?#]/)[0];
    const name = this.files.models.find((m) => m.url.split(/[?#]/)[0] === bare)?.name
      ?? decodeURIComponent(bare.split('/').pop() ?? 'model.glb');
    const scenes = scenesForModel(this.files, url);
    this.host.toast(
      scenes.length
        ? t('optInfoScenes').replace('{list}', scenes.join(', '))
        : t('optInfoUnused'),
      { sticky: true, title: name },
    );
  }

  private renderFoot() {
    const f = this.foot;
    f.replaceChildren();
    if (this.busy) f.append(el('div', 'ow-opt-status ow-opt-muted', this.busy));
    if (this.error) f.append(el('div', 'ow-opt-err', this.error));
    const url = this.host.modelUrl();
    // Sans modèle chargeable : la récupération passe par Activer dans la liste.
    if (!url || this.host.modelLoadError?.()) return;
    const admin = this.host.isAdmin();
    const ops = modelOps(this.sel);

    const row1 = el('div', 'ow-opt-row');
    const cmp = btn(t('optPreview'), 'ow-btn ow-small');
    cmp.disabled = !!this.busy || !this.report || !ops.length;
    cmp.addEventListener('click', () => void this.compare());
    const bench = btn(t('optBench'));
    bench.disabled = !!this.busy;
    bench.addEventListener('click', () => void this.benchOnly());
    row1.append(cmp, bench);
    if (this.preview) {
      const back = btn(t('optBackToSaved'), 'ow-btn ow-ghost ow-small');
      back.disabled = !!this.busy;
      back.addEventListener('click', () => void this.run(t('importLoading'), async () => {
        await this.host.preview(null);
        this.preview = null;
      }));
      row1.append(back);
    }
    f.append(row1);

    if (!admin) {
      f.append(el('div', 'ow-opt-muted', t('optNotAdmin')));
      return;
    }
    const row2 = el('div', 'ow-opt-row');
    // Avec perte : une copie de l'original est toujours gardée.
    const destructive = !!this.preview && hasDestructive(this.sel);
    const keepLabel = el('label', 'ow-opt-muted');
    keepLabel.style.cssText = 'display:flex;gap:6px;align-items:center;flex:1;';
    const keep = el('input');
    keep.type = 'checkbox';
    keep.checked = true;
    keep.disabled = destructive || !this.preview;
    keepLabel.append(keep, document.createTextNode(destructive ? t('optKeepCopyForced') : t('optKeepCopy')));
    const save = btn(t('optSave'), 'ow-btn ow-primary ow-small');
    save.disabled = !!this.busy || (!this.preview && !this.renderDirty);
    save.addEventListener('click', () => void this.save(destructive || keep.checked));
    row2.append(keepLabel, save);
    f.append(row2);

    if (this.host.scene()?.model_original_url) {
      const restore = btn(t('optRestore'), 'ow-btn ow-ghost ow-small');
      restore.disabled = !!this.busy;
      restore.addEventListener('click', () => void this.restore());
      f.append(restore);
    }
  }
}
