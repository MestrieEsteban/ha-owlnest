/**
 * Poser d'un coup les appareils de chaque pièce.
 *
 * Une pièce du plan qui porte le nom d'une pièce de Home Assistant (« Salon »,
 * « salon », « Salón ») reçoit ses lampes, capteurs et prises, répartis dans
 * son contour. L'utilisateur n'a plus qu'à ajuster : c'est le chemin le plus
 * court entre un plan dessiné et une carte qui sert.
 */
import { pointInPolygon, type Pt } from './geometry';

/** Un nom comparable : minuscules, sans accents ni espaces superflus. */
export function normalizeName(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Pièce du plan → pièce de Home Assistant du même nom. */
export function matchRooms(
  rooms: { id: string; name: string }[],
  areas: { id: string; name: string }[],
): Map<string, string> {
  const byName = new Map(areas.map((a) => [normalizeName(a.name), a.id]));
  const out = new Map<string, string>();
  for (const r of rooms) {
    const id = byName.get(normalizeName(r.name));
    if (id) out.set(r.id, id);
  }
  return out;
}

const DOMAINS = new Set(['light', 'switch', 'fan', 'cover', 'climate', 'media_player', 'lock', 'binary_sensor', 'sensor']);
const BINARY = new Set(['door', 'window', 'opening', 'garage_door', 'motion', 'occupancy', 'presence', 'moisture', 'smoke']);
const SENSOR = new Set(['temperature', 'humidity', 'co2', 'carbon_dioxide', 'pm25', 'illuminance']);

/**
 * Un appareil qui a sa place sur la carte : ce qu'on regarde ou commande d'un
 * coup d'œil. Les capteurs techniques (batterie, signal, tension) restent dans
 * Home Assistant.
 */
export function placeable(entityId: string, attrs: Record<string, unknown> = {}): boolean {
  const domain = entityId.split('.')[0];
  if (!DOMAINS.has(domain)) return false;
  const dc = String(attrs.device_class ?? '');
  if (domain === 'binary_sensor') return BINARY.has(dc);
  if (domain === 'sensor') return SENSOR.has(dc);
  return true;
}

/**
 * `n` points bien répartis à l'intérieur d'un contour, en retrait des murs.
 * Une grille de plus en plus fine jusqu'à avoir assez de points, puis on en
 * garde `n` régulièrement espacés dans l'ordre de la grille.
 */
export function spreadPoints(poly: Pt[], n: number, inset = 0.5): Pt[] {
  if (n <= 0 || poly.length < 3) return [];
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of poly) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  const inside = (p: Pt) => pointInPolygon(p, poly)
    && [[inset, 0], [-inset, 0], [0, inset], [0, -inset]].every(([dx, dy]) => pointInPolygon({ x: p.x + dx, y: p.y + dy }, poly));
  for (let k = 2; k <= 12; k++) {
    const pts: Pt[] = [];
    for (let i = 0; i < k; i++) {
      for (let j = 0; j < k; j++) {
        const p = { x: x0 + ((i + 0.5) / k) * (x1 - x0), y: y0 + ((j + 0.5) / k) * (y1 - y0) };
        if (inside(p)) pts.push(p);
      }
    }
    if (pts.length >= n) {
      const out: Pt[] = [];
      for (let m = 0; m < n; m++) out.push(pts[Math.floor(((m + 0.5) * pts.length) / n)]);
      return out;
    }
  }
  // Pièce trop étroite pour le retrait : tout au centre de gravité des sommets.
  const c = { x: poly.reduce((s, p) => s + p.x, 0) / poly.length, y: poly.reduce((s, p) => s + p.y, 0) / poly.length };
  return Array.from({ length: n }, () => ({ ...c }));
}

/**
 * Une seule entité par appareil et par domaine : une télé vue par deux
 * intégrations sur le même appareil (DLNA et la sienne) n'a qu'une pastille.
 * Un capteur se départage aussi par ce qu'il mesure : la température et
 * l'humidité d'un même boîtier gardent chacune la leur. Les entités sans
 * appareil passent toutes. L'ordre est gardé.
 */
export function onePerDevice(
  ids: readonly string[],
  deviceOf: (id: string) => string | null | undefined,
  deviceClassOf: (id: string) => unknown = () => undefined,
): string[] {
  const seen = new Set<string>();
  return ids.filter((id) => {
    const dev = deviceOf(id);
    if (!dev) return true;
    const domain = id.split('.')[0];
    const measure = domain === 'sensor' || domain === 'binary_sensor' ? String(deviceClassOf(id) ?? id) : '';
    const key = `${dev}|${domain}|${measure}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
