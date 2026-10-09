/**
 * plan/textures.ts — les matières des sols, dessinées au chargement.
 *
 * Pas d'image à télécharger : quelques traits sur un canevas suffisent à faire
 * un parquet, un carrelage, un béton ou une moquette. Le motif est en niveaux
 * clairs ; la couleur choisie pour le sol le teinte.
 */

import * as THREE from 'three';
import type { FloorMaterial } from './types';

/** Mètres couverts par un motif : le parquet a des lames de 20 cm, etc. */
export const TEXTURE_METERS: Record<Exclude<FloorMaterial, 'plain'>, number> = {
  wood: 2,
  tiles: 1.2,
  concrete: 3,
  carpet: 1,
};

const cache = new Map<string, THREE.Texture | null>();

/** Tirage pseudo-aléatoire stable : le parquet est le même à chaque chargement. */
function rng(seed: number) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

function noise(ctx: CanvasRenderingContext2D, size: number, amount: number, seed: number, dot = 1) {
  const r = rng(seed);
  for (let i = 0; i < (size * size) / (dot * dot) / 3; i++) {
    const v = Math.round(255 - r() * amount);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(r() * size, r() * size, dot, dot);
  }
}

function draw(kind: Exclude<FloorMaterial, 'plain'>): HTMLCanvasElement {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size, size);
  const r = rng(7);
  if (kind === 'wood') {
    // Dix lames de 20 cm, coupées à des longueurs variées. Chaque rangée fait
    // exactement la largeur du motif, et une lame qui déborde à droite est
    // redessinée à gauche : le motif se répète sans couture tous les 2 m.
    const rows = 10, h = size / rows;
    for (let i = 0; i < rows; i++) {
      const widths: number[] = [];
      let total = 0;
      while (total < size) {
        const w = size * (0.45 + r() * 0.55);
        widths.push(w);
        total += w;
      }
      // La dernière lame absorbe l'écart ; trop courte, elle rejoint la précédente.
      const excess = total - size;
      widths[widths.length - 1] -= excess;
      if (widths.length > 1 && widths[widths.length - 1] < size * 0.2) widths[widths.length - 2] += widths.pop()!;
      let x = r() * size;
      for (const w of widths) {
        const v = Math.round(222 + r() * 33);
        const veins = Array.from({ length: 4 }, () => i * h + r() * h);
        for (const at of [x, x - size]) {
          ctx.fillStyle = `rgb(${v},${v},${v})`;
          ctx.fillRect(at, i * h, w, h);
          ctx.strokeStyle = 'rgba(0,0,0,0.05)';
          for (const y of veins) {
            ctx.beginPath(); ctx.moveTo(at, y); ctx.bezierCurveTo(at + w / 3, y + 3, at + (2 * w) / 3, y - 3, at + w, y); ctx.stroke();
          }
          ctx.fillStyle = 'rgba(0,0,0,0.28)';
          ctx.fillRect(at, i * h, 2, h);
        }
        x += w;
      }
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(0, i * h, size, 2);
    }
  } else if (kind === 'tiles') {
    const n = 2, s = size / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const v = Math.round(238 + r() * 17);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(i * s, j * s, s, s);
    }
    noise(ctx, size, 18, 3);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    for (let i = 0; i < n; i++) { ctx.fillRect(i * s, 0, 4, size); ctx.fillRect(0, i * s, size, 4); }
  } else if (kind === 'concrete') {
    noise(ctx, size, 40, 5, 2);
    noise(ctx, size, 25, 9, 6);
  } else {
    noise(ctx, size, 55, 11, 1);
    noise(ctx, size, 30, 13, 2);
  }
  return c;
}

/** Le motif d'un sol, ou rien hors navigateur (tests). */
export function floorTexture(kind: FloorMaterial | undefined): THREE.Texture | null {
  if (!kind || kind === 'plain' || typeof document === 'undefined') return null;
  if (cache.has(kind)) return cache.get(kind)!;
  const tex = new THREE.CanvasTexture(draw(kind));
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  cache.set(kind, tex);
  return tex;
}
