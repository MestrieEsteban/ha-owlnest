/**
 * optimize/types.ts — le vocabulaire de l'optimiseur.
 *
 * Partagé par la carte, le worker et la ligne de commande : rien ici n'importe
 * glTF-Transform ni three.js, tout voyage en JSON entre le worker et la carte.
 */

/**
 * Ce qu'une optimisation touche, et donc comment on la défait.
 *
 *   render       la façon de dessiner : le fichier reste tel quel, décocher suffit ;
 *   lossless     un nouveau fichier, sans différence visible ;
 *   destructive  un nouveau fichier qui perd du détail : l'original est gardé.
 */
export type Category = 'render' | 'lossless' | 'destructive';

export type QualityCost = 'none' | 'low' | 'medium' | 'high';

export type ParamValue = number | string | boolean;
export type Params = Record<string, ParamValue>;

export interface ParamDef {
  key: string;
  kind: 'number' | 'text' | 'select' | 'boolean';
  default: ParamValue;
  min?: number;
  max?: number;
  step?: number;
  /** `select` : valeurs possibles. */
  options?: string[];
  /** Clé i18n du libellé. */
  label: string;
}

/** Gain attendu (valeurs positives : ce qu'on économise). */
export interface Gain {
  triangles?: number;
  /** Mémoire graphique, en Mo. */
  gpuMB?: number;
  /** Poids du fichier, en Mo. */
  fileMB?: number;
  drawCalls?: number;
  /** Passes de rendu complètes économisées par image. */
  passes?: number;
  textures?: number;
  /** Part du temps d'image économisée, de 0 à 1 (modèle grossier, confirmé par le banc). */
  fpsHint?: number;
  /** Objets concernés. */
  affected?: number;
  /** Objets qui auraient été concernés, mais protégés (ancres, ouvrants, effets, animations). */
  skipped?: number;
}

// ── Rapport d'analyse ────────────────────────────────────────────────────────

export interface ModelStats {
  fileMB: number;
  triangles: number;
  primitives: number;
  meshes: number;
  nodes: number;
  materials: number;
  textures: number;
  /** Mémoire des textures une fois décodées, mipmaps comprises, en Mo. */
  textureGpuMB: number;
  /** Mémoire des sommets et indices, en Mo. */
  geometryGpuMB: number;
  doubleSided: number;
  blend: number;
  /** Matières à `KHR_materials_transmission` : une passe de rendu en plus par image. */
  transmission: number;
  /** Matières que three.js rendra en `MeshPhysicalMaterial`. */
  physical: number;
  animations: number;
  /** Mailles utilisées par plusieurs nœuds. */
  reusedMeshes: number;
  extensions: string[];
  /** Compression de la géométrie : `draco`, `meshopt` ou rien. */
  compression: 'draco' | 'meshopt' | 'none';
  /** Doublons exacts, que `dedup` fusionne. */
  duplicates?: { textures: number; materials: number; textureBytes: number; textureGpuBytes: number };
  /** Attributs de sommets que rien n'utilise (coordonnées de texture sans texture). */
  unusedAttributes?: number;
  unusedAttributeBytes?: number;
}

/** Un nœud porteur de géométrie, vu par l'analyse. */
export interface NodeInfo {
  /** Nom du nœud tel qu'exporté. */
  name: string;
  mesh: string;
  triangles: number;
  /** Rayon de la sphère englobante, en unités du modèle. */
  radius: number;
  /** Nœud animé, ou sous un nœud animé. */
  animated: boolean;
  /** Protection : `name` (nom à garder), `geometry` (triangles désignés), ou rien. */
  protect?: 'name' | 'geometry';
  materials: string[];
}

export interface TextureInfo {
  name: string;
  width: number;
  height: number;
  mime: string;
  bytes: number;
  /** Emplacements dans les matières : `baseColorTexture`, `normalTexture`… */
  slots: string[];
  /** Nœuds qui l'affichent (noms d'origine). */
  nodes: string[];
}

export interface MaterialInfo {
  name: string;
  physical: string[];
  transmission: number;
  doubleSided: boolean;
  blend: boolean;
}

export interface ModelReport {
  stats: ModelStats;
  nodes: NodeInfo[];
  textures: TextureInfo[];
  materials: MaterialInfo[];
  /** Envergure du modèle (plus grand côté de la boîte), en unités du modèle. */
  span: number;
  /** Unités par mètre, estimées d'après l'envergure (1, ou 100 pour un export en centimètres). */
  unitsPerMeter: number;
  /** Noms protégés retrouvés dans le modèle, pour les afficher. */
  protectedNames: string[];
}

// ── Protection ───────────────────────────────────────────────────────────────

/**
 * Ce que l'optimiseur ne doit pas casser.
 *
 * Les noms viennent de la scène (tels que three.js les nomme : espaces en
 * `_`, points retirés) ou de motifs donnés par l'utilisateur.
 */
export interface ProtectSpec {
  /** Nœuds ou mailles désignés par leur nom : ni fusion, ni instanciation, ni renommage. */
  names: string[];
  /** Mailles désignées par un triangle : leurs indices ne doivent pas bouger. */
  geometry: string[];
  /** Motifs (regex, sans casse) : protection `name`. */
  patterns: string[];
}

// ── Sélection et résultats ───────────────────────────────────────────────────

export interface Choice {
  enabled: boolean;
  params: Params;
}

export type Selection = Record<string, Choice>;

/** Ce qu'une optimisation du modèle a réellement fait. */
export interface OpResult {
  id: string;
  affected: number;
  skipped: number;
  note?: string;
  ms: number;
}

/** Le banc d'essai : une orbite complète, toujours la même. */
export interface BenchResult {
  durationMs: number;
  frames: number;
  avgFps: number;
  p95FrameMs: number;
  worstFrameMs: number;
  calls: number;
  triangles: number;
  gpuMB: number;
  pixelRatio: number;
  width: number;
  height: number;
  /** Plafond d'images par seconde levé pendant la mesure. */
  uncapped: boolean;
  label?: string;
  date: string;
  model?: string;
  userAgent?: string;
}
