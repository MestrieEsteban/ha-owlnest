---
tags: [fonctionnalite, geometrie]
---

# Ouvrants

Portes, fenêtres et volets du modèle qui bougent selon l'état d'une entité. Onglet 🚪 de l'éditeur.

Repose entièrement sur ce qu'établit [[Modele 3D]] : les pièces sont déjà séparables, **aucune retouche du fichier n'est nécessaire**.

## Le geste

Cliquer « + Ouvrant », puis **désigner la pièce sur le modèle**. Pas de liste : sur 2 636 composantes, montrer du doigt est la seule interaction praticable.

## Les deux modules

`src/parts.ts` — géométrie pure, testable sans DOM.

- `buildPartIndex(geometry)` — composantes connexes, union-find sur positions soudées. Mémorisé sur la maille (`userData.__owlnestParts`) : trop lourd à refaire à chaque clic, trop volumineux pour la scène.
- `partFrame(box)` — déduit hauteur / largeur / épaisseur des **proportions**. Aucune orientation codée en dur.
- `hingePivot(box, frame, side)` — le gond sur une arête verticale, au milieu de l'épaisseur.
- `extractPart()` — détache la pièce **et retire ses triangles de la maille d'origine**. Sans ce retrait, le vantail s'ouvrirait en laissant sa copie immobile dans l'embrasure.
- `guessPart()` — porte / fenêtre / autre, en centimètres.

`src/parts-runtime.ts` — le contrôleur.

- `openFraction()` — lecture de l'état, voir plus bas.
- `PartController.build()` / `.configure()` / `.update(dt)` / `.preview()`.

## Le nœud pivot

> [!important] La géométrie ne bouge jamais
> Le vantail est extrait **toujours du même côté**. Le pivot réel est porté par un `THREE.Group` parent.

C'est ce qui rend **tous les réglages modifiables en direct** : angle, sens, course, durée, et même le côté des gonds ne sont que des conséquences du repère de la pièce, déjà connu. `configure()` les recalcule sans toucher un seul triangle.

Sans ce nœud, changer le côté des gonds imposait de re-découper, donc de recharger le modèle — c'était le bug « il faut enregistrer et revenir pour voir ». Voir [[Pieges]].

Seuls un **ajout** ou une **suppression** rechargent encore le modèle : `dispose()` ne recolle pas les triangles retirés, il faut repartir du fichier.

## Retrouver une pièce d'une session à l'autre

La scène stocke `{ mesh, meshIndex, triangle }`. Le triangle d'amorce suffit à réidentifier la pièce entière via `ofTriangle`.

`resolveMesh()` cherche **par rang, puis par nom**, et exige que les deux concordent : un modèle réexporté peut avoir changé d'ordre, et animer silencieusement la mauvaise porte serait pire qu'un ouvrant manquant.

## Lire « ouvert » sur une entité

Ordre de priorité dans `openFraction()` :

1. **`openWhen`** — états désignés à la main. Priment sur tout.
2. **`current_position`** — un volet à 40 % s'affiche à 40 %.
3. **Le descripteur du domaine**, mais seulement si le domaine a une notion d'ouverture.

> [!danger] Piège majeur
> `describeEntity('sensor.x').isOn` répond **`() => true`**. Juste pour un badge — un capteur est toujours actif — mais lu comme une ouverture, la porte reste **béante et insensible**.

D'où `OPENABLE_DOMAINS`, liste **fermée** : `cover`, `valve`, `lock`, `binary_sensor`, `switch`, `light`, `input_boolean`, `fan`, `group`. Hors de cette liste, l'ouvrant reste **fermé** — un immobilisme visible vaut mieux qu'une porte coincée ouverte — et l'éditeur réclame un choix explicite.

Voir [[Descripteurs]].

## Rendre la lecture visible

Le formulaire affiche en direct ce que la carte comprend :

```
En ce moment, Owlnest lit :
Ouverte → ouvert
```

Plus un avertissement jaune quand le domaine n'a pas de notion d'ouverture. Une entité mal interprétée ressemblait à une panne ; elle se diagnostique maintenant d'un coup d'œil.

Le **curseur d'aperçu** entrouvre la pièce à l'écran sans toucher à la maison. C'est le seul moyen fiable de savoir si les gonds sont du bon côté.

## Vérifié

41 tests (14 géométrie, 27 exécution), plus la chaîne complète sur la vraie maison dans un navigateur :

```
✓ le gond ne se déplace pas — 0.0e+0 cm
✓ les triangles sont retirés de la maille d’origine — 752 → 624
✓ un changement d’angle prend effet sans enregistrer — 30.0°
✓ un capteur numérique ne laisse pas la porte béante
```

Le garde-fou important : **le gond ne bouge pas pendant la rotation**. Un pivot au centre du vantail le ferait traverser le mur, et c'est invisible dans un test d'angle.

Coût d'une image avec une porte en mouvement : **0,50 ms**.
