/**
 * sky-paint.ts — un ciel peint, à la place du dégradé physique.
 *
 * Le ciel de three.js (diffusion atmosphérique) est juste mais nu : un dégradé,
 * calculé pour chaque pixel à chaque image. Ici le ciel est peint une fois sur
 * un canevas (dégradé, nuages, étoiles), puis sert de fond : une simple image à
 * afficher, moins chère pour une tablette que le shader, et plus vivante.
 *
 * Trois moments suivent le soleil : jour, crépuscule, nuit. Aucun fichier à
 * télécharger : tout est dessiné sur place.
 */

import * as THREE from 'three';

/** Le réglage : `auto` suit la météo, `simple` est le dégradé physique d'origine (pas peint). */
export type SkyStyle = 'auto' | 'clear' | 'clouds' | 'studio' | 'simple';
/** Ce qu'on peint. */
export type SkyLook = 'clear' | 'clouds' | 'overcast' | 'studio';

/**
 * Le ciel à peindre pour ce réglage et cette météo de Home Assistant. En
 * automatique : dégagé par beau temps, quelques nuages par temps variable (ou
 * sans météo connue), couvert dès qu'il pleut, neige ou qu'il y a du brouillard.
 */
export function skyLook(style: Exclude<SkyStyle, 'simple'>, weather: string): SkyLook {
  if (style !== 'auto') return style;
  if (weather === 'sunny' || weather === 'clear-night') return 'clear';
  if (!weather || weather === 'partlycloudy' || weather === 'windy' || weather === 'windy-variant') return 'clouds';
  return 'overcast';
}
export type SkyPhase = 'day' | 'dusk' | 'night';

/** Du zénith à l'horizon, puis sous l'horizon (là où le sol ne couvre pas). */
const PALETTE: Record<SkyPhase, { top: string; mid: string; low: string; under: string; cloud: string; shade: string }> = {
  day: { top: '#1c58b8', mid: '#4d92e2', low: '#b4d6f3', under: '#9fb4c4', cloud: '255,255,255', shade: '142,164,196' },
  dusk: { top: '#27406e', mid: '#8a78a8', low: '#f4b183', under: '#6a5a66', cloud: '255,206,170', shade: '96,78,112' },
  night: { top: '#050912', mid: '#0b1630', low: '#1a2744', under: '#0a101c', cloud: '70,86,124', shade: '24,32,54' },
};
/** Ciel couvert : des gris, sans étoiles, une nappe de nuages. */
const OVERCAST: typeof PALETTE = {
  day: { top: '#76808d', mid: '#9ca6b2', low: '#c6ccd3', under: '#8e959c', cloud: '226,230,235', shade: '112,121,132' },
  dusk: { top: '#383d4c', mid: '#655f6c', low: '#a48d84', under: '#57505a', cloud: '176,150,146', shade: '62,58,72' },
  night: { top: '#090c13', mid: '#111620', low: '#1b212d', under: '#0a0d14', cloud: '44,52,68', shade: '14,18,26' },
};
const pal = (look: SkyLook, phase: SkyPhase) => (look === 'overcast' ? OVERCAST : PALETTE)[phase];
const STUDIO = { top: '#0d1320', mid: '#17203a', low: '#26324a', under: '#0b1018' };

/**
 * Le canevas ne porte que le ciel, du zénith jusqu'un peu sous l'horizon : tous
 * ses pixels servent. À 4096 de large, nuages et étoiles restent nets à l'écran.
 */
const W = 4096, H = 1024;
/** Les mesures du dessin sont données pour un canevas de 1024 de large. */
const K = W / 1024;
/** Le dôme descend de 10° sous l'horizon : le sol ou la brume couvrent le raccord. */
const BELOW = 10;
const SPAN = 90 + BELOW;

/** Un hasard reproductible : le même ciel à chaque chargement. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Le moment du ciel d'après la hauteur du soleil, en degrés. */
export function skyPhase(elevation: number): SkyPhase {
  return elevation < -5 ? 'night' : elevation < 12 ? 'dusk' : 'day';
}

/** La couleur de la brume : celle de l'horizon, pour que le sol lointain s'y fonde. */
export function skyHorizon(style: SkyLook, phase: SkyPhase, exposure = 1.4): THREE.Color {
  const hex = style === 'studio' ? STUDIO.low : pal(style, phase).low;
  return untoned(new THREE.Color(hex), exposure);
}

/** Le rendu ACES de three.js, tel qu'il l'applique à tout ce qui n'est pas le ciel. */
function aces(r: number, g: number, b: number, exposure: number): [number, number, number] {
  const k = exposure / 0.6;
  r *= k; g *= k; b *= k;
  const fit = (v: number) => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081);
  const x = fit(0.59719 * r + 0.35458 * g + 0.04823 * b);
  const y = fit(0.076 * r + 0.90834 * g + 0.01566 * b);
  const z = fit(0.0284 * r + 0.13383 * g + 0.83777 * b);
  const sat = (v: number) => Math.min(1, Math.max(0, v));
  return [sat(1.60475 * x - 0.53108 * y - 0.07367 * z), sat(-0.10208 * x + 1.10813 * y - 0.00605 * z), sat(-0.00327 * x - 0.07276 * y + 1.07602 * z)];
}

/**
 * La couleur à donner à la brume pour qu'elle s'affiche exactement comme
 * `shown`. Le ciel est dessiné tel que peint, mais la brume (donc le sol au
 * loin) passe par l'exposition et le rendu ACES : sans cette correction les
 * deux ne se rejoignent pas, et on voit une coupure nette à l'horizon, surtout
 * la nuit. Le rendu n'a pas d'inverse simple : on l'approche en quelques pas.
 */
export function untoned(shown: THREE.Color, exposure: number): THREE.Color {
  const want = [shown.r, shown.g, shown.b];
  const x = [...want];
  for (let i = 0; i < 40; i++) {
    const got = aces(x[0], x[1], x[2], exposure);
    for (let c = 0; c < 3; c++) x[c] = Math.max(0, x[c] * ((want[c] + 1e-4) / (got[c] + 1e-4)));
  }
  // Une teinte claire ou vive demande des valeurs très fortes : mêlées au sol à
  // mi-distance, elles donnent une bande criarde (bleu de jour, orange au couchant). On retombe alors sur une simple atténuation.
  if (Math.max(x[0], x[1], x[2]) > 0.6) return shown.clone().multiplyScalar(0.6);
  return new THREE.Color().setRGB(x[0], x[1], x[2]);
}

/** La couleur sous l'horizon, là où ni sol ni brume ne couvrent. */
export function skyUnder(style: SkyLook, phase: SkyPhase): THREE.Color {
  return new THREE.Color(style === 'studio' ? STUDIO.under : pal(style, phase).under);
}

/** Peint le ciel sur un canevas (projection équirectangulaire : le zénith en haut, l'horizon au milieu). */
export function paintSky(style: SkyLook, phase: SkyPhase, canvas: HTMLCanvasElement): void {
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  if (!g) return;
  const p = style === 'studio' ? STUDIO : pal(style, phase);
  const horizon = H * (90 / SPAN);

  const sky = g.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, p.top);
  sky.addColorStop(0.6, p.mid);
  sky.addColorStop(1, p.low);
  g.fillStyle = sky;
  g.fillRect(0, 0, W, horizon);
  const under = g.createLinearGradient(0, horizon, 0, H);
  under.addColorStop(0, p.low);
  under.addColorStop(0.6, p.under);
  under.addColorStop(1, p.under);
  g.fillStyle = under;
  g.fillRect(0, horizon, W, H - horizon);
  if (style === 'studio') return;

  const rand = rng(phase === 'day' ? 11 : phase === 'dusk' ? 23 : 37);

  if (phase === 'night' && style !== 'overcast') {
    // Des étoiles, plus rares vers l'horizon où l'air est épais.
    for (let i = 0; i < 1400; i++) {
      const y = Math.pow(rand(), 1.4) * (horizon - 14 * K);
      const fade = 1 - y / horizon;
      g.fillStyle = `rgba(255,255,${220 + Math.round(rand() * 35)},${(0.25 + rand() * 0.75) * (0.35 + 0.65 * fade)})`;
      const r = rand() < 0.06 ? 1.7 : 0.7 + rand() * 0.6;
      g.beginPath();
      g.arc(rand() * W, y, r, 0, Math.PI * 2);
      g.fill();
    }
  }

}

const cache = new Map<string, THREE.Texture>();

function skyTexture(style: SkyLook, phase: SkyPhase): THREE.Texture {
  const key = style === 'studio' ? 'studio' : `${style}|${phase}`;
  let tex = cache.get(key);
  if (!tex) {
    const canvas = document.createElement('canvas');
    paintSky(style, phase, canvas);
    tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    cache.set(key, tex);
  }
  return tex;
}

/**
 * Le dôme du ciel : une demi-sphère vue de l'intérieur, centrée sur la caméra
 * à chaque image. Dessinée en premier, sans profondeur ni brume, et sans
 * passer par l'exposition du rendu : les couleurs sont celles du canevas.
 */
export class SkyDome {
  readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;

  constructor() {
    const geo = new THREE.SphereGeometry(1, 48, 16, 0, Math.PI * 2, 0, THREE.MathUtils.degToRad(SPAN));
    const mat = new THREE.MeshBasicMaterial({ side: THREE.BackSide, fog: false, depthTest: false, depthWrite: false, toneMapped: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'owlnest_sky';
    mesh.userData.owlnestHelper = true;
    mesh.renderOrder = -1000;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.raycast = () => {};
    mesh.onBeforeRender = (_r, _s, camera) => {
      const cam = camera as THREE.PerspectiveCamera;
      const r = (cam.near + cam.far) / 2;
      mesh.matrixWorld.makeScale(r, r, r).copyPosition(cam.matrixWorld);
    };
    this.mesh = mesh;
  }

  set(style: SkyLook, phase: SkyPhase) {
    const tex = skyTexture(style, phase);
    if (this.mesh.material.map !== tex) {
      this.mesh.material.map = tex;
      this.mesh.material.needsUpdate = true;
    }
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

// ── Nuages ──────────────────────────────────────────────────────────────────

/** Combien de nuages, leur taille, et leur teinte selon le moment. */
const CLOUDS: Record<Exclude<SkyLook, 'studio'>, { count: number; size: number; tint: Record<SkyPhase, number> }> = {
  clear: { count: 12, size: 0.8, tint: { day: 0xffffff, dusk: 0xffd9c2, night: 0x232c44 } },
  clouds: { count: 72, size: 1, tint: { day: 0xffffff, dusk: 0xffcfb4, night: 0x232c44 } },
  overcast: { count: 54, size: 1.6, tint: { day: 0xc3c9d1, dusk: 0x8f8088, night: 0x161b27 } },
};

/**
 * Des nuages en volumes à facettes, comme les arbres du jardin et la maison :
 * un ciel photographié jurait avec le reste, des taches floues faisaient faux.
 *
 * Ils suivent la caméra comme le dôme (aucune parallaxe : ils sont « à
 * l'infini ») et se dessinent juste après lui, avant tout le reste. Un seul
 * maillage instancié, donc un seul appel de dessin. Leur ombrage est figé
 * dans les couleurs des sommets (dessus clair, dessous sombre) : pas de calcul
 * de lumière. La profondeur qu'ils écrivent pour se recouvrir correctement
 * entre eux est effacée aussitôt, pour que rien de la scène ne passe derrière.
 */
export class SkyClouds {
  readonly mesh: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private key = '';

  constructor() {
    // Une boule à facettes ; chaque face porte une seule teinte, selon qu'elle regarde le ciel ou le sol.
    const geo = new THREE.IcosahedronGeometry(1, 1).toNonIndexed();
    geo.computeVertexNormals();
    const n = geo.getAttribute('normal');
    const col = new Float32Array(n.count * 3);
    for (let f = 0; f < n.count; f += 3) {
      const up = (n.getY(f) + n.getY(f + 1) + n.getY(f + 2)) / 3;
      const side = (n.getX(f) + n.getX(f + 1) + n.getX(f + 2)) / 3;
      const v = THREE.MathUtils.clamp(0.8 + up * 0.2 + side * 0.06, 0.55, 1);
      for (let k = 0; k < 3; k++) col.set([v, v, Math.min(1, v + 0.03)], (f + k) * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, toneMapped: false });
    const mesh = new THREE.InstancedMesh(geo, mat, 72 * 8);
    mesh.name = 'owlnest_clouds';
    mesh.userData.owlnestHelper = true;
    mesh.renderOrder = -999;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.raycast = () => {};
    mesh.count = 0;
    mesh.onBeforeRender = (_r, _s, camera) => {
      const cam = camera as THREE.PerspectiveCamera;
      const r = (cam.near + cam.far) / 2;
      mesh.matrixWorld.makeScale(r, r, r).copyPosition(cam.matrixWorld);
    };
    mesh.onAfterRender = (renderer) => renderer.clearDepth();
    this.mesh = mesh;
  }

  set(look: SkyLook, phase: SkyPhase) {
    if (look === 'studio') { this.mesh.count = 0; return; }
    const cfg = CLOUDS[look];
    this.mesh.material.color.setHex(cfg.tint[phase]);
    if (this.key === look) return;
    this.key = look;
    const rand = rng(look === 'clear' ? 5 : look === 'clouds' ? 17 : 29);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scale = new THREE.Vector3();
    const dir = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    let at = 0;
    for (let i = 0; i < cfg.count; i++) {
      // Réparti autour de l'horizon, bas dans le ciel : une carte se regarde de haut, on ne voit que cette bande.
      // Plus petit quand il est bas (donc loin).
      const az = ((i + rand() * 0.7) / cfg.count) * Math.PI * 2;
      const el = THREE.MathUtils.degToRad(look === 'overcast' ? 2 + rand() * 40 : 2 + Math.pow(rand(), 1.8) * 22);
      dir.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
      right.crossVectors(up, dir).normalize();
      const base = cfg.size * (0.026 + el * 0.11 + rand() * 0.014);
      const puffs = 5 + Math.floor(rand() * 4);
      for (let k = 0; k < puffs; k++) {
        // Une rangée de boules, les plus grosses au milieu, aplatie : la silhouette d'un cumulus.
        const t = puffs > 1 ? k / (puffs - 1) - 0.5 : 0;
        const r = base * (1 - Math.abs(t) * 1.1) * (0.8 + rand() * 0.4);
        pos.copy(dir).addScaledVector(right, t * base * 3.4).addScaledVector(up, r * 0.45 + (rand() - 0.5) * base * 0.25);
        scale.set(r * 1.25, r * 0.8, r * 1.25);
        q.setFromAxisAngle(up, rand() * Math.PI);
        this.mesh.setMatrixAt(at++, m.compose(pos, q, scale));
      }
    }
    this.mesh.count = at;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.dispose();
  }
}
