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

## La suite, dans l'ordre

1. **Les pastilles au doigt** : les noms affichés en permanence au choix (réglage « Noms des pastilles »), appui long qui ouvre les détails. Referme le bug « étiquettes invisibles au toucher » de [[Chantiers ouverts]].
2. **La fiche d'un appareil** refaite comme celle des ouvrants : cartes, boutons côte à côte, plus d'identifiant à taper.
3. **L'éditeur de règles** dans le panneau, en phrase : « Quand … alors … ».
4. **Ambiance et Réglages** au nouveau style, sans le zoom de secours.
5. **Pastilles plus petites au loin** (profondeur lisible sans occlusion), voir [[Chantiers ouverts]].

## Plus tard

- Étages dans l'import Sweet Home 3D.
- Toucher une pièce dans la 3D pour y aller.
- Pièces du plan reliées aux pièces de Home Assistant (températures par pièce).
