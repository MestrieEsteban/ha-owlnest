/**
 * low-walls.ts — les murs qui s'abaissent devant la caméra, comme dans les Sims.
 *
 * Effacer ce qui gêne la vue (voir cutaway.ts) efface aussi le mobilier sur le
 * trajet : sur un logement meublé, on ne comprend plus rien. Couper toute la
 * maison à mi-hauteur coupe aussi les armoires et donne une maquette étrange.
 *
 * Ici, seuls les murs **entre la caméra et le cœur de la maison** descendent ;
 * ceux du fond restent debout et donnent le volume des pièces. En tournant
 * autour, les murs se relèvent derrière et s'abaissent devant, en douceur. Le
 * mobilier n'est jamais touché.
 *
 *  - **Un mur** est un prisme : ramener ses sommets hauts à la hauteur voulue
 *    descend son dessus avec eux, il reste fermé, avec une arête nette.
 *    Sweet Home 3D découpe chaque mur en morceaux (`wall_<n>_<k>`) : ils
 *    descendent ensemble.
 *  - **Ce qui est accroché** à un mur abaissé, au-dessus de sa coupe (tableau,
 *    applique, clim), disparaît avec lui ; **portes et fenêtres** du mur sont
 *    coupées à sa hauteur par un plan, sans toucher à leur géométrie : les
 *    ouvrants s'animent toujours.
 *  - **Les plafonds** sont retirés tant que le mode est actif.
 *
 * Les murs se reconnaissent à leur nom : un modèle sans murs nommés n'a
 * simplement pas ce mode.
 */

import * as THREE from 'three';

/** Hauteur d'un mur abaissé, en part de la hauteur d'étage : une plinthe haute. */
export const LOW_WALL_RATIO = 0.18;

/** Durée de la descente ou de la remontée d'un mur, en secondes. */
const TRANSITION = 0.3;

const WALL = /^wall_\d/i;
const WALL_ID = /^wall_(\d+)_/i;
const ROOM = /^room_\d/i;
const OPENING = /^sweethome3d_|frame|window|door|porte|fenetre/i;

interface Level {
  base: number;
  /** Hauteur du mur abaissé. */
  cut: number;
  /** Haut des murs de l'étage. */
  top: number;
}

/**
 * Étages déduits des murs, en coordonnées monde.
 *
 * Seuls les morceaux qui montent sur une bonne part de la hauteur disent où
 * commence un étage : un linteau qui part de 2,10 m n'en est pas un, une
 * plinthe non plus.
 */
export function levelsOf(walls: readonly { base: number; top: number }[], ratio = LOW_WALL_RATIO): Level[] {
  const tallest = Math.max(...walls.map((w) => w.top - w.base));
  const tall = walls.filter((w) => w.top - w.base > tallest * 0.5).sort((a, b) => a.base - b.base);
  const levels: { base: number; top: number }[] = [];
  for (const w of tall) {
    const same = levels.find((l) => Math.abs(l.base - w.base) < tallest * 0.1);
    if (same) same.top = Math.max(same.top, w.top);
    else levels.push({ base: w.base, top: w.top });
  }
  return levels.map((l) => ({ base: l.base, cut: l.base + (l.top - l.base) * ratio, top: l.top }));
}

/** Étage d'une hauteur : le sol le plus haut qui soit encore sous elle. */
export function levelAt(levels: readonly Level[], height: number): Level | undefined {
  let found: Level | undefined = levels[0];
  for (const l of levels) if (l.base <= height + (l.cut - l.base) * 0.1) found = l;
  return found;
}

/**
 * Un mur est-il devant ? Il l'est quand il se trouve du côté de la caméra par
 * rapport au centre de la maison, vu de dessus.
 *
 * `margin` évite qu'un mur qui passe par le centre ne clignote d'un état à
 * l'autre au moindre mouvement.
 */
export function inFront(
  wall: { x: number; z: number },
  center: { x: number; z: number },
  toCamera: { x: number; z: number },
  margin: number,
): boolean {
  return (wall.x - center.x) * toCamera.x + (wall.z - center.z) * toCamera.z > margin;
}

/** Nom de l'objet ou d'un de ses parents (un groupe à plusieurs matériaux). */
function nameUp(o: THREE.Object3D, root: THREE.Object3D, test: RegExp): string | null {
  for (let n: THREE.Object3D | null = o; n && n !== root; n = n.parent) if (test.test(n.name)) return n.name;
  return null;
}

interface Piece {
  mesh: THREE.Mesh;
  original: Float32Array;
  /** Haut d'origine et hauteur abaissée, dans le repère local de la maille. */
  top: number;
  cut: number;
}

interface Clipped {
  mesh: THREE.Mesh;
  full: THREE.Material | THREE.Material[];
  low: THREE.Material | THREE.Material[];
  plane: THREE.Plane;
}

interface WallGroup {
  pieces: Piece[];
  /** Centre et boîte, en coordonnées monde. */
  center: THREE.Vector3;
  box: THREE.Box3;
  level: Level;
  /** 0 : debout, 1 : abaissé. */
  f: number;
  target: number;
  hung: THREE.Object3D[];
  openings: Clipped[];
}

export class LowWalls {
  private groups: WallGroup[] = [];
  private levels: Level[] = [];
  private ceilings: { mesh: THREE.Mesh; full: THREE.BufferAttribute | null; low: THREE.BufferAttribute }[] = [];
  private enabled = false;
  private readonly up: 0 | 1 | 2;
  private readonly h: [0 | 1 | 2, 0 | 1 | 2];
  private readonly center = new THREE.Vector3();
  private margin = 0;

  constructor(private root: THREE.Object3D, up: 0 | 1 | 2 = 1) {
    this.up = up;
    this.h = ([0, 1, 2] as const).filter((a) => a !== up) as [0 | 1 | 2, 0 | 1 | 2];
    root.updateMatrixWorld(true);

    // Morceaux de murs, regroupés par mur.
    const byWall = new Map<string, Piece[]>();
    const world = (m: THREE.Mesh, h: number) =>
      new THREE.Vector3().setComponent(up, h).applyMatrix4(m.matrixWorld).getComponent(up);
    const spans: { base: number; top: number }[] = [];
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const name = nameUp(mesh, root, WALL);
      if (!name) return;
      const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
      if (!pos) return;
      let min = Infinity, max = -Infinity;
      for (let i = 0; i < pos.count; i++) {
        const v = pos.getComponent(i, up);
        if (v < min) min = v;
        if (v > max) max = v;
      }
      // Un morceau plat (le dessus d'un mur) compte aussi : il descend avec.
      if (!(max >= min)) return;
      const key = WALL_ID.exec(name)?.[1] ?? name;
      const piece: Piece = { mesh, original: new Float32Array(pos.array as ArrayLike<number>), top: max, cut: max };
      byWall.set(key, [...(byWall.get(key) ?? []), piece]);
      spans.push({ base: world(mesh, min), top: world(mesh, max) });
    });
    if (!byWall.size) return;

    this.levels = levelsOf(spans);
    const box = new THREE.Box3().setFromObject(root);
    box.getCenter(this.center);
    const size = box.getSize(new THREE.Vector3());
    this.margin = Math.max(size.getComponent(this.h[0]), size.getComponent(this.h[1])) * 0.02;

    for (const pieces of byWall.values()) {
      const gbox = new THREE.Box3();
      for (const p of pieces) gbox.expandByObject(p.mesh);
      const level = levelAt(this.levels, gbox.min.getComponent(up));
      if (!level) continue;
      for (const p of pieces) {
        const inv = new THREE.Matrix4().copy(p.mesh.matrixWorld).invert();
        p.cut = new THREE.Vector3().setComponent(up, level.cut).applyMatrix4(inv).getComponent(up);
      }
      this.groups.push({
        pieces, box: gbox, center: gbox.getCenter(new THREE.Vector3()), level,
        f: 0, target: 0, hung: [], openings: [],
      });
    }
    this._attach();
  }

  /** Le modèle a-t-il des murs reconnus ? Sinon le mode n'est pas proposé. */
  get available(): boolean {
    return this.groups.length > 0;
  }

  get active(): boolean {
    return this.enabled;
  }

  /**
   * Ce qui tient à chaque mur : objets accrochés au-dessus de la coupe, portes
   * et fenêtres qui le traversent. Calculé une fois, au chargement.
   */
  private _attach() {
    const box = new THREE.Box3();
    const near = this.margin;
    const [a, b] = this.h;
    const close = (m: THREE.Box3, g: THREE.Box3) =>
      m.min.getComponent(a) <= g.max.getComponent(a) + near && m.max.getComponent(a) >= g.min.getComponent(a) - near
      && m.min.getComponent(b) <= g.max.getComponent(b) + near && m.max.getComponent(b) >= g.min.getComponent(b) - near;

    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || nameUp(mesh, this.root, WALL) || nameUp(mesh, this.root, ROOM)) return;
      box.setFromObject(mesh);
      if (box.isEmpty()) return;
      const bottom = box.min.getComponent(this.up);
      const top = box.max.getComponent(this.up);
      // Le mur qui le touche, à son étage, et qu'il dépasse.
      const g = this.groups.find((w) => close(box, w.box)
        && bottom >= w.level.base - near && top > w.level.cut);
      if (!g) return;

      // Accroché : il commence à mi-hauteur du mur ou plus haut (tableau,
      // applique, clim, meuble haut). Une télé sur son meuble, un objet sur le
      // plan de travail restent posés à leur place.
      if (bottom >= g.level.base + (g.level.top - g.level.base) * 0.5) {
        g.hung.push(mesh);
      } else if (nameUp(mesh, this.root, OPENING)) {
        const plane = new THREE.Plane(new THREE.Vector3().setComponent(this.up, -1), 0);
        const clip = (m: THREE.Material) => {
          const c = m.clone();
          c.clippingPlanes = [plane];
          c.clipShadows = true;
          return c;
        };
        const full = mesh.material;
        g.openings.push({ mesh, full, low: Array.isArray(full) ? full.map(clip) : clip(full), plane });
      }
    });
  }

  /** Active ou coupe le mode ; tous les murs se relèvent quand on le coupe. */
  setEnabled(on: boolean) {
    if (on === this.enabled || !this.available) return;
    this.enabled = on;
    this._ceilings(on);
    if (!on) for (const g of this.groups) g.target = 0;
  }

  /**
   * Choisit les murs à abaisser d'après la caméra. Bon marché (un produit
   * scalaire par mur) : appelé à chaque mouvement.
   */
  aim(camera: THREE.Vector3) {
    if (!this.enabled) return;
    const [a, b] = this.h;
    const to = { x: camera.getComponent(a) - this.center.getComponent(a), z: camera.getComponent(b) - this.center.getComponent(b) };
    const len = Math.hypot(to.x, to.z) || 1;
    to.x /= len; to.z /= len;
    const c = { x: this.center.getComponent(a), z: this.center.getComponent(b) };
    for (const g of this.groups) {
      const w = { x: g.center.getComponent(a), z: g.center.getComponent(b) };
      g.target = inFront(w, c, to, this.margin) ? 1 : 0;
    }
  }

  /**
   * Fait avancer les murs vers leur position. Rend `true` tant qu'un mur
   * bouge, pour que la carte continue de redessiner.
   */
  update(dt: number): boolean {
    let moving = false;
    const step = Math.min(1, dt / TRANSITION);
    for (const g of this.groups) {
      if (g.f === g.target) continue;
      g.f = g.target > g.f ? Math.min(g.target, g.f + step) : Math.max(g.target, g.f - step);
      this._place(g);
      moving = true;
    }
    return moving;
  }

  private _place(g: WallGroup) {
    // Courbe douce : le mur ralentit en arrivant.
    const k = g.f * g.f * (3 - 2 * g.f);
    const up = this.up;
    for (const p of g.pieces) {
      const pos = p.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      const limit = p.top + (p.cut - p.top) * k;
      for (let i = up; i < arr.length; i += 3) arr[i] = Math.min(p.original[i], limit);
      pos.needsUpdate = true;
      p.mesh.geometry.computeBoundingSphere();
    }
    const visible = g.f < 0.5;
    for (const o of g.hung) o.visible = visible;

    const height = g.level.cut + (g.box.max.getComponent(up) - g.level.cut) * (1 - k);
    for (const c of g.openings) {
      c.plane.constant = height;
      c.mesh.material = g.f > 0 ? c.low : c.full;
    }
  }

  /** Retire ou rend les plafonds des pièces. */
  private _ceilings(hide: boolean) {
    if (!hide) {
      for (const c of this.ceilings) c.mesh.geometry.setIndex(c.full);
      this.ceilings = [];
      return;
    }
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !nameUp(mesh, this.root, ROOM)) return;
      const low = this._withoutCeiling(mesh);
      if (!low) return;
      this.ceilings.push({ mesh, full: mesh.geometry.getIndex(), low });
      mesh.geometry.setIndex(low);
    });
  }

  /** Index de la pièce sans ses plafonds, ou `null` s'il n'y en a pas. */
  private _withoutCeiling(mesh: THREE.Mesh): THREE.BufferAttribute | null {
    const g = mesh.geometry;
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const index = g.getIndex();
    if (!pos) return null;
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const v = pos.getComponent(i, this.up);
      if (v < min) min = v;
      if (v > max) max = v;
    }
    // Une pièce sans épaisseur n'a qu'un sol.
    if (!(max - min > 1e-6)) return null;
    const mid = (min + max) / 2;
    const count = index ? index.count : pos.count;
    const at = (k: number) => (index ? index.getX(k) : k);
    const kept: number[] = [];
    for (let k = 0; k + 2 < count; k += 3) {
      const a = at(k), b = at(k + 1), c = at(k + 2);
      const high = pos.getComponent(a, this.up) > mid && pos.getComponent(b, this.up) > mid && pos.getComponent(c, this.up) > mid;
      if (!high) kept.push(a, b, c);
    }
    if (kept.length === count) return null;
    const Ctor = pos.count > 65535 ? Uint32Array : Uint16Array;
    return new THREE.BufferAttribute(new Ctor(kept), 1);
  }
}
