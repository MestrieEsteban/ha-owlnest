import * as THREE from 'three';
import type { AnchorEntry, CardConfig, Hass } from './types';

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

    const a = stateObj.attributes;
    const on = stateObj.state === 'on';
    const intensityMult = entry.lightIntensity ?? 1;

    switch (entry.domain) {
      case 'light': {
        if (!on) { entry.targetIntensity = 0; break; }
        const brightness = typeof a.brightness === 'number' ? a.brightness / 255 : 1;
        entry.targetIntensity = brightness * scale * 3 * intensityMult;
        if (Array.isArray(a.rgb_color)) {
          const [r, g, b] = a.rgb_color as number[];
          entry.targetColor.setRGB(r / 255, g / 255, b / 255);
        } else if (Array.isArray(a.hs_color)) {
          const [h, s] = a.hs_color as number[];
          entry.targetColor.setHSL(h / 360, s / 100, 0.5);
        } else {
          entry.targetColor.set(0xffffff);
        }
        break;
      }
      case 'switch':
      case 'binary_sensor':
        entry.targetIntensity = on ? 1 : 0;
        entry.targetColor.set(on ? 0x44aaff : 0x555555);
        break;
      case 'cover': {
        const pct = typeof a.current_position === 'number'
          ? a.current_position / 100
          : (stateObj.state === 'open' ? 1 : 0);
        entry.targetIntensity = pct;
        entry.targetColor.set(0x88bbff);
        break;
      }
      case 'climate': {
        entry.targetIntensity = stateObj.state !== 'off' ? 1 : 0;
        const action = a.hvac_action as string | undefined;
        if (action === 'heating') entry.targetColor.set(0xff6600);
        else if (action === 'cooling') entry.targetColor.set(0x00aaff);
        else entry.targetColor.set(0xffffff);
        break;
      }
      case 'media_player':
        entry.targetIntensity = stateObj.state === 'playing' ? 1 : 0;
        entry.targetColor.set(0x9966ff);
        break;
      case 'sensor':
        entry.targetIntensity = 1;
        entry.targetColor.set(0x00cc88);
        break;
      default:
        entry.targetIntensity = on ? 1 : 0;
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
