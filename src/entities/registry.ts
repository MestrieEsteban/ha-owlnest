/**
 * entities/registry.ts — étages, pièces, appareils et métadonnées d'entités.
 *
 * `hass.states` ne contient ni la pièce, ni l'appareil, ni le fait qu'une
 * entité soit désactivée ou purement diagnostique. Tout cela vit dans les
 * registres, qu'il faut croiser : une entité hérite de la pièce de son appareil
 * quand la sienne n'est pas renseignée.
 *
 * Deux sources possibles selon la version de HA :
 *   - `hass.areas` / `.devices` / `.entities` / `.floors`, exposés directement
 *     par le frontend récent — synchrone, gratuit ;
 *   - à défaut, les commandes WebSocket `config/*_registry/list`.
 *
 * On détecte laquelle est disponible plutôt que de la supposer.
 */

import type { Hass } from '../types';

export interface AreaInfo {
  area_id: string;
  name: string;
  floor_id?: string | null;
  icon?: string | null;
  aliases?: string[];
}

export interface FloorInfo {
  floor_id: string;
  name: string;
  level?: number | null;
}

export interface DeviceInfo {
  id: string;
  name: string;
  area_id?: string | null;
}

export interface EntityInfo {
  entity_id: string;
  /** Pièce propre à l'entité, avant héritage depuis l'appareil. */
  area_id?: string | null;
  device_id?: string | null;
  name?: string | null;
  /** 'config' | 'diagnostic' | null — les deux premières sont du bruit ici. */
  entity_category?: string | null;
  hidden: boolean;
  disabled: boolean;
  labels?: string[];
}

export interface Registry {
  floors: Map<string, FloorInfo>;
  areas: Map<string, AreaInfo>;
  devices: Map<string, DeviceInfo>;
  entities: Map<string, EntityInfo>;
  /** Vrai quand les registres ont pu être lus (sinon : repli dégradé). */
  loaded: boolean;
  /** Comment les données ont été obtenues — utile pour le diagnostic. */
  source: 'hass' | 'websocket' | 'none';
}

const EMPTY: Registry = {
  floors: new Map(),
  areas: new Map(),
  devices: new Map(),
  entities: new Map(),
  loaded: false,
  source: 'none',
};

// ── Normalisation ────────────────────────────────────────────────────────────

const asRecord = (v: unknown): Record<string, unknown> =>
  (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function toEntity(raw: Record<string, unknown>): EntityInfo | null {
  const entity_id = str(raw.entity_id);
  if (!entity_id) return null;
  return {
    entity_id,
    area_id: str(raw.area_id),
    device_id: str(raw.device_id),
    // `name` est le libellé choisi par l'utilisateur, `original_name` celui de
    // l'intégration. Le premier gagne quand il existe.
    name: str(raw.name) ?? str(raw.original_name),
    entity_category: str(raw.entity_category),
    // Le frontend expose `hidden`/`disabled` (booléens), le WebSocket
    // `hidden_by`/`disabled_by` (source de la décision, ou null).
    hidden: raw.hidden === true || raw.hidden_by != null,
    disabled: raw.disabled === true || raw.disabled_by != null,
    labels: Array.isArray(raw.labels) ? (raw.labels as string[]) : undefined,
  };
}

function toDevice(raw: Record<string, unknown>): DeviceInfo | null {
  const id = str(raw.id) ?? str(raw.device_id);
  if (!id) return null;
  return {
    id,
    name: str(raw.name_by_user) ?? str(raw.name) ?? id,
    area_id: str(raw.area_id),
  };
}

function toArea(raw: Record<string, unknown>): AreaInfo | null {
  const area_id = str(raw.area_id);
  if (!area_id) return null;
  return {
    area_id,
    name: str(raw.name) ?? area_id,
    floor_id: str(raw.floor_id),
    icon: str(raw.icon),
    aliases: Array.isArray(raw.aliases) ? (raw.aliases as string[]) : undefined,
  };
}

function toFloor(raw: Record<string, unknown>): FloorInfo | null {
  const floor_id = str(raw.floor_id);
  if (!floor_id) return null;
  return {
    floor_id,
    name: str(raw.name) ?? floor_id,
    level: typeof raw.level === 'number' ? raw.level : null,
  };
}

function indexBy<T>(items: unknown[], key: (t: T) => string, conv: (r: Record<string, unknown>) => T | null): Map<string, T> {
  const out = new Map<string, T>();
  for (const raw of items) {
    const v = conv(asRecord(raw));
    if (v) out.set(key(v), v);
  }
  return out;
}

// ── Chargement ───────────────────────────────────────────────────────────────

let _cache: Registry | null = null;
let _inFlight: Promise<Registry> | null = null;

/** Force un rechargement au prochain appel (pièce renommée, entité déplacée…). */
export function invalidateRegistry(): void {
  _cache = null;
  _inFlight = null;
}

export function cachedRegistry(): Registry {
  return _cache ?? EMPTY;
}

export async function loadRegistry(hass: Hass): Promise<Registry> {
  if (_cache) return _cache;
  if (_inFlight) return _inFlight;

  _inFlight = (async (): Promise<Registry> => {
    // 1. Le frontend expose-t-il déjà les registres ?
    if (hass.entities && hass.areas && hass.devices) {
      const reg: Registry = {
        floors: indexBy(Object.values(asRecord(hass.floors)), (f: FloorInfo) => f.floor_id, toFloor),
        areas: indexBy(Object.values(hass.areas), (a: AreaInfo) => a.area_id, toArea),
        devices: indexBy(Object.values(hass.devices), (d: DeviceInfo) => d.id, toDevice),
        entities: indexBy(Object.values(hass.entities), (e: EntityInfo) => e.entity_id, toEntity),
        loaded: true,
        source: 'hass',
      };
      _cache = reg;
      return reg;
    }

    // 2. Repli WebSocket.
    try {
      const [areas, devices, entities, floors] = await Promise.all([
        hass.callWS<unknown[]>({ type: 'config/area_registry/list' }),
        hass.callWS<unknown[]>({ type: 'config/device_registry/list' }),
        hass.callWS<unknown[]>({ type: 'config/entity_registry/list' }),
        // Les étages n'existent que depuis HA 2024.4 : leur absence ne doit pas
        // faire échouer le reste.
        hass.callWS<unknown[]>({ type: 'config/floor_registry/list' }).catch(() => []),
      ]);
      const reg: Registry = {
        floors: indexBy(floors, (f: FloorInfo) => f.floor_id, toFloor),
        areas: indexBy(areas, (a: AreaInfo) => a.area_id, toArea),
        devices: indexBy(devices, (d: DeviceInfo) => d.id, toDevice),
        entities: indexBy(entities, (e: EntityInfo) => e.entity_id, toEntity),
        loaded: true,
        source: 'websocket',
      };
      _cache = reg;
      return reg;
    } catch (err) {
      console.warn('[Owlnest] Registres indisponibles — regroupement par domaine uniquement.', err);
      _cache = { ...EMPTY, source: 'none' };
      return _cache;
    }
  })();

  try {
    return await _inFlight;
  } finally {
    _inFlight = null;
  }
}

// ── Requêtes ─────────────────────────────────────────────────────────────────

/** Pièce d'une entité, héritée de son appareil quand elle n'en a pas. */
export function areaOf(reg: Registry, entityId: string): AreaInfo | null {
  const e = reg.entities.get(entityId);
  if (!e) return null;
  if (e.area_id) return reg.areas.get(e.area_id) ?? null;
  if (e.device_id) {
    const devArea = reg.devices.get(e.device_id)?.area_id;
    if (devArea) return reg.areas.get(devArea) ?? null;
  }
  return null;
}

export function deviceOf(reg: Registry, entityId: string): DeviceInfo | null {
  const devId = reg.entities.get(entityId)?.device_id;
  return devId ? (reg.devices.get(devId) ?? null) : null;
}

export function floorOf(reg: Registry, area: AreaInfo | null): FloorInfo | null {
  return area?.floor_id ? (reg.floors.get(area.floor_id) ?? null) : null;
}

/**
 * Entité de configuration ou de diagnostic : présente dans HA, sans intérêt
 * sur un plan 3D. Masquée par défaut dans le sélecteur.
 */
export function isTechnical(reg: Registry, entityId: string): boolean {
  const e = reg.entities.get(entityId);
  if (!e) return false;
  return e.entity_category === 'config' || e.entity_category === 'diagnostic';
}

/** Nom lisible : libellé HA, sinon registre, sinon l'identifiant. */
export function displayName(reg: Registry, hass: Hass, entityId: string): string {
  const fn = hass.states[entityId]?.attributes?.friendly_name;
  if (typeof fn === 'string' && fn) return fn;
  const n = reg.entities.get(entityId)?.name;
  if (n) return n;
  return entityId.split('.')[1]?.replace(/_/g, ' ') ?? entityId;
}
