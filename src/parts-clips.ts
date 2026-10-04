/**
 * parts-clips.ts — pose le modèle d'après les animations du fichier.
 *
 * Une animation exportée de Blender (une piste NLA par action) n'est pas jouée
 * dans le temps : elle est lue comme une course, de la première à la dernière
 * image clé, et la fraction d'ouverture de l'entité dit où s'arrêter. Un
 * fauteuil à 40 % reste incliné à 40 %.
 *
 * Pas d'`AnimationMixer` : il mélange chaque action à la pose d'origine selon
 * son poids et désactive une action arrivée au bout. Ici une fraction doit
 * toujours donner la même pose, quel que soit le chemin pour y arriver.
 */
import * as THREE from 'three';

/** Ce que l'éditeur montre d'une animation du modèle. */
export interface ClipInfo {
  name: string;
  /** Durée de la course, en secondes. */
  duration: number;
  /** Nœuds animés, tels que nommés dans le modèle chargé. */
  nodes: string[];
}

/**
 * Instants de la première et de la dernière image clé.
 *
 * Blender commence à la frame 1 : la première clé tombe à 1/24 s, pas à 0.
 * `clip.duration` ne connaît que la fin.
 */
export function clipRange(clip: THREE.AnimationClip): [number, number] {
  let start = Infinity;
  let end = -Infinity;
  for (const track of clip.tracks) {
    const n = track.times.length;
    if (!n) continue;
    start = Math.min(start, track.times[0]);
    end = Math.max(end, track.times[n - 1]);
  }
  return Number.isFinite(start) ? [start, end] : [0, 0];
}

const nodeOfTrack = (track: THREE.KeyframeTrack) => THREE.PropertyBinding.parseTrackName(track.name).nodeName;

export function clipInfos(clips: readonly THREE.AnimationClip[]): ClipInfo[] {
  return clips.map((clip) => {
    const [start, end] = clipRange(clip);
    return {
      name: clip.name,
      duration: end - start,
      nodes: [...new Set(clip.tracks.map(nodeOfTrack))],
    };
  });
}

/**
 * Ce que les types de three taisent : `bind()` installe ces accesseurs, et
 * `setInterpolation` (ou GLTFLoader, pour CUBICSPLINE) la fabrique d'interpolant.
 */
type Binding = THREE.PropertyBinding & {
  getValue(target: ArrayLike<number>, offset: number): void;
  setValue(source: ArrayLike<number>, offset: number): void;
};
type Track = THREE.KeyframeTrack & { createInterpolant(): THREE.Interpolant };

interface Channel {
  binding: Binding;
  interpolant: THREE.Interpolant;
  rest: number[];
  start: number;
  end: number;
}

/**
 * Animations liées à un modèle, prêtes à être posées.
 *
 * La pose de repos est relevée au montage : `restore` la rend, pour que les
 * autres ouvrants se mesurent toujours sur le modèle tel que chargé.
 */
export class ClipRig {
  /** Nœuds effectivement animés. */
  readonly nodes: THREE.Object3D[] = [];
  /** Animations demandées absentes du modèle (renommées dans Blender, par exemple). */
  readonly missing: string[] = [];
  private channels: Channel[] = [];

  constructor(root: THREE.Object3D, clips: readonly THREE.AnimationClip[], names: readonly string[]) {
    const seen = new Set<THREE.Object3D>();
    for (const name of names) {
      const clip = clips.find((c) => c.name === name);
      if (!clip) { this.missing.push(name); continue; }
      const [start, end] = clipRange(clip);
      for (const track of clip.tracks) {
        // Chercher le nœud d'abord : `PropertyBinding` se plaint dans la
        // console, à chaque image, d'un nœud introuvable.
        const node = THREE.PropertyBinding.findNode(root, nodeOfTrack(track)) as THREE.Object3D | null;
        if (!node) continue;
        const binding = new THREE.PropertyBinding(root, track.name) as Binding;
        binding.bind();
        const rest = new Array<number>(track.getValueSize());
        binding.getValue(rest, 0);
        this.channels.push({ binding, interpolant: (track as Track).createInterpolant(), rest, start, end });
        if (!seen.has(node)) { seen.add(node); this.nodes.push(node); }
      }
    }
  }

  /** Pose les animations à une fraction de leur course, de 0 à 1. */
  set(fraction: number) {
    const f = Math.min(1, Math.max(0, fraction));
    for (const c of this.channels) {
      c.binding.setValue(c.interpolant.evaluate(c.start + (c.end - c.start) * f), 0);
    }
  }

  /** Rend la pose relevée au montage. */
  restore() {
    // À rebours : si deux animations touchent le même nœud, la première
    // relevée a vu la vraie pose de repos.
    for (let i = this.channels.length - 1; i >= 0; i--) {
      const c = this.channels[i];
      c.binding.setValue(c.rest, 0);
      c.binding.unbind();
    }
    this.channels = [];
  }
}

/**
 * Plus petit ancêtre commun des nœuds animés, hors racine du modèle.
 *
 * C'est l'objet qu'on surligne et qu'on teinte : le canapé entier pour ses
 * deux mécanismes. Remonter jusqu'à la racine teinterait toute la maison ;
 * on s'en tient alors au premier nœud.
 */
export function commonAncestor(nodes: readonly THREE.Object3D[], root: THREE.Object3D): THREE.Object3D | null {
  if (!nodes.length) return null;
  const chain = (o: THREE.Object3D) => {
    const out: THREE.Object3D[] = [];
    for (let a: THREE.Object3D | null = o; a; a = a.parent) out.unshift(a);
    return out;
  };
  let shared = chain(nodes[0]);
  for (const n of nodes.slice(1)) {
    const c = chain(n);
    let i = 0;
    while (i < shared.length && i < c.length && shared[i] === c[i]) i++;
    shared = shared.slice(0, i);
  }
  const lca = shared[shared.length - 1];
  return !lca || lca === root || !shared.includes(root) ? nodes[0] : lca;
}
