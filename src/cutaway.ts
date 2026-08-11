/**
 * cutaway.ts — voir à travers les murs extérieurs.
 *
 * Ce qui se trouve entre la caméra et l'intérieur du logement n'est pas dessiné.
 * En tournant autour, le mur qui bouche la vue s'en va et se reforme derrière ;
 * le reste de la maison reste intact.
 *
 * Deux approches ont été écartées, et il vaut la peine de dire pourquoi :
 *
 *  - **La transparence.** Elle impose de trier les objets par profondeur. Sur un
 *    export à 242 matériaux mêlant murs opaques et vitrages, le tri produit des
 *    recouvrements aberrants — un mur qui disparaît derrière une fenêtre.
 *  - **Le fondu tramé.** Il évite le tri, mais un fondu progressif met une large
 *    part de l'image à mi-opacité, donc au maximum de grain : le mobilier, les
 *    plantes et l'écran se retrouvaient pointillés autant que le mur. Essayé,
 *    mesuré, jugé laid.
 *
 * Le rejet franc seul a été jugé trop brutal : le mur disparaît d'un coup, on
 * perd le repère.
 *
 * La solution retenue combine les deux : **la scène est dessinée sans le mur**,
 * puis une **seconde passe** repose par-dessus un calque translucide qui ne garde
 * que ce qui a été retiré. On voit donc le mur en filigrane, et l'intérieur au
 * travers.
 *
 * Cette passe échappe au problème de tri : c'est une couche unique posée sur une
 * image déjà opaque, sans écriture de profondeur. Elle coûte en revanche un
 * second envoi de la géométrie — mesuré avant d'être retenu.
 */
import * as THREE from 'three';

/**
 * Uniformes partagés par **tous** les matériaux du modèle.
 *
 * Un seul jeu d'objets, référencé par chaque shader : suivre la caméra à chaque
 * image coûte alors trois écritures, et non trois par matériau — ce qui
 * compterait sur un export à plusieurs centaines de matériaux.
 */
export interface CutawayUniforms {
  /** Position de la caméra, en coordonnées monde. */
  camPos: { value: THREE.Vector3 };
  /** Direction de visée, normalisée. */
  camDir: { value: THREE.Vector3 };
  /** Profondeur en deçà de laquelle rien n'est dessiné. */
  near: { value: number };
  /** 1 = effacement actif. */
  on: { value: number };
}

export function createUniforms(): CutawayUniforms {
  return {
    camPos: { value: new THREE.Vector3() },
    camDir: { value: new THREE.Vector3(0, 0, -1) },
    near: { value: 0 },
    on: { value: 0 },
  };
}

interface Patched extends THREE.Material {
  userData: { owlnestCutaway?: true };
}

/** Injecte le rejet dans un matériau, une seule fois. */
function patch(material: THREE.Material, u: CutawayUniforms) {
  const m = material as Patched;
  if (m.userData.owlnestCutaway) return;
  m.userData.owlnestCutaway = true;

  /**
   * Clé de cache distincte.
   *
   * Three.js réutilise un programme compilé dès que les paramètres du matériau
   * coïncident, et `onBeforeCompile` n'entre pas dans ce calcul. Sans clé
   * propre, le moteur ressert le programme d'origine : les shaders sont bien
   * modifiés, mais l'image ne change pas. Symptôme parfaitement trompeur.
   */
  m.customProgramCacheKey = () => 'owlnest-cutaway';

  const previous = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    previous?.call(m, shader, renderer);
    shader.uniforms.owlnestCamPos = u.camPos;
    shader.uniforms.owlnestCamDir = u.camDir;
    shader.uniforms.owlnestNear = u.near;
    shader.uniforms.owlnestOn = u.on;

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vOwlnestWorld;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvOwlnestWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vOwlnestWorld;
uniform vec3 owlnestCamPos;
uniform vec3 owlnestCamDir;
uniform float owlnestNear;
uniform float owlnestOn;`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
if (owlnestOn > 0.5) {
  // Profondeur du fragment le long de l'axe de visée.
  float owlnestDepth = dot(owlnestCamDir, vOwlnestWorld - owlnestCamPos);
  if (owlnestDepth < owlnestNear) discard;
}`,
      );
  };
  m.needsUpdate = true;
}

/**
 * Instrumente tous les matériaux du modèle.
 *
 * Le shader d'ombre est laissé tel quel : un mur effacé continue de projeter son
 * ombre. C'est volontaire — sans cela, dégager la vue supprimerait aussi
 * l'éclairage intérieur, qui est précisément ce qu'on cherche à observer.
 *
 * @returns Le nombre de matériaux instrumentés.
 */
export function instrumentMaterials(root: THREE.Object3D, u: CutawayUniforms): number {
  const seen = new Set<THREE.Material>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (!mat || seen.has(mat)) continue;
      seen.add(mat);
      patch(mat, u);
    }
  });
  return seen.size;
}

/**
 * Recale le seuil sur la caméra.
 *
 * `strength` va de 0 (inactif) à 1 : c'est la **profondeur dégagée**, mesurée
 * depuis la surface du modèle la plus proche et exprimée en fraction de son
 * rayon. À 1, tout ce qui est devant le centre du logement disparaît.
 *
 * L'échelle porte sur le rayon du modèle, et non sur la distance à la caméra :
 * le mur de façade se trouve déjà à quelque 70 % du trajet, si bien qu'un
 * réglage en fraction de distance laissait les deux tiers du curseur sans effet.
 *
 * À appeler à chaque image où la caméra a bougé.
 */
export function updateXray(
  u: CutawayUniforms,
  camera: THREE.Camera,
  target: THREE.Vector3,
  strength: number,
  radius: number,
) {
  if (!(strength > 0) || !(radius > 0)) { u.on.value = 0; return; }

  camera.getWorldPosition(u.camPos.value);
  camera.getWorldDirection(u.camDir.value);

  // Distance à la cible, projetée sur l'axe de visée.
  const toTarget = target.clone().sub(u.camPos.value);
  const distance = Math.max(toTarget.dot(u.camDir.value), 1e-6);

  // La surface la plus proche du modèle : point de départ du dégagement.
  const nearFace = distance - radius;
  u.near.value = nearFace + radius * Math.min(Math.max(strength, 0), 1);
  u.on.value = 1;
}

/**
 * Calque translucide du mur retiré.
 *
 * Les mailles partagent la géométrie de l'original — aucune copie en mémoire —
 * et n'en diffèrent que par le matériau : non éclairé, translucide, sans
 * écriture de profondeur, dessiné après les opaques.
 *
 * Le test de profondeur reste actif : le calque est la chose la plus proche de
 * la caméra, il passe donc, mais reste masqué par ce qui serait devant lui.
 */
export function createGhost(
  root: THREE.Object3D,
  u: CutawayUniforms,
  opacity = 0.22,
): THREE.Group {
  const ghost = new THREE.Group();
  ghost.name = 'owlnest-ghost';
  ghost.renderOrder = 10;

  const material = new THREE.MeshBasicMaterial({
    color: 0xdfe6ee,
    transparent: true,
    opacity,
    depthWrite: false,
    // Une seule face : un mur a deux parois, les cumuler doublerait la densité.
    side: THREE.FrontSide,
  });
  material.customProgramCacheKey = () => 'owlnest-ghost';
  material.onBeforeCompile = (shader) => {
    shader.uniforms.owlnestCamPos = u.camPos;
    shader.uniforms.owlnestCamDir = u.camDir;
    shader.uniforms.owlnestNear = u.near;
    shader.uniforms.owlnestOn = u.on;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vOwlnestWorld;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvOwlnestWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vOwlnestWorld;
uniform vec3 owlnestCamPos;
uniform vec3 owlnestCamDir;
uniform float owlnestNear;
uniform float owlnestOn;`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
// Exactement l'inverse de la passe opaque : on ne garde que ce qu'elle a retiré.
if (owlnestOn < 0.5) discard;
{
  float owlnestDepth = dot(owlnestCamDir, vOwlnestWorld - owlnestCamPos);
  if (owlnestDepth >= owlnestNear) discard;
}`,
      );
  };

  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || mesh.userData.owlnestPartId) return;
    const copy = new THREE.Mesh(mesh.geometry, material);
    mesh.updateWorldMatrix(true, false);
    copy.matrixAutoUpdate = false;
    copy.matrix.copy(mesh.matrixWorld);
    copy.castShadow = false;
    copy.receiveShadow = false;
    copy.raycast = () => {};
    ghost.add(copy);
  });

  return ghost;
}
