/**
 * protected.ts — ce que l'optimiseur ne doit pas casser.
 *
 * La scène retrouve ses objets par leur nom, et parfois par un triangle :
 * l'hôte d'une lampe, la pièce d'un ouvrant, la cible d'un effet. Fusionner,
 * renommer ou instancier un tel objet le rend introuvable ; le simplifier
 * déplace ses triangles, et l'ouvrant emporterait la mauvaise pièce.
 *
 * La liste se déduit de la scène elle-même, jamais d'une saisie : c'est elle
 * qui sait ce qu'elle désigne.
 */

import type { OwlnestScene } from '../types';
import type { ProtectSpec } from './types';

/** Le nom que three.js donne à un nœud glTF (`PropertyBinding.sanitizeNodeName`). */
export function sanitizeName(name: string): string {
  return name.replace(/\s/g, '_').replace(/[[\].:/]/g, '');
}

/** Tout ce que désigne une scène. */
export function protectFromScene(scene: Partial<OwlnestScene> | null | undefined, keep: string[] = []): ProtectSpec {
  const names = new Set<string>();
  const geometry = new Set<string>();
  const add = (n: string | undefined) => { if (n) names.add(n); };
  const tri = (mesh: string | undefined, triangle: number | undefined) => {
    if (!mesh) return;
    names.add(mesh);
    if (triangle !== undefined) geometry.add(mesh);
  };

  for (const a of scene?.anchors ?? []) {
    tri(a.lightMesh, a.lightTriangle);
    for (const h of a.lightMeshes ?? []) tri(h.mesh, h.triangle);
  }
  for (const p of scene?.parts ?? []) {
    tri(p.mesh, p.triangle);
    add(p.node);
    for (const e of p.extra ?? []) tri(e.mesh, e.triangle);
    for (const f of p.followers ?? []) add(f.node);
    for (const n of p.carryExclude ?? []) add(n);
  }
  for (const e of scene?.effects ?? []) {
    tri(e.mesh, e.triangle);
    add(e.node);
    for (const tg of e.targets ?? []) { tri(tg.mesh, tg.triangle); add(tg.node); }
  }
  return {
    names: [...names].sort(),
    geometry: [...geometry].sort(),
    // Les ancres de l'ancien format sont des nœuds vides nommés dans Blender.
    patterns: ['^ha_anchor_', ...keep],
  };
}

export type Protection = 'name' | 'geometry' | null;

/**
 * Le test de protection d'un nom d'origine (glTF), à partir de la spécification.
 *
 * three.js rend uniques les noms en double par un suffixe `_1`, `_2` : une
 * scène qui désigne `Lampe_2` protège donc le nœud glTF `Lampe`. Protéger un
 * homonyme de trop ne coûte qu'un peu de gain ; en oublier un casse la scène.
 */
export function protectionMatcher(spec: ProtectSpec): (...rawNames: (string | undefined)[]) => Protection {
  const base = (n: string) => n.replace(/_\d+$/, '');
  const names = new Set<string>();
  const geometry = new Set<string>();
  // Les noms de la scène sont ceux de three.js ; on accepte aussi un nom brut.
  for (const raw of spec.names) { const n = sanitizeName(raw); names.add(n); names.add(base(n)); }
  for (const raw of spec.geometry) { const n = sanitizeName(raw); geometry.add(n); geometry.add(base(n)); }
  const patterns = spec.patterns.flatMap((p) => {
    try { return [new RegExp(p, 'i')]; } catch { return []; }
  });
  return (...rawNames) => {
    let found: Protection = null;
    for (const raw of rawNames) {
      if (!raw) continue;
      const s = sanitizeName(raw);
      if (geometry.has(s)) return 'geometry';
      if (names.has(s) || patterns.some((re) => re.test(raw) || re.test(s))) found = 'name';
    }
    return found;
  };
}

/** Motifs saisis par l'utilisateur, sans casse ; un motif invalide est ignoré. */
export function compilePatterns(patterns: readonly string[] | string | undefined): RegExp[] {
  const list = typeof patterns === 'string' ? patterns.split(/[,\n]/) : patterns ?? [];
  return list.map((p) => p.trim()).filter(Boolean).flatMap((p) => {
    try { return [new RegExp(p, 'i')]; } catch { return []; }
  });
}
