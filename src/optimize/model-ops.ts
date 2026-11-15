/**
 * model-ops.ts — les optimisations du fichier (catégories B et C).
 *
 * Chacune transforme un document glTF-Transform en place. Elles tournent dans
 * le worker de la carte comme dans la ligne de commande : ce qui dépend de la
 * plateforme (réduire une image, compresser la géométrie) arrive par le
 * contexte.
 *
 * Règle commune : rien de ce que la scène désigne ne change de nom, de place
 * dans l'arbre ou d'ordre de triangles (voir protected.ts). Un objet protégé
 * est compté comme « épargné », jamais traité en douce.
 */

import { ImageUtils, PropertyType, type Accessor, type Document, type Mesh, type Node, type Primitive, type Texture } from '@gltf-transform/core';
import { EXTMeshGPUInstancing, EXTMeshoptCompression, KHRMeshQuantization, type Transmission } from '@gltf-transform/extensions';
import { dedup, join, listTextureSlots, prune, quantize, simplifyPrimitive, weldPrimitive } from '@gltf-transform/functions';
import { animatedNodes, materialsOf, PHYSICAL_EXTENSIONS, primitiveTriangles } from './analyze';
import { fitWithin, isDetailMap, STRUCTURE } from './catalog';
import { compilePatterns, protectionMatcher, type Protection } from './protected';
import type { OpResult, Params, ProtectSpec, TextureInfo } from './types';

/** Réduit une image ; rend l'image et son type (un navigateur sans encodeur WebP rend du PNG). */
export type ImageResizer = (image: Uint8Array, mime: string, width: number, height: number) => Promise<{ image: Uint8Array; mime: string }>;

export interface OpContext {
  protect: ProtectSpec;
  /** `MeshoptEncoder` prêt (`await MeshoptEncoder.ready`). */
  encoder: unknown;
  /** `MeshoptSimplifier` prêt. */
  simplifier: unknown;
  resize: ImageResizer;
}

type Op = (doc: Document, p: Params, ctx: OpContext, guard: Guard) => Promise<{ affected: number; skipped?: number; note?: string }>;

const num = (p: Params, k: string, d: number) => (typeof p[k] === 'number' ? p[k] as number : Number(p[k] ?? d) || d);
const str = (p: Params, k: string, d = '') => (typeof p[k] === 'string' ? p[k] as string : d);

// ── Protection ─────────────────────────────────────────────────────────────

interface Guard {
  /** Protection d'un nœud : celle de la scène, ou `name` s'il est animé. */
  of(n: Node): Protection;
  animated: Set<Node>;
  /** Nœuds visés directement par une piste d'animation. */
  targets: Set<Node>;
}

function makeGuard(doc: Document, spec: ProtectSpec): Guard {
  const match = protectionMatcher(spec);
  const animated = animatedNodes(doc);
  const targets = new Set<Node>();
  for (const a of doc.getRoot().listAnimations()) for (const c of a.listChannels()) { const n = c.getTargetNode(); if (n) targets.add(n); }
  return {
    animated, targets,
    of: (n) => match(n.getName(), n.getMesh()?.getName()) ?? (animated.has(n) ? 'name' : null),
  };
}

const parentNodes = (m: Mesh): Node[] => m.listParents().filter((p) => p.propertyType === PropertyType.NODE) as Node[];

// ── B. Sans perte ──────────────────────────────────────────────────────────

const count = (doc: Document) => {
  const r = doc.getRoot();
  return r.listTextures().length + r.listMaterials().length + r.listMeshes().length;
};

/** Les nœuds vides restent : les ancres `ha_anchor_*` en sont. */
const KEEP = { keepLeaves: true, keepExtras: true };

const B1: Op = async (doc) => {
  const before = count(doc);
  await doc.transform(
    dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.TEXTURE, PropertyType.MATERIAL] }),
    // Une maille garde son nom s'il est unique : three.js en nomme les objets.
    dedup({ propertyTypes: [PropertyType.MESH], keepUniqueNames: true }),
    prune({ ...KEEP, keepAttributes: true, keepSolidTextures: false }),
  );
  return { affected: before - count(doc) };
};

/** Instancie les mailles répétées, hors nœuds protégés ou animés. */
function instanceFree(doc: Document, guard: Guard, min: number): number {
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  if (!scene) return 0;
  const groups = new Map<Mesh, Node[]>();
  scene.traverse((n) => {
    const m = n.getMesh();
    if (!m || n.getSkin() || n.listChildren().length || n.getExtension('EXT_mesh_gpu_instancing') || guard.of(n)) return;
    if (m.listPrimitives().some((p) => p.listTargets().length)) return;
    const g = groups.get(m);
    if (g) g.push(n); else groups.set(m, [n]);
  });
  let instances = 0;
  let ext: EXTMeshGPUInstancing | null = null;
  const buffer = root.listBuffers()[0];
  for (const [mesh, nodes] of groups) {
    if (nodes.length < min) continue;
    // Tous les nœuds de la maille doivent être retenus : sinon l'un garderait
    // la maille et l'instance la dessinerait une seconde fois.
    if (parentNodes(mesh).length !== nodes.length) continue;
    ext ??= doc.createExtension(EXTMeshGPUInstancing);
    const t = doc.createAccessor().setType('VEC3').setArray(new Float32Array(3 * nodes.length)).setBuffer(buffer);
    const r = doc.createAccessor().setType('VEC4').setArray(new Float32Array(4 * nodes.length)).setBuffer(buffer);
    const s = doc.createAccessor().setType('VEC3').setArray(new Float32Array(3 * nodes.length)).setBuffer(buffer);
    nodes.forEach((n, i) => {
      t.setElement(i, n.getWorldTranslation());
      r.setElement(i, n.getWorldRotation());
      s.setElement(i, n.getWorldScale());
    });
    const batch = ext.createInstancedMesh().setAttribute('TRANSLATION', t).setAttribute('ROTATION', r).setAttribute('SCALE', s);
    scene.addChild(doc.createNode(`${mesh.getName() || 'mesh'}_instances`).setMesh(mesh).setExtension('EXT_mesh_gpu_instancing', batch));
    // Les nœuds d'origine restent, vides : leur nom ne désigne plus rien de visible.
    for (const n of nodes) n.setMesh(null);
    instances += nodes.length;
  }
  return instances;
}

const B2: Op = async (doc, p, _ctx, guard) => {
  let welded = 0, skipped = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    if (parentNodes(mesh).some((n) => guard.of(n) === 'geometry')) { skipped++; continue; }
    for (const prim of mesh.listPrimitives()) { weldPrimitive(prim, { overwrite: true }); welded++; }
  }
  const instances = instanceFree(doc, guard, Math.max(2, num(p, 'min', 3)));
  return { affected: instances, skipped, note: `welded ${welded} primitives, ${instances} instances` };
};

/** Rotation d'un vecteur par un quaternion [x, y, z, w]. */
function rotate(q: number[], v: number[]): number[] {
  const [x, y, z, w] = q;
  const ix = w * v[0] + y * v[2] - z * v[1];
  const iy = w * v[1] + z * v[0] - x * v[2];
  const iz = w * v[2] + x * v[1] - y * v[0];
  const iw = -x * v[0] - y * v[1] - z * v[2];
  return [
    ix * w + iw * -x + iy * -z - iz * -y,
    iy * w + iw * -y + iz * -x - ix * -z,
    iz * w + iw * -z + ix * -y - iy * -x,
  ];
}

/**
 * Quantifie les positions d'une maille en entiers 16 bits.
 *
 * glTF-Transform le fait aussi, mais glisse un nœud sans nom sous tout nœud
 * animé ou parent : three.js renommerait alors la maille, et la scène ne la
 * retrouverait plus. On ne traite donc que les mailles portées par des nœuds
 * feuilles et immobiles, les autres gardent leurs flottants.
 */
function quantizePositions(mesh: Mesh, bits: number, guard: Guard): boolean {
  const nodes = parentNodes(mesh);
  if (!nodes.length) return false;
  if (nodes.some((n) => n.listChildren().length || guard.targets.has(n) || n.getSkin() || n.getExtension('EXT_mesh_gpu_instancing'))) return false;
  const prims = mesh.listPrimitives();
  if (prims.some((p) => p.listTargets().length || p.getMaterial()?.getExtension('KHR_materials_volume'))) return false;
  const positions = new Set<Accessor>();
  for (const p of prims) {
    const a = p.getAttribute('POSITION');
    if (!a || !(a.getArray() instanceof Float32Array)) return false;
    positions.add(a);
  }
  // Un accesseur partagé avec une autre maille est copié : la quantification
  // dépend de la boîte de chaque maille.
  for (const p of prims) {
    const a = p.getAttribute('POSITION')!;
    if (a.listParents().some((q) => q.propertyType === PropertyType.PRIMITIVE && !prims.includes(q as Primitive))) {
      const c = a.clone();
      p.setAttribute('POSITION', c);
      positions.delete(a);
      positions.add(c);
    }
  }
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const a of positions) {
    const arr = a.getArray() as Float32Array;
    for (let i = 0; i < arr.length; i += 3) {
      for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], arr[i + k]); max[k] = Math.max(max[k], arr[i + k]); }
    }
  }
  if (!Number.isFinite(min[0])) return false;
  const off = [0, 1, 2].map((k) => (min[k] + max[k]) / 2);
  const half = Math.max(...[0, 1, 2].map((k) => (max[k] - min[k]) / 2)) || 1;
  const qmax = 2 ** (bits - 1) - 1;
  for (const a of positions) {
    const src = a.getArray() as Float32Array;
    const dst = new Int16Array(src.length);
    for (let i = 0; i < src.length; i++) dst[i] = Math.round(((src[i] - off[i % 3]) / half) * qmax);
    a.setArray(dst).setNormalized(true);
  }
  // La lecture divise par 32767 : l'échelle du nœud compense.
  const k = (half * 32767) / qmax;
  for (const n of nodes) {
    const t = n.getTranslation(), r = n.getRotation(), s = n.getScale();
    const o = rotate(r, [s[0] * off[0], s[1] * off[1], s[2] * off[2]]);
    n.setTranslation([t[0] + o[0], t[1] + o[1], t[2] + o[2]]);
    n.setScale([s[0] * k, s[1] * k, s[2] * k]);
  }
  return true;
}

/** Copie d'un attribut, sommets renumérotés (`remap[i]` : nouvel indice, ou ~0 si inutilisé). */
function remapAttribute(a: Accessor, remap: Uint32Array, unique: number): Accessor {
  const src = a.getArray()!;
  const size = a.getElementSize();
  const dst = new (src.constructor as new (n: number) => typeof src)(unique * size);
  for (let i = 0; i < remap.length; i++) {
    const j = remap[i];
    if (j === 0xffffffff) continue;
    for (let c = 0; c < size; c++) dst[j * size + c] = src[i * size + c];
  }
  return a.clone().setArray(dst);
}

/**
 * Réordonne triangles et sommets pour que meshopt compresse mieux.
 *
 * L'ordre des triangles change : jamais sur une maille désignée par un triangle.
 */
function reorderPrimitive(prim: Primitive, encoder: unknown): boolean {
  const src = prim.getIndices();
  if (!src || prim.getMode() !== 4 || prim.listTargets().length) return false;
  const raw = src.getArray()!;
  const arr = raw instanceof Uint32Array ? raw.slice() : new Uint32Array(raw);
  const [remap, unique] = (encoder as { reorderMesh(i: Uint32Array, t: boolean, s: boolean): [Uint32Array, number] })
    .reorderMesh(arr, true, true);
  for (const sem of prim.listSemantics()) prim.setAttribute(sem, remapAttribute(prim.getAttribute(sem)!, remap, unique));
  prim.setIndices(src.clone().setArray(unique <= 65534 ? new Uint16Array(arr) : arr));
  return true;
}

/** Draco devient meshopt : décodage bien plus rapide, et aucun décodeur à télécharger. */
const B3: Op = async (doc, p, ctx, guard) => {
  const bits = Math.min(16, Math.max(12, Math.round(num(p, 'bits', 14))));
  let done = 0, kept = 0, reordered = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    if (!parentNodes(mesh).some((n) => guard.of(n) === 'geometry')) {
      for (const prim of mesh.listPrimitives()) if (reorderPrimitive(prim, ctx.encoder)) reordered++;
    }
    if (quantizePositions(mesh, bits, guard)) done++; else kept++;
  }
  // Normales et coordonnées de texture : sans transformation de nœud. Les
  // normales sur 8 bits passent par le filtre octaédrique de meshopt.
  await doc.transform(quantize({ pattern: /^(NORMAL|TEXCOORD_\d+)$/, quantizeNormal: 8, quantizeTexcoord: 12, cleanup: false }));
  if (done) doc.createExtension(KHRMeshQuantization).setRequired(true);
  for (const e of doc.getRoot().listExtensionsUsed()) if (e.extensionName === 'KHR_draco_mesh_compression') e.dispose();
  doc.createExtension(EXTMeshoptCompression).setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
  return { affected: done, skipped: 0, note: `${done} meshes quantized, ${kept} kept in float (animated, parent or shared), ${reordered} primitives reordered` };
};

const B4: Op = async (doc) => {
  const attrs = () => doc.getRoot().listMeshes().reduce((s, m) => s + m.listPrimitives().reduce((t, p) => t + p.listSemantics().length, 0), 0);
  const before = attrs();
  await doc.transform(prune({ ...KEEP, keepAttributes: false, keepSolidTextures: true }));
  return { affected: before - attrs() };
};

// ── C. Avec perte ──────────────────────────────────────────────────────────

/**
 * Simplifie les mailles retenues par `pick`, qui rend la part de triangles à
 * garder. Une maille partagée n'est traitée qu'une fois.
 */
function simplifyMeshes(
  doc: Document, guard: Guard, ctx: OpContext, error: number,
  pick: (n: Node, mesh: Mesh, tris: number) => number | null,
): { affected: number; skipped: number; note: string } {
  const done = new Set<Mesh>();
  let affected = 0, skipped = 0, before = 0, after = 0;
  for (const n of doc.getRoot().listNodes()) {
    const mesh = n.getMesh();
    if (!mesh || done.has(mesh)) continue;
    done.add(mesh);
    const prims = mesh.listPrimitives();
    const tris = prims.reduce((s, p) => s + primitiveTriangles(p), 0);
    const ratio = pick(n, mesh, tris);
    if (ratio === null || ratio >= 1) continue;
    if (parentNodes(mesh).some((q) => guard.of(q) === 'geometry')) { skipped++; continue; }
    for (const p of prims) {
      if (p.getMode() !== 4 || p.listTargets().length || !p.getIndices()) continue;
      weldPrimitive(p, { overwrite: true });
      simplifyPrimitive(p, { simplifier: ctx.simplifier, ratio, error, lockBorder: false });
    }
    before += tris;
    after += prims.reduce((s, p) => s + primitiveTriangles(p), 0);
    affected++;
  }
  return { affected, skipped, note: `${before} → ${after} triangles` };
}

const C1: Op = async (doc, p, ctx, guard) => {
  const res = compilePatterns(str(p, 'pattern'));
  const target = num(p, 'target', 30000);
  // Des personnages vus à plusieurs mètres : 5 % d'écart toléré.
  return simplifyMeshes(doc, guard, ctx, 0.05, (n, m, tris) =>
    (tris > target && res.some((re) => re.test(n.getName()) || re.test(m.getName())) ? target / tris : null));
};

const C2: Op = async (doc, p, ctx, guard) => {
  const above = num(p, 'above', 5000), ratio = num(p, 'ratio', 0.5);
  const ex = compilePatterns(str(p, 'exclude'));
  return simplifyMeshes(doc, guard, ctx, 0.01, (n, m, tris) =>
    (tris > above && !STRUCTURE.test(n.getName()) && !ex.some((re) => re.test(n.getName()) || re.test(m.getName())) ? ratio : null));
};

/** Les nœuds qui affichent une texture. */
function textureNodes(t: Texture): Node[] {
  const out = new Set<Node>();
  for (const mat of materialsOf(t)) {
    for (const prim of mat.listParents()) {
      if (prim.propertyType !== PropertyType.PRIMITIVE) continue;
      for (const mesh of prim.listParents()) {
        if (mesh.propertyType === PropertyType.MESH) parentNodes(mesh as Mesh).forEach((n) => out.add(n));
      }
    }
  }
  return [...out];
}

async function shrinkTextures(list: Texture[], max: number, ctx: OpContext): Promise<{ affected: number; note: string }> {
  let affected = 0, before = 0, after = 0;
  for (const t of list) {
    const img = t.getImage();
    if (!img) continue;
    const size = ImageUtils.getSize(img, t.getMimeType());
    if (!size) continue;
    const [w, h] = fitWithin(size[0], size[1], max);
    if (w === size[0] && h === size[1]) continue;
    const out = await ctx.resize(img, t.getMimeType(), w, h);
    before += img.byteLength;
    after += out.image.byteLength;
    t.setImage(out.image).setMimeType(out.mime);
    affected++;
  }
  return { affected, note: `${(before / 1048576).toFixed(1)} → ${(after / 1048576).toFixed(1)} MB` };
}

const C3: Op = async (doc, p, ctx) => {
  const res = compilePatterns(str(p, 'pattern'));
  const hit = (s: string) => res.some((re) => re.test(s));
  const list = doc.getRoot().listTextures().filter((t) => {
    if (hit(t.getName())) return true;
    const nodes = textureNodes(t);
    return nodes.length > 0 && nodes.every((n) => hit(n.getName()) || hit(n.getMesh()?.getName() ?? ''));
  });
  return shrinkTextures(list, num(p, 'max', 128), ctx);
};

const C4: Op = async (doc, p, ctx) => {
  const list = doc.getRoot().listTextures().filter((t) => isDetailMap({ slots: listTextureSlots(t) } as TextureInfo));
  return shrinkTextures(list, num(p, 'max', 256), ctx);
};

/**
 * Une primitive fermée : chaque arête bordée par exactement deux triangles.
 * Ses faces arrière ne se voient jamais, le double face ne sert à rien.
 */
function isClosed(p: Primitive): boolean {
  const pos = p.getAttribute('POSITION'), idx = p.getIndices();
  if (!pos || !idx || p.getMode() !== 4) return false;
  const n = idx.getCount();
  if (n > 900_000) return false;
  // Sommets soudés par position : une couture de texture double les sommets.
  const ids = new Map<string, number>();
  const id = new Uint32Array(pos.getCount());
  const v = [0, 0, 0];
  for (let i = 0; i < id.length; i++) {
    pos.getElement(i, v);
    const key = `${v[0].toFixed(5)},${v[1].toFixed(5)},${v[2].toFixed(5)}`;
    let k = ids.get(key);
    if (k === undefined) { k = ids.size; ids.set(key, k); }
    id[i] = k;
  }
  const edges = new Map<number, number>();
  const V = ids.size;
  const ix = idx.getArray()!;
  for (let i = 0; i < n; i += 3) {
    for (let e = 0; e < 3; e++) {
      const a = id[ix[i + e]], b = id[ix[i + (e + 1) % 3]];
      if (a === b) continue;
      const key = a < b ? a * V + b : b * V + a;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  for (const c of edges.values()) if (c !== 2) return false;
  return edges.size > 0;
}

const C6: Op = async (doc) => {
  let affected = 0, single = 0;
  for (const mat of doc.getRoot().listMaterials()) {
    let changed = false;
    for (const name of PHYSICAL_EXTENSIONS) {
      if (name === 'KHR_materials_transmission' || name === 'KHR_materials_volume') continue;
      if (mat.getExtension(name)) { mat.setExtension(name, null); changed = true; }
    }
    const tr = mat.getExtension<Transmission>('KHR_materials_transmission');
    if (tr) {
      const f = tr.getTransmissionFactor();
      mat.setExtension('KHR_materials_transmission', null);
      mat.setExtension('KHR_materials_volume', null);
      // Le verre devient un voile : plus il transmettait, plus il est léger.
      const c = mat.getBaseColorFactor();
      mat.setAlphaMode('BLEND').setBaseColorFactor([c[0], c[1], c[2], Math.min(c[3], 1 - 0.7 * f)]);
      changed = true;
    }
    if (mat.getDoubleSided() && mat.getAlphaMode() === 'OPAQUE') {
      const prims = mat.listParents().filter((q) => q.propertyType === PropertyType.PRIMITIVE) as Primitive[];
      if (prims.length && prims.every(isClosed)) { mat.setDoubleSided(false); single++; changed = true; }
    }
    if (changed) affected++;
  }
  // Une extension sans plus aucun usage ne doit pas rester déclarée.
  for (const e of doc.getRoot().listExtensionsUsed()) {
    if (PHYSICAL_EXTENSIONS.includes(e.extensionName) && !doc.getRoot().listMaterials().some((m) => m.getExtension(e.extensionName))) e.dispose();
  }
  return { affected, note: `${single} materials single-sided` };
};

const C7: Op = async (doc, _p, _ctx, guard) => {
  const before = doc.getRoot().listMeshes().reduce((s, m) => s + m.listPrimitives().length, 0);
  let skipped = 0;
  await doc.transform(join({
    keepNamed: false, cleanup: false,
    filter: (n: Node) => {
      const keep = !!guard.of(n) || guard.animated.has(n);
      if (keep && n.getMesh()) skipped++;
      return !keep;
    },
  }));
  await doc.transform(prune({ ...KEEP, keepAttributes: true, keepSolidTextures: true }));
  const after = doc.getRoot().listMeshes().reduce((s, m) => s + m.listPrimitives().length, 0);
  return { affected: before - after, skipped };
};

const OPS: Record<string, Op> = { B1, B2, B3, B4, C1, C2, C3, C4, C6, C7 };

/**
 * L'ordre d'application : nettoyer d'abord, alléger, regrouper, et
 * compresser en tout dernier (la quantification fige la géométrie).
 */
export const ORDER = ['B1', 'B4', 'C6', 'C1', 'C2', 'B2', 'C7', 'C3', 'C4', 'B3'];

export interface PipelineOptions {
  onStep?: (id: string, index: number, total: number) => void;
}

/**
 * Applique les optimisations demandées, dans l'ordre de `ORDER`.
 *
 * Un modèle Draco ne peut pas ressortir en Draco depuis le navigateur (aucun
 * encodeur n'y est disponible) : B3 est alors ajouté d'office, en ligne de
 * commande comme dans la carte, pour que les deux donnent le même fichier.
 */
export async function optimizeDocument(
  doc: Document, ops: { id: string; params: Params }[], ctx: OpContext, opts: PipelineOptions = {},
): Promise<OpResult[]> {
  const list = [...ops];
  const draco = doc.getRoot().listExtensionsUsed().some((e) => e.extensionName === 'KHR_draco_mesh_compression');
  const auto = draco && !list.some((o) => o.id === 'B3');
  if (auto) list.push({ id: 'B3', params: {} });
  const sorted = ORDER.flatMap((id) => list.filter((o) => o.id === id));
  const results: OpResult[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const { id, params } = sorted[i];
    opts.onStep?.(id, i, sorted.length);
    const t0 = Date.now();
    // La protection se relit à chaque étape : une étape peut en déplacer les nœuds.
    const guard = makeGuard(doc, ctx.protect);
    const r = await OPS[id](doc, params, ctx, guard);
    results.push({
      id, affected: r.affected, skipped: r.skipped ?? 0, ms: Date.now() - t0,
      note: [auto && id === 'B3' ? 'auto (Draco input)' : '', r.note ?? ''].filter(Boolean).join(' · ') || undefined,
    });
  }
  // Nettoyage final, sans toucher aux nœuds vides ni aux attributs.
  await doc.transform(prune({ ...KEEP, keepAttributes: true, keepSolidTextures: true }));
  return results;
}
