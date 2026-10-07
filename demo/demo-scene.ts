/**
 * demo-scene.ts — ce que contient la maison de la démo en ligne.
 *
 * Les entités simulées, et la scène Owlnest qui les met en 3D : ancres de
 * plusieurs natures (lampes, capteurs, interrupteur, chauffage, télévision),
 * une porte qui s'ouvre, des vues caméra et une règle. C'est l'équivalent de
 * ce qu'un utilisateur construit dans l'éditeur, écrit à la main.
 *
 * Les positions sont dans le repère recentré qu'utilise la carte. Les ancres
 * des lampes sont posées juste au-dessus de l'abat-jour : la lumière qui en
 * part éclaire la pièce au lieu de diffuser à l'intérieur de l'objet.
 */

import type { HassState, OwlnestScene } from '../src/types';

export type DemoLang = 'fr' | 'en';

const T = {
  fr: {
    floorLamp: 'Lampadaire du salon', bedsideLamp: 'Lampe de chevet', kitchenLamp: 'Lampe de la cuisine',
    television: 'Télévision', livingTemp: 'Température salon', bedroomTemp: 'Température chambre',
    door: "Porte d'entrée", coffee: 'Cafetière', heating: 'Chauffage chambre',
    weather: 'Météo',
    viewHome: 'Ensemble', viewEntrance: 'Entrée', viewKitchen: 'Cuisine', viewBedroom: 'Chambre',
    ruleDoor: "Porte d'entrée ouverte",
    toastDoor: "🚪 La porte d'entrée vient de s'ouvrir",
  },
  en: {
    floorLamp: 'Living room floor lamp', bedsideLamp: 'Bedside lamp', kitchenLamp: 'Kitchen lamp',
    television: 'Television', livingTemp: 'Living room temperature', bedroomTemp: 'Bedroom temperature',
    door: 'Front door', coffee: 'Coffee maker', heating: 'Bedroom heating',
    weather: 'Weather',
    viewHome: 'Overview', viewEntrance: 'Entrance', viewKitchen: 'Kitchen', viewBedroom: 'Bedroom',
    ruleDoor: 'Front door opened',
    toastDoor: '🚪 The front door just opened',
  },
} as const;

type V3 = [number, number, number];

const state = (s: string, attributes: Record<string, unknown>) => ({ state: s, attributes }) as unknown as HassState;

function light(name: string, on: boolean, rgb: V3, brightness: number): HassState {
  return state(on ? 'on' : 'off', {
    friendly_name: name,
    supported_color_modes: ['rgb'],
    color_mode: on ? 'rgb' : null,
    ...(on && { brightness, rgb_color: rgb }),
    // Couleur et luminosité retrouvées au rallumage, comme une vraie lampe.
    _demo_rgb: rgb,
    _demo_brightness: brightness,
  });
}

/**
 * Position du soleil pour une heure de la journée.
 *
 * Un modèle volontairement simple (lever 6 h, coucher 20 h, 55° au zénith) :
 * la démo doit montrer le jour, le couchant et la nuit, pas faire de
 * l'astronomie.
 */
export function sunAt(hour: number): { elevation: number; azimuth: number } {
  const day = (hour - 6) / 14; // 0 au lever, 1 au coucher
  // La nuit, le soleil descend jusqu'à -25° en trois heures puis y reste.
  const hoursFromHorizon = hour < 6 ? 6 - hour : hour - 20;
  const elevation = day >= 0 && day <= 1
    ? 55 * Math.sin(Math.PI * day)
    : -25 * Math.min(1, hoursFromHorizon / 3);
  const azimuth = 90 + day * 180;
  return { elevation: Math.round(elevation * 10) / 10, azimuth: Math.round(azimuth) };
}

export const START_HOUR = 19;

export function demoStates(lang: DemoLang): Record<string, HassState> {
  const t = T[lang];
  return {
    'light.lampadaire': light(t.floorLamp, true, [255, 176, 96], 210),
    'light.chevet': light(t.bedsideLamp, false, [255, 120, 180], 150),
    'light.cuisine': light(t.kitchenLamp, true, [255, 236, 210], 255),
    'media_player.television': state('playing', { friendly_name: t.television, media_title: 'Big Buck Bunny', volume_level: 0.3 }),
    'sensor.temperature_salon': state('21.4', { friendly_name: t.livingTemp, unit_of_measurement: '°C', device_class: 'temperature', state_class: 'measurement' }),
    'sensor.temperature_chambre': state('19.2', { friendly_name: t.bedroomTemp, unit_of_measurement: '°C', device_class: 'temperature', state_class: 'measurement' }),
    'binary_sensor.porte_entree': state('off', { friendly_name: t.door, device_class: 'door' }),
    'switch.cafetiere': state('off', { friendly_name: t.coffee, icon: 'mdi:coffee-maker' }),
    'climate.chauffage_chambre': state('heat', {
      friendly_name: t.heating, hvac_modes: ['off', 'heat'], hvac_action: 'heating',
      current_temperature: 19.2, temperature: 20.5, min_temp: 7, max_temp: 30,
    }),
    'sun.sun': state('above_horizon', { friendly_name: 'Sun', ...sunAt(START_HOUR) }),
    'weather.maison': state('partlycloudy', { friendly_name: t.weather, temperature: 21, temperature_unit: '°C' }),
  };
}

export function demoScene(lang: DemoLang, modelUrl: string): OwlnestScene {
  const t = T[lang];
  const anchor = (id: string, entity: string, label: string, icon: string, position: V3, extra: Record<string, unknown> = {}) =>
    ({ id, entity, kind: 'entity', label, icon, position, ...extra });

  return {
    version: 1,
    scene_id: 'main',
    model_url: modelUrl,
    anchors: [
      anchor('demo_floorLamp', 'light.lampadaire', t.floorLamp, 'mdi:floor-lamp', [-1.144, 0.285, -1.238]),
      anchor('demo_bedsideLamp', 'light.chevet', t.bedsideLamp, 'mdi:lamp', [1.846, 0.124, -1.138]),
      anchor('demo_kitchenLamp', 'light.cuisine', t.kitchenLamp, 'mdi:lamp', [0.3, 0.165, 0.62]),
      anchor('demo_television', 'media_player.television', t.television, 'mdi:television', [-1.816, -0.108, -0.043]),
      anchor('demo_livingTemp', 'sensor.temperature_salon', t.livingTemp, 'mdi:thermometer', [-1.94, 0.05, 0.95]),
      anchor('demo_bedroomTemp', 'sensor.temperature_chambre', t.bedroomTemp, 'mdi:thermometer', [1.2, 0.05, -1.44]),
      // Dans la démo, un appui simule le capteur : la porte s'ouvre.
      anchor('demo_door', 'binary_sensor.porte_entree', t.door, 'mdi:door', [-0.5, 0.45, 1.42], { tapAction: 'toggle' }),
      anchor('demo_coffee', 'switch.cafetiere', t.coffee, 'mdi:coffee-maker', [1.15, -0.1, 0.62]),
      anchor('demo_heating', 'climate.chauffage_chambre', t.heating, 'mdi:radiator', [1.95, -0.35, -0.2]),
    ],
    parts: [
      {
        id: 'demo_frontDoor',
        label: t.door,
        entity: 'binary_sensor.porte_entree',
        node: 'Porte_entree',
        mesh: 'Porte_entree',
        triangle: 0,
        motion: 'swing',
        swingAxis: 'vertical',
        hinge: 'start',
        swingSide: 'back',
        angle: 95,
        duration: 1.2,
        openColor: '#ff7043',
      },
    ],
    camera_views: [
      { id: 'home', label: t.viewHome, position: [0, 3.2, 4.4], target: [0, -0.4, 0] },
      { id: 'entrance', label: t.viewEntrance, position: [-0.9, 0.9, -0.2], target: [-0.5, -0.2, 1.3] },
      { id: 'kitchen', label: t.viewKitchen, position: [0.9, 1.4, 2.3], target: [0.8, -0.4, 0.8] },
      { id: 'bedroom', label: t.viewBedroom, position: [1.0, 1.7, 0.7], target: [1.1, -0.4, -0.9] },
    ],
    cards: [],
    rules: [
      {
        id: 'demo_rule_door',
        label: t.ruleDoor,
        enabled: true,
        triggers: [{ type: 'entity_state', entity_id: 'binary_sensor.porte_entree', to: 'on' }],
        actions: [
          { type: 'go_to_view', view_id: 'entrance' },
          { type: 'highlight_anchor', anchor: 'binary_sensor.porte_entree', color: '#ff5252', duration: 6 },
          { type: 'toast', message: t.toastDoor },
        ],
      },
    ],
    settings: { sun_entity: 'sun.sun', weather_entity: 'weather.maison' },
  } as unknown as OwlnestScene;
}
