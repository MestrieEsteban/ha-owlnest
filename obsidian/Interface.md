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

Onglets en haut : **Plan · Appareils · Ouvrants · Règles · Caméra · Ambiance · Réglages** (`editorTabs()` dans `edit-panel.ts`, partagé avec l'éditeur de plan, qui affiche les mêmes onglets). Ce qui a bougé depuis l'ancien inspecteur :

| Avant | Maintenant |
| --- | --- |
| Rail d'icônes à gauche du panneau | Onglets dans la barre du haut |
| Panneau flottant de 264 px | Panneau ancré à droite, 340 px ; la 3D se décale (`_viewShift` négatif) |
| Barre du bas : outil, annuler, vues, Terminé, raccourcis | Annuler, aide, Terminé en haut ; raccourcis dans le menu d'aide |
| Onglet Caméra (vues dans un coin du panneau) | **Caméra** : vues enregistrées ; aller, renommer, remplacer par la vue actuelle, monter, masquer, supprimer en deux temps |
| Onglet Config | **Réglages** |
| Onglet Météo | **Ambiance** |
| Liste plate d'ancres, nom technique | **Appareils** groupés par pièce (registre HA), état en clair, recherche |
| « + Ajouter » dans l'en-tête | Choisir · Orienter · Retirer · **Ajouter**, juste au-dessus de la liste |

Sur une carte de moins de 760 px, le panneau passe par-dessus la 3D et s'ouvre par un bouton « Panneau ». Sur une carte de moins de 900 px, « Modifier » propose d'abord le plein écran (« Ne plus me demander » retient le choix).

**Ouvrants** : la fenêtre flottante avec l'arborescence brute du modèle est devenue une fiche dans le panneau, dans l'ordre de ce qu'on fait : relier le capteur (un grand bouton, plus d'identifiant à taper), **Essayer** (le curseur qui fait bouger l'ouvrant), puis le mouvement (tuiles Pivote, Coulisse, Se déroule, Animation, et boutons côte à côte au lieu des listes déroulantes). Couleurs et « Ce qui bouge » (l'arborescence, les pièces qui suivent) sont repliés. Toute la logique d'avant est gardée : réglages appliqués en direct, Annuler qui revient à l'état d'origine (ou retire un ouvrant tout neuf), enregistrement différé de 600 ms.

Le contenu repris tel quel de l'ancien inspecteur (fiches des appareils, liste des règles, Ambiance, Réglages, arborescence des ouvrants) était écrit en 9 à 11 px : il est agrandi d'un bloc par `zoom: 1.18` (`.ow-legacy`) plutôt que réécrit. **À reprendre au fil de l'eau**, fiche par fiche.

## Tutoriels

- Carte : invitation discrète au premier lancement (ou bouton « Visite guidée » dans l'accueil de la démo), puis le bouton d'aide des outils.
- Éditeur : invitation au premier passage, puis le menu d'aide (visite de l'onglet, raccourcis clavier).
- Éditeur de plan : bouton d'aide dans sa barre.

Mémoire par appareil : `owlnest_tour_seen`, `owlnest_tour_editor_seen`.

## Fiches refaites (nuit du 9 au 10 octobre)

- **Appareil** : en-tête fixe (retour, icône, nom), cartes « Ce que c'est » (type en boutons, grand bouton de choix d'appareil, nom), « Apparence » (icône, couleur, vignette, précision en exemples « 18 / 17,6 / 17,58 »), « Lumière » (intensité, tuiles Ambiante / Spot / Rayon, orientation), « Au toucher », « Visibilité » repliée, Dupliquer / Retirer.
- **Règle** : dans le panneau, élargi à 470 px le temps de l'édition (la 3D se recentre), avec le même pied que les autres fiches. La liste des règles a un interrupteur par règle.
- **Ambiance et Réglages** : sections en cartes, libellés en 12 px, champs et boutons au nouveau style. Plus de zoom.
- **État en direct** : `entities/live.ts`. La carte publie chaque `hass`, les écrans ouverts s'abonnent (fiche d'ouvrant, listes, sélecteur d'entités) au plus toutes les 300 à 500 ms.

## La carte (nuit du 9 au 10 octobre)

- **Module Pièces** : un bouton par pièce du plan (de la plus grande à la plus petite, homonymes numérotés), avec le nombre de lampes allumées. La caméra vole au-dessus (`plan/room-views.ts`, testé). Défaut : en haut à gauche ; l'état passe en haut à droite.
- **Noms des pastilles** : au toucher, et en permanence au choix (`.ow-names .ow-pin-label`). Les emplacements à relier de la démo gardent leur « + » et leur nom (`AnchorOverlay.setGlyph`).
- **Profondeur** : pastilles plus petites et plus pâles au fond.
- **Double toucher** sur une pièce de la 3D : la caméra y va. La pièce se trouve en coupant le rayon de la caméra avec le sol (`_modelBox.min.y`), sans lancer de rayon sur les objets.
- **Panneau de la pièce** : ouvert quand une pièce est montrée. Appareils dont la pastille tombe dans le contour, interrupteur pour ceux qui se basculent, « Tout éteindre ». **Décision** : commander une lampe depuis la carte reste dans l'esprit d'Owlnest (la pastille le faisait déjà) ; ce sont les *règles* qui ne pilotent que la vue.
- **Premiers pas** : `SetupStep` dans `edit-panel.ts`, étapes lues sur la scène par la carte (`_setupSteps`).
- **Carte étroite** : `.ow-ui` est un conteneur ; deux modules face à face se partagent la ligne, l'état se réduit sous 640 px, les vues du bas montent au-dessus des coins.
- **Pastilles au thème** : `overlay.ts` lit `--ow-chrome`, `--ow-line`, `--ow-text` (avec un repli sombre si la carte n'a pas encore posé ses variables).
- **Poser les appareils de chaque pièce** (menu « … » de la liste, ou la liste vide) : `matchRooms` (nom ou alias, sans accents ni majuscules), `placeable` (lampes, prises, volets, climat, médias, serrures, capteurs de porte, fenêtre, mouvement, fumée, fuite, température, humidité, CO₂, luminosité ; jamais batterie ni signal), `spreadPoints` (grille dans le contour, à 50 cm des murs). Lampes à 35 cm sous le plafond, capteurs à 1,40 m. `AnchorEditor.addMany` : une seule annulation.

## Langue

Tout le français est au **« tu »** depuis le 9 octobre 2026, et chaque texte a son anglais. Un nouveau texte s'ajoute dans les deux langues (`i18n.test.mjs` vérifie que les clés correspondent).

## Pièges rencontrés

- Un script Python passé par un heredoc dans l'outil Bash perd ses barres obliques d'échappement : trois traductions cassées d'un coup. Écrire ces scripts dans un fichier.

- Un élément posé dans `overlayContainer` doit remettre `pointer-events:auto` (voir [[Pieges]]). Les classes `ow-surface`, `ow-sheet`, `ow-scrim`, `ow-menu`, `ow-pill` le font.
- Un `display:flex` écrit en ligne l'emporte sur l'attribut `hidden` : pour masquer un élément stylé en ligne, passer par `style.display`.
- Le banc de la démo levait une erreur sans `code: 'not_found'` : la carte la prenait pour une intégration en panne. Corrigé dans `dev/demo-harness.html`.

## Reste à faire

- La simulation météo de l'onglet Ambiance garde son ancien style, agrandi (`zoom: 1.15`), avec des icônes au trait.
