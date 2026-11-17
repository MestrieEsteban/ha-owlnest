/**
 * bench.ts — le banc d'essai : un tour complet de caméra, toujours le même.
 *
 * Les images par seconde d'un tableau de bord dépendent de ce que la caméra
 * regarde. Pour comparer deux réglages, il faut la même trajectoire : 360°
 * autour de la cible, à distance et hauteur fixes, pendant une durée fixe, le
 * plafond d'images levé. On en tire la moyenne et le 95e centile du temps
 * d'image (les saccades, que la moyenne cache).
 */

import type { BenchResult } from './types';

export const BENCH_DURATION_MS = 10_000;

/** Statistiques d'une série de temps d'image, en millisecondes. */
export function frameStats(frames: number[]): { avgFps: number; p95FrameMs: number; worstFrameMs: number } {
  if (!frames.length) return { avgFps: 0, p95FrameMs: 0, worstFrameMs: 0 };
  const total = frames.reduce((s, f) => s + f, 0);
  const sorted = [...frames].sort((a, b) => a - b);
  const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
  return {
    avgFps: total > 0 ? (frames.length * 1000) / total : 0,
    p95FrameMs: p95,
    worstFrameMs: sorted[sorted.length - 1],
  };
}

/** Angle de la caméra (radians, depuis l'angle de départ) à l'instant `t`. */
export function orbitAngle(t: number, duration = BENCH_DURATION_MS): number {
  return (Math.min(Math.max(t, 0), duration) / duration) * Math.PI * 2;
}

/** Écart relatif d'une mesure à l'autre, pour l'affichage avant / après. */
export function benchDelta(before: BenchResult, after: BenchResult): { fps: number; p95: number; gpuMB: number; calls: number; triangles: number } {
  const rel = (a: number, b: number) => (a > 0 ? (b - a) / a : 0);
  return {
    fps: rel(before.avgFps, after.avgFps),
    p95: rel(before.p95FrameMs, after.p95FrameMs),
    gpuMB: after.gpuMB - before.gpuMB,
    calls: after.calls - before.calls,
    triangles: after.triangles - before.triangles,
  };
}

/** Le résultat en JSON, à télécharger et comparer d'un appareil à l'autre. */
export function benchJson(results: BenchResult[]): string {
  return JSON.stringify({ owlnest_bench: 1, results }, null, 2);
}
