/**
 * Libellé d'une puce `when` / `openWhen`.
 *
 * Les valeurs découvertes (états connus du domaine) peuvent passer par
 * `labelOf` (traduction via descripteur). Une saisie libre doit rester brute :
 * sinon `stateLabel` réécrit « on » en « Allumé », ou pire affiche un attribut
 * courant (température, position…) à la place de la valeur stockée.
 */
export function stateValueChipLabel(
  value: string,
  discovered: readonly string[],
  labelOf?: (value: string) => string,
): string {
  if (labelOf && discovered.includes(value)) return labelOf(value);
  return value;
}
