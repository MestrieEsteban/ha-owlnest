import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { resolveCoplanar, separateCoplanarSlabs } from './coplanar.mjs';

/** Dalle horizontale : emprise `w × d`, épaisseur `t`, assise à `y`. */
function slab(id, x0, z0, w, d, y = 0, t = 0) {
  return {
    id,
    box: new THREE.Box3(
      new THREE.Vector3(x0, y, z0),
      new THREE.Vector3(x0 + w, y + t, z0 + d),
    ),
  };
}

const SPAN = 618;   // envergure d'un appartement réel, en centimètres

// ── Le cas mesuré sur un export Sweet Home 3D ───────────────────────────────

test('le sol de la pièce est décollé du terrain qui le recouvre', () => {
  // Relevé réel : ground_1 fait 601 × 618, room_11_66 fait 585 × 597, tous deux
  // exactement à y = 0.
  const terrain = slab(0, 0, 0, 601, 618);
  const sol = slab(1, 8, 10, 585, 597);
  const lifts = resolveCoplanar([terrain, sol], { span: SPAN });

  assert.equal(lifts.length, 1, 'une seule dalle doit bouger');
  assert.equal(lifts[0].id, 1, 'la plus petite monte, le terrain reste la référence');
  assert.ok(lifts[0].lift > 0);
});

test('le décalage est imperceptible mais dépasse la précision du tampon', () => {
  const lifts = resolveCoplanar(
    [slab(0, 0, 0, 601, 618), slab(1, 8, 10, 585, 597)],
    { span: SPAN },
  );
  const lift = lifts[0].lift;
  // Borne basse : la profondeur d'un tampon 24 bits ne discrimine qu'au
  // millimètre à l'autre bout d'un appartement. En dessous, le scintillement
  // resterait — c'est l'erreur que corrige ce seuil.
  assert.ok(lift > SPAN * 1e-3, `trop petit pour le tampon : ${lift}`);
  // Borne haute : un sol qui remonte d'un centimètre sur six mètres ne se voit
  // pas ; un décimètre se verrait.
  assert.ok(lift < SPAN * 0.01, `visible à l'œil : ${lift}`);
});

test('après séparation, plus aucun conflit ne subsiste', () => {
  // Garde-fou contre une régression réelle : quand le pas de séparation valait
  // la tolérance de regroupement, les dalles écartées étaient encore vues comme
  // confondues, et la correction ne corrigeait rien.
  const slabs = [
    slab(0, 0, 0, 601, 618),
    slab(1, 8, 10, 585, 597),
    slab(2, 100, 120, 158, 250, 0, 1.6),
  ];
  const lifts = resolveCoplanar(slabs, { span: SPAN });
  const byId = Object.fromEntries(lifts.map((l) => [l.id, l.lift]));

  const after = slabs.map((s) => {
    const box = s.box.clone();
    box.translate(new THREE.Vector3(0, byId[s.id] ?? 0, 0));
    return { id: s.id, box };
  });
  assert.deepEqual(resolveCoplanar(after, { span: SPAN }), [],
    'un second passage ne doit plus rien trouver');
});

test('trois dalles empilées sont séparées dans l’ordre des surfaces', () => {
  // Terrain, sol de pièce, tapis — le cas complet du modèle réel.
  const lifts = resolveCoplanar([
    slab(0, 0, 0, 601, 618),      // terrain
    slab(1, 8, 10, 585, 597),     // sol
    slab(2, 100, 120, 158, 250, 0, 1.6), // tapis
  ], { span: SPAN });

  assert.equal(lifts.length, 2);
  const byId = Object.fromEntries(lifts.map((l) => [l.id, l.lift]));
  assert.ok(byId[1] > 0 && byId[2] > byId[1],
    'le tapis passe au-dessus du sol, qui passe au-dessus du terrain');
});

// ── Ce qu'il ne faut surtout pas déplacer ───────────────────────────────────

test('deux dalles côte à côte ne sont pas déplacées', () => {
  // Deux pièces voisines au même niveau : aucun conflit, aucun décalage.
  const lifts = resolveCoplanar([
    slab(0, 0, 0, 200, 200),
    slab(1, 260, 0, 200, 200),
  ], { span: SPAN });
  assert.deepEqual(lifts, []);
});

test('deux étages distincts restent intacts', () => {
  const lifts = resolveCoplanar([
    slab(0, 0, 0, 601, 618, 0),
    slab(1, 0, 0, 601, 618, 250),
  ], { span: SPAN });
  assert.deepEqual(lifts, [], 'un plancher d’étage n’est pas coplanaire au sol');
});

test('un mur n’est jamais considéré comme une dalle', () => {
  // Mur : 600 de long, 16 d'épaisseur, 250 de haut — trop épais pour la règle.
  const mur = {
    id: 0,
    box: new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(600, 250, 16)),
  };
  const sol = slab(1, 0, 0, 600, 600);
  assert.deepEqual(resolveCoplanar([mur, sol], { span: SPAN }), []);
});

test('une dalle isolée ne bouge pas', () => {
  assert.deepEqual(resolveCoplanar([slab(0, 0, 0, 601, 618)], { span: SPAN }), []);
});

test('les petits objets posés au sol sont ignorés', () => {
  // Un pied de chaise à y = 0 ne doit pas déclencher de décalage.
  const lifts = resolveCoplanar([
    slab(0, 0, 0, 601, 618),
    slab(1, 100, 100, 4, 4),
  ], { span: SPAN });
  assert.deepEqual(lifts, []);
});

// ── Indépendance à l'échelle et à l'orientation ─────────────────────────────

test('le décalage suit l’échelle du modèle', () => {
  const cm = resolveCoplanar([slab(0, 0, 0, 601, 618), slab(1, 8, 10, 585, 597)], { span: 618 });
  const m = resolveCoplanar([slab(0, 0, 0, 6.01, 6.18), slab(1, .08, .1, 5.85, 5.97)], { span: 6.18 });
  assert.ok(cm[0].lift > m[0].lift * 50,
    'un modèle en centimètres demande un écart cent fois plus grand qu’en mètres');
});

test('un modèle Z-up est traité comme un modèle Y-up', () => {
  const box = (x0, y0, w, d) => new THREE.Box3(
    new THREE.Vector3(x0, y0, 0), new THREE.Vector3(x0 + w, y0 + d, 0),
  );
  const lifts = resolveCoplanar(
    [{ id: 0, box: box(0, 0, 601, 618) }, { id: 1, box: box(8, 10, 585, 597) }],
    { span: SPAN, vertical: 2 },
  );
  assert.equal(lifts.length, 1);
  assert.equal(lifts[0].id, 1);
});

// ── Application à une scène ─────────────────────────────────────────────────

function meshOf(x0, z0, w, d, y = 0, t = 0, name = '') {
  const g = new THREE.BoxGeometry(w, Math.max(t, 1e-6), d);
  g.translate(x0 + w / 2, y + t / 2, z0 + d / 2);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
  m.name = name;
  return m;
}

test('separateCoplanarSlabs déplace l’objet, pas sa géométrie', () => {
  const root = new THREE.Group();
  const terrain = meshOf(0, 0, 601, 618, 0, 0, 'ground_1');
  const sol = meshOf(8, 10, 585, 597, 0, 0, 'room_11_66');
  root.add(terrain, sol);

  const before = sol.geometry.attributes.position.array.slice();
  const moved = separateCoplanarSlabs(root, SPAN);

  assert.equal(moved, 1);
  assert.ok(sol.position.y > 0, 'le sol de la pièce est remonté');
  assert.equal(terrain.position.y, 0, 'le terrain reste la référence');
  assert.deepEqual(sol.geometry.attributes.position.array, before,
    'aucun sommet n’est réécrit');
});

test('separateCoplanarSlabs est idempotent', () => {
  const root = new THREE.Group();
  root.add(meshOf(0, 0, 601, 618), meshOf(8, 10, 585, 597));
  const first = separateCoplanarSlabs(root, SPAN);
  const second = separateCoplanarSlabs(root, SPAN);
  assert.equal(first, 1);
  assert.equal(second, 0, 'un second passage ne doit rien déplacer de plus');
});
