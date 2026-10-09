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

## La suite, dans l'ordre

1. **Toucher deux fois une pièce dans la 3D** pour y aller (et deux fois dehors pour revenir).
2. **L'éditeur de la roue d'actions** et la **visibilité conditionnelle** au nouveau style.

## Plus tard

- Étages dans l'import Sweet Home 3D.
- Toucher une pièce dans la 3D pour y aller.
- Pièces du plan reliées aux pièces de Home Assistant (températures par pièce).
