/**
 * Valeur d'un capteur telle que Home Assistant l'affiche : avec les
 * décimales choisies (sur l'appareil dans Owlnest, sinon dans HA), et la
 * virgule française. Sans réglage, un arrondi qui se lit : « 16,2 » plutôt
 * que « 16.23 », « 1013 » plutôt que « 1013.25 ».
 */

/**
 * `precision` : décimales imposées (Owlnest puis HA). Sans elles, une
 * décimale au plus, aucune au-delà de 100, deux pour une petite valeur
 * (0,05 kWh garde son sens). Un texte qui n'est pas un nombre passe tel quel.
 */
export function formatSensor(raw: string, lang: string, precision?: number): string {
  const s = raw.trim();
  if (!/^[-+]?\d*[.,]?\d+(e[-+]?\d+)?$/i.test(s)) return raw;
  const num = Number(s.replace(',', '.'));
  if (!Number.isFinite(num)) return raw;
  const locale = lang === 'fr' ? 'fr-FR' : 'en-GB';
  if (precision !== undefined) {
    return num.toLocaleString(locale, { minimumFractionDigits: precision, maximumFractionDigits: precision, useGrouping: false });
  }
  const abs = Math.abs(num);
  const max = abs >= 100 ? 0 : abs >= 1 || abs === 0 ? 1 : 2;
  return num.toLocaleString(locale, { maximumFractionDigits: max, useGrouping: false });
}
