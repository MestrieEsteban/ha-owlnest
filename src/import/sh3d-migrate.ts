/**
 * sh3d-migrate.ts — passer d'une maison importée en OBJ au même logement
 * importé en `.sh3d`, sans perdre ce qu'on y avait posé.
 *
 * Avant le `.sh3d`, on importait l'export OBJ de Sweet Home 3D : un modèle en
 * centimètres, recentré dans la scène. Les ancres, les vues et les ouvrants
 * sont posés dans ce repère. Le plan importé du `.sh3d` vit dans un autre :
 * des mètres, centrés sur le plan. Pour que tout reste à sa place, on retrouve
 * comment l'ancien modèle était placé par rapport aux murs du `.sh3d`, en
 * comparant leurs boîtes : l'export OBJ garde les coordonnées de Sweet Home 3D,
 * à un changement d'axes près si le fichier est passé par Blender.
 *
 * Pur : ni three.js ni carte, pour les tests.
 */

export type Vec3 = [number, number, number];
export interface Box { min: Vec3; max: Vec3 }

/**
 * Comment un point de Sweet Home 3D (x, y du plan, hauteur ; en cm) se place
 * dans le repère de l'ancien modèle : chaque axe du modèle reprend un axe de
 * Sweet Home 3D, éventuellement retourné, à une échelle près.
 */
export interface Sh3dFit {
  /** Pour chaque axe du modèle : l'axe Sweet Home 3D (0 = x, 1 = y, 2 = hauteur) et son signe. */
  axes: [number, number, number];
  signs: [number, number, number];
  scale: number;
  offset: Vec3;
  /** Écart relatif entre les boîtes une fois recalées : 0 = parfait. */
  error: number;
}

/** Les rangements d'axes plausibles : Y en haut (export direct), Z en haut (passé par Blender). */
const LAYOUTS: { axes: [number, number, number]; signs: [number, number, number] }[] = [
  { axes: [0, 2, 1], signs: [1, 1, 1] },
  { axes: [0, 1, 2], signs: [1, -1, 1] },
  { axes: [0, 1, 2], signs: [1, 1, 1] },
  { axes: [0, 2, 1], signs: [1, 1, -1] },
];

const size = (b: Box): Vec3 => [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];

/**
 * Le recalage qui fait coïncider la boîte des murs Sweet Home 3D (`home`, en
 * cm : x, y du plan, hauteur) avec celle des murs de l'ancien modèle
 * (`model`). Rend `null` si aucun rangement d'axes ne colle à 5 % près : ce
 * n'est alors pas le même logement, ou pas le même étage.
 */
export function fitSh3d(home: Box, model: Box): Sh3dFit | null {
  const hs = size(home), ms = size(model);
  let best: Sh3dFit | null = null;
  for (const { axes, signs } of LAYOUTS) {
    // L'échelle, d'après les deux axes horizontaux (les plus grands, les plus sûrs).
    const horiz = [0, 1, 2].filter((i) => axes[i] !== 2);
    const ratios = horiz.map((i) => ms[i] / Math.max(hs[axes[i]], 1e-9));
    const scale = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    if (!(scale > 0)) continue;
    let error = 0;
    for (let i = 0; i < 3; i++) error = Math.max(error, Math.abs(ms[i] - hs[axes[i]] * scale) / Math.max(ms[i], 1e-9));
    const offset = [0, 1, 2].map((i) => {
      const lo = signs[i] > 0 ? home.min[axes[i]] : -home.max[axes[i]];
      return model.min[i] - lo * scale;
    }) as Vec3;
    if (!best || error < best.error) best = { axes, signs, scale, offset, error };
  }
  return best && best.error < 0.05 ? best : null;
}

/** Point Sweet Home 3D (cm) → repère de l'ancien modèle. */
export function toModel(fit: Sh3dFit, p: Vec3): Vec3 {
  return [0, 1, 2].map((i) => fit.signs[i] * p[fit.axes[i]] * fit.scale + fit.offset[i]) as Vec3;
}

/** Repère de l'ancien modèle → point Sweet Home 3D (cm). */
export function fromModel(fit: Sh3dFit, q: Vec3): Vec3 {
  const p: Vec3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) p[fit.axes[i]] = ((q[i] - fit.offset[i]) / fit.scale) * fit.signs[i];
  return p;
}

/** Une direction (lumière orientée) : seuls les axes et leurs signes comptent. */
export function directionFromModel(fit: Sh3dFit, d: Vec3): Vec3 {
  const p: Vec3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) p[fit.axes[i]] = d[i] * fit.signs[i];
  return p;
}

/**
 * Le passage complet d'une position de l'ancienne scène à la nouvelle.
 * `oldRoot` : décalage de l'ancien modèle dans la scène (son recentrage) ;
 * `newRoot` : celui du nouveau plan. Le plan est en mètres, la hauteur en y.
 */
export function makeMover(fit: Sh3dFit, oldRoot: Vec3, newRoot: Vec3) {
  const point = (p: Vec3): Vec3 => {
    const [x, y, h] = fromModel(fit, [p[0] - oldRoot[0], p[1] - oldRoot[1], p[2] - oldRoot[2]]);
    return [x / 100 + newRoot[0], h / 100 + newRoot[1], y / 100 + newRoot[2]];
  };
  const direction = (d: Vec3): Vec3 => {
    const [x, y, h] = directionFromModel(fit, d);
    return [x, h, y];
  };
  return { point, direction };
}

/**
 * Associe chaque ancien ouvrant au nouveau vantail le plus proche (dans le
 * repère de la nouvelle scène), sans en prendre deux pour le même. Au-delà
 * de `reach`, l'ancien ouvrant n'a pas d'équivalent.
 */
export function matchNearest<T, U>(
  olds: readonly { item: T; at: Vec3 }[],
  news: readonly { item: U; at: Vec3 }[],
  reach: number,
): Map<T, U> {
  const pairs: { o: number; n: number; d: number }[] = [];
  olds.forEach((o, i) => news.forEach((n, j) => {
    const d = Math.hypot(o.at[0] - n.at[0], o.at[1] - n.at[1], o.at[2] - n.at[2]);
    if (d <= reach) pairs.push({ o: i, n: j, d });
  }));
  pairs.sort((a, b) => a.d - b.d);
  const out = new Map<T, U>();
  const usedO = new Set<number>(), usedN = new Set<number>();
  for (const p of pairs) {
    if (usedO.has(p.o) || usedN.has(p.n)) continue;
    usedO.add(p.o); usedN.add(p.n);
    out.set(olds[p.o].item, news[p.n].item);
  }
  return out;
}
