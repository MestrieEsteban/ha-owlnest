/**
 * Aspect des pastilles : traverser les murs, et laisser voir le modèle
 * à travers le disque. L'icône ne passe pas par ici.
 *
 * Absent sur l'ancre = le réglage de la carte. Absent sur la carte = le
 * comportement d'origine (visible à travers les murs, disque opaque).
 *
 * Qui est caché par un mur se décide dans le tampon de profondeur
 * (`pin-sprite.ts`), plus par un rayon contre le modèle.
 */

/** En dessous, l'icône flotte sans disque. Au-dessus, le disque est plein. */
export const PIN_OPACITY_MIN = 0.45;
export const PIN_OPACITY_MAX = 1;

/** Les trois crans du panneau. Pas un curseur : le choix se lit d'un coup. */
export const PIN_DISC = {
  solid: 1,
  soft: 0.72,
  glass: PIN_OPACITY_MIN,
} as const;

export type PinDiscStep = keyof typeof PIN_DISC;

export interface PinLook {
  throughWalls: boolean;
  /** 1 : disque opaque. Vers `PIN_OPACITY_MIN` : le modèle se voit derrière. */
  opacity: number;
}

/** Ce que la carte a enregistré, complété par le comportement d'origine. */
export function cardPinLook(saved?: { throughWalls?: boolean; opacity?: number } | null): PinLook {
  return {
    throughWalls: saved?.throughWalls !== false,
    opacity: clampPinOpacity(saved?.opacity ?? PIN_OPACITY_MAX),
  };
}

/**
 * L'ancre gagne quand elle a un avis. `opacity` absent, ou non numérique,
 * laisse la carte décider — un `0` explicite serait un disque invisible,
 * donc on le ramène au plancher.
 */
export function resolvePinLook(
  card: PinLook,
  anchor?: { throughWalls?: boolean; opacity?: number } | null,
): PinLook {
  return {
    throughWalls: typeof anchor?.throughWalls === 'boolean' ? anchor.throughWalls : card.throughWalls,
    opacity: typeof anchor?.opacity === 'number' ? clampPinOpacity(anchor.opacity) : card.opacity,
  };
}

export function clampPinOpacity(v: number): number {
  if (!Number.isFinite(v)) return PIN_OPACITY_MAX;
  return Math.min(PIN_OPACITY_MAX, Math.max(PIN_OPACITY_MIN, v));
}

/** Le cran le plus proche, pour rallumer le bon bouton. */
export function pinDiscStep(opacity: number): PinDiscStep {
  let best: PinDiscStep = 'solid';
  let gap = Infinity;
  for (const step of Object.keys(PIN_DISC) as PinDiscStep[]) {
    const d = Math.abs(PIN_DISC[step] - opacity);
    if (d < gap) { gap = d; best = step; }
  }
  return best;
}

/**
 * Marge devant l'ancre, vers la caméra.
 *
 * La pastille est posée sur son objet (abat-jour, meuble). Sans ce décalage,
 * le test de profondeur la rejetterait contre sa propre surface. Un mur
 * est bien plus loin. L'unité est celle du modèle.
 */
export function hostMargin(span: number): number {
  const s = Number.isFinite(span) && span > 0 ? span : 1;
  return Math.max(s * 0.015, 0.08);
}
