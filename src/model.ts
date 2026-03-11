import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { AnchorEntry, AnchorConfig, CardConfig, EditableAnchor, LightStyle } from './types';

export async function loadGLTF(url: string): Promise<THREE.Group> {
  const loader = new GLTFLoader();
  const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) =>
    loader.load(url, resolve as (g: unknown) => void, undefined, reject),
  );
  return gltf.scene;
}

/** Compute light target position from anchor world pos and optional direction vector */
export function lightTargetPos(
  pos: THREE.Vector3,
  direction?: [number, number, number],
): THREE.Vector3 {
  const [dx, dy, dz] = direction ?? [0, -1, 0]; // default: straight down
  return new THREE.Vector3(pos.x + dx * 4, pos.y + dy * 4, pos.z + dz * 4);
}

export function makeLight(
  pos: THREE.Vector3,
  scene: THREE.Scene,
  config: CardConfig,
  style: LightStyle = 'point',
  direction?: [number, number, number],
): { light: THREE.PointLight | THREE.SpotLight; target?: THREE.Object3D } {
  const dist = config.lights?.distance ?? 8;
  const decay = config.lights?.decay ?? 2;

  if (style === 'spot' || style === 'beam') {
    const angle = style === 'spot' ? Math.PI / 5 : Math.PI / 10;
    const penumbra = style === 'spot' ? 0.25 : 0.04;
    const light = new THREE.SpotLight(0xffffff, 0, dist * 1.5, angle, penumbra, decay);
    light.position.copy(pos);
    light.visible = false;
    light.castShadow = true;
    light.shadow.mapSize.set(512, 512);
    light.shadow.camera.near = 0.1;
    light.shadow.camera.far = dist * 1.5;
    light.shadow.bias = -0.002;
    const target = new THREE.Object3D();
    target.position.copy(lightTargetPos(pos, direction));
    scene.add(target);
    light.target = target;
    scene.add(light);
    return { light, target };
  }

  const light = new THREE.PointLight(0xffffff, 0, dist, decay);
  light.position.copy(pos);
  light.visible = false;
  light.castShadow = true;
  light.shadow.mapSize.set(512, 512);
  light.shadow.camera.near = 0.1;
  light.shadow.camera.far = dist;
  light.shadow.bias = -0.002;
  scene.add(light);
  return { light };
}

/**
 * Rebuild the Three.js light for an existing AnchorEntry in-place.
 * Disposes the old light/target, creates a new one with the given style/direction.
 */
export function rebuildAnchorLight(
  entry: AnchorEntry,
  scene: THREE.Scene,
  config: CardConfig,
  style: LightStyle,
  direction?: [number, number, number],
): void {
  if (entry.light) { scene.remove(entry.light); entry.light.dispose(); }
  if (entry.lightTarget) scene.remove(entry.lightTarget);

  if (entry.domain !== 'light') {
    entry.light = null;
    entry.lightTarget = undefined;
    return;
  }

  const { light, target } = makeLight(entry.worldPos, scene, config, style, direction);
  entry.light = light;
  entry.lightTarget = target;
  entry.lightStyle = style;
  entry.lightDirection = direction;
}

export function detectAnchors(
  root: THREE.Object3D,
  scene: THREE.Scene,
  config: CardConfig,
): Map<string, AnchorEntry> {
  const anchors = new Map<string, AnchorEntry>();
  const cfgAnchors = config.anchors;

  // New format: AnchorConfig[]
  if (Array.isArray(cfgAnchors)) {
    cfgAnchors.forEach((ac: AnchorConfig, idx) => {
      const key = `anchor_cfg_${idx}`;
      const domain = ac.entity.split('.')[0];
      const worldPos = new THREE.Vector3(...ac.position);
      const { light, target } = domain === 'light'
        ? makeLight(worldPos, scene, config, ac.lightStyle ?? 'point', ac.lightDirection)
        : { light: null, target: undefined };
      anchors.set(key, {
        light,
        lightTarget: target,
        worldPos,
        entityId: ac.entity,
        domain,
        targetIntensity: 0,
        targetColor: new THREE.Color(0xffffff),
        label: ac.label ?? ac.entity.split('.')[1] ?? ac.entity,
        hidden: ac.hidden,
        lightStyle: ac.lightStyle,
        lightIntensity: ac.lightIntensity,
        lightDirection: ac.lightDirection,
      });
    });
    return anchors;
  }

  // Old format: { ha_anchor_name: 'entity_id' }
  const anchorMap = (cfgAnchors ?? {}) as Record<string, string>;
  root.traverse((node) => {
    if (!node.name.startsWith('ha_anchor_')) return;
    const entityId = anchorMap[node.name];
    if (!entityId) return;
    const domain = entityId.split('.')[0];
    const worldPos = new THREE.Vector3();
    node.getWorldPosition(worldPos);
    const { light, target } = domain === 'light' ? makeLight(worldPos, scene, config) : { light: null, target: undefined };
    anchors.set(node.name, {
      light,
      lightTarget: target,
      worldPos,
      entityId,
      domain,
      targetIntensity: 0,
      targetColor: new THREE.Color(0xffffff),
      label: node.name.replace('ha_anchor_', ''),
    });
  });

  return anchors;
}

export function buildAnchorsFromEditable(
  editable: Map<string, EditableAnchor>,
  scene: THREE.Scene,
  config: CardConfig,
): Map<string, AnchorEntry> {
  const anchors = new Map<string, AnchorEntry>();
  editable.forEach((ea, key) => {
    const domain = ea.entity.split('.')[0];
    const worldPos = ea.position.clone();
    const { light, target } = domain === 'light'
      ? makeLight(worldPos, scene, config, ea.lightStyle ?? 'point', ea.lightDirection)
      : { light: null, target: undefined };
    anchors.set(key, {
      light,
      lightTarget: target,
      worldPos,
      entityId: ea.entity,
      domain,
      targetIntensity: 0,
      targetColor: new THREE.Color(0xffffff),
      label: ea.label || ea.entity.split('.')[1] || ea.entity,
      hidden: ea.hidden,
      lightStyle: ea.lightStyle,
      lightIntensity: ea.lightIntensity,
      lightDirection: ea.lightDirection,
    });
  });
  return anchors;
}
