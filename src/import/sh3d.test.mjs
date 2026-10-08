import test from 'node:test';
import assert from 'node:assert/strict';
import { sh3dLeaves, hingeSide, slideSide, boxOf, leafYaw, unrotate } from './sh3d.mjs';

test("une porte : gonds, poignée et vantail, refermée par le meuble suivant", () => {
  const leaves = sh3dLeaves([
    'frame_door_Cube_67',
    'sweethome3d_hinge_1_6_68',
    'sweethome3d_hinge_1_69',
    'sweethome3d_opening_on_hinge_1_handle_70',
    'sweethome3d_opening_on_hinge_1_door_71',
    'TV_Stand_108_72',
  ]);
  assert.deepEqual(leaves, [{ piece: 0, n: 1, motion: 'hinge', moving: [3, 4], axis: [1, 2], pane: false }]);
});

test('une fenêtre à deux vantaux vitrés', () => {
  const leaves = sh3dLeaves([
    'sweethome3d_hinge_1_2', 'sweethome3d_hinge_1_1',
    'sweethome3d_opening_on_hinge_1_handle', 'sweethome3d_opening_on_hinge_1',
    'sweethome3d_window_pane_on_hinge_1',
    'sweethome3d_hinge_2_1',
    'sweethome3d_opening_on_hinge_2', 'sweethome3d_window_pane_on_hinge_2',
  ]);
  assert.equal(leaves.length, 2);
  assert.ok(leaves.every((l) => l.piece === 0 && l.pane));
  assert.deepEqual(leaves.map((l) => l.n), [1, 2]);
});

test('deux meubles collés : la numérotation qui repart ouvre un nouveau meuble', () => {
  const leaves = sh3dLeaves([
    'sweethome3d_hinge_1', 'sweethome3d_opening_on_hinge_1_door',
    'sweethome3d_hinge_1', 'sweethome3d_opening_on_hinge_1_door',
  ]);
  assert.deepEqual(leaves.map((l) => l.piece), [0, 1]);
});

test('un miroir Sweet Home 3D ne coupe pas le meuble, un groupe quelconque si', () => {
  const same = sh3dLeaves(['sweethome3d_hinge_1', 'sweethome3d_window_mirror_221', 'sweethome3d_opening_on_hinge_1']);
  assert.equal(same.length, 1);
  const split = sh3dLeaves(['sweethome3d_hinge_1', 'Corps', 'sweethome3d_opening_on_hinge_1']);
  assert.equal(split.length, 0, 'gonds et vantail dans deux meubles différents : rien de sûr');
});

test('un coulissant sur rail', () => {
  const [leaf] = sh3dLeaves(['sweethome3d_rail_1', 'sweethome3d_window_pane_on_rail_1']);
  assert.equal(leaf.motion, 'rail');
});

test('côté des gonds, le long de la largeur du vantail', () => {
  // Vantail de 90 de large (x), 210 de haut (y), 4 d'épaisseur (z).
  const leaf = { min: [0, 0, 0], max: [90, 210, 4] };
  assert.equal(hingeSide(leaf, { min: [-2, 20, 0], max: [1, 200, 4] }), 'start');
  assert.equal(hingeSide(leaf, { min: [88, 20, 0], max: [92, 200, 4] }), 'end');
});

test('boîte de plusieurs listes de positions', () => {
  assert.deepEqual(boxOf([[0, 1, 2, 5, -1, 3], [2, 2, 9]]), { min: [0, -1, 2], max: [5, 2, 9] });
  assert.equal(boxOf([[]]), null);
});

test('une porte-fenêtre coulissante sur rail commun', () => {
  const leaves = sh3dLeaves([
    'window_frame_241',
    'sweethome3d_unique_rail_242',
    'sweethome3d_opening_on_rail_1_handle_243',
    'sweethome3d_opening_on_rail_1_245',
    'sweethome3d_window_pane_on_rail_1_246',
    'sweethome3d_opening_on_rail_2_247',
    'sweethome3d_window_pane_on_rail_2_248',
    'window_frame_249',
    'sweethome3d_unique_rail_250',
    'sweethome3d_opening_on_rail_1_251',
  ]);
  assert.deepEqual(leaves.map((l) => [l.piece, l.n, l.motion, l.axis]), [
    [0, 1, 'rail', [1]], [0, 2, 'rail', [1]], [1, 1, 'rail', [8]],
  ]);
});

test('un coulissant glisse vers son voisin', () => {
  const left = { min: [0, 0, 0], max: [100, 220, 4] };
  const right = { min: [100, 0, 6], max: [200, 220, 10] };
  const rail = { min: [0, 220, 0], max: [200, 222, 10] };
  assert.equal(slideSide(left, [right], rail), 'end');
  assert.equal(slideSide(right, [left], rail), 'start');
});

test("l'orientation d'un vantail posé en biais", () => {
  // Panneau de 90 × 4 tourné de 30° autour de Y.
  const a = (30 * Math.PI) / 180;
  const pts = [];
  for (const [x, z] of [[0, 0], [90, 0], [90, 4], [0, 4]]) {
    for (const y of [0, 200]) pts.push(x * Math.cos(a) + z * Math.sin(a), y, -x * Math.sin(a) + z * Math.cos(a));
  }
  const yaw = leafYaw([pts]);
  const box = boxOf(unrotate([pts], yaw));
  const dims = [0, 1, 2].map((k) => Math.round(box.max[k] - box.min[k])).sort((p, q) => q - p);
  assert.deepEqual(dims, [200, 90, 4]);
  assert.equal(leafYaw([[0, 0, 0, 90, 0, 0, 90, 0, 4, 0, 200, 0]]), 0, 'dans les axes : pas de rotation');
});
