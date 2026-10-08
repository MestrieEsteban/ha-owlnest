/**
 * sh3d-parts.ts — des vantaux reconnus à l'import aux ouvrants de la scène.
 *
 * L'import a déjà fait le travail difficile (voir sh3d.ts) : chaque vantail est
 * un nœud, avec le côté de ses gonds. Il reste à trier portes, fenêtres et
 * portes de meuble, et à écrire des ouvrants que l'utilisateur n'aura plus
 * qu'à relier à ses capteurs.
 */

import * as THREE from 'three';
import type { OwlnestPart } from '../types';
import { rankOf, meshRankOf, stampOrder } from '../model-outline';
import { LEAF_PREFIX, type Sh3dLeafExtras } from './sh3d';

export type LeafKind = 'door' | 'window' | 'furniture';

export interface LeafCandidate {
  node: string;
  nodeIndex: number;
  mesh: string;
  meshIndex: number;
  kind: LeafKind;
  /** Meuble d'origine : deux vantaux d'une même fenêtre partagent ce rang. */
  piece: number;
  info: Sh3dLeafExtras['owlnestLeaf'];
}

/**
 * Nature d'un vantail, d'après sa vitre et sa taille en centimètres.
 *
 * Une porte de placard a les mêmes gonds qu'une porte d'entrée : seule la
 * taille les sépare. Dans le doute, c'est un meuble, qu'on ne propose pas —
 * mieux vaut une porte oubliée que dix portes de cuisine à décocher.
 */
export function leafKind(info: Sh3dLeafExtras['owlnestLeaf'], unitToCm: number): LeafKind {
  const [height, width] = info.size.map((v) => v * unitToCm);
  if (info.pane && height > 40) return 'window';
  if (height > 170 && height < 260 && width > 50 && width < 140) return 'door';
  return 'furniture';
}

/**
 * Centimètres par unité du modèle.
 *
 * Sweet Home 3D exporte en centimètres ; un modèle repassé par un autre outil
 * peut être en mètres. Une maison faisant de 5 à 50 m, l'envergure suffit à
 * trancher.
 */
export function unitToCmOf(span: number): number {
  return span > 200 ? 1 : 100;
}

/** Vantaux du modèle chargé, dans l'ordre de l'export. */
export function findLeaves(root: THREE.Object3D, span: number): LeafCandidate[] {
  stampOrder(root);
  const unit = unitToCmOf(span);
  const out: LeafCandidate[] = [];
  root.traverse((o) => {
    const info = (o.userData as Partial<Sh3dLeafExtras>).owlnestLeaf;
    if (!info || !o.name.startsWith(LEAF_PREFIX)) return;
    const nodeIndex = rankOf(o);
    let mesh: THREE.Mesh | null = null;
    o.traverse((c) => { if (!mesh && (c as THREE.Mesh).isMesh) mesh = c as THREE.Mesh; });
    const m = mesh as THREE.Mesh | null;
    const meshIndex = m ? meshRankOf(m) : undefined;
    if (nodeIndex === undefined || !m || meshIndex === undefined) return;
    const piece = Number(o.name.slice(LEAF_PREFIX.length).split('_')[0]);
    out.push({ node: o.name, nodeIndex, mesh: m.name, meshIndex, kind: leafKind(info, unit), piece, info });
  });
  return out;
}

/**
 * Les ouvrants à proposer : portes et fenêtres pas encore dans la scène.
 *
 * Les libellés numérotent par nature (« Porte 2 », « Fenêtre 3 ») ; les
 * vantaux d'une même fenêtre gardent le même numéro, pour qu'on les relie au
 * même capteur sans réfléchir.
 */
export function proposeParts(
  leaves: readonly LeafCandidate[],
  existing: readonly OwlnestPart[],
  label: (kind: 'door' | 'window', n: number, leaf: number, leaves: number) => string,
  now: number = Date.now(),
): { part: OwlnestPart; kind: 'door' | 'window'; piece: number }[] {
  const taken = new Set(existing.map((p) => p.node).filter(Boolean));
  const wanted = leaves.filter((l) => l.kind !== 'furniture');

  const count = { door: 0, window: 0 };
  const numberOf = new Map<string, number>();
  const leavesOf = new Map<string, LeafCandidate[]>();
  for (const l of wanted) {
    const key = `${l.kind}:${l.piece}`;
    if (!numberOf.has(key)) numberOf.set(key, ++count[l.kind as 'door' | 'window']);
    leavesOf.set(key, [...(leavesOf.get(key) ?? []), l]);
  }

  return wanted
    .filter((l) => !taken.has(l.node))
    .map((l, i) => {
      const kind = l.kind as 'door' | 'window';
      const key = `${kind}:${l.piece}`;
      const siblings = leavesOf.get(key) ?? [l];
      const part: OwlnestPart = {
        id: `part_${now}_${i}`,
        entity: '',
        mesh: l.mesh,
        meshIndex: l.meshIndex,
        triangle: 0,
        node: l.node,
        nodeIndex: l.nodeIndex,
        // Le nœud contient déjà poignée et vitre : rien d'autre à emmener.
        carry: false,
        label: label(kind, numberOf.get(key)!, siblings.indexOf(l) + 1, siblings.length),
        motion: l.info.motion === 'rail' ? 'slide' : 'swing',
        hinge: l.info.hinge,
        angle: 90,
        slide: l.info.hinge,
        travel: 0.9,
        duration: 1.2,
      };
      return { part, kind, piece: l.piece };
    });
}
