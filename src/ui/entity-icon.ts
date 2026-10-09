/**
 * Le dessin d'un appareil, d'après sa nature et son domaine : le même dans la
 * liste de l'éditeur, le panneau d'une pièce et le bouton de choix.
 */
import type { AnchorKind } from '../types';

const ICON: Record<string, string> = {
  light: 'bulb', switch: 'plug', input_boolean: 'plug', cover: 'window', climate: 'temp', media_player: 'speaker',
  camera: 'camera', binary_sensor: 'sensor', sensor: 'sensor', lock: 'lock', fan: 'gear', scene: 'sparkle', script: 'play',
};

export function entityIconName(entity: string, kind?: AnchorKind): string {
  if (!entity && (kind ?? 'entity') === 'entity') return 'plus';
  if (kind === 'label') return 'tag';
  if (kind === 'menu') return 'menu';
  if (kind === 'nav') return 'nav';
  return ICON[entity.split('.')[0]] ?? 'sensor';
}
