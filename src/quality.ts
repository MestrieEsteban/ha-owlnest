/**
 * quality.ts — profils qualité/performance.
 *
 * Source unique de vérité : un niveau choisi par l'utilisateur se traduit ici en
 * paramètres de rendu concrets, plutôt que d'éparpiller des `if (low)` dans le
 * reste du code.
 *
 * Le poste de coût dominant est l'ombre des lumières d'ancres : une PointLight
 * avec `castShadow` rend la scène 6 fois (une par face de cube map), à chaque
 * frame. Huit lampes allumées = 48 passes supplémentaires. C'est le premier
 * levier, très loin devant le reste.
 */

import * as THREE from 'three';
import type { CardConfig } from './types';

export type QualityLevel = 'auto' | 'high' | 'balanced' | 'low';

export interface QualityProfile {
  /** Les lumières d'ancres projettent-elles une ombre (cube map, 6 passes). */
  anchorShadows: boolean;
  /** Résolution de la shadow map d'une lumière d'ancre. */
  anchorShadowMap: number;
  /** Résolution de la shadow map du soleil. */
  sunShadowMap: number;
  /** Filtrage des ombres — PCFSoft est le plus coûteux. */
  shadowFilter: THREE.ShadowMapType;
  /** Plafond du devicePixelRatio : ×2 = 4× de pixels à remplir. */
  maxPixelRatio: number;
  /** MSAA — coûteux en bande passante sur GPU tuilé (mobile). */
  antialias: boolean;
  /** Multiplicateur sur le nombre de particules météo. */
  particleScale: number;
  /** Largeur des textures canvas des cartes 3D. */
  cardTextureWidth: number;
  /**
   * Plafond d'images par seconde. Un dashboard mural n'a pas besoin de 60 :
   * passer à 30 divise par deux le travail GPU pendant tout mouvement.
   */
  maxFps: number;
  /**
   * Intervalle de rafraichissement des vignettes de camera, en millisecondes.
   * Une image de camera peut peser 180 Ko : a 2 s d'intervalle, c'est 90 Ko/s
   * par camera sur une tablette en Wi-Fi.
   */
  cameraRefreshMs: number;
}

export type ResolvedLevel = Exclude<QualityLevel, 'auto'>;

const PROFILES: Record<ResolvedLevel, QualityProfile> = {
  high: {
    anchorShadows: true,
    anchorShadowMap: 512,
    sunShadowMap: 2048,
    shadowFilter: THREE.PCFSoftShadowMap,
    maxPixelRatio: 2,
    antialias: true,
    particleScale: 1,
    cardTextureWidth: 1024,
    maxFps: 60,
    cameraRefreshMs: 3000,
  },
  // Les ombres d'ancres tombent dès ce niveau : c'est le gain le plus important
  // pour la perte visuelle la plus faible, le soleil continuant d'ombrer.
  balanced: {
    anchorShadows: false,
    anchorShadowMap: 256,
    sunShadowMap: 1024,
    shadowFilter: THREE.PCFShadowMap,
    maxPixelRatio: 1.5,
    antialias: true,
    particleScale: 0.6,
    cardTextureWidth: 768,
    maxFps: 45,
    cameraRefreshMs: 6000,
  },
  // PCF plutôt que BasicShadowMap : le gain de performance de Basic est
  // marginal, ses bords crénelés ne le sont pas.
  low: {
    anchorShadows: false,
    anchorShadowMap: 256,
    sunShadowMap: 1024,
    shadowFilter: THREE.PCFShadowMap,
    maxPixelRatio: 1,
    antialias: false,
    particleScale: 0.3,
    cardTextureWidth: 512,
    maxFps: 30,
    cameraRefreshMs: 12000,
  },
};

// ── Détection automatique ────────────────────────────────────────────────────

let _detected: ResolvedLevel | null = null;
let _detectionLabel = '';

/** Chaîne GPU réelle, quand le navigateur accepte de la donner. */
function gpuName(): string {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') as WebGLRenderingContext | null;
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? '') : '';
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return name;
  } catch {
    return '';
  }
}

/**
 * Devine un niveau à partir du matériel. Volontairement prudent : sur une
 * tablette murale, mieux vaut un rendu fluide et un peu plus simple qu'un rendu
 * complet à 8 fps.
 */
export function detectLevel(): ResolvedLevel {
  if (_detected) return _detected;

  const gpu = gpuName();
  const cores = navigator.hardwareConcurrency ?? 4;
  const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
  const mobileGpu = /mali|adreno|powervr|videocore|tegra|apple gpu/i.test(gpu);

  let level: ResolvedLevel;
  if (mobileGpu && cores <= 4) level = 'low';
  else if (mobileGpu) level = 'balanced';
  else if (cores <= 2) level = 'low';
  else if (cores <= 4) level = 'balanced';
  else level = 'high';

  _detected = level;
  _detectionLabel = [
    gpu || 'GPU inconnu',
    `${cores} cœurs`,
    `DPR ${dpr}`,
  ].join(' · ');
  return level;
}

/** Description lisible du matériel détecté, pour l'afficher dans l'éditeur. */
export function detectionLabel(): string {
  if (!_detected) detectLevel();
  return _detectionLabel;
}

// ── Résolution ───────────────────────────────────────────────────────────────

export function resolveLevel(level: QualityLevel | undefined): ResolvedLevel {
  if (!level || level === 'auto') return detectLevel();
  return PROFILES[level] ? level : detectLevel();
}

export function profileFor(level: QualityLevel | undefined): QualityProfile {
  return PROFILES[resolveLevel(level)];
}

/** Profil applicable à une config de carte (scène fusionnée comprise). */
export function qualityFromConfig(config: CardConfig | null): QualityProfile {
  return profileFor(config?.rendering?.quality);
}

/**
 * Signature des réglages qui exigent une reconstruction (textures, particules).
 * Permet de ne rebâtir que lorsque le niveau change réellement.
 */
export function qualityKey(config: CardConfig | null): string {
  return resolveLevel(config?.rendering?.quality);
}
