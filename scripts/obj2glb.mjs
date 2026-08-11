/**
 * obj2glb.mjs — convertit un OBJ + MTL en GLB compact.
 *
 * Pourquoi convertir : l'OBJ est du texte, où chaque coordonnée coûte une
 * dizaine d'octets au lieu de quatre.
 *
 * Pourquoi filtrer : un export Sweet Home 3D est dominé par le mobilier de
 * catalogue. Sur un appartement de 35 m², l'architecture ne représentait que
 * 2 % des 902 000 triangles — le reste étant de la vaisselle et des livres aux
 * pages modélisées. Une carte de plan n'en a pas l'usage, et la tablette
 * murale encore moins.
 *
 * Ce qui est préservé et qui compte : **les noms de groupes**. Sweet Home 3D
 * nomme ses objets (`sweethome3d_hinge_1`, `sweethome3d_opening_on_hinge_1_door`),
 * ce qui permet de reconnaître un vantail et son axe de rotation sans les
 * deviner par proportions. Chaque groupe devient donc son propre nœud glTF.
 *
 *   node scripts/obj2glb.mjs <entrée.obj> [sortie.glb] [options]
 *
 *     --only=<regex>   ne garder que les groupes dont le nom correspond
 *     --drop=<regex>   écarter les groupes dont le nom correspond
 *     --uv             conserver les coordonnées de texture (écartées par
 *                      défaut : aucune texture n'est embarquée)
 *     --max-tris=<n>   écarter les groupes plus lourds que n triangles
 *
 * Les textures ne sont jamais embarquées : seule la couleur diffuse du MTL est
 * reprise. Elles pèsent bien plus que la géométrie.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const args = process.argv.slice(2);
const flags = new Map(
  args.filter((a) => a.startsWith('--')).map((a) => {
    const i = a.indexOf('=');
    return i < 0 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)];
  }),
);
const positional = args.filter((a) => !a.startsWith('--'));
const input = positional[0];
if (!input) {
  console.error('Usage: node scripts/obj2glb.mjs <fichier.obj> [sortie.glb] [--only=…] [--drop=…] [--uv] [--max-tris=…]');
  process.exit(1);
}
const output = positional[1] ?? input.replace(/\.obj$/i, '.glb');
const only = flags.get('only') ? new RegExp(flags.get('only'), 'i') : null;
const drop = flags.get('drop') ? new RegExp(flags.get('drop'), 'i') : null;
const keepUv = flags.has('uv');
const maxTris = flags.get('max-tris') ? Number(flags.get('max-tris')) : Infinity;

// ── MTL : on ne garde que la couleur ────────────────────────────────────────

async function readMtl(file) {
  const mats = new Map();
  if (!fs.existsSync(file)) return mats;
  let cur = null;
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    const [key, ...rest] = line.trim().split(/\s+/);
    if (key === 'newmtl') {
      cur = { name: rest.join(' '), colour: [0.8, 0.8, 0.8], opacity: 1 };
      mats.set(cur.name, cur);
    } else if (!cur) {
      continue;
    } else if (key === 'Kd') {
      cur.colour = rest.slice(0, 3).map(Number);
    } else if (key === 'd') {
      cur.opacity = Number(rest[0]);
    } else if (key === 'Tr') {
      cur.opacity = 1 - Number(rest[0]);
    }
  }
  return mats;
}

// ── Lecture de l'OBJ ────────────────────────────────────────────────────────

const V = [];
const VN = [];
const VT = [];

/**
 * Un groupe accumule ses propres sommets **dédupliqués**.
 *
 * Un triplet `v/vt/vn` identique réutilise le même sommet : sans cette
 * déduplication, chaque triangle porterait trois sommets uniques et le GLB
 * serait plus gros que l'OBJ de départ.
 */
const groups = [];
let group = null;
let mtllib = null;

const startGroup = (name) => {
  group = {
    name: name || `group_${groups.length}`,
    material: null,
    map: new Map(), pos: [], nor: [], uv: [], idx: [],
  };
  groups.push(group);
  return group;
};

function vertexOf(token) {
  const known = group.map.get(token);
  if (known !== undefined) return known;

  const [vs, ts, ns] = token.split('/');
  const deref = (raw, list, stride) => {
    if (!raw) return -1;
    const n = Number(raw);
    return n > 0 ? n - 1 : list.length / stride + n;
  };
  const vi = deref(vs, V, 3);
  const ti = deref(ts, VT, 2);
  const ni = deref(ns, VN, 3);

  const local = group.pos.length / 3;
  group.pos.push(V[vi * 3], V[vi * 3 + 1], V[vi * 3 + 2]);
  if (ni >= 0) group.nor.push(VN[ni * 3], VN[ni * 3 + 1], VN[ni * 3 + 2]);
  if (keepUv && ti >= 0) group.uv.push(VT[ti * 2], VT[ti * 2 + 1]);
  group.map.set(token, local);
  return local;
}

const rl = readline.createInterface({ input: fs.createReadStream(input), crlfDelay: Infinity });
let lines = 0;
for await (const raw of rl) {
  if (++lines % 500000 === 0) process.stderr.write(`  ${(lines / 1e6).toFixed(1)} M lignes…\n`);
  const line = raw.trim();
  if (!line || line[0] === '#') continue;
  const sp = line.indexOf(' ');
  const key = sp < 0 ? line : line.slice(0, sp);
  const rest = sp < 0 ? '' : line.slice(sp + 1);

  switch (key) {
    case 'v': { const p = rest.split(/\s+/); V.push(+p[0], +p[1], +p[2]); break; }
    case 'vn': { const p = rest.split(/\s+/); VN.push(+p[0], +p[1], +p[2]); break; }
    case 'vt': { const p = rest.split(/\s+/); VT.push(+p[0], +p[1]); break; }
    case 'mtllib': mtllib = rest; break;
    case 'g': case 'o': startGroup(rest); break;
    case 'usemtl':
      if (!group) startGroup('');
      // Une primitive glTF ne porte qu'un matériau : un groupe qui en change
      // en cours de route est scindé, sous le même nom.
      if (group.material !== null && group.material !== rest) startGroup(group.name);
      group.material = rest;
      break;
    case 'f': {
      if (!group) startGroup('');
      const toks = rest.split(/\s+/);
      const c = toks.map(vertexOf);
      // Éventail : une face de n sommets donne n-2 triangles.
      for (let i = 1; i + 1 < c.length; i++) group.idx.push(c[0], c[i], c[i + 1]);
      break;
    }
  }
}

const mats = await readMtl(path.join(path.dirname(input), mtllib ?? ''));

// ── Filtrage ────────────────────────────────────────────────────────────────

const total = groups.reduce((n, g) => n + g.idx.length / 3, 0);
const kept = groups.filter((g) => {
  if (g.idx.length === 0) return false;
  if (only && !only.test(g.name)) return false;
  if (drop && drop.test(g.name)) return false;
  if (g.idx.length / 3 > maxTris) return false;
  return true;
});
const keptTris = kept.reduce((n, g) => n + g.idx.length / 3, 0);

console.log(`lu     : ${groups.length} groupes, ${total.toLocaleString('fr')} triangles`);
console.log(`gardé  : ${kept.length} groupes, ${keptTris.toLocaleString('fr')} triangles`
  + ` (${(keptTris / total * 100).toFixed(1)} %)`);
if (kept.length === 0) { console.error('Rien à écrire — le filtre est trop strict.'); process.exit(1); }

// ── Écriture glTF ───────────────────────────────────────────────────────────

const chunks = [];
let byteLength = 0;
const bufferViews = [];
const accessors = [];

function writeView(typed) {
  const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
  const pad = (4 - (byteLength % 4)) % 4;
  if (pad) { chunks.push(Buffer.alloc(pad)); byteLength += pad; }
  bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.length });
  chunks.push(bytes);
  byteLength += bytes.length;
  return bufferViews.length - 1;
}

function writeAccessor(typed, componentType, type, count, withBounds) {
  const a = { bufferView: writeView(typed), componentType, count, type };
  if (withBounds) {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < typed.length; i += 3) {
      for (let d = 0; d < 3; d++) {
        if (typed[i + d] < min[d]) min[d] = typed[i + d];
        if (typed[i + d] > max[d]) max[d] = typed[i + d];
      }
    }
    a.min = min; a.max = max;
  }
  accessors.push(a);
  return accessors.length - 1;
}

const matIndex = new Map();
const materials = [];
for (const g of kept) {
  const key = g.material ?? '__default';
  if (matIndex.has(key)) continue;
  const m = mats.get(g.material) ?? { colour: [0.82, 0.82, 0.84], opacity: 1 };
  matIndex.set(key, materials.length);
  materials.push({
    name: String(key),
    pbrMetallicRoughness: {
      baseColorFactor: [...m.colour, m.opacity],
      metallicFactor: 0,
      roughnessFactor: 0.85,
    },
    ...(m.opacity < 1 ? { alphaMode: 'BLEND' } : {}),
    doubleSided: true,
  });
}

const meshes = [];
const nodes = [];
for (const g of kept) {
  const pos = new Float32Array(g.pos);
  const attributes = { POSITION: writeAccessor(pos, 5126, 'VEC3', pos.length / 3, true) };
  if (g.nor.length === g.pos.length) {
    attributes.NORMAL = writeAccessor(new Float32Array(g.nor), 5126, 'VEC3', g.nor.length / 3, false);
  }
  if (keepUv && g.uv.length / 2 === g.pos.length / 3) {
    attributes.TEXCOORD_0 = writeAccessor(new Float32Array(g.uv), 5126, 'VEC2', g.uv.length / 2, false);
  }
  // Deux octets par indice suffisent en dessous de 65 536 sommets, ce qui est
  // le cas de presque tous les groupes.
  const vertexCount = pos.length / 3;
  const indices = vertexCount < 65536
    ? writeAccessor(new Uint16Array(g.idx), 5123, 'SCALAR', g.idx.length, false)
    : writeAccessor(new Uint32Array(g.idx), 5125, 'SCALAR', g.idx.length, false);

  meshes.push({
    name: g.name,
    primitives: [{ attributes, indices, material: matIndex.get(g.material ?? '__default') }],
  });
  nodes.push({ mesh: meshes.length - 1, name: g.name });
}

const bin = Buffer.concat(chunks);
const gltf = {
  asset: { version: '2.0', generator: 'Owlnest obj2glb' },
  scene: 0,
  scenes: [{ nodes: nodes.map((_, i) => i) }],
  nodes, meshes, materials, accessors, bufferViews,
  buffers: [{ byteLength: bin.length }],
};

const jsonBuf = Buffer.from(JSON.stringify(gltf), 'utf8');
const jsonPad = Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20);
const binPad = Buffer.alloc((4 - (bin.length % 4)) % 4, 0);

const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonBuf.length + jsonPad.length + 8 + bin.length + binPad.length, 8);

const jsonHeader = Buffer.alloc(8);
jsonHeader.writeUInt32LE(jsonBuf.length + jsonPad.length, 0);
jsonHeader.writeUInt32LE(0x4e4f534a, 4);

const binHeader = Buffer.alloc(8);
binHeader.writeUInt32LE(bin.length + binPad.length, 0);
binHeader.writeUInt32LE(0x004e4942, 4);

fs.writeFileSync(output, Buffer.concat([header, jsonHeader, jsonBuf, jsonPad, binHeader, bin, binPad]));

const before = fs.statSync(input).size;
const after = fs.statSync(output).size;
console.log(`écrit  : ${output}`);
console.log(`         ${(before / 1e6).toFixed(1)} Mo → ${(after / 1e6).toFixed(2)} Mo (${(after / before * 100).toFixed(1)} %)`);
