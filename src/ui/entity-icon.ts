/**
 * Le dessin d'un appareil, d'après sa nature et son domaine : le même dans la
 * liste de l'éditeur, le panneau d'une pièce et le bouton de choix.
 */
import type { AnchorKind } from '../types';

const ICON: Record<string, string> = {
  light: 'bulb', switch: 'plug', input_boolean: 'plug', cover: 'window', climate: 'temp', media_player: 'speaker',
  camera: 'camera', binary_sensor: 'sensor', sensor: 'sensor', lock: 'lock', fan: 'gear', scene: 'sparkle', script: 'play',
};

/** Un capteur se dessine selon ce qu'il mesure. */
const SENSOR_ICON: Record<string, string> = {
  temperature: 'temp', humidity: 'drop', moisture: 'drop', power: 'bolt', energy: 'bolt', current: 'bolt', voltage: 'bolt',
  illuminance: 'sun', battery: 'bolt',
};
const BINARY_ICON: Record<string, string> = {
  door: 'door', garage_door: 'door', opening: 'door', window: 'window', motion: 'motion', occupancy: 'motion', presence: 'motion',
  moisture: 'drop', smoke: 'cloud', gas: 'cloud',
};

export function entityIconName(entity: string, kind?: AnchorKind, attributes: Record<string, unknown> = {}): string {
  if (!entity && (kind ?? 'entity') === 'entity') return 'plus';
  if (kind === 'label') return 'tag';
  if (kind === 'menu') return 'menu';
  if (kind === 'nav') return 'nav';
  const domain = entity.split('.')[0];
  const cls = typeof attributes.device_class === 'string' ? attributes.device_class : '';
  if (domain === 'sensor') {
    if (SENSOR_ICON[cls]) return SENSOR_ICON[cls];
    const unit = String(attributes.unit_of_measurement ?? '');
    if (unit.includes('°')) return 'temp';
    if (unit === '%') return 'drop';
  }
  if (domain === 'binary_sensor' && BINARY_ICON[cls]) return BINARY_ICON[cls];
  return ICON[domain] ?? 'sensor';
}
