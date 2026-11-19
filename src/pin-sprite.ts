import * as THREE from 'three';

/**
 * Pastilles dessinées dans la scène, pas en HTML.
 *
 * Le tampon de profondeur de la maison décide si un mur les cache.
 * `depthWrite` reste faux : un disque ne doit pas masquer une autre
 * pastille, ni creuser le modèle.
 */

/** Au-dessus du modèle : une pastille qui traverse les murs se dessine après. */
export const PIN_ORDER_FRONT = 10;

export interface PinDepthFlags {
  depthTest: boolean;
  depthWrite: false;
  renderOrder: number;
}

/**
 * Le nom HTML n'existe qu'au survol.
 * « Toujours afficher les noms » le peint déjà dans le sprite :
 * le nœud HTML doit rester absent, l'opacité ne le cache pas.
 */
export function htmlHoverNameShown(alwaysShowNames: boolean, pointerOverPin: boolean): boolean {
  return !alwaysShowNames && pointerOverPin;
}

/** `throughWalls` : pas de test, et un ordre haut pour rester lisible. */
export function pinDepthFlags(throughWalls: boolean): PinDepthFlags {
  return {
    depthTest: !throughWalls,
    depthWrite: false,
    renderOrder: throughWalls ? PIN_ORDER_FRONT : 0,
  };
}

/**
 * Décale l'ancre vers la caméra de `margin` unités.
 *
 * On ne franchit pas la caméra : une marge plus grande que la distance
 * s'arrête à mi-chemin. `out` peut être le même vecteur que l'ancre.
 */
export function offsetTowardCamera(
  anchor: THREE.Vector3,
  camera: THREE.Vector3,
  margin: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  const dx = camera.x - anchor.x;
  const dy = camera.y - anchor.y;
  const dz = camera.z - anchor.z;
  const len = Math.hypot(dx, dy, dz);
  if (!(len > 1e-8) || !(margin > 0)) return out.copy(anchor);
  const step = Math.min(margin, len * 0.5);
  const k = step / len;
  return out.set(anchor.x + dx * k, anchor.y + dy * k, anchor.z + dz * k);
}

/** Taille monde d'un sprite pour qu'il couvre `pixels` de haut à l'écran. */
export function worldSizeForPixels(
  distance: number,
  fovDeg: number,
  viewportHeight: number,
  pixels: number,
): number {
  const dist = Math.max(distance, 1e-4);
  const h = Math.max(viewportHeight, 1);
  const fov = (fovDeg * Math.PI) / 180;
  return (pixels / h) * (2 * dist * Math.tan(fov / 2));
}

/** L'inverse : combien de pixels fait une taille monde à cette distance. */
export function pixelsForWorldSize(
  distance: number,
  fovDeg: number,
  viewportHeight: number,
  world: number,
): number {
  const dist = Math.max(distance, 1e-4);
  const h = Math.max(viewportHeight, 1);
  const fov = (fovDeg * Math.PI) / 180;
  const worldHeight = 2 * dist * Math.tan(fov / 2);
  if (!(worldHeight > 0)) return 0;
  return (world / worldHeight) * h;
}
