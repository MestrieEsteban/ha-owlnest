/**
 * cards/types.ts — Scene card type system.
 *
 * Replaces the free-form Panel3D / PanelBlock builder with typed templates.
 * Three templates for V1: room, entity, info.
 */

export type SceneCardType = 'room' | 'entity' | 'info';

export type SceneCardSize = 'small' | 'medium' | 'large';

/** World-space width in metres for each size preset */
export const CARD_SCALE: Record<SceneCardSize, number> = {
  small:  0.6,
  medium: 1.0,
  large:  1.5,
};

/** Canvas height / width ratio for each template type */
export const CARD_ASPECT: Record<SceneCardType, number> = {
  room:   1.0,
  entity: 0.72,
  info:   0.42,
};

/** Default accent colour for each template */
export const CARD_DEFAULT_ACCENT: Record<SceneCardType, string> = {
  room:   '#7dd3fc',
  entity: '#86efac',
  info:   '#fbbf24',
};

/** Labels for UI display */
export const CARD_TYPE_LABELS: Record<SceneCardType, string> = {
  room:   'Pièce',
  entity: 'Entité',
  info:   'Info',
};

// ── Base ────────────────────────────────────────────────────────────────────

interface SceneCardBase {
  id: string;
  type: SceneCardType;
  name: string;
  position: [number, number, number];
  visible?: boolean;            // default true
  size?: SceneCardSize;         // default 'medium'
  accentColor?: string;         // overrides template default
}

// ── Room card ───────────────────────────────────────────────────────────────

/**
 * Summarises a room: optional icon, name, and up to 4 entity states.
 * Ideal for labelling a space with the most relevant information.
 */
export interface RoomCard extends SceneCardBase {
  type: 'room';
  icon?: string;              // emoji or short text (e.g. "🛋️")
  entities?: string[];        // entity_ids to display (max 4)
  show?: {
    name?: boolean;           // default true
    icon?: boolean;           // default true  (when icon is set)
    entities?: boolean;       // default true  (when entities are set)
  };
}

// ── Entity card ─────────────────────────────────────────────────────────────

/**
 * Focuses on a single entity: large state value with optional action button.
 * Best for sensors, switches, or any single-entity interaction.
 */
export interface EntityCard extends SceneCardBase {
  type: 'entity';
  entity_id: string;
  label?: string;             // overrides entity name derived from entity_id
  show?: {
    label?: boolean;          // default true
    state?: boolean;          // default true
    unit?: boolean;           // default true  (when unit_of_measurement exists)
    button?: boolean;         // default false
  };
  action?: {
    domain: string;
    service: string;
    service_data?: Record<string, unknown>;
  };
}

// ── Info card ───────────────────────────────────────────────────────────────

/**
 * Static contextual label: icon + title + optional subtitle.
 * Non-interactive. Ideal for annotating spaces or objects in the scene.
 */
export interface InfoCard extends SceneCardBase {
  type: 'info';
  icon?: string;
  subtitle?: string;
  color?: string;             // icon/text colour (falls back to accentColor)
  show?: {
    icon?: boolean;           // default true  (when icon is set)
    name?: boolean;           // default true
    subtitle?: boolean;       // default true  (when subtitle is set)
  };
}

// ── Union ───────────────────────────────────────────────────────────────────

export type SceneCard = RoomCard | EntityCard | InfoCard;
