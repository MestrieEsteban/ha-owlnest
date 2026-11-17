/**
 * analyze.ts — ce que pèse un modèle, et où.
 *
 * Lit un document glTF-Transform (dans le worker ou la ligne de commande) et
 * rend un rapport en JSON : les chiffres d'ensemble, chaque nœud avec ses
 * triangles et sa protection, chaque texture avec ceux qui l'affichent. Les
 * estimations du catalogue ne lisent que ce rapport.
 */

import { ImageUtils, type Document, type Material, type Node, type Primitive, type Texture } from '@gltf-transform/core';
import type { Transmission } from '@gltf-transform/extensions';
import { getBounds, listTextureSlots } from '@gltf-transform/functions';
import { unitsPerMeter } from '../scale';
import { textureGpuBytes } from './catalog';
import { protectionMatcher } from './protected';
import type { MaterialInfo, ModelReport, NodeInfo, ProtectSpec, TextureInfo } from './types';

const MB = 1024 * 1024;

/** Extensions qui font d'une matière un `MeshPhysicalMaterial` dans three.js. */
export const PHYSICAL_EXTENSIONS = [
  'KHR_materials_clearcoat', 'KHR_materials_sheen', 'KHR_materials_specular', 'KHR_materials_ior',
  'KHR_materials_transmission', 'KHR_materials_iridescence', 'KHR_materials_volume',
  'KHR_materials_anisotropy', 'KHR_materials_dispersion',
];

export function primitiveTriangles(p: Primitive): number {
  const n = p.getIndices()?.getCount() ?? p.getAttribute('POSITION')?.getCount() ?? 0;
  const mode = p.getMode();
  if (mode === 4) return Math.floor(n / 3);
  if (mode === 5 || mode === 6) return Math.max(0, n - 2);
  return 0;
}

/** Les nœuds animés et tout ce qu'ils portent : three.js les retrouve par leur nom. */
export function animatedNodes(doc: Document): Set<Node> {
  const out = new Set<Node>();
  const add = (n: Node) => { out.add(n); n.listChildren().forEach(add); };
  for (const a of doc.getRoot().listAnimations()) {
    for (const c of a.listChannels()) {
      const n = c.getTargetNode();
      if (n) add(n);
    }
  }
  return out;
}

export { unitsPerMeter };

/** Empreinte rapide d'une image, pour repérer les doublons exacts. */
function fingerprint(a: Uint8Array): string {
  let h = 0x811c9dc5;
  const step = Math.max(1, Math.floor(a.length / 65536));
  for (let i = 0; i < a.length; i += step) h = Math.imul(h ^ a[i], 0x01000193);
  return `${a.length}:${(h >>> 0).toString(16)}`;
}

function materialInfo(m: Material): MaterialInfo {
  const ext = m.listExtensions().map((e) => e.extensionName);
  const tr = m.getExtension<Transmission>('KHR_materials_transmission');
  return {
    name: m.getName(),
    physical: ext.filter((e) => PHYSICAL_EXTENSIONS.includes(e)),
    transmission: tr ? tr.getTransmissionFactor() : 0,
    doubleSided: m.getDoubleSided(),
    blend: m.getAlphaMode() === 'BLEND',
  };
}

function maxScale(node: Node): number {
  const m = node.getWorldMatrix();
  const sx = Math.hypot(m[0], m[1], m[2]), sy = Math.hypot(m[4], m[5], m[6]), sz = Math.hypot(m[8], m[9], m[10]);
  return Math.max(sx, sy, sz);
}

export function analyzeDocument(doc: Document, fileBytes: number, protect: ProtectSpec): ModelReport {
  const root = doc.getRoot();
  const protection = protectionMatcher(protect);
  const animated = animatedNodes(doc);

  const users = new Map<Material, Set<Node>>();
  const nodes: NodeInfo[] = [];
  const protectedNames = new Set<string>();
  let triangles = 0, primitives = 0;
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) {
      if (protection(node.getName())) protectedNames.add(node.getName());
      continue;
    }
    let tris = 0;
    const mats = new Set<string>();
    let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const p of mesh.listPrimitives()) {
      tris += primitiveTriangles(p);
      primitives++;
      const mat = p.getMaterial();
      if (mat) {
        mats.add(mat.getName());
        const u = users.get(mat);
        if (u) u.add(node); else users.set(mat, new Set([node]));
      }
      const pos = p.getAttribute('POSITION');
      const lo = pos?.getMin([0, 0, 0]), hi = pos?.getMax([0, 0, 0]);
      if (lo && hi) {
        min = min.map((v, i) => Math.min(v, lo[i]));
        max = max.map((v, i) => Math.max(v, hi[i]));
      }
    }
    triangles += tris;
    const radius = Number.isFinite(min[0]) ? 0.5 * Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) * maxScale(node) : 0;
    const prot = protection(node.getName(), mesh.getName());
    if (prot) protectedNames.add(node.getName());
    nodes.push({
      name: node.getName(), mesh: mesh.getName(), triangles: tris, radius,
      animated: animated.has(node), ...(prot ? { protect: prot } : {}), materials: [...mats],
    });
  }

  // Textures : dimensions, emplacements et qui les affiche.
  const texByMat = textureIndex(doc);
  const texNodes = new Map<Texture, Set<string>>();
  for (const [mat, ns] of users) {
    for (const t of texByMat.get(mat) ?? []) {
      const s = texNodes.get(t) ?? new Set<string>();
      ns.forEach((n) => s.add(n.getName()));
      texNodes.set(t, s);
    }
  }
  const textures: TextureInfo[] = [];
  const seen = new Map<string, TextureInfo>();
  let textureGpu = 0, dupTex = 0, dupBytes = 0, dupGpu = 0;
  for (const t of root.listTextures()) {
    const img = t.getImage();
    const size = img ? ImageUtils.getSize(img, t.getMimeType()) : null;
    const info: TextureInfo = {
      name: t.getName() || t.getURI(), width: size?.[0] ?? 0, height: size?.[1] ?? 0, mime: t.getMimeType(),
      bytes: img?.byteLength ?? 0, slots: listTextureSlots(t), nodes: [...(texNodes.get(t) ?? [])],
    };
    textures.push(info);
    const gpu = textureGpuBytes(info.width, info.height);
    textureGpu += gpu;
    if (img) {
      const key = fingerprint(img);
      if (seen.has(key)) { dupTex++; dupBytes += info.bytes; dupGpu += gpu; } else seen.set(key, info);
    }
  }

  const materials = root.listMaterials().map(materialInfo);
  let dupMat = 0;
  const mats = root.listMaterials();
  for (let i = 0; i < mats.length; i++) {
    const skip = new Set(['name']);
    for (let j = 0; j < i; j++) if (mats[i].equals(mats[j], skip)) { dupMat++; break; }
  }

  // Géométrie en mémoire graphique, et attributs sans usage.
  const accessors = new Set<unknown>();
  let geometryGpu = 0, unused = 0, unusedBytes = 0;
  for (const mesh of root.listMeshes()) {
    for (const p of mesh.listPrimitives()) {
      const mat = p.getMaterial();
      const textured = !!mat && (texByMat.get(mat)?.length ?? 0) > 0;
      for (const sem of p.listSemantics()) {
        const a = p.getAttribute(sem)!;
        if (!accessors.has(a)) { accessors.add(a); geometryGpu += a.getByteLength(); }
        if (!textured && /^TEXCOORD_/.test(sem)) { unused++; unusedBytes += a.getByteLength(); }
      }
      const idx = p.getIndices();
      if (idx && !accessors.has(idx)) { accessors.add(idx); geometryGpu += idx.getByteLength(); }
    }
  }

  const reused = root.listMeshes().filter((m) => m.listParents().filter((p) => p.propertyType === 'Node').length > 1).length;
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  let span = 0;
  if (scene) {
    const b = getBounds(scene);
    span = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
    if (!Number.isFinite(span)) span = 0;
  }
  const ext = root.listExtensionsUsed().map((e) => e.extensionName);

  return {
    stats: {
      fileMB: fileBytes / MB,
      triangles, primitives,
      meshes: root.listMeshes().length,
      nodes: root.listNodes().length,
      materials: materials.length,
      textures: textures.length,
      textureGpuMB: textureGpu / MB,
      geometryGpuMB: geometryGpu / MB,
      doubleSided: materials.filter((m) => m.doubleSided).length,
      blend: materials.filter((m) => m.blend).length,
      transmission: materials.filter((m) => m.transmission > 0).length,
      physical: materials.filter((m) => m.physical.length > 0).length,
      animations: root.listAnimations().length,
      reusedMeshes: reused,
      extensions: ext,
      compression: ext.includes('KHR_draco_mesh_compression') ? 'draco' : ext.includes('EXT_meshopt_compression') ? 'meshopt' : 'none',
      duplicates: { textures: dupTex, materials: dupMat, textureBytes: dupBytes, textureGpuBytes: dupGpu },
      unusedAttributes: unused,
      unusedAttributeBytes: unusedBytes,
    },
    nodes, textures, materials, span,
    unitsPerMeter: unitsPerMeter(span),
    protectedNames: [...protectedNames].sort(),
  };
}

/** Les matières qui affichent une texture, directement ou par une extension (vernis, velours…). */
export function materialsOf(t: Texture): Material[] {
  const out = new Set<Material>();
  for (const p of t.listParents()) {
    if (p.propertyType === 'Material') out.add(p as Material);
    else for (const q of p.listParents()) if (q.propertyType === 'Material') out.add(q as Material);
  }
  return [...out];
}

/** Les textures de chaque matière, extensions comprises. */
export function textureIndex(doc: Document): Map<Material, Texture[]> {
  const index = new Map<Material, Texture[]>();
  for (const t of doc.getRoot().listTextures()) {
    for (const mat of materialsOf(t)) index.set(mat, [...(index.get(mat) ?? []), t]);
  }
  return index;
}
