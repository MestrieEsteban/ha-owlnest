import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { AnchorEntry, CardConfig } from './types';

export async function loadGLTF(url: string): Promise<THREE.Group> {
  const loader = new GLTFLoader();
  const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) =>
    loader.load(url, resolve as (g: unknown) => void, undefined, reject),
  );
  return gltf.scene;
}

export function detectAnchors(
  root: THREE.Object3D,
  scene: THREE.Scene,
  config: CardConfig,
): Map<string, AnchorEntry> {
  const anchors = new Map<string, AnchorEntry>();

  const anchorMap = config.anchors ?? {};
  const lightDist = config.lights?.distance ?? 8;
  const lightDecay = config.lights?.decay ?? 2;

  root.traverse((node) => {
    if (!node.name.startsWith('ha_anchor_')) return;

    const entityId = anchorMap[node.name];
    if (!entityId) return;

    const worldPos = new THREE.Vector3();
    node.getWorldPosition(worldPos);

    const light = new THREE.PointLight(0xffffff, 0, lightDist, lightDecay);
    light.position.copy(worldPos);
    light.visible = false;
    scene.add(light);

    anchors.set(node.name, {
      light,
      worldPos,
      entityId,
      targetIntensity: 0,
      targetColor: new THREE.Color(0xffffff),
    });
  });

  return anchors;
}
