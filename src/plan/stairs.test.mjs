import test from 'node:test';
import assert from 'node:assert/strict';
import { stairSteps, stairLength, stairCorners, inStair, TREAD } from './stairs.mjs';
import { buildHouse } from './house.mjs';
import { addFloor } from './floors.mjs';

test('les marches ne dépassent pas 20 cm, la longueur en découle', () => {
  assert.equal(stairSteps(2.7), 14);
  assert.ok(2.7 / stairSteps(2.7) <= 0.2);
  assert.equal(stairLength(2.7), 14 * TREAD);
});

test('un escalier tourné garde son emprise et se laisse attraper', () => {
  const s = { id: 's', x: 2, y: 1, rotation: 90, width: 1 };
  const c = stairCorners(s, 2.7);
  const xs = c.map((p) => p.x), ys = c.map((p) => p.y);
  // À 90°, il monte vers les y croissants : 1 m de large en x, 3,5 m de long en y.
  assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - 1) < 1e-9);
  assert.ok(Math.abs(Math.max(...ys) - Math.min(...ys) - stairLength(2.7)) < 1e-9);
  assert.ok(inStair(s, 2.7, { x: 2.3, y: 2.5 }));
  assert.ok(!inStair(s, 2.7, { x: 2.8, y: 1 }));
});

/** Une pièce de 6 × 4 m. */
function house() {
  const nodes = [[0, 0], [6, 0], [6, 4], [0, 4]].map(([x, y], i) => ({ id: `n${i}`, x, y }));
  const walls = nodes.map((n, i) => ({ id: `w${i}`, a: n.id, b: nodes[(i + 1) % 4].id }));
  return { version: 2, wallHeight: 2.5, wallThickness: 0.15, nodes, walls, rooms: [{ id: 'r', name: 'Séjour', seed: { x: 3, y: 2 } }], openings: [] };
}

test("l'escalier monte jusqu'à l'étage, dont le sol est percé au-dessus de lui", () => {
  let plan = addFloor(house(), 'Étage').plan;
  plan = { ...plan, stairs: [{ id: 'st', x: 2.5, y: 1, rotation: 0, width: 0.9 }] };
  const ground = buildHouse(plan, 0).root;
  assert.ok(ground.getObjectByName('plan_stair_st'), "l'escalier est construit");
  assert.ok(!ground.getObjectByName('plan_stairwell_st'), "pas de trémie sans l'étage");
  const both = buildHouse(plan, 1).root;
  assert.ok(both.getObjectByName('plan_stairwell_st'), 'la trémie et son garde-corps');
  let cut = 0;
  both.traverse((o) => { if (o.material?.clippingPlanes?.length === 4) cut++; });
  // Le sol de l'étage, son épaisseur, et la dalle du rez-de-chaussée.
  assert.ok(cut >= 3, `sols percés : ${cut}`);
  // Le haut de l'escalier arrive au sol de l'étage.
  const box = both.getObjectByName('plan_stair_st_steps').geometry;
  box.computeBoundingBox();
  const rise = plan.floors[0].elevation;
  assert.ok(Math.abs(box.boundingBox.max.y - rise) < 1e-6, `${box.boundingBox.max.y} pour ${rise}`);
});
