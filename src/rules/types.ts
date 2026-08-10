/**
 * rules/types.ts — automatisations de scène Owlnest.
 *
 * ## Périmètre assumé
 *
 * Ces règles **pilotent la vue, pas la maison**. Home Assistant fait déjà les
 * automatisations mieux que nous ne le ferons jamais : historique, redémarrage à
 * froid, conditions riches, débogage. Ce que HA ne sait pas faire, c'est réagir
 * *dans la scène 3D* — amener la caméra, attirer l'œil sur un endroit, afficher
 * un message.
 *
 * `call_service` reste disponible comme échappatoire, mais si une règle ne fait
 * qu'appeler un service, elle a sa place dans HA, pas ici.
 */

// ── Déclencheurs ─────────────────────────────────────────────────────────────

/**
 * Changement d'état d'une entité.
 * `for` exige que l'état cible soit maintenu N secondes — « porte ouverte
 * depuis 5 minutes ».
 */
export interface EntityStateTrigger {
  type: 'entity_state';
  entity_id: string;
  from?: string;
  to?: string;
  for?: number;
}

/**
 * Franchissement d'un seuil numérique. `above` et `below` peuvent être combinés
 * pour définir une plage.
 */
export interface NumericStateTrigger {
  type: 'numeric_state';
  entity_id: string;
  /** Attribut à comparer plutôt que l'état (ex. `current_temperature`). */
  attribute?: string;
  above?: number;
  below?: number;
  for?: number;
}

/** Heure locale, au format « HH:MM ». */
export interface TimeTrigger {
  type: 'time';
  at: string;
}

export type Trigger = EntityStateTrigger | NumericStateTrigger | TimeTrigger;

export type TriggerType = Trigger['type'];

// ── Conditions ───────────────────────────────────────────────────────────────

export type ConditionOperator = 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains';

/**
 * Évaluable contre `hass.states`. Sert aussi, hors des règles, au `visibleIf`
 * des ancres — d'où l'absence de `type` obligatoire.
 */
export interface EntityCondition {
  type?: 'entity';
  entity_id: string;
  attribute?: string;
  operator: ConditionOperator;
  value: string | number;
  /** Inverse le résultat — utilisé par le mode « Masquer si » de l'éditeur. */
  negate?: boolean;
}

/**
 * Plage horaire. `after` et `before` sont inclusifs sur la minute, et la plage
 * peut franchir minuit (« après 22:00 et avant 06:00 »).
 */
export interface TimeCondition {
  type: 'time';
  after?: string;
  before?: string;
}

export type Condition = EntityCondition | TimeCondition;

// ── Actions ──────────────────────────────────────────────────────────────────

/** Amène la caméra sur une vue enregistrée. */
export interface GoToViewAction {
  type: 'go_to_view';
  view_id: string;
}

/**
 * Fait pulser une ancre pour attirer l'œil.
 *
 * Déplacer la caméra dit « regarde par là » ; ceci dit « regarde *ça* ». C'est
 * ce qui manquait le plus : une règle pouvait bouger la vue sans jamais
 * désigner l'élément concerné.
 */
export interface HighlightAnchorAction {
  type: 'highlight_anchor';
  /** `entity_id` de l'ancre, ou son libellé pour une ancre sans entité. */
  anchor: string;
  /** Durée de la pulsation en secondes (défaut 6). */
  duration?: number;
  /** Couleur de la pulsation (défaut : rouge d'alerte). */
  color?: string;
}

/** Message bref affiché par-dessus la scène. */
export interface ToastAction {
  type: 'toast';
  message: string;
  level?: 'info' | 'warn';
}

/**
 * Échappatoire vers Home Assistant. À n'utiliser que pour ce qui doit se
 * produire *parce que* la scène a réagi ; sinon, écrire une automatisation HA.
 */
export interface CallServiceAction {
  type: 'call_service';
  domain: string;
  service: string;
  service_data?: Record<string, unknown>;
}

export type Action =
  | GoToViewAction
  | HighlightAnchorAction
  | ToastAction
  | CallServiceAction;

export type ActionType = Action['type'];

// ── Règle ────────────────────────────────────────────────────────────────────

export interface OwlnestRule {
  id: string;
  label?: string;
  /** Vrai par défaut lorsque absent. */
  enabled?: boolean;

  /** Déclencheurs en OU : la règle part si l'un d'eux se produit. */
  triggers?: Trigger[];
  /**
   * Ancien champ au singulier. Encore lu pour les scènes créées avant les
   * déclencheurs multiples — voir `normalizeRule`.
   */
  trigger?: Trigger;

  conditions?: Condition[];
  /** Combinaison des conditions — `and` par défaut. */
  logic?: 'and' | 'or';

  /**
   * Secondes minimum entre deux déclenchements. Sans cela, un capteur qui
   * oscille fait partir la règle en rafale.
   */
  cooldown?: number;

  actions: Action[];
}

// ── Compatibilité ────────────────────────────────────────────────────────────

/**
 * Ramène une règle à la forme courante : `triggers` au pluriel, `logic`
 * explicite. Les scènes existantes portent `trigger` au singulier et ne doivent
 * pas cesser de fonctionner.
 */
export function normalizeRule(rule: OwlnestRule): OwlnestRule {
  const triggers = rule.triggers?.length
    ? rule.triggers
    : (rule.trigger ? [rule.trigger] : []);
  return { ...rule, triggers, trigger: undefined, logic: rule.logic ?? 'and' };
}

/** Entités citées par les déclencheurs et conditions d'un ensemble de règles. */
export function referencedEntities(rules: OwlnestRule[]): Set<string> {
  const out = new Set<string>();
  for (const raw of rules) {
    const rule = normalizeRule(raw);
    for (const t of rule.triggers ?? []) {
      if (t.type !== 'time') out.add(t.entity_id);
    }
    for (const c of rule.conditions ?? []) {
      if (c.type !== 'time') out.add(c.entity_id);
    }
  }
  return out;
}
