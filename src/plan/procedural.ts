/**
 * plan/procedural.ts — les objets du quotidien fabriqués dans le code.
 *
 * Aucun pack gratuit n'a d'aquarium ou de tableau : quelques volumes simples
 * suffisent. Leurs matières portent les noms que le reste du catalogue sait
 * recolorer (`carpet` pour un tissu, `wood` pour un bois), et ils se règlent
 * à toutes les tailles comme les autres meubles.
 */

import * as THREE from 'three';

export const PROCEDURAL_PREFIX = 'p_';

const mat = (name: string, color: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...extra });
  m.name = name;
  return m;
};

function box(parent: THREE.Object3D, m: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y + h / 2, z);
  parent.add(mesh);
  return mesh;
}

/** Une toile abstraite, toujours la même : quelques aplats de couleur. */
function canvasTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 192;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#f3ede2'; ctx.fillRect(0, 0, 256, 192);
  const shapes: [string, number, number, number, number][] = [
    ['#e07a5f', 20, 30, 110, 90], ['#3d405b', 140, 20, 90, 60], ['#81b29a', 120, 95, 115, 75], ['#f2cc8f', 35, 130, 70, 45],
  ];
  for (const [col, x, y, w, h] of shapes) { ctx.fillStyle = col; ctx.fillRect(x, y, w, h); }
  ctx.strokeStyle = '#3d405b'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(80, 75, 28, 0, Math.PI * 2); ctx.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const BUILDERS: Record<string, () => THREE.Group> = {
  /** Aquarium de 100 L sur son meuble. */
  p_aquarium: () => {
    const g = new THREE.Group();
    const wood = mat('wood', '#5b4636');
    box(g, wood, 0.9, 0.7, 0.4, 0, 0, 0);
    const glass = mat('glass', '#d6f0f7', { transparent: true, opacity: 0.25, roughness: 0.05, depthWrite: false });
    box(g, glass, 0.88, 0.48, 0.38, 0, 0.7, 0);
    box(g, mat('water', '#3aa6c9', { transparent: true, opacity: 0.45, roughness: 0.1, depthWrite: false }), 0.86, 0.42, 0.36, 0, 0.71, 0);
    box(g, mat('sand', '#e3cf9b'), 0.86, 0.05, 0.36, 0, 0.71, 0);
    const plant = mat('plant', '#3f8f4a');
    for (const [x, h] of [[-0.3, 0.3], [-0.22, 0.22], [0.25, 0.34], [0.32, 0.2]] as const) box(g, plant, 0.04, h, 0.04, x, 0.76, -0.08);
    box(g, mat('lid', '#2f343b'), 0.9, 0.04, 0.4, 0, 1.18, 0);
    const fish = mat('fish', '#ff8c3a', { emissive: '#ff6a00', emissiveIntensity: 0.2 });
    box(g, fish, 0.07, 0.03, 0.02, -0.1, 0.92, 0.05);
    box(g, fish, 0.06, 0.03, 0.02, 0.15, 0.98, -0.02);
    return g;
  },
  /** Un tableau encadré, accroché au mur. */
  p_frame: () => {
    const g = new THREE.Group();
    const wood = mat('wood', '#2f343b');
    const w = 0.8, h = 0.6, t = 0.04;
    box(g, wood, w, t, 0.03, 0, 0, 0);
    box(g, wood, w, t, 0.03, 0, h - t, 0);
    box(g, wood, t, h, 0.03, -w / 2 + t / 2, 0, 0);
    box(g, wood, t, h, 0.03, w / 2 - t / 2, 0, 0);
    const map = canvasTexture();
    box(g, new THREE.MeshStandardMaterial({ color: '#ffffff', map, roughness: 0.9 }), w - 2 * t, h - 2 * t, 0.01, 0, t, 0.005);
    return g;
  },
  /** Un miroir rond. */
  p_mirror: () => {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.03, 48), mat('wood', '#b08d57', { metalness: 0.4 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0, 0.32, 0);
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.032, 48), mat('mirror', '#dfe9ee', { metalness: 0.9, roughness: 0.05 }));
    glass.rotation.x = Math.PI / 2;
    glass.position.set(0, 0.32, 0.002);
    g.add(ring, glass);
    return g;
  },
  /** Un tapis uni, à mettre à la taille de la pièce. */
  p_rug: () => {
    const g = new THREE.Group();
    box(g, mat('carpet', '#c9c2b8', { roughness: 1 }), 2, 0.012, 1.4, 0, 0, 0);
    return g;
  },
  /** Un radiateur à ailettes. */
  p_radiator: () => {
    const g = new THREE.Group();
    const white = mat('metal', '#f2f2f0', { roughness: 0.4 });
    const n = 10;
    for (let i = 0; i < n; i++) box(g, white, 0.05, 0.55, 0.08, -0.36 + (i * 0.72) / (n - 1), 0.12, 0);
    box(g, white, 0.8, 0.03, 0.04, 0, 0.14, 0);
    box(g, white, 0.8, 0.03, 0.04, 0, 0.62, 0);
    return g;
  },
};

/** Fabrique un objet du catalogue maison, ou rien si l'identifiant n'en est pas un. */
export function buildProcedural(id: string): THREE.Group | null {
  const make = BUILDERS[id];
  if (!make) return null;
  const g = make();
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) { m.castShadow = !(m.material as THREE.Material).transparent; m.receiveShadow = true; }
  });
  return g;
}
