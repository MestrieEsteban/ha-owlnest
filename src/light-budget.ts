/**
 * light-budget.ts — choix des ancres qui éclairent vraiment la scène.
 *
 * Three.js recompile les shaders dès que le nombre de lumières *visibles*
 * change. On garde donc un ensemble fixe (`owlnestReal`) borné par le profil
 * qualité ; hors budget, seule la pastille (et les vitres la nuit) réagit.
 */

export interface LightBudgetOpts<T> {
  floorOf: (entry: T) => number;
  activeFloor: number;
  /** Allumée côté HA / intensité cible — prioritaire sur une lampe éteinte. */
  isOn: (entry: T) => boolean;
}

/**
 * Ordre d'attribution du budget : étage actif, puis allumées, puis ordre d'origine.
 * Stable : à égalité, l'indice d'entrée départage.
 */
export function rankLightBudgetEntries<T>(
  entries: readonly T[],
  opts: LightBudgetOpts<T>,
): T[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const aFloor = opts.floorOf(a.entry) === opts.activeFloor ? 0 : 1;
      const bFloor = opts.floorOf(b.entry) === opts.activeFloor ? 0 : 1;
      if (aFloor !== bFloor) return aFloor - bFloor;
      const aOn = opts.isOn(a.entry) ? 0 : 1;
      const bOn = opts.isOn(b.entry) ? 0 : 1;
      if (aOn !== bOn) return aOn - bOn;
      return a.index - b.index;
    })
    .map(({ entry }) => entry);
}
