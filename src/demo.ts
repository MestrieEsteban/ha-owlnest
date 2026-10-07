/**
 * demo.ts — la maison de démonstration livrée avec l'intégration.
 *
 * Une carte sans modèle restait vide : rien à voir avant d'avoir dessiné son
 * logement, exporté un GLB et trouvé où le déposer. La démo comble ce vide. La
 * carte charge une petite maison (Furniture Kit de Kenney, CC0) et y pose des
 * ancres « à relier » sur ses lampes et sa télévision ; un clic sur l'une
 * d'elles propose de la brancher sur une vraie entité.
 *
 * Rien n'est factice : on ne crée aucune entité dans Home Assistant. La maison
 * est un décor, les lampes qu'on y relie sont les siennes.
 */

import type { AnchorConfig, OwlnestAnchor } from './types';
import anchors from './demo-anchors.json';

/** Où l'intégration sert le modèle de démonstration. */
const SERVED_AT = '/owlnest_frontend/demo.glb';

/**
 * Adresse du modèle de démonstration.
 *
 * En production, l'intégration le sert à côté de la carte. En développement,
 * la carte vient du serveur Vite et l'intégration installée peut être plus
 * ancienne, sans le modèle : le point d'entrée de dev indique alors où le
 * prendre.
 */
export function demoModelUrl(): string {
  const override = (globalThis as { __OWLNEST_DEMO_URL?: string }).__OWLNEST_DEMO_URL;
  return override || SERVED_AT;
}

/** La démo est active quand aucun modèle n'est configuré, ni par la carte ni par la scène. */
export function usesDemo(cardModel: string | undefined, sceneModel: string | undefined): boolean {
  return !cardModel?.trim() && !sceneModel?.trim();
}

/** Identifiants des ancres de démonstration, qui servent aussi de clés de traduction. */
export type DemoAnchorId = 'floorLamp' | 'bedsideLamp' | 'kitchenLamp' | 'television';

export interface DemoAnchor {
  id: DemoAnchorId;
  icon: string;
  position: [number, number, number];
}

/** Positions exportées par scripts/build-demo-house.py, dans le repère recentré. */
export const DEMO_ANCHORS = anchors as DemoAnchor[];

/**
 * Ancres à poser dans une scène de démonstration encore vide.
 *
 * Elles sont de nature « entité » mais sans entité : c'est ce qui les fait
 * afficher comme des emplacements à relier. Une scène qui a déjà des ancres
 * n'en reçoit aucune : l'utilisateur a commencé, on ne repose rien par-dessus.
 */
export function seedDemoAnchors(
  existing: readonly unknown[] | undefined,
  label: (id: DemoAnchorId) => string,
): OwlnestAnchor[] {
  if (existing && existing.length) return [];
  return DEMO_ANCHORS.map((a) => ({
    id: `demo_${a.id}`,
    entity: '',
    kind: 'entity',
    label: label(a.id),
    icon: a.icon,
    position: [...a.position] as [number, number, number],
  }));
}

/** Une ancre d'entité qui attend encore la sienne. */
export function isPlaceholder(anchor: Pick<AnchorConfig, 'entity' | 'kind'>): boolean {
  return (anchor.kind ?? 'entity') === 'entity' && !anchor.entity;
}
