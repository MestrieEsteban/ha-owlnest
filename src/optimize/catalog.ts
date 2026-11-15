/**
 * catalog.ts — les optimisations proposées, une par ligne de l'interface.
 *
 * Chacune dit ce qu'elle coûte (perte de qualité), ce qu'elle rapporte
 * (estimé sur le modèle réel, voir `estimate`) et comment l'appliquer :
 *
 *  - rendu (A) : des champs `rendering.*` posés dans la scène, appliqués par
 *    la carte (render-apply.ts) ;
 *  - modèle (B, C) : une transformation du fichier, faite par le worker ou la
 *    ligne de commande (model-ops.ts), jamais par la carte elle-même.
 *
 * Les gains sont des ordres de grandeur. Les triangles, textures et appels se
 * comptent exactement ; les images par seconde se mesurent, au banc d'essai.
 */

import type { RenderingConfig } from '../types';
import { compilePatterns } from './protected';
import type {
  Category, Choice, Gain, ModelReport, NodeInfo, ParamDef, Params, QualityCost, Selection, TextureInfo,
} from './types';

export interface EstimateContext {
  /** devicePixelRatio de l'appareil. */
  dpr: number;
  /** Plafonds en vigueur (profil qualité). */
  maxPixelRatio: number;
  maxFps: number;
}

export interface OptimizationDef {
  id: string;
  category: Category;
  cost: QualityCost;
  /** Supprime des noms d'objets : la scène ne peut plus les désigner. */
  structural?: boolean;
  /** Clés i18n. */
  title: string;
  hint: string;
  params: ParamDef[];
  estimate(r: ModelReport, p: Params, ctx: EstimateContext): Gain;
  /** Rendu : les champs que l'option pose, cochée. */
  render?: (p: Params) => Partial<RenderingConfig>;
  /** Rendu : l'option telle que la scène l'a enregistrée, ou `null` si elle est décochée. */
  read?: (r: RenderingConfig) => Params | null;
  /** Indisponible dans le navigateur (outil externe requis). */
  cliOnly?: boolean;
}

// ── Mesures ────────────────────────────────────────────────────────────────

const MB = 1024 * 1024;

/** Mémoire d'une texture décodée en RVBA, mipmaps comprises (un tiers de plus). */
export function textureGpuBytes(w: number, h: number): number {
  return w * h * 4 * 4 / 3;
}

/** Dimensions après réduction à `max` pixels de côté, proportions gardées. */
export function fitWithin(w: number, h: number, max: number): [number, number] {
  const side = Math.max(w, h);
  if (side <= max) return [w, h];
  const k = max / side;
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
}

/** Octets de fichier par triangle, en moyenne : de quoi chiffrer un allègement de géométrie. */
function fileBytesPerTriangle(r: ModelReport): number {
  const tex = r.textures.reduce((s, t) => s + t.bytes, 0);
  return r.stats.triangles ? Math.max(0, r.stats.fileMB * MB - tex) / r.stats.triangles : 0;
}

function gpuBytesPerTriangle(r: ModelReport): number {
  return r.stats.triangles ? (r.stats.geometryGpuMB * MB) / r.stats.triangles : 0;
}

/**
 * Part du temps d'image due aux triangles retirés : une tablette passe environ
 * la moitié d'une image sur la géométrie d'un modèle aussi chargé, le reste
 * sur les pixels. Un ordre de grandeur, que le banc d'essai confirme.
 */
function triangleShare(r: ModelReport, removed: number): number {
  return r.stats.triangles ? 0.5 * (removed / r.stats.triangles) : 0;
}

const num = (p: Params, k: string, d: number) => (typeof p[k] === 'number' ? p[k] as number : Number(p[k] ?? d) || d);
const str = (p: Params, k: string, d = '') => (typeof p[k] === 'string' ? p[k] as string : d);

const matches = (res: RegExp[], n: NodeInfo) => res.some((re) => re.test(n.name) || re.test(n.mesh));

/** Les murs et sols d'un export Sweet Home 3D portent les ancres : jamais simplifiés (voir import/lighten.ts). */
export const STRUCTURE = /^(wall|room|ground|floor|ceiling|level)|^sweethome3d_|frame/i;

/** Textures affichées uniquement par des nœuds retenus. */
function texturesOnlyOn(r: ModelReport, keep: (n: string) => boolean): TextureInfo[] {
  return r.textures.filter((t) => t.nodes.length > 0 && t.nodes.every(keep));
}

function shrinkTextures(list: TextureInfo[], max: number): Gain {
  let gpu = 0, file = 0, affected = 0;
  for (const t of list) {
    const [w, h] = fitWithin(t.width, t.height, max);
    if (w === t.width && h === t.height) continue;
    affected++;
    gpu += textureGpuBytes(t.width, t.height) - textureGpuBytes(w, h);
    file += t.bytes * (1 - (w * h) / (t.width * t.height));
  }
  return { gpuMB: gpu / MB, fileMB: file / MB, affected, textures: 0 };
}

// ── Le catalogue ───────────────────────────────────────────────────────────

export const CATALOG: OptimizationDef[] = [
  // ── A. Rendu ────────────────────────────────────────────────────────────
  {
    id: 'A1', category: 'render', cost: 'low', title: 'optA1', hint: 'optA1Hint', params: [],
    estimate: (r) => {
      const share = r.stats.materials ? r.stats.physical / r.stats.materials : 0;
      return { affected: r.stats.physical, fpsHint: Math.min(0.15, 0.25 * share) };
    },
    render: () => ({ physical_materials: false }),
    read: (rr) => (rr.physical_materials === false ? {} : null),
  },
  {
    id: 'A2', category: 'render', cost: 'low', title: 'optA2', hint: 'optA2Hint', params: [],
    // three.js redessine toute la scène opaque dans une texture dès qu'un
    // objet transmissif est visible : une passe complète en plus par image.
    estimate: (r) => (r.stats.transmission
      ? { affected: r.stats.transmission, passes: 1, fpsHint: 0.3 }
      : { affected: 0 }),
    render: () => ({ transmission: false }),
    read: (rr) => (rr.transmission === false ? {} : null),
  },
  {
    id: 'A3', category: 'render', cost: 'low', title: 'optA3', hint: 'optA3Hint',
    params: [
      { key: 'policy', kind: 'select', default: 'selective', options: ['selective', 'sun-only', 'none'], label: 'optParamPolicy' },
      { key: 'minSize', kind: 'number', default: 0.04, min: 0, max: 0.2, step: 0.01, label: 'optParamMinSize' },
      { key: 'exclude', kind: 'text', default: '', label: 'optParamExclude' },
    ],
    estimate: (r, p) => {
      const policy = str(p, 'policy', 'selective');
      if (policy === 'none') return { affected: r.nodes.length, triangles: r.stats.triangles, passes: 1, fpsHint: 0.1 };
      if (policy === 'sun-only') return { affected: 0, passes: 0, fpsHint: 0.05 };
      const min = num(p, 'minSize', 0.04) * r.span;
      const ex = compilePatterns(str(p, 'exclude'));
      const out = r.nodes.filter((n) => n.radius * 2 < min || matches(ex, n));
      const tris = out.reduce((s, n) => s + n.triangles, 0);
      return { affected: out.length, triangles: tris, fpsHint: 0.1 * (tris / Math.max(1, r.stats.triangles)) };
    },
    render: (p) => ({
      shadow_policy: str(p, 'policy', 'selective') as RenderingConfig['shadow_policy'],
      shadow_min_size: num(p, 'minSize', 0.04),
      shadow_exclude: compilePatterns(str(p, 'exclude')).length ? str(p, 'exclude').split(',').map((s) => s.trim()).filter(Boolean) : undefined,
    }),
    read: (rr) => (rr.shadow_policy && rr.shadow_policy !== 'all'
      ? { policy: rr.shadow_policy, minSize: rr.shadow_min_size ?? 0.04, exclude: (rr.shadow_exclude ?? []).join(', ') }
      : null),
  },
  {
    id: 'A4', category: 'render', cost: 'medium', title: 'optA4', hint: 'optA4Hint', params: [],
    // Les ombres ne se recalculent déjà qu'au changement : on gagne la passe
    // refaite à chaque pas du soleil.
    estimate: () => ({ passes: 1, fpsHint: 0.02 }),
    render: () => ({ sun_shadow_static: true }),
    read: (rr) => (rr.sun_shadow_static ? {} : null),
  },
  {
    id: 'A5', category: 'render', cost: 'none', title: 'optA5', hint: 'optA5Hint',
    params: [{ key: 'cell', kind: 'number', default: 4, min: 1, max: 20, step: 0.5, label: 'optParamCell' }],
    estimate: (r, p) => {
      // De près, la caméra ne voit qu'une partie de la maison : on compte la
      // part des cellules hors champ, au plus la moitié.
      const cells = Math.max(1, (r.span / r.unitsPerMeter) / num(p, 'cell', 4)) ** 2;
      const share = Math.min(0.5, 1 - 1 / Math.sqrt(cells));
      return { affected: r.nodes.filter((n) => !n.animated).length, triangles: Math.round(r.stats.triangles * share * 0.5), fpsHint: share * 0.3 };
    },
    render: (p) => ({ spatial_batching: num(p, 'cell', 4) }),
    read: (rr) => (rr.spatial_batching ? { cell: rr.spatial_batching } : null),
  },
  {
    id: 'A6', category: 'render', cost: 'medium', title: 'optA6', hint: 'optA6Hint',
    params: [
      { key: 'dpr', kind: 'number', default: 1.25, min: 0.75, max: 3, step: 0.25, label: 'optParamDpr' },
      { key: 'fps', kind: 'number', default: 30, min: 15, max: 60, step: 5, label: 'optParamFps' },
    ],
    estimate: (_r, p, ctx) => {
      const before = Math.min(ctx.dpr, ctx.maxPixelRatio);
      const after = Math.min(before, num(p, 'dpr', 1.25));
      // Les pixels à remplir varient comme le carré du ratio.
      const pixels = before > 0 ? 1 - (after / before) ** 2 : 0;
      return { fpsHint: Math.max(0, 0.5 * pixels) };
    },
    render: (p) => ({ max_pixel_ratio: num(p, 'dpr', 1.25), max_fps: num(p, 'fps', 30) }),
    read: (rr) => (rr.max_pixel_ratio || rr.max_fps ? { dpr: rr.max_pixel_ratio ?? 2, fps: rr.max_fps ?? 60 } : null),
  },
  {
    id: 'A7', category: 'render', cost: 'medium', title: 'optA7', hint: 'optA7Hint',
    params: [{ key: 'patterns', kind: 'text', default: '', label: 'optParamPatterns' }],
    estimate: (r, p) => {
      const res = compilePatterns(str(p, 'patterns'));
      if (!res.length) return { affected: 0 };
      const hit = r.nodes.filter((n) => matches(res, n));
      const kept = hit.filter((n) => !n.protect);
      const tris = kept.reduce((s, n) => s + n.triangles, 0);
      return {
        affected: kept.length, skipped: hit.length - kept.length, triangles: tris,
        drawCalls: kept.length, fpsHint: triangleShare(r, tris),
      };
    },
    render: (p) => ({ hidden_patterns: str(p, 'patterns').split(',').map((s) => s.trim()).filter(Boolean) }),
    read: (rr) => (rr.hidden_patterns?.length ? { patterns: rr.hidden_patterns.join(', ') } : null),
  },
  {
    id: 'A8', category: 'render', cost: 'low', title: 'optA8', hint: 'optA8Hint',
    params: [
      { key: 'max', kind: 'number', default: 512, min: 64, max: 4096, step: 64, label: 'optParamMaxSize' },
      { key: 'anisotropy', kind: 'number', default: 1, min: 1, max: 16, step: 1, label: 'optParamAnisotropy' },
    ],
    estimate: (r, p) => shrinkTextures(r.textures, num(p, 'max', 512)),
    render: (p) => ({ max_texture_size: num(p, 'max', 512), texture_anisotropy: num(p, 'anisotropy', 1) }),
    read: (rr) => (rr.max_texture_size || rr.texture_anisotropy
      ? { max: rr.max_texture_size ?? 4096, anisotropy: rr.texture_anisotropy ?? 1 } : null),
  },

  // ── B. Modèle, sans perte ───────────────────────────────────────────────
  {
    id: 'B1', category: 'lossless', cost: 'none', title: 'optB1', hint: 'optB1Hint', params: [],
    estimate: (r) => {
      const d = r.stats.duplicates;
      if (!d) return { affected: 0 };
      return { textures: d.textures, affected: d.textures + d.materials, fileMB: d.textureBytes / MB, gpuMB: d.textureGpuBytes / MB, drawCalls: 0 };
    },
  },
  {
    id: 'B2', category: 'lossless', cost: 'none', title: 'optB2', hint: 'optB2Hint',
    params: [{ key: 'min', kind: 'number', default: 3, min: 2, max: 20, step: 1, label: 'optParamMinInstances' }],
    estimate: (r, p) => {
      const min = num(p, 'min', 3);
      const groups = new Map<string, NodeInfo[]>();
      for (const n of r.nodes) {
        if (n.animated || n.protect) continue;
        const g = groups.get(n.mesh);
        if (g) g.push(n); else groups.set(n.mesh, [n]);
      }
      let calls = 0, affected = 0;
      for (const g of groups.values()) {
        if (g.length < min) continue;
        affected += g.length;
        calls += (g.length - 1) * Math.max(1, g[0].materials.length);
      }
      return { affected, drawCalls: calls };
    },
  },
  {
    id: 'B3', category: 'lossless', cost: 'none', title: 'optB3', hint: 'optB3Hint',
    params: [{ key: 'bits', kind: 'number', default: 14, min: 12, max: 16, step: 1, label: 'optParamBits' }],
    estimate: (r) => {
      // La quantification allège la géométrie en mémoire d'environ 40 %.
      // Meshopt se décode bien plus vite que Draco, mais pèse à peu près le
      // double sans compression HTTP, que Home Assistant n'applique pas à ses
      // fichiers statiques : depuis Draco, le fichier grossit (gain négatif).
      const geo = Math.max(0, r.stats.fileMB - r.textures.reduce((s, t) => s + t.bytes, 0) / MB);
      const gpuMB = r.stats.geometryGpuMB * 0.4;
      const fileMB = r.stats.compression === 'none' ? geo * 0.65 : r.stats.compression === 'draco' ? -geo * 1.2 : 0;
      return { affected: r.stats.primitives, gpuMB, fileMB };
    },
  },
  {
    id: 'B4', category: 'lossless', cost: 'none', title: 'optB4', hint: 'optB4Hint', params: [],
    estimate: (r) => ({ affected: r.stats.unusedAttributes ?? 0, gpuMB: (r.stats.unusedAttributeBytes ?? 0) / MB }),
  },

  // ── C. Modèle, avec perte ───────────────────────────────────────────────
  {
    id: 'C1', category: 'destructive', cost: 'medium', title: 'optC1', hint: 'optC1Hint',
    params: [
      { key: 'pattern', kind: 'text', default: 'mujer|chica|hombre|person|figur', label: 'optParamPattern' },
      { key: 'target', kind: 'number', default: 30000, min: 2000, max: 200000, step: 1000, label: 'optParamTarget' },
    ],
    estimate: (r, p) => {
      const res = compilePatterns(str(p, 'pattern'));
      const target = num(p, 'target', 30000);
      const hit = r.nodes.filter((n) => matches(res, n) && n.triangles > target);
      const kept = hit.filter((n) => n.protect !== 'geometry');
      const tris = kept.reduce((s, n) => s + (n.triangles - target), 0);
      return {
        affected: kept.length, skipped: hit.length - kept.length, triangles: tris,
        fileMB: (tris * fileBytesPerTriangle(r)) / MB, gpuMB: (tris * gpuBytesPerTriangle(r)) / MB,
        fpsHint: triangleShare(r, tris),
      };
    },
  },
  {
    id: 'C2', category: 'destructive', cost: 'medium', title: 'optC2', hint: 'optC2Hint',
    params: [
      { key: 'above', kind: 'number', default: 5000, min: 500, max: 100000, step: 500, label: 'optParamAbove' },
      { key: 'ratio', kind: 'number', default: 0.5, min: 0.1, max: 0.9, step: 0.05, label: 'optParamRatio' },
      { key: 'exclude', kind: 'text', default: 'mujer|chica|hombre|person|figur', label: 'optParamExclude' },
    ],
    estimate: (r, p) => {
      const above = num(p, 'above', 5000), ratio = num(p, 'ratio', 0.5);
      const ex = compilePatterns(str(p, 'exclude'));
      const hit = r.nodes.filter((n) => n.triangles > above && !matches(ex, n) && !STRUCTURE.test(n.name));
      const kept = hit.filter((n) => n.protect !== 'geometry');
      const tris = Math.round(kept.reduce((s, n) => s + n.triangles * (1 - ratio), 0));
      return {
        affected: kept.length, skipped: hit.length - kept.length, triangles: tris,
        fileMB: (tris * fileBytesPerTriangle(r)) / MB, gpuMB: (tris * gpuBytesPerTriangle(r)) / MB,
        fpsHint: triangleShare(r, tris),
      };
    },
  },
  {
    id: 'C3', category: 'destructive', cost: 'low', title: 'optC3', hint: 'optC3Hint',
    params: [
      { key: 'pattern', kind: 'text', default: 'libro|book|portada|cover|lomo|spine', label: 'optParamPattern' },
      { key: 'max', kind: 'number', default: 128, min: 16, max: 1024, step: 16, label: 'optParamMaxSize' },
    ],
    estimate: (r, p) => {
      const res = compilePatterns(str(p, 'pattern'));
      const byName = new Map(r.nodes.map((n) => [n.name, n]));
      const list = texturesOnlyOn(r, (name) => {
        const n = byName.get(name);
        return !!n && matches(res, n);
      });
      return shrinkTextures(list, num(p, 'max', 128));
    },
  },
  {
    id: 'C4', category: 'destructive', cost: 'low', title: 'optC4', hint: 'optC4Hint',
    params: [{ key: 'max', kind: 'number', default: 256, min: 32, max: 2048, step: 32, label: 'optParamMaxSize' }],
    estimate: (r, p) => shrinkTextures(r.textures.filter(isDetailMap), num(p, 'max', 256)),
  },
  {
    id: 'C5', category: 'destructive', cost: 'medium', title: 'optC5', hint: 'optC5Hint', params: [], cliOnly: true,
    // ETC1S : environ un octet par pixel en mémoire, contre quatre.
    estimate: (r) => ({ affected: r.stats.textures, gpuMB: r.stats.textureGpuMB * 0.75 }),
  },
  {
    id: 'C6', category: 'destructive', cost: 'low', title: 'optC6', hint: 'optC6Hint', params: [],
    estimate: (r) => {
      const share = r.stats.materials ? r.stats.physical / r.stats.materials : 0;
      return {
        affected: r.stats.physical + r.stats.transmission,
        passes: r.stats.transmission ? 1 : 0,
        fpsHint: Math.min(0.45, 0.25 * share + (r.stats.transmission ? 0.3 : 0)),
      };
    },
  },
  {
    id: 'C7', category: 'destructive', cost: 'none', structural: true, title: 'optC7', hint: 'optC7Hint', params: [],
    estimate: (r) => {
      const free = r.nodes.filter((n) => !n.protect && !n.animated);
      const mats = new Set(free.flatMap((n) => n.materials));
      const prims = free.reduce((s, n) => s + Math.max(1, n.materials.length), 0);
      return { affected: free.length, drawCalls: Math.max(0, prims - mats.size) };
    },
  },
];

/** Cartes de détail : normales, rugosité-métal, occlusion. */
export function isDetailMap(t: TextureInfo): boolean {
  return t.slots.length > 0 && t.slots.every((s) => /normal|metallicRoughness|occlusion|clearcoatNormal|clearcoatRoughness|specular|sheenRoughness/i.test(s));
}

export const byId = (id: string) => CATALOG.find((d) => d.id === id);

export function defaultParams(def: OptimizationDef): Params {
  return Object.fromEntries(def.params.map((p) => [p.key, p.default]));
}

// ── Préréglages ────────────────────────────────────────────────────────────

export type PresetName = 'safe' | 'balanced' | 'aggressive';

const PRESETS: Record<PresetName, Record<string, Params>> = {
  safe: {
    A2: {}, A3: { policy: 'selective' }, B1: {}, B3: {}, B4: {},
  },
  balanced: {
    A1: {}, A2: {}, A3: { policy: 'selective' }, A5: {}, A6: { dpr: 1.25, fps: 30 },
    B1: {}, B2: {}, B3: {}, B4: {},
    C1: { target: 40000 }, C3: { max: 256 }, C4: { max: 256 },
  },
  aggressive: {
    A1: {}, A2: {}, A3: { policy: 'selective', minSize: 0.06 }, A4: {}, A5: {}, A6: { dpr: 1, fps: 30 }, A8: { max: 512 },
    B1: {}, B2: {}, B3: {}, B4: {},
    C1: { target: 25000 }, C2: { ratio: 0.5 }, C3: { max: 128 }, C4: { max: 256 }, C6: {}, C7: {},
  },
};

/** Une sélection complète : tout décoché, sauf ce que le préréglage coche. */
export function presetSelection(name: PresetName): Selection {
  const picked = PRESETS[name];
  return Object.fromEntries(CATALOG.map((d) => [d.id, {
    enabled: d.id in picked && !d.cliOnly,
    params: { ...defaultParams(d), ...(picked[d.id] ?? {}) },
  }]));
}

/** La sélection qui correspond aux réglages de rendu enregistrés ; le modèle décoché. */
export function selectionFromRendering(r: RenderingConfig | undefined): Selection {
  return Object.fromEntries(CATALOG.map((d) => {
    const read = d.read?.(r ?? {}) ?? null;
    const choice: Choice = { enabled: read !== null, params: { ...defaultParams(d), ...(read ?? {}) } };
    return [d.id, choice];
  }));
}

/** Champs de rendu à toujours écrire : une option décochée efface les siens. */
const RENDER_KEYS: (keyof RenderingConfig)[] = [
  'physical_materials', 'transmission', 'shadow_policy', 'shadow_min_size', 'shadow_exclude', 'sun_shadow_static',
  'spatial_batching', 'hidden_patterns', 'max_pixel_ratio', 'max_fps', 'max_texture_size', 'texture_anisotropy',
];

/** Les champs `rendering.*` d'une sélection, décochés compris (à `undefined`). */
export function renderingFromSelection(sel: Selection): Partial<RenderingConfig> {
  const out: Partial<RenderingConfig> = Object.fromEntries(RENDER_KEYS.map((k) => [k, undefined]));
  for (const d of CATALOG) {
    const c = sel[d.id];
    if (d.render && c?.enabled) Object.assign(out, d.render(c.params));
  }
  return out;
}

/** Les optimisations du modèle cochées, dans l'ordre d'application. */
export function modelOps(sel: Selection): { id: string; params: Params }[] {
  return CATALOG
    .filter((d) => d.category !== 'render' && !d.cliOnly && sel[d.id]?.enabled)
    .map((d) => ({ id: d.id, params: sel[d.id].params }));
}

export function hasDestructive(sel: Selection): boolean {
  return CATALOG.some((d) => d.category === 'destructive' && sel[d.id]?.enabled);
}

/** Somme des gains, pour la ligne de synthèse. */
export function sumGains(gains: Gain[]): Gain {
  const out: Gain = {};
  for (const g of gains) {
    for (const k of Object.keys(g) as (keyof Gain)[]) {
      if (k === 'fpsHint') out.fpsHint = 1 - (1 - (out.fpsHint ?? 0)) * (1 - (g.fpsHint ?? 0));
      else out[k] = (out[k] ?? 0) + (g[k] ?? 0);
    }
  }
  return out;
}
