---
tags: [veille]
---

# floor3d-card

`github.com/adizanni/floor3d-card` — le projet voisin, mûr, distribué par HACS. Comparaison honnête faite en août 2026.

## Ce qui n'est pas la différence

**Le format.** Leur carte accepte OBJ **et** GLB, et leur propre documentation recommande de convertir l'OBJ en GLB avec `obj2gltf` (« plus rapide et optimisé »). Owlnest est déjà sur le format qu'ils conseillent. Passer à l'OBJ serait une régression : trois fichiers, pas de compression, pas de PBR.

## Ce qui l'est

Le liaison repose sur `object_id` : chaque entité pointe un **objet nommé** du modèle, et `type3d` dit quoi en faire.

| `type3d` | effet |
|---|---|
| `door` | rotation (battant) ou glissement, degrés configurables |
| `cover` | volet roulant, avec sens |
| `light` | l'objet s'illumine, couleur et luminosité suivies |
| `color` / `hide` / `show` | teinte, disparition, apparition |
| `text` | l'état écrit sur une surface plane |
| `rotate` | rotation continue (ventilateur) |
| `room` | volume de pièce mis en évidence |
| `camera` | flux en popup |
| `gesture` | appel de service au double-clic |

Leur pipeline documenté : SweetHome3D + greffon `ExportToHASS`, qui exporte un objet nommé par élément.

## Ce qu'ils ont et qu'Owlnest n'a pas

- **Des années d'usage réel** et une base d'utilisateurs qui remonte des bugs sur des configurations inimaginables. Owlnest a un utilisateur, une maison, un modèle.
- Une interaction modèle plus ambitieuse : lampe dont l'abat-jour s'allume vraiment, `color`, `hide`/`show`, `rotate`, `room`.

## Ce qu'Owlnest a et qu'ils n'ont pas

- **Un modèle quelconque suffit.** Chez eux le modèle *est* l'interface : sans objets nommés et découpés, la carte ne fait rien. Ici les [[Ancres]] se posent à la souris dans l'espace. Leur barrière d'entrée est une séance de modélisation ; la nôtre est de glisser un fichier.
- Le **sélecteur d'entités** bâti sur les registres HA (809 entrées, groupées étage / pièce / appareil, états en direct). Chez eux, un `object_id` à taper dans du YAML.
- Les **profils de qualité** pour tablette faible, voir [[Performance]]. Aucun équivalent trouvé.
- Un **éditeur visuel** plutôt que du YAML.

## Ce que la comparaison a déclenché

Les [[Ouvrants]]. En croyant que leur avantage tenait à un modèle préparé à la main, on a mesuré le nôtre — et découvert qu'il était **déjà découpé en 2 636 pièces**. Voir [[Modele 3D]].

Le geste devient donc « cliquer la porte dans l'éditeur » au lieu de « passer des heures dans Blender ». On a récupéré `door` et `cover` sans leur pipeline.

## Verdict

Owlnest **n'est pas meilleur**, il est plus jeune et répond à une autre question : *et si la carte devait marcher sur n'importe quel GLB, sans YAML ?*

Si l'objectif était de refaire floor3d-card en mieux, la réponse honnête serait d'installer floor3d-card. La raison d'être d'Owlnest est cette absence de préparation exigée — et elle se défend en refermant les [[Chantiers ouverts]], pas en courant après leur liste de `type3d`.
