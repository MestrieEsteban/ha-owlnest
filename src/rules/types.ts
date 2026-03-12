/**
 * rules/types.ts — Owlnest scene automation types.
 *
 * Two families:
 *   - EntityCondition: passive, declarative (used in visibleIf on cards/anchors)
 *   - OwlnestRule:     active, event-driven (trigger → conditions → actions)
 */

// ── Condition ────────────────────────────────────────────────────────────────

export type ConditionOperator = 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains';

/**
 * Evaluable against hass.states.
 * If `attribute` is absent, evaluates against the entity's `state` string.
 */
export interface EntityCondition {
  entity_id: string;
  attribute?: string;
  operator: ConditionOperator;
  value: string | number;
  negate?: boolean;  // if true, result is inverted — used by "Masquer si" mode in UI
}

// ── Trigger ──────────────────────────────────────────────────────────────────

/**
 * Fires when the state of `entity_id` changes.
 * `from` / `to` are optional state filters.
 */
export interface EntityStateTrigger {
  type: 'entity_state';
  entity_id: string;
  from?: string;   // only fire when coming from this state
  to?: string;     // only fire when going to this state
}

export type Trigger = EntityStateTrigger;

// ── Actions ──────────────────────────────────────────────────────────────────

export interface GoToViewAction {
  type: 'go_to_view';
  view_id: string;
}

export interface ShowCardAction {
  type: 'show_card';
  card_id: string;
}

export interface HideCardAction {
  type: 'hide_card';
  card_id: string;
}

export interface CallServiceAction {
  type: 'call_service';
  domain: string;
  service: string;
  service_data?: Record<string, unknown>;
}

export type Action =
  | GoToViewAction
  | ShowCardAction
  | HideCardAction
  | CallServiceAction;

// ── Rule ─────────────────────────────────────────────────────────────────────

/**
 * A complete scene automation rule.
 * Evaluated in the hass setter whenever entity states change.
 */
export interface OwlnestRule {
  id: string;
  label?: string;
  enabled?: boolean;          // default true when absent
  trigger: Trigger;
  conditions?: EntityCondition[]; // AND logic in V1
  actions: Action[];
}
