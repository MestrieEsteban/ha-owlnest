/**
 * sh3d-furniture.ts — les meubles d'un fichier Sweet Home 3D, rangés dans
 * « Mes meubles ».
 *
 * Chaque modèle de l'archive est un OBJ, seul ou dans un dossier avec ses
 * matières et ses textures. On le convertit en GLB dans le navigateur, avec ce
 * que Sweet Home 3D lui a appliqué (rotation, miroir, couleurs), puis on
 * l'envoie à l'intégration : un seul envoi par modèle, même posé dix fois.
 */

import type { PlanItem } from '../plan/types';
import { newId } from '../plan/graph';
import { objToGlb, parseMtl, fileKey, type ImportImage, type SimplifyFn } from './obj-to-glb';
import { modelSlug } from './plan';
import { uploadGlb, type UploadHass } from './upload';
import type { PendingItem, Sh3dPiece } from './sh3d-home';

/** Au-delà, un meuble est allégé : une plante de 40 000 triangles pèserait sur la tablette. */
export const HEAVY_FURNITURE = 8000;

/**
 * Les matières du catalogue Sweet Home 3D, citées par leur nom sans fichier
 * de matières (elles sont fournies par le logiciel). Leurs couleurs se lisent
 * dans leur nom ; ce qui reste inconnu prend un gris clair.
 */
const NAMED: [RegExp, [number, number, number], number?][] = [
  [/glass|verre|vitre|transp/i, [0.75, 0.85, 0.9], 0.35],
  [/mirror|miroir|chrome|silver|steel|metal/i, [0.75, 0.76, 0.78]],
  [/gold|brass|laiton/i, [0.8, 0.65, 0.3]],
  [/(dk|dark)\s*gr[ae]y/i, [0.3, 0.3, 0.3]],
  [/(lt|light)\s*gr[ae]y/i, [0.75, 0.75, 0.75]],
  [/black|noir/i, [0.08, 0.08, 0.08]],
  [/archwhite/i, [0.95, 0.91, 0.88]],
  [/white|blanc/i, [0.92, 0.92, 0.92]],
  [/gr[ae]y|gris/i, [0.55, 0.55, 0.55]],
  [/blonde/i, [0.82, 0.68, 0.48]],
  [/amber/i, [0.38, 0.29, 0.21]],
  [/brown|wood|bois|oak|walnut|marron/i, [0.45, 0.3, 0.18]],
  [/red|rouge/i, [0.7, 0.12, 0.1]],
  [/green|vert|leaf|leaves|plant/i, [0.25, 0.5, 0.22]],
  [/blue|bleu/i, [0.2, 0.35, 0.7]],
  [/yellow|jaune/i, [0.9, 0.8, 0.2]],
  [/orange/i, [0.9, 0.5, 0.15]],
  [/beige|sand|cream/i, [0.85, 0.78, 0.65]],
];

export function namedColor(name: string): { color: [number, number, number]; opacity: number } {
  for (const [re, color, opacity] of NAMED) if (re.test(name)) return { color, opacity: opacity ?? 1 };
  return { color: [0.8, 0.8, 0.8], opacity: 1 };
}

const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

/** Ce qui distingue deux versions d'un même modèle : on n'envoie qu'une fois chacune. */
export function variantKey(p: Sh3dPiece): string {
  return JSON.stringify([p.model, p.modelRotation ?? null, !!p.modelMirrored, p.color ?? null, p.materials]);
}

/**
 * Applique à l'OBJ la rotation et le miroir choisis dans Sweet Home 3D : le
 * GLB sort dans le sens où le meuble est dessiné, et notre chargeur n'a plus
 * qu'à le mettre aux dimensions.
 */
export function orientObj(obj: string, rotation?: number[], mirrored?: boolean): string {
  const m = rotation && rotation.length === 9 ? rotation : null;
  if (!m && !mirrored) return obj;
  const apply = (x: number, y: number, z: number): [number, number, number] => {
    let p: [number, number, number] = m
      ? [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z]
      : [x, y, z];
    if (mirrored) p = [-p[0], p[1], p[2]];
    return p;
  };
  return obj.replace(/^(v|vn)\s+(\S+)\s+(\S+)\s+(\S+)(.*)$/gm, (line, kind: string, a: string, b: string, c: string, rest: string) => {
    const [x, y, z] = [Number(a), Number(b), Number(c)];
    if (![x, y, z].every(Number.isFinite)) return line;
    const p = apply(x, y, z);
    return `${kind} ${p.map((v) => +v.toFixed(6)).join(' ')}${rest}`;
  });
}

/**
 * Le MTL à passer au convertisseur : celui du modèle quand il en a un, sinon
 * des matières devinées d'après leur nom. Une couleur imposée au meuble
 * remplace toutes les autres ; une couleur par matière, celle de la matière.
 */
export function buildMtl(obj: string, mtl: string | null, piece: Pick<Sh3dPiece, 'color' | 'materials'>): string {
  const used = [...new Set([...obj.matchAll(/^usemtl\s+(.+?)\s*$/gm)].map((m) => m[1]))];
  const known = parseMtl(mtl ?? '');
  const lines: string[] = [];
  for (const name of used.length ? used : ['default']) {
    const base = known.get(name);
    const override = piece.color ?? piece.materials[name];
    const named = namedColor(name);
    const color = override ? hexToRgb(override) : base?.color ?? named.color;
    const opacity = base?.opacity ?? named.opacity;
    lines.push(`newmtl ${name}`, `Kd ${color.map((v) => v.toFixed(4)).join(' ')}`, `d ${opacity}`);
    // Une couleur imposée efface la texture, comme dans Sweet Home 3D.
    if (!override && base?.map) lines.push(`map_Kd ${base.map}`);
  }
  return lines.join('\n');
}

/** Les fichiers d'un modèle : l'OBJ, son MTL et ses images, dans le même dossier de l'archive. */
export function modelFiles(zip: Record<string, Uint8Array>, entry: string): { obj: string; mtl: string | null; images: Map<string, ImportImage> } | null {
  const data = zip[entry];
  if (!data) return null;
  const dec = new TextDecoder();
  const obj = dec.decode(data);
  const dir = entry.includes('/') ? entry.slice(0, entry.lastIndexOf('/') + 1) : null;
  let mtl: string | null = null;
  const images = new Map<string, ImportImage>();
  if (dir) {
    const cited = obj.match(/^mtllib\s+(.+?)\s*$/m)?.[1];
    for (const [path, content] of Object.entries(zip)) {
      if (!path.startsWith(dir) || path === entry) continue;
      const lower = path.toLowerCase();
      if (lower.endsWith('.mtl') && (!mtl || (cited && fileKey(path) === fileKey(cited)))) mtl = dec.decode(content);
      else if (/\.jpe?g$/.test(lower)) images.set(fileKey(path), { data: content, mime: 'image/jpeg' });
      else if (lower.endsWith('.png')) images.set(fileKey(path), { data: content, mime: 'image/png' });
    }
  }
  return { obj, mtl, images };
}

export interface FurnitureImport {
  items: PlanItem[];
  library: { url: string; name: string }[];
  /** Meubles dont le modèle n'a pas pu être converti ou envoyé. */
  failed: number;
  /** Le niveau de chaque meuble de `items`, dans le même ordre. */
  floors: number[];
}

/**
 * Convertit et envoie les modèles, puis rend les meubles prêts à poser.
 * `simplify` allège les modèles lourds ; `onProgress` va de 0 à 1.
 */
export async function importSh3dFurniture(
  hass: UploadHass,
  zip: Record<string, Uint8Array>,
  pending: readonly PendingItem[],
  options: { simplify?: SimplifyFn; onProgress?: (f: number) => void } = {},
): Promise<FurnitureImport> {
  const variants = new Map<string, Sh3dPiece>();
  for (const it of pending) variants.set(variantKey(it.piece), it.piece);
  const urls = new Map<string, string>();
  const library: { url: string; name: string }[] = [];
  let done = 0;
  for (const [key, piece] of variants) {
    try {
      const files = modelFiles(zip, piece.model!);
      if (!files) throw new Error('missing model');
      const obj = orientObj(files.obj, piece.modelRotation, piece.modelMirrored);
      const mtl = buildMtl(obj, files.mtl, piece);
      const heavy = (obj.match(/^f\s/gm)?.length ?? 0) > HEAVY_FURNITURE;
      const { glb } = objToGlb(obj, mtl, files.images, heavy && options.simplify ? { simplify: options.simplify } : {});
      const name = piece.name || 'Meuble';
      const url = await uploadGlb(hass, modelSlug(`${name}-${done}`), new Uint8Array(glb));
      urls.set(key, url);
      library.push({ url, name });
    } catch (err) {
      console.warn('[Owlnest] Sweet Home 3D furniture skipped:', piece.name, err);
    }
    options.onProgress?.(++done / variants.size);
  }
  const items: PlanItem[] = [];
  const floors: number[] = [];
  let failed = 0;
  for (const it of pending) {
    const url = urls.get(variantKey(it.piece));
    if (!url) { failed++; continue; }
    floors.push(it.floor ?? 0);
    items.push({
      id: newId('i'), model: url, x: it.x, y: it.y, rotation: it.rotation,
      size: it.size, elevation: it.elevation,
      ...(it.piece.name ? { name: it.piece.name } : {}),
    });
  }
  return { items, library, failed, floors };
}
