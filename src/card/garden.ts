/**
 * Le jardin : quelques arbres et buissons autour de la maison, pour qu'elle
 * ne flotte pas seule au milieu d'un aplat vert.
 *
 * Des volumes simples (un tronc, une boule ou un cône de feuillage), comme
 * la maison elle-même. Quatre maillages instanciés en tout : quatre appels de
 * dessin quel que soit le nombre d'arbres, ce qui compte sur une tablette.
 * Le tirage est fixe : les arbres sont aux mêmes places à chaque chargement.
 */
import * as THREE from 'three';

export type GardenDensity = 'none' | 'some' | 'lush';

export const GARDEN_NAME = '__owlnest_garden';

const COUNTS: Record<Exclude<GardenDensity, 'none'>, { trees: number; bushes: number }> = {
  some: { trees: 6, bushes: 9 },
  lush: { trees: 14, bushes: 22 },
};

const FOLIAGE = ['#4f7a3a', '#5f8c42', '#3f6b35', '#6c9a4a', '#567f3c'];

function rng(seed: number) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

/**
 * Un jardin autour de `house` (la boîte de la maison), posé à `groundY`, sans
 * dépasser `reach` (demi-largeur du sol, depuis le centre).
 */
export function buildGarden(house: THREE.Box3, groundY: number, reach: number, density: GardenDensity): THREE.Group | null {
  if (density === 'none') return null;
  const size = house.getSize(new THREE.Vector3());
  const center = house.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.z);
  if (!(maxDim > 0)) return null;
  // Un plan est en mètres, un export Sweet Home 3D en centimètres.
  const u = maxDim > 100 ? 100 : 1;
  const margin = 1.6 * u;
  const inner = Math.hypot(size.x, size.z) / 2 + margin;
  const outer = Math.max(inner + 2 * u, Math.min(reach * 0.92, inner + maxDim * 0.9));
  const { trees, bushes } = COUNTS[density];
  const r = rng(9173);

  // Une place libre : hors de la maison (avec sa marge), loin des autres.
  const taken: { x: number; z: number; d: number }[] = [];
  const place = (minGap: number): { x: number; z: number } | null => {
    for (let tries = 0; tries < 60; tries++) {
      const a = r() * Math.PI * 2;
      const d = inner + (outer - inner) * Math.sqrt(r());
      const x = center.x + Math.cos(a) * d, z = center.z + Math.sin(a) * d;
      if (Math.abs(x - center.x) < size.x / 2 + margin && Math.abs(z - center.z) < size.z / 2 + margin) continue;
      if (taken.some((t) => Math.hypot(t.x - x, t.z - z) < t.d + minGap)) continue;
      taken.push({ x, z, d: minGap });
      return { x, z };
    }
    return null;
  };

  const group = new THREE.Group();
  group.name = GARDEN_NAME;
  const leaves = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, flatShading: true });
  const bark = new THREE.MeshStandardMaterial({ color: '#6b4a2f', roughness: 0.95, flatShading: true });

  const trunkGeo = new THREE.CylinderGeometry(0.1 * u, 0.15 * u, 1.4 * u, 6);
  trunkGeo.translate(0, 0.7 * u, 0);
  const roundGeo = new THREE.IcosahedronGeometry(1.1 * u, 0);
  roundGeo.translate(0, 2.3 * u, 0);
  const coneGeo = new THREE.ConeGeometry(0.95 * u, 2.8 * u, 7);
  coneGeo.translate(0, 2.4 * u, 0);
  const bushGeo = new THREE.IcosahedronGeometry(0.5 * u, 0);
  bushGeo.scale(1, 0.7, 1);
  bushGeo.translate(0, 0.3 * u, 0);

  const spots: { x: number; z: number; s: number; cone: boolean }[] = [];
  for (let i = 0; i < trees; i++) {
    const p = place(2.4 * u);
    if (p) spots.push({ ...p, s: 0.75 + r() * 0.55, cone: r() < 0.4 });
  }
  const bushSpots: { x: number; z: number; s: number }[] = [];
  for (let i = 0; i < bushes; i++) {
    const p = place(0.9 * u);
    if (p) bushSpots.push({ ...p, s: 0.7 + r() * 0.7 });
  }

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), color = new THREE.Color();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const instanced = (geo: THREE.BufferGeometry, mat: THREE.Material, list: { x: number; z: number; s: number }[], tint: boolean) => {
    if (!list.length) return;
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((p, i) => {
      q.setFromAxisAngle(yAxis, r() * Math.PI * 2);
      m.compose(new THREE.Vector3(p.x, groundY, p.z), q, new THREE.Vector3(p.s, p.s, p.s));
      mesh.setMatrixAt(i, m);
      if (tint) mesh.setColorAt(i, color.set(FOLIAGE[Math.floor(r() * FOLIAGE.length)]));
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // Les instances débordent de la boîte de la géométrie seule.
    mesh.computeBoundingSphere();
    group.add(mesh);
  };
  instanced(trunkGeo, bark, spots, false);
  instanced(roundGeo, leaves, spots.filter((s) => !s.cone), true);
  instanced(coneGeo, leaves, spots.filter((s) => s.cone), true);
  instanced(bushGeo, leaves, bushSpots, true);
  return group;
}
