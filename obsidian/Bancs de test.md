---
tags: [atelier, methode]
---

# Bancs de test

Pages autonomes servies par Vite qui montent un morceau du projet sans Home Assistant ni dashboard.

**Raison d'être :** vérifier soi-même au lieu de demander à l'utilisateur de regarder son écran. Chaque banc a résolu au moins un signalement.

## Les pages

| page | ce qu'elle monte |
|---|---|
| `dev/card-harness.html` | le vrai `<ha-3d-floorplan>` avec un `hass` simulé, un modèle glTF en data-URI, une scène fixture |
| `dev/parts-harness.html` | la chaîne complète des [[Ouvrants]] sur le **vrai** GLB |
| `dev/picker-harness.html` | le sélecteur d'entités |
| `dev/anchors-harness.html` | les natures d'[[Ancres]] |
| `dev/camera-harness.html` | les vignettes de caméra |

`card-harness` est celui qui a le plus servi : c'est lui qui a permis d'exercer le panneau d'édition et la fenêtre de règles sans passer par HA.

## Le modèle réel

`parts-harness` lit `dev/model.local.glb`, **non versionné** (`dev/*.local.glb` dans `.gitignore`).

> [!warning] CORS
> Un GLB servi par HA (`/local/…`) est **refusé** depuis l'origine du serveur de dev : pas d'en-tête `Access-Control-Allow-Origin`. En production le problème n'existe pas — la carte est servie par HA.
>
> Copier donc le fichier localement, ou passer `?model=…`.

## Deux limites du navigateur piloté

> [!important] `requestAnimationFrame` ne tourne pas
> Quand le panneau n'est pas affiché, la page **ne compose pas d'images** : `rAF` est en pause, et une capture d'écran échoue.
>
> Conséquence : un banc qui s'appuie sur `rAF` semble figé. Il faut **exposer le contrôleur** (`window.__h`) et piloter le rendu à la main depuis la console.

Vérifier qu'un rendu change vraiment, sans capture d'écran : comparer deux `getImageData` et compter les pixels différents. Pour une porte, 4,1 % de l'image change alors que la porte fermée n'occupe que 3,3 % — le battant libère sa place et en occupe une autre.

> [!note] Une porte intérieure est cachée par les murs vue du dehors
> Un premier essai visuel montrait **0 %** de changement : la caméra fixait une façade. Masquer les autres mailles a réglé le cadrage.

## Méthode qui a fait ses preuves

**Lire la scène du backend en WebSocket** pour distinguer un bug d'enregistrement d'un bug de rendu. Cela a résolu trois signalements distincts.

**Rejouer une transition réelle** plutôt que d'appeler la fonction interne : c'est la seule façon de voir les gardes du chemin normal — dont celle qui saute l'évaluation des [[Regles]] en mode édition.

**Vérifier les six onglets de l'éditeur** après toute modification du panneau. Ils ont déjà tous disparu d'un coup à cause d'un `return` mal placé, voir [[Pieges]].

## Question ouverte

Faut-il garder ces pages dans le dépôt ? Elles ne sont pas incluses dans le bundle et ont une valeur de diagnostic réelle. Non tranché.
