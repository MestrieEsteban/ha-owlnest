import test from 'node:test';
import assert from 'node:assert/strict';
import { parseXml, readHome, homeToPlan, arcPoints, sh3dColor, openingKind } from './sh3d-home.mjs';
import { fitSh3d, toModel, makeMover, matchNearest } from './sh3d-migrate.mjs';
import { orientObj, buildMtl, variantKey, namedColor } from './sh3d-furniture.mjs';
import { faces } from '../plan/graph.mjs';

// Deux pièces de 4 m × 3 m côte à côte, une porte entre elles, une fenêtre
// double au nord, un canapé et un groupe de deux chaises. Murs de 10 cm.
const XML = `<?xml version='1.0'?>
<home version='7400' wallHeight='250.0'>
  <!-- un commentaire -->
  <wall id='w1' xStart='0' yStart='0' xEnd='800' yEnd='0' height='250' thickness='10' rightSideColor='FFEEDDCC'/>
  <wall id='w2' xStart='800' yStart='0' xEnd='800' yEnd='300' height='250' thickness='10'/>
  <wall id='w3' xStart='800' yStart='300' xEnd='0' yEnd='300' height='250' thickness='10'/>
  <wall id='w4' xStart='0' yStart='300' xEnd='0' yEnd='0' height='250' thickness='10'/>
  <wall id='w5' xStart='400' yStart='0' xEnd='400' yEnd='300' height='250' thickness='10'/>
  <room name='Salon &amp; cuisine' floorColor='FF336699'><point x='0' y='0'/><point x='400' y='0'/><point x='400' y='300'/><point x='0' y='300'/></room>
  <doorOrWindow catalogId='eTeks#door' name='Porte' model='1' x='400' y='150' elevation='0' width='90' depth='10' height='208' angle='1.5707964'>
    <sash xAxis='0.05' yAxis='0.5' width='0.9' startAngle='0' endAngle='-1.57'/>
  </doorOrWindow>
  <doorOrWindow catalogId='eTeks#doubleWindow126x123' name='Fenêtre' model='2' x='200' y='0' elevation='90' width='126' depth='10' height='123' angle='0'>
    <sash xAxis='0.02' yAxis='0.5' width='0.48' startAngle='0' endAngle='-1.57'/>
    <sash xAxis='0.98' yAxis='0.5' width='0.48' startAngle='3.14' endAngle='4.71'/>
  </doorOrWindow>
  <pieceOfFurniture name='Canapé' model='3' x='200' y='250' width='190' depth='86' height='88' angle='3.1415927' color='FF6C776E'>
    <material name='seat' color='FF112233'/>
  </pieceOfFurniture>
  <furnitureGroup name='Chaises'>
    <pieceOfFurniture name='Chaise' model='4' x='600' y='100' width='40' depth='40' height='90' elevation='0'/>
    <pieceOfFurniture name='Chaise' model='4' x='650' y='100' width='40' depth='40' height='90' visible='false'/>
  </furnitureGroup>
  <light name='Lampe' model='5' x='700' y='250' elevation='70' width='30' depth='30' height='50' power='0.5'/>
</home>`;

const names = () => { let n = 0; return { room: () => `Pièce ${++n}`, floor: () => '#d8c3a5' }; };

test('lecture du XML : imbrication, attributs, entités', () => {
  const root = parseXml(XML);
  const home = root.children[0];
  assert.equal(home.tag, 'home');
  const room = home.children.find((c) => c.tag === 'room');
  assert.equal(room.attrs.name, 'Salon & cuisine');
  assert.equal(room.children.length, 4);
});

test('la maison : murs, pièces, portes, meubles (groupes dépliés, invisibles écartés)', () => {
  const home = readHome(XML);
  assert.equal(home.walls.length, 5);
  assert.equal(home.rooms[0].floorColor, '#336699');
  assert.deepEqual(home.pieces.map((p) => `${p.kind}:${p.name}`), ['door:Porte', 'door:Fenêtre', 'piece:Canapé', 'piece:Chaise', 'light:Lampe']);
  assert.equal(home.pieces[2].materials.seat, '#112233');
});

test('conversion : un plan en mètres, deux pièces, l’ouverture sur son mur', () => {
  const { plan, items, skipped } = homeToPlan(readHome(XML), names());
  assert.equal(plan.wallThickness, 0.1);
  assert.equal(plan.wallHeight, 2.5);
  assert.equal(faces(plan).length, 2);
  assert.deepEqual(plan.rooms.map((r) => r.name).sort(), ['Pièce 1', 'Salon & cuisine']);
  assert.equal(plan.rooms.find((r) => r.name === 'Salon & cuisine').floor, '#336699');
  const door = plan.openings.find((o) => o.kind === 'door');
  const win = plan.openings.find((o) => o.kind === 'window');
  assert.ok(door && win, 'une porte et une fenêtre');
  assert.equal(door.width, 0.9);
  assert.equal(win.sill, 0.9);
  assert.equal(win.double, true);
  assert.equal(Math.round(win.offset * 100), 200);
  assert.equal(skipped.openings, 0);
  // Le canapé, tourné d'un demi-tour, à sa hauteur.
  const sofa = items.find((i) => i.piece.name === 'Canapé');
  assert.deepEqual([sofa.x, sofa.y, sofa.rotation, sofa.size], [2, 2.5, 180, [1.9, 0.86, 0.88]]);
  assert.equal(items.find((i) => i.piece.name === 'Lampe').elevation, 0.7);
  assert.equal(items.length, 3, 'la chaise invisible n’est pas importée');
  // La face droite du mur nord (vers le sud, dans la maison) est peinte.
  assert.ok(plan.rooms.some((r) => r.wall === '#eeddcc'));
});

test('plusieurs niveaux : seul le plus bas qui a des murs est importé', () => {
  const xml = `<home wallHeight='250'>
    <level id='l0' name='RDC' elevation='0' elevationIndex='0'/>
    <level id='l1' name='Étage' elevation='260' elevationIndex='1'/>
    <wall level='l0' xStart='0' yStart='0' xEnd='300' yEnd='0' thickness='10'/>
    <wall level='l1' xStart='0' yStart='0' xEnd='0' yEnd='300' thickness='10'/>
    <wall level='l1' xStart='0' yStart='300' xEnd='300' yEnd='300' thickness='10'/>
  </home>`;
  const conv = homeToPlan(readHome(xml), names());
  assert.equal(conv.level.name, 'RDC');
  assert.equal(conv.levels, 2);
  assert.equal(conv.plan.walls.length, 1);
});

test('un mur courbe devient des segments qui passent par ses deux bouts', () => {
  const pts = arcPoints({ xStart: 0, yStart: 0, xEnd: 200, yEnd: 0, thickness: 10, arcExtent: Math.PI / 2 });
  assert.ok(pts.length >= 5);
  assert.deepEqual(pts[0], { x: 0, y: 0 });
  assert.deepEqual(pts[pts.length - 1], { x: 200, y: 0 });
  // Tous sur un même cercle, bombé d'un côté.
  const sag = Math.max(...pts.map((p) => Math.abs(p.y)));
  assert.ok(sag > 30 && sag < 50, `flèche ${sag}`);
});

test('nature des ouvertures', () => {
  const p = (catalogId, name, sashes = 1) => ({ catalogId, name, sashes: Array(sashes).fill({}) });
  assert.equal(openingKind(p('eTeks#doubleFrenchWindow126x200', 'Double porte-fenêtre', 2)), 'window');
  assert.equal(openingKind(p('eTeks#sliderWindow', 'Baie coulissante', 2)), 'slider');
  assert.equal(openingKind(p('eTeks#garageDoor', 'Porte de garage', 0)), 'slider');
  assert.equal(openingKind(p('eTeks#door', 'Porte')), 'door');
  assert.equal(openingKind(p('eTeks#doorFrame', 'Encadrement', 0)), 'passage');
  assert.equal(sh3dColor('FF6C776E'), '#6c776e');
  assert.equal(sh3dColor('nope'), undefined);
});

test('meubles : rotation et miroir appliqués à l’OBJ, matières reconstituées', () => {
  const obj = 'v 1 0 0\nvn 0 0 1\nusemtl flblonde\nf 1 1 1\nusemtl glass\n';
  // Un quart de tour autour de la verticale (y) : x devient -z.
  const turned = orientObj(obj, [0, 0, 1, 0, 1, 0, -1, 0, 0]);
  assert.match(turned, /^v 0 0 -1$/m);
  assert.match(turned, /^vn 1 0 0$/m);
  assert.match(orientObj(obj, undefined, true), /^v -1 0 0$/m);
  const mtl = buildMtl(obj, null, { materials: {} });
  assert.match(mtl, /newmtl flblonde\nKd 0\.82/);
  assert.match(mtl, /newmtl glass\nKd [\d. ]+\nd 0\.35/);
  // Couleur imposée : toutes les matières la prennent, sans texture.
  const forced = buildMtl(obj, 'newmtl flblonde\nKd 1 1 1\nmap_Kd wood.jpg\n', { color: '#ff0000', materials: {} });
  assert.doesNotMatch(forced, /map_Kd/);
  assert.match(forced, /newmtl flblonde\nKd 1\.0000 0\.0000 0\.0000/);
  assert.equal(namedColor('mystère').opacity, 1);
  const a = { model: '3', materials: {} }, b = { model: '3', materials: {}, color: '#ff0000' };
  assert.notEqual(variantKey(a), variantKey(b));
  assert.equal(variantKey(a), variantKey({ ...a }));
});

test('recalage : un export OBJ en cm, Y en haut, se retrouve', () => {
  const home = { min: [-300, 360, 0], max: [360, 1090, 250] };
  // Le modèle : mêmes coordonnées, la hauteur en Y.
  const model = { min: [-300, 0, 360], max: [360, 250, 1090] };
  const fit = fitSh3d(home, model);
  assert.ok(fit);
  assert.deepEqual(toModel(fit, [100, 500, 120]).map(Math.round), [100, 120, 500]);
});

test('recalage : un modèle passé par Blender (Z en haut, en mètres)', () => {
  const home = { min: [0, 0, 0], max: [800, 300, 250] };
  const model = { min: [0, -3, 0], max: [8, 0, 2.5] };
  const fit = fitSh3d(home, model);
  assert.equal(fit.scale, 0.01);
  assert.deepEqual(toModel(fit, [800, 300, 0]).map((v) => +v.toFixed(3)), [8, -3, 0]);
});

test('recalage : un autre logement est refusé', () => {
  assert.equal(fitSh3d({ min: [0, 0, 0], max: [800, 300, 250] }, { min: [0, 0, 0], max: [500, 250, 600] }), null);
});

test('une ancre de l’ancienne scène tombe au même endroit du nouveau plan', () => {
  const home = { min: [0, 0, 0], max: [800, 300, 250] };
  const model = { min: [0, 0, 0], max: [800, 250, 300] };
  const fit = fitSh3d(home, model);
  // Ancien modèle recentré de (400, 125, 150) ; nouveau plan centré sur (4, 1.5), sol à -1.25.
  const move = makeMover(fit, [-400, -125, -150], [-4, -1.25, -1.5]);
  // Une ancre au-dessus du point (600, 100) du plan, à 1,2 m : ancienne scène (200, -5, -50).
  assert.deepEqual(move.point([200, -5, -50]).map((v) => +v.toFixed(3)), [2, -0.05, -0.5]);
  assert.deepEqual(move.direction([0, -1, 0]), [0, -1, 0]);
});

test('chaque ancien ouvrant trouve le vantail le plus proche, une seule fois', () => {
  const m = matchNearest(
    [{ item: 'a', at: [0, 0, 0] }, { item: 'b', at: [0.1, 0, 0] }, { item: 'c', at: [9, 0, 0] }],
    [{ item: 'x', at: [0.05, 0, 0] }, { item: 'y', at: [0.6, 0, 0] }],
    1,
  );
  assert.equal(m.size, 2);
  assert.ok(!m.has('c'), 'trop loin');
  assert.notEqual(m.get('a'), m.get('b'));
});

test('une pièce en U ouverte est fermée par une limite invisible, qui a un sol mais pas de mur', async () => {
  const { closeOpenAreas } = await import('./sh3d-home.mjs');
  const { isBoundary } = await import('../plan/graph.mjs');
  const { buildPlan } = await import('../plan/build.mjs');
  const xml = `<home wallHeight='250'>
    <wall xStart='0' yStart='300' xEnd='0' yEnd='0' thickness='10'/>
    <wall xStart='0' yStart='0' xEnd='310' yEnd='0' thickness='10'/>
    <wall xStart='310' yStart='0' xEnd='310' yEnd='300' thickness='10'/>
  </home>`;
  const { plan, boundaries } = homeToPlan(readHome(xml), names());
  assert.equal(boundaries, 1);
  assert.equal(plan.rooms.length, 1);
  const limit = plan.walls.filter((w) => isBoundary(plan, w));
  assert.equal(limit.length, 1);
  // En 3D : un sol, et pas de mur pour la limite.
  const root = buildPlan(plan);
  const names3d = []; root.traverse((o) => names3d.push(o.name));
  assert.ok(names3d.some((n) => n.startsWith('room_')));
  assert.equal(names3d.filter((n) => /^wall_/.test(n)).length > 0, true);
  assert.equal(closeOpenAreas(plan), 0, 'plus rien à fermer');
});

test('une limite qui ne ferait qu’un liseré le long d’un mur est refusée', async () => {
  const { closeOpenAreas } = await import('./sh3d-home.mjs');
  const xml = `<home wallHeight='250'>
    <wall xStart='0' yStart='0' xEnd='500' yEnd='0' thickness='10'/>
    <wall xStart='500' yStart='0' xEnd='500' yEnd='400' thickness='10'/>
    <wall xStart='500' yStart='400' xEnd='0' yEnd='400' thickness='10'/>
    <wall xStart='0' yStart='400' xEnd='0' yEnd='0' thickness='10'/>
    <wall xStart='250' yStart='0' xEnd='250' yEnd='200' thickness='10'/>
    <wall xStart='250' yStart='200' xEnd='260' yEnd='200' thickness='10'/>
  </home>`;
  const { plan } = homeToPlan(readHome(xml), names());
  assert.ok(plan.rooms.every((r) => r), 'des pièces');
  const tiny = (await import('../plan/graph.mjs')).faces(plan).filter((f) => f.area < 0.8);
  assert.equal(tiny.length, 0);
  assert.equal(closeOpenAreas(plan), 0);
});
