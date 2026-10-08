/**
 * plan.ts — décider quoi faire de ce que l'utilisateur a glissé sur la carte.
 *
 * Il peut lâcher n'importe quoi : un GLB, le dossier exporté par Sweet Home 3D,
 * son contenu sélectionné en vrac, un zip. On ne lui demande pas de savoir
 * lequel est le bon : on trie ici, et on dit clairement ce qui manque.
 */

import { fileKey, type ImportImage } from './obj-to-glb';

/** Un fichier reçu, déjà lu. Le chemin garde les dossiers d'un zip ou d'un dépôt de dossier. */
export interface DroppedFile {
  path: string;
  data: Uint8Array;
}

export type ImportPlan =
  | { kind: 'glb'; name: string; glb: Uint8Array }
  | {
      kind: 'obj';
      name: string;
      obj: Uint8Array;
      mtl: Uint8Array | null;
      images: Map<string, ImportImage>;
    }
  | { kind: 'error'; reason: 'empty' | 'gltf-text' | 'no-model' };

const ext = (path: string) => (path.toLowerCase().match(/\.([a-z0-9]+)$/) ?? [])[1] ?? '';
const base = (path: string) => fileKey(path).replace(/\.[a-z0-9]+$/, '');

/**
 * Choisit le modèle à importer parmi les fichiers déposés.
 *
 * Un GLB l'emporte : il est déjà prêt. Sinon l'OBJ le plus lourd — un export en
 * contient un seul, mais un dossier de travail peut traîner des brouillons. Le
 * MTL retenu est celui que l'OBJ cite, à défaut celui qui porte son nom.
 */
export function planImport(files: readonly DroppedFile[]): ImportPlan {
  if (!files.length) return { kind: 'error', reason: 'empty' };

  const glbs = files.filter((f) => ext(f.path) === 'glb');
  if (glbs.length) {
    const glb = glbs.reduce((a, b) => (b.data.byteLength > a.data.byteLength ? b : a));
    return { kind: 'glb', name: base(glb.path), glb: glb.data };
  }

  const objs = files.filter((f) => ext(f.path) === 'obj');
  if (!objs.length) {
    // Un .gltf texte référence ses binaires par chemin : on ne sait pas le
    // reconstituer de façon fiable. On le dit plutôt que d'échouer en silence.
    if (files.some((f) => ext(f.path) === 'gltf')) return { kind: 'error', reason: 'gltf-text' };
    return { kind: 'error', reason: 'no-model' };
  }
  const obj = objs.reduce((a, b) => (b.data.byteLength > a.data.byteLength ? b : a));

  const mtls = files.filter((f) => ext(f.path) === 'mtl');
  const cited = mtllibOf(obj.data);
  const mtl =
    mtls.find((m) => cited && fileKey(m.path) === fileKey(cited)) ??
    mtls.find((m) => base(m.path) === base(obj.path)) ??
    mtls[0] ??
    null;

  const images = new Map<string, ImportImage>();
  for (const f of files) {
    const e = ext(f.path);
    if (e === 'jpg' || e === 'jpeg') images.set(fileKey(f.path), { data: f.data, mime: 'image/jpeg' });
    else if (e === 'png') images.set(fileKey(f.path), { data: f.data, mime: 'image/png' });
  }

  return { kind: 'obj', name: base(obj.path), obj: obj.data, mtl: mtl?.data ?? null, images };
}

/** Le `mtllib` déclaré en tête d'OBJ, lu sans décoder tout le fichier. */
function mtllibOf(obj: Uint8Array): string | null {
  // La directive est toujours dans les premières lignes : 4 Ko suffisent.
  const head = new TextDecoder().decode(obj.subarray(0, 4096));
  const m = head.match(/^mtllib\s+(.+?)\s*$/m);
  return m ? m[1] : null;
}

/**
 * Nom de fichier du modèle sur le serveur : lisible, sûr, et unique.
 *
 * Unique parce que Home Assistant garde un 404 en cache un mois : réutiliser un
 * nom après une erreur ferait échouer le chargement sans raison visible.
 */
export function modelSlug(name: string, now: Date = new Date()): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'maison';
  const stamp = now.toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  return `${slug}-${stamp}`;
}
