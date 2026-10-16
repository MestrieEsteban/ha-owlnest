import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { AnchorEntry, AnchorConfig, CardConfig, EditableAnchor, LightStyle } from './types';
import { qualityFromConfig } from './quality';
import { lightScale } from './lights';
import { bustCache, shouldRetryUncached } from './model-errors';
import {
  copyLightHostFields, hasLightHost, listLightStyles, setLightStyles, hasMeshStyle,
  type LightHostFields, type LightStyleFields,
} from './light-fields';
import { resolveLightHosts, hostIsOpeningPiece } from './light-emissive';
import {
  disposeEntryLights, makeMeshAreaLights, meshLightsAnchorPos, poseMeshAreaLights,
} from './light-mesh';

/** Champs lumière optionnels, recopiés tels quels (lecture runtime). */
function takeLightFields(src: LightHostFields & LightStyleFields): LightHostFields & LightStyleFields {
  return copyLightHostFields(src);
}

function fetchGLTF(url: string): Promise<THREE.Group> {
  const loader = new GLTFLoader();
  return new Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>((resolve, reject) =>
    loader.load(url, resolve as (g: unknown) => void, undefined, reject),
  ).then((gltf) => {
    // Les animations voyagent avec la scène : les ouvrants les y retrouvent.
    gltf.scene.animations = gltf.animations;
    return gltf.scene;
  });
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
      `[Owlnest] "${url}" answered 404 from the browser cache although the file exists. ` +
      'Home Assistant serves its 404s with a one-month cache, so a corrected path keeps failing ' +
      'until the cache expires. The model was loaded by bypassing the cache.',
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

function usableHosts(root: THREE.Object3D | null | undefined, fields: LightHostFields): THREE.Object3D[] {
  if (!root || !hasLightHost(fields)) return [];
  return resolveLightHosts(root, fields).filter((h) => !hostIsOpeningPiece(h));
}

type BuiltLights = Pick<
  AnchorEntry,
  'light' | 'extraLights' | 'meshLights' | 'lightTarget' | 'extraLightTargets' | 'lightStyle' | 'lightStyles' | 'worldPos' | 'lightDirection'
>;

/** Crée toutes les lumières des styles demandés et les range sur l'entrée. */
function assignBuiltLights(
  entry: AnchorEntry,
  built: BuiltLights,
): void {
  entry.light = built.light;
  entry.extraLights = built.extraLights;
  entry.meshLights = built.meshLights;
  entry.lightTarget = built.lightTarget;
  entry.extraLightTargets = built.extraLightTargets;
  entry.lightStyle = built.lightStyle;
  entry.lightStyles = built.lightStyles;
  entry.worldPos.copy(built.worldPos);
  entry.lightDirection = built.lightDirection;
}

function createLightsForStyles(
  styles: LightStyle[],
  worldPos: THREE.Vector3,
  scene: THREE.Scene,
  config: CardConfig,
  direction: [number, number, number] | undefined,
  span: number | undefined,
  hosts: THREE.Object3D[],
): BuiltLights {
  let list = [...styles];
  // Mesh sans hôte : on retire le style (repli point si plus rien).
  if (list.includes('mesh') && !hosts.length) {
    list = list.filter((s) => s !== 'mesh');
  }
  if (!list.length) list = ['point'];

  const styleFields: LightStyleFields = {};
  setLightStyles(styleFields, list);
  list = listLightStyles(styleFields);

  const nonMesh: Array<THREE.PointLight | THREE.SpotLight> = [];
  const targets: THREE.Object3D[] = [];
  let meshRects: THREE.RectAreaLight[] = [];

  for (const style of list) {
    if (style === 'mesh') {
      meshRects = makeMeshAreaLights(hosts, scene);
      continue;
    }
    const { light, target } = makeLight(worldPos, scene, config, style, direction, span);
    nonMesh.push(light);
    if (target) targets.push(target);
  }

  const pos = worldPos.clone();
  if (list.length === 1 && list[0] === 'mesh' && hosts.length) {
    pos.copy(meshLightsAnchorPos(hosts));
  }

  // Primaire = premier Point/Spot, sinon premier Rect ; meshLights = le reste des rects.
  let light: BuiltLights['light'] = null;
  let extraLights: BuiltLights['extraLights'];
  let meshLights: BuiltLights['meshLights'];
  if (nonMesh.length) {
    light = nonMesh[0];
    extraLights = nonMesh.length > 1 ? nonMesh.slice(1) : undefined;
    meshLights = meshRects.length ? meshRects : undefined;
  } else if (meshRects.length) {
    light = meshRects[0];
    meshLights = meshRects.length > 1 ? meshRects.slice(1) : undefined;
  }

  return {
    light,
    extraLights,
    meshLights,
    lightTarget: targets[0],
    extraLightTargets: targets.length > 1 ? targets.slice(1) : undefined,
    lightStyle: styleFields.lightStyle,
    lightStyles: styleFields.lightStyles,
    worldPos: pos,
    lightDirection: list.some((s) => s === 'spot' || s === 'beam') ? direction : undefined,
  };
}

/**
 * Rebuild the Three.js lights for an existing AnchorEntry in-place.
 * `styles` : un style ou une liste (tous rendus ensemble).
 */
export function rebuildAnchorLight(
  entry: AnchorEntry,
  scene: THREE.Scene,
  config: CardConfig,
  styles: LightStyle | LightStyle[],
  direction?: [number, number, number],
  span?: number,
  hosts?: THREE.Object3D[],
): void {
  disposeEntryLights(entry, scene);

  if (entry.domain !== 'light' || entry.castLight === false) {
    return;
  }

  const list = Array.isArray(styles) ? styles : [styles];
  const usable = (hosts ?? []).filter((h) => !hostIsOpeningPiece(h));
  const built = createLightsForStyles(list, entry.worldPos, scene, config, direction, span, usable);
  assignBuiltLights(entry, built);
}

/** Repose les RectAreaLights mesh sur les hôtes (sans reconstruire). */
export function syncMeshLightPoses(entry: AnchorEntry, hosts: THREE.Object3D[]): void {
  if (!hasMeshStyle(entry)) return;
  const lights = [
    ...(entry.light instanceof THREE.RectAreaLight ? [entry.light] : []),
    ...(entry.meshLights ?? []),
  ];
  if (!lights.length) return;
  poseMeshAreaLights(lights, hosts);
}

function buildLightForAnchor(
  fields: LightHostFields & LightStyleFields & { lightDirection?: [number, number, number] },
  worldPos: THREE.Vector3,
  scene: THREE.Scene,
  config: CardConfig,
  span: number | undefined,
  root: THREE.Object3D | null,
): BuiltLights {
  const styles = listLightStyles(fields);
  const hosts = usableHosts(root, fields);
  return createLightsForStyles(styles, worldPos, scene, config, fields.lightDirection, span, hosts);
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
      const cast = domain === 'light' && ac.castLight !== false;
      const built = cast
        ? buildLightForAnchor(ac, worldPos, scene, config, span, root)
        : {
          light: null as null,
          extraLights: undefined,
          meshLights: undefined,
          lightTarget: undefined,
          extraLightTargets: undefined,
          lightStyle: ac.lightStyle,
          lightStyles: ac.lightStyles,
          worldPos: worldPos.clone(),
          lightDirection: ac.lightDirection,
        };
      anchors.set(key, {
        ...takeLightFields(ac),
        light: built.light,
        extraLights: built.extraLights,
        meshLights: built.meshLights,
        lightTarget: built.lightTarget,
        extraLightTargets: built.extraLightTargets,
        worldPos: built.worldPos,
        entityId: ac.entity,
        domain,
        targetIntensity: 0,
        targetColor: new THREE.Color(0xffffff),
        label: ac.label ?? ac.entity.split('.')[1] ?? ac.entity,
        hidden: ac.hidden,
        lightStyle: built.lightStyle,
        lightStyles: built.lightStyles,
        lightIntensity: ac.lightIntensity,
        lightDirection: built.lightDirection,
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
  root?: THREE.Object3D | null,
): Map<string, AnchorEntry> {
  const anchors = new Map<string, AnchorEntry>();
  editable.forEach((ea, key) => {
    const domain = ea.entity.split('.')[0];
    const worldPos = ea.position.clone();
    const cast = domain === 'light' && ea.castLight !== false;
    const built = cast
      ? buildLightForAnchor(ea, worldPos, scene, config, span, root ?? null)
      : {
        light: null as null,
        extraLights: undefined,
        meshLights: undefined,
        lightTarget: undefined,
        extraLightTargets: undefined,
        lightStyle: ea.lightStyle,
        lightStyles: ea.lightStyles,
        worldPos: worldPos.clone(),
        lightDirection: ea.lightDirection,
      };
    anchors.set(key, {
      ...takeLightFields(ea),
      light: built.light,
      extraLights: built.extraLights,
      meshLights: built.meshLights,
      lightTarget: built.lightTarget,
      extraLightTargets: built.extraLightTargets,
      worldPos: built.worldPos,
      entityId: ea.entity,
      domain,
      targetIntensity: 0,
      targetColor: new THREE.Color(0xffffff),
      label: ea.label || ea.entity.split('.')[1] || ea.entity,
      hidden: ea.hidden,
      lightStyle: built.lightStyle,
      lightStyles: built.lightStyles,
      lightIntensity: ea.lightIntensity,
      lightDirection: built.lightDirection,
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
