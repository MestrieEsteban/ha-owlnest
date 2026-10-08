import test from 'node:test';
import assert from 'node:assert/strict';
import { sh3dLeaves, hingeSide, boxOf } from './sh3d.mjs';

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
