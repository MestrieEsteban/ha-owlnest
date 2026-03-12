/**
 * rules/engine.ts — Pure evaluation functions for Owlnest rules.
 *
 * No Three.js imports. No side effects.
 * All functions are deterministic given the same hass state.
 */

import type { Hass } from '../types';
import type { EntityCondition, OwlnestRule } from './types';

// ── Condition evaluation ──────────────────────────────────────────────────────

/**
 * Evaluate a single EntityCondition against current HA states.
 * Returns true if the condition is met.
 */
export function evalCondition(cond: EntityCondition, hass: Hass): boolean {
  const entityState = hass.states[cond.entity_id];
  if (!entityState) return false;

  const raw: unknown = cond.attribute
    ? entityState.attributes[cond.attribute]
    : entityState.state;

  const actual = raw ?? '';
  const expected = cond.value;

  let result: boolean;
  switch (cond.operator) {
    case 'eq':       result = String(actual) === String(expected); break;
    case 'neq':      result = String(actual) !== String(expected); break;
    case 'contains': result = String(actual).includes(String(expected)); break;
    case 'gt':       result = Number(actual) >  Number(expected); break;
    case 'lt':       result = Number(actual) <  Number(expected); break;
    case 'gte':      result = Number(actual) >= Number(expected); break;
    case 'lte':      result = Number(actual) <= Number(expected); break;
    default:         result = false;
  }
  return cond.negate ? !result : result;
}

// ── Trigger detection ─────────────────────────────────────────────────────────

/**
 * Returns true if the rule's trigger has fired given the state transition.
 * prevStates maps entity_id → previous state string.
 */
export function triggerFired(
  rule: OwlnestRule,
  prevStates: Map<string, string>,
  hass: Hass,
): boolean {
  const t = rule.trigger;

  if (t.type === 'entity_state') {
    const current = hass.states[t.entity_id]?.state;
    const prev    = prevStates.get(t.entity_id);

    if (current === undefined) return false;

    // Must be an actual state change
    if (current === prev) return false;

    // If `from` is specified, previous state must match
    if (t.from !== undefined && prev !== t.from) return false;

    // If `to` is specified, new state must match
    if (t.to !== undefined && current !== t.to) return false;

    return true;
  }

  return false;
}

// ── Conditions gate ───────────────────────────────────────────────────────────

/**
 * Returns true if ALL conditions pass (AND logic).
 * Returns true when conditions array is empty or absent.
 */
export function conditionsMet(rule: OwlnestRule, hass: Hass): boolean {
  if (!rule.conditions?.length) return true;
  return rule.conditions.every((c) => evalCondition(c, hass));
}
