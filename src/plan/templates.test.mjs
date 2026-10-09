import test from 'node:test';
import assert from 'node:assert/strict';
import { templatePlan, templateModels, TEMPLATES } from './templates.mjs';

// Dimensions réelles des meubles (largeur, profondeur), relevées sur les modèles
// chargés dans le navigateur : le test tient sans charger de GLB.
const SIZES = {
  kitchenFridge: [0.86, 0.58], kitchenCabinet: [0.86, 0.9], kitchenSink: [0.86, 0.9], kitchenStove: [0.86, 0.9],
  q_Bed_King: [1.53, 1.98], q_Bed_Single: [0.99, 1.97], q_NightStand_1: [0.48, 0.48], lampRoundTable: [0.3, 0.35],
  q_Couch_Small1: [1.44, 1.1], q_Couch_Medium1: [2.34, 1.1], q_Table_RoundSmall: [1.3, 1.3], q_Chair_1: [0.38, 0.41],
  q_Bathroom_Shower1: [0.95, 0.95], q_Bathroom_Toilet: [0.6, 0.85], q_Bathroom_Toilet2: [0.56, 0.77], q_Bathroom_Sink: [0.69, 0.41],
  q_Bathroom_Bathtub: [0.8, 1.95], q_Bathroom_WashingMachine: [0.65, 0.66], coatRackStanding: [0.55, 0.55], rugDoormat: [0.86, 0.47],
  cabinetTelevision: [1.6, 0.5], televisionModern: [1.37, 0.26], rugRectangle: [3.14, 1.84], tableCoffee: [1.32, 0.8],
  lampRoundFloor: [0.3, 0.35], pottedPlant: [0.42, 0.48], q_Drawer_1: [1.4, 0.56], q_Drawer_4: [1.4, 0.56],
  desk: [1.47, 0.78], chairDesk: [0.67, 0.63], computerScreen: [0.79, 0.21], q_Bookshelf: [1.16, 0.38], q_Shelf_Large: [1.69, 0.38],
};
const sizeOf = (m) => (SIZES[m] ? { w: SIZES[m][0], d: SIZES[m][1] } : null);

/** Emprise au sol, les rotations étant des quarts de tour. */
function box(it) {
  const [w, d] = SIZES[it.model];
  const turned = Math.abs(((it.rotation % 180) + 180) % 180) === 90;
  const [hx, hy] = turned ? [d / 2, w / 2] : [w / 2, d / 2];
  return { x0: it.x - hx, x1: it.x + hx, y0: it.y - hy, y1: it.y + hy };
}
const flat = (m) => /rug/i.test(m);
const seat = (m) => /chair/i.test(m);
const support = (m) => /table|desk/i.test(m);

for (const id of TEMPLATES) {
  test(`modèle ${id} : meublé, chaque meuble dans une pièce, sans chevauchement`, () => {
    for (const m of templateModels(id)) assert.ok(SIZES[m], `dimensions connues pour ${m}`);
    const plan = templatePlan(id, undefined, sizeOf);
    assert.ok(plan.items.length >= 5, 'des meubles sont posés');
    const t = 1e-6;
    // Dans le logement, murs exclus.
    const xs = plan.nodes.map((n) => n.x), ys = plan.nodes.map((n) => n.y);
    const inset = plan.wallThickness / 2;
    for (const it of plan.items) {
      const b = box(it);
      assert.ok(b.x0 >= Math.min(...xs) + inset - t && b.x1 <= Math.max(...xs) - inset + t
        && b.y0 >= Math.min(...ys) + inset - t && b.y1 <= Math.max(...ys) - inset + t, `${it.model} reste dans le logement`);
      // Aucun mur ne traverse le meuble.
      for (const w of plan.walls) {
        const a = plan.nodes.find((n) => n.id === w.a), c = plan.nodes.find((n) => n.id === w.b);
        const vertical = Math.abs(a.x - c.x) < 1e-9;
        const crosses = vertical
          ? a.x + inset > b.x0 + t && a.x - inset < b.x1 - t && Math.max(a.y, c.y) > b.y0 + t && Math.min(a.y, c.y) < b.y1 - t
          : a.y + inset > b.y0 + t && a.y - inset < b.y1 - t && Math.max(a.x, c.x) > b.x0 + t && Math.min(a.x, c.x) < b.x1 - t;
        assert.ok(!crosses, `${it.model} (${it.x}, ${it.y}) ne traverse pas un mur`);
      }
    }
    // Deux meubles au sol ne se chevauchent pas.
    for (let i = 0; i < plan.items.length; i++) {
      for (let j = i + 1; j < plan.items.length; j++) {
        const p = plan.items[i], q = plan.items[j];
        if (flat(p.model) || flat(q.model)) continue;
        if (p.x === q.x && p.y === q.y) continue; // l'un posé sur l'autre
        if ((seat(p.model) && support(q.model)) || (seat(q.model) && support(p.model))) continue;
        const a = box(p), b = box(q);
        const overlap = a.x0 < b.x1 - t && b.x0 < a.x1 - t && a.y0 < b.y1 - t && b.y0 < a.y1 - t;
        assert.ok(!overlap, `${p.model} et ${q.model} ne se chevauchent pas`);
      }
    }
  });
}

test('sans dimensions, un modèle arrive sans meubles', () => {
  assert.equal(templatePlan('t2').items.length, 0);
});
