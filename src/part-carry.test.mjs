import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { carries, findCarried, carryName, CARRY_MARGIN } from './part-carry.mjs';

/** Boîte depuis un centre et une taille, en centimètres. */
function box(cx, cy, cz, sx, sy, sz) {
  return new THREE.Box3(
    new THREE.Vector3(cx - sx / 2, cy - sy / 2, cz - sz / 2),
    new THREE.Vector3(cx + sx / 2, cy + sy / 2, cz + sz / 2),
  );
}

// Un vantail de porte : 90 de large, 200 de haut, 4 d'épaisseur.
const vantail = box(0, 100, 0, 90, 200, 4);

test('une poignée posée dans le vantail est emmenée', () => {
  // 12 cm de long, à 8 cm du bord, débordant de 2 cm de chaque côté.
  assert.equal(carries(vantail, box(37, 105, 0, 12, 3, 8)), true);
});

test('un dormant qui déborde reste en place', () => {
  // Le montant est plus haut que le vantail : il tient le cadre.
  assert.equal(carries(vantail, box(47, 100, 0, 5, 210, 10)), false);
});

test('le vantail voisin n\'est pas emmené', () => {
  // Même taille que l'ouvrant : ce n'est pas un accessoire.
  assert.equal(carries(vantail, box(90, 100, 0, 90, 200, 4)), false);
});

test('une pièce juste à côté, hors du volume, reste en place', () => {
  // Une poignée de la porte voisine, à 10 cm au-delà du bord.
  assert.equal(carries(vantail, box(60, 105, 0, 12, 3, 8)), false);
});

test('la marge est proportionnelle, pas absolue', () => {
  // Le même ensemble à une autre échelle doit donner le même verdict : un
  // modèle en pouces ou en millimètres ne doit pas changer le résultat.
  const k = 25.4;
  const grand = box(0, 100 * k, 0, 90 * k, 200 * k, 4 * k);
  assert.equal(carries(grand, box(37 * k, 105 * k, 0, 12 * k, 3 * k, 8 * k)), true);
  assert.equal(carries(grand, box(47 * k, 100 * k, 0, 5 * k, 210 * k, 10 * k)), false);
});

test('la marge accepte un dépassement en épaisseur mais pas en longueur', () => {
  const marge = 200 * CARRY_MARGIN;   // la plus grande dimension du vantail
  // Dépassement en épaisseur, dans la marge : emmenée.
  assert.equal(carries(vantail, box(37, 105, 0, 12, 3, 4 + marge * 1.5)), true);
  // Dépassement franc au-delà de la marge : laissée.
  assert.equal(carries(vantail, box(37, 105, 0, 12, 3, 4 + marge * 4)), false);
});

test('une boîte vide ne decide rien', () => {
  assert.equal(carries(new THREE.Box3(), box(0, 0, 0, 1, 1, 1)), false);
  assert.equal(carries(vantail, new THREE.Box3()), false);
});

// ── Parcours du modèle ──────────────────────────────────────────────────────

function mesh(name, cx, cy, cz, sx, sy, sz) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
  m.name = name;
  m.position.set(cx, cy, cz);
  return m;
}

/** Reproduit un export plat : des mailles sœurs, sans regroupement. */
function plan() {
  const root = new THREE.Group();
  root.add(mesh('vantail', 0, 100, 0, 90, 200, 4));
  root.add(mesh('poignee', 37, 105, 0, 12, 3, 8));
  root.add(mesh('montant', 47, 100, 0, 5, 210, 10));
  root.add(mesh('porte_voisine', 200, 100, 0, 90, 200, 4));
  return root;
}

test('le parcours retient la poignée et laisse le reste', () => {
  const root = plan();
  const host = root.children[0];
  const found = findCarried(root, new THREE.Box3().setFromObject(host), host);
  assert.deepEqual(found.map((f) => f.mesh.name), ['poignee']);
});

test('l\'hôte ne s\'emmène pas lui-même', () => {
  // Sans cette garde le vantail tournerait deux fois.
  const root = plan();
  const host = root.children[0];
  const found = findCarried(root, new THREE.Box3().setFromObject(host), host);
  assert.ok(!found.some((f) => f.mesh === host));
});

test('la descendance de l\'hôte est ignorée', () => {
  // La pièce extraite vit sous l'hôte : la reprendre la ferait tourner deux fois.
  const root = plan();
  const host = root.children[0];
  const extrait = mesh('vantail#0', 0, 5, 0, 80, 10, 4);
  host.add(extrait);
  const found = findCarried(root, new THREE.Box3().setFromObject(host), host);
  assert.ok(!found.some((f) => f.mesh === extrait));
});

test('une pièce décochée n\'est plus emmenée', () => {
  const root = plan();
  const host = root.children[0];
  const found = findCarried(root, new THREE.Box3().setFromObject(host), host, ['poignee#0']);
  assert.deepEqual(found.map((f) => f.mesh.name), []);
});
