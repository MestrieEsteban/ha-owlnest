/**
 * cutaway.ts — effacer le haut du modèle pour voir à l'intérieur.
 *
 * Trois approches possibles, et une seule tient sur un modèle réel :
 *
 *  - **Plan de découpe.** Net et gratuit, mais il tranche : les murs, qui sont
 *    des volumes fermés, montrent alors leur intérieur creux, et le mobilier
 *    est sectionné au même trait.
 *  - **Transparence classique.** Impose de trier les objets par profondeur.
 *    Sur un export à 242 matériaux mêlant opaque et verre, le tri produit des
 *    recouvrements aberrants — un mur qui disparaît derrière une vitre.
 *  - **Fondu tramé.** Les matériaux restent opaques ; on écarte des pixels
 *    selon un motif fin, de plus en plus dense vers le haut. À l'œil c'est une
 *    transparence, mais la profondeur reste exacte et aucun tri n'est requis.
 *
 * C'est la troisième qui est implémentée ici.
 */
import * as THREE from 'three';

export interface CutawaySettings {
  /** Normale de la coupe, dirigée vers le haut du modèle. */
  up: THREE.Vector3;
  /** Hauteur à laquelle plus rien n'est visible, projetée sur `up`. */
  top: number;
  /** Hauteur à partir de laquelle le fondu commence. */
  bottom: number;
}

/** Matériau instrumenté, avec ses uniformes accessibles. */
interface Patched extends THREE.Material {
  userData: {
    owlnestCutaway?: {
      up: { value: THREE.Vector3 };
      top: { value: number };
      bottom: { value: number };
    };
  };
}

/**
 * Matrice de Bayer 4×4, en une expression.
 *
 * Elle donne à chaque pixel un seuil différent, réparti régulièrement. Comparé
 * au taux d'opacité voulu, ce seuil décide si le pixel survit — d'où un motif
 * fin et stable plutôt qu'un bruit qui scintille quand la caméra bouge.
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

/** Injecte le fondu dans un matériau, une seule fois. */
function patch(material: THREE.Material, settings: CutawaySettings) {
  const m = material as Patched;
  if (m.userData.owlnestCutaway) {
    m.userData.owlnestCutaway.up.value.copy(settings.up);
    m.userData.owlnestCutaway.top.value = settings.top;
    m.userData.owlnestCutaway.bottom.value = settings.bottom;
    return;
  }

  const uniforms = {
    up: { value: settings.up.clone() },
    top: { value: settings.top },
    bottom: { value: settings.bottom },
  };
  m.userData.owlnestCutaway = uniforms;

  /**
   * Clé de cache distincte.
   *
   * Three.js réutilise un programme compilé dès que les paramètres du matériau
   * coïncident. `onBeforeCompile` n'entre pas dans ce calcul : sans clé propre,
   * le moteur ressert le programme d'origine et l'injection reste sans effet —
   * exactement le symptôme observé, shaders modifiés mais rendu inchangé.
   */
  m.customProgramCacheKey = () => 'owlnest-cutaway';

  const previous = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    previous?.call(m, shader, renderer);
    shader.uniforms.owlnestUp = uniforms.up;
    shader.uniforms.owlnestTop = uniforms.top;
    shader.uniforms.owlnestBottom = uniforms.bottom;

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
uniform vec3 owlnestUp;
uniform float owlnestTop;
uniform float owlnestBottom;
${BAYER}`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
{
  float h = dot(owlnestUp, vOwlnestWorld);
  // 1 sous la bande, 0 au-dessus : la part de pixels conservés.
  float keep = 1.0 - clamp((h - owlnestBottom) / max(owlnestTop - owlnestBottom, 1e-6), 0.0, 1.0);
  if (keep < owlnestBayer(gl_FragCoord.xy)) discard;
}`,
      );
  };
  m.needsUpdate = true;
}

/**
 * Applique le fondu à tout le modèle.
 *
 * Le shader d'ombre est laissé tel quel : un mur effacé continue de projeter
 * son ombre. C'est volontaire — sans cela, ouvrir la vue effacerait aussi
 * l'éclairage intérieur, qui est précisément ce qu'on cherche à observer.
 */
export function applyCutaway(root: THREE.Object3D, settings: CutawaySettings): number {
  const seen = new Set<THREE.Material>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (!mat || seen.has(mat)) continue;
      seen.add(mat);
      patch(mat, settings);
    }
  });
  return seen.size;
}

/**
 * Désactive le fondu sans recompiler quoi que ce soit.
 *
 * On repousse la bande hors du modèle plutôt que de retirer l'injection : un
 * `needsUpdate` sur des centaines de matériaux coûterait une recompilation
 * complète à chaque mouvement du curseur.
 */
export function clearCutaway(root: THREE.Object3D) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      const u = (mat as Patched)?.userData?.owlnestCutaway;
      if (!u) continue;
      u.bottom.value = Number.POSITIVE_INFINITY;
      u.top.value = Number.POSITIVE_INFINITY;
    }
  });
}

/**
 * Bande de fondu à partir d'une hauteur de coupe.
 *
 * Le fondu commence sous le trait et s'achève dessus : l'utilisateur règle « à
 * quelle hauteur je ne vois plus rien », ce qui est plus intuitif que le milieu
 * d'un dégradé.
 */
export function bandFor(
  min: number,
  max: number,
  fraction: number,
  softness = 0.35,
): { top: number; bottom: number } {
  const height = max - min;
  const top = min + height * fraction;
  return { top, bottom: top - height * softness };
}
