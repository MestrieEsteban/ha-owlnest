/**
 * parts-runtime.ts — anime les ouvrants du modèle d'après l'état des entités.
 *
 * L'analyse en composantes connexes reste dans l'éditeur : ici on ne fait que
 * retrouver une pièce à partir de son triangle d'amorce, la détacher une fois,
 * puis interpoler sa position à chaque image.
 *
 * Ce module ne pilote rien dans la maison. Il reflète ce que Home Assistant
 * rapporte — ouvrir une porte à l'écran n'ouvre pas la vraie.
 */
import * as THREE from 'three';
import type { OwlnestPart } from './types';
import { partIndexOf, extractPart, partFrame, hingePivot, axisName, type PartFrame } from './parts';
import { describeEntity } from './entities/descriptors';

// ── Lecture de l'état ─────────────────────────────────────────────

/**
 * Domaines dont l'état porte une notion d'ouverture.
 *
 * La liste est volontairement fermée. Le descripteur d'un `sensor` répond
 * `isOn: () => true` — ce qui est correct pour afficher un badge, un capteur
 * étant toujours « actif », mais catastrophique ici : la porte resterait
 * ouverte en permanence sans jamais réagir. Hors de cette liste, il faut donc
 * désigner les états à la main.
 */
const OPENABLE_DOMAINS = new Set([
  'cover', 'valve', 'lock', 'binary_sensor',
  'switch', 'light', 'input_boolean', 'fan', 'group',
]);

/**
 * Cette entité se lit-elle spontanément comme ouverte ou fermée ?
 *
 * Sert à l'éditeur pour réclamer un choix explicite plutôt que de laisser
 * l'utilisateur devant un ouvrant immobile sans explication.
 */
export function hasOpenSemantics(entityId: string): boolean {
  return OPENABLE_DOMAINS.has(entityId.split('.')[0]);
}

/**
 * Fraction d'ouverture d'une entité, de 0 (fermé) à 1 (grand ouvert).
 *
 * La sémantique vient des descripteurs, seule source de vérité du projet sur
 * « cette entité est-elle active ». Réécrire ici une table d'états revenait à
 * ignorer les 24 `device_class` de `binary_sensor` : un capteur d'ouverture y
 * répond `on`, mais un détecteur de fumée aussi, et seul le descripteur sait
 * lequel signifie « ouvert ».
 *
 * @param openWhen États choisis explicitement par l'utilisateur. Ils priment :
 *   aucune heuristique ne devinera le vocabulaire d'un capteur maison.
 */
export function openFraction(
  entityId: string,
  state: string | undefined,
  attributes?: Record<string, unknown>,
  openWhen?: string[],
): number {
  if (state === undefined || state === 'unavailable' || state === 'unknown') return 0;

  if (openWhen && openWhen.length) return openWhen.includes(state) ? 1 : 0;

  // Une position continue l'emporte sur le tout-ou-rien : un volet à 40 %
  // s'affiche à 40 %.
  const pos = attributes?.current_position;
  if (typeof pos === 'number' && Number.isFinite(pos)) {
    return Math.min(1, Math.max(0, pos / 100));
  }

  // Sans notion d'ouverture et sans choix explicite, l'ouvrant reste fermé.
  // Un immobilisme visible vaut mieux qu'une porte bloquée grande ouverte.
  if (!hasOpenSemantics(entityId)) return 0;

  return describeEntity(entityId).isOn({ state, attributes: attributes ?? {} }) ? 1 : 0;
}

// ── Animation ───────────────────────────────────────────────────────────────

/**
 * Un ouvrant vivant.
 *
 * La géométrie est figée par rapport à une arête de référence, mais le pivot
 * réel est porté par un nœud parent. Changer de côté de gonds ne demande donc
 * pas de redécouper le modèle : il suffit de déplacer ce nœud, ce qui rend
 * tous les réglages modifiables en direct.
 */
interface LiveMesh {
  cfg: OwlnestPart;
  /** Nœud animé : c'est lui qui tourne ou coulisse. */
  pivotNode: THREE.Group;
  /** Vantail, décalé dans le pivot pour compenser le côté choisi. */
  object: THREE.Mesh;
  frame: PartFrame;
  box: THREE.Box3;
  /** Position d'extraction de la géométrie, dans l'espace de la maille. */
  origin: THREE.Vector3;
  /** Amplitude maximale : radians pour un battant, unités pour un coulissant. */
  span: number;
  /** Axe animé et son signe. */
  axis: 'x' | 'y' | 'z';
  sign: number;
  rest: number;
  current: number;
  target: number;
}

/**
 * Mailles du modèle dans un ordre stable.
 *
 * `traverse` parcourt toujours le graphe dans le même ordre pour un fichier
 * donné : ce rang est donc un identifiant fiable, là où un nom ne l'est pas.
 */
export function meshOrder(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && !m.userData.owlnestPartId) out.push(m);
  });
  return out;
}

/** Retrouve la maille d'une configuration : par rang, sinon par nom. */
export function resolveMesh(
  order: THREE.Mesh[],
  cfg: { mesh: string; meshIndex?: number; triangle: number },
): THREE.Mesh | null {
  const fits = (m: THREE.Mesh | undefined) => {
    if (!m) return false;
    const idx = m.geometry.getIndex();
    const tris = (idx ? idx.count : m.geometry.getAttribute('position').count) / 3;
    return cfg.triangle < tris;
  };

  if (cfg.meshIndex !== undefined) {
    const byIndex = order[cfg.meshIndex];
    // Le nom doit concorder : un modèle réexporté peut avoir changé d'ordre, et
    // animer silencieusement une autre pièce serait pire qu'un ouvrant manquant.
    if (fits(byIndex) && byIndex.name === cfg.mesh) return byIndex;
  }
  return order.find((m) => m.name === cfg.mesh && fits(m)) ?? null;
}

export class PartController {
  private items: LiveMesh[] = [];
  private _built = false;

  get count() { return this.items.length; }
  get built() { return this._built; }

  /**
   * Détache les pièces décrites par la scène.
   *
   * Une configuration qui ne retrouve pas sa maille est ignorée sans bruit
   * dans la console mais signalée en retour : le modèle a pu changer entre
   * deux enregistrements, et ce n'est pas une erreur de programmation.
   */
  build(root: THREE.Object3D, configs: OwlnestPart[]): { ok: number; missing: OwlnestPart[] } {
    this.dispose(root);
    const missing: OwlnestPart[] = [];

    const order = meshOrder(root);

    for (const cfg of configs) {
      const mesh = resolveMesh(order, cfg);
      if (!mesh) { missing.push(cfg); continue; }

      const index = partIndexOf(mesh);
      const partId = index.ofTriangle[cfg.triangle];
      const part = partId >= 0 ? index.parts[partId] : undefined;
      if (!part) { missing.push(cfg); continue; }

      this.items.push(this._attach(mesh, part, cfg));
    }

    this._built = true;
    return { ok: this.items.length, missing };
  }

  private _attach(
    mesh: THREE.Mesh,
    part: { tris: Uint32Array; box: THREE.Box3; id: number },
    cfg: OwlnestPart,
  ): LiveMesh {
    // Toujours extrait du même côté : le côté des gonds se règle ensuite par
    // le nœud pivot, sans retoucher la géométrie.
    const { mesh: object, frame, pivot } = extractPart(mesh, part, 'start');
    object.userData.owlnestPartId = cfg.id;

    const pivotNode = new THREE.Group();
    pivotNode.userData.owlnestPartId = cfg.id;
    mesh.add(pivotNode);
    pivotNode.add(object);

    const item: LiveMesh = {
      cfg, pivotNode, object, frame, box: part.box, origin: pivot,
      span: 0, axis: 'x', sign: 1, rest: 0, current: 0, target: 0,
    };
    this._configure(item, cfg);
    return item;
  }

  /**
   * Recalcule les paramètres d'animation d'un ouvrant déjà détaché.
   *
   * Aucun de ces réglages ne touche à la géométrie : angle, sens, course, durée
   * et côté des gonds découlent tous du repère de la pièce, qu'on connaît déjà.
   * D'où la mise à jour immédiate dans l'éditeur.
   */
  private _configure(item: LiveMesh, cfg: OwlnestPart) {
    item.cfg = cfg;
    const frame = item.frame;
    const hinge = cfg.hinge ?? 'start';

    // Le nœud se place sur l'arête choisie ; le vantail se décale d'autant en
    // sens inverse pour ne pas bouger à l'écran.
    const seat = hingePivot(item.box, frame, hinge);
    item.pivotNode.position.copy(seat);
    item.object.position.copy(item.origin).sub(seat);
    item.pivotNode.rotation.set(0, 0, 0);

    if (cfg.motion === 'slide') {
      const dir = cfg.slide ?? 'down';
      const along = dir === 'down' || dir === 'up' ? frame.up : frame.wide;
      item.span = frame.size[along] * (cfg.travel ?? 1);
      item.axis = axisName(along);
      item.sign = dir === 'up' || dir === 'end' ? 1 : -1;
      item.rest = seat.getComponent(along);
    } else {
      item.span = THREE.MathUtils.degToRad(cfg.angle ?? 90);
      item.axis = axisName(frame.up);
      item.sign = hinge === 'start' ? -1 : 1;
      item.rest = 0;
    }
    this._place(item);
  }

  /**
   * Applique un réglage venu de l'éditeur, sans rien reconstruire.
   * Retourne `false` si l'ouvrant n'est pas (ou plus) monté.
   */
  configure(cfg: OwlnestPart): boolean {
    const item = this.items.find((i) => i.cfg.id === cfg.id);
    if (!item) return false;
    this._configure(item, cfg);
    return true;
  }

  /** Applique les états courants. Retourne `true` si une cible a changé. */
  applyStates(states: Record<string, { state: string; attributes?: Record<string, unknown> } | undefined>): boolean {
    let changed = false;
    for (const item of this.items) {
      const e = states[item.cfg.entity];
      let f = openFraction(item.cfg.entity, e?.state, e?.attributes, item.cfg.openWhen);
      if (item.cfg.invert) f = 1 - f;
      if (Math.abs(f - item.target) > 1e-4) {
        item.target = f;
        changed = true;
      }
    }
    return changed;
  }

  /**
   * Avance l'animation. Retourne `true` tant qu'un ouvrant bouge, pour que la
   * boucle de rendu sache qu'elle doit continuer à dessiner.
   */
  update(dt: number): boolean {
    let moving = false;
    for (const item of this.items) {
      const diff = item.target - item.current;
      if (Math.abs(diff) < 1e-4) {
        if (item.current !== item.target) { item.current = item.target; this._place(item); }
        continue;
      }
      const duration = Math.max(0.05, item.cfg.duration ?? 1.2);
      const step = dt / duration;
      item.current += Math.sign(diff) * Math.min(Math.abs(diff), step);
      this._place(item);
      moving = true;
    }
    return moving;
  }

  private _place(item: LiveMesh) {
    const value = item.current * item.span * item.sign;
    if (item.cfg.motion === 'slide') item.pivotNode.position[item.axis] = item.rest + value;
    else item.pivotNode.rotation[item.axis] = value;
  }

  /** Position d'un ouvrant, pour l'aperçu de l'éditeur. */
  preview(id: string, fraction: number) {
    const item = this.items.find((i) => i.cfg.id === id);
    if (item) item.target = Math.min(1, Math.max(0, fraction));
  }

  boxOf(id: string): THREE.Box3 | null {
    const item = this.items.find((i) => i.cfg.id === id);
    if (!item) return null;
    return new THREE.Box3().setFromObject(item.pivotNode);
  }

  /**
   * Remet le modèle dans son état d'origine.
   *
   * Les pièces détachées ont été retirées de leur maille : les recoller
   * proprement demanderait de conserver l'index initial. On recharge donc le
   * modèle, ce que fait déjà `_loadModel` — ici on se contente de libérer.
   */
  dispose(root?: THREE.Object3D) {
    for (const item of this.items) {
      item.pivotNode.parent?.remove(item.pivotNode);
      item.object.geometry.dispose();
    }
    this.items = [];
    this._built = false;
    root?.traverse((o) => { delete o.userData.__owlnestParts; });
  }
}

export { partFrame };
