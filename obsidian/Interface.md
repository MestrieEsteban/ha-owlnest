---
tags: [fonctionnalite, interface]
---

# Interface

Refonte d'octobre 2026, demandée par Esteban : « plus friendly », modulaire, dans le style de l'éditeur de plan, avec un plein écran pour éditer et des tutoriels partout. Maquette validée avant le code (artefact « Owlnest, nouvelle interface »).

## Les briques

- `src/ui/icons.ts` : **toutes** les icônes, au trait (grille 24, trait 1,8). Plus d'emojis dans l'interface, sauf les icônes personnalisées du YAML (`ui.icons`), affichées en texte.
- `src/ui/theme.ts` : les quatre thèmes (Nuit, Papier, Verre, Home Assistant), l'accent, les préférences `UiPrefs` et la feuille de styles commune (préfixe `ow-`, injectée une fois dans la carte).
- `src/ui/tour.ts` : les visites guidées. Un projecteur, une bulle, une animation **en CSS seulement** par geste (`orbit`, `tap`, `walls`, `views`, `layout`, `full`, `add`, `rule`, `plan`, `door`, `sun`, `gear`). Respecte `prefers-reduced-motion`.
- `src/card/hud.ts` : les modules hors édition (outils, vues enregistrées, météo et état), leurs six emplacements et le panneau « Personnaliser ».
- `src/ui/editor-styles.ts` : la coquille de l'éditeur (barre d'onglets, panneau ancré à droite).

## La carte, hors édition

Trois modules dans six emplacements (`tl tc tr bl bc br`) : **Outils** (murs, recentrer, plein écran, verrou, aide, personnaliser, modifier), **Vues** (les vues enregistrées en puces) et **Météo et état** (lampes allumées, météo de `weather_entity`). Les outils peuvent s'effacer au repos (réglage, activé par défaut comme avant).

Les préférences (thème, accent, emplacements, modules affichés) vont dans **`scene.settings.ui`** : elles suivent la carte d'un appareil à l'autre et passent par l'enregistrement normal de la scène (le backend accepte un dict libre).

Le plein écran a des **raisons** (`_fsReasons` : `user`, `plan`, `edit`) : il dure tant qu'il en reste une. Passer du plan à l'éditeur ajoute la nouvelle raison **avant** de retirer l'ancienne, sinon la carte clignote hors du plein écran. Échap quitte le plein écran demandé par l'utilisateur.

## L'éditeur

Onglets en haut : **Plan · Appareils · Ouvrants · Règles · Ambiance · Réglages** (`editorTabs()` dans `edit-panel.ts`, partagé avec l'éditeur de plan, qui affiche les mêmes onglets). Ce qui a bougé depuis l'ancien inspecteur :

| Avant | Maintenant |
| --- | --- |
| Rail d'icônes à gauche du panneau | Onglets dans la barre du haut |
| Panneau flottant de 264 px | Panneau ancré à droite, 340 px ; la 3D se décale (`_viewShift` négatif) |
| Barre du bas : outil, annuler, vues, Terminé, raccourcis | Annuler, aide, Terminé en haut ; raccourcis dans le menu d'aide |
| Onglets Caméra et Config | Réunis dans **Réglages** (vues enregistrées en tête) |
| Onglet Météo | **Ambiance** |
| Liste plate d'ancres, nom technique | **Appareils** groupés par pièce (registre HA), état en clair, recherche |
| « + Ajouter » dans l'en-tête | Choisir · Orienter · Retirer · **Ajouter**, juste au-dessus de la liste |

Sur une carte de moins de 760 px, le panneau passe par-dessus la 3D et s'ouvre par un bouton « Panneau ». Sur une carte de moins de 900 px, « Modifier » propose d'abord le plein écran (« Ne plus me demander » retient le choix).

Le contenu repris tel quel de l'ancien inspecteur (fiches, listes des règles et ouvrants, Ambiance, Réglages) était écrit en 9 à 11 px : il est agrandi d'un bloc par `zoom: 1.18` (`.ow-legacy`) plutôt que réécrit. **À reprendre au fil de l'eau**, fiche par fiche.

## Tutoriels

- Carte : invitation discrète au premier lancement (ou bouton « Visite guidée » dans l'accueil de la démo), puis le bouton d'aide des outils.
- Éditeur : invitation au premier passage, puis le menu d'aide (visite de l'onglet, raccourcis clavier).
- Éditeur de plan : bouton d'aide dans sa barre.

Mémoire par appareil : `owlnest_tour_seen`, `owlnest_tour_editor_seen`.

## Pièges rencontrés

- Un élément posé dans `overlayContainer` doit remettre `pointer-events:auto` (voir [[Pieges]]). Les classes `ow-surface`, `ow-sheet`, `ow-scrim`, `ow-menu`, `ow-pill` le font.
- Un `display:flex` écrit en ligne l'emporte sur l'attribut `hidden` : pour masquer un élément stylé en ligne, passer par `style.display`.
- Le banc de la démo levait une erreur sans `code: 'not_found'` : la carte la prenait pour une intégration en panne. Corrigé dans `dev/demo-harness.html`.

## Reste à faire

- Harmoniser le français sur le « tu » (l'ancien texte mélange « vous » et « tu »).
- Réécrire les fiches héritées dans les composants `ow-` au lieu du zoom.
- Les noms des pastilles affichés en permanence (prévu dans la maquette, pas encore dans la carte).
