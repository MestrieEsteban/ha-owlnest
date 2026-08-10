/**
 * entities/descriptors.ts — sémantique d'affichage par domaine Home Assistant.

 * Tout est désormais déclaré ici. Les autres modules sont des consommateurs.
 *
 * Le point clé est `device_class` : HA distingue une porte d'une fenêtre ou
 * d'un détecteur de fumée, et cette information n'était pas exploitée. Un
 * `binary_sensor` était rendu comme un interrupteur — un cercle qui s'allume.
 */

import type { HassState } from '../types';
import { t } from '../i18n';

export type OverlayKind = 'icon' | 'badge';
/** `activate` déclenche le service naturel du domaine (press, turn_on…). */
export type TapAction = 'toggle' | 'more_info' | 'media_play_pause' | 'activate' | 'none';

export interface EntityDescriptor {
  /** Pastille icône, ou badge de valeur (capteurs numériques). */
  overlay: OverlayKind;
  /** Action sur appui court. */
  tap: TapAction;
  /** L'entité est-elle dans son état « actif » ? */
  isOn(s?: HassState): boolean;
  /** Niveau 0..1 — pilote l'intensité 3D et l'éclat de l'overlay. */
  level(s?: HassState): number;
  /** Couleur d'état, en hexadécimal. */
  color(s?: HassState): number;
  /** Icône MDI reflétant l'état. `undefined` → icône SVG intégrée du domaine. */
  icon(s?: HassState): string | undefined;
  /** Texte lisible : « Ouverte », « 22° », « 45 % ». */
  stateText(s?: HassState): string;
}

const isActive = (s?: HassState) => s?.state === 'on';
const isUnavailable = (s?: HassState) =>
  !s || s.state === 'unavailable' || s.state === 'unknown';

// ── binary_sensor : une entrée par device_class ──────────────────────────────

interface BinaryClass {
  /** Icônes [actif, inactif]. */
  icons: [string, string];
  /** Clés i18n [actif, inactif]. */
  labels: [Parameters<typeof t>[0], Parameters<typeof t>[0]];
  /** Couleur à l'état actif. */
  on: number;
}

const ALERT = 0xef4444;
const OPEN = 0xf59e0b;
const MOTION = 0x22d3ee;
const NEUTRAL = 0x44aaff;
const OFF_COLOR = 0x555555;

const BINARY_CLASSES: Record<string, BinaryClass> = {
  door:        { icons: ['mdi:door-open', 'mdi:door-closed'],                 labels: ['stOpen', 'stClosed'],             on: OPEN },
  garage_door: { icons: ['mdi:garage-open', 'mdi:garage'],                    labels: ['stOpen', 'stClosed'],             on: OPEN },
  window:      { icons: ['mdi:window-open', 'mdi:window-closed'],             labels: ['stOpen', 'stClosed'],             on: OPEN },
  opening:     { icons: ['mdi:square-rounded-outline', 'mdi:square-rounded'], labels: ['stOpen', 'stClosed'],             on: OPEN },
  motion:      { icons: ['mdi:motion-sensor', 'mdi:motion-sensor-off'],       labels: ['stDetected', 'stClear'],          on: MOTION },
  occupancy:   { icons: ['mdi:home-account', 'mdi:home-outline'],             labels: ['stOccupied', 'stEmpty'],          on: MOTION },
  presence:    { icons: ['mdi:home-account', 'mdi:home-outline'],             labels: ['stOccupied', 'stEmpty'],          on: MOTION },
  moisture:    { icons: ['mdi:water-alert', 'mdi:water-off'],                 labels: ['stWet', 'stDry'],                 on: ALERT },
  smoke:       { icons: ['mdi:smoke-detector-alert', 'mdi:smoke-detector'],   labels: ['stDetected', 'stClear'],          on: ALERT },
  gas:         { icons: ['mdi:gas-cylinder', 'mdi:gas-cylinder'],             labels: ['stDetected', 'stClear'],          on: ALERT },
  co:          { icons: ['mdi:molecule-co', 'mdi:molecule-co'],               labels: ['stDetected', 'stClear'],          on: ALERT },
  problem:     { icons: ['mdi:alert-circle', 'mdi:check-circle'],             labels: ['stProblem', 'stOk'],              on: ALERT },
  safety:      { icons: ['mdi:shield-alert', 'mdi:shield-check'],             labels: ['stProblem', 'stOk'],              on: ALERT },
  tamper:      { icons: ['mdi:hand-back-right', 'mdi:shield-check'],          labels: ['stProblem', 'stOk'],              on: ALERT },
  lock:        { icons: ['mdi:lock-open-variant', 'mdi:lock'],                labels: ['stUnlocked', 'stLocked'],         on: OPEN },
  battery:     { icons: ['mdi:battery-alert', 'mdi:battery'],                 labels: ['stLow', 'stNormal'],              on: ALERT },
  connectivity:{ icons: ['mdi:lan-connect', 'mdi:lan-disconnect'],            labels: ['stConnected', 'stDisconnected'],  on: 0x4ade80 },
  plug:        { icons: ['mdi:power-plug', 'mdi:power-plug-off'],             labels: ['stPluggedIn', 'stUnplugged'],     on: 0x4ade80 },
  power:       { icons: ['mdi:power-plug', 'mdi:power-plug-off'],             labels: ['stPluggedIn', 'stUnplugged'],     on: 0x4ade80 },
  sound:       { icons: ['mdi:music-note', 'mdi:music-note-off'],             labels: ['stDetected', 'stClear'],          on: MOTION },
  vibration:   { icons: ['mdi:vibrate', 'mdi:vibrate-off'],                   labels: ['stDetected', 'stClear'],          on: MOTION },
  running:     { icons: ['mdi:play-circle', 'mdi:stop-circle'],               labels: ['stRunning', 'stStopped'],         on: 0x4ade80 },
  heat:        { icons: ['mdi:fire', 'mdi:thermometer'],                      labels: ['stDetected', 'stClear'],          on: ALERT },
  cold:        { icons: ['mdi:snowflake-alert', 'mdi:snowflake'],             labels: ['stDetected', 'stClear'],          on: ALERT },
};

const BINARY_DEFAULT: BinaryClass = {
  icons: ['mdi:checkbox-marked-circle', 'mdi:checkbox-blank-circle-outline'],
  labels: ['stOn', 'stOff'],
  on: NEUTRAL,
};

function binaryClassOf(s?: HassState): BinaryClass {
  const dc = s?.attributes?.device_class as string | undefined;
  return (dc && BINARY_CLASSES[dc]) || BINARY_DEFAULT;
}

// ── Descripteurs par domaine ─────────────────────────────────────────────────

const binarySensor: EntityDescriptor = {
  overlay: 'icon',
  tap: 'more_info', // lecture seule : un capteur ne se commande pas
  isOn: isActive,
  level: (s) => (isActive(s) ? 1 : 0),
  color: (s) => (isActive(s) ? binaryClassOf(s).on : OFF_COLOR),
  icon: (s) => binaryClassOf(s).icons[isActive(s) ? 0 : 1],
  stateText: (s) =>
    isUnavailable(s) ? t('stUnavailable') : t(binaryClassOf(s).labels[isActive(s) ? 0 : 1]),
};

const light: EntityDescriptor = {
  overlay: 'icon',
  tap: 'toggle',
  isOn: isActive,
  level: (s) => {
    if (!isActive(s)) return 0;
    const b = s?.attributes?.brightness;
    return typeof b === 'number' ? b / 255 : 1;
  },
  color: (s) => (isActive(s) ? 0xffffff : OFF_COLOR),
  icon: (s) => (isActive(s) ? 'mdi:lightbulb-on' : 'mdi:lightbulb-outline'),
  stateText: (s) => {
    if (isUnavailable(s)) return t('stUnavailable');
    if (!isActive(s)) return t('stOff');
    const b = s?.attributes?.brightness;
    return typeof b === 'number' ? `${Math.round((b / 255) * 100)} %` : t('stOn');
  },
};

const switchDesc: EntityDescriptor = {
  overlay: 'icon',
  tap: 'toggle',
  isOn: isActive,
  level: (s) => (isActive(s) ? 1 : 0),
  color: (s) => (isActive(s) ? NEUTRAL : OFF_COLOR),
  icon: (s) => (isActive(s) ? 'mdi:toggle-switch' : 'mdi:toggle-switch-off-outline'),
  stateText: (s) => (isUnavailable(s) ? t('stUnavailable') : t(isActive(s) ? 'stOn' : 'stOff')),
};

/** Position d'un volet en 0..1 — `current_position` quand elle existe. */
function coverLevel(s?: HassState): number {
  const pct = s?.attributes?.current_position;
  if (typeof pct === 'number') return pct / 100;
  return s?.state === 'open' ? 1 : 0;
}

const cover: EntityDescriptor = {
  overlay: 'icon',
  tap: 'toggle',
  isOn: (s) => coverLevel(s) > 0,
  level: coverLevel,
  color: () => 0x88bbff,
  icon: (s) => (coverLevel(s) > 0 ? 'mdi:window-shutter-open' : 'mdi:window-shutter'),
  stateText: (s) => {
    if (isUnavailable(s)) return t('stUnavailable');
    const pct = s?.attributes?.current_position;
    // Les extrêmes se lisent mieux en mots qu'en pourcentage.
    if (typeof pct === 'number' && pct > 0 && pct < 100) return `${Math.round(pct)} %`;
    return t(coverLevel(s) > 0 ? 'stOpen' : 'stClosed');
  },
};

const climate: EntityDescriptor = {
  overlay: 'icon',
  tap: 'more_info',
  isOn: (s) => !!s && s.state !== 'off',
  level: (s) => (s && s.state !== 'off' ? 1 : 0),
  color: (s) => {
    const action = s?.attributes?.hvac_action as string | undefined;
    if (action === 'heating') return 0xff6600;
    if (action === 'cooling') return 0x00aaff;
    return 0xffffff;
  },
  icon: (s) => {
    const action = s?.attributes?.hvac_action as string | undefined;
    if (action === 'heating') return 'mdi:fire';
    if (action === 'cooling') return 'mdi:snowflake';
    return s && s.state !== 'off' ? 'mdi:thermostat' : 'mdi:thermostat-box';
  },
  stateText: (s) => {
    if (isUnavailable(s)) return t('stUnavailable');
    const temp = s?.attributes?.current_temperature;
    if (typeof temp === 'number') return `${temp}°`;
    return s?.state ?? '—';
  },
};

const mediaPlayer: EntityDescriptor = {
  overlay: 'icon',
  tap: 'media_play_pause',
  isOn: (s) => s?.state === 'playing',
  level: (s) => (s?.state === 'playing' ? 1 : 0),
  color: () => 0x9966ff,
  icon: (s) => {
    if (s?.state === 'playing') return 'mdi:play-circle';
    if (s?.state === 'paused') return 'mdi:pause-circle';
    return 'mdi:speaker';
  },
  stateText: (s) => {
    if (isUnavailable(s)) return t('stUnavailable');
    if (s?.state === 'playing') {
      const title = s.attributes?.media_title;
      if (typeof title === 'string' && title) return title;
      return t('stPlaying');
    }
    if (s?.state === 'paused') return t('stPaused');
    return t('stOff');
  },
};

const sensor: EntityDescriptor = {
  overlay: 'badge', // valeur numérique : un badge lisible, pas une pastille
  tap: 'more_info',
  isOn: () => true,
  level: () => 1,
  color: () => 0x00cc88,
  icon: () => undefined,
  stateText: (s) => (isUnavailable(s) ? t('stUnavailable') : (s?.state ?? '—')),
};

const fallback: EntityDescriptor = {
  overlay: 'icon',
  tap: 'more_info',
  isOn: isActive,
  level: (s) => (isActive(s) ? 1 : 0),
  color: (s) => (isActive(s) ? 0xffffff : OFF_COLOR),
  icon: () => undefined,
  stateText: (s) => (isUnavailable(s) ? t('stUnavailable') : (s?.state ?? '—')),
};

// ── Domaines supplémentaires ─────────────────────────────────────────────────

/**
 * Les domaines dangereux ou irréversibles restent en `more_info` : ouvrir une
 * serrure, désarmer une alarme ou déclencher une sirène par un appui accidentel
 * sur une tablette murale n'est pas acceptable. La surcharge par ancre permet
 * de forcer un autre comportement en connaissance de cause.
 */
const lock: EntityDescriptor = {
  overlay: 'icon',
  tap: 'more_info',
  isOn: (s) => s?.state === 'unlocked',
  level: (s) => (s?.state === 'unlocked' ? 1 : 0),
  color: (s) => (s?.state === 'unlocked' ? OPEN : 0x4ade80),
  icon: (s) => (s?.state === 'unlocked' ? 'mdi:lock-open-variant' : 'mdi:lock'),
  stateText: (s) =>
    isUnavailable(s) ? t('stUnavailable') : t(s?.state === 'unlocked' ? 'stUnlocked' : 'stLocked'),
};

const VACUUM_ACTIVE = ['cleaning', 'returning'];

const vacuum: EntityDescriptor = {
  overlay: 'icon',
  tap: 'more_info',
  isOn: (s) => VACUUM_ACTIVE.includes(s?.state ?? ''),
  level: (s) => (VACUUM_ACTIVE.includes(s?.state ?? '') ? 1 : 0),
  color: (s) => {
    if (s?.state === 'error') return ALERT;
    return VACUUM_ACTIVE.includes(s?.state ?? '') ? 0x4ade80 : OFF_COLOR;
  },
  icon: (s) => (VACUUM_ACTIVE.includes(s?.state ?? '') ? 'mdi:robot-vacuum' : 'mdi:robot-vacuum-variant'),
  stateText: (s) => {
    if (isUnavailable(s)) return t('stUnavailable');
    switch (s?.state) {
      case 'cleaning':  return t('stCleaning');
      case 'returning': return t('stReturning');
      case 'docked':    return t('stDocked');
      case 'paused':    return t('stPaused');
      case 'error':     return t('stError');
      default:          return t('stIdle');
    }
  },
};

const alarm: EntityDescriptor = {
  overlay: 'icon',
  tap: 'more_info',
  isOn: (s) => !!s && s.state !== 'disarmed',
  level: (s) => (s && s.state !== 'disarmed' ? 1 : 0),
  color: (s) => {
    if (s?.state === 'triggered') return ALERT;
    if (s?.state === 'disarmed') return OFF_COLOR;
    return 0x4ade80;
  },
  icon: (s) => {
    if (s?.state === 'triggered') return 'mdi:bell-ring';
    if (s?.state === 'disarmed') return 'mdi:shield-off';
    return 'mdi:shield-lock';
  },
  stateText: (s) => {
    if (isUnavailable(s)) return t('stUnavailable');
    if (s?.state === 'triggered') return t('stTriggered');
    if (s?.state === 'disarmed') return t('stDisarmed');
    if (s?.state === 'arming' || s?.state === 'pending') return t('stArming');
    return t('stArmed');
  },
};

const presence: EntityDescriptor = {
  overlay: 'icon',
  tap: 'more_info',
  isOn: (s) => s?.state === 'home',
  level: (s) => (s?.state === 'home' ? 1 : 0),
  color: (s) => (s?.state === 'home' ? 0x4ade80 : OFF_COLOR),
  icon: (s) => (s?.state === 'home' ? 'mdi:home-account' : 'mdi:account-off'),
  stateText: (s) =>
    isUnavailable(s) ? t('stUnavailable') : t(s?.state === 'home' ? 'stHome' : 'stAway'),
};

const fan: EntityDescriptor = {
  overlay: 'icon',
  tap: 'toggle',
  isOn: isActive,
  level: (s) => {
    if (!isActive(s)) return 0;
    const pct = s?.attributes?.percentage;
    return typeof pct === 'number' ? pct / 100 : 1;
  },
  color: (s) => (isActive(s) ? MOTION : OFF_COLOR),
  icon: (s) => (isActive(s) ? 'mdi:fan' : 'mdi:fan-off'),
  stateText: (s) => {
    if (isUnavailable(s)) return t('stUnavailable');
    if (!isActive(s)) return t('stOff');
    const pct = s?.attributes?.percentage;
    return typeof pct === 'number' ? `${Math.round(pct)} %` : t('stOn');
  },
};

const humidifier: EntityDescriptor = {
  overlay: 'icon',
  tap: 'toggle',
  isOn: isActive,
  level: (s) => (isActive(s) ? 1 : 0),
  color: (s) => (isActive(s) ? 0x38bdf8 : OFF_COLOR),
  icon: (s) => (isActive(s) ? 'mdi:air-humidifier' : 'mdi:air-humidifier-off'),
  stateText: (s) => {
    if (isUnavailable(s)) return t('stUnavailable');
    if (!isActive(s)) return t('stOff');
    const h = s?.attributes?.current_humidity;
    return typeof h === 'number' ? `${Math.round(h)} %` : t('stOn');
  },
};

const valve: EntityDescriptor = {
  overlay: 'icon',
  tap: 'toggle',
  isOn: (s) => coverLevel(s) > 0,
  level: coverLevel,
  color: (s) => (coverLevel(s) > 0 ? 0x38bdf8 : OFF_COLOR),
  icon: (s) => (coverLevel(s) > 0 ? 'mdi:valve-open' : 'mdi:valve-closed'),
  stateText: (s) => {
    if (isUnavailable(s)) return t('stUnavailable');
    const pct = s?.attributes?.current_position;
    if (typeof pct === 'number' && pct > 0 && pct < 100) return `${Math.round(pct)} %`;
    return t(coverLevel(s) > 0 ? 'stOpen' : 'stClosed');
  },
};

const siren: EntityDescriptor = {
  overlay: 'icon',
  tap: 'more_info',
  isOn: isActive,
  level: (s) => (isActive(s) ? 1 : 0),
  color: (s) => (isActive(s) ? ALERT : OFF_COLOR),
  icon: (s) => (isActive(s) ? 'mdi:bullhorn' : 'mdi:bullhorn-outline'),
  stateText: (s) => (isUnavailable(s) ? t('stUnavailable') : t(isActive(s) ? 'stOn' : 'stOff')),
};

const camera: EntityDescriptor = {
  overlay: 'icon',
  tap: 'more_info',
  isOn: (s) => s?.state === 'recording' || s?.state === 'streaming',
  level: (s) => (s?.state === 'recording' || s?.state === 'streaming' ? 1 : 0),
  color: (s) => (s?.state === 'recording' ? ALERT : NEUTRAL),
  icon: () => 'mdi:cctv',
  stateText: (s) => {
    if (isUnavailable(s)) return t('stUnavailable');
    if (s?.state === 'recording') return t('stRecording');
    if (s?.state === 'streaming') return t('stStreaming');
    return t('stIdle');
  },
};

/** Entités « à déclencher » : leur état n'a pas de sens à afficher. */
function makeActivatable(icon: string, color: number): EntityDescriptor {
  return {
    overlay: 'icon',
    tap: 'activate',
    isOn: () => false,
    level: () => 0,
    color: () => color,
    icon: () => icon,
    stateText: (s) => (isUnavailable(s) ? t('stUnavailable') : t('stTap')),
  };
}

const BY_DOMAIN: Record<string, EntityDescriptor> = {
  lock,
  vacuum,
  alarm_control_panel: alarm,
  person: presence,
  device_tracker: presence,
  fan,
  humidifier,
  valve,
  siren,
  camera,
  button: makeActivatable('mdi:gesture-tap-button', 0xa78bfa),
  scene:  makeActivatable('mdi:palette', 0xf472b6),
  script: makeActivatable('mdi:script-text', 0xa78bfa),
  light,
  switch: switchDesc,
  input_boolean: switchDesc,
  cover,
  climate,
  media_player: mediaPlayer,
  sensor,
  binary_sensor: binarySensor,
};

/** Descripteur applicable à une entité. Jamais `undefined` : repli générique. */
export function describeEntity(entityId: string): EntityDescriptor {
  return BY_DOMAIN[entityId.split('.')[0]] ?? fallback;
}

/** Domaines pour lesquels un comportement dédié est déclaré. */
export function hasDescriptor(domain: string): boolean {
  return domain in BY_DOMAIN;
}
