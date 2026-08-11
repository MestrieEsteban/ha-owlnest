/**
 * main.ts — la vitrine.
 *
 * Le parti pris : **la page fait tourner la vraie carte**, pas une vidéo ni des
 * captures. Le même web component que sur un dashboard, avec un `hass`
 * fabriqué. Ce qui se voit ici se voit chez soi.
 *
 * La scène est déduite du modèle au chargement — positions des ancres, ouvrants
 * et vues caméra sont calculées depuis sa boîte englobante et les noms de ses
 * mailles. Rien n'est codé en coordonnées absolues : changer de modèle ne
 * demande pas de retoucher ce fichier.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import '../src/ha-3d-floorplan';
import { buildPartIndex } from '../src/parts';
import type { OwlnestScene, OwlnestAnchor, OwlnestPart, CameraView, Hass, HassState } from '../src/types';
import type { OwlnestRule } from '../src/rules/types';

const MODEL = new URL('../Modele3D/flat-archi.glb', import.meta.url).href;

// `ha-icon` vient du frontend Home Assistant : ici un substitut minimal.
if (!customElements.get('ha-icon')) {
  customElements.define('ha-icon', class extends HTMLElement {
    connectedCallback() {
      this.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;font-size:11px;';
      this.textContent = '◆';
    }
  });
}

// ── Inspection du modèle ────────────────────────────────────────────────────

const gltf = await new GLTFLoader().loadAsync(MODEL);
const root = gltf.scene;

const meshes: THREE.Mesh[] = [];
root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) meshes.push(m); });

const box = new THREE.Box3().setFromObject(root);
const centre = box.getCenter(new THREE.Vector3());
const size = box.getSize(new THREE.Vector3());

/**
 * Un point du modèle exprimé dans le repère de la scène.
 *
 * La carte recentre le modèle sur l'origine : une position d'ancre doit donc
 * être donnée par rapport à ce centre, pas dans les coordonnées du fichier.
 */
const at = (fx: number, fy: number, fz: number): [number, number, number] => [
  +(box.min.x + size.x * fx - centre.x).toFixed(2),
  +(box.min.y + size.y * fy - centre.y).toFixed(2),
  +(box.min.z + size.z * fz - centre.z).toFixed(2),
];

/** Première pièce d'une maille, et son triangle d'amorce. */
function seed(mesh: THREE.Mesh) {
  const index = buildPartIndex(mesh.geometry);
  const part = index.parts[0];
  return part ? { triangle: part.tris[0], box: part.box } : null;
}

const byName = (re: RegExp) => meshes.filter((m) => re.test(m.name));

const doorMeshes = byName(/opening_on_hinge_\d+_door/i);
const paneMeshes = byName(/window_pane_on_hinge/i);

// ── Entités simulées ────────────────────────────────────────────────────────

const states: Record<string, HassState> = {
  'light.sejour':      { state: 'off', attributes: { friendly_name: 'Séjour', brightness: 0 } },
  'light.cuisine':     { state: 'off', attributes: { friendly_name: 'Cuisine', brightness: 0 } },
  'light.chambre':     { state: 'off', attributes: { friendly_name: 'Chambre', brightness: 0 } },
  'binary_sensor.porte': { state: 'off', attributes: { friendly_name: 'Porte', device_class: 'door' } },
  'cover.volet':       { state: 'closed', attributes: { friendly_name: 'Volet', device_class: 'shutter', current_position: 0 } },
  'sensor.temperature': { state: '21.4', attributes: { friendly_name: 'Température', unit_of_measurement: '°C', device_class: 'temperature' } },
  'sensor.humidite':   { state: '48', attributes: { friendly_name: 'Humidité', unit_of_measurement: '%', device_class: 'humidity' } },
};

// ── Scène ───────────────────────────────────────────────────────────────────

const CEIL = 0.82;   // hauteur des plafonniers, en fraction de la hauteur

const anchors: OwlnestAnchor[] = [
  { id: 'a1', entity: 'light.sejour',  label: 'Séjour',  position: at(0.30, CEIL, 0.30) },
  { id: 'a2', entity: 'light.cuisine', label: 'Cuisine', position: at(0.72, CEIL, 0.28) },
  { id: 'a3', entity: 'light.chambre', label: 'Chambre', position: at(0.52, CEIL, 0.76) },
  { id: 'a4', entity: 'sensor.temperature', label: 'Température', position: at(0.12, 0.55, 0.55) },
  { id: 'a5', entity: 'sensor.humidite',    label: 'Humidité',    position: at(0.88, 0.55, 0.62) },
  { id: 'a6', entity: 'cover.volet', label: 'Volet', position: at(0.50, 0.52, 0.06) },
  { id: 'a7', entity: 'binary_sensor.porte', label: 'Porte', position: at(0.45, 0.62, 0.50) },
];

const parts: OwlnestPart[] = [];
doorMeshes.slice(0, 1).forEach((mesh, i) => {
  const s = seed(mesh);
  if (!s) return;
  parts.push({
    id: `door_${i}`, entity: 'binary_sensor.porte', label: 'Porte',
    mesh: mesh.name, meshIndex: meshes.indexOf(mesh), triangle: s.triangle,
    motion: 'swing', hinge: 'start', angle: 92, duration: 1.1,
  });
});
paneMeshes.slice(0, 2).forEach((mesh, i) => {
  const s = seed(mesh);
  if (!s) return;
  parts.push({
    id: `pane_${i}`, entity: 'cover.volet', label: 'Fenêtre',
    mesh: mesh.name, meshIndex: meshes.indexOf(mesh), triangle: s.triangle,
    motion: 'swing', hinge: i % 2 ? 'end' : 'start', angle: 70, duration: 1.4,
  });
});

const camera_views: CameraView[] = [
  { id: 'v_all',     label: 'Ensemble', position: at(1.7, 1.5, 1.8),   target: at(0.5, 0.2, 0.5) },
  { id: 'v_sejour',  label: 'Séjour',   position: at(1.15, 0.85, 1.1), target: at(0.32, 0.25, 0.32) },
  { id: 'v_cuisine', label: 'Cuisine',  position: at(0.1, 0.8, 1.15),  target: at(0.72, 0.25, 0.3) },
];

const rules: OwlnestRule[] = [
  {
    id: 'r_porte', label: 'Porte ouverte', enabled: true, logic: 'and',
    triggers: [{ type: 'entity_state', entity_id: 'binary_sensor.porte', to: 'on' }],
    conditions: [],
    actions: [
      { type: 'highlight_anchor', anchor: 'light.sejour', color: '#7dd3fc', duration: 4 },
      { type: 'toast', message: 'Quelqu’un entre — le séjour est signalé' },
    ],
  },
];

const SCENE: OwlnestScene = {
  version: 1, scene_id: 'demo', model_url: MODEL,
  anchors, camera_views, cards: [], rules, parts,
  settings: {
    language: 'fr',
    rendering: { sky: true, shadows: true, sun_mode: 'showcase', exposure: 1.05, ground_style: 'disc' },
  } as OwlnestScene['settings'],
};

// ── `hass` simulé ───────────────────────────────────────────────────────────

const hass: Hass = {
  states,
  callService(domain, service, data) {
    // La démonstration doit réagir aux clics dans la scène comme le ferait la
    // vraie maison : sans cela, une lampe cliquée ne s'allumerait pas.
    const ids = ([] as string[]).concat((data?.entity_id as string) ?? []);
    for (const id of ids) {
      const st = states[id];
      if (!st) continue;
      if (domain === 'light' || domain === 'switch') {
        const on = service === 'turn_on' || (service === 'toggle' && st.state === 'off');
        st.state = on ? 'on' : 'off';
        st.attributes.brightness = on ? 210 : 0;
      } else if (domain === 'cover') {
        const open = service === 'open_cover'
          || (service === 'toggle' && st.state === 'closed');
        st.state = open ? 'open' : 'closed';
        st.attributes.current_position = open ? 100 : 0;
      }
    }
    push();
  },
  async callWS<T>(msg: Record<string, unknown>): Promise<T> {
    if (msg.type === 'owlnest/load_scene') return SCENE as T;
    if (msg.type === 'owlnest/list_scenes') return { scenes: ['demo'] } as T;
    if (msg.type === 'owlnest/save_scene') return SCENE as T;
    if (String(msg.type).startsWith('config/')) return [] as unknown as T;
    return [] as unknown as T;
  },
};

// ── Montage ─────────────────────────────────────────────────────────────────

type Card = HTMLElement & {
  hass: Hass;
  setConfig(c: Record<string, unknown>): void;
  modelLoaded?: boolean;
};

const card = document.createElement('ha-3d-floorplan') as Card;
card.style.cssText = 'display:block;width:100%;height:100%;';
document.getElementById('stage')!.appendChild(card);
card.setConfig({ scene_id: 'demo' });

/** Réassigner `hass` relance l'évaluation : le setter ne court-circuite pas. */
const push = () => { card.hass = { ...hass, states }; };
push();

// ── Visite guidée ───────────────────────────────────────────────────────────
//
// Chaque section décrit l'état de la maison qu'elle veut montrer. On applique
// un état complet et non un basculement : revenir en arrière dans la page doit
// remontrer la même chose.

type Step = () => void;

const set = (id: string, state: string, attrs: Record<string, unknown> = {}) => {
  const st = states[id];
  if (!st) return;
  st.state = state;
  Object.assign(st.attributes, attrs);
};

const lights = (on: boolean) => {
  for (const id of ['light.sejour', 'light.cuisine', 'light.chambre']) {
    set(id, on ? 'on' : 'off', { brightness: on ? 205 : 0 });
  }
};

const STEPS: Record<string, Step> = {
  intro: () => { lights(false); set('binary_sensor.porte', 'off'); set('cover.volet', 'closed', { current_position: 0 }); },
  lumieres: () => { lights(true); },
  ouvrants: () => { lights(true); set('binary_sensor.porte', 'on'); set('cover.volet', 'open', { current_position: 100 }); },
  capteurs: () => { set('sensor.temperature', '23.1'); set('sensor.humidite', '52'); },
  regles: () => {
    // La règle se déclenche sur la transition : on referme d'abord pour que
    // l'ouverture soit bien un changement d'état.
    set('binary_sensor.porte', 'off');
    push();
    setTimeout(() => { set('binary_sensor.porte', 'on'); push(); }, 400);
  },
  vues: () => {
    const el = card as unknown as { _flyToViewId?: (id: string) => void };
    el._flyToViewId?.('v_cuisine');
  },
};

/**
 * Point d'entrée de diagnostic.
 *
 * La visite guidée est pilotée par un `IntersectionObserver`, qui ne se
 * déclenche que dans un onglet qui produit des images — impossible à exercer
 * depuis un navigateur piloté hors écran. L'exposer permet de vérifier le
 * contenu de chaque étape indépendamment de son déclenchement.
 */
(window as unknown as Record<string, unknown>).owlnestDemo = {
  steps: STEPS,
  states,
  run(key: string) { STEPS[key]?.(); push(); },
  card,
};

let current = '';
const observer = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    const key = (e.target as HTMLElement).dataset.step ?? '';
    e.target.classList.add('seen');
    if (key === current) continue;
    current = key;
    STEPS[key]?.();
    push();
  }
}, { rootMargin: '-45% 0px -45% 0px' });

document.querySelectorAll('[data-step]').forEach((el) => observer.observe(el));

// ── Commandes manuelles ─────────────────────────────────────────────────────

document.querySelectorAll<HTMLButtonElement>('[data-do]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const [kind, arg] = (btn.dataset.do ?? '').split(':');
    if (kind === 'toggle') {
      const st = states[arg];
      if (!st) return;
      const domain = arg.split('.')[0];
      if (domain === 'cover') {
        const open = st.state === 'closed';
        set(arg, open ? 'open' : 'closed', { current_position: open ? 100 : 0 });
      } else if (domain === 'binary_sensor') {
        set(arg, st.state === 'on' ? 'off' : 'on');
      } else {
        const on = st.state === 'off';
        set(arg, on ? 'on' : 'off', { brightness: on ? 205 : 0 });
      }
      push();
    } else if (kind === 'view') {
      (card as unknown as { _flyToViewId?: (id: string) => void })._flyToViewId?.(arg);
    }
  });
});

// ── Chiffres réels affichés dans la page ────────────────────────────────────

const facts = {
  meshes: meshes.length,
  triangles: meshes.reduce((n, m) => {
    const i = m.geometry.getIndex();
    return n + (i ? i.count : m.geometry.getAttribute('position').count) / 3;
  }, 0),
  doors: doorMeshes.length,
  panes: paneMeshes.length,
  size: `${size.x.toFixed(0)} × ${size.z.toFixed(0)} cm`,
};
for (const [k, v] of Object.entries(facts)) {
  const el = document.querySelector(`[data-fact="${k}"]`);
  if (el) el.textContent = typeof v === 'number' ? v.toLocaleString('fr') : String(v);
}

document.body.classList.add('ready');
