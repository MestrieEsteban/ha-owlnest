import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { protectFromScene, protectionMatcher, sanitizeName, compilePatterns } from './protected.mjs';
import {
  CATALOG, byId, presetSelection, selectionFromRendering, renderingFromSelection, modelOps, hasDestructive,
  sumGains, fitWithin, textureGpuBytes,
} from './catalog.mjs';
import { frameStats, orbitAngle, benchDelta, BENCH_DURATION_MS } from './bench.mjs';
import { modelBaseName, optimizedSlug, originalSlug, isOptimizedUrl } from './backups.mjs';
import { RenderTweaks, tweaksKey, estimateGpuBytes } from './render-apply.mjs';
import { StaticBatch } from '../batching.mjs';

// ── Protection ─────────────────────────────────────────────────────────────

test('la scène protège ses hôtes de lampe, pièces et effets ; un triangle protège la géométrie', () => {
  const spec = protectFromScene({
    anchors: [{ entity: 'light.a', position: [0, 0, 0], lightMesh: 'Lampe salon', lightTriangle: 12 }],
    parts: [{ id: 'p', entity: 'cover.x', motion: 'swing', node: 'Puerta.001' }],
    effects: [{ id: 'e', entity: 'switch.y', kind: 'tint', targets: [{ mesh: 'TV' }] }],
  });
  const match = protectionMatcher(spec);
  assert.equal(match('Lampe salon'), 'geometry');
  assert.equal(match('Puerta.001'), 'name');
  assert.equal(match('TV'), 'name');
  assert.equal(match('ha_anchor_kitchen'), 'name');
  assert.equal(match('Sofa'), null);
});

test('un nom rendu unique par three (`_2`) protège le nœud glTF d’origine', () => {
  const match = protectionMatcher({ names: ['Silla_2'], geometry: [], patterns: [] });
  assert.equal(match('Silla'), 'name');
  assert.equal(sanitizeName('Puerta.001 [a]'), 'Puerta001_a');
});

test('un motif invalide est ignoré sans casser les autres', () => {
  assert.equal(compilePatterns('libro, ([, book').length, 2);
});

// ── Catalogue ──────────────────────────────────────────────────────────────

const report = {
  stats: {
    fileMB: 36, triangles: 3_600_000, primitives: 1500, meshes: 1200, nodes: 1300, materials: 200, textures: 3,
    textureGpuMB: 20, geometryGpuMB: 130, doubleSided: 190, blend: 3, transmission: 3, physical: 60,
    animations: 6, reusedMeshes: 4, extensions: [], compression: 'draco',
  },
  nodes: [
    { name: 'mujer durmiendo', mesh: 'm1', triangles: 600_000, radius: 1, animated: false, materials: ['skin'] },
    { name: 'Lampe', mesh: 'm2', triangles: 50_000, radius: 0.2, animated: false, protect: 'geometry', materials: ['metal'] },
    { name: 'chica', mesh: 'm3', triangles: 400_000, radius: 1, animated: false, protect: 'geometry', materials: ['skin'] },
    { name: 'Wall_1', mesh: 'w', triangles: 20_000, radius: 5, animated: false, materials: ['paint'] },
  ],
  textures: [
    { name: 'portada', width: 2048, height: 2048, mime: 'image/png', bytes: 4_000_000, slots: ['baseColorTexture'], nodes: ['libro'] },
    { name: 'normal', width: 1024, height: 1024, mime: 'image/png', bytes: 1_000_000, slots: ['normalTexture'], nodes: ['Wall_1'] },
  ],
  materials: [], span: 1500, unitsPerMeter: 100, protectedNames: ['Lampe', 'chica'],
};
const ctx = { dpr: 2, maxPixelRatio: 1.5, maxFps: 45 };

test('simplifier les personnages épargne ceux dont la scène désigne un triangle', () => {
  const g = byId('C1').estimate(report, { pattern: 'mujer|chica', target: 30000 }, ctx);
  assert.equal(g.affected, 1);
  assert.equal(g.skipped, 1);
  assert.equal(g.triangles, 570_000);
});

test('les murs ne sont jamais simplifiés', () => {
  const g = byId('C2').estimate(report, { above: 5000, ratio: 0.5, exclude: 'mujer|chica' }, ctx);
  assert.equal(g.affected, 0, 'Lampe protégée, Wall_1 structurel');
});

test('réduire les cartes de détail ne touche pas aux couleurs', () => {
  const g = byId('C4').estimate(report, { max: 256 }, ctx);
  assert.equal(g.affected, 1);
  assert.ok(Math.abs(g.gpuMB - (textureGpuBytes(1024, 1024) - textureGpuBytes(256, 256)) / 1048576) < 1e-9);
});

test('Draco → meshopt : le fichier grossit (gain négatif), la mémoire baisse', () => {
  const g = byId('B3').estimate(report, {}, ctx);
  assert.ok(g.fileMB < 0);
  assert.ok(g.gpuMB > 0);
});

test('une proportion est gardée en réduisant une image', () => {
  assert.deepEqual(fitWithin(2048, 1024, 512), [512, 256]);
  assert.deepEqual(fitWithin(100, 50, 512), [100, 50]);
});

test('préréglages : le sûr ne contient rien de destructif, l’agressif si', () => {
  assert.equal(hasDestructive(presetSelection('safe')), false);
  assert.equal(hasDestructive(presetSelection('aggressive')), true);
  assert.equal(presetSelection('aggressive').C5.enabled, false, 'C5 demande un outil externe');
  assert.deepEqual(modelOps(presetSelection('safe')).map((o) => o.id), ['B1', 'B3', 'B4']);
});

test('le rendu fait l’aller-retour scène ↔ sélection, décochés effacés', () => {
  const sel = presetSelection('balanced');
  const r = renderingFromSelection(sel);
  assert.equal(r.physical_materials, false);
  assert.equal(r.shadow_policy, 'selective');
  assert.equal(r.max_pixel_ratio, 1.25);
  assert.ok('max_texture_size' in r && r.max_texture_size === undefined, 'A8 décoché : champ effacé');
  const back = selectionFromRendering(r);
  for (const d of CATALOG.filter((x) => x.category === 'render')) assert.equal(back[d.id].enabled, sel[d.id].enabled, d.id);
});

test('les gains d’image se composent, les autres s’additionnent', () => {
  const s = sumGains([{ triangles: 10, fpsHint: 0.5 }, { triangles: 5, fpsHint: 0.5 }]);
  assert.equal(s.triangles, 15);
  assert.equal(s.fpsHint, 0.75);
});

// ── Banc d'essai ───────────────────────────────────────────────────────────

test('statistiques d’images : moyenne et 95e centile', () => {
  const frames = [...Array(95).fill(10), ...Array(5).fill(50)];
  const s = frameStats(frames);
  assert.ok(Math.abs(s.avgFps - 1000 / 12) < 1e-9);
  assert.equal(s.p95FrameMs, 10);
  assert.equal(s.worstFrameMs, 50);
  assert.deepEqual(frameStats([]), { avgFps: 0, p95FrameMs: 0, worstFrameMs: 0 });
});

test('un tour complet, ni plus ni moins', () => {
  assert.equal(orbitAngle(0), 0);
  assert.equal(orbitAngle(BENCH_DURATION_MS), Math.PI * 2);
  assert.equal(orbitAngle(BENCH_DURATION_MS * 2), Math.PI * 2);
});

test('écart avant / après', () => {
  const base = { avgFps: 20, p95FrameMs: 80, gpuMB: 300, calls: 400, triangles: 3e6 };
  const d = benchDelta(base, { ...base, avgFps: 30, p95FrameMs: 40, gpuMB: 200 });
  assert.equal(d.fps, 0.5);
  assert.equal(d.p95, -0.5);
  assert.equal(d.gpuMB, -100);
});

// ── Fichiers ───────────────────────────────────────────────────────────────

test('les noms de version gardent le nom lisible du modèle', () => {
  const now = new Date('2026-11-15T10:20:30Z');
  assert.equal(modelBaseName('/owlnest_models/casa-v3-20261101120000-orig-20261115102030.glb'), 'casa-v3');
  assert.equal(optimizedSlug('/owlnest_models/casa-v3-20261101120000.glb', now), 'casa-v3-opt-20261115102030');
  assert.equal(originalSlug('Casa V3', now), 'casa-v3-orig-20261115102030');
  assert.equal(modelBaseName('/local/models/Mi Casa.glb?v=2'), 'Mi Casa');
  assert.ok(isOptimizedUrl('/owlnest_models/casa-v3-opt-20261115102030.glb'));
  assert.ok(!isOptimizedUrl('/local/casa-v3-opt-20261115102030.glb'));
});

// ── Rendu (catégorie A) ────────────────────────────────────────────────────

function house() {
  const root = new THREE.Group();
  const glass = new THREE.MeshPhysicalMaterial({ transmission: 1, opacity: 1 });
  const lacquer = new THREE.MeshPhysicalMaterial({ clearcoat: 1, sheen: 0.5 });
  const wall = new THREE.Mesh(new THREE.BoxGeometry(10, 3, 0.2), new THREE.MeshStandardMaterial());
  wall.name = 'Wall';
  const window_ = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), glass);
  window_.name = 'Ventana';
  const cup = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), lacquer);
  cup.name = 'Taza';
  const plant = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshStandardMaterial());
  plant.name = 'Planta';
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshStandardMaterial());
  lamp.name = 'Planta_lampara';
  for (const m of [wall, window_, cup, plant, lamp]) { m.castShadow = true; root.add(m); }
  root.updateMatrixWorld(true);
  return { root, glass, lacquer, wall, window_, cup, plant, lamp };
}

test('les réglages de rendu se posent et se défont exactement', () => {
  const h = house();
  const tw = new RenderTweaks(h.root);
  const n = tw.apply({
    physical_materials: false, transmission: false, shadow_policy: 'selective', shadow_min_size: 0.05,
    hidden_patterns: ['^planta'],
  }, { span: 10, maxAnisotropy: 16, isProtected: (o) => o.name === 'Planta_lampara' });
  assert.ok(n > 0);
  assert.equal(h.glass.transmission, 0);
  assert.ok(h.glass.transparent && h.glass.opacity < 0.5);
  assert.equal(h.lacquer.clearcoat, 0);
  assert.equal(h.cup.castShadow, false, 'petit objet : plus d’ombre');
  assert.ok(tw.noShadow.has(h.cup));
  assert.equal(h.wall.castShadow, true);
  assert.equal(h.plant.visible, false);
  assert.equal(h.lamp.visible, true, 'objet désigné par la scène : jamais caché');

  tw.restore();
  assert.equal(h.glass.transmission, 1);
  assert.equal(h.glass.opacity, 1);
  assert.equal(h.glass.transparent, false);
  assert.equal(h.lacquer.clearcoat, 1);
  assert.equal(h.lacquer.sheen, 0.5);
  assert.equal(h.cup.castShadow, true);
  assert.equal(h.plant.visible, true);
  assert.equal(tw.noShadow.size, 0);
});

test('la clé ne change qu’avec les réglages qui touchent les objets', () => {
  assert.equal(tweaksKey({ exposure: 1 }), tweaksKey({ exposure: 2 }));
  assert.notEqual(tweaksKey({}), tweaksKey({ hidden_patterns: ['x'] }));
});

test('mémoire GPU : une géométrie partagée ne compte qu’une fois', () => {
  const root = new THREE.Group();
  const g = new THREE.BoxGeometry(1, 1, 1);
  const m = new THREE.MeshStandardMaterial();
  root.add(new THREE.Mesh(g, m), new THREE.Mesh(g, m));
  const one = estimateGpuBytes(new THREE.Mesh(g, m));
  assert.equal(estimateGpuBytes(root).geometry, one.geometry);
});

// ── Fusion des modèles quantifiés ──────────────────────────────────────────

test('une géométrie quantifiée (int16 normalisé) fusionnée garde sa taille', () => {
  const root = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial();
  const quantized = () => {
    const g = new THREE.BufferGeometry();
    // Un triangle dans [-1, 1], agrandi ×100 par l'échelle du nœud (KHR_mesh_quantization).
    g.setAttribute('position', new THREE.BufferAttribute(new Int16Array([0, 0, 0, 32767, 0, 0, 0, 32767, 0]), 3, true));
    g.setAttribute('normal', new THREE.BufferAttribute(new Int8Array([0, 0, 127, 0, 0, 127, 0, 0, 127]), 3, true));
    const m = new THREE.Mesh(g, mat);
    m.scale.setScalar(100);
    return m;
  };
  const a = quantized(), b = quantized();
  b.position.x = 500;
  root.add(a, b);
  const batch = new StaticBatch(root);
  assert.equal(batch.merge(), 2);
  const merged = root.children.find((c) => c.userData.owlnestBatch);
  merged.geometry.computeBoundingBox();
  const size = merged.geometry.boundingBox.getSize(new THREE.Vector3());
  assert.ok(Math.abs(size.x - 600) < 0.1, `largeur ${size.x}`);
  assert.ok(Math.abs(size.y - 100) < 0.1);
});

test('regroupement par zone : une fusion par cellule', () => {
  const root = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial();
  for (const x of [0, 1, 50, 51]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
    m.position.x = x;
    root.add(m);
  }
  const batch = new StaticBatch(root);
  batch.cell = 10;
  assert.equal(batch.merge(), 4);
  assert.equal(root.children.filter((c) => c.userData.owlnestBatch).length, 2);
});

test('un maillage instancié n’entre pas dans une fusion', () => {
  const root = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial();
  const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, 3);
  root.add(inst, new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat));
  assert.equal(new StaticBatch(root).merge(), 0);
  assert.equal(inst.visible, true);
});
