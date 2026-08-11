---
tags: [moc]
---

# Owlnest

Carte Lovelace pour Home Assistant : un plan 3D interactif de la maison, plus une petite intégration Python qui persiste les scènes.

Ce dossier est un **second cerveau**, pas une documentation d'API. On y consigne ce qui ne se lit pas dans le code : les mesures, les raisons d'un choix, et les pièges dans lesquels on est déjà tombé.

## Les briques

- [[Modele 3D]] — ce que contient vraiment le GLB de la maison. **À lire avant de toucher à la géométrie.**
- [[Ouvrants]] — portes, fenêtres et volets animés par les entités.
- [[Ancres]] — les pastilles posées dans l'espace, leurs natures.
- [[Regles]] — automatisations de la *vue*, jamais de la maison.
- [[Descripteurs]] — la sémantique par domaine d'entité, source de vérité unique.
- [[Performance]] — profils de qualité, cible matérielle.

## L'atelier

- [[Boucle de dev]] — pousser vers Home Assistant automatiquement.
- [[Tests]] — 64 tests, sans framework ni dépendance ajoutée.
- [[Bancs de test]] — vérifier soi-même au lieu de demander à l'utilisateur de regarder.

## Mémoire des erreurs

- [[Pieges]] — le journal des bugs et de leurs causes réelles. **La note la plus utile du coffre.**
- [[Chantiers ouverts]] — ce qui est à 70 % et attend.
- [[floor3d-card]] — le projet voisin, ce qu'il fait mieux et pourquoi.

## Les deux règles du projet

**Ne pas dupliquer Home Assistant.** Les règles Owlnest pilotent l'affichage : une caméra qui vole vers la cuisine, une ancre mise en évidence. Elles n'allument pas les lampes — HA le fait déjà, et mieux.

**Refermer avant d'ouvrir.** Le projet a accumulé des fonctionnalités à 70 %. Voir [[Chantiers ouverts]].
