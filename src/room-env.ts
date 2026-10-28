/**
 * room-env.ts — reflets des métaux, sans éclairer le reste de la maison.
 *
 * Un métal ne diffuse pas : sans image d'environnement il sort noir. Poser
 * cette image sur `scene.environment` recompilerait le shader de chaque mur.
 * On ne la donne qu'aux matériaux assez métalliques.
 *
 * Un .hdr facultatif peut remplacer la pièce. Champ vide : rien n'est téléchargé.
 */
import * as THREE from 'three';
import { untinted } from './part-tint';

/**
 * Radiance de la pièce reflétée, en linéaire.
 *
 * `RoomEnvironment` de three.js éclaire en candelas (une lampe à 900, des
 * panneaux à 50). Sous l'exposition de la carte (~1,4), un miroir presque
 * parfait — métal 1, rugosité proche de 0 — écrête tout cela en blanc.
 * Ces valeurs restent sous l'épaule du tone mapping, sauf les ouvertures.
 */
const WALL = 0.45;
const FLOOR = 0.12;
const CEILING = 0.75;
const WINDOW = 5;

/**
 * En dessous, un plastique ou un mur peint ne doit pas changer de shader.
 * L'acier et les miroirs exportés par Blender sont au-dessus.
 *
 * Réglage absent : c'est le seuil, les scènes déjà enregistrées ne changent pas.
 */
export const REFLECTION_METALNESS = 0.5;

/**
 * Réglage absent : on ne rescale pas la radiance déjà dosée de la pièce.
 * 0 éteint le reflet sans jeter l'image.
 */
export const DEFAULT_REFLECTION_INTENSITY = 1;

export function reflectionIntensity(value: number | undefined): number {
  return value === undefined ? DEFAULT_REFLECTION_INTENSITY : value;
}

export function reflectionMetalness(value: number | undefined): number {
  return value === undefined ? REFLECTION_METALNESS : value;
}

/** Vide ou absent : rien à télécharger. Sinon l'adresse, sans espaces. */
export function reflectionHdriUrl(value: string | undefined | null): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed ? trimmed : null;
}

/** Champ vide : pièce procédurale. N'importe quelle adresse : un fichier. */
export function reflectionMapSource(value: string | undefined | null): 'procedural' | 'file' {
  return reflectionHdriUrl(value) === null ? 'procedural' : 'file';
}

/** RGBELoader ne lit que le RGBE. Un .exr exigerait un autre chargeur. */
export function isReflectionHdr(url: string): boolean {
  const path = url.split(/[?#]/, 1)[0];
  return path.toLowerCase().endsWith('.hdr');
}

/**
 * Faut-il reconstruire le PMREM ?
 *
 * `built` est l'adresse déjà préfiltrée, `''` la pièce procédurale, `null`
 * rien encore. `pending` est un .hdr en cours de chargement. `failed` est une
 * adresse déjà abandonnée : un curseur ne doit pas la retélécharger.
 *
 * `keep` : l'image voulue est là, ou elle arrive. `procedural` : pas de
 * fichier utilisable. `load` : un autre .hdr.
 */
export type ReflectionUpdate = 'keep' | 'procedural' | 'load';

export function reflectionUpdate(
  built: string | null,
  pending: string | null,
  failed: string | null,
  value: string | undefined | null,
): ReflectionUpdate {
  const url = reflectionHdriUrl(value);
  if (url === null) return built === '' ? 'keep' : 'procedural';
  if (!isReflectionHdr(url) || failed === url) return built === '' ? 'keep' : 'procedural';
  if (pending === url || built === url) return 'keep';
  return 'load';
}

/**
 * `Color(nombre)` lit un hex : 0,45 devient 0. Un miroir de rugosité nulle
 * n'échantillonne qu'un texel, et ce texel noir reste noir.
 */
export function radiance(level: number): THREE.Color {
  return new THREE.Color().setScalar(level);
}

export function materialReflects(material: THREE.Material, threshold = REFLECTION_METALNESS): boolean {
  const standard = material as THREE.MeshStandardMaterial;
  return standard.isMeshStandardMaterial === true && standard.metalness >= threshold;
}

/**
 * Pièce non éclairée : la couleur est la radiance, sans lampe à doser.
 *
 * Coque fermée : un miroir vertical, quelle que soit son orientation, touche
 * un mur ou une ouverture, jamais le vide.
 *
 * La scène source est jetée : seul le résultat PMREM sert au rendu.
 */
function reflectionRoom(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.background = radiance(WALL);

  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: radiance(WALL), side: THREE.BackSide }),
  );
  shell.scale.set(10, 6, 10);
  scene.add(shell);

  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(9.4, 0.2, 9.4),
    new THREE.MeshBasicMaterial({ color: radiance(FLOOR) }),
  );
  floor.position.y = -2.8;
  scene.add(floor);

  const ceiling = new THREE.Mesh(
    new THREE.BoxGeometry(9.4, 0.2, 9.4),
    new THREE.MeshBasicMaterial({ color: radiance(CEILING) }),
  );
  ceiling.position.y = 2.8;
  scene.add(ceiling);

  // Une ouverture par mur et au plafond : un miroir vertical en croise au moins une.
  const opening = new THREE.MeshBasicMaterial({ color: radiance(WINDOW) });
  const fronts: Array<[number, number, number, number]> = [
    [0, 0.6, -4.7, 0],
    [0, 0.6, 4.7, Math.PI],
    [-4.7, 0.6, 0, Math.PI / 2],
    [4.7, 0.6, 0, -Math.PI / 2],
  ];
  for (const [x, y, z, yaw] of fronts) {
    const win = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.8), opening);
    win.position.set(x, y, z);
    win.rotation.y = yaw;
    scene.add(win);
  }
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.2), opening);
  sky.position.y = 2.7;
  sky.rotation.x = Math.PI / 2;
  scene.add(sky);

  return scene;
}

function disposeScene(scene: THREE.Scene): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    geometries.add(mesh.geometry);
    const mat = mesh.material;
    if (Array.isArray(mat)) mat.forEach((m) => materials.add(m));
    else materials.add(mat);
  });
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
}

/**
 * Cubemap de la pièce, faces effacées avant le dessin.
 *
 * `PMREMGenerator.fromScene` pose `autoClear` à faux et, fond coloré, dessine
 * sans vider la profondeur. Le renderer de la carte est créé avec `alpha` :
 * une face non effacée vaut 0, et c'est ce niveau net qu'un miroir lit.
 * Les niveaux flous, eux, gardent les ouvertures.
 */
function renderRoom(renderer: THREE.WebGLRenderer, room: THREE.Scene): THREE.WebGLCubeRenderTarget {
  const cube = new THREE.WebGLCubeRenderTarget(256, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    generateMipmaps: false,
    depthBuffer: true,
    colorSpace: THREE.LinearSRGBColorSpace,
  });
  const camera = new THREE.CubeCamera(0.1, 100, cube);

  const previousTarget = renderer.getRenderTarget();
  const previousFace = renderer.getActiveCubeFace();
  const previousMip = renderer.getActiveMipmapLevel();
  const previousTone = renderer.toneMapping;
  const previousAutoClear = renderer.autoClear;
  const previousAlpha = renderer.getClearAlpha();
  const previousColor = new THREE.Color();
  renderer.getClearColor(previousColor);

  // Pas de tone mapping ici : l'exposition de la carte écrêterait les
  // ouvertures avant qu'un métal ne les reflète.
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.autoClear = false;
  renderer.setClearColor(radiance(WALL), 1);

  try {
    cube.clear(renderer, true, true, true);
    camera.update(renderer, room);
  } finally {
    renderer.setRenderTarget(previousTarget, previousFace, previousMip);
    renderer.toneMapping = previousTone;
    renderer.autoClear = previousAutoClear;
    renderer.setClearColor(previousColor, previousAlpha);
  }

  return cube;
}

/**
 * Pièce procédurale préfiltrée, une seule fois pour toute la carte.
 */
export function createRoomEnvironment(renderer: THREE.WebGLRenderer): THREE.WebGLRenderTarget {
  const room = reflectionRoom();
  const cube = renderRoom(renderer, room);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromCubemap(cube.texture);
  pmrem.dispose();
  cube.dispose();
  disposeScene(room);
  return target;
}

/**
 * Préfiltre un .hdr déjà décodé. L'image source est consommée.
 *
 * On ne touche pas à `scene.environment` : cette cible ne va qu'aux métaux.
 */
export function createHdriEnvironment(
  renderer: THREE.WebGLRenderer,
  equirect: THREE.Texture,
): THREE.WebGLRenderTarget {
  equirect.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(renderer);
  try {
    return pmrem.fromEquirectangular(equirect);
  } finally {
    pmrem.dispose();
    equirect.dispose();
  }
}

/**
 * Pose ou retire l'image de reflet.
 *
 * `map` nul retire seulement cette image : un envMap venu d'ailleurs reste.
 * Une teinte travaille sur une copie ; l'original doit recevoir la même image,
 * sinon la teinte suivante reclonerait un métal encore noir.
 *
 * L'intensité et le seuil se changent sans refaire le PMREM. Un matériau qui
 * passe sous le seuil ne garde pas l'image qu'on lui avait posée.
 */
export function assignReflectionMap(
  root: THREE.Object3D,
  map: THREE.Texture | null,
  previous: THREE.Texture | null,
  intensity = DEFAULT_REFLECTION_INTENSITY,
  threshold = REFLECTION_METALNESS,
): void {
  const seen = new Set<THREE.Material>();
  const stamp = (material: THREE.Material) => {
    if (seen.has(material)) return;
    seen.add(material);
    const standard = material as THREE.MeshStandardMaterial;
    if (standard.isMeshStandardMaterial !== true) return;
    if (map && materialReflects(standard, threshold)) {
      if (standard.envMap !== map) {
        standard.envMap = map;
        standard.needsUpdate = true;
      }
      // Uniforme : changer l'échelle ne recompile pas le shader.
      if (standard.envMapIntensity !== intensity) standard.envMapIntensity = intensity;
      return;
    }
    if (previous && standard.envMap === previous) {
      standard.envMap = null;
      standard.envMapIntensity = 1;
      standard.needsUpdate = true;
    }
  };

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      stamp(material);
      const origin = untinted(material);
      if (origin !== material) stamp(origin);
    }
  });
}
