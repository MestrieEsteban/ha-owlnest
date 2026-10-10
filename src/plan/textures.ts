/**
 * plan/textures.ts — les matières des sols, dessinées au chargement.
 *
 * Pas d'image à télécharger : quelques traits sur un canevas suffisent à faire
 * un parquet, un carrelage, un béton ou une moquette. Le motif est en niveaux
 * clairs ; la couleur choisie pour le sol le teinte.
 */

import * as THREE from 'three';
import type { FloorMaterial, FacadeMaterial } from './types';

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

// ── Façades ───────────────────────────────────────────────────────────────

/** Mètres couverts par un motif de façade (largeur, hauteur identiques). */
export const FACADE_METERS: Record<Exclude<FacadeMaterial, 'smooth'>, number> = {
  render: 1.5,
  brick: 1.04,
  wood: 1.2,
  stone: 1.6,
};

/**
 * Le motif d'une façade : clair, la couleur choisie le teinte. Les briques et
 * les pierres se répètent sans couture, les lames du bardage sont horizontales.
 */
function drawFacade(kind: Exclude<FacadeMaterial, 'smooth'>): HTMLCanvasElement {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size, size);
  const r = rng(21);
  if (kind === 'render') {
    // Crépi : un grain fin, quelques gouttes plus marquées.
    noise(ctx, size, 34, 31, 2);
    noise(ctx, size, 22, 37, 4);
  } else if (kind === 'brick') {
    // 16 rangs de 6,5 cm sur 1,04 m, briques de 26 cm décalées d'une demie.
    const rows = 16, h = size / rows, cols = 4, w = size / cols;
    for (let i = 0; i < rows; i++) {
      const shift = i % 2 ? w / 2 : 0;
      for (let j = -1; j < cols; j++) {
        const v = Math.round(205 + r() * 50);
        ctx.fillStyle = `rgb(${v},${Math.round(v * 0.97)},${Math.round(v * 0.95)})`;
        ctx.fillRect(j * w + shift, i * h, w, h);
      }
    }
    noise(ctx, size, 26, 41, 2);
    // Les joints.
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    for (let i = 0; i < rows; i++) {
      ctx.fillRect(0, i * h, size, 3);
      const shift = i % 2 ? w / 2 : 0;
      for (let j = 0; j <= cols; j++) ctx.fillRect(j * w + shift - 1.5, i * h, 3, h);
    }
  } else if (kind === 'wood') {
    // Bardage : 8 lames de 15 cm, une ombre sous chaque recouvrement, du fil.
    const rows = 8, h = size / rows;
    for (let i = 0; i < rows; i++) {
      const v = Math.round(215 + r() * 35);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(0, i * h, size, h);
      ctx.strokeStyle = 'rgba(0,0,0,0.06)';
      for (let k = 0; k < 5; k++) {
        const y = i * h + 4 + r() * (h - 8);
        ctx.beginPath(); ctx.moveTo(0, y); ctx.bezierCurveTo(size / 3, y + 2, (2 * size) / 3, y - 2, size, y); ctx.stroke();
      }
      const g = ctx.createLinearGradient(0, i * h + h - 10, 0, i * h + h);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.32)');
      ctx.fillStyle = g;
      ctx.fillRect(0, i * h + h - 10, size, 10);
    }
  } else {
    // Pierre : des moellons de tailles variées, rang par rang, sur un joint clair.
    ctx.fillStyle = 'rgb(236,234,228)';
    ctx.fillRect(0, 0, size, size);
    const rows = 6, h = size / rows;
    for (let i = 0; i < rows; i++) {
      let x = -r() * 60;
      while (x < size) {
        const w = 70 + r() * 110;
        const v = Math.round(214 + r() * 34);
        for (const at of [x, x - size, x + size]) {
          ctx.fillStyle = `rgb(${v},${v},${Math.round(v * 0.97)})`;
          ctx.beginPath();
          // `roundRect` manque aux navigateurs d'avant 2023 (vieilles tablettes).
          if (typeof ctx.roundRect === 'function') ctx.roundRect(at + 3, i * h + 3, w - 6, h - 6, 10);
          else ctx.rect(at + 3, i * h + 3, w - 6, h - 6);
          ctx.fill();
        }
        x += w;
      }
    }
    noise(ctx, size, 18, 43, 2);
  }
  return c;
}

/** Le motif d'une façade, ou rien pour l'enduit lisse et hors navigateur. */
export function facadeTexture(kind: FacadeMaterial | undefined): THREE.Texture | null {
  if (!kind || kind === 'smooth' || typeof document === 'undefined') return null;
  const key = `facade:${kind}`;
  if (cache.has(key)) return cache.get(key)!;
  const tex = new THREE.CanvasTexture(drawFacade(kind));
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  cache.set(key, tex);
  return tex;
}
