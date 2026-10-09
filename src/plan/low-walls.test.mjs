import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { LowWalls, WALL_ATTR, tagWall, wallItemCode } from './low-walls.mjs';
import { addRect, addWall } from './graph.mjs';
import { buildPlan } from './build.mjs';

const emptyPlan = () => ({ version: 2, wallHeight: 2.5, wallThickness: 0.15, nodes: [], walls: [], rooms: [], openings: [], items: [] });

/** Un plan, son repère dans la scène (centré), et la vue des murs voulue. */
function setup(build = (p) => addRect(p, 0, 0, 6, 4), view = 'cutaway') {
  const plan = emptyPlan();
  build(plan);
  const xs = plan.nodes.map((n) => n.x), ys = plan.nodes.map((n) => n.y);
  const root = new THREE.Group();
  root.position.set(-(Math.min(...xs) + Math.max(...xs)) / 2, 0, -(Math.min(...ys) + Math.max(...ys)) / 2);
  root.updateMatrixWorld(true);
  const lw = new LowWalls();
  lw.setView(view, null);
  lw.setPlan(plan, root);
  return { plan, root, lw };
}
const wallAt = (plan, test) => plan.walls.findIndex((w) => {
  const a = plan.nodes.find((n) => n.id === w.a), b = plan.nodes.find((n) => n.id === w.b);
  return test(a, b);
});
const horiz = (plan, y, x0 = -1e9, x1 = 1e9) => wallAt(plan, (a, b) => a.y === y && b.y === y && Math.min(a.x, b.x) >= x0 - 1e-9 && Math.max(a.x, b.x) <= x1 + 1e-9);
const vert = (plan, x) => wallAt(plan, (a, b) => a.x === x && b.x === x);
const look = (lw, root, x, y, z) => {
  const cam = new THREE.PerspectiveCamera(); cam.position.set(x, y, z);
  for (let i = 0; i < 20; i++) lw.update(cam, new THREE.Vector3(0, 0, 0), root, 0.05);
};

test('vue coupée, vu du sud : la façade sud est coupée, le mur du fond et les côtés restent', () => {
  const { plan, root, lw } = setup();
  look(lw, root, -1, 6, 10);
  assert.equal(lw.factor[horiz(plan, 4)], 1, 'façade sud');
  assert.equal(lw.factor[horiz(plan, 0)], 0, 'mur du fond');
  assert.equal(lw.factor[vert(plan, 0)], 0, 'côté ouest');
  assert.equal(lw.factor[vert(plan, 6)], 0, 'côté est');
});

test('vue coupée : la cloison qui cache une pièce est coupée aussi', () => {
  const { plan, root, lw } = setup((p) => { addRect(p, 0, 0, 6, 4); addRect(p, 0, 4, 6, 8); });
  look(lw, root, 0, 7, 12);
  assert.equal(lw.factor[horiz(plan, 8)], 1, 'façade');
  assert.equal(lw.factor[horiz(plan, 4)], 1, 'cloison du milieu');
  assert.equal(lw.factor[horiz(plan, 0)], 0, 'mur du fond');
});

test('vu d’en haut, rien n’est coupé ; vue debout, rien ; vue murs bas, tout', () => {
  const { root, lw } = setup();
  look(lw, root, 0.1, 15, 0.1);
  assert.ok(Array.from(lw.factor.slice(0, 4)).every((f) => f === 0));
  lw.setView('down', null);
  look(lw, root, 0.1, 15, 0.1);
  assert.ok(Array.from(lw.factor.slice(0, 4)).every((f) => f === 1));
  lw.setView('up', null);
  look(lw, root, 0, 6, 10);
  assert.ok(Array.from(lw.factor.slice(0, 4)).every((f) => f === 0));
});

test('jonction : l’angle d’un mur coupé reste entier quand son voisin reste debout', () => {
  const { plan, root, lw } = setup();
  look(lw, root, -1, 6, 10);
  const south = horiz(plan, 4), north = horiz(plan, 0);
  // Les deux bouts du mur sud touchent les côtés, debout : angles gardés.
  assert.equal(lw.data[south * 4 + 1], 255);
  assert.equal(lw.data[south * 4 + 2], 255);
  // En vue murs bas, plus aucun voisin debout : les angles descendent aussi.
  lw.setView('down', null);
  look(lw, root, -1, 6, 10);
  assert.equal(lw.data[south * 4 + 1], 0);
  assert.equal(lw.data[north * 4 + 2], 0);
});

test('construction : chaque bout d’angle est un morceau à part, marqué', () => {
  const plan = emptyPlan();
  addRect(plan, 0, 0, 6, 4);
  const root = buildPlan(plan);
  const corners = new Set();
  root.traverse((o) => {
    const a = o.geometry?.getAttribute(WALL_ATTR);
    if (!a) return;
    const v = a.getX(0);
    if (v > 0) corners.add(Math.round((v - Math.floor(v + 0.01)) * 4));
  });
  assert.deepEqual([...corners].sort(), [0, 1, 2], 'des morceaux ordinaires, des angles de départ et d’arrivée');
});

test('petits murs : un raccord entre deux segments coupés est coupé avec eux', () => {
  // Façade sud en trois morceaux alignés, dont un de 30 cm au milieu (raccord).
  const { plan, root, lw } = setup((p) => {
    addRect(p, 0, 0, 6, 4);
    addWall(p, { x: 2.85, y: 4 }, { x: 2.85, y: 3.4 });
    addWall(p, { x: 3.15, y: 4 }, { x: 3.15, y: 3.4 });
  });
  look(lw, root, -1, 6, 10);
  const mid = horiz(plan, 4, 2.85, 3.15);
  assert.ok(mid >= 0, 'le raccord existe');
  assert.equal(lw.factor[mid], 1);
});

test('petits murs : un retour accroché à la façade coupée descend (pas de poteau) ; accroché au mur du fond, il reste', () => {
  const { plan, root, lw } = setup((p) => {
    addRect(p, 0, 0, 6, 4);
    // Retour de 40 cm vers l'intérieur, depuis la façade sud (coupée).
    addWall(p, { x: 2, y: 4 }, { x: 2, y: 3.6 });
    // Retour de 40 cm vers l'intérieur, depuis le mur du fond (debout).
    addWall(p, { x: 4, y: 0 }, { x: 4, y: 0.4 });
  });
  look(lw, root, -1, 6, 10);
  const front = wallAt(plan, (a, b) => a.x === 2 && b.x === 2);
  const back = wallAt(plan, (a, b) => a.x === 4 && b.x === 4);
  assert.equal(lw.factor[front], 1, 'le retour de la façade descend avec elle');
  assert.equal(lw.factor[back], 0, 'le retour du mur du fond reste debout');
});

test('une étagère accrochée et l’objet posé dessus disparaissent avec leur mur ; l’armoire au sol reste', () => {
  const { plan, root, lw } = setup();
  const back = 4 - 0.075;
  plan.items = [
    { id: 'shelf', model: 'x', x: 3, y: back - 0.15, rotation: 180, size: [1, 0.3, 0.05], elevation: 1.6 },
    { id: 'vase', model: 'y', x: 3, y: back - 0.15, rotation: 0, size: [0.15, 0.15, 0.3] },
    { id: 'wardrobe', model: 'z', x: 1.2, y: back - 0.3, rotation: 180, size: [1.2, 0.6, 2] },
    { id: 'chest', model: 'c', x: 4.5, y: back - 0.25, rotation: 180, size: [1, 0.5, 0.8] },
    { id: 'lamp', model: 'l', x: 4.5, y: back - 0.25, rotation: 180, size: [0.3, 0.3, 0.5], elevation: 0.8 },
    // Des rideaux posés au sol contre la façade : fins et hauts, ils partent avec elle.
    { id: 'curtain', model: 'k', x: 5.4, y: back - 0.1, rotation: 180, size: [0.6, 0.2, 2.4], elevation: 0 },
  ];
  for (const it of plan.items) { const g = new THREE.Group(); g.name = `plan_item_${it.id}`; root.add(g); }
  lw.attachItems(plan, root);
  assert.deepEqual(lw.attached.map((a) => a.holder.name).sort(), ['plan_item_curtain', 'plan_item_shelf', 'plan_item_vase']);
  look(lw, root, -1, 6, 10);
  assert.equal(root.getObjectByName('plan_item_shelf').visible, false);
  assert.equal(root.getObjectByName('plan_item_wardrobe').visible, true);
  assert.equal(root.getObjectByName('plan_item_lamp').visible, true);
});

test('vue fantôme : un voile sur les murs seulement, affiché dans cette vue', () => {
  const { root, lw } = setup(undefined, 'cutaway');
  const wall = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  tagWall(wall.geometry, 0);
  const sofa = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  sofa.geometry.setAttribute(WALL_ATTR, new THREE.BufferAttribute(new Float32Array(sofa.geometry.getAttribute('position').count).fill(wallItemCode(0)), 1));
  root.add(wall, sofa);
  lw.instrument(root);
  const ghostOf = (m) => m.children.find((c) => c.name === 'owlnest_wall_ghost');
  assert.ok(ghostOf(wall), 'le mur a son voile');
  assert.equal(ghostOf(sofa), undefined, 'un meuble n’en a pas');
  assert.equal(ghostOf(wall).visible, false);
  lw.setView('ghost', root);
  assert.equal(lw.ghost, true);
  assert.equal(ghostOf(wall).visible, true);
  lw.instrument(root);
  assert.equal(wall.children.length, 1, 'pas de second voile');
});
