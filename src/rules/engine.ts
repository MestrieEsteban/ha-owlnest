/**
 * rules/engine.ts — évaluation des règles de scène.
 *
 * Aucun import Three.js, aucun accès au DOM : le moteur reçoit un état et rend
 * une liste d'actions. C'est ce qui le rend testable hors navigateur, et les
 * tests de `rules/engine.test.mjs` en dépendent.
 *
 * L'état interne (états précédents, minuteries `for`, dernier déclenchement) est
 * porté par l'instance plutôt que par l'appelant : les durées et les
 * anti-rebonds sont intrinsèquement temporels et n'ont pas de sens sans mémoire.
 */

import type { Hass, HassState } from '../types';
import type {
  Action, Condition, EntityCondition, OwlnestRule, TimeCondition, Trigger,
} from './types';
import { normalizeRule } from './types';

// ── Utilitaires temps ────────────────────────────────────────────────────────

/** « HH:MM » en minutes depuis minuit, ou `null` si illisible. */
export function parseHHMM(value: string | undefined): number | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

const minutesOfDay = (d: Date) => d.getHours() * 60 + d.getMinutes();

/**
 * La plage peut franchir minuit : « après 22:00 et avant 06:00 » est vraie à
 * 23 h comme à 2 h. Un test naïf `after <= t && t <= before` échouerait.
 */
export function withinWindow(nowMin: number, after: number | null, before: number | null): boolean {
  if (after === null && before === null) return true;
  if (after !== null && before !== null) {
    return after <= before
      ? nowMin >= after && nowMin <= before
      : nowMin >= after || nowMin <= before;
  }
  if (after !== null) return nowMin >= after;
  return nowMin <= before!;
}

// ── Conditions ───────────────────────────────────────────────────────────────

const isEntityCondition = (c: Condition): c is EntityCondition => c.type !== 'time';

export function evalEntityCondition(cond: EntityCondition, hass: Hass): boolean {
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

export function evalTimeCondition(cond: TimeCondition, now: Date): boolean {
  return withinWindow(minutesOfDay(now), parseHHMM(cond.after), parseHHMM(cond.before));
}

export function evalCondition(cond: Condition, hass: Hass, now: Date = new Date()): boolean {
  return isEntityCondition(cond)
    ? evalEntityCondition(cond, hass)
    : evalTimeCondition(cond, now);
}

/** Rétrocompatibilité : `visibleIf` sur les ancres et les cartes. */
export function conditionsMet(rule: OwlnestRule, hass: Hass, now: Date = new Date()): boolean {
  const conditions = rule.conditions ?? [];
  if (!conditions.length) return true;
  const logic = rule.logic ?? 'and';
  return logic === 'or'
    ? conditions.some((c) => evalCondition(c, hass, now))
    : conditions.every((c) => evalCondition(c, hass, now));
}

// ── Valeur numérique d'un déclencheur ────────────────────────────────────────

/** Clé de mémorisation d'une valeur numérique. */
const numKey = (entityId: string, attribute?: string) => `${entityId}|${attribute ?? ''}`;

function numericValue(st: HassState | undefined, attribute?: string): number | null {
  if (!st) return null;
  const raw = attribute ? st.attributes[attribute] : st.state;
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
  return Number.isFinite(n) ? n : null;
}

/** Le déclencheur numérique est-il « dans sa plage » à cet instant ? */
function inNumericRange(t: { above?: number; below?: number }, value: number | null): boolean {
  if (value === null) return false;
  if (t.above !== undefined && !(value > t.above)) return false;
  if (t.below !== undefined && !(value < t.below)) return false;
  return t.above === undefined && t.below === undefined ? false : true;
}

// ── Moteur ───────────────────────────────────────────────────────────────────

export class RuleEngine {
  /** États précédents, limités aux entités citées par les règles. */
  private _prev = new Map<string, string>();
  /**
   * Valeurs numériques précédentes, par entité et attribut.
   *
   * Mémoriser la seule chaîne d'état ne suffit pas : un déclencheur visant
   * `current_temperature` compare un attribut, et le relire dans l'état courant
   * donnerait toujours la valeur nouvelle — le franchissement serait invisible.
   */
  private _prevNum = new Map<string, number | null>();
  /** Depuis quand un déclencheur `for` est satisfait, par clé de déclencheur. */
  private _since = new Map<string, number>();
  /** Déclencheurs `for` déjà partis, pour ne pas répéter à chaque frame. */
  private _fired = new Set<string>();
  /** Dernier déclenchement de chaque règle, pour l'anti-rebond. */
  private _lastFired = new Map<string, number>();
  /** Minutes du jour à la dernière évaluation, pour les déclencheurs horaires. */
  private _lastMinute: number | null = null;
  private _seeded = false;

  /** Vrai une fois le premier instantané pris — avant, aucune règle ne part. */
  get seeded() { return this._seeded; }

  /** Oublie tout : changement de scène, sortie du mode édition. */
  reset() {
    this._prev.clear();
    this._prevNum.clear();
    this._since.clear();
    this._fired.clear();
    this._lastFired.clear();
    this._lastMinute = null;
    this._seeded = false;
  }

  /**
   * Évalue les règles et rend les actions à exécuter, dans l'ordre.
   *
   * Le premier appel ne fait que mémoriser l'état : sans cela, toutes les
   * portes déjà ouvertes déclencheraient au chargement de la page.
   */
  evaluate(rules: OwlnestRule[], hass: Hass, now: Date = new Date(), nowMs = Date.now()): Action[] {
    const normalized = rules.map(normalizeRule).filter((r) => r.enabled !== false);
    const watched = new Set<string>();
    /** Couples entité/attribut suivis en valeur numérique. */
    const numeric: Array<{ entity_id: string; attribute?: string }> = [];
    for (const r of normalized) {
      for (const t of r.triggers ?? []) {
        if (t.type === 'time') continue;
        watched.add(t.entity_id);
        if (t.type === 'numeric_state') numeric.push({ entity_id: t.entity_id, attribute: t.attribute });
      }
    }

    if (!this._seeded) {
      this._snapshot(hass, watched, numeric);
      this._lastMinute = minutesOfDay(now);
      this._seeded = true;
      return [];
    }

    const out: Action[] = [];
    const nowMin = minutesOfDay(now);

    for (const rule of normalized) {
      if (!rule.actions?.length) continue;

      const fired = (rule.triggers ?? []).some((t, i) =>
        this._triggerFired(`${rule.id}#${i}`, t, hass, nowMs, nowMin));
      if (!fired) continue;

      if (!conditionsMet(rule, hass, now)) continue;

      // Anti-rebond : un capteur qui oscille ne doit pas partir en rafale.
      const cooldownMs = (rule.cooldown ?? 0) * 1000;
      if (cooldownMs > 0) {
        const last = this._lastFired.get(rule.id);
        if (last !== undefined && nowMs - last < cooldownMs) continue;
      }
      this._lastFired.set(rule.id, nowMs);

      out.push(...rule.actions);
    }

    this._snapshot(hass, watched, numeric);
    this._lastMinute = nowMin;
    return out;
  }

  // ── Interne ────────────────────────────────────────────────────────────────

  private _snapshot(
    hass: Hass,
    watched: Set<string>,
    numeric: Array<{ entity_id: string; attribute?: string }>,
  ) {
    // Seules les entités citées sont mémorisées : suivre les 469 entités d'une
    // installation à chaque mise à jour ne servait à rien.
    this._prev.clear();
    for (const id of watched) {
      const st = hass.states[id];
      if (st) this._prev.set(id, st.state);
    }

    this._prevNum.clear();
    for (const n of numeric) {
      this._prevNum.set(numKey(n.entity_id, n.attribute), numericValue(hass.states[n.entity_id], n.attribute));
    }
  }

  private _triggerFired(
    key: string, t: Trigger, hass: Hass, nowMs: number, nowMin: number,
  ): boolean {
    if (t.type === 'time') {
      const at = parseHHMM(t.at);
      if (at === null || this._lastMinute === null) return false;
      // Franchissement de la minute cible depuis la dernière évaluation, en
      // tolérant le passage de minuit.
      const crossed = this._lastMinute <= nowMin
        ? at > this._lastMinute && at <= nowMin
        : at > this._lastMinute || at <= nowMin;
      return crossed;
    }

    const st = hass.states[t.entity_id];
    if (!st) return false;

    if (t.type === 'entity_state') {
      const matchesTarget =
        (t.to === undefined || st.state === t.to) &&
        (t.from === undefined || this._prev.get(t.entity_id) === t.from);

      if (t.for) return this._held(key, matchesTarget, t.for, nowMs);

      const prev = this._prev.get(t.entity_id);
      if (prev === undefined || prev === st.state) return false;
      if (t.from !== undefined && prev !== t.from) return false;
      if (t.to !== undefined && st.state !== t.to) return false;
      return true;
    }

    // numeric_state
    const value = numericValue(st, t.attribute);
    const inside = inNumericRange(t, value);

    if (t.for) return this._held(key, inside, t.for, nowMs);

    // Sans durée : on ne part qu'à l'entrée dans la plage, pas tant qu'on y est.
    const k = numKey(t.entity_id, t.attribute);
    const prevValue = this._prevNum.has(k) ? (this._prevNum.get(k) ?? null) : null;
    const wasInside = inNumericRange(t, prevValue);
    return inside && !wasInside;
  }

  /**
   * Gère un déclencheur à durée : part une seule fois lorsque la condition est
   * restée vraie assez longtemps, et se réarme dès qu'elle redevient fausse.
   */
  private _held(key: string, satisfied: boolean, seconds: number, nowMs: number): boolean {
    if (!satisfied) {
      this._since.delete(key);
      this._fired.delete(key);
      return false;
    }
    const since = this._since.get(key);
    if (since === undefined) {
      this._since.set(key, nowMs);
      return false;
    }
    if (this._fired.has(key)) return false;
    if (nowMs - since < seconds * 1000) return false;
    this._fired.add(key);
    return true;
  }
}
