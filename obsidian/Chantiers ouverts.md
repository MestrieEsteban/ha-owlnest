---
tags: [backlog]
---

# Chantiers ouverts

> [!important] La contrainte du projet
> Owlnest a accumulé des fonctionnalités à ~70 %. L'objectif est de **refermer**, pas d'ajouter. Toute nouvelle idée séduisante doit être pesée contre cette liste.

## Bugs connus, non corrigés

**Les overlays traversent les murs.** Pas d'occlusion : un badge d'une pièce du fond s'affiche par-dessus une cloison. Voir [[Ancres]].

**L'échelle en centimètres n'est pas absorbée partout.** `lights.distance: 8` vaut 8 cm ; les limites d'orbite et la densité du brouillard sont fausses d'un facteur ~100. Les vignettes de caméra ont été corrigées (tailles relatives à l'envergure), le reste non. Voir [[Modele 3D]].

**Les étiquettes sont invisibles au toucher.** L'infobulle est au survol, et une tablette murale n'a pas de survol. **Approche non tranchée** — la question a été posée plusieurs fois sans réponse.

**`scene_id` en `localStorage`.** Comportement bancal au changement de scène.

## Améliorations identifiées

- Mise à l'échelle des overlays selon la distance.
- Regroupement par pièce, ce qui permettrait de **retirer `cluster_threshold`**.
- Le même message « aucune vue enregistrée » pour l'action `go_to_view` que celui fait pour `highlight_anchor`. Voir [[Regles]].

## Décisions prises

**Cartes 3D retirées de l'interface** (`CARDS_ENABLED = false`). Le code subsiste mais l'onglet est masqué. À trancher : supprimer ou reprendre.

**Pas de glisser-déposer** dans le sélecteur d'entités. Gain nul pour une complexité réelle.

**Garder ou non les bancs `dev/*harness.html` ?** Non tranché. Ils ne partent pas dans le bundle et ont une vraie valeur de diagnostic. Voir [[Bancs de test]].

## Sur les ouvrants

Livrés et vérifiés, mais **jamais utilisés sur le dashboard réel** au moment d'écrire ces lignes. Risque identifié : un vantail **collé à son cadre** dans le modèle formerait une seule pièce et s'ouvrirait avec lui. `dev/parts-harness.html` le dirait immédiatement.

Non fait, volontairement : les autres `type3d` de [[floor3d-card]] (`light` sur l'objet, `color`, `hide`/`show`, `rotate`, `room`). Techniquement à portée maintenant que les pièces sont adressables — mais ce serait un huitième chantier.

## Extension des descripteurs

Ajouter un domaine demande de modifier `descriptors.ts` à la main. L'utilisateur ne peut pas définir ses propres comportements. Limite assumée. Voir [[Descripteurs]].
