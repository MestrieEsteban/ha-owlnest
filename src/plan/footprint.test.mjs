import test from 'node:test';
import assert from 'node:assert/strict';
import { wallFootprints } from './footprint.mjs';
import { pointInPolygon } from './geometry.mjs';
import { addRect } from './graph.mjs';
import { templatePlan, TEMPLATES } from './templates.mjs';

const empty = () => ({ version: 2, wallHeight: 2.5, wallThickness: 0.15, nodes: [], walls: [], rooms: [], openings: [] });

/** Les points d'un carré autour du coin que ne couvre aucune semelle. */
function holesAround(plan, node, half) {
  const feet = [...wallFootprints(plan).values()];
  const holes = [];
  const steps = 13;
  for (let i = 0; i <= steps; i++) {
    for (let j = 0; j <= steps; j++) {
      const p = { x: node.x - half + (2 * half * i) / steps, y: node.y - half + (2 * half * j) / steps };
      if (!feet.some((f) => pointInPolygon(p, f))) holes.push(p);
    }
  }
  return holes;
}

/** Les coins où un point, au cœur de chaque mur qui y arrive, n'est pas couvert. */
function openJunctions(plan) {
  const feet = [...wallFootprints(plan).values()];
  const bad = [];
  for (const node of plan.nodes) {
    const walls = plan.walls.filter((w) => w.a === node.id || w.b === node.id);
    if (walls.length < 2) continue;
    // Un petit cercle autour du coin, plus fin que le mur. Les angles évitent
    // les bords des semelles, où le test d'appartenance est indécis.
    const r = 0.4 * plan.wallThickness / 2;
    const probes = Array.from({ length: 16 }, (_, k) => k * Math.PI / 8 + 0.1)
      .map((a) => ({ x: node.x + r * Math.cos(a), y: node.y + r * Math.sin(a) }));
    if (probes.some((p) => !feet.some((f) => pointInPolygon(p, f)))) bad.push(node);
  }
  return bad;
}

test('un T : le centre de la jonction est couvert', () => {
  const p = empty();
  addRect(p, 0, 0, 4, 3);
  addRect(p, 0, 3, 2, 5);
  addRect(p, 2, 3, 4, 5);
  const t = p.nodes.find((n) => Math.abs(n.x - 2) < 1e-6 && Math.abs(n.y - 3) < 1e-6);
  assert.ok(t, 'le coin du T existe');
  assert.deepEqual(holesAround(p, t, 0.07), []);
});

test('un L : l’angle reste fermé, sans point superflu', () => {
  const p = empty();
  addRect(p, 0, 0, 4, 3);
  for (const foot of wallFootprints(p).values()) assert.equal(foot.length, 4);
});

for (const id of TEMPLATES) {
  test(`modèle ${id} : aucune jonction de murs ouverte`, () => {
    assert.deepEqual(openJunctions(templatePlan(id)), []);
  });
}
