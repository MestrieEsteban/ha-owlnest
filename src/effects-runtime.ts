/**
 * effects-runtime.ts — effets visuels pilotés par des entités (sans mouvement).
 *
 * - `material` : teinte + lueur sur copies de matériaux (jamais l'original),
 *   ou arêtes colorées (`style: 'outline'`).
 * - `visibility` : montre / cache la cible ; la visibilité d'origine est
 *   mémorisée au montage et rendue au démontage. Le fondu passe par l'opacité
 *   de copies de matériaux (`object.visible` ne peut pas interpoler).
 *
 * `duration` (secondes) : fondu entre inactif et actif. Absent ou 0 = instant
 * (scènes existantes). `update(dt)` avance la fraction comme PartController.
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

/** Absent ou 0 : bascule instantanée (compat scènes sans le champ). */
export const DEFAULT_EFFECT_DURATION = 0;

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

type OpMat = THREE.Material & { opacity: number; transparent: boolean };

interface FadeEntry {
  mesh: THREE.Mesh;
  original: THREE.Material | THREE.Material[];
}

/**
 * Fondu de visibilité via l'opacité de copies — `object.visible` est binaire.
 * Jamais l'original (matériaux partagés du modèle).
 */
class VisFade {
  private entries: FadeEntry[] | null = null;
  private copies = new Map<THREE.Material, { copy: OpMat; base: number }>();
  private last = -1;

  constructor(private readonly target: THREE.Object3D, private readonly ownerId: string) {}

  get active(): boolean { return this.entries !== null; }

  apply(fraction: number): boolean {
    const f = Math.min(1, Math.max(0, fraction));
    if (f < 1e-4) {
      const had = this.entries !== null;
      this.restore();
      return had;
    }
    if (this.entries && Math.abs(f - this.last) < 1e-4) return false;
    this.last = f;
    if (!this.entries) this._mount();
    for (const { copy, base } of this.copies.values()) {
      copy.opacity = base * f;
      copy.transparent = true;
      copy.needsUpdate = true;
    }
    return true;
  }

  restore() {
    if (!this.entries) return;
    for (const { mesh, original } of this.entries) mesh.material = original;
    for (const { copy } of this.copies.values()) copy.dispose();
    this.copies.clear();
    this.entries = null;
    this.last = -1;
  }

  private _mount() {
    const entries: FadeEntry[] = [];
    const copyOf = (m: THREE.Material): OpMat => {
      let slot = this.copies.get(m);
      if (!slot) {
        const copy = m.clone() as OpMat;
        if (Object.prototype.hasOwnProperty.call(m, 'onBeforeCompile')) {
          copy.onBeforeCompile = m.onBeforeCompile;
        }
        if (Object.prototype.hasOwnProperty.call(m, 'customProgramCacheKey')) {
          copy.customProgramCacheKey = m.customProgramCacheKey;
        }
        slot = { copy, base: Number.isFinite(copy.opacity) ? copy.opacity : 1 };
        this.copies.set(m, slot);
      }
      return slot.copy;
    };
    const walk = (o: THREE.Object3D) => {
      if (o.userData.owlnestHelper) return;
      const owner = o.userData.owlnestPartId ?? o.userData.owlnestEffectId;
      if (o !== this.target && owner !== undefined && owner !== this.ownerId) return;
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && mesh.material) {
        const original = mesh.material;
        entries.push({ mesh, original });
        mesh.material = Array.isArray(original) ? original.map(copyOf) : copyOf(original);
      }
      for (const child of o.children) walk(child);
    };
    walk(this.target);
    this.entries = entries;
  }
}

interface LiveTarget {
  ref: EffectTarget;
  object: THREE.Object3D;
  tint: PartTint | null;
  /** Opacité clonée pour `visibility` pendant le fondu. */
  fade: VisFade | null;
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
  /** Signature du contour hors fraction (couleur / lueur / seeThrough). */
  outlineSig: string;
}

interface LiveEffect {
  cfg: OwlnestEffect;
  targets: LiveTarget[];
  key: string;
  /** Cible booléenne (état HA ou aperçu forcé). */
  active: boolean;
  /** Fraction affichée 0→1, interpolée vers `active`. */
  current: number;
  /**
   * Aperçu forcé depuis l'éditeur (comme l'intensité d'une ancre lumière).
   * `null` : suivre l'état HA. Le forçage bascule en instantané.
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
 * `fraction` module l'opacité ; près de 0, les arêtes sont retirées.
 */
function applyOutline(
  t: LiveTarget,
  colorHex: string,
  glow: number,
  seeThrough: boolean,
  fraction: number,
): boolean {
  const f = Math.min(1, Math.max(0, fraction));
  if (f < 1e-4) {
    if (!t.outline.length) return false;
    clearOutline(t);
    return true;
  }
  const g = Math.min(1, Math.max(0, glow));
  const baseOpacity = 0.45 + 0.55 * g;
  const opacity = baseOpacity * f;
  const sig = `${colorHex}|${baseOpacity.toFixed(3)}|${seeThrough ? 1 : 0}`;
  let dirty = false;
  if (!t.outline.length || t.outlineSig !== sig) {
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
    dirty = true;
  } else if (t.outlineMat && Math.abs(t.outlineMat.opacity - opacity) > 1e-4) {
    t.outlineMat.opacity = opacity;
    t.outlineMat.transparent = opacity < 1;
    dirty = true;
  }
  return dirty;
}

/**
 * Pose des enfants helper sans test de profondeur — l'objet reste lisible
 * derrière un mur, sans toucher aux matériaux partagés du modèle.
 * `fraction` module l'opacité ; près de 0, les overlays sont retirés.
 */
function applySeeThrough(t: LiveTarget, color: number, fraction: number): boolean {
  const f = Math.min(1, Math.max(0, fraction));
  if (f < 1e-4) {
    if (!t.seeThrough.length) return false;
    clearSeeThrough(t);
    return true;
  }
  const hex = color & 0xffffff;
  const opacity = SEE_THROUGH_OPACITY * f;
  let dirty = false;
  if (!t.seeThrough.length || t.seeThroughMat?.color.getHex() !== hex) {
    clearSeeThrough(t);
    const mat = new THREE.MeshBasicMaterial({
      color: hex,
      transparent: true,
      opacity,
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
    dirty = true;
  } else if (t.seeThroughMat && Math.abs(t.seeThroughMat.opacity - opacity) > 1e-4) {
    t.seeThroughMat.opacity = opacity;
    dirty = true;
  }
  return dirty;
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
    // Liste absente ou corrompue : ignorer, ne pas faire échouer le chargement du modèle.
    const list = Array.isArray(configs) ? configs : [];
    for (const cfg of list) {
      if (!cfg || (cfg.kind !== 'material' && cfg.kind !== 'visibility')) {
        if (cfg) missing.push(cfg);
        continue;
      }
      try {
        const item = this._mount(cfg, meshes, nodes);
        if (item) this.items.push(item);
        else missing.push(cfg);
      } catch (err) {
        // Une seule cible pourrie ne doit pas laisser la carte sans modèle.
        console.warn(`[Owlnest] effect "${cfg.label || cfg.id}" failed to mount:`, err);
        missing.push(cfg);
      }
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
      fade: cfg.kind === 'visibility' ? new VisFade(object, cfg.id) : null,
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
      current: 0,
      forcedActive: null,
    };
  }

  private _unmountTarget(t: LiveTarget) {
    clearSeeThrough(t);
    clearOutline(t);
    t.tint?.restore();
    t.fade?.restore();
    t.object.visible = t.originalVisible;
    unmark(t.marked);
  }

  /** Overlays see-through : même fraction que teinte / opacité. */
  private _syncSeeThrough(item: LiveEffect): boolean {
    let dirty = false;
    const want = item.cfg.seeThrough === true && item.current > 1e-4;
    for (const t of item.targets) {
      if (!want) {
        if (t.seeThrough.length) { clearSeeThrough(t); dirty = true; }
        continue;
      }
      const color = item.cfg.kind === 'material' && tintColor(item.cfg.color)
        ? new THREE.Color(item.cfg.color).getHex()
        : item.cfg.kind === 'material' ? 0xef4444 : SEE_THROUGH_VIS_COLOR;
      if (applySeeThrough(t, color, item.current)) dirty = true;
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
   * `null` rend la main à `applyStates`. Aperçu : bascule instantanée.
   */
  setPreview(id: string, forced: boolean | null): boolean {
    const item = this.items.find((i) => i.cfg.id === id);
    if (!item) return false;
    item.forcedActive = forced;
    if (forced !== null) {
      item.active = forced;
      item.current = forced ? 1 : 0;
    }
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
    const keepActive = item.active;
    const keepCurrent = item.current;
    if (item.key !== nextKey || kindChanged) {
      this._unmount(item);
      const remounted = this._mount(cfg, meshOrder(this._root), nodeOrder(this._root));
      if (!remounted) {
        const back = this._mount(item.cfg, meshOrder(this._root), nodeOrder(this._root));
        if (back) {
          back.active = keepActive;
          back.current = keepCurrent;
          back.forcedActive = forced;
          Object.assign(item, back);
          this._apply(item);
        } else {
          this.items.splice(this.items.indexOf(item), 1);
        }
        return false;
      }
      remounted.active = forced !== null ? forced : keepActive;
      remounted.current = forced !== null ? (forced ? 1 : 0) : keepCurrent;
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
    try {
      if (item.cfg.kind === 'visibility') return this._applyVisibility(item);
      return this._applyMaterial(item);
    } catch (err) {
      console.warn(`[Owlnest] effect "${item.cfg.label || item.cfg.id}" apply failed:`, err);
      return false;
    }
  }

  private _applyMaterial(item: LiveEffect): boolean {
    const color = tintColor(item.cfg.color);
    const strength = item.cfg.strength ?? DEFAULT_TINT_STRENGTH;
    const glow = item.cfg.glow ?? DEFAULT_GLOW;
    const outline = item.cfg.style === 'outline';
    const f = item.current;
    let dirty = false;
    for (const t of item.targets) {
      if (outline) {
        if (t.tint?.active) { t.tint.restore(); dirty = true; }
        if (t.seeThrough.length) { clearSeeThrough(t); dirty = true; }
        if (color && f > 1e-4) {
          if (applyOutline(t, color, glow, item.cfg.seeThrough === true, f)) dirty = true;
        } else if (t.outline.length) {
          clearOutline(t);
          dirty = true;
        }
        continue;
      }
      if (t.outline.length) { clearOutline(t); dirty = true; }
      const tint = t.tint;
      if (!tint) continue;
      // Couleur « ouverte » seule : le poids suit la fraction (fondu in/out).
      if (color && f > 1e-4) {
        if (tint.apply(undefined, color, f, strength, glow)) dirty = true;
      } else if (tint.active) {
        tint.restore();
        dirty = true;
      }
    }
    if (!outline && this._syncSeeThrough(item)) dirty = true;
    return dirty;
  }

  private _applyVisibility(item: LiveEffect): boolean {
    // object.visible est binaire : on le laisse true tant que la fraction
    // n'est pas nulle, et on fond via l'opacité des copies.
    const f = item.current;
    const show = f > 1e-4;
    let dirty = false;
    for (const t of item.targets) {
      if (t.object.visible !== show) {
        t.object.visible = show;
        dirty = true;
      }
      if (t.fade?.apply(f)) dirty = true;
    }
    if (this._syncSeeThrough(item)) dirty = true;
    return dirty;
  }

  private _duration(item: LiveEffect): number {
    const d = item.cfg.duration;
    return d !== undefined && d > 0 ? d : DEFAULT_EFFECT_DURATION;
  }

  /** Pose les effets d'après les états HA. Retourne `true` si quelque chose a changé. */
  applyStates(states: Record<string, { state: string; attributes: Record<string, unknown> }>): boolean {
    let dirty = false;
    for (const item of this.items) {
      // L'éditeur force l'aperçu : ne pas l'écraser à chaque tick HA.
      if (item.forcedActive !== null) {
        if (item.active !== item.forcedActive) {
          item.active = item.forcedActive;
          item.current = item.forcedActive ? 1 : 0;
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
      // Sans durée (ou aperçu forcé déjà snappé) : coller current à la cible.
      const dur = this._duration(item);
      if (dur <= 0 || item.forcedActive !== null) {
        const goal = item.active ? 1 : 0;
        if (Math.abs(item.current - goal) > 1e-4) {
          item.current = goal;
          dirty = true;
        }
      }
      if (this._apply(item)) dirty = true;
    }
    return dirty;
  }

  /**
   * Avance les fondus. Retourne `true` tant qu'un effet anime, pour que la
   * boucle de rendu continue à dessiner.
   */
  update(dt: number): boolean {
    let moving = false;
    for (const item of this.items) {
      if (item.forcedActive !== null) continue;
      const dur = this._duration(item);
      const goal = item.active ? 1 : 0;
      const diff = goal - item.current;
      if (Math.abs(diff) < 1e-4) {
        if (item.current !== goal) {
          item.current = goal;
          this._apply(item);
        }
        continue;
      }
      if (dur <= 0) {
        item.current = goal;
        this._apply(item);
        continue;
      }
      const step = dt / Math.max(0.05, dur);
      item.current += Math.sign(diff) * Math.min(Math.abs(diff), step);
      this._apply(item);
      moving = true;
    }
    return moving;
  }

  dispose() {
    for (const item of this.items) this._unmount(item);
    this.items = [];
    this._built = false;
    this._root = null;
  }
}
