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
import type { OwlnestPart } from './types';
import {
  partIndexOf, extractPart, restoreTriangles, partFrame, hingePivot, axisName,
  type PartFrame, type HingeEdge, type MeshPart,
} from './parts';
import { stampOrder, nodeOrder, resolveNode, meshRankOf } from './model-outline';
import { describeEntity } from './entities/descriptors';
import { PartTint, untinted } from './part-tint';

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
    this._root = root;
    const missing: OwlnestPart[] = [];

    // Tout se résout avant le premier montage : les rangs sont ceux du modèle
    // chargé, et deux ouvrants ne doivent pas se disputer la même cible.
    const meshes = meshOrder(root);
    const nodes = nodeOrder(root);
    const resolved: { cfg: OwlnestPart; mount: () => LiveMesh | null }[] = [];
    const claimed = new Set<string>();
    for (const cfg of configs) {
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
    return { ok: this.items.length, missing };
  }

  private _root: THREE.Object3D | null = null;

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
    };
    this._configure(item, cfg);
    releaseCarried = this._bringAlong(node, node, node, cfg);
    return item;
  }

  /** Défait le montage d'un ouvrant. */
  private _unmount(item: LiveMesh) {
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

    const claimed = new Set(this.items.filter((o) => o !== item).map((o) => o.claim));
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
    const item = this.items.find((i) => i.cfg.id === cfg.id);
    return !!item && item.key === partTargetKey(cfg);
  }

  /** Objet désigné par un ouvrant monté : la pièce détachée ou le nœud. */
  objectOf(id: string): THREE.Object3D | null {
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
    const item = this.items.find((i) => i.cfg.id === cfg.id);
    if (!item) return false;
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
    for (const item of this.items) {
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
    for (const item of this.items) {
      const diff = item.goal - item.current;
      if (Math.abs(diff) < 1e-4) {
        if (item.current !== item.goal) { item.current = item.goal; this._place(item); }
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
    // La position animée, pas la cible : la teinte fond avec le mouvement.
    item.tint.apply(item.cfg.closedColor, item.cfg.openColor, item.current);
  }

  /** Position d'un ouvrant, pour l'aperçu de l'éditeur. */
  preview(id: string, fraction: number) {
    const item = this.items.find((i) => i.cfg.id === id);
    if (item) item.goal = Math.min(1, Math.max(0, fraction));
  }

  boxOf(id: string): THREE.Box3 | null {
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
    for (let i = this.items.length - 1; i >= 0; i--) this._unmount(this.items[i]);
    this.items = [];
    this._built = false;
    this._root = null;
    root?.traverse((o) => { delete o.userData.__owlnestParts; });
  }
}

export { partFrame };
