/**
 * drop.ts — de ce qu'on lâche sur la carte jusqu'à l'adresse du modèle.
 *
 * Lit ce qui a été déposé (fichiers, dossier, zip), choisit le modèle, le
 * convertit en GLB s'il le faut et l'envoie à l'intégration. La carte n'a plus
 * qu'à afficher l'avancement et à pointer sa scène sur l'adresse rendue.
 */

import { unzipSync } from 'fflate';
import { objToGlb, parseMtl, fileKey, type ImportStats } from './obj-to-glb';
import {
  estimateLighten, estimateGeometry, measureImage, downscaleImage, makeSimplifier, worthOffering,
  MAX_TEXTURE, type LightenOffer, type TextureInfo,
} from './lighten';
import type { SimplifyFn } from './obj-to-glb';
import { planImport, modelSlug, type DroppedFile } from './plan';
import { uploadGlb, type UploadHass } from './upload';
import type { OptimizationRecord, RenderingConfig } from '../types';
import { modelOps, presetSelection, renderingFromSelection, type PresetName } from '../optimize/catalog';
import { OptimizerClient } from '../optimize/client';
import { originalSlug } from '../optimize/backups';
import type { ProtectSpec } from '../optimize/types';

export type ImportStage = 'reading' | 'lightening' | 'converting' | 'uploading' | 'optimizing';

export class ImportError extends Error {
  constructor(readonly reason: 'empty' | 'gltf-text' | 'no-model') {
    super(reason);
  }
}

export interface ImportResult {
  url: string;
  /** Absent pour un GLB déposé tel quel. */
  stats?: ImportStats;
  /** GLB optimisé à l'import : l'original envoyé tel quel, et ce qui a été fait. */
  originalUrl?: string;
  optimization?: OptimizationRecord;
  /** Les réglages de rendu du préréglage choisi, à poser sur la scène. */
  rendering?: Partial<RenderingConfig>;
  /** L'optimisation a échoué : l'original est importé seul. */
  optimizeError?: string;
}

/** Optimiser un GLB déposé : le préréglage choisi (ou `null`), et ce que la scène protège. */
export interface ImportOptimize {
  choose(fileBytes: number): Promise<PresetName | null>;
  protect: ProtectSpec;
}

// ── Lecture ────────────────────────────────────────────────────────────────

/** Les entrées d'un dépôt, dossiers compris, avant que le navigateur ne les oublie. */
export function droppedEntries(dt: DataTransfer): FileSystemEntry[] | null {
  const items = Array.from(dt.items).filter((i) => i.kind === 'file');
  if (!items.length || typeof items[0].webkitGetAsEntry !== 'function') return null;
  // Les entrées ne sont valables que pendant l'événement : on les prend toutes
  // ici, avant le premier `await`.
  const entries = items.map((i) => i.webkitGetAsEntry()).filter((e): e is FileSystemEntry => !!e);
  // Un dépôt construit par script n'a pas d'entrées : on se rabat sur ses fichiers.
  return entries.length ? entries : null;
}

async function readEntry(entry: FileSystemEntry, out: File[], paths: string[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
    out.push(file);
    paths.push(entry.fullPath.replace(/^\//, ''));
    return;
  }
  if (!entry.isDirectory) return;
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  // `readEntries` rend les enfants par lots de cent : on lit jusqu'au lot vide.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
    if (!batch.length) break;
    for (const child of batch) await readEntry(child, out, paths);
  }
}

/** Lit des fichiers ou des entrées, et déplie les zips au passage. */
export async function readDropped(source: FileSystemEntry[] | File[]): Promise<DroppedFile[]> {
  const files: File[] = [];
  const paths: string[] = [];
  for (const item of source) {
    if (item instanceof File) {
      files.push(item);
      paths.push(item.webkitRelativePath || item.name);
    } else {
      await readEntry(item, files, paths);
    }
  }

  const out: DroppedFile[] = [];
  for (let i = 0; i < files.length; i++) {
    const data = new Uint8Array(await files[i].arrayBuffer());
    if (/\.zip$/i.test(paths[i])) {
      for (const [path, content] of Object.entries(unzipSync(data))) {
        if (!path.endsWith('/')) out.push({ path, data: content });
      }
    } else {
      out.push({ path: paths[i], data });
    }
  }
  return out;
}

// ── Import ─────────────────────────────────────────────────────────────────

/** Laisse le navigateur peindre l'étape annoncée avant un calcul qui bloque. */
// Avec un délai de secours : un onglet en arrière-plan ne peint plus, et
// l'import ne doit pas rester suspendu à une image qui ne viendra pas.
const nextFrame = () => new Promise<void>((res) => {
  requestAnimationFrame(() => setTimeout(res, 0));
  setTimeout(res, 100);
});

export async function importModel(
  hass: UploadHass,
  source: FileSystemEntry[] | File[],
  onStage: (stage: ImportStage, fraction?: number) => void,
  /**
   * Propose l'allègement quand des textures dépassent `MAX_TEXTURE`. Rend le
   * choix de l'utilisateur ; absent, rien n'est réduit.
   */
  chooseLighten?: (offer: LightenOffer) => Promise<boolean>,
  /** Propose d'optimiser un GLB déposé ; absent, il part tel quel. */
  optimize?: ImportOptimize,
): Promise<ImportResult> {
  onStage('reading');
  await nextFrame();
  const plan = planImport(await readDropped(source));
  if (plan.kind === 'error') throw new ImportError(plan.reason);

  let glb: Uint8Array;
  let stats: ImportStats | undefined;
  if (plan.kind === 'glb') {
    const preset = optimize ? await optimize.choose(plan.glb.byteLength) : null;
    if (preset) return importOptimized(hass, plan.name, plan.glb, preset, optimize!.protect, onStage);
    glb = plan.glb;
  } else {
    const decoder = new TextDecoder();
    const objText = decoder.decode(plan.obj);
    const mtlText = plan.mtl ? decoder.decode(plan.mtl) : null;
    let images = plan.images;
    let simplify: SimplifyFn | undefined;

    if (chooseLighten) {
      // Seules comptent les textures que le MTL utilise : un dossier d'export
      // peut contenir d'autres images, qui ne partiront pas dans le modèle.
      const used = new Set([...parseMtl(mtlText ?? '').values()].map((m) => m.map && fileKey(m.map)).filter(Boolean));
      const infos = new Map<string, TextureInfo>();
      for (const [key, img] of images) {
        if (!used.has(key)) continue;
        const info = await measureImage(img);
        if (info) infos.set(key, info);
      }
      const offer: LightenOffer = { textures: estimateLighten(infos.values()), geometry: estimateGeometry(objText) };
      if (worthOffering(offer) && await chooseLighten(offer)) {
        onStage('lightening', 0);
        simplify = await makeSimplifier();
        const lighter = new Map(images);
        let done = 0;
        const heavy = [...infos].filter(([, i]) => Math.max(i.width, i.height) > MAX_TEXTURE);
        for (const [key, info] of heavy) {
          lighter.set(key, await downscaleImage(images.get(key)!, info));
          onStage('lightening', ++done / heavy.length);
        }
        images = lighter;
      }
    }

    onStage('converting');
    await nextFrame();
    const out = objToGlb(objText, mtlText, images, { simplify });
    glb = new Uint8Array(out.glb);
    stats = out.stats;
  }

  onStage('uploading', 0);
  const url = await uploadGlb(hass, modelSlug(plan.name), glb, (f) => onStage('uploading', f));
  return { url, stats };
}

/**
 * Un GLB optimisé à l'import. L'original part d'abord, sous son propre nom :
 * s'il arrive malheur ensuite, il est déjà sur le serveur, et c'est lui que
 * la scène affichera.
 */
async function importOptimized(
  hass: UploadHass, name: string, glb: Uint8Array, preset: PresetName, protect: ProtectSpec,
  onStage: (stage: ImportStage, fraction?: number) => void,
): Promise<ImportResult> {
  onStage('uploading', 0);
  const originalUrl = await uploadGlb(hass, originalSlug(name), glb, (f) => onStage('uploading', f));
  const sel = presetSelection(preset);
  const ops = modelOps(sel);
  const client = new OptimizerClient();
  try {
    onStage('optimizing');
    const before = await client.analyze(glb.slice().buffer, protect);
    const out = await client.optimize(ops, protect);
    onStage('uploading', 0);
    const url = await uploadGlb(hass, modelSlug(`${name.slice(0, 36)}-opt`), new Uint8Array(out.glb), (f) => onStage('uploading', f));
    return {
      url, originalUrl,
      optimization: { ops, url, from: originalUrl, date: new Date().toISOString(), stats_before: before.stats, stats_after: out.report.stats },
      rendering: renderingFromSelection(sel),
    };
  } catch (err) {
    console.warn('[Owlnest] import optimization failed, original kept:', err);
    return { url: originalUrl, optimizeError: err instanceof Error ? err.message : String(err) };
  } finally {
    client.dispose();
  }
}
