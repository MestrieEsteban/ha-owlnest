/**
 * plan/parts.ts — les ouvrants d'un plan dessiné, tenus à jour avec lui.
 *
 * Une porte posée dans l'éditeur est un ouvrant : on connaît ses gonds, son
 * sens, sa taille. Rien à détecter, rien à proposer. Le plan reste la source :
 * déplacer la porte ou changer le côté des gonds met l'ouvrant à jour, et ce
 * que l'utilisateur a réglé lui-même (capteur, couleurs, durée) est gardé.
 */

import * as THREE from 'three';
import type { OwlnestPart } from '../types';
import type { PlanDoc } from './types';
import { PLAN_LEAF } from './build';
import { rankOf, meshRankOf, stampOrder } from '../model-outline';

type LeafInfo = { motion: 'hinge' | 'rail'; hinge: 'start' | 'end'; pane: boolean };

export function syncPlanParts(
  root: THREE.Object3D,
  plan: PlanDoc,
  existing: readonly OwlnestPart[],
  label: (kind: 'door' | 'window' | 'slider', n: number, leaf: number, leaves: number) => string,
  now: number = Date.now(),
): OwlnestPart[] {
  stampOrder(root);
  const byNode = new Map(existing.filter((p) => p.node?.startsWith(PLAN_LEAF)).map((p) => [p.node!, p]));
  const kept = existing.filter((p) => !p.node?.startsWith(PLAN_LEAF));

  // Numérotation par nature, dans l'ordre du plan : « Porte 1 », « Fenêtre 2 ».
  const count = { door: 0, window: 0, slider: 0 };
  const numberOf = new Map<string, number>();
  for (const o of plan.openings) numberOf.set(o.id, ++count[o.kind]);

  const leaves: { node: THREE.Object3D; info: LeafInfo; opening: string }[] = [];
  root.traverse((o) => {
    const info = o.userData.owlnestLeaf as LeafInfo | undefined;
    if (info && o.name.startsWith(PLAN_LEAF)) leaves.push({ node: o, info, opening: o.userData.owlnestPlanOpening });
  });

  const out = [...kept];
  leaves.forEach((l, i) => {
    const opening = plan.openings.find((o) => o.id === l.opening);
    if (!opening) return;
    let mesh: THREE.Mesh | null = null;
    l.node.traverse((c) => { if (!mesh && (c as THREE.Mesh).isMesh) mesh = c as THREE.Mesh; });
    const m = mesh as THREE.Mesh | null;
    const nodeIndex = rankOf(l.node);
    if (!m || nodeIndex === undefined) return;

    const siblings = leaves.filter((x) => x.opening === l.opening);
    const target = {
      mesh: m.name, meshIndex: meshRankOf(m), triangle: 0,
      node: l.node.name, nodeIndex,
      carry: false,
      motion: l.info.motion === 'rail' ? 'slide' as const : 'swing' as const,
      hinge: l.info.hinge,
      slide: l.info.hinge,
      swingSide: opening.swing,
    };
    const before = byNode.get(l.node.name);
    out.push(before
      // Gardé : capteur, nom, couleurs, durée… La géométrie suit le plan.
      ? { ...before, ...target }
      : {
          id: `part_${now}_${i}`,
          entity: '',
          label: label(opening.kind, numberOf.get(opening.id) ?? 1, siblings.indexOf(l) + 1, siblings.length),
          angle: 90,
          travel: 0.9,
          duration: 1.2,
          ...target,
        });
  });
  return out;
}
