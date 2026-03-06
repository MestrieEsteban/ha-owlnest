import * as THREE from 'three';
import type { AnchorEntry, CardConfig, Hass } from './types';

export function syncLights(
  anchors: Map<string, AnchorEntry>,
  hass: Hass,
  config: CardConfig | null,
): void {
  const scale = config?.intensity_scale ?? 1;

  anchors.forEach((entry) => {
    const stateObj = hass.states[entry.entityId];
    if (!stateObj) return;

    const on = stateObj.state === 'on';

    if (!on) {
      entry.targetIntensity = 0;
      return;
    }

    const a = stateObj.attributes;
    const brightness = typeof a.brightness === 'number' ? a.brightness / 255 : 1;
    entry.targetIntensity = brightness * scale * 3;

    if (Array.isArray(a.rgb_color)) {
      const [r, g, b] = a.rgb_color as number[];
      entry.targetColor.setRGB(r / 255, g / 255, b / 255);
    } else if (Array.isArray(a.hs_color)) {
      const [h, s] = a.hs_color as number[];
      entry.targetColor.setHSL(h / 360, s / 100, 0.5);
    } else {
      entry.targetColor.set(0xffffff);
    }
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
