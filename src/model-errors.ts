/**
 * model-errors.ts — diagnostic des échecs de chargement du modèle.
 *
 * Séparé de `model.ts` pour rester sans dépendance : ces fonctions sont du
 * texte et des nombres, elles se testent sans three.js ni navigateur.
 */

/**
 * Code HTTP d'une erreur de chargement, ou `null` si l'échec n'est pas HTTP
 * (réseau coupé, fichier illisible).
 *
 * three.js expose le code de deux façons selon la version : un objet `HttpError`
 * portant la réponse, ou un simple message. On lit les deux — le message est le
 * seul recours quand le chargeur enveloppe l'erreur.
 */
export function httpStatus(err: unknown): number | null {
  const status = (err as { response?: { status?: unknown } })?.response?.status;
  if (typeof status === 'number') return status;

  const message = String((err as { message?: unknown })?.message ?? err ?? '');
  const match = /responded with (\d{3})\b/.exec(message);
  return match ? Number(match[1]) : null;
}

/**
 * Message affiché dans la carte.
 *
 * « Échec du chargement » seul ne distingue pas un chemin faux d'un serveur en
 * panne, alors que la marche à suivre n'est pas la même. Le code HTTP suffit à
 * trancher, et sa présence permet de chercher l'erreur ailleurs.
 */
export function modelErrorMessage(err: unknown): string {
  const status = httpStatus(err);
  if (status === null) return 'Échec du chargement du modèle';
  if (status === 404) return 'Modèle introuvable (404) — vérifiez le chemin';
  if (status === 401 || status === 403) return `Accès refusé au modèle (${status})`;
  if (status >= 500) return `Le serveur n'a pas pu fournir le modèle (${status})`;
  return `Échec du chargement du modèle (${status})`;
}

/**
 * Recopie l'URL avec un paramètre que le cache ne connaît pas.
 *
 * Le fragment est préservé et replacé en fin d'URL : il n'est jamais envoyé au
 * serveur, mais le perdre changerait l'adresse demandée.
 */
export function bustCache(url: string, token: string = String(Date.now())): string {
  const hash = url.indexOf('#');
  const base = hash === -1 ? url : url.slice(0, hash);
  const suffix = hash === -1 ? '' : url.slice(hash);
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}owlnest_cb=${token}${suffix}`;
}

/**
 * Un 404 mérite-t-il une seconde tentative ?
 *
 * Home Assistant sert ses 404 avec `Cache-Control: public, max-age=2678400`.
 * Un chemin de modèle corrigé reste donc en échec pendant trente et un jours :
 * le navigateur répond depuis son cache sans jamais redemander au serveur, et
 * rien ne le laisse deviner côté utilisateur — le fichier est bien là.
 *
 * On ne réessaie que sur 404, et une seule fois : c'est un cas déjà en échec,
 * la requête supplémentaire ne coûte rien quand tout va bien.
 */
export function shouldRetryUncached(err: unknown): boolean {
  return httpStatus(err) === 404;
}
