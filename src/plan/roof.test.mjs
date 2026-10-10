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

test('un L aux ailes inégales, et les contours réels qui faisaient des pics', () => {
  const L = [{ x: 0, y: 0 }, { x: 8.65, y: 0 }, { x: 8.65, y: 5.3 }, { x: 4.65, y: 5.3 }, { x: 4.65, y: 8.65 }, { x: 0, y: 8.65 }];
  assert.ok(Math.abs(covered(hipRoof(L, 1)) - (8.65 * 5.3 + 4.65 * 3.35)) < 1e-6);
  // Un contour avec un mur en biais et des sommets au milieu des façades.
  const odd = [[-0.075, -0.075], [1.025, -0.075], [1.025, -1.486], [3.602, -1.118], [4.049, -0.075], [5, -0.075], [7.275, -0.075], [7.275, 2.275], [5.038, 2.275], [4.236, 3.378], [-0.075, 3.07]].map(([x, y]) => ({ x, y }));
  const a = odd.reduce((s, q, i) => { const r = odd[(i + 1) % odd.length]; return s + (q.x * r.y - r.x * q.y) / 2; }, 0);
  assert.ok(Math.abs(covered(hipRoof(odd, 0.7)) - a) < 1e-4, String(covered(hipRoof(odd, 0.7))) + ' vs ' + a);
});

test('300 contours au hasard : les pans couvrent exactement la maison', () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const shoelace = (p) => p.reduce((s, q, i) => { const r = p[(i + 1) % p.length]; return s + (q.x * r.y - r.x * q.y) / 2; }, 0);
  const fails = [];
  let ran = 0;
  for (let k = 0; k < 300; k++) {
    let poly;
    if (k % 2) {
      // En étoile : des angles quelconques, des murs en biais.
      const n = 5 + Math.floor(rnd() * 9);
      poly = Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2 + rnd() * 0.3, r = 3 + rnd() * 5;
        return { x: Math.cos(a) * r, y: Math.sin(a) * r };
      });
    } else {
      // Des pièces rectangulaires sur une grille : L, T, U, escaliers.
      const W = 6, H = 6, on = new Set();
      let x = 2, y = 2;
      for (let i = 0; i < 6 + Math.floor(rnd() * 10); i++) {
        on.add(`${x},${y}`);
        const d = Math.floor(rnd() * 4);
        x = Math.max(0, Math.min(W - 1, x + [1, -1, 0, 0][d]));
        y = Math.max(0, Math.min(H - 1, y + [0, 0, 1, -1][d]));
      }
      // Le contour des cases (sans trou : on bouche les cases entourées).
      const edges = new Map();
      const sizes = [0, 2.5, 4, 7, 9.5, 12, 15];
      const P = (i, j) => `${sizes[i]},${sizes[j]}`;
      for (const c of on) {
        const [i, j] = c.split(',').map(Number);
        const side = (a, b, ni, nj) => { if (!on.has(`${ni},${nj}`)) edges.set(a, b); };
        side(P(i, j), P(i + 1, j), i, j - 1);
        side(P(i + 1, j), P(i + 1, j + 1), i + 1, j);
        side(P(i + 1, j + 1), P(i, j + 1), i, j + 1);
        side(P(i, j + 1), P(i, j), i - 1, j);
      }
      const start = edges.keys().next().value;
      poly = []; let cur = start, guard = 0;
      do { poly.push(cur); cur = edges.get(cur); } while (cur && cur !== start && guard++ < 500);
      if (cur !== start) continue;
      poly = poly.map((s) => { const [a, b] = s.split(',').map(Number); return { x: a, y: b }; });
      // Un contour à trou n'est pas fait d'une seule boucle : on le saute.
      const total = [...on].reduce((s, c) => { const [i, j] = c.split(',').map(Number); return s + (sizes[i + 1] - sizes[i]) * (sizes[j + 1] - sizes[j]); }, 0);
      if (Math.abs(Math.abs(shoelace(poly)) - total) > 1e-6) continue;
    }
    const want = Math.abs(shoelace(poly));
    ran++;
    const got = covered(hipRoof(poly, 0.7));
    if (Math.abs(got - want) > 1e-4 * Math.max(1, want)) fails.push(`${k}: ${got.toFixed(4)} au lieu de ${want.toFixed(4)}`);
  }
  assert.deepEqual(fails, []);
  assert.ok(ran > 200, `seulement ${ran} contours essayés`);
});
