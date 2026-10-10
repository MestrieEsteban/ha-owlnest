import test from 'node:test';
import assert from 'node:assert/strict';
import { floorViews, floorDoc, withFloorDoc, addFloor, removeFloor, renameFloor, floorOfHeight, allOpenings, hasWalls, SLAB } from './floors.mjs';
import { addRect } from './graph.mjs';

const emptyPlan = () => ({ version: 2, wallHeight: 2.5, wallThickness: 0.15, nodes: [], walls: [], rooms: [], openings: [], items: [] });

function house() {
  const plan = emptyPlan();
  addRect(plan, 0, 0, 6, 4);
  plan.rooms.push({ id: 'r0', name: 'Salon', seed: { x: 3, y: 2 } });
  plan.openings.push({ id: 'o0', wall: plan.walls[0].id, kind: 'door', offset: 1, width: 0.9, height: 2.1, sill: 0 });
  return plan;
}

test('un plan d’avant les étages : un seul niveau, le rez-de-chaussée', () => {
  const v = floorViews(house(), 'RDC');
  assert.equal(v.length, 1);
  assert.equal(v[0].name, 'RDC');
  assert.equal(v[0].elevation, 0);
});

test('ajouter un étage : au-dessus du dernier, murs et pièces repris, sans portes ni meubles', () => {
  const plan = house();
  const { plan: two, index } = addFloor(plan, 'Étage');
  assert.equal(index, 1);
  const up = floorDoc(two, 1);
  assert.equal(floorViews(two)[1].elevation, 2.5 + SLAB);
  assert.equal(up.walls.length, plan.walls.length);
  assert.equal(up.rooms[0].name, 'Salon');
  assert.equal(up.openings.length, 0);
  // De nouveaux identifiants, mais les murs relient bien les nouveaux coins.
  assert.ok(up.walls.every((w) => !plan.walls.some((q) => q.id === w.id)));
  const ids = new Set(up.nodes.map((n) => n.id));
  assert.ok(up.walls.every((w) => ids.has(w.a) && ids.has(w.b)));
  // Un deuxième étage se pose sur le premier.
  const three = addFloor(two, 'Combles').plan;
  assert.equal(floorViews(three)[2].elevation, Math.round((2 * (2.5 + SLAB)) * 100) / 100);
});

test('modifier un niveau ne touche pas aux autres', () => {
  const { plan: two } = addFloor(house(), 'Étage');
  const up = { ...floorDoc(two, 1), wallHeight: 3 };
  const after = withFloorDoc(two, 1, up);
  assert.equal(floorDoc(after, 1).wallHeight, 3);
  assert.equal(after.wallHeight, 2.5);
  // Le rez-de-chaussée remplacé garde ses étages, même si l'éditeur en avait une copie périmée.
  const ground = { ...floorDoc(after, 0), floors: [], wallHeight: 2.6 };
  const back = withFloorDoc(after, 0, ground);
  assert.equal(back.floors.length, 1);
  assert.equal(back.wallHeight, 2.6);
  assert.equal(floorDoc(back, 1).floors, undefined);
});

test('renommer, retirer', () => {
  let p = addFloor(house(), 'Étage').plan;
  p = renameFloor(p, 1, 'Premier');
  p = renameFloor(p, 0, 'Bas');
  assert.deepEqual(floorViews(p).map((v) => v.name), ['Bas', 'Premier']);
  p = removeFloor(p, 1);
  assert.equal(floorViews(p).length, 1);
  assert.equal(p.floors, undefined);
  assert.equal(removeFloor(p, 0), p, 'le rez-de-chaussée ne se retire pas');
});

test('le niveau d’une hauteur', () => {
  const p = addFloor(addFloor(house(), 'Étage').plan, 'Combles').plan;
  assert.equal(floorOfHeight(p, 0), 0);
  assert.equal(floorOfHeight(p, 1.4), 0);
  assert.equal(floorOfHeight(p, 2.65), 1);
  assert.equal(floorOfHeight(p, 4), 1);
  assert.equal(floorOfHeight(p, 5.5), 2);
});

test('toutes les ouvertures, d’un étage à l’autre', () => {
  let p = addFloor(house(), 'Étage').plan;
  const up = floorDoc(p, 1);
  p = withFloorDoc(p, 1, { ...up, openings: [{ id: 'o1', wall: up.walls[0].id, kind: 'window', offset: 1, width: 1, height: 1.2, sill: 0.9 }] });
  assert.deepEqual(allOpenings(p).openings.map((o) => o.id), ['o0', 'o1']);
});

test('un rez-de-chaussée effacé ne fait pas disparaître le logement', () => {
  const p = addFloor(house(), 'Étage').plan;
  const cleared = withFloorDoc(p, 0, { ...floorDoc(p, 0), nodes: [], walls: [], rooms: [], openings: [] });
  assert.equal(hasWalls(cleared), true);
  assert.equal(hasWalls(emptyPlan()), false);
});

test('des murs plus hauts au rez-de-chaussée : les étages montent avec', () => {
  let p = addFloor(addFloor(house(), 'Étage').plan, 'Combles').plan;
  const [e1, e2] = floorViews(p).slice(1).map((v) => v.elevation);
  p = withFloorDoc(p, 0, { ...floorDoc(p, 0), wallHeight: 3 });
  assert.deepEqual(floorViews(p).slice(1).map((v) => v.elevation), [e1 + 0.5, e2 + 0.5]);
  // Le premier étage plus bas : seul celui du dessus descend.
  p = withFloorDoc(p, 1, { ...floorDoc(p, 1), wallHeight: 2.2 });
  assert.deepEqual(floorViews(p).slice(1).map((v) => v.elevation), [e1 + 0.5, Math.round((e2 + 0.2) * 1000) / 1000]);
});
