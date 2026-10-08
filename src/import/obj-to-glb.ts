/**
 * obj-to-glb.ts — convertit un export OBJ (Sweet Home 3D, Blender…) en GLB.
 *
 * Tout se passe dans le navigateur : l'utilisateur glisse son export sur la
 * carte, il n'installe rien et ne lance aucune commande. Le module est pur — du
 * texte et des octets en entrée, un GLB en sortie — pour se tester sans DOM.
 *
 * Trois choix qui comptent :
 *
 * - **Les noms de groupes sont gardés**, un nœud glTF par groupe. Sweet Home 3D
 *   y écrit ce qui est une porte et sa charnière (`sweethome3d_hinge_1`,
 *   `sweethome3d_opening_on_hinge_1_door`) : c'est ce qui permettra de proposer
 *   les ouvrants sans rien deviner.
 * - **Les textures sont embarquées.** Face à un plan généré, l'argument d'Owlnest
 *   est le réalisme de la vraie maison ; un import qui perdrait le parquet et
 *   les carrelages le trahirait.
 * - **Les sommets sont dédupliqués.** L'OBJ répète chaque coin de chaque face ;
 *   l'indexer divise la taille par trois ou quatre.
 */

import { sh3dLeaves, boxOf, hingeSide, LEAF_PREFIX, type Sh3dLeafExtras } from './sh3d';

export interface ImportImage {
  data: Uint8Array;
  mime: 'image/jpeg' | 'image/png';
}

export interface ImportStats {
  triangles: number;
  groups: number;
  /** Vantaux Sweet Home 3D reconnus, prêts à devenir des ouvrants. */
  leaves: number;
  materials: number;
  textures: number;
  /** Textures citées par le MTL mais absentes des fichiers fournis. */
  missingTextures: string[];
}

export interface ImportResult {
  glb: ArrayBuffer;
  stats: ImportStats;
}

interface Material {
  name: string;
  color: [number, number, number];
  opacity: number;
  map?: string;
}

/** Nom de fichier seul, sans dossier ni casse : les MTL citent des chemins variés. */
export function fileKey(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/');
  return (parts[parts.length - 1] ?? '').trim().toLowerCase();
}

/** Lit un MTL : couleur diffuse, opacité, texture diffuse. */
export function parseMtl(text: string): Map<string, Material> {
  const out = new Map<string, Material>();
  let cur: Material | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line[0] === '#') continue;
    const sp = line.search(/\s/);
    const key = sp < 0 ? line : line.slice(0, sp);
    const rest = sp < 0 ? '' : line.slice(sp + 1).trim();
    if (key === 'newmtl') {
      cur = { name: rest, color: [0.8, 0.8, 0.8], opacity: 1 };
      out.set(rest, cur);
    } else if (!cur) {
      continue;
    } else if (key === 'Kd') {
      const v = rest.split(/\s+/).map(Number);
      if (v.length >= 3 && v.every(Number.isFinite)) cur.color = [v[0], v[1], v[2]];
    } else if (key === 'd') {
      const d = Number(rest);
      if (Number.isFinite(d)) cur.opacity = d;
    } else if (key === 'Tr') {
      const tr = Number(rest);
      if (Number.isFinite(tr)) cur.opacity = 1 - tr;
    } else if (key === 'map_Kd') {
      // Les options (`-s 1 1 1 fichier.jpg`) précèdent le nom : il est en dernier.
      const tokens = rest.split(/\s+/);
      cur.map = tokens[tokens.length - 1];
    }
  }
  return out;
}

/** Une primitive en construction : un groupe, un matériau. */
class Prim {
  readonly pos: number[] = [];
  readonly uv: number[] = [];
  readonly nor: number[] = [];
  readonly idx: number[] = [];
  private readonly seen = new Map<string, number>();
  hasUv = false;
  hasNormal = false;

  constructor(readonly material: string) {}

  vertex(key: string, p: number[], pi: number, t: number[], ti: number, n: number[], ni: number): number {
    const known = this.seen.get(key);
    if (known !== undefined) return known;
    const i = this.pos.length / 3;
    this.pos.push(p[pi * 3], p[pi * 3 + 1], p[pi * 3 + 2]);
    if (ti >= 0) { this.uv.push(t[ti * 2], 1 - t[ti * 2 + 1]); this.hasUv = true; } else this.uv.push(0, 0);
    if (ni >= 0) { this.nor.push(n[ni * 3], n[ni * 3 + 1], n[ni * 3 + 2]); this.hasNormal = true; } else this.nor.push(0, 1, 0);
    this.seen.set(key, i);
    return i;
  }

  /** Libère la table de déduplication : elle ne sert plus une fois le groupe fermé. */
  close() { this.seen.clear(); }
}

interface Group {
  name: string;
  prims: Map<string, Prim>;
}

/** Index OBJ (base 1, négatif = depuis la fin) vers index base 0, ou -1 si absent. */
function resolve(token: string | undefined, count: number): number {
  if (!token) return -1;
  const v = parseInt(token, 10);
  if (!Number.isFinite(v) || v === 0) return -1;
  return v > 0 ? v - 1 : count + v;
}

/** Lit l'OBJ en avançant de ligne en ligne, sans découper tout le texte d'un coup. */
function parseObj(text: string): { groups: Group[]; triangles: number } {
  const p: number[] = [];
  const t: number[] = [];
  const n: number[] = [];
  const groups: Group[] = [];
  let group: Group = { name: 'default', prims: new Map() };
  groups.push(group);
  let material = '';
  let triangles = 0;

  const openGroup = (name: string) => {
    group.prims.forEach((pr) => pr.close());
    group = { name: name || `group_${groups.length}`, prims: new Map() };
    groups.push(group);
  };

  let start = 0;
  const len = text.length;
  while (start < len) {
    let end = text.indexOf('\n', start);
    if (end < 0) end = len;
    let line = text.slice(start, end);
    start = end + 1;
    if (line.endsWith('\r')) line = line.slice(0, -1);
    const c0 = line.charCodeAt(0);
    if (!line || c0 === 35 /* # */) continue;

    if (line.startsWith('v ')) {
      const s = line.slice(2).trim().split(/\s+/);
      p.push(+s[0], +s[1], +s[2]);
    } else if (line.startsWith('vt ')) {
      const s = line.slice(3).trim().split(/\s+/);
      t.push(+s[0], +(s[1] ?? 0));
    } else if (line.startsWith('vn ')) {
      const s = line.slice(3).trim().split(/\s+/);
      n.push(+s[0], +s[1], +s[2]);
    } else if (line.startsWith('f ')) {
      let prim = group.prims.get(material);
      if (!prim) { prim = new Prim(material); group.prims.set(material, prim); }
      const corners = line.slice(2).trim().split(/\s+/);
      const ids: number[] = [];
      const pc = p.length / 3, tc = t.length / 2, nc = n.length / 3;
      for (const corner of corners) {
        const [a, b, c] = corner.split('/');
        const pi = resolve(a, pc);
        if (pi < 0) continue;
        const ti = resolve(b, tc);
        const ni = resolve(c, nc);
        ids.push(prim.vertex(`${pi}/${ti}/${ni}`, p, pi, t, ti, n, ni));
      }
      // Polygone en éventail : un quad donne deux triangles.
      for (let k = 1; k + 1 < ids.length; k++) {
        prim.idx.push(ids[0], ids[k], ids[k + 1]);
        triangles++;
      }
    } else if (line.startsWith('g ') || line.startsWith('o ')) {
      openGroup(line.slice(2).trim());
    } else if (line.startsWith('usemtl ')) {
      material = line.slice(7).trim();
    }
  }
  group.prims.forEach((pr) => pr.close());
  return { groups: groups.filter((g) => g.prims.size > 0), triangles };
}

/** Assemble le binaire et le JSON du GLB. */
class GlbWriter {
  private chunks: Uint8Array[] = [];
  private length = 0;
  readonly views: Record<string, unknown>[] = [];
  readonly accessors: Record<string, unknown>[] = [];

  private push(bytes: Uint8Array, target?: number): number {
    const pad = (4 - (this.length % 4)) % 4;
    if (pad) { this.chunks.push(new Uint8Array(pad)); this.length += pad; }
    const view: Record<string, unknown> = { buffer: 0, byteOffset: this.length, byteLength: bytes.byteLength };
    if (target) view.target = target;
    this.chunks.push(bytes);
    this.length += bytes.byteLength;
    this.views.push(view);
    return this.views.length - 1;
  }

  floats(values: number[], type: 'VEC2' | 'VEC3', minmax = false): number {
    const arr = new Float32Array(values);
    const view = this.push(new Uint8Array(arr.buffer), 34962);
    const size = type === 'VEC2' ? 2 : 3;
    const acc: Record<string, unknown> = { bufferView: view, componentType: 5126, count: values.length / size, type };
    if (minmax) {
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < values.length; i += 3) {
        for (let k = 0; k < 3; k++) {
          if (values[i + k] < lo[k]) lo[k] = values[i + k];
          if (values[i + k] > hi[k]) hi[k] = values[i + k];
        }
      }
      acc.min = lo; acc.max = hi;
    }
    this.accessors.push(acc);
    return this.accessors.length - 1;
  }

  indices(values: number[], vertexCount: number): number {
    // Seize bits suffisent le plus souvent : deux fois moins lourd.
    const wide = vertexCount > 65535;
    const arr = wide ? new Uint32Array(values) : new Uint16Array(values);
    const view = this.push(new Uint8Array(arr.buffer), 34963);
    this.accessors.push({ bufferView: view, componentType: wide ? 5125 : 5123, count: values.length, type: 'SCALAR' });
    return this.accessors.length - 1;
  }

  image(bytes: Uint8Array): number {
    return this.push(bytes);
  }

  finish(json: Record<string, unknown>): ArrayBuffer {
    const pad = (4 - (this.length % 4)) % 4;
    if (pad) { this.chunks.push(new Uint8Array(pad)); this.length += pad; }
    json.buffers = [{ byteLength: this.length }];
    json.bufferViews = this.views;
    json.accessors = this.accessors;
    let js = new TextEncoder().encode(JSON.stringify(json));
    const jsPad = (4 - (js.byteLength % 4)) % 4;
    if (jsPad) {
      const padded = new Uint8Array(js.byteLength + jsPad);
      padded.set(js);
      padded.fill(0x20, js.byteLength);
      js = padded;
    }
    const total = 12 + 8 + js.byteLength + 8 + this.length;
    const out = new Uint8Array(total);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, 0x46546c67, true);
    dv.setUint32(4, 2, true);
    dv.setUint32(8, total, true);
    dv.setUint32(12, js.byteLength, true);
    dv.setUint32(16, 0x4e4f534a, true);
    out.set(js, 20);
    let o = 20 + js.byteLength;
    dv.setUint32(o, this.length, true);
    dv.setUint32(o + 4, 0x004e4942, true);
    o += 8;
    for (const c of this.chunks) { out.set(c, o); o += c.byteLength; }
    return out.buffer;
  }
}

/**
 * Convertit un OBJ et son MTL en GLB.
 *
 * @param images textures fournies par l'utilisateur, indexées par `fileKey`
 */
export function objToGlb(objText: string, mtlText: string | null, images: Map<string, ImportImage>): ImportResult {
  const mats = mtlText ? parseMtl(mtlText) : new Map<string, Material>();
  const { groups, triangles } = parseObj(objText);
  const w = new GlbWriter();

  // Une texture par fichier, partagée par tous les matériaux qui la citent.
  const gltfImages: Record<string, unknown>[] = [];
  const textures: Record<string, unknown>[] = [];
  const textureOf = new Map<string, number>();
  const missing = new Set<string>();
  const textureFor = (map: string | undefined): number | undefined => {
    if (!map) return undefined;
    const key = fileKey(map);
    if (textureOf.has(key)) return textureOf.get(key);
    const img = images.get(key);
    if (!img) { missing.add(map); return undefined; }
    gltfImages.push({ bufferView: w.image(img.data), mimeType: img.mime });
    textures.push({ source: gltfImages.length - 1, sampler: 0 });
    textureOf.set(key, textures.length - 1);
    return textures.length - 1;
  };

  const materials: Record<string, unknown>[] = [];
  const materialOf = new Map<string, number>();
  const materialFor = (name: string, withUv: boolean): number => {
    const key = `${name}|${withUv ? 'uv' : ''}`;
    const known = materialOf.get(key);
    if (known !== undefined) return known;
    const m = mats.get(name);
    const pbr: Record<string, unknown> = {
      baseColorFactor: [...(m?.color ?? [0.8, 0.8, 0.8]), m?.opacity ?? 1],
      metallicFactor: 0,
      roughnessFactor: 0.9,
    };
    const tex = withUv ? textureFor(m?.map) : undefined;
    if (tex !== undefined) pbr.baseColorTexture = { index: tex };
    const mat: Record<string, unknown> = { name: name || 'default', pbrMetallicRoughness: pbr };
    if ((m?.opacity ?? 1) < 0.999) mat.alphaMode = 'BLEND';
    materials.push(mat);
    materialOf.set(key, materials.length - 1);
    return materials.length - 1;
  };

  const meshes: Record<string, unknown>[] = [];
  const nodes: Record<string, unknown>[] = [];
  /** Nœud de chaque groupe, -1 pour un groupe sans triangle. */
  const nodeOfGroup: number[] = [];
  for (const g of groups) {
    nodeOfGroup.push(-1);
    const primitives: Record<string, unknown>[] = [];
    g.prims.forEach((pr) => {
      if (!pr.idx.length) return;
      const attributes: Record<string, number> = { POSITION: w.floats(pr.pos, 'VEC3', true) };
      if (pr.hasNormal) attributes.NORMAL = w.floats(pr.nor, 'VEC3');
      if (pr.hasUv) attributes.TEXCOORD_0 = w.floats(pr.uv, 'VEC2');
      primitives.push({
        attributes,
        indices: w.indices(pr.idx, pr.pos.length / 3),
        material: materialFor(pr.material, pr.hasUv),
      });
    });
    if (!primitives.length) continue;
    meshes.push({ name: g.name, primitives });
    nodes.push({ name: g.name, mesh: meshes.length - 1 });
    nodeOfGroup[nodeOfGroup.length - 1] = nodes.length - 1;
  }

  // Chaque vantail Sweet Home 3D devient un nœud parent de ce qui bouge avec
  // lui (vantail, poignée, vitre) : un seul objet à animer, et le côté des
  // gonds noté à côté, pour proposer l'ouvrant tout réglé.
  const roots = new Set(nodes.map((_, i) => i));
  const boxOfGroups = (ids: number[]) => boxOf(ids.flatMap((i) => [...groups[i].prims.values()].map((pr) => pr.pos)));
  let leafCount = 0;
  for (const leaf of sh3dLeaves(groups.map((g) => g.name))) {
    const children = leaf.moving.map((i) => nodeOfGroup[i]).filter((i) => i >= 0);
    const box = boxOfGroups(leaf.moving);
    const axisBox = boxOfGroups(leaf.axis);
    if (!children.length || !box || !axisBox) continue;
    const size = [0, 1, 2].map((k) => box.max[k] - box.min[k]).sort((a, b) => b - a) as [number, number, number];
    const extras: Sh3dLeafExtras = {
      owlnestLeaf: { motion: leaf.motion, hinge: hingeSide(box, axisBox), pane: leaf.pane, size },
    };
    children.forEach((c) => roots.delete(c));
    nodes.push({ name: `${LEAF_PREFIX}${leaf.piece}_${leaf.n}`, children, extras });
    roots.add(nodes.length - 1);
    leafCount++;
  }

  const json: Record<string, unknown> = {
    asset: { version: '2.0', generator: 'Owlnest OBJ import' },
    scene: 0,
    scenes: [{ name: 'Imported', nodes: [...roots].sort((a, b) => a - b) }],
    nodes,
    meshes,
    materials,
  };
  if (textures.length) {
    json.images = gltfImages;
    json.textures = textures;
    // Les textures d'architecture se répètent : parquet, carrelage, papier peint.
    json.samplers = [{ wrapS: 10497, wrapT: 10497, magFilter: 9729, minFilter: 9987 }];
  }

  return {
    glb: w.finish(json),
    stats: {
      triangles,
      groups: groups.length,
      leaves: leafCount,
      materials: materials.length,
      textures: textures.length,
      missingTextures: [...missing],
    },
  };
}
