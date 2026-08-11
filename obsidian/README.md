# Coffre Obsidian d'Owlnest

Un **second cerveau** pour le projet, pas une documentation de référence.

Ouvrir ce dossier comme coffre dans Obsidian. Point d'entrée : [[Owlnest]].

## Ce qui va ici

Ce qui **ne se lit pas dans le code** :

- des **mesures** (le modèle fait 92 407 triangles, l'analyse coûte 70 ms) ;
- des **raisons** (pourquoi un nœud pivot plutôt qu'un pivot dans la géométrie) ;
- des **pièges déjà rencontrés**, avec leur cause réelle et non le symptôme ;
- des **décisions**, y compris celles de ne pas faire.

## Ce qui ne va pas ici

- La signature des fonctions — elle vit dans le code, où elle ne peut pas mentir.
- Les procédures d'installation → `README.md` et `DEVELOPMENT.md` à la racine.
- Ce qui se déduit de `git log`.

## Conventions

- Liens en doubles crochets vers le nom de la note. Lier généreusement : un lien vers une note inexistante marque quelque chose à écrire.
- Noms de fichiers sans accent ni apostrophe, pour que git et Windows restent tranquilles.
- Encadrés Obsidian pour hiérarchiser : `> [!danger]` un piège coûteux, `> [!warning]` un écueil, `> [!important]` une contrainte, `> [!tip]` un réflexe utile.
- Chiffres **mesurés**, jamais estimés. Quand une valeur est supposée, le dire.

## Entretien

Après une séance de travail, se demander : **qu'est-ce qui m'aurait fait gagner une heure si je l'avais su ce matin ?** Cette réponse va dans une note. La plupart du temps c'est [[Pieges]] qui grossit.
