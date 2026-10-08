/**
 * low-walls.ts — les murs à mi-hauteur, comme une maquette d'architecte.
 *
 * Effacer ce qui gêne la vue (voir cutaway.ts) efface aussi le mobilier qui se
 * trouve sur le trajet : sur un vrai logement meublé, on ne comprend plus rien.
 * Ici, seuls les murs sont abaissés ; tout le reste garde sa forme, et on voit
 * l'intérieur entier, sous tous les angles, sans rien qui clignote en tournant.
 *
 * Trois gestes, tous réversibles :
 *
 *  - **Les murs** : chaque sommet au-dessus de la hauteur de coupe y est
 *    ramené. Un mur est un prisme : son dessus descend avec ses sommets, il
 *    reste donc fermé, avec une arête nette — pas de mur creux vu d'en haut.
 *  - **Les plafonds** des pièces sont masqués : sinon ils flotteraient au-dessus
 *    des murs abaissés.
 *  - **Portes et fenêtres** sont coupées par un plan à la même hauteur, sans
 *    toucher à leur géométrie : les ouvrants continuent de s'animer.
 *    Ce qui est entièrement au-dessus (applique, clim, tableau) est masqué.
 *
 * Les murs se reconnaissent à leur nom : Sweet Home 3D les exporte en `wall_…`.
 * Un modèle sans murs nommés n'a simplement pas ce mode.
 */

import * as THREE from 'three';

/** Part de la hauteur d'étage gardée : à hauteur de plan de travail. */
export const LOW_WALL_RATIO = 0.42;

const WALL = /^wall_\d/i;
const ROOM = /^room_\d/i;

/** Nom de l'objet ou d'un de ses parents (un groupe à plusieurs matériaux). */
function nameOf(o: THREE.Object3D, root: THREE.Object3D, test: RegExp): boolean {
  for (let n: THREE.Object3D | null = o; n && n !== root; n = n.parent) if (test.test(n.name)) return true;
  return false;
}

interface WallState {
  mesh: THREE.Mesh;
  original: Float32Array;
  /** Bas et haut du morceau de mur, dans son repère local. */
  base: number;
  top: number;
  /** Hauteur de coupe, dans le repère local : fixée par l'étage. */
  cut: number;
}

interface Level {
  base: number;
  cut: number;
}

/**
 * Étages déduits des murs, en coordonnées monde.
 *
 * Sweet Home 3D découpe un mur en morceaux : plinthe, allège sous la fenêtre,
 * linteau au-dessus de la porte. Seuls les morceaux qui montent sur une bonne
 * part de la hauteur disent où commence un étage ; un linteau qui part de
 * 2,10 m n'en est pas un.
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
  return levels.map((l) => ({ base: l.base, cut: l.base + (l.top - l.base) * ratio }));
}

/** Étage d'une hauteur : le sol le plus haut qui soit encore sous elle. */
export function levelAt(levels: readonly Level[], height: number): Level | undefined {
  let found: Level | undefined = levels[0];
  for (const l of levels) if (l.base <= height + (l.cut - l.base) * 0.1) found = l;
  return found;
}

export class LowWalls {
  private walls: WallState[] = [];
  private levels: Level[] = [];
  private rooms: { mesh: THREE.Mesh; full: THREE.BufferAttribute | null; low: THREE.BufferAttribute }[] = [];
  private clipped: { mesh: THREE.Mesh; full: THREE.Material | THREE.Material[]; low: THREE.Material | THREE.Material[] }[] = [];
  private hidden: THREE.Object3D[] = [];
  private on = false;
  private readonly up: 0 | 1 | 2;

  constructor(private root: THREE.Object3D, up: 0 | 1 | 2 = 1) {
    this.up = up;
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !nameOf(mesh, root, WALL)) return;
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
      this.walls.push({ mesh, original: new Float32Array(pos.array as ArrayLike<number>), base: min, top: max, cut: max });
    });

    // Étages en coordonnées monde, puis coupe de chaque morceau dans son repère.
    const world = (w: WallState, h: number) =>
      new THREE.Vector3().setComponent(up, h).applyMatrix4(w.mesh.matrixWorld).getComponent(up);
    const local = (w: WallState, h: number) => {
      const inv = new THREE.Matrix4().copy(w.mesh.matrixWorld).invert();
      return new THREE.Vector3().setComponent(up, h).applyMatrix4(inv).getComponent(up);
    };
    this.levels = levelsOf(this.walls.map((w) => ({ base: world(w, w.base), top: world(w, w.top) })));
    for (const w of this.walls) {
      const level = levelAt(this.levels, world(w, w.base));
      if (level) w.cut = local(w, level.cut);
    }
  }

  /** Le modèle a-t-il des murs reconnus ? Sinon le mode n'est pas proposé. */
  get available(): boolean {
    return this.walls.length > 0;
  }

  get active(): boolean {
    return this.on;
  }

  set(on: boolean) {
    if (on === this.on || !this.available) return;
    this.on = on;
    if (on) this._lower();
    else this._restore();
  }

  private _lower() {
    for (const w of this.walls) {
      const pos = w.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        if (pos.getComponent(i, this.up) > w.cut) pos.setComponent(i, this.up, w.cut);
      }
      pos.needsUpdate = true;
      w.mesh.geometry.computeBoundingBox();
      w.mesh.geometry.computeBoundingSphere();
    }

    const levels = this.levels;
    const box = new THREE.Box3();
    const upVec = new THREE.Vector3().setComponent(this.up, -1);

    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || nameOf(mesh, this.root, WALL) || !mesh.visible) return;

      // Plafonds : les triangles d'une pièce situés en haut de son volume.
      if (nameOf(mesh, this.root, ROOM)) {
        const low = this._withoutCeiling(mesh);
        if (low) {
          this.rooms.push({ mesh, full: mesh.geometry.getIndex(), low });
          mesh.geometry.setIndex(low);
        }
        return;
      }

      box.setFromObject(mesh);
      if (box.isEmpty()) return;
      const level = levelAt(levels, box.min.getComponent(this.up));
      if (!level) return;
      const bottom = box.min.getComponent(this.up);
      const top = box.max.getComponent(this.up);
      if (top <= level.cut) return;

      if (bottom >= level.cut) {
        // Entièrement au-dessus de la coupe : il flotterait dans le vide.
        mesh.visible = false;
        this.hidden.push(mesh);
        return;
      }
      {
        // Coupé à la hauteur des murs, géométrie intacte : une porte s'anime
        // encore, et un tableau à cheval sur la coupe ne flotte pas au-dessus
        // du mur abaissé. Toute la maison se lit comme une coupe d'architecte.
        const plane = new THREE.Plane(upVec.clone(), level.cut);
        const clip = (m: THREE.Material) => {
          const c = m.clone();
          c.clippingPlanes = [plane];
          c.clipShadows = true;
          return c;
        };
        const full = mesh.material;
        const low = Array.isArray(full) ? full.map(clip) : clip(full);
        mesh.material = low;
        this.clipped.push({ mesh, full, low });
      }
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

  private _restore() {
    for (const w of this.walls) {
      const pos = w.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      (pos.array as Float32Array).set(w.original);
      pos.needsUpdate = true;
      w.mesh.geometry.computeBoundingBox();
      w.mesh.geometry.computeBoundingSphere();
    }
    for (const r of this.rooms) r.mesh.geometry.setIndex(r.full);
    for (const c of this.clipped) {
      const low = Array.isArray(c.low) ? c.low : [c.low];
      low.forEach((m) => m.dispose());
      c.mesh.material = c.full;
    }
    for (const o of this.hidden) o.visible = true;
    this.rooms = [];
    this.clipped = [];
    this.hidden = [];
  }
}
