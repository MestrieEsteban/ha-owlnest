/**
 * upload.ts — envoie un GLB à l'intégration, par morceaux.
 *
 * Home Assistant limite la taille d'une requête à quelques mégaoctets ; un
 * modèle meublé en fait des dizaines. On l'envoie donc en tranches, et chaque
 * tranche peut être renvoyée telle quelle si le réseau coupe : le serveur
 * l'écrit à sa place, il ne l'ajoute pas.
 */

/** Huit mégaoctets : sous la limite de Home Assistant, assez gros pour aller vite. */
export const CHUNK = 8 * 1024 * 1024;

/** Ce dont l'envoi a besoin de l'objet `hass` du frontend. */
export interface UploadHass {
  fetchWithAuth?: (path: string, init?: RequestInit) => Promise<Response>;
  auth?: { data?: { access_token?: string } };
}

export class UploadError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** Découpe en tranches : [début, fin) pour chaque envoi. */
export function chunks(size: number, chunk: number = CHUNK): [number, number][] {
  const out: [number, number][] = [];
  for (let start = 0; start < size; start += chunk) out.push([start, Math.min(size, start + chunk)]);
  if (!out.length) out.push([0, 0]);
  return out;
}

/** `fetchWithAuth` du frontend quand il existe, sinon le jeton en en-tête. */
function send(hass: UploadHass, path: string, init: RequestInit): Promise<Response> {
  if (hass.fetchWithAuth) return hass.fetchWithAuth(path, init);
  const token = hass.auth?.data?.access_token;
  return fetch(path, {
    ...init,
    headers: { ...(init.headers ?? {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
}

/**
 * Envoie le GLB et rend l'adresse à laquelle l'intégration le sert.
 *
 * Une tranche qui échoue sur le réseau est retentée deux fois ; un refus du
 * serveur (droits, format) remonte tout de suite : réessayer ne le changerait pas.
 */
export async function uploadGlb(
  hass: UploadHass,
  name: string,
  glb: Uint8Array,
  onProgress?: (fraction: number) => void,
): Promise<string> {
  const parts = chunks(glb.byteLength);
  let url = '';
  for (let i = 0; i < parts.length; i++) {
    const [start, end] = parts[i];
    const last = i === parts.length - 1;
    const query = `name=${encodeURIComponent(name)}&offset=${start}${last ? '&final=1' : ''}`;
    const body = glb.slice(start, end);

    let res: Response | null = null;
    for (let attempt = 0; attempt < 3 && !res; attempt++) {
      try {
        res = await send(hass, `/api/owlnest/upload?${query}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body,
        });
      } catch (err) {
        if (attempt === 2) throw err;
      }
    }
    if (!res || !res.ok) {
      let message = res ? `HTTP ${res.status}` : 'network';
      try { message = (await res!.json()).message ?? message; } catch { /* corps vide */ }
      throw new UploadError(res?.status ?? 0, message);
    }
    if (last) url = (await res.json()).url;
    onProgress?.(end / glb.byteLength);
  }
  return url;
}
