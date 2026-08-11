/**
 * scale.ts — l'unité du modèle n'est pas connue, seule son envergure l'est.
 *
 * Un plan peut arriver en mètres, en centimètres ou en pouces. Owlnest n'impose
 * rien : tout ce qui dépend d'une distance se déduit de l'envergure du modèle.
 *
 * Ce fichier ne contient que la référence commune et sa conversion, pour qu'une
 * seule valeur de calibrage existe dans le projet. La dupliquer entre les
 * lumières, la météo et le reste serait le meilleur moyen de la voir dériver.
 *
 * Voir `obsidian/Echelle du modele.md` pour la liste de ce qui s'y adapte.
 */

/**
 * Envergure supposée par les réglages d'origine, en unités de modèle.
 *
 * Les valeurs par défaut du projet — portée de lumière 8, gouttes de pluie de
 * 0,3, vitesses de chute de quelques unités par seconde — ont été choisies pour
 * une maison exprimée en mètres, donc une dizaine d'unités de large.
 */
export const REFERENCE_SPAN = 12;

/**
 * Facteur à appliquer à une grandeur exprimée en distance.
 *
 * Retourne 1 quand l'envergure est inconnue : avant le chargement du modèle,
 * mieux vaut le comportement historique qu'une valeur inventée.
 */
export function modelScale(span?: number): number {
  return span && span > 0 ? span / REFERENCE_SPAN : 1;
}
