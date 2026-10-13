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
export function skyHorizon(style: SkyLook, phase: SkyPhase): THREE.Color {
  const hex = style === 'studio' ? STUDIO.low : pal(style, phase).low;
  // Le ciel s'affiche tel que peint, la brume passe par l'exposition du rendu : on la retient d'autant.
  return new THREE.Color(hex).multiplyScalar(style === 'studio' || phase === 'night' ? 1 : phase === 'day' ? 0.6 : 0.7);
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

  if (style === 'clear') return;
  const c = pal(style, phase);
  const heavy = style === 'overcast';
  // Une touffe : un rond flou, dessiné aussi de l'autre côté du raccord gauche-droite.
  const puff = (x: number, y: number, r: number, rgb: string, alpha: number) => {
    for (const dx of [-W, 0, W]) {
      if (x + dx + r < 0 || x + dx - r > W) continue;
      const grad = g.createRadialGradient(x + dx, y, 0, x + dx, y, r);
      grad.addColorStop(0, `rgba(${rgb},${alpha})`);
      grad.addColorStop(0.55, `rgba(${rgb},${alpha * 0.55})`);
      grad.addColorStop(1, `rgba(${rgb},0)`);
      g.fillStyle = grad;
      g.fillRect(x + dx - r, y - r, r * 2, r * 2);
    }
  };
  const strength = (phase === 'night' ? 0.4 : 1) * (heavy ? 1.15 : 1);
  for (let i = 0; i < (heavy ? 170 : 64); i++) {
    // Les nuages se tiennent entre l'horizon et 45° de hauteur, plus petits au loin : plus haut, la projection les étirerait.
    const up = heavy ? 0.02 + rand() * 0.62 : 0.03 + Math.pow(rand(), 1.3) * 0.47;
    const cy = horizon - up * horizon * 0.95;
    const cx = rand() * W;
    const size = (7 + up * 34 + rand() * 12) * K * (heavy ? 2 : 1);
    const n = 9 + Math.floor(rand() * 8);
    g.save();
    g.translate(0, cy);
    g.scale(1, 0.38);
    // Le dessous d'abord, plus sombre, puis le dessus éclairé.
    for (let k = 0; k < n; k++) puff(cx + (rand() - 0.5) * size * 3.2, size * 0.55 + (rand() - 0.5) * size * 0.4, size * (0.55 + rand() * 0.45), c.shade, 0.36 * strength);
    for (let k = 0; k < n; k++) puff(cx + (rand() - 0.5) * size * 3, (rand() - 0.5) * size * 0.7, size * (0.4 + rand() * 0.5), c.cloud, 0.62 * strength);
    g.restore();
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
