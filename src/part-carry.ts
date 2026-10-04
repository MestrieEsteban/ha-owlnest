/**
 * part-carry.ts — les pièces qu'un ouvrant emmène avec lui.
 *
 * Un modeleur n'a aucune raison de souder la poignée au vantail, ni de les
 * grouper : sur un export SweetHome3D la hiérarchie est plate — un seul groupe,
 * des centaines de mailles sœurs. Rien, dans le graphe, ne dit qu'une poignée
 * appartient à une porte.
 *
 * Ce qui le dit, c'est l'espace. Une poignée se tient **dans** le volume du
 * vantail ; un dormant, lui, le déborde — c'est ce qui le rend fixe. Le critère
 * de contenance sépare donc naturellement ce qui tourne de ce qui tient le
 * cadre, sans nommage ni retouche du modèle.
 *
 * La recherche porte sur les **composantes**, pas sur les mailles. Un export
 * réel réunit sous une même maille toutes les poignées d'un étage : sa boîte
 * englobante traverse le logement entier et ne contiendrait jamais rien.
 */

import * as THREE from 'three';
import { partIndexOf, type MeshPart } from './parts';

/** Marge de contenance, en fraction de la plus grande dimension de l'ouvrant. */
export const CARRY_MARGIN = 0.08;

/** Au-delà de cette fraction de l'ouvrant, une pièce n'est plus un accessoire. */
export const CARRY_MAX_SPAN = 0.3;

/**
 * Cette pièce est-elle emmenée par l'ouvrant ?
 *
 * Deux conditions, et la contenance est la plus importante : une pièce qui
 * déborde reste en place. Le dormant d'une porte dépasse toujours du vantail,
 * la poignée jamais.
 *
 * @param part      boîte de l'ouvrant, dans le même repère que `candidate`
 * @param candidate boîte de la pièce examinée
 */
export function carries(part: THREE.Box3, candidate: THREE.Box3): boolean {
  if (part.isEmpty() || candidate.isEmpty()) return false;

  const span = part.getSize(new THREE.Vector3());
  const largest = Math.max(span.x, span.y, span.z);
  if (largest <= 0) return false;

  // La marge absorbe une poignée qui dépasse de part et d'autre du vantail, et
  // les écarts de l'export ; elle reste proportionnelle pour valoir quelle que
  // soit l'unité du modèle.
  const room = part.clone().expandByScalar(largest * CARRY_MARGIN);
  if (!room.containsBox(candidate)) return false;

  // Une pièce aussi grande que l'ouvrant n'en est pas un accessoire : c'est le
  // vantail voisin, ou le panneau lui-même vu depuis une autre maille.
  const size = candidate.getSize(new THREE.Vector3());
  return size.length() < largest * CARRY_MAX_SPAN;
}

/** Une composante emmenée, et de quoi la détacher. */
export interface CarryPiece {
  mesh: THREE.Mesh;
  part: MeshPart;
  /** Boîte dans le repère du monde, celle qui a décidé. */
  box: THREE.Box3;
  /** Identifiant stable, pour qu'un décochage survive au rechargement. */
  name: string;
}

/** Nom d'une composante : la maille, puis son rang dans celle-ci. */
export function carryName(mesh: THREE.Mesh, part: MeshPart): string {
  return `${mesh.name || 'mesh'}#${part.id}`;
}

/**
 * Composantes du modèle qu'un ouvrant doit emmener.
 *
 * On ignore l'hôte et sa descendance : la pièce extraite vit déjà sous lui, et
 * se reprendre soi-même ferait tourner le vantail deux fois.
 *
 * @param partBox boîte de l'ouvrant, dans le repère du monde
 * @param exclude noms de composantes que l'utilisateur a décochées
 */
export function findCarried(
  root: THREE.Object3D,
  partBox: THREE.Box3,
  host: THREE.Object3D,
  exclude: readonly string[] = [],
): CarryPiece[] {
  const found: CarryPiece[] = [];
  const skipped = new Set(exclude);
  root.updateMatrixWorld(true);

  // Une maille dont la boîte ne touche pas l'ouvrant n'a aucune composante à
  // l'intérieur : on s'épargne d'indexer ses triangles.
  const reach = partBox.clone().expandByScalar(
    Math.max(...partBox.getSize(new THREE.Vector3()).toArray()) * CARRY_MARGIN,
  );

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || mesh === host || isWithin(mesh, host)) return;
    if (!reach.intersectsBox(new THREE.Box3().setFromObject(mesh))) return;

    for (const part of partIndexOf(mesh).parts) {
      const name = carryName(mesh, part);
      if (skipped.has(name)) continue;
      const box = part.box.clone().applyMatrix4(mesh.matrixWorld);
      if (carries(partBox, box)) found.push({ mesh, part, box, name });
    }
  });

  return found;
}

/** `obj` est-il l'hôte ou l'un de ses descendants ? */
function isWithin(obj: THREE.Object3D, host: THREE.Object3D): boolean {
  for (let n: THREE.Object3D | null = obj; n; n = n.parent) if (n === host) return true;
  return false;
}
