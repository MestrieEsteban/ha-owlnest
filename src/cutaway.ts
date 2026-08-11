/**
 * cutaway.ts — voir à l'intérieur du logement.
 *
 * Deux façons de dégager la vue, réglables indépendamment :
 *
 *  - **À travers les murs** (`xray`). Ce qui se trouve entre la caméra et le
 *    cœur du logement s'efface. En tournant autour, le mur qui bouche la vue
 *    disparaît et se reforme derrière — le reste de la maison reste plein.
 *  - **Coupe horizontale** (`cut`). Tout ce qui dépasse d'une hauteur donnée
 *    s'efface : toiture, plafonds, murs hauts.
 *
 * Dans les deux cas l'effacement est **tramé**, pas transparent. Trois
 * approches étaient possibles :
 *
 *  - un plan de découpe : net et gratuit, mais il tranche — les murs, qui sont
 *    des volumes fermés, montrent alors leur intérieur creux ;
 *  - une vraie transparence : impose de trier les objets par profondeur, et sur
 *    un export à 242 matériaux mêlant opaque et verre le tri produit des
 *    recouvrements aberrants ;
 *  - un fondu tramé : les matériaux restent opaques, on écarte des pixels selon
 *    un motif fin. À l'œil c'est une transparence, mais la profondeur reste
 *    exacte et aucun tri n'est requis.
 *
 * C'est la troisième qui est retenue, comme dans les moteurs de jeu qui
 * escamotent un mur devant la caméra.
 */
import * as THREE from 'three';

/**
 * Uniformes partagés par **tous** les matériaux du modèle.
 *
 * Un seul jeu d'objets, référencé par chaque shader : mettre à jour la caméra
 * à chaque image coûte alors trois écritures, et non trois par matériau — ce
 * qui compterait sur un export à plusieurs centaines de matériaux.
 */
export interface CutawayUniforms {
  /** Position de la caméra, en coordonnées monde. */
  camPos: { value: THREE.Vector3 };
  /** Direction de visée, normalisée. */
  camDir: { value: THREE.Vector3 };
  /** Profondeur en deçà de laquelle plus rien n'est visible. */
  xrayStart: { value: number };
  /** Profondeur à partir de laquelle tout est visible. */
  xrayEnd: { value: number };
  /** 1 = effacement à travers les murs actif. */
  xrayOn: { value: number };

  /** Verticale du modèle. */
  up: { value: THREE.Vector3 };
  /** Hauteur au-delà de laquelle plus rien n'est visible. */
  cutTop: { value: number };
  /** Hauteur à laquelle le fondu commence. */
  cutBottom: { value: number };
  /** 1 = coupe horizontale active. */
  cutOn: { value: number };
}

export function createUniforms(): CutawayUniforms {
  return {
    camPos: { value: new THREE.Vector3() },
    camDir: { value: new THREE.Vector3(0, 0, -1) },
    xrayStart: { value: 0 },
    xrayEnd: { value: 1 },
    xrayOn: { value: 0 },
    up: { value: new THREE.Vector3(0, 1, 0) },
    cutTop: { value: 1 },
    cutBottom: { value: 0 },
    cutOn: { value: 0 },
  };
}

/**
 * Matrice de Bayer 4×4.
 *
 * Elle donne à chaque pixel un seuil différent, réparti régulièrement. Comparé
 * au taux d'opacité voulu, ce seuil décide si le pixel survit — d'où un motif
 * fin et stable, plutôt qu'un bruit qui grouille dès que la caméra bouge.
 */
const BAYER = /* glsl */`
float owlnestBayer(vec2 p) {
  vec2 c = mod(floor(p), 4.0);
  int i = int(c.x) + int(c.y) * 4;
  float m[16];
  m[0]=0.0;  m[1]=8.0;  m[2]=2.0;  m[3]=10.0;
  m[4]=12.0; m[5]=4.0;  m[6]=14.0; m[7]=6.0;
  m[8]=3.0;  m[9]=11.0; m[10]=1.0; m[11]=9.0;
  m[12]=15.0;m[13]=7.0; m[14]=13.0;m[15]=5.0;
  float v = 0.0;
  for (int k = 0; k < 16; k++) { if (k == i) v = m[k]; }
  return (v + 0.5) / 16.0;
}
`;

interface Patched extends THREE.Material {
  userData: { owlnestCutaway?: true };
}

/** Injecte le fondu dans un matériau, une seule fois. */
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
    shader.uniforms.owlnestXrayStart = u.xrayStart;
    shader.uniforms.owlnestXrayEnd = u.xrayEnd;
    shader.uniforms.owlnestXrayOn = u.xrayOn;
    shader.uniforms.owlnestUp = u.up;
    shader.uniforms.owlnestCutTop = u.cutTop;
    shader.uniforms.owlnestCutBottom = u.cutBottom;
    shader.uniforms.owlnestCutOn = u.cutOn;

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
uniform float owlnestXrayStart;
uniform float owlnestXrayEnd;
uniform float owlnestXrayOn;
uniform vec3 owlnestUp;
uniform float owlnestCutTop;
uniform float owlnestCutBottom;
uniform float owlnestCutOn;
${BAYER}`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
{
  // Profondeur du fragment le long de l'axe de visée : ce qui est devant le
  // cœur du logement s'efface, ce qui est derrière reste plein.
  float depth = dot(owlnestCamDir, vOwlnestWorld - owlnestCamPos);
  float keepX = clamp(
    (depth - owlnestXrayStart) / max(owlnestXrayEnd - owlnestXrayStart, 1e-6), 0.0, 1.0);

  float h = dot(owlnestUp, vOwlnestWorld);
  float keepC = 1.0 - clamp(
    (h - owlnestCutBottom) / max(owlnestCutTop - owlnestCutBottom, 1e-6), 0.0, 1.0);

  // Chaque effet est neutre quand il est éteint ; le plus contraignant décide.
  float keep = min(mix(1.0, keepX, owlnestXrayOn), mix(1.0, keepC, owlnestCutOn));
  if (keep < owlnestBayer(gl_FragCoord.xy)) discard;
}`,
      );
  };
  m.needsUpdate = true;
}

/**
 * Instrumente tous les matériaux du modèle.
 *
 * Le shader d'ombre est laissé tel quel : un mur effacé continue de projeter
 * son ombre. C'est volontaire — sans cela, dégager la vue supprimerait aussi
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
 * Met à jour l'effacement « à travers les murs » depuis la caméra.
 *
 * `strength` va de 0 (inactif) à 1 : c'est la **profondeur dégagée**, mesurée
 * depuis la surface du modèle la plus proche de la caméra et exprimée en
 * fraction de son rayon. À 1, tout ce qui se trouve devant le centre du
 * logement a disparu.
 *
 * L'échelle porte sur le rayon du modèle, et non sur la distance à la caméra :
 * le mur de façade se trouve déjà à quelque 70 % du trajet, si bien qu'un
 * réglage en fraction de distance laissait les deux tiers du curseur sans effet.
 *
 * Le sens compte aussi : une première version faisait de `strength` la largeur
 * du dégradé, ce qui **adoucissait** l'effet quand on montait le curseur au lieu
 * de dégager davantage.
 *
 * À appeler à chaque image où la caméra a bougé : trois écritures d'uniformes,
 * quel que soit le nombre de matériaux.
 */
export function updateXray(
  u: CutawayUniforms,
  camera: THREE.Camera,
  target: THREE.Vector3,
  strength: number,
  radius: number,
) {
  if (!(strength > 0) || !(radius > 0)) { u.xrayOn.value = 0; return; }

  camera.getWorldPosition(u.camPos.value);
  camera.getWorldDirection(u.camDir.value);

  // Distance à la cible, projetée sur l'axe de visée.
  const toTarget = target.clone().sub(u.camPos.value);
  const distance = Math.max(toTarget.dot(u.camDir.value), 1e-6);

  // La surface la plus proche du modèle : point de départ du dégagement.
  const nearFace = distance - radius;
  const start = nearFace + radius * Math.min(Math.max(strength, 0), 1);
  u.xrayStart.value = start;
  u.xrayEnd.value = Math.min(distance + radius, start + radius * 0.3);
  u.xrayOn.value = 1;
}

/** Met à jour la coupe horizontale. `fraction` vaut 1 pour la désactiver. */
export function updateCut(
  u: CutawayUniforms,
  up: THREE.Vector3,
  min: number,
  max: number,
  fraction: number,
  softness = 0.35,
) {
  if (!(fraction < 1)) { u.cutOn.value = 0; return; }
  const height = max - min;
  u.up.value.copy(up);
  u.cutTop.value = min + height * Math.max(0, fraction);
  u.cutBottom.value = u.cutTop.value - height * softness;
  u.cutOn.value = 1;
}
