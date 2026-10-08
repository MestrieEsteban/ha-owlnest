---
tags: [backlog]
---

# Chantiers ouverts

> [!important] La contrainte du projet
> Owlnest a accumulé des fonctionnalités à ~70 %. L'objectif est de **refermer**, pas d'ajouter. Toute nouvelle idée séduisante doit être pesée contre cette liste.

## Bugs connus, non corrigés

~~**L'échelle en centimètres n'est pas absorbée partout.**~~ **Refermé en août 2026.** Tout ce qui dépendait de l'unité se déduit maintenant de l'envergure du modèle : vignettes de caméra, limites d'orbite, densité de brouillard, plans de coupe, portée et intensité des lumières. Voir [[Echelle du modele]].

**Les étiquettes sont invisibles au toucher.** L'infobulle est au survol, et une tablette murale n'a pas de survol. **Approche non tranchée** — la question a été posée plusieurs fois sans réponse.

**`scene_id` en `localStorage`.** Comportement bancal au changement de scène.

## Améliorations identifiées

- **Taille et opacité des overlays selon la distance.** Rend la profondeur lisible sans masquer quoi que ce soit, et sans lancer de rayon : une simple division. C'est le remplaçant de l'occlusion, pas un ajout.
- Regroupement par pièce, ce qui permettrait de **retirer `cluster_threshold`**.
- Le même message « aucune vue enregistrée » pour l'action `go_to_view` que celui fait pour `highlight_anchor`. Voir [[Regles]].

## En attente

**Murs bas, à la Sims.** Essayé en octobre 2026, retiré avant la release : code gardé sur la branche `backlog/murs-bas`. Deux versions testées :

- tous les murs coupés à mi-hauteur, mobilier compris : maquette jugée étrange, armoires coupées ;
- seuls les murs entre la caméra et le centre descendent : mieux, mais vaisselle et portes de placard flottent quand leur meuble haut disparaît, et des murs intérieurs basculent au mauvais moment.

La cause est la même : l'export OBJ ne dit pas quel meuble est contre quel mur, ni ce qui est rangé dedans, donc tout est deviné par proximité. **À reprendre avec le `.sh3d`**, qui contient l'élévation des meubles, leur position et ce qui est porte ou fenêtre : les mêmes données serviraient aux noms de pièces et aux lampes posées automatiquement. L'ancien curseur « voir à travers les murs » (cutaway.ts) reste en place, mais efface aussi le mobilier sur le trajet : pas une réponse non plus.

## Décisions prises

**Les overlays traversent les murs, et c'est voulu.** Longtemps listé comme un bug, tranché en août 2026 : Owlnest est un tableau de bord, pas un jeu. On le regarde deux secondes en passant ; une pastille cachée derrière une cloison est une information perdue, et personne ne tournera la caméra pour la retrouver. C'est le comportement des mini-cartes et des HUD, pour la même raison.

Bénéfices annexes : pas de scintillement des pastilles pendant l'orbite, et aucun lancer de rayon par ancre sur la tablette. La lecture de profondeur qu'on y perd se récupère par la taille selon la distance, sans occlusion — voir plus bas.


**Cartes 3D retirées de l'interface** (`CARDS_ENABLED = false`). Le code subsiste mais l'onglet est masqué. À trancher : supprimer ou reprendre.

**Pas de glisser-déposer** dans le sélecteur d'entités. Gain nul pour une complexité réelle.

**Garder ou non les bancs `dev/*harness.html` ?** Non tranché. Ils ne partent pas dans le bundle et ont une vraie valeur de diagnostic. Voir [[Bancs de test]].

## Sur les ouvrants

Livrés et vérifiés, mais **jamais utilisés sur le dashboard réel** au moment d'écrire ces lignes. Risque identifié : un vantail **collé à son cadre** dans le modèle formerait une seule pièce et s'ouvrirait avec lui. `dev/parts-harness.html` le dirait immédiatement.

Non fait, volontairement : les autres `type3d` de [[floor3d-card]] (`light` sur l'objet, `color`, `hide`/`show`, `rotate`, `room`). Techniquement à portée maintenant que les pièces sont adressables — mais ce serait un huitième chantier.

## Extension des descripteurs

Ajouter un domaine demande de modifier `descriptors.ts` à la main. L'utilisateur ne peut pas définir ses propres comportements. Limite assumée. Voir [[Descripteurs]].
