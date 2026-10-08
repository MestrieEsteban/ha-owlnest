/**
 * drop.ts — de ce qu'on lâche sur la carte jusqu'à l'adresse du modèle.
 *
 * Lit ce qui a été déposé (fichiers, dossier, zip), choisit le modèle, le
 * convertit en GLB s'il le faut et l'envoie à l'intégration. La carte n'a plus
 * qu'à afficher l'avancement et à pointer sa scène sur l'adresse rendue.
 */

import { unzipSync } from 'fflate';
import { objToGlb, type ImportStats } from './obj-to-glb';
import { planImport, modelSlug, type DroppedFile } from './plan';
import { uploadGlb, type UploadHass } from './upload';

export type ImportStage = 'reading' | 'converting' | 'uploading';

export class ImportError extends Error {
  constructor(readonly reason: 'empty' | 'gltf-text' | 'no-model') {
    super(reason);
  }
}

export interface ImportResult {
  url: string;
  /** Absent pour un GLB déposé tel quel. */
  stats?: ImportStats;
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
): Promise<ImportResult> {
  onStage('reading');
  await nextFrame();
  const plan = planImport(await readDropped(source));
  if (plan.kind === 'error') throw new ImportError(plan.reason);

  let glb: Uint8Array;
  let stats: ImportStats | undefined;
  if (plan.kind === 'glb') {
    glb = plan.glb;
  } else {
    onStage('converting');
    await nextFrame();
    const decoder = new TextDecoder();
    const out = objToGlb(
      decoder.decode(plan.obj),
      plan.mtl ? decoder.decode(plan.mtl) : null,
      plan.images,
    );
    glb = new Uint8Array(out.glb);
    stats = out.stats;
  }

  onStage('uploading', 0);
  const url = await uploadGlb(hass, modelSlug(plan.name), glb, (f) => onStage('uploading', f));
  return { url, stats };
}
