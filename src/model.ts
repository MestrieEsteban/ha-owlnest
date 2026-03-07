import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { AnchorEntry, AnchorConfig, CardConfig, EditableAnchor } from './types';

export async function loadGLTF(url: string): Promise<THREE.Group> {
  const loader = new GLTFLoader();
  const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) =>
    loader.load(url, resolve as (g: unknown) => void, undefined, reject),
  );
  return gltf.scene;
}

function makeLight(
  pos: THREE.Vector3,
  scene: THREE.Scene,
  config: CardConfig,
): THREE.PointLight {
  const dist = config.lights?.distance ?? 8;
  const decay = config.lights?.decay ?? 2;
  const light = new THREE.PointLight(0xffffff, 0, dist, decay);
  light.position.copy(pos);
  light.visible = false;
  scene.add(light);
  return light;
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
      const light = domain === 'light' ? makeLight(worldPos, scene, config) : null;
      anchors.set(key, {
        light,
        worldPos,
        entityId: ac.entity,
        domain,
        targetIntensity: 0,
        targetColor: new THREE.Color(0xffffff),
        label: ac.label ?? ac.entity.split('.')[1] ?? ac.entity,
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
    const light = domain === 'light' ? makeLight(worldPos, scene, config) : null;
    anchors.set(node.name, {
      light,
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
    const light = domain === 'light' ? makeLight(worldPos, scene, config) : null;
    anchors.set(key, {
      light,
      worldPos,
      entityId: ea.entity,
      domain,
      targetIntensity: 0,
      targetColor: new THREE.Color(0xffffff),
      label: ea.label || ea.entity.split('.')[1] || ea.entity,
    });
  });
  return anchors;
}
