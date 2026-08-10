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
import { partIndexOf, extractPart, partFrame, axisName, type PartFrame } from './parts';

// ── Lecture de l'état ───────────────────────────────────────────────────────

/**
 * Fraction d'ouverture d'une entité, de 0 (fermé) à 1 (grand ouvert).
 *
 * Les stores et volets rapportent souvent une position continue : la suivre
 * donne un volet à mi-course plutôt qu'un tout-ou-rien.
 */
export function openFraction(
  state: string | undefined,
  attributes?: Record<string, unknown>,
): number {
  if (state === undefined || state === 'unavailable' || state === 'unknown') return 0;

  const pos = attributes?.current_position;
  if (typeof pos === 'number' && Number.isFinite(pos)) {
    return Math.min(1, Math.max(0, pos / 100));
  }

  switch (state) {
    case 'open':
    case 'opening':
    case 'on':
    case 'unlocked':
      return 1;
    case 'closed':
    case 'closing':
    case 'off':
    case 'locked':
      return 0;
    default:
      return 0;
  }
}

// ── Animation ───────────────────────────────────────────────────────────────

interface LiveMesh {
  cfg: OwlnestPart;
  object: THREE.Mesh;
  frame: PartFrame;
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

      const item = this._attach(mesh, part, cfg);
      if (item) this.items.push(item);
      else missing.push(cfg);
    }

    this._built = true;
    return { ok: this.items.length, missing };
  }

  private _attach(
    mesh: THREE.Mesh,
    part: { tris: Uint32Array; box: THREE.Box3; id: number },
    cfg: OwlnestPart,
  ): LiveMesh | null {
    const hinge = cfg.hinge ?? 'start';
    const { mesh: object, frame } = extractPart(mesh, part, hinge);
    object.userData.owlnestPartId = cfg.id;

    if (cfg.motion === 'slide') {
      // Un coulissant se retire le long d'un de ses propres axes. Par défaut il
      // descend, ce qui correspond à un volet roulant.
      const dir = cfg.slide ?? 'down';
      const along = dir === 'down' || dir === 'up' ? frame.up : frame.wide;
      const travel = cfg.travel ?? 1;
      return {
        cfg, object, frame,
        span: frame.size[along] * travel,
        axis: axisName(along),
        sign: dir === 'up' || dir === 'end' ? 1 : -1,
        rest: object.position[axisName(along)],
        current: 0, target: 0,
      };
    }

    return {
      cfg, object, frame,
      span: THREE.MathUtils.degToRad(cfg.angle ?? 90),
      axis: axisName(frame.up),
      sign: hinge === 'start' ? -1 : 1,
      rest: 0,
      current: 0, target: 0,
    };
  }

  /** Applique les états courants. Retourne `true` si une cible a changé. */
  applyStates(states: Record<string, { state: string; attributes?: Record<string, unknown> } | undefined>): boolean {
    let changed = false;
    for (const item of this.items) {
      const e = states[item.cfg.entity];
      let f = openFraction(e?.state, e?.attributes);
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
    if (item.cfg.motion === 'slide') item.object.position[item.axis] = item.rest + value;
    else item.object.rotation[item.axis] = value;
  }

  /** Position d'un ouvrant, pour l'aperçu de l'éditeur. */
  preview(id: string, fraction: number) {
    const item = this.items.find((i) => i.cfg.id === id);
    if (item) item.target = Math.min(1, Math.max(0, fraction));
  }

  boxOf(id: string): THREE.Box3 | null {
    const item = this.items.find((i) => i.cfg.id === id);
    if (!item) return null;
    return new THREE.Box3().setFromObject(item.object);
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
      item.object.parent?.remove(item.object);
      item.object.geometry.dispose();
    }
    this.items = [];
    this._built = false;
    root?.traverse((o) => { delete o.userData.__owlnestParts; });
  }
}

export { partFrame };
