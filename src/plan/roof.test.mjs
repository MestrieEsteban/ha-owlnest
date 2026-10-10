import test from 'node:test';
import assert from 'node:assert/strict';
import { hipRoof, planOutline } from './roof.mjs';
import { addRect } from './graph.mjs';

const top = (strips) => Math.max(...strips.map((s) => s.h1));
// Aire au sol couverte par les pans : celle du contour, ni trou ni double.
const covered = (strips) => strips.reduce((sum, s) => {
  const p = s.pts; let a = 0;
  for (let i = 0; i < 4; i++) { const q = p[i], r = p[(i + 1) % 4]; a += q.x * r.y - r.x * q.y; }
  return sum + Math.abs(a) / 2;
}, 0);

test('un rectangle : quatre pans, faîtage à la demi-largeur', () => {
  const s = hipRoof([{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 4 }, { x: 0, y: 4 }], 1);
  assert.equal(s.length, 4);
  assert.ok(Math.abs(top(s) - 2) < 1e-6);
  assert.ok(Math.abs(covered(s) - 32) < 1e-6);
});

test('un carré : une pyramide', () => {
  const s = hipRoof([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }], 0.5);
  assert.ok(Math.abs(top(s) - 1) < 1e-6);
  assert.ok(Math.abs(covered(s) - 16) < 1e-6);
});

test('un L : tout le contour est couvert, sans dépasser', () => {
  const L = [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 3 }, { x: 3, y: 3 }, { x: 3, y: 8 }, { x: 0, y: 8 }];
  const s = hipRoof(L, 1);
  assert.ok(Math.abs(covered(s) - (24 + 15)) < 1e-6, String(covered(s)));
  assert.ok(Math.abs(top(s) - 1.5) < 1e-6);
});

test('un T et le sens horaire', () => {
  const T = [{ x: 0, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 6 }, { x: 7, y: 6 }, { x: 7, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 6 }, { x: 0, y: 6 }];
  const s = hipRoof(T, 1);
  assert.ok(Math.abs(covered(s) - (40 + 24)) < 1e-6, String(covered(s)));
  assert.ok(Math.abs(top(s) - 2) < 1e-6);
});

test('le contour d’un plan : au nu extérieur des murs', () => {
  const plan = { version: 2, wallHeight: 2.5, wallThickness: 0.2, nodes: [], walls: [], rooms: [], openings: [], items: [] };
  addRect(plan, 0, 0, 5, 4);
  addRect(plan, 5, 0, 8, 4);
  const o = planOutline(plan);
  const xs = o.map((p) => p.x), ys = o.map((p) => p.y);
  assert.ok(Math.abs(Math.min(...xs) + 0.1) < 1e-6 && Math.abs(Math.max(...xs) - 8.1) < 1e-6);
  assert.ok(Math.abs(Math.min(...ys) + 0.1) < 1e-6 && Math.abs(Math.max(...ys) - 4.1) < 1e-6);
});

test('un sommet au milieu d’une façade (une cloison qui y arrive) ne change rien', () => {
  const L = [{ x: 0, y: 0 }, { x: 9, y: 0 }, { x: 9, y: 4 }, { x: 4, y: 4 }, { x: 4, y: 9 }, { x: 0, y: 9 }, { x: 0, y: 4 }];
  const s = hipRoof(L, 1);
  assert.ok(Math.abs(covered(s) - (36 + 20)) < 1e-6, String(covered(s)));
  assert.ok(Math.abs(top(s) - 2) < 1e-6, String(top(s)));
});
