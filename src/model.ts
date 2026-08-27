import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { AnchorEntry, AnchorConfig, CardConfig, EditableAnchor, LightStyle } from './types';
import { qualityFromConfig } from './quality';
import { lightScale } from './lights';
import { bustCache, shouldRetryUncached } from './model-errors';

function fetchGLTF(url: string): Promise<THREE.Group> {
  const loader = new GLTFLoader();
  return new Promise<{ scene: THREE.Group }>((resolve, reject) =>
    loader.load(url, resolve as (g: unknown) => void, undefined, reject),
  ).then((gltf) => gltf.scene);
}

export async function loadGLTF(url: string): Promise<THREE.Group> {
  try {
    return await fetchGLTF(url);
  } catch (err) {
    if (!shouldRetryUncached(err)) throw err;

    // Un 404 peut venir du cache du navigateur et non du serveur : voir
    // `shouldRetryUncached`. Une URL que le cache ne connaît pas tranche.
    const model = await fetchGLTF(bustCache(url)).catch(() => {
      // Le fichier est bien absent : c'est l'erreur d'origine qui décrit
      // l'échec, pas celle de la tentative anti-cache.
      throw err;
    });

    console.warn(
      `[Owlnest] "${url}" a répondu 404 depuis le cache du navigateur alors que le fichier existe. ` +
      `Home Assistant sert ses 404 avec un cache d'un mois : un chemin corrigé reste en échec ` +
      `jusqu'à ce que le cache expire. Le modèle a été chargé en contournant le cache.`,
    );
    return model;
  }
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
  span?: number,
): { light: THREE.PointLight | THREE.SpotLight; target?: THREE.Object3D } {
  // Une portée explicite est un réglage de l'utilisateur, exprimé dans l'unité
  // de son modèle : on la respecte. Seule la valeur par défaut se met à
  // l'échelle, faute de quoi une lampe éclairerait huit centimètres.
  const dist = config.lights?.distance ?? 8 * lightScale(span);
  const decay = config.lights?.decay ?? 2;
  // Une lumière qui projette une ombre fait rendre la scène 6 fois de plus
  // (cube map). C'est le premier poste de coût sur GPU faible.
  const q = qualityFromConfig(config);

  if (style === 'spot' || style === 'beam') {
    const angle = style === 'spot' ? Math.PI / 5 : Math.PI / 10;
    const penumbra = style === 'spot' ? 0.25 : 0.04;
    const light = new THREE.SpotLight(0xffffff, 0, dist * 1.5, angle, penumbra, decay);
    light.position.copy(pos);
    light.visible = false;
    light.castShadow = q.anchorShadows;
    light.shadow.mapSize.set(q.anchorShadowMap, q.anchorShadowMap);
    light.shadow.camera.near = Math.max(dist * 0.01, 0.01);
    light.shadow.camera.far = dist * 1.5;
    // Même raison que pour le soleil : un biais en profondeur normalisée
    // devient un décalage monde démesuré sur un modèle en centimètres.
    light.shadow.bias = 0;
    light.shadow.normalBias = Math.max(dist * 0.004, 0.002);
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
  light.castShadow = q.anchorShadows;
  light.shadow.mapSize.set(q.anchorShadowMap, q.anchorShadowMap);
  light.shadow.camera.near = Math.max(dist * 0.01, 0.01);
  light.shadow.camera.far = dist;
  light.shadow.bias = 0;
  light.shadow.normalBias = Math.max(dist * 0.004, 0.002);
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
  span?: number,
): void {
  if (entry.light) { scene.remove(entry.light); entry.light.dispose(); }
  if (entry.lightTarget) scene.remove(entry.lightTarget);

  if (entry.domain !== 'light') {
    entry.light = null;
    entry.lightTarget = undefined;
    return;
  }

  const { light, target } = makeLight(entry.worldPos, scene, config, style, direction, span);
  entry.light = light;
  entry.lightTarget = target;
  entry.lightStyle = style;
  entry.lightDirection = direction;
}

export function detectAnchors(
  root: THREE.Object3D,
  scene: THREE.Scene,
  config: CardConfig,
  span?: number,
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
        ? makeLight(worldPos, scene, config, ac.lightStyle ?? 'point', ac.lightDirection, span)
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
        visibleIf: ac.visibleIf,
        precision: ac.precision,
        icon: ac.icon,
        color: ac.color,
        tapAction: ac.tapAction,
        kind: ac.kind,
        actions: ac.actions,
        navViewId: ac.navViewId,
        size: ac.size,
        display: ac.display,
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
    const { light, target } = domain === 'light' ? makeLight(worldPos, scene, config, 'point', undefined, span) : { light: null, target: undefined };
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
  span?: number,
): Map<string, AnchorEntry> {
  const anchors = new Map<string, AnchorEntry>();
  editable.forEach((ea, key) => {
    const domain = ea.entity.split('.')[0];
    const worldPos = ea.position.clone();
    const { light, target } = domain === 'light'
      ? makeLight(worldPos, scene, config, ea.lightStyle ?? 'point', ea.lightDirection, span)
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
      visibleIf: ea.visibleIf,
      precision: ea.precision,
      icon: ea.icon,
      color: ea.color,
      tapAction: ea.tapAction,
      kind: ea.kind,
      actions: ea.actions,
      navViewId: ea.navViewId,
      size: ea.size,
      display: ea.display,
    });
  });
  return anchors;
}
