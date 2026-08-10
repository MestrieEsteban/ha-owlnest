import * as THREE from 'three';
import type { AnchorEntry, CardConfig, Hass } from './types';
import { describeEntity } from './entities/descriptors';

export function syncLights(
  anchors: Map<string, AnchorEntry>,
  hass: Hass,
  config: CardConfig | null,
): void {
  const scale = config?.intensity_scale ?? 1;

  anchors.forEach((entry) => {
    // Hidden anchors have no light effect
    if (entry.hidden) {
      entry.targetIntensity = 0;
      return;
    }

    const stateObj = hass.states[entry.entityId];
    if (!stateObj) return;

    const desc = describeEntity(entry.entityId);

    // Le domaine `light` est le seul cas particulier : sa couleur vient de
    // l'entité (rgb/hs) et son intensité alimente une vraie lumière 3D.
    if (entry.domain === 'light') {
      const a = stateObj.attributes;
      const intensityMult = entry.lightIntensity ?? 1;
      entry.targetIntensity = desc.level(stateObj) * scale * 3 * intensityMult;
      if (Array.isArray(a.rgb_color)) {
        const [r, g, b] = a.rgb_color as number[];
        entry.targetColor.setRGB(r / 255, g / 255, b / 255);
      } else if (Array.isArray(a.hs_color)) {
        const [h, s] = a.hs_color as number[];
        entry.targetColor.setHSL(h / 360, s / 100, 0.5);
      } else {
        entry.targetColor.set(0xffffff);
      }
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

  anchors.forEach(({ light, targetIntensity, targetColor }) => {
    if (!light) return;
    const dI = Math.abs(light.intensity - targetIntensity);
    const dR = Math.abs(light.color.r - targetColor.r);
    const dG = Math.abs(light.color.g - targetColor.g);
    const dB = Math.abs(light.color.b - targetColor.b);

    if (dI > 0.002 || dR > 0.002 || dG > 0.002 || dB > 0.002) {
      light.intensity = THREE.MathUtils.lerp(light.intensity, targetIntensity, alpha);
      light.color.lerp(targetColor, alpha);
      light.visible = light.intensity > 0.01 || targetIntensity > 0;
      active = true;
    } else {
      light.intensity = targetIntensity;
      light.color.copy(targetColor);
      light.visible = targetIntensity > 0;
    }
  });

  return active;
}
