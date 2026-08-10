/**
 * Tests du moteur de règles.
 *
 * Lancés par `npm test`, qui compile d'abord les modules purs vers un dossier
 * temporaire (voir scripts/test.mjs) : le moteur n'a besoin ni de DOM ni de
 * navigateur, c'est précisément ce qui le rend testable.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { RuleEngine, parseHHMM, withinWindow, evalCondition } from './engine.mjs';
import { normalizeRule, referencedEntities } from './types.mjs';

// ── Aides ────────────────────────────────────────────────────────────────────

const hassOf = (states) => ({
  states: Object.fromEntries(
    Object.entries(states).map(([id, v]) => [
      id,
      typeof v === 'object' && v !== null && 'state' in v ? v : { state: String(v), attributes: {} },
    ]),
  ),
  callService() {},
  callWS: async () => ({}),
});

const at = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(2026, 0, 15, h, m, 0, 0);
  return d;
};

const rule = (over = {}) => ({
  id: 'r1',
  triggers: [{ type: 'entity_state', entity_id: 'binary_sensor.porte', to: 'on' }],
  actions: [{ type: 'toast', message: 'ok' }],
  ...over,
});

// ── Amorçage ─────────────────────────────────────────────────────────────────

test('le premier appel ne déclenche rien, il mémorise', () => {
  const e = new RuleEngine();
  // Porte déjà ouverte au chargement : rien ne doit partir.
  const out = e.evaluate([rule()], hassOf({ 'binary_sensor.porte': 'on' }));
  assert.deepEqual(out, []);
  assert.equal(e.seeded, true);
});

test('déclenche sur transition vers l\'état cible', () => {
  const e = new RuleEngine();
  e.evaluate([rule()], hassOf({ 'binary_sensor.porte': 'off' }));
  const out = e.evaluate([rule()], hassOf({ 'binary_sensor.porte': 'on' }));
  assert.equal(out.length, 1);
  assert.equal(out[0].type, 'toast');
});

test('ne déclenche pas quand l\'état ne change pas', () => {
  const e = new RuleEngine();
  e.evaluate([rule()], hassOf({ 'binary_sensor.porte': 'off' }));
  e.evaluate([rule()], hassOf({ 'binary_sensor.porte': 'on' }));
  const again = e.evaluate([rule()], hassOf({ 'binary_sensor.porte': 'on' }));
  assert.deepEqual(again, []);
});

test('respecte `from`', () => {
  const r = rule({ triggers: [{ type: 'entity_state', entity_id: 'x.y', from: 'a', to: 'b' }] });
  const e = new RuleEngine();
  e.evaluate([r], hassOf({ 'x.y': 'c' }));
  assert.deepEqual(e.evaluate([r], hassOf({ 'x.y': 'b' })), [], 'venait de c, pas de a');
  e.evaluate([r], hassOf({ 'x.y': 'a' }));
  assert.equal(e.evaluate([r], hassOf({ 'x.y': 'b' })).length, 1);
});

test('une règle désactivée ne part pas', () => {
  const r = rule({ enabled: false });
  const e = new RuleEngine();
  e.evaluate([r], hassOf({ 'binary_sensor.porte': 'off' }));
  assert.deepEqual(e.evaluate([r], hassOf({ 'binary_sensor.porte': 'on' })), []);
});

// ── Déclencheurs multiples (OU) ──────────────────────────────────────────────

test('plusieurs déclencheurs se comportent en OU', () => {
  const r = rule({
    triggers: [
      { type: 'entity_state', entity_id: 'binary_sensor.p1', to: 'on' },
      { type: 'entity_state', entity_id: 'binary_sensor.p2', to: 'on' },
    ],
  });
  const e = new RuleEngine();
  e.evaluate([r], hassOf({ 'binary_sensor.p1': 'off', 'binary_sensor.p2': 'off' }));
  assert.equal(e.evaluate([r], hassOf({ 'binary_sensor.p1': 'off', 'binary_sensor.p2': 'on' })).length, 1);
});

// ── Durée (`for`) ────────────────────────────────────────────────────────────

test('`for` attend que l\'état soit maintenu', () => {
  const r = rule({ triggers: [{ type: 'entity_state', entity_id: 'b.porte', to: 'on', for: 300 }] });
  const e = new RuleEngine();
  const t0 = 1_000_000;
  e.evaluate([r], hassOf({ 'b.porte': 'off' }), at('10:00'), t0);
  // Ouverture : la minuterie démarre, rien ne part.
  assert.deepEqual(e.evaluate([r], hassOf({ 'b.porte': 'on' }), at('10:00'), t0 + 1000), []);
  // 4 minutes : toujours trop tôt.
  assert.deepEqual(e.evaluate([r], hassOf({ 'b.porte': 'on' }), at('10:04'), t0 + 240_000), []);
  // 5 minutes révolues : ça part.
  assert.equal(e.evaluate([r], hassOf({ 'b.porte': 'on' }), at('10:05'), t0 + 302_000).length, 1);
  // Et une seule fois.
  assert.deepEqual(e.evaluate([r], hassOf({ 'b.porte': 'on' }), at('10:06'), t0 + 400_000), []);
});

test('`for` se réarme quand la condition redevient fausse', () => {
  const r = rule({ triggers: [{ type: 'entity_state', entity_id: 'b.porte', to: 'on', for: 60 }] });
  const e = new RuleEngine();
  const t0 = 5_000_000;
  e.evaluate([r], hassOf({ 'b.porte': 'off' }), at('10:00'), t0);
  e.evaluate([r], hassOf({ 'b.porte': 'on' }), at('10:00'), t0 + 1000);
  assert.equal(e.evaluate([r], hassOf({ 'b.porte': 'on' }), at('10:02'), t0 + 70_000).length, 1);
  // Refermée puis réouverte : le compte repart de zéro.
  e.evaluate([r], hassOf({ 'b.porte': 'off' }), at('10:03'), t0 + 80_000);
  e.evaluate([r], hassOf({ 'b.porte': 'on' }), at('10:03'), t0 + 81_000);
  assert.deepEqual(e.evaluate([r], hassOf({ 'b.porte': 'on' }), at('10:03'), t0 + 100_000), [],
    'moins de 60 s depuis la réouverture');
  assert.equal(e.evaluate([r], hassOf({ 'b.porte': 'on' }), at('10:04'), t0 + 150_000).length, 1);
});

// ── Seuil numérique ──────────────────────────────────────────────────────────

test('seuil numérique : déclenche à l\'entrée dans la plage', () => {
  const r = rule({ triggers: [{ type: 'numeric_state', entity_id: 'sensor.t', above: 25 }] });
  const e = new RuleEngine();
  e.evaluate([r], hassOf({ 'sensor.t': '20' }));
  assert.equal(e.evaluate([r], hassOf({ 'sensor.t': '26' })).length, 1);
  // Toujours au-dessus : pas de nouveau déclenchement.
  assert.deepEqual(e.evaluate([r], hassOf({ 'sensor.t': '27' })), []);
  // Redescend puis remonte : ça repart.
  e.evaluate([r], hassOf({ 'sensor.t': '22' }));
  assert.equal(e.evaluate([r], hassOf({ 'sensor.t': '30' })).length, 1);
});

test('seuil numérique : plage above + below', () => {
  const r = rule({ triggers: [{ type: 'numeric_state', entity_id: 'sensor.h', above: 40, below: 60 }] });
  const e = new RuleEngine();
  e.evaluate([r], hassOf({ 'sensor.h': '30' }));
  assert.deepEqual(e.evaluate([r], hassOf({ 'sensor.h': '70' })), [], 'au-dessus de la plage');
  assert.equal(e.evaluate([r], hassOf({ 'sensor.h': '50' })).length, 1);
});

test('seuil numérique : un attribut peut être visé', () => {
  const r = rule({
    triggers: [{ type: 'numeric_state', entity_id: 'climate.x', attribute: 'current_temperature', above: 22 }],
  });
  const e = new RuleEngine();
  e.evaluate([r], hassOf({ 'climate.x': { state: 'heat', attributes: { current_temperature: 20 } } }));
  const out = e.evaluate([r], hassOf({ 'climate.x': { state: 'heat', attributes: { current_temperature: 23 } } }));
  assert.equal(out.length, 1);
});

test('seuil numérique : une valeur illisible ne déclenche pas', () => {
  const r = rule({ triggers: [{ type: 'numeric_state', entity_id: 'sensor.t', above: 10 }] });
  const e = new RuleEngine();
  e.evaluate([r], hassOf({ 'sensor.t': '5' }));
  assert.deepEqual(e.evaluate([r], hassOf({ 'sensor.t': 'unavailable' })), []);
});

// ── Déclencheur horaire ──────────────────────────────────────────────────────

test('déclencheur horaire : part au franchissement de la minute', () => {
  const r = rule({ triggers: [{ type: 'time', at: '22:00' }] });
  const e = new RuleEngine();
  e.evaluate([r], hassOf({}), at('21:58'), 1000);
  assert.deepEqual(e.evaluate([r], hassOf({}), at('21:59'), 2000), []);
  assert.equal(e.evaluate([r], hassOf({}), at('22:00'), 3000).length, 1);
  assert.deepEqual(e.evaluate([r], hassOf({}), at('22:01'), 4000), [], 'déjà franchi');
});

// ── Conditions ───────────────────────────────────────────────────────────────

test('les conditions bloquent le déclenchement', () => {
  const r = rule({
    conditions: [{ entity_id: 'person.a', operator: 'eq', value: 'home' }],
  });
  const e = new RuleEngine();
  e.evaluate([r], hassOf({ 'binary_sensor.porte': 'off', 'person.a': 'not_home' }));
  assert.deepEqual(e.evaluate([r], hassOf({ 'binary_sensor.porte': 'on', 'person.a': 'not_home' })), []);

  const e2 = new RuleEngine();
  e2.evaluate([r], hassOf({ 'binary_sensor.porte': 'off', 'person.a': 'home' }));
  assert.equal(e2.evaluate([r], hassOf({ 'binary_sensor.porte': 'on', 'person.a': 'home' })).length, 1);
});

test('logic « or » suffit à une seule condition vraie', () => {
  const r = rule({
    logic: 'or',
    conditions: [
      { entity_id: 'person.a', operator: 'eq', value: 'home' },
      { entity_id: 'person.b', operator: 'eq', value: 'home' },
    ],
  });
  const e = new RuleEngine();
  const off = { 'binary_sensor.porte': 'off', 'person.a': 'not_home', 'person.b': 'home' };
  e.evaluate([r], hassOf(off));
  assert.equal(e.evaluate([r], hassOf({ ...off, 'binary_sensor.porte': 'on' })).length, 1);
});

test('condition horaire, plage franchissant minuit', () => {
  const cond = { type: 'time', after: '22:00', before: '06:00' };
  assert.equal(evalCondition(cond, hassOf({}), at('23:30')), true);
  assert.equal(evalCondition(cond, hassOf({}), at('02:00')), true);
  assert.equal(evalCondition(cond, hassOf({}), at('12:00')), false);
});

// ── Anti-rebond ──────────────────────────────────────────────────────────────

test('cooldown empêche les rafales', () => {
  const r = rule({ cooldown: 60 });
  const e = new RuleEngine();
  const t0 = 9_000_000;
  e.evaluate([r], hassOf({ 'binary_sensor.porte': 'off' }), at('10:00'), t0);
  assert.equal(e.evaluate([r], hassOf({ 'binary_sensor.porte': 'on' }), at('10:00'), t0 + 1000).length, 1);
  e.evaluate([r], hassOf({ 'binary_sensor.porte': 'off' }), at('10:00'), t0 + 2000);
  assert.deepEqual(
    e.evaluate([r], hassOf({ 'binary_sensor.porte': 'on' }), at('10:00'), t0 + 3000), [],
    'moins de 60 s depuis le dernier déclenchement');
  e.evaluate([r], hassOf({ 'binary_sensor.porte': 'off' }), at('10:01'), t0 + 61_000);
  assert.equal(e.evaluate([r], hassOf({ 'binary_sensor.porte': 'on' }), at('10:02'), t0 + 70_000).length, 1);
});

// ── Compatibilité et utilitaires ─────────────────────────────────────────────

test('un `trigger` au singulier reste compris', () => {
  const legacy = {
    id: 'old',
    trigger: { type: 'entity_state', entity_id: 'b.p', to: 'on' },
    actions: [{ type: 'toast', message: 'x' }],
  };
  assert.equal(normalizeRule(legacy).triggers.length, 1);
  const e = new RuleEngine();
  e.evaluate([legacy], hassOf({ 'b.p': 'off' }));
  assert.equal(e.evaluate([legacy], hassOf({ 'b.p': 'on' })).length, 1);
});

test('referencedEntities ne liste que les entités citées', () => {
  const set = referencedEntities([rule({
    triggers: [
      { type: 'entity_state', entity_id: 'b.p1', to: 'on' },
      { type: 'time', at: '22:00' },
    ],
    conditions: [{ entity_id: 'person.a', operator: 'eq', value: 'home' }],
  })]);
  assert.deepEqual([...set].sort(), ['b.p1', 'person.a']);
});

test('parseHHMM rejette ce qui n\'est pas une heure', () => {
  assert.equal(parseHHMM('22:00'), 1320);
  assert.equal(parseHHMM('7:05'), 425);
  assert.equal(parseHHMM('24:00'), null);
  assert.equal(parseHHMM('22:60'), null);
  assert.equal(parseHHMM('bonjour'), null);
  assert.equal(parseHHMM(undefined), null);
});

test('withinWindow sans borne est toujours vrai', () => {
  assert.equal(withinWindow(500, null, null), true);
});

test('les actions sortent dans l\'ordre déclaré', () => {
  const r = rule({
    actions: [
      { type: 'go_to_view', view_id: 'v1' },
      { type: 'highlight_anchor', anchor: 'binary_sensor.porte' },
      { type: 'toast', message: 'Porte ouverte' },
    ],
  });
  const e = new RuleEngine();
  e.evaluate([r], hassOf({ 'binary_sensor.porte': 'off' }));
  const out = e.evaluate([r], hassOf({ 'binary_sensor.porte': 'on' }));
  assert.deepEqual(out.map((a) => a.type), ['go_to_view', 'highlight_anchor', 'toast']);
});

test('reset() ramène le moteur à son état initial', () => {
  const e = new RuleEngine();
  e.evaluate([rule()], hassOf({ 'binary_sensor.porte': 'off' }));
  e.reset();
  assert.equal(e.seeded, false);
  // Après reset, le prochain appel ré-amorce sans déclencher.
  assert.deepEqual(e.evaluate([rule()], hassOf({ 'binary_sensor.porte': 'on' })), []);
});
