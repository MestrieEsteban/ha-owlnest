/**
 * lighten.ts — alléger un plan pour une tablette murale.
 *
 * Dans un export meublé, ce sont les textures qui pèsent : une photo de
 * parquet en 4096 px coûte seize fois la mémoire de la même en 1024, pour une
 * différence invisible à la distance où l'on regarde une maquette. On ne
 * touche qu'à elles : la géométrie, donc les ouvrants et les ancres, reste
 * exactement la même.
 *
 * C'est une option, proposée seulement quand elle sert, et jamais imposée.
 */

import type { ImportImage } from './obj-to-glb';

/** Côté maximal d'une texture allégée, en pixels. */
export const MAX_TEXTURE = 1024;

export interface TextureInfo {
  width: number;
  height: number;
  bytes: number;
}

export interface LightenEstimate {
  /** Textures plus grandes que `MAX_TEXTURE`, celles qu'on réduirait. */
  heavy: number;
  /** Poids des textures aujourd'hui, en octets. */
  before: number;
  /** Poids estimé après réduction, en octets. */
  after: number;
}

/**
 * Gain attendu, sans rien réduire.
 *
 * Une image compressée pèse à peu près en proportion de ses pixels : diviser
 * le côté par deux divise le poids par quatre. Assez juste pour annoncer un
 * ordre de grandeur, ce qu'on fait (« environ »).
 */
export function estimateLighten(textures: Iterable<TextureInfo>, max = MAX_TEXTURE): LightenEstimate {
  let heavy = 0, before = 0, after = 0;
  for (const t of textures) {
    before += t.bytes;
    const side = Math.max(t.width, t.height);
    if (side > max) {
      heavy++;
      after += t.bytes * (max / side) ** 2;
    } else {
      after += t.bytes;
    }
  }
  return { heavy, before, after: Math.round(after) };
}

/** Dimensions d'une image, sans la garder décodée. */
export async function measureImage(img: ImportImage): Promise<TextureInfo | null> {
  try {
    const bmp = await createImageBitmap(new Blob([img.data as BlobPart], { type: img.mime }));
    const info = { width: bmp.width, height: bmp.height, bytes: img.data.byteLength };
    bmp.close();
    return info;
  } catch {
    // Une image illisible ici le sera aussi au rendu : on la laisse telle quelle.
    return null;
  }
}

/**
 * Réduit une image à `max` pixels de côté, proportions gardées.
 *
 * Un PNG reste un PNG : il porte souvent une transparence (feuillage, rideau)
 * que le JPEG perdrait. Le reste repasse en JPEG de bonne qualité.
 */
export async function downscaleImage(img: ImportImage, info: TextureInfo, max = MAX_TEXTURE): Promise<ImportImage> {
  const side = Math.max(info.width, info.height);
  if (side <= max) return img;
  const k = max / side;
  const w = Math.max(1, Math.round(info.width * k));
  const h = Math.max(1, Math.round(info.height * k));
  const bmp = await createImageBitmap(new Blob([img.data as BlobPart], { type: img.mime }), {
    resizeWidth: w, resizeHeight: h, resizeQuality: 'high',
  });
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0);
  bmp.close();
  const blob = await canvas.convertToBlob(
    img.mime === 'image/png' ? { type: 'image/png' } : { type: 'image/jpeg', quality: 0.85 },
  );
  const data = new Uint8Array(await blob.arrayBuffer());
  // Une réduction qui ne gagne rien (petite image déjà très compressée) ne sert à rien.
  return data.byteLength < img.data.byteLength ? { data, mime: img.mime } : img;
}

/** Ce que l'allègement changerait, pour le proposer en connaissance de cause. */
export interface LightenOffer {
  textures: LightenEstimate;
  geometry: GeometryEstimate;
}

/**
 * Un plan sous ce nombre de triangles tourne bien sur une tablette : on ne
 * propose pas de simplifier, même s'il contient quelques objets denses.
 */
export const HEAVY_PLAN = 150_000;

/** L'allègement vaut-il la peine d'être proposé ? */
export function worthOffering(offer: LightenOffer): boolean {
  return offer.textures.heavy > 0 || (offer.geometry.before > HEAVY_PLAN && offer.geometry.dense > 0);
}

// ── Géométrie ──────────────────────────────────────────────────────────────

/**
 * Part des triangles gardée sur un objet simplifié.
 *
 * Un quart suffit : les objets visés sont de petits décors (vaisselle,
 * plantes, robinets) modélisés pour un rendu photo, vus ici à plusieurs mètres.
 */
export const KEEP_RATIO = 0.25;

/** En dessous, un objet est déjà léger : le simplifier ne rapporterait rien. */
export const DENSE_TRIANGLES = 1500;

/**
 * Écart toléré, en fraction de la taille de l'objet : 1 %, soit 2 mm sur une
 * assiette. La simplification s'arrête avant, quitte à garder plus d'un quart.
 */
export const MAX_ERROR = 0.01;

/**
 * Ce qu'on ne simplifie jamais : la maison elle-même et ce qui s'anime.
 *
 * Murs, sols et pièces portent les ancres et l'éclairage ; portes, fenêtres et
 * leurs gonds deviennent des ouvrants, dont la forme doit rester exacte.
 */
export function isProtected(group: string): boolean {
  return /^(wall|room|ground|floor|ceiling|level)|^sweethome3d_|frame/i.test(group);
}

export function shouldSimplify(group: string, triangles: number): boolean {
  return triangles >= DENSE_TRIANGLES && !isProtected(group);
}

export interface GeometryEstimate {
  /** Triangles du plan, tels qu'exportés. */
  before: number;
  /** Triangles dans des objets qu'on simplifierait. */
  dense: number;
  /** Ordre de grandeur après simplification. */
  after: number;
}

/**
 * Compte les triangles de chaque groupe d'un OBJ, sans le convertir.
 *
 * Une face à n sommets fait n - 2 triangles : on compte les sommets de la
 * ligne. Lecture rapide, ligne par ligne, comme le convertisseur.
 */
export function estimateGeometry(objText: string): GeometryEstimate {
  const perGroup = new Map<string, number>();
  let group = 'default';
  let count = 0;
  let start = 0;
  const flush = () => { if (count) perGroup.set(group, (perGroup.get(group) ?? 0) + count); count = 0; };
  while (start < objText.length) {
    let end = objText.indexOf('\n', start);
    if (end < 0) end = objText.length;
    const c0 = objText.charCodeAt(start), c1 = objText.charCodeAt(start + 1);
    if (c0 === 102 /* f */ && c1 === 32) {
      let corners = 0;
      let inToken = false;
      for (let i = start + 2; i < end; i++) {
        const ch = objText.charCodeAt(i);
        const space = ch === 32 || ch === 9 || ch === 13;
        if (!space && !inToken) corners++;
        inToken = !space;
      }
      if (corners >= 3) count += corners - 2;
    } else if ((c0 === 103 /* g */ || c0 === 111 /* o */) && c1 === 32) {
      flush();
      group = objText.slice(start + 2, end).trim();
    }
    start = end + 1;
  }
  flush();

  let before = 0, dense = 0;
  for (const [name, n] of perGroup) {
    before += n;
    if (shouldSimplify(name, n)) dense += n;
  }
  return { before, dense, after: Math.round(before - dense * (1 - KEEP_RATIO)) };
}

/**
 * Prépare la simplification, à passer au convertisseur.
 *
 * meshoptimizer repère lui-même les coutures de texture (sommets doublés à la
 * même position) et ne les ouvre pas : pas de fente sur les objets simplifiés.
 */
export async function makeSimplifier(): Promise<(group: string, idx: number[], pos: number[]) => number[] | null> {
  const { MeshoptSimplifier } = await import('meshoptimizer/simplifier');
  await MeshoptSimplifier.ready;
  return (group, idx, pos) => {
    if (!shouldSimplify(group, idx.length / 3)) return null;
    const target = Math.max(3, Math.floor((idx.length * KEEP_RATIO) / 3) * 3);
    const [out] = MeshoptSimplifier.simplify(
      new Uint32Array(idx), new Float32Array(pos), 3, target, MAX_ERROR,
    );
    return Array.from(out);
  };
}
