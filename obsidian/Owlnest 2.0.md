---
tags: [backlog, roadmap]
---

# Owlnest 2.0

Feuille de route décidée la nuit du 9 au 10 octobre 2026, Esteban ayant laissé carte blanche (« prends les décisions, je veux que ça avance, on vise un Owlnest 2.0 »). Elle prolonge la refonte de l'[[Interface]].

## Le cap

Owlnest 1.x montrait la maison. Owlnest 2.0 doit **servir tous les jours sur une tablette murale** : on la regarde deux secondes, on touche, c'est fait. D'où trois axes :

1. **Rien à configurer pour que ça marche** : ce qui se déduit du plan se déduit (pièces, cadrages, lampes par pièce).
2. **Tout se fait au doigt** : pas de survol, pas de clic droit, pas de champ à taper quand une liste suffit.
3. **Un seul style** : plus aucun écran « barbare » hérité de l'ancien inspecteur.

## Fait cette nuit

- [x] État en direct dans l'éditeur (fiche d'un ouvrant, listes, sélecteur d'entités) — `entities/live.ts`.
- [x] « Ce qui bouge » en deuxième place dans la fiche d'un ouvrant.
- [x] **Module Pièces** : un bouton par pièce du plan, la caméra vole au-dessus d'elle, avec le nombre de lampes allumées dedans — `plan/room-views.ts`.
- [x] **Les pastilles au doigt** : nom au toucher, réglage « Noms des pastilles ».
- [x] **La fiche d'un appareil** refaite comme celle des ouvrants.
- [x] **L'éditeur de règles** dans le panneau élargi ; liste avec interrupteurs.
- [x] **Ambiance et Réglages** au nouveau style, sans le zoom de secours.
- [x] **Pastilles plus petites au loin.**
- [x] **Toucher deux fois une pièce dans la 3D** pour y aller (deux fois dehors, ou sur la même, pour revenir).
- [x] **Panneau de la pièce** : ses appareils avec un interrupteur, « Tout éteindre », la température dans le bouton de la pièce.
- [x] **Roue d'actions et visibilité conditionnelle** au nouveau style : plus aucun zoom de secours dans la fiche d'un appareil.
- [x] **Premiers pas** dans l'éditeur : une pastille de progression, cinq étapes qui se cochent seules, chacune mène au bon endroit.
- [x] **Carte étroite** : les modules face à face se partagent la ligne (`:has()` et requêtes de conteneur).
- [x] **Plus de tiret cadratin** dans les textes de l'interface ; « ancre » remplacé par « appareil » partout.
- [x] **Plus d'emoji** dans l'interface : icônes météo dessinées, mots dans les résumés de règles.
- [x] **Règles** : les morceaux de phrase au style commun (plus de zoom nulle part dans l'éditeur, sauf la simulation météo).
- [x] **Pastilles au thème** : fond, bordure et nom suivent le thème de la carte.
- [x] **Poser les appareils de chaque pièce** : une pièce du plan qui porte le nom (ou un alias) d'une pièce de Home Assistant reçoit ses lampes, capteurs et prises, répartis dans son contour (`plan/auto-place.ts`, testé). Une seule annulation retire tout.
- [x] **Import à plusieurs niveaux** : le fichier demande lequel importer.
- [x] **Parcours de contrôle** : un script parcourt tous les écrans du banc sans une erreur de console.

## La suite, dans l'ordre

1. Relire tout le parcours sur le vrai Home Assistant d'Esteban (rien n'y a encore été essayé).
2. Les vrais étages (plusieurs niveaux dans le plan, un sélecteur sur la carte). En attendant, l'import d'un fichier à plusieurs niveaux demande lequel importer (`levelChoices`).

## Plus tard

- Pièces du plan reliées aux pièces de Home Assistant (appareils d'une pièce HA proposés dans le panneau de la pièce).
- Les morceaux de phrase des règles au nouveau style (aujourd'hui agrandis par `.ow-rule-body`).
