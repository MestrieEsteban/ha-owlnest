import test from 'node:test';
import assert from 'node:assert/strict';
import { stairSteps, layout, wellCorners, inStair, TREADS } from './stairs.mjs';
import { buildHouse } from './house.mjs';
import { addFloor } from './floors.mjs';

const span = (pts, k) => Math.max(...pts.map((p) => p[k])) - Math.min(...pts.map((p) => p[k]));

test('les marches ne dépassent pas 20 cm, la pente règle la longueur', () => {
  assert.equal(stairSteps(2.7), 14);
  assert.ok(2.7 / stairSteps(2.7) <= 0.2);
  const len = (slope) => span(layout({ id: 's', x: 0, y: 0, rotation: 0, width: 0.9, slope }, 2.7).steps.flatMap((st) => st.poly), 'y');
  assert.ok(Math.abs(len(undefined) - 14 * TREADS.normal) < 1e-9);
  assert.ok(len('gentle') > len(undefined) && len(undefined) > len('steep'));
});

test('chaque forme monte marche après marche jusqu’à la hauteur de l’étage', () => {
  for (const shape of ['straight', 'l', 'u', 'spiral']) {
    const { steps } = layout({ id: 's', x: 0, y: 0, rotation: 0, width: 0.9, shape }, 2.7);
    assert.equal(steps.length, 14, shape);
    for (let i = 1; i < steps.length; i++) assert.ok(steps[i].top > steps[i - 1].top, shape);
    assert.ok(Math.abs(steps[steps.length - 1].top - 2.7) < 1e-9, shape);
  }
});

test('un escalier en L est plus court qu’un droit, et tourne du côté demandé', () => {
  const straight = layout({ id: 's', x: 0, y: 0, rotation: 0, width: 0.9 }, 2.7).steps.flatMap((st) => st.poly);
  const right = layout({ id: 's', x: 0, y: 0, rotation: 0, width: 0.9, shape: 'l' }, 2.7);
  const left = layout({ id: 's', x: 0, y: 0, rotation: 0, width: 0.9, shape: 'l', turn: 'left' }, 2.7);
  assert.ok(span(right.steps.flatMap((st) => st.poly), 'y') < span(straight, 'y'));
  // La dernière marche est à droite (x > 0), ou à gauche en miroir.
  const last = (l) => l.steps[l.steps.length - 1].poly.reduce((a, p) => a + p.x, 0) / 4;
  assert.ok(last(right) > 0 && last(left) < 0);
  assert.equal(right.well.exit.side, 'x1');
  assert.equal(left.well.exit.side, 'x0');
});

test('un escalier tourné se laisse attraper où il est', () => {
  const s = { id: 's', x: 2, y: 1, rotation: 90, width: 1 };
  // À 90°, il part vers les y croissants.
  assert.ok(inStair(s, 2.7, { x: 2.3, y: 2.5 }));
  assert.ok(!inStair(s, 2.7, { x: 2.8, y: 1 }));
  const c = wellCorners(s, 2.7);
  assert.ok(Math.abs(span(c, 'x') - 1) < 1e-9);
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
