/**
 * effects-runtime.ts — effets visuels pilotés par des entités (sans mouvement).
 *
 * - `material` : teinte + lueur sur copies de matériaux (jamais l'original),
 *   ou arêtes colorées (`style: 'outline'`).
 * - `visibility` : montre / cache la cible ; la visibilité d'origine est
 *   mémorisée au montage et rendue au démontage.
 *
 * Une configuration peut viser plusieurs objets (`targets`) : même condition,
 * même apparence. On marque `owlnestLive` pour que le batching laisse chaque
 * cible hors fusion — on ne cache jamais un hôte de batch qui emporterait des
 * ouvrants.
 */
import * as THREE from 'three';
import type { EffectTarget, OwlnestEffect } from './types';
import { stampOrder, nodeOrder, resolveNode } from './model-outline';
import { resolveMesh, meshOrder } from './parts-runtime';
import { describeEntity } from './entities/descriptors';
import { PartTint, tintColor, DEFAULT_TINT_STRENGTH, DEFAULT_GLOW } from './part-tint';

/** Valeurs d'attribut qui ne doivent pas allumer l'effet sans `when` explicite. */
const IDLE_ATTR = new Set(['', 'off', 'idle', 'none', 'false', '0', 'unavailable', 'unknown']);

/**
 * La condition de l'effet est-elle vraie pour cet état HA ?
 *
 * `when` prime. Sinon : sans attribut, lecture « on » du descripteur ; avec
 * attribut, toute valeur hors des synonymes d'arrêt.
 */
export function effectMatches(
  entityId: string,
  state: string | undefined,
  attributes?: Record<string, unknown>,
  attribute?: string,
  when?: string[],
): boolean {
  if (state === undefined || state === 'unavailable' || state === 'unknown') return false;

  let value: string | undefined;
  if (attribute) {
    const raw = attributes?.[attribute];
    if (raw === undefined || raw === null) return false;
    value = String(raw);
  } else {
    value = state;
  }

  if (when && when.length) return when.includes(value);

  if (attribute) return !IDLE_ATTR.has(value.trim().toLowerCase());

  return describeEntity(entityId).isOn({ state, attributes: attributes ?? {} });
}

/** Condition effective après `invert`. */
export function effectActive(
  cfg: Pick<OwlnestEffect, 'entity' | 'attribute' | 'when' | 'invert'>,
  state: string | undefined,
  attributes?: Record<string, unknown>,
): boolean {
  const match = effectMatches(cfg.entity, state, attributes, cfg.attribute, cfg.when);
  return cfg.invert ? !match : match;
}

/** Clé stable d'une seule cible (nœud ou maille). */
export function effectRefKey(ref: {
  mesh: string;
  meshIndex?: number;
  triangle: number;
  node?: string;
  nodeIndex?: number;
}): string {
  return ref.node
    ? `node:${ref.node}#${ref.nodeIndex ?? ''}`
    : `mesh:${ref.mesh}#${ref.meshIndex ?? ''}:${ref.triangle}`;
}

/**
 * Cible principale + `targets` supplémentaires.
 *
 * La principale reste sur les champs plats pour les scènes enregistrées avant
 * la liste multi-objets.
 */
export function effectTargets(cfg: OwlnestEffect): EffectTarget[] {
  const primary: EffectTarget = {
    mesh: cfg.mesh,
    meshIndex: cfg.meshIndex,
    triangle: cfg.triangle,
    node: cfg.node,
    nodeIndex: cfg.nodeIndex,
  };
  return [primary, ...(cfg.targets ?? [])];
}

/** Empreinte de toutes les cibles : un changement force un remontage. */
export function effectTargetKey(cfg: OwlnestEffect): string {
  return effectTargets(cfg).map(effectRefKey).join('+');
}

/**
 * Retire la cible d'indice `index` dans `effectTargets(cfg)`.
 *
 * Si c'est la principale, la suivante est promue aux champs plats (compat
 * scènes enregistrées). Aucune cible restante : inchangé (l'appelant garde
 * au moins une entrée).
 */
export function effectWithoutTarget(cfg: OwlnestEffect, index: number): OwlnestEffect {
  const all = effectTargets(cfg);
  if (index < 0 || index >= all.length || all.length <= 1) return cfg;
  const remaining = all.filter((_, i) => i !== index);
  const [primary, ...rest] = remaining;
  return {
    ...cfg,
    mesh: primary.mesh,
    meshIndex: primary.meshIndex,
    triangle: primary.triangle,
    node: primary.node,
    nodeIndex: primary.nodeIndex,
    targets: rest.length
      ? rest.map((t) => ({
          mesh: t.mesh,
          meshIndex: t.meshIndex,
          triangle: t.triangle,
          node: t.node,
          nodeIndex: t.nodeIndex,
          label: t.label,
        }))
      : undefined,
  };
}

/** Ajoute une cible si elle n'est pas déjà dans la liste (principale ou extras). */
export function effectWithTarget(cfg: OwlnestEffect, target: EffectTarget): OwlnestEffect {
  const key = effectRefKey(target);
  if (effectTargets(cfg).some((t) => effectRefKey(t) === key)) return cfg;
  const { label, ...ref } = target;
  const entry: EffectTarget = { ...ref, ...(label ? { label } : {}) };
  return { ...cfg, targets: [...(cfg.targets ?? []), entry] };
}

/** Couleur des overlays see-through pour `visibility` (pas de teinte choisie). */
const SEE_THROUGH_VIS_COLOR = 0xe2e8f0;
const SEE_THROUGH_OPACITY = 0.45;
const SEE_THROUGH_ORDER = 1003;
/** Arêtes : angle mini (°) pour retenir une arête — évite le fil de fer dense. */
const OUTLINE_THRESHOLD = 20;
const OUTLINE_ORDER = 1004;
const noRaycast = () => {};

interface LiveTarget {
  ref: EffectTarget;
  object: THREE.Object3D;
  tint: PartTint | null;
  key: string;
  /** Nœuds marqués `owlnestLive` / `owlnestEffectId` à nettoyer au démontage. */
  marked: THREE.Object3D[];
  /** Visibilité du modèle avant que l'effet ne la pilote. */
  originalVisible: boolean;
  /**
   * Overlays `depthTest: false` (comme PartHighlight) — géométrie partagée,
   * matériau dédié, retirés quand l'effet est inactif ou sans seeThrough.
   */
  seeThrough: THREE.Mesh[];
  seeThroughMat: THREE.MeshBasicMaterial | null;
  /** Contours `EdgesGeometry` pour `style: 'outline'`. */
  outline: THREE.LineSegments[];
  outlineGeoms: THREE.BufferGeometry[];
  outlineMat: THREE.LineBasicMaterial | null;
  /** Signature du dernier contour posé (couleur / lueur / seeThrough). */
  outlineSig: string;
}

interface LiveEffect {
  cfg: OwlnestEffect;
  targets: LiveTarget[];
  key: string;
  active: boolean;
  /**
   * Aperçu forcé depuis l'éditeur (comme l'intensité d'une ancre lumière).
   * `null` : suivre l'état HA.
   */
  forcedActive: boolean | null;
}

function markLive(target: THREE.Object3D, id: string): THREE.Object3D[] {
  const marked: THREE.Object3D[] = [];
  // Marquer la cible et ses mailles : le batching remonte les parents, et
  // `isMoving` doit voir `owlnestLive` sur la maille elle-même.
  target.traverse((o) => {
    if ((o as THREE.Mesh).isMesh || o === target) {
      o.userData.owlnestLive = true;
      o.userData.owlnestEffectId = id;
      marked.push(o);
    }
  });
  if (!marked.includes(target)) {
    target.userData.owlnestLive = true;
    target.userData.owlnestEffectId = id;
    marked.push(target);
  }
  return marked;
}

function unmark(marked: THREE.Object3D[]) {
  for (const o of marked) {
    delete o.userData.owlnestLive;
    delete o.userData.owlnestEffectId;
  }
}

function clearSeeThrough(t: LiveTarget) {
  for (const o of t.seeThrough) o.parent?.remove(o);
  t.seeThrough = [];
  t.seeThroughMat?.dispose();
  t.seeThroughMat = null;
}

function clearOutline(t: LiveTarget) {
  for (const o of t.outline) o.parent?.remove(o);
  for (const g of t.outlineGeoms) g.dispose();
  t.outline = [];
  t.outlineGeoms = [];
  t.outlineMat?.dispose();
  t.outlineMat = null;
  t.outlineSig = '';
}

/**
 * Pose des LineSegments sur chaque maille : arêtes dures, couleur de l'effet.
 * `seeThrough` coupe le test de profondeur (lisible derrière un mur).
 */
function applyOutline(
  t: LiveTarget,
  colorHex: string,
  glow: number,
  seeThrough: boolean,
): boolean {
  const g = Math.min(1, Math.max(0, glow));
  const opacity = 0.45 + 0.55 * g;
  const sig = `${colorHex}|${opacity.toFixed(3)}|${seeThrough ? 1 : 0}`;
  if (t.outline.length && t.outlineSig === sig) return false;
  clearOutline(t);
  const mat = new THREE.LineBasicMaterial({
    color: new THREE.Color(colorHex),
    transparent: opacity < 1,
    opacity,
    depthTest: !seeThrough,
    depthWrite: false,
  });
  t.outlineMat = mat;
  t.outlineSig = sig;
  t.object.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.userData.owlnestHelper) return;
    const edges = new THREE.EdgesGeometry(m.geometry, OUTLINE_THRESHOLD);
    const lines = new THREE.LineSegments(edges, mat);
    lines.name = '__owlnest_effect_outline';
    lines.userData.owlnestHelper = true;
    lines.renderOrder = OUTLINE_ORDER;
    lines.raycast = noRaycast;
    lines.castShadow = false;
    lines.receiveShadow = false;
    m.add(lines);
    t.outline.push(lines);
    t.outlineGeoms.push(edges);
  });
  return true;
}

/**
 * Pose des enfants helper sans test de profondeur — l'objet reste lisible
 * derrière un mur, sans toucher aux matériaux partagés du modèle.
 */
function applySeeThrough(t: LiveTarget, color: number): boolean {
  const hex = color & 0xffffff;
  if (t.seeThrough.length && t.seeThroughMat?.color.getHex() === hex) return false;
  clearSeeThrough(t);
  const mat = new THREE.MeshBasicMaterial({
    color: hex,
    transparent: true,
    opacity: SEE_THROUGH_OPACITY,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  t.seeThroughMat = mat;
  t.object.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.userData.owlnestHelper) return;
    const overlay = new THREE.Mesh(m.geometry, mat);
    overlay.name = '__owlnest_effect_see';
    overlay.userData.owlnestHelper = true;
    overlay.renderOrder = SEE_THROUGH_ORDER;
    overlay.raycast = noRaycast;
    overlay.castShadow = false;
    overlay.receiveShadow = false;
    m.add(overlay);
    t.seeThrough.push(overlay);
  });
  return true;
}

export class EffectController {
  private items: LiveEffect[] = [];
  private _built = false;
  private _root: THREE.Object3D | null = null;

  get built() { return this._built; }
  get count() { return this.items.length; }

  build(root: THREE.Object3D, configs: OwlnestEffect[]): { ok: number; missing: OwlnestEffect[] } {
    this.dispose();
    this._root = root;
    stampOrder(root);
    const meshes = meshOrder(root);
    const nodes = nodeOrder(root);
    const missing: OwlnestEffect[] = [];
    for (const cfg of configs) {
      if (cfg.kind !== 'material' && cfg.kind !== 'visibility') {
        missing.push(cfg);
        continue;
      }
      const item = this._mount(cfg, meshes, nodes);
      if (item) this.items.push(item);
      else missing.push(cfg);
    }
    this._built = true;
    return { ok: this.items.length, missing };
  }

  private _resolveOne(
    ref: EffectTarget,
    meshes: THREE.Mesh[],
    nodes: THREE.Object3D[],
  ): THREE.Object3D | null {
    if (ref.node) {
      return resolveNode(nodes, { node: ref.node, nodeIndex: ref.nodeIndex });
    }
    return resolveMesh(meshes, ref);
  }

  private _mountTarget(
    cfg: OwlnestEffect,
    ref: EffectTarget,
    meshes: THREE.Mesh[],
    nodes: THREE.Object3D[],
  ): LiveTarget | null {
    const object = this._resolveOne(ref, meshes, nodes);
    if (!object) return null;
    return {
      ref: { ...ref },
      object,
      tint: cfg.kind === 'material' ? new PartTint(object, cfg.id) : null,
      key: effectRefKey(ref),
      marked: markLive(object, cfg.id),
      originalVisible: object.visible,
      seeThrough: [],
      seeThroughMat: null,
      outline: [],
      outlineGeoms: [],
      outlineMat: null,
      outlineSig: '',
    };
  }

  private _mount(
    cfg: OwlnestEffect,
    meshes: THREE.Mesh[],
    nodes: THREE.Object3D[],
  ): LiveEffect | null {
    const refs = effectTargets(cfg);
    const targets: LiveTarget[] = [];
    const seen = new Set<string>();
    for (const ref of refs) {
      const key = effectRefKey(ref);
      if (seen.has(key)) continue;
      const t = this._mountTarget(cfg, ref, meshes, nodes);
      if (!t) continue;
      seen.add(key);
      targets.push(t);
    }
    // Aucune cible résolue : l'effet est absent (modèle réexporté, etc.).
    if (!targets.length) return null;
    return {
      cfg: { ...cfg },
      targets,
      key: effectTargetKey(cfg),
      active: false,
      forcedActive: null,
    };
  }

  private _unmountTarget(t: LiveTarget) {
    clearSeeThrough(t);
    clearOutline(t);
    t.tint?.restore();
    t.object.visible = t.originalVisible;
    unmark(t.marked);
  }

  /** Overlays see-through selon l'état actif et le réglage. */
  private _syncSeeThrough(item: LiveEffect): boolean {
    let dirty = false;
    const on = item.active && item.cfg.seeThrough === true;
    for (const t of item.targets) {
      if (!on) {
        if (t.seeThrough.length) { clearSeeThrough(t); dirty = true; }
        continue;
      }
      const color = item.cfg.kind === 'material' && tintColor(item.cfg.color)
        ? new THREE.Color(item.cfg.color).getHex()
        : item.cfg.kind === 'material' ? 0xef4444 : SEE_THROUGH_VIS_COLOR;
      if (applySeeThrough(t, color)) dirty = true;
    }
    return dirty;
  }

  private _unmount(item: LiveEffect) {
    for (const t of item.targets) this._unmountTarget(t);
  }

  /** L'effet est-il monté sur les cibles que décrit cette configuration ? */
  hasTarget(cfg: OwlnestEffect): boolean {
    const item = this.items.find((i) => i.cfg.id === cfg.id);
    return !!item && item.key === effectTargetKey(cfg);
  }

  /** Première cible montée (surlignage / compat). */
  objectOf(id: string): THREE.Object3D | null {
    return this.items.find((i) => i.cfg.id === id)?.targets[0]?.object ?? null;
  }

  objectsOf(id: string): THREE.Object3D[] {
    return this.items.find((i) => i.cfg.id === id)?.targets.map((t) => t.object) ?? [];
  }

  /**
   * Force l'apparence « actif / inactif » pendant l'édition.
   * `null` rend la main à `applyStates`.
   */
  setPreview(id: string, forced: boolean | null): boolean {
    const item = this.items.find((i) => i.cfg.id === id);
    if (!item) return false;
    item.forcedActive = forced;
    if (forced !== null) item.active = forced;
    this._apply(item);
    return true;
  }

  isPreviewing(id: string): boolean {
    const item = this.items.find((i) => i.cfg.id === id);
    return !!item && item.forcedActive !== null;
  }

  /**
   * Applique un réglage en direct. Monte l'effet s'il n'existe pas encore.
   * Retourne `false` si aucune cible n'est trouvable.
   */
  configure(cfg: OwlnestEffect): boolean {
    if ((cfg.kind !== 'material' && cfg.kind !== 'visibility') || !this._root) return false;
    let item = this.items.find((i) => i.cfg.id === cfg.id);
    if (!item) {
      const mounted = this._mount(cfg, meshOrder(this._root), nodeOrder(this._root));
      if (!mounted) return false;
      this.items.push(mounted);
      this._built = true;
      this._apply(mounted);
      return true;
    }

    const nextKey = effectTargetKey(cfg);
    const kindChanged = item.cfg.kind !== cfg.kind;
    const forced = item.forcedActive;
    if (item.key !== nextKey || kindChanged) {
      this._unmount(item);
      const remounted = this._mount(cfg, meshOrder(this._root), nodeOrder(this._root));
      if (!remounted) {
        const back = this._mount(item.cfg, meshOrder(this._root), nodeOrder(this._root));
        if (back) {
          back.active = item.active;
          back.forcedActive = forced;
          Object.assign(item, back);
          this._apply(item);
        } else {
          this.items.splice(this.items.indexOf(item), 1);
        }
        return false;
      }
      remounted.active = forced !== null ? forced : item.active;
      remounted.forcedActive = forced;
      Object.assign(item, remounted);
    } else {
      item.cfg = { ...cfg };
    }
    this._apply(item);
    return true;
  }

  /** Retire un effet monté (suppression dans l'éditeur). */
  remove(id: string): boolean {
    const at = this.items.findIndex((i) => i.cfg.id === id);
    if (at < 0) return false;
    this._unmount(this.items[at]);
    this.items.splice(at, 1);
    return true;
  }

  private _apply(item: LiveEffect): boolean {
    if (item.cfg.kind === 'visibility') return this._applyVisibility(item);
    return this._applyMaterial(item);
  }

  private _applyMaterial(item: LiveEffect): boolean {
    const color = tintColor(item.cfg.color);
    const strength = item.cfg.strength ?? DEFAULT_TINT_STRENGTH;
    const glow = item.cfg.glow ?? DEFAULT_GLOW;
    const outline = item.cfg.style === 'outline';
    let dirty = false;
    for (const t of item.targets) {
      if (outline) {
        if (t.tint?.active) { t.tint.restore(); dirty = true; }
        if (t.seeThrough.length) { clearSeeThrough(t); dirty = true; }
        if (item.active && color) {
          if (applyOutline(t, color, glow, item.cfg.seeThrough === true)) dirty = true;
        } else if (t.outline.length) {
          clearOutline(t);
          dirty = true;
        }
        continue;
      }
      if (t.outline.length) { clearOutline(t); dirty = true; }
      const tint = t.tint;
      if (!tint) continue;
      if (item.active && color) {
        if (tint.apply(color, undefined, 0, strength, glow)) dirty = true;
      } else if (tint.active) {
        tint.restore();
        dirty = true;
      }
    }
    if (!outline && this._syncSeeThrough(item)) dirty = true;
    return dirty;
  }

  private _applyVisibility(item: LiveEffect): boolean {
    // Actif → visible ; inactif → caché. `invert` est déjà dans `active`.
    let dirty = false;
    for (const t of item.targets) {
      if (t.object.visible !== item.active) {
        t.object.visible = item.active;
        dirty = true;
      }
    }
    if (this._syncSeeThrough(item)) dirty = true;
    return dirty;
  }

  /** Pose les effets d'après les états HA. Retourne `true` si quelque chose a changé. */
  applyStates(states: Record<string, { state: string; attributes: Record<string, unknown> }>): boolean {
    let dirty = false;
    for (const item of this.items) {
      // L'éditeur force l'aperçu : ne pas l'écraser à chaque tick HA.
      if (item.forcedActive !== null) {
        if (item.active !== item.forcedActive) {
          item.active = item.forcedActive;
          dirty = true;
        }
      } else {
        const e = states[item.cfg.entity];
        const on = effectActive(item.cfg, e?.state, e?.attributes);
        if (on !== item.active) {
          item.active = on;
          dirty = true;
        }
      }
      if (this._apply(item)) dirty = true;
    }
    return dirty;
  }

  dispose() {
    for (const item of this.items) this._unmount(item);
    this.items = [];
    this._built = false;
    this._root = null;
  }
}
