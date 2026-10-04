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
import { findCarried, carryName, type CarryPiece } from './part-carry';
import type { OwlnestPart, ExtendAxis, PartNodeRef } from './types';
import {
  partIndexOf, extractPart, restoreTriangles, partFrame, hingePivot, axisName,
  detectExtend, extendDirection, extendSpan, edgeContact,
  type PartFrame, type HingeEdge, type MeshPart, type ExtendFrame, type ExtendSpan,
} from './parts';
import { stampOrder, nodeOrder, resolveNode, meshRankOf, rankOf } from './model-outline';
import { describeEntity } from './entities/descriptors';
import { PartTint, untinted } from './part-tint';
import { ClipRig, commonAncestor } from './parts-clips';

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
  /**
   * Vantail, décalé dans le pivot pour compenser le côté choisi : la pièce
   * détachée, ou le support du nœud désigné.
   */
  object: THREE.Object3D;
  /** Ce que l'utilisateur a désigné, pour le surlignage de l'éditeur. */
  target: THREE.Object3D;
  /** Teinte d'état, sur des copies des matériaux de `target`. */
  tint: PartTint;
  frame: PartFrame;
  box: THREE.Box3;
  /** Position d'extraction de la géométrie, dans l'espace de l'hôte du pivot. */
  origin: THREE.Vector3;
  /** Défait le montage : triangles rendus à leur maille, nœud remis en place. */
  restore: () => void;
  /** Cible du montage, pour savoir si un réglage demande de remonter. */
  key: string;
  /** Signature des pieces entrainees, pour savoir quand remonter. */
  carryKey: string;
  /** Cible résolue (maille et pièce, ou nœud) : deux ouvrants ne la partagent pas. */
  claim: string;
  /** Amplitude maximale : radians pour un battant, unités pour un coulissant. */
  span: number;
  /** Axe animé et son signe. */
  axis: 'x' | 'y' | 'z';
  sign: number;
  rest: number;
  current: number;
  goal: number;
  /** Déroulant : repère de la toile, mesuré au repos. */
  ext: ExtendState | null;
  /** Déroulant : axe d'écrasement et arêtes, d'après les réglages. */
  extSpan: ExtendSpan | null;
  followers: Follower[];
  /** Suiveurs refusés déjà signalés, pour ne pas inonder la console à chaque réglage. */
  warned: Set<string>;
}

/**
 * Un ouvrant animé par les animations du fichier.
 *
 * Rien n'est détaché ni déplacé dans le graphe : les animations posent leurs
 * nœuds là où ils sont, et la pose de repos se rend au démontage.
 */
interface LiveClips {
  cfg: OwlnestPart;
  rig: ClipRig;
  /** Ce qu'on surligne et qu'on teinte : l'ancêtre commun des nœuds animés. */
  target: THREE.Object3D | null;
  tint: PartTint | null;
  /** Animations liées, pour savoir quand relier. */
  key: string;
  current: number;
  goal: number;
}

const clipsKey = (cfg: OwlnestPart) => (cfg.clips ?? []).join('\n');

/** Ce qui avance vers une fraction d'ouverture, quel que soit le mouvement. */
type Moving = { cfg: OwlnestPart; current: number; goal: number };

/**
 * Plus petite échelle appliquée à un déroulant.
 *
 * Une échelle nulle rend la matrice non inversible : ni le lancer de rayons ni
 * la compensation des suiveurs n'y survivraient. Un millième d'une toile de
 * deux mètres fait deux millimètres, invisibles sous le coffre.
 */
const MIN_SCALE = 1e-3;

/** Au-delà, les sommets d'une toile sont sous-échantillonnés : le plan n'en demande pas tant. */
const MAX_EXTEND_POINTS = 20000;

interface ExtendState {
  /** Suiveurs exclus de la mesure, pour savoir quand la refaire. */
  key: string;
  /** Espace de l'hôte du pivot → espace du modèle, et l'inverse. */
  toModel: THREE.Matrix4;
  fromModel: THREE.Matrix4;
  frame: ExtendFrame;
  points: Float32Array;
}

/** Objet qui suit l'arête mobile d'un déroulant, sans se déformer. */
interface Follower {
  obj: THREE.Object3D;
  claim: string;
  /** Matrice propre d'origine, rendue au démontage. */
  local: THREE.Matrix4;
  autoUpdate: boolean;
  /** Parent → modèle, au repos. */
  parentRest: THREE.Matrix4;
  /** Sous le pivot : son parent subit l'écrasement, qu'il faut défaire. */
  inside: boolean;
  /** Teinte propre, pour un suiveur hors de l'objet (sinon celle de l'objet le couvre). */
  tint: PartTint | null;
}

/** Ce que l'éditeur montre d'un déroulant : valeurs détectées et suiveurs possibles. */
export interface ExtendInfo {
  axis: ExtendAxis;
  /** Pente détectée de la toile, en degrés sous l'horizontale. */
  tilt: number;
  /** Longueur de la toile le long de l'axe réglé, en unités du modèle. */
  length: number;
  /** Objets qui touchent l'arête mobile, du plus proche au plus lointain. */
  suggested: PartNodeRef[];
  /** Enfants et voisins de l'objet, les suggestions d'abord. */
  candidates: (PartNodeRef & { touching: boolean })[];
}

const refOf = (o: THREE.Object3D): PartNodeRef => ({ node: o.name, nodeIndex: rankOf(o) });

const isRuntimeObject = (o: THREE.Object3D) => !!(o.userData.owlnestPartId || o.userData.owlnestHelper);

/** Écrasement d'un facteur `s` le long de `u`, le plan `x·u = a` restant fixe. */
function directionalScale(u: THREE.Vector3, a: number, s: number): THREE.Matrix4 {
  const k = s - 1;
  return new THREE.Matrix4().set(
    1 + k * u.x * u.x, k * u.x * u.y, k * u.x * u.z, -k * a * u.x,
    k * u.y * u.x, 1 + k * u.y * u.y, k * u.y * u.z, -k * a * u.y,
    k * u.z * u.x, k * u.z * u.y, 1 + k * u.z * u.z, -k * a * u.z,
    0, 0, 0, 1,
  );
}

/**
 * Mailles du modèle dans un ordre stable.
 *
 * `traverse` parcourt toujours le graphe dans le même ordre pour un fichier
 * donné : ce rang est donc un identifiant fiable, là où un nom ne l'est pas.
 * Il est relevé une fois sur le modèle tel que chargé (`stampOrder`) : un
 * ouvrant qui déplace un nœud sous son pivot change l'ordre de parcours, pas
 * les rangs.
 */
export function meshOrder(root: THREE.Object3D): THREE.Mesh[] {
  stampOrder(root);
  const out: THREE.Mesh[] = [];
  root.traverse((o) => {
    const r = meshRankOf(o);
    if (r !== undefined) out[r] = o as THREE.Mesh;
  });
  return out.filter(Boolean);
}

/** Ce que désigne un ouvrant : deux configurations égales montent la même chose. */
/**
 * Signature de ce qu'un ouvrant emmene avec lui.
 *
 * Ajouter une piece ne change pas la cible de l'ouvrant : sans cette seconde
 * cle, `configure` reconfigurerait en place et la piece, bien enregistree, ne
 * serait jamais attachee. Il faut remonter.
 */
export function partCarryKey(cfg: OwlnestPart): string {
  const picked = (cfg.extra ?? [])
    .map((e) => `${e.mesh}#${e.meshIndex ?? ''}:${e.triangle}`)
    .join('|');
  return `${cfg.carry === true ? 'auto' : ''};${picked};${(cfg.carryExclude ?? []).join(',')}`;
}

export function partTargetKey(cfg: OwlnestPart): string {
  return cfg.node
    ? `node:${cfg.node}#${cfg.nodeIndex ?? ''}`
    : `mesh:${cfg.mesh}#${cfg.meshIndex ?? ''}:${cfg.triangle}`;
}

/**
 * Boîte d'un sous-arbre dans l'espace de son parent.
 *
 * C'est l'espace du pivot : la boîte monde d'un objet tourné (un export
 * Blender redresse chaque objet d'un quart de tour) donnerait de faux axes.
 * Les sommets sont lus un à un : la boîte transformée d'une maille tournée
 * serait plus grosse que l'objet.
 */
export function boxInParent(node: THREE.Object3D): THREE.Box3 {
  const box = new THREE.Box3();
  const host = node.parent;
  if (!host) return box;
  host.updateWorldMatrix(true, false);
  node.updateWorldMatrix(false, true);
  const inv = new THREE.Matrix4().copy(host.matrixWorld).invert();
  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  node.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || mesh.userData.owlnestHelper) return;
    const pos = mesh.geometry.getAttribute('position');
    if (!pos) return;
    m.multiplyMatrices(inv, mesh.matrixWorld);
    for (let i = 0; i < pos.count; i++) {
      box.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(m));
    }
  });
  return box;
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
  private anims: LiveClips[] = [];
  private _built = false;
  /**
   * Verticale du modèle. Sans elle, un coulissant se rabat sur son propre plus
   * grand axe, ce qui fait glisser de côté un volet plus large que haut.
   */
  private _vertical: 0 | 1 | 2 | null = null;

  /** Renseigne la verticale, déduite de la boîte englobante du modèle. */
  setVertical(axis: 0 | 1 | 2 | null) {
    this._vertical = axis;
    for (const item of this.items) this._configure(item, item.cfg);
  }

  get count() { return this.items.length + this.anims.length; }
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
    this._root = root;
    this._center = null;
    const missing: OwlnestPart[] = [];

    // Tout se résout avant le premier montage : les rangs sont ceux du modèle
    // chargé, et deux ouvrants ne doivent pas se disputer la même cible.
    const meshes = meshOrder(root);
    const nodes = nodeOrder(root);
    const resolved: { cfg: OwlnestPart; mount: () => LiveMesh | null }[] = [];
    const animated: OwlnestPart[] = [];
    const claimed = new Set<string>();
    for (const cfg of configs) {
      if (cfg.motion === 'animation') { animated.push(cfg); continue; }
      const mount = this._resolve(cfg, meshes, nodes, claimed);
      if (mount) resolved.push({ cfg, mount });
      else missing.push(cfg);
    }
    // Les pièces d'abord : leur maille peut appartenir à un nœud animé, qu'elles
    // doivent suivre une fois détachées.
    resolved.sort((a, b) => Number(!!a.cfg.node) - Number(!!b.cfg.node));
    for (const { cfg, mount } of resolved) {
      const item = mount();
      if (item) this.items.push(item);
      else missing.push(cfg);
    }

    this._built = true;
    // Les suiveurs se lient une fois toutes les cibles montées : une cible
    // l'emporte sur un suiveur, quel que soit l'ordre des ouvrants.
    for (const item of this.items) if (item.cfg.motion === 'extend') this._configure(item, item.cfg);
    // Les animations en dernier : les autres ouvrants se mesurent au repos.
    let ok = this.items.length;
    for (const cfg of animated) {
      const anim = this._mountClips(cfg);
      this.anims.push(anim);
      // Monté quand même : l'éditeur doit pouvoir choisir une autre animation.
      if (anim.rig.missing.length) missing.push(cfg);
      else ok++;
    }
    return { ok, missing };
  }

  private _mountClips(cfg: OwlnestPart): LiveClips {
    const root = this._root;
    const rig = new ClipRig(root ?? new THREE.Group(), root?.animations ?? [], cfg.clips ?? []);
    const target = root ? commonAncestor(rig.nodes, root) : null;
    return {
      cfg, rig, target, tint: target ? new PartTint(target, cfg.id) : null,
      key: clipsKey(cfg), current: 0, goal: 0,
    };
  }

  private _unmountClips(anim: LiveClips) {
    anim.tint?.restore();
    anim.rig.restore();
  }

  private _placeClips(anim: LiveClips) {
    anim.rig.set(anim.current);
    anim.tint?.apply(anim.cfg.closedColor, anim.cfg.openColor, anim.current);
  }

  private _configureClips(anim: LiveClips, cfg: OwlnestPart) {
    anim.cfg = cfg;
    if (anim.key !== clipsKey(cfg)) {
      this._unmountClips(anim);
      const next = this._mountClips(cfg);
      anim.rig = next.rig;
      anim.target = next.target;
      anim.tint = next.tint;
      anim.key = next.key;
    }
    this._placeClips(anim);
  }

  /** Monte un ouvrant à pièce ou à nœud sur le modèle tel qu'il est, à côté des autres. */
  private _mountNow(cfg: OwlnestPart): LiveMesh | null {
    const root = this._root;
    if (!root) return null;
    const claimed = new Set(this.items.flatMap((o) => [o.claim, ...o.followers.map((f) => f.claim)]));
    const mount = this._resolve(cfg, meshOrder(root), nodeOrder(root), claimed);
    return mount ? mount() : null;
  }

  /**
   * Ouvrant à animations dont une piste pose celui-ci.
   *
   * On ne remonte pas jusqu'à l'ancêtre teinté : deux ouvrants d'un même
   * canapé partagent ce parent, et le premier volerait tous les clics.
   */
  animatedOwnerOf(obj: THREE.Object3D): string | null {
    for (let a: THREE.Object3D | null = obj; a; a = a.parent) {
      const anim = this.anims.find((x) => x.rig.nodes.includes(a));
      if (anim) return anim.cfg.id;
    }
    return null;
  }

  private _root: THREE.Object3D | null = null;
  /** Centre du modèle, dans son propre espace : où se trouve l'intérieur. */
  private _center: THREE.Vector3 | null = null;

  /** Pieces emmenees par ouvrant, au dernier montage. Lu par l'editeur. */
  readonly carried = new Map<string, string[]>();

  /**
   * Trouve la cible d'une configuration et prépare son montage.
   *
   * `claimed` écarte une cible déjà prise : détacher deux fois les mêmes
   * triangles, ou loger un nœud sous deux pivots, produirait une géométrie
   * incohérente.
   */
  private _resolve(
    cfg: OwlnestPart,
    meshes: THREE.Mesh[],
    nodes: THREE.Object3D[],
    claimed: Set<string>,
  ): (() => LiveMesh | null) | null {
    if (cfg.node) {
      const node = resolveNode(nodes, { node: cfg.node, nodeIndex: cfg.nodeIndex });
      if (!node || !node.parent) return null;
      const key = `n:${node.uuid}`;
      if (claimed.has(key)) return null;
      claimed.add(key);
      return () => this._claim(this._attachNode(node, cfg), key);
    }
    const mesh = resolveMesh(meshes, cfg);
    if (!mesh) return null;
    const index = partIndexOf(mesh);
    const partId = index.ofTriangle[cfg.triangle];
    const part = partId >= 0 ? index.parts[partId] : undefined;
    if (!part) return null;
    const key = `m:${mesh.uuid}:${part.id}`;
    if (claimed.has(key)) return null;
    claimed.add(key);
    return () => this._claim(this._attach(mesh, part, cfg), key);
  }

  private _claim(item: LiveMesh | null, claim: string): LiveMesh | null {
    if (item) item.claim = claim;
    return item;
  }

  private _attach(mesh: THREE.Mesh, part: MeshPart, cfg: OwlnestPart): LiveMesh {
    // Toujours extrait du même côté : le côté des gonds se règle ensuite par
    // le nœud pivot, sans retoucher la géométrie.
    const { mesh: object, frame, pivot, saved } = extractPart(mesh, part, 'start');
    object.userData.owlnestPartId = cfg.id;
    // La maille hôte peut porter la teinte d'un nœud animé qui la contient.
    object.material = untinted(mesh.material);

    const pivotNode = new THREE.Group();
    pivotNode.userData.owlnestPartId = cfg.id;
    mesh.add(pivotNode);
    pivotNode.add(object);

    // Les pièces entraînées sont montées plus bas, une fois le vantail placé :
    // `_configure` déplace le pivot sur le gond et ne compense que `object`.
    // Attachées avant, elles encaisseraient ce décalage sans correction.
    let releaseCarried: () => void = () => {};

    const item: LiveMesh = {
      cfg, pivotNode, object, target: object, tint: new PartTint(object, cfg.id),
      frame, box: part.box, origin: pivot,
      restore: () => {
        // Les pieces emmenees rentrent avant la geometrie : elles vivent sous
        // le pivot, que la remise en place de la maille va faire disparaitre.
        releaseCarried();
        restoreTriangles(mesh, part.tris, saved);
        object.geometry.dispose();
      },
      key: partTargetKey(cfg), carryKey: partCarryKey(cfg), claim: '',
      span: 0, axis: 'x', sign: 1, rest: 0, current: 0, goal: 0,
      ext: null, extSpan: null, followers: [], warned: new Set(),
    };
    this._configure(item, cfg);
    // Le vantail porte les pièces : elles suivent ainsi tout changement de côté
    // de gonds, qui replace `object` sans toucher au reste.
    releaseCarried = this._bringAlong(object, object, mesh, cfg);
    return item;
  }

  /**
   * Emmene les pieces contenues dans le volume de l'ouvrant.
   *
   * `attach` est preféré à `add` : il conserve la position à l'écran en
   * convertissant la transformation. Une poignée reparentée sans cela sauterait
   * à l'autre bout de la pièce.
   *
   * On note la place d'origine de chaque pièce pour la rendre exactement : le
   * rang parmi les frères compte, l'ordre de parcours sert à départager les
   * mailles homonymes.
   */
  /**
   * Composantes designees a la main par l'utilisateur.
   *
   * Meme identification que l'ouvrant : le rang de la maille tranche entre
   * homonymes, le triangle d'amorce retrouve la composante entiere. Une piece
   * introuvable est ignoree sans bruit — le modele a pu changer depuis.
   */
  private _pickedPieces(cfg: OwlnestPart, host: THREE.Object3D): CarryPiece[] {
    if (!cfg.extra?.length || !this._root) return [];
    const order = meshOrder(this._root);
    const out: CarryPiece[] = [];
    const seen = new Set<string>();

    for (const ref of cfg.extra) {
      const mesh = resolveMesh(order, ref);
      if (!mesh || mesh === host) continue;
      const index = partIndexOf(mesh);
      const id = index.ofTriangle[ref.triangle];
      const part = id >= 0 ? index.parts[id] : undefined;
      if (!part) continue;
      const name = carryName(mesh, part);
      if (seen.has(name)) continue;
      seen.add(name);
      out.push({ mesh, part, box: part.box.clone().applyMatrix4(mesh.matrixWorld), name });
    }
    return out;
  }

  /**
   * Monte sous `carrier` les pieces qui doivent suivre l'ouvrant.
   *
   * `carrier` est le vantail lui-meme, et non le pivot : c'est lui que
   * `_configure` replace a chaque changement de cote de gonds, et les pieces
   * doivent rester solidaires de la piece visible, pas du point de rotation.
   */
  private _bringAlong(
    carrier: THREE.Object3D,
    object: THREE.Object3D,
    host: THREE.Object3D,
    cfg: OwlnestPart,
  ): () => void {
    this.carried.set(cfg.id, []);
    if (!this._root) return () => {};

    this._root.updateMatrixWorld(true);
    const found = this._pickedPieces(cfg, host);

    // La detection par contenance ne vient qu'en complement, et sur demande :
    // elle se trompe des que le modele ne separe pas proprement ses pieces.
    if (cfg.carry === true) {
      const box = new THREE.Box3().setFromObject(object);
      const deja = new Set(found.map((f) => f.name));
      for (const piece of findCarried(this._root, box, host, cfg.carryExclude ?? [])) {
        if (!deja.has(piece.name)) found.push(piece);
      }
    }
    if (!found.length) return () => {};

    // Chaque piece est detachee de sa maille comme l'est le vantail : une
    // poignee partage sa maille avec toutes les autres poignees du logement,
    // reparenter la maille entiere emmenerait l'etage.
    const taken = found.map((piece) => {
      const { mesh: detached, saved } = extractPart(piece.mesh, piece.part, 'start');
      detached.userData.owlnestPartId = cfg.id;
      detached.material = untinted(piece.mesh.material);
      // `attach` et non `add` : la position a l'ecran ne doit pas bouger.
      carrier.attach(detached);
      return { source: piece.mesh, part: piece.part, saved, detached };
    });
    this.carried.set(cfg.id, found.map((piece) => piece.name));

    return () => {
      for (const t of taken) {
        restoreTriangles(t.source, t.part.tris, t.saved);
        t.detached.parent?.remove(t.detached);
        t.detached.geometry.dispose();
      }
    };
  }

  /**
   * Monte un nœud entier sous un pivot, sans toucher à sa géométrie.
   *
   * Le pivot vit dans l'espace du parent d'origine ; un support intermédiaire
   * porte le décalage de gond, et le nœud y est replacé de sorte que sa
   * position à l'écran ne change pas. Tout se défait en remettant le nœud à sa
   * place parmi ses frères.
   */
  private _attachNode(node: THREE.Object3D, cfg: OwlnestPart): LiveMesh | null {
    const host = node.parent;
    if (!host) return null;
    const box = boxInParent(node);
    if (box.isEmpty()) return null;
    const frame = partFrame(box);
    const origin = hingePivot(box, frame, 'start');
    const slot = host.children.indexOf(node);

    const pivotNode = new THREE.Group();
    pivotNode.userData.owlnestPartId = cfg.id;
    const holder = new THREE.Group();
    holder.userData.owlnestPartId = cfg.id;
    host.add(pivotNode);
    pivotNode.add(holder);
    holder.add(node);
    let releaseCarried: () => void = () => {};
    // Le support se trouve en `origin` quand l'ouvrant est fermé : le nœud
    // recule d'autant. Valable parce que le support n'a ni rotation ni échelle.
    node.position.sub(origin);

    const item: LiveMesh = {
      cfg, pivotNode, object: holder, target: node, tint: new PartTint(node, cfg.id),
      frame, box, origin,
      restore: () => {
        releaseCarried();
        node.position.add(origin);
        host.add(node);
        host.children.splice(host.children.indexOf(node), 1);
        host.children.splice(Math.min(slot, host.children.length), 0, node);
      },
      key: partTargetKey(cfg), carryKey: partCarryKey(cfg), claim: '',
      span: 0, axis: 'x', sign: 1, rest: 0, current: 0, goal: 0,
      ext: null, extSpan: null, followers: [], warned: new Set(),
    };
    this._configure(item, cfg);
    releaseCarried = this._bringAlong(node, node, node, cfg);
    return item;
  }

  /** Défait le montage d'un ouvrant. */
  private _unmount(item: LiveMesh) {
    this._releaseFollowers(item);
    item.tint.restore();
    item.pivotNode.parent?.remove(item.pivotNode);
    item.restore();
  }

  /**
   * Change la cible d'un ouvrant monté, sans recharger le modèle.
   *
   * Les deux montages sont réversibles : on défait l'ancien, on monte le
   * nouveau, et l'on revient à l'ancien si le nouveau est introuvable.
   */
  private _retarget(item: LiveMesh, cfg: OwlnestPart): boolean {
    const root = this._root;
    if (!root) return false;
    const at = this.items.indexOf(item);
    this._unmount(item);
    item.claim = '';

    const claimed = new Set(this.items.filter((o) => o !== item)
      .flatMap((o) => [o.claim, ...o.followers.map((f) => f.claim)]));
    const tryMount = (c: OwlnestPart) => {
      const mount = this._resolve(c, meshOrder(root), nodeOrder(root), claimed);
      return mount ? mount() : null;
    };
    const next = tryMount(cfg);
    const mounted = next ?? tryMount(item.cfg);
    if (!mounted) { this.items.splice(at, 1); return false; }
    mounted.current = item.current;
    mounted.goal = item.goal;
    this._place(mounted);
    this.items[at] = mounted;
    return !!next;
  }

  /** L'ouvrant est-il monté sur la cible que décrit cette configuration ? */
  hasTarget(cfg: OwlnestPart): boolean {
    if (this.anims.some((a) => a.cfg.id === cfg.id)) return true;
    const item = this.items.find((i) => i.cfg.id === cfg.id);
    return !!item && item.key === partTargetKey(cfg);
  }

  /** Objet désigné par un ouvrant monté : la pièce détachée, le nœud, ou ce qu'animent ses animations. */
  objectOf(id: string): THREE.Object3D | null {
    const anim = this.anims.find((a) => a.cfg.id === id);
    if (anim) return anim.target;
    return this.items.find((i) => i.cfg.id === id)?.target ?? null;
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
    if (cfg.motion === 'extend') {
      this._configureExtend(item, cfg);
      this._place(item);
      return;
    }
    this._releaseFollowers(item);
    item.pivotNode.matrixAutoUpdate = true;
    item.pivotNode.scale.set(1, 1, 1);
    const frame = item.frame;
    const up = this._localVertical(item);
    const edge = cfg.motion === 'swing' && cfg.swingAxis === 'horizontal'
      ? this._horizontalEdge(frame, up.axis)
      : undefined;
    // Maille retournée : le bas du monde est le haut de la maille.
    const flipped = !!edge && edge.across === up.axis && up.down;
    const chosen = cfg.hinge ?? 'start';
    const hinge = flipped ? (chosen === 'start' ? 'end' : 'start') : chosen;

    // Le nœud se place sur l'arête choisie ; le vantail se décale d'autant en
    // sens inverse pour ne pas bouger à l'écran.
    const seat = hingePivot(item.box, frame, hinge, edge);
    item.pivotNode.position.copy(seat);
    item.object.position.copy(item.origin).sub(seat);
    item.pivotNode.rotation.set(0, 0, 0);

    if (cfg.motion === 'slide') {
      const dir = cfg.slide ?? 'down';
      const vertical = up.axis;
      // « Vers le bas » suit la verticale du modèle ; « vers un côté » suit le
      // plus grand axe restant, celui dans lequel le tablier a de la course.
      const sideways = ([frame.up, frame.wide, frame.thin] as const)
        .filter((a) => a !== vertical)
        .sort((a, b) => frame.size[b] - frame.size[a])[0] ?? frame.wide;
      const along = dir === 'down' || dir === 'up' ? vertical : sideways;
      item.span = frame.size[along] * (cfg.travel ?? 1);
      item.axis = axisName(along);
      item.sign = (dir === 'up' || dir === 'end' ? 1 : -1) * (along === vertical && up.down ? -1 : 1);
      item.rest = seat.getComponent(along);
    } else {
      item.span = THREE.MathUtils.degToRad(cfg.angle ?? 90);
      item.axis = axisName(edge?.axis ?? frame.up);
      item.sign = (hinge === 'start' ? -1 : 1) * (cfg.swingSide === 'back' ? -1 : 1);
      item.rest = 0;
    }
    this._place(item);
  }

  /**
   * Arête d'un abattant : rotation autour de l'axe horizontal du vantail, bord
   * choisi le long de la verticale du modèle (`start` = bas, `end` = haut).
   *
   * Le repère propre de la pièce ne dit pas où est le haut — un four est plus
   * large que haut —, d'où la verticale du modèle. Si elle se confond avec
   * l'épaisseur (trappe posée à plat), on retombe sur le plus grand axe.
   */
  private _horizontalEdge(frame: PartFrame, vertical: 0 | 1 | 2): HingeEdge {
    if (vertical === frame.thin) return { axis: frame.up, across: frame.wide };
    const axis = vertical === frame.up ? frame.wide : frame.up;
    return { axis, across: vertical };
  }

  /**
   * Verticale du modèle exprimée dans le repère de la maille hôte.
   *
   * La verticale se mesure sur la boîte du modèle, donc dans le monde, alors
   * que pivot et rotation vivent dans l'espace local de la maille. Un export
   * qui redresse un Z-up par une rotation de nœud décale les deux : sans
   * conversion, la verticale tombe sur l'épaisseur du vantail. `down` signale
   * une maille retournée, où le haut du monde est le bas local.
   */
  private _localVertical(item: LiveMesh): { axis: 0 | 1 | 2; down: boolean } {
    const host = item.pivotNode.parent;
    if (this._vertical === null || !host) return { axis: item.frame.up, down: false };
    host.updateWorldMatrix(true, false);
    const dir = new THREE.Vector3().setComponent(this._vertical, 1)
      .transformDirection(new THREE.Matrix4().copy(host.matrixWorld).invert());
    const c = [dir.x, dir.y, dir.z];
    let axis: 0 | 1 | 2 = 0;
    for (const a of [1, 2] as const) if (Math.abs(c[a]) > Math.abs(c[axis])) axis = a;
    return { axis, down: c[axis] < 0 };
  }

  /**
   * Applique un réglage venu de l'éditeur, sans rien reconstruire.
   *
   * Un changement de cible (autre nœud, retour à la pièce cliquée) remonte
   * l'ouvrant en place : les montages sont réversibles, le modèle n'a pas à
   * être rechargé. Retourne `false` si l'ouvrant n'est pas (ou plus) monté, ou
   * si sa nouvelle cible est introuvable.
   */
  configure(cfg: OwlnestPart): boolean {
    const at = this.anims.findIndex((a) => a.cfg.id === cfg.id);
    if (at >= 0) {
      const anim = this.anims[at];
      if (cfg.motion === 'animation') { this._configureClips(anim, cfg); return true; }
      // Retour à un mouvement de pièce : la pose de repos d'abord, c'est sur
      // elle que la pièce se mesure.
      this._unmountClips(anim);
      this.anims.splice(at, 1);
      const item = this._mountNow(cfg);
      if (!item) return false;
      item.current = anim.current;
      item.goal = anim.goal;
      this._place(item);
      this.items.push(item);
      return true;
    }
    const item = this.items.find((i) => i.cfg.id === cfg.id);
    if (!item) return false;
    if (cfg.motion === 'animation') {
      this._unmount(item);
      this.items.splice(this.items.indexOf(item), 1);
      const anim = this._mountClips(cfg);
      anim.current = item.current;
      anim.goal = item.goal;
      this._placeClips(anim);
      this.anims.push(anim);
      return true;
    }
    // Un changement de cible, mais aussi de pieces entrainees : les attacher
    // demande d'extraire de la geometrie, ce que la reconfiguration ne fait pas.
    if (item.key !== partTargetKey(cfg) || item.carryKey !== partCarryKey(cfg)) {
      return this._retarget(item, cfg);
    }
    this._configure(item, cfg);
    return true;
  }

  /** Applique les états courants. Retourne `true` si une cible a changé. */
  applyStates(states: Record<string, { state: string; attributes?: Record<string, unknown> } | undefined>): boolean {
    let changed = false;
    for (const item of [...this.items, ...this.anims] as Moving[]) {
      const e = states[item.cfg.entity];
      let f = openFraction(item.cfg.entity, e?.state, e?.attributes, item.cfg.openWhen);
      if (item.cfg.invert) f = 1 - f;
      if (Math.abs(f - item.goal) > 1e-4) {
        item.goal = f;
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
    for (const item of this.items) if (this._advance(item, dt, () => this._place(item))) moving = true;
    for (const anim of this.anims) if (this._advance(anim, dt, () => this._placeClips(anim))) moving = true;
    return moving;
  }

  private _advance(item: Moving, dt: number, place: () => void): boolean {
    const diff = item.goal - item.current;
    if (Math.abs(diff) < 1e-4) {
      if (item.current !== item.goal) { item.current = item.goal; place(); }
      return false;
    }
    const duration = Math.max(0.05, item.cfg.duration ?? 1.2);
    const step = dt / duration;
    item.current += Math.sign(diff) * Math.min(Math.abs(diff), step);
    place();
    return true;
  }

  private _place(item: LiveMesh) {
    if (item.cfg.motion === 'extend') this._placeExtend(item);
    else {
      const value = item.current * item.span * item.sign;
      if (item.cfg.motion === 'slide') item.pivotNode.position[item.axis] = item.rest + value;
      else item.pivotNode.rotation[item.axis] = value;
    }
    // La position animée, pas la cible : la teinte fond avec le mouvement.
    item.tint.apply(item.cfg.closedColor, item.cfg.openColor, item.current);
    for (const f of item.followers) f.tint?.apply(item.cfg.closedColor, item.cfg.openColor, item.current);
  }

  // ── Déroulant ─────────────────────────────────────────────────────────────

  /**
   * Échelle d'un déroulant pour une fraction d'ouverture.
   *
   * La pose du modèle est la pose ouverte : `extendOpen` vaut 1 par défaut.
   */
  private _extendScale(item: LiveMesh): number {
    const open = item.cfg.extendOpen ?? 1;
    const closed = item.cfg.extendClosed ?? 0;
    return Math.max(MIN_SCALE, closed + (open - closed) * item.current);
  }

  /**
   * Écrase la toile vers son arête fixe et entraîne les suiveurs.
   *
   * Le pivot reçoit `C⁻¹·W·C` : l'écrasement `W` est défini dans l'espace du
   * modèle, métrique, puis ramené dans celui de l'hôte, qui peut être tourné et
   * étiré (échelle non uniforme d'un nœud Blender, redressement d'un Z-up).
   * Une matrice composée, donc, et non position/rotation/échelle : un
   * écrasement oblique n'est pas décomposable.
   */
  private _placeExtend(item: LiveMesh) {
    const ext = item.ext;
    const sp = item.extSpan;
    if (!ext || !sp) return;
    const s = this._extendScale(item);
    const W = directionalScale(sp.u, sp.anchor, s);
    item.pivotNode.matrix.multiplyMatrices(ext.fromModel, W).multiply(ext.toModel);
    item.pivotNode.matrixWorldNeedsUpdate = true;

    // Les suiveurs se translatent avec l'arête mobile, sans subir l'écrasement.
    const d = sp.u.clone().multiplyScalar((s - 1) * (sp.far - sp.anchor));
    const move = new THREE.Matrix4().makeTranslation(d.x, d.y, d.z);
    const parentNow = new THREE.Matrix4();
    for (const f of item.followers) {
      parentNow.copy(f.parentRest);
      if (f.inside) parentNow.premultiply(W);
      f.obj.matrix.copy(parentNow.invert()).multiply(move).multiply(f.parentRest).multiply(f.local);
      f.obj.matrixWorldNeedsUpdate = true;
    }
  }

  /** Espace du modèle ← espace d'un objet, tel qu'il est posé en ce moment. */
  private _toModel(o: THREE.Object3D): THREE.Matrix4 {
    const root = this._root;
    o.updateWorldMatrix(true, false);
    if (!root) return o.matrixWorld.clone();
    root.updateWorldMatrix(true, false);
    return new THREE.Matrix4().copy(root.matrixWorld).invert().multiply(o.matrixWorld);
  }

  /** Verticale du monde, exprimée dans l'espace du modèle. */
  private _modelUp(): THREE.Vector3 {
    const up = new THREE.Vector3().setComponent(this._vertical ?? 1, 1);
    const root = this._root;
    if (!root) return up;
    root.updateWorldMatrix(true, false);
    return up.transformDirection(new THREE.Matrix4().copy(root.matrixWorld).invert());
  }

  private _modelCenter(): THREE.Vector3 {
    if (this._center) return this._center;
    const root = this._root;
    if (!root) return new THREE.Vector3();
    root.updateWorldMatrix(true, true);
    const c = new THREE.Box3().setFromObject(root).getCenter(new THREE.Vector3());
    this._center = c.applyMatrix4(new THREE.Matrix4().copy(root.matrixWorld).invert());
    return this._center;
  }

  /**
   * Ramène un ouvrant à sa pose de repos, suiveurs libérés.
   *
   * Toute mesure se fait là : une toile écrasée, ou un suiveur déjà déplacé,
   * fausseraient le repère.
   */
  private _toRest(item: LiveMesh) {
    this._releaseFollowers(item);
    const p = item.pivotNode;
    p.matrixAutoUpdate = true;
    p.position.set(0, 0, 0);
    p.rotation.set(0, 0, 0);
    p.scale.set(1, 1, 1);
    p.updateMatrix();
    item.object.position.copy(item.origin);
  }

  /**
   * Sommets de la toile, dans l'espace du modèle.
   *
   * Un nœud qui porte sa propre maille est mesuré seul : ses enfants (la barre
   * d'un store) ne sont pas la toile. Un groupe est mesuré en entier, suiveurs
   * exclus.
   */
  private _extendPoints(item: LiveMesh, skip: Set<THREE.Object3D>): Float32Array {
    const meshes: THREE.Mesh[] = [];
    const own = item.target as THREE.Mesh;
    if (own.isMesh) meshes.push(own);
    else {
      const walk = (o: THREE.Object3D) => {
        if (skip.has(o) || o.userData.owlnestHelper) return;
        const owner = o.userData.owlnestPartId;
        if (o !== item.target && owner !== undefined && owner !== item.cfg.id) return;
        if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
        for (const c of o.children) walk(c);
      };
      walk(item.target);
    }
    const total = meshes.reduce((n, m) => n + (m.geometry.getAttribute('position')?.count ?? 0), 0);
    const stride = Math.max(1, Math.ceil(total / MAX_EXTEND_POINTS));
    const out: number[] = [];
    const v = new THREE.Vector3();
    for (const m of meshes) {
      const pos = m.geometry.getAttribute('position');
      if (!pos) continue;
      const M = this._toModel(m);
      for (let i = 0; i < pos.count; i += stride) {
        v.fromBufferAttribute(pos, i).applyMatrix4(M);
        out.push(v.x, v.y, v.z);
      }
    }
    return new Float32Array(out);
  }

  private _extendState(item: LiveMesh, skip: Set<THREE.Object3D>, key: string): ExtendState {
    const host = item.pivotNode.parent ?? item.pivotNode;
    const toModel = this._toModel(host);
    const points = this._extendPoints(item, skip);
    return {
      key, toModel, fromModel: toModel.clone().invert(),
      frame: detectExtend(points, this._modelUp(), this._modelCenter()),
      points,
    };
  }

  private _spanOf(ext: ExtendState, cfg: OwlnestPart): ExtendSpan {
    const axis = cfg.extendAxis ?? ext.frame.axis;
    const u = extendDirection(ext.frame, axis, cfg.extendTilt ?? ext.frame.tilt);
    return extendSpan(ext.points, ext.frame, u, cfg.extendAnchor ?? 'start');
  }

  /**
   * Suiveurs possibles : enfants de l'objet, puis ses voisins.
   *
   * Pour une pièce détachée, les voisins sont ceux de sa maille ; la maille
   * elle-même, qui porte tout le reste du modèle, n'en est pas un.
   */
  private _candidates(item: LiveMesh): THREE.Object3D[] {
    const host = item.pivotNode.parent;
    const pool: THREE.Object3D[] = [...item.target.children];
    if (host) {
      pool.push(...host.children);
      if (!item.cfg.node && host.parent) pool.push(...host.parent.children);
    }
    const seen = new Set<THREE.Object3D>();
    return pool.filter((o) => {
      if (seen.has(o) || o === host || o === item.target || isRuntimeObject(o) || rankOf(o) === undefined) return false;
      seen.add(o);
      return true;
    });
  }

  /** Coins des boîtes des mailles d'un objet, dans l'espace du modèle. */
  private _corners(o: THREE.Object3D): Float32Array {
    const out: number[] = [];
    const v = new THREE.Vector3();
    o.traverse((m) => {
      const mesh = m as THREE.Mesh;
      if (!mesh.isMesh || mesh.userData.owlnestHelper) return;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      const b = mesh.geometry.boundingBox;
      if (!b || b.isEmpty()) return;
      const M = this._toModel(mesh);
      for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
        v.set(x, y, z).applyMatrix4(M);
        out.push(v.x, v.y, v.z);
      }
    });
    return new Float32Array(out);
  }

  /** Candidats qui touchent l'arête mobile, du plus proche au plus lointain. */
  private _touching(item: LiveMesh, span: ExtendSpan): { obj: THREE.Object3D; score: number | null }[] {
    return this._candidates(item)
      .map((obj) => ({ obj, score: edgeContact(this._corners(obj), span) }))
      .sort((a, b) => (a.score ?? Infinity) - (b.score ?? Infinity));
  }

  /** Qui d'autre tient cet objet : cible ou suiveur d'un autre ouvrant. */
  private _heldBy(item: LiveMesh, obj: THREE.Object3D): LiveMesh | undefined {
    const claim = `n:${obj.uuid}`;
    return this.items.find((o) => o !== item && (o.claim === claim || o.followers.some((f) => f.obj === obj)));
  }

  /**
   * Suiveurs à lier : ceux de la configuration, ou à défaut ceux qui touchent
   * l'arête mobile.
   *
   * Un objet déjà tenu par un autre ouvrant est écarté — le déplacer des deux
   * côtés le ferait sauter d'une pose à l'autre. Choisi explicitement, il est
   * signalé ; suggéré, il est ignoré sans bruit. L'objet lui-même et ses
   * ancêtres sont exclus : ils portent le pivot.
   */
  private _followerObjects(item: LiveMesh, cfg: OwlnestPart, span: ExtendSpan): THREE.Object3D[] {
    const root = this._root;
    if (!root) return [];
    const ancestors = new Set<THREE.Object3D>();
    for (let a: THREE.Object3D | null = item.pivotNode; a; a = a.parent) ancestors.add(a);
    const ok = (o: THREE.Object3D) => o !== item.target && !ancestors.has(o) && !isRuntimeObject(o);

    if (!cfg.followers) {
      return this._touching(item, span)
        .filter((c) => c.score !== null && ok(c.obj) && !this._heldBy(item, c.obj))
        .map((c) => c.obj);
    }
    const order = nodeOrder(root);
    const out: THREE.Object3D[] = [];
    for (const ref of cfg.followers) {
      const obj = resolveNode(order, ref);
      if (!obj || !ok(obj) || out.includes(obj)) continue;
      const other = this._heldBy(item, obj);
      if (other) {
        const key = `${ref.node}#${ref.nodeIndex ?? ''}`;
        if (!item.warned.has(key)) {
          item.warned.add(key);
          console.warn(
            `[Owlnest] « ${ref.node} » est déjà animé par « ${other.cfg.label || other.cfg.entity || other.cfg.id} » : `
            + `ignoré comme suiveur de « ${cfg.label || cfg.entity || cfg.id} ».`,
          );
        }
        continue;
      }
      out.push(obj);
    }
    return out;
  }

  private _configureExtend(item: LiveMesh, cfg: OwlnestPart) {
    this._toRest(item);
    let ext = item.ext && item.ext.key === '' ? item.ext : this._extendState(item, new Set(), '');
    let span = this._spanOf(ext, cfg);
    // Pendant la construction, les cibles des autres ouvrants ne sont pas
    // encore toutes connues : les suiveurs attendent la fin (voir `build`).
    const objs = this._built ? this._followerObjects(item, cfg, span) : [];
    // Un groupe se mesure sans ses suiveurs ; une maille, elle, ne les compte jamais.
    const key = (item.target as THREE.Mesh).isMesh ? '' : objs.map((o) => o.uuid).join(',');
    if (key !== ext.key) {
      ext = this._extendState(item, new Set(objs), key);
      span = this._spanOf(ext, cfg);
    }
    item.ext = ext;
    item.extSpan = span;

    for (const obj of objs) {
      obj.updateMatrix();
      const inside = (() => {
        for (let a = obj.parent; a; a = a.parent) if (a === item.pivotNode) return true;
        return false;
      })();
      item.followers.push({
        obj, claim: `n:${obj.uuid}`,
        local: obj.matrix.clone(), autoUpdate: obj.matrixAutoUpdate,
        parentRest: obj.parent ? this._toModel(obj.parent) : new THREE.Matrix4(),
        inside,
        tint: inside ? null : new PartTint(obj, cfg.id),
      });
      obj.matrixAutoUpdate = false;
    }
    item.pivotNode.matrixAutoUpdate = false;
  }

  /** Rend aux suiveurs leur pose et leurs matériaux. */
  private _releaseFollowers(item: LiveMesh) {
    for (const f of item.followers) {
      f.tint?.restore();
      f.obj.matrixAutoUpdate = f.autoUpdate;
      f.obj.matrix.copy(f.local);
      f.obj.matrixWorldNeedsUpdate = true;
    }
    item.followers = [];
  }

  /**
   * Valeurs détectées d'un déroulant et suiveurs possibles, pour l'éditeur.
   *
   * La mesure se fait au repos, sur l'ouvrant monté quel que soit son
   * mouvement actuel ; il est ensuite remis dans sa pose.
   */
  extendInfo(id: string): ExtendInfo | null {
    const item = this.items.find((i) => i.cfg.id === id);
    if (!item || !this._root) return null;
    this._toRest(item);
    const ext = this._extendState(item, new Set(), '');
    const span = this._spanOf(ext, item.cfg);
    const ranked = this._touching(item, span);
    this._configure(item, item.cfg);
    const free = (o: THREE.Object3D) => !this._heldBy(item, o);
    return {
      axis: ext.frame.axis,
      tilt: ext.frame.tilt,
      length: Math.abs(span.far - span.anchor),
      suggested: ranked.filter((c) => c.score !== null && free(c.obj)).map((c) => refOf(c.obj)),
      candidates: ranked.slice(0, 60).map((c) => ({ ...refOf(c.obj), touching: c.score !== null })),
    };
  }

  /** Position d'un ouvrant, pour l'aperçu de l'éditeur. */
  preview(id: string, fraction: number) {
    const item: Moving | undefined = this.items.find((i) => i.cfg.id === id) ?? this.anims.find((a) => a.cfg.id === id);
    if (item) item.goal = Math.min(1, Math.max(0, fraction));
  }

  boxOf(id: string): THREE.Box3 | null {
    const anim = this.anims.find((a) => a.cfg.id === id);
    if (anim) return anim.target ? new THREE.Box3().setFromObject(anim.target) : null;
    const item = this.items.find((i) => i.cfg.id === id);
    if (!item) return null;
    return new THREE.Box3().setFromObject(item.pivotNode);
  }

  /**
   * Remet le modèle dans son état d'origine.
   *
   * Les triangles retirés retrouvent leur place dans l'index et les nœuds
   * montés reviennent sous leur parent. Dans l'ordre inverse du montage : un
   * nœud peut contenir le pivot d'une pièce détachée avant lui.
   */
  dispose(root?: THREE.Object3D) {
    // Montées en dernier, rendues en premier.
    for (let i = this.anims.length - 1; i >= 0; i--) this._unmountClips(this.anims[i]);
    this.anims = [];
    for (let i = this.items.length - 1; i >= 0; i--) this._unmount(this.items[i]);
    this.items = [];
    this._built = false;
    this._root = null;
    root?.traverse((o) => { delete o.userData.__owlnestParts; });
  }
}

export { partFrame };
