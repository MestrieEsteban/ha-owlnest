---
tags: [fonctionnalite]
---

# Règles

Automatisations de la **vue**, jamais de la maison.

> [!important] Ne pas dupliquer Home Assistant
> Une règle Owlnest fait voler la caméra, met une ancre en évidence, affiche un message. Elle n'allume pas les lampes — HA le fait déjà, avec un historique et une interface de débogage.

## Modèle

`src/rules/types.ts`

- **Déclencheurs** (`triggers[]`, en OU) : `entity_state` (+ `for`), `numeric_state` (+ `attribute`, `above`, `below`, `for`), `time`.
- **Conditions** : `EntityCondition`, `TimeCondition`, combinées par `logic: 'and' | 'or'`.
- **Actions** : `go_to_view`, `highlight_anchor`, `toast`, `call_service`.
- Plus `cooldown` et `enabled`.

`normalizeRule()` accepte l'ancien `trigger` au singulier.

## Moteur

`src/rules/engine.ts` — classe `RuleEngine`, état interne : `_prev`, `_prevNum`, `_since`, `_fired`, `_lastFired`, `_lastMinute`, `_seeded`.

```ts
evaluate(rules, hass, now?, nowMs?): Action[]
```

Ne prend un instantané que des **entités citées par les déclencheurs**. 23 tests.

## Deux comportements à connaître

> [!warning] La première transition après création est avalée
> Une règle ajoutée en cours de session vise une entité que le moteur ne surveillait pas : il n'a **pas d'état précédent**, donc ne peut pas voir de changement. Il le mémorise et attend le suivant.
>
> Concrètement : on crée la règle, on allume → rien. On éteint puis rallume → ça part. C'est correct sur le fond (on ne peut pas inventer un passé) mais déroutant.

> [!note] Rien n'est évalué en mode édition
> `set hass` saute `_evaluateRules()` quand l'éditeur est ouvert — on ne veut pas qu'une règle déplace la caméra pendant qu'on pose des ancres.
>
> Cela a déjà provoqué un faux diagnostic : un banc resté en mode édition « prouvait » que le moteur ne marchait pas. Voir [[Pieges]].

## Interface

Les règles s'écrivent **en phrases**, pas en formulaire. Trois phases séparées par couleur, pastilles d'entités et d'états, divulgation progressive, modèles préremplis.

Détails qui ont demandé une correction :

- L'action « mettre en évidence » propose **les ancres réellement posées**, pas le catalogue d'entités de HA — sinon on choisit des cibles qui n'apparaissent nulle part. Une cible dont l'ancre a disparu reste affichée avec un ⚠ plutôt qu'effacée en silence.
- Le sélecteur d'entités a dû devenir une **modale** pour passer devant la fenêtre de règles. Voir [[Pieges]].
- Un résumé à trous est pire qu'aucun résumé : `ruleIsComplete()` décide s'il vaut la peine d'être affiché.

## Tracer un déclenchement

```
[Owlnest] règle déclenchée → highlight_anchor
```

Distingue les deux pannes qui se ressemblent : une règle qui ne part pas, et une règle qui part sans effet visible.

## Aperçu

Le bouton « Essayer » exécute les actions sans attendre le déclencheur. Comme le mode édition masque les overlays, une mise en évidence y ferait pulser un élément invisible : `_startRulePreview()` les révèle le temps de l'aperçu.
