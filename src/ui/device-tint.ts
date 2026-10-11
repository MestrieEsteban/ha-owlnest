/**
 * La couleur d'un appareil selon ce qu'il est : les lampes ambre, les
 * températures orange, l'humidité bleue, les ouvertures vertes, les volets
 * violets… La même partout (liste de l'éditeur, ouvrants, panneau de pièce) :
 * on reconnaît un appareil à sa teinte avant de lire son nom.
 */

const BY_DOMAIN: Record<string, string> = {
  light: '#f5b942',
  switch: '#818cf8',
  input_boolean: '#818cf8',
  cover: '#a78bfa',
  climate: '#38bdf8',
  water_heater: '#38bdf8',
  humidifier: '#60a5fa',
  fan: '#2dd4bf',
  media_player: '#f472b6',
  remote: '#f472b6',
  camera: '#94a3b8',
  lock: '#f87171',
  alarm_control_panel: '#fb7185',
  vacuum: '#34d399',
  scene: '#c084fc',
  script: '#c084fc',
  button: '#818cf8',
};

const SENSOR: Record<string, string> = {
  temperature: '#fb923c',
  humidity: '#60a5fa',
  moisture: '#60a5fa',
  power: '#facc15',
  energy: '#facc15',
  current: '#facc15',
  voltage: '#facc15',
  battery: '#84cc16',
  illuminance: '#fde047',
  carbon_dioxide: '#a3a3a3',
  pm25: '#a3a3a3',
  pressure: '#94a3b8',
};

const BINARY: Record<string, string> = {
  door: '#34d399',
  window: '#34d399',
  opening: '#34d399',
  garage_door: '#34d399',
  motion: '#c084fc',
  occupancy: '#c084fc',
  presence: '#c084fc',
  smoke: '#f87171',
  gas: '#f87171',
  moisture: '#60a5fa',
  safety: '#f87171',
  problem: '#f87171',
};

const FALLBACK = '#94a3b8';

/** La teinte d'une entité, d'après son domaine et, pour un capteur, ce qu'il mesure. */
export function deviceTint(entityId: string, attributes: Record<string, unknown> = {}): string {
  const domain = entityId.split('.')[0];
  const cls = typeof attributes.device_class === 'string' ? attributes.device_class : '';
  if (domain === 'sensor') {
    if (SENSOR[cls]) return SENSOR[cls];
    const unit = String(attributes.unit_of_measurement ?? '');
    if (unit.includes('°')) return SENSOR.temperature;
    if (unit === '%') return SENSOR.humidity;
    return FALLBACK;
  }
  if (domain === 'binary_sensor') return BINARY[cls] ?? FALLBACK;
  return BY_DOMAIN[domain] ?? FALLBACK;
}
