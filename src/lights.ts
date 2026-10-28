import * as THREE from 'three';
import type { AnchorEntry, CardConfig, Hass } from './types';
import { describeEntity } from './entities/descriptors';
import { REFERENCE_SPAN, modelScale } from './scale';

/**
 * Facteur d'échelle des lumières, déduit de l'envergure du modèle.
 *
 * Un export Sweet Home 3D est en centimètres : une maison y mesure 600 unités
 * au lieu de 6. Une portée de 8 éclaire alors 8 cm, et l'intensité par défaut
 * disparaît — c'est le symptôme « on ne voit même pas la lumière ».
 *
 * La référence est partagée avec le reste du projet : voir `scale.ts`.
 */
export const LIGHT_REFERENCE_SPAN = REFERENCE_SPAN;
export const lightScale = modelScale;

/**
 * Multiplicateur d'intensité pour une lumière à décroissance physique.
 *
 * `THREE.PointLight` avec `decay: 2` suit la loi du carré inverse :
 * l'éclairement reçu vaut `intensité / distance²`. Éloigner tout d'un facteur k
 * demande donc k² fois plus d'intensité pour le même rendu — pas k.
 */
export function intensityScale(span?: number): number {
  const k = lightScale(span);
  return k * k;
}

/** La couleur d'une lumière de Home Assistant (rgb, puis teinte), blanc à défaut. */
export function lightColor(a: Record<string, unknown>, out: THREE.Color, fallback = 0xffffff): THREE.Color {
  if (Array.isArray(a.rgb_color)) {
    const [r, g, b] = a.rgb_color as number[];
    return out.setRGB(r / 255, g / 255, b / 255);
  }
  if (Array.isArray(a.hs_color)) {
    const [h, s] = a.hs_color as number[];
    return out.setHSL(h / 360, s / 100, 0.5);
  }
  return out.set(fallback);
}

const HEX = /^#[0-9a-f]{6}$/i;

/** Approximation corps noir (Tanner Helland), kelvin → RGB linéaire 0–1. */
export function kelvinToColor(kelvin: number, out = new THREE.Color()): THREE.Color {
  const temp = Math.min(40000, Math.max(1000, kelvin)) / 100;
  let r: number;
  let g: number;
  let b: number;
  if (temp <= 66) {
    r = 255;
    g = Math.max(0, Math.min(255, 99.4708025861 * Math.log(temp) - 161.1195681661));
    b = temp <= 19 ? 0
      : Math.max(0, Math.min(255, 138.5177312231 * Math.log(temp - 10) - 305.0447927307));
  } else {
    r = Math.max(0, Math.min(255, 329.698727446 * (temp - 60) ** -0.1332047592));
    g = Math.max(0, Math.min(255, 288.1221695283 * (temp - 60) ** -0.0755148492));
    b = 255;
  }
  return out.setRGB(r / 255, g / 255, b / 255);
}

/** Mireds HA → RGB. */
export function miredsToColor(mireds: number, out = new THREE.Color()): THREE.Color {
  const m = Math.max(1, mireds);
  return kelvinToColor(1_000_000 / m, out);
}

export type LightColorSource =
  | 'rgb_color'
  | 'hs_color'
  | 'color_temp'
  | 'lightColor'
  | 'lightColorTemp'
  | 'white';

/**
 * Résolution de la couleur d'une Point/Spot :
 * rgb HA → hs HA → color_temp HA → lightColor → lightColorTemp → blanc.
 */
export function resolveLightColor(
  attrs: Record<string, unknown> | undefined,
  fallbackColor?: string,
  fallbackTempMireds?: number,
  out = new THREE.Color(),
): { color: THREE.Color; source: LightColorSource } {
  const a = attrs ?? {};
  if (Array.isArray(a.rgb_color) && (a.rgb_color as number[]).length >= 3) {
    const [r, g, b] = a.rgb_color as number[];
    out.setRGB(r / 255, g / 255, b / 255);
    return { color: out, source: 'rgb_color' };
  }
  if (Array.isArray(a.hs_color) && (a.hs_color as number[]).length >= 2) {
    const [h, s] = a.hs_color as number[];
    out.setHSL(h / 360, s / 100, 0.5);
    return { color: out, source: 'hs_color' };
  }
  if (typeof a.color_temp_kelvin === 'number' && Number.isFinite(a.color_temp_kelvin)) {
    kelvinToColor(a.color_temp_kelvin as number, out);
    return { color: out, source: 'color_temp' };
  }
  if (typeof a.color_temp === 'number' && Number.isFinite(a.color_temp)) {
    miredsToColor(a.color_temp as number, out);
    return { color: out, source: 'color_temp' };
  }
  if (typeof fallbackColor === 'string' && HEX.test(fallbackColor)) {
    out.set(fallbackColor);
    return { color: out, source: 'lightColor' };
  }
  if (typeof fallbackTempMireds === 'number' && Number.isFinite(fallbackTempMireds)) {
    miredsToColor(fallbackTempMireds, out);
    return { color: out, source: 'lightColorTemp' };
  }
  out.set(0xffffff);
  return { color: out, source: 'white' };
}

/** L'entité HA fournit-elle déjà une couleur (les contrôles manuels ne sont alors qu'un repli) ? */
export function haProvidesLightColor(attrs: Record<string, unknown> | undefined): boolean {
  const a = attrs ?? {};
  return (Array.isArray(a.rgb_color) && (a.rgb_color as number[]).length >= 3)
    || (Array.isArray(a.hs_color) && (a.hs_color as number[]).length >= 2)
    || (typeof a.color_temp_kelvin === 'number' && Number.isFinite(a.color_temp_kelvin))
    || (typeof a.color_temp === 'number' && Number.isFinite(a.color_temp));
}

export function syncLights(
  anchors: Map<string, AnchorEntry>,
  hass: Hass,
  config: CardConfig | null,
  span?: number,
): void {
  const scale = (config?.intensity_scale ?? 1) * intensityScale(span);

  anchors.forEach((entry) => {
    // Hidden anchors have no light effect
    if (entry.hidden) {
      entry.targetIntensity = 0;
      return;
    }

    // Étiquette, roue, navigation : aucune entité à refléter.
    if ((entry.kind ?? 'entity') !== 'entity') { entry.targetIntensity = 0; return; }

    const stateObj = hass.states[entry.entityId];
    if (!stateObj) return;

    const desc = describeEntity(entry.entityId);

    // Le domaine `light` est le seul cas particulier : sa couleur vient de
    // l'entité (rgb/hs/temp) et son intensité alimente une vraie lumière 3D.
    if (entry.domain === 'light') {
      const a = stateObj.attributes;
      const intensityMult = entry.lightIntensity ?? 1;
      // castLight === false : pas de Point/Spot, seulement l'émisivité du mesh.
      if (entry.castLight === false) {
        entry.targetIntensity = 0;
      } else {
        entry.targetIntensity = desc.level(stateObj) * scale * 3 * intensityMult;
      }
      resolveLightColor(a, entry.lightColor, entry.lightColorTemp, entry.targetColor);
      return;
    }

    // Pour tout le reste, l'intensité ne pilote que l'éclat de l'overlay.
    entry.targetIntensity = desc.level(stateObj);
    // La couleur imposée ne s'applique qu'à l'état actif : à l'arrêt, le gris
    // du descripteur reste le bon repère visuel.
    if (entry.color && desc.isOn(stateObj)) entry.targetColor.set(entry.color);
    else entry.targetColor.set(desc.color(stateObj));
  });
}

export function stepTransitions(
  anchors: Map<string, AnchorEntry>,
  dt: number,
  config: CardConfig | null,
): boolean {
  if (!anchors.size) return false;

  const transitionTime = config?.lights?.transition ?? 0.4;
  const tau = transitionTime / 3;
  const alpha = 1 - Math.exp(-dt / tau);
  let active = false;

  anchors.forEach((entry) => {
    const { targetIntensity: wanted, targetColor } = entry;
    const lights: Array<THREE.PointLight | THREE.SpotLight | THREE.RectAreaLight> = [];
    const seen = new Set<THREE.Light>();
    const push = (l: typeof lights[number] | null | undefined) => {
      if (!l || seen.has(l)) return;
      seen.add(l);
      lights.push(l);
    };
    push(entry.light);
    for (const l of entry.extraLights ?? []) push(l);
    for (const l of entry.meshLights ?? []) push(l);
    for (const light of lights) {
      // Une lampe d'un étage masqué reste éteinte : elle éclairerait l'étage du dessous.
      const targetIntensity = light.userData.owlnestFloorOff ? 0 : wanted;
      // Une lumière du budget reste « visible » en permanence, seule son intensité
      // varie : changer le nombre de lumières visibles fait recompiler tous les
      // shaders (un gel à chaque lampe allumée ou éteinte sur une tablette).
      const real = light.userData.owlnestReal as boolean | undefined;
      const dI = Math.abs(light.intensity - targetIntensity);
      const dR = Math.abs(light.color.r - targetColor.r);
      const dG = Math.abs(light.color.g - targetColor.g);
      const dB = Math.abs(light.color.b - targetColor.b);

      if (dI > 0.002 || dR > 0.002 || dG > 0.002 || dB > 0.002) {
        light.intensity = THREE.MathUtils.lerp(light.intensity, targetIntensity, alpha);
        light.color.lerp(targetColor, alpha);
        light.visible = real ?? (light.intensity > 0.01 || targetIntensity > 0);
        active = true;
      } else {
        light.intensity = targetIntensity;
        light.color.copy(targetColor);
        light.visible = real ?? targetIntensity > 0;
      }
    }
  });

  return active;
}
