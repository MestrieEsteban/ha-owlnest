---
tags: [geometrie, mesure]
---

# Modèle 3D

Tout ce qui suit est **mesuré** sur le fichier réel, pas déduit du format.

Fichier : `/local/floorplan2.glb` sur l'instance HA, 4,28 Mo.

## Le piège du nom unique

Le glTF ne déclare **qu'un seul nœud, `MaisonHA`**. On en a longtemps conclu que le modèle était un bloc fusionné inexploitable — c'était faux, et ça a coûté une mauvaise décision d'architecture.

En réalité :

| | |
|---|---|
| nœuds glTF | 1 |
| matériaux | 53 → donc 53 primitives |
| mailles vues par `GLTFLoader` | **53**, nommées `MaisonHA_1` … `MaisonHA_53` |
| triangles | 92 407 |
| sommets | 112 264 |
| **pièces séparables** | **2 636** |

> [!warning] Le rang ne suit pas le nom
> La maille nommée `MaisonHA_23` est au **rang 22** dans le parcours. C'est pourquoi [[Ouvrants]] mémorise les deux.

## Pourquoi les pièces sont récupérables

Fusionner des maillages **concatène les tampons sans souder les sommets**. Les triangles d'une porte restent un îlot sans arête commune avec le mur. Une analyse en composantes connexes les récupère.

La soudure doit se faire **par position quantifiée, pas par indice de sommet** : un export duplique les sommets le long des coutures d'UV. Sur cette maison, l'écart est brutal — une primitive donne 174 composantes par indice contre **18** par position.

## Unités et orientation

> [!danger] Centimètres et Z-up
> Le modèle est en **centimètres** (la maison fait 788 unités de large) et en **Z-up** (la hauteur est sur le 3ᵉ axe, alors que le glTF spécifie Y-up).

Conséquences déjà rencontrées :

- Une vignette de caméra demandée à « 1,1 m » se retrouvait toujours écrêtée → les tailles sont désormais **relatives à l'envergure du modèle**, pas en mètres.
- Un filtre de détection écrit sur l'axe Y ne trouvait **aucune** porte. Voir [[Pieges]].
- `lights.distance: 8` vaut 8 cm. Les limites d'orbite et la densité du brouillard sont fausses d'un facteur ~100. **Toujours ouvert**, voir [[Chantiers ouverts]].

Le code ne présume donc aucune orientation : `partFrame()` déduit hauteur / largeur / épaisseur des **proportions** de la boîte englobante.

Sol du modèle : `z ≈ -216`. Le modèle est décalé sous zéro — une hauteur d'appui doit se mesurer par rapport au point le plus bas, jamais par rapport à l'origine.

Hauteur d'étage : 250 cm.

## Ce que contiennent les 2 636 pièces

| matériau | pièces |
|---|---|
| `leaves` | 1 646 |
| `trunk` | 400 |
| `white.001` | 280 |
| `amber`, `dkgrey` | 39 chacun |

**2 046 pièces sont de la végétation.** Il reste environ **590 pièces de bâtiment**, dont les ouvrants.

Reconnus automatiquement par proportions : **12 portes**, **51 fenêtres** (dont ~4 faux positifs — troncs, commode). La reconnaissance ne sert qu'à préremplir un formulaire ; c'est le clic de l'utilisateur qui décide.

Cotes typiques relevées :

```
portes    64 × 2 × 199 cm      91 × 9 × 209      83 × 4 × 204
fenêtres  64 × 2 × 123 cm      49 × 0 × 107 (le vitrage, surface plate)
```

## Coût de l'analyse

| | |
|---|---|
| 92 407 triangles, Node | 94 ms |
| idem, navigateur | 68–74 ms |
| extraction d'une pièce | 3,5 ms |

Payé **une seule fois dans l'éditeur**. La scène ne mémorise qu'un triangle d'amorce par ouvrant : la tablette ne recalcule rien. Voir [[Performance]].

## Reproduire ces mesures

`dev/parts-harness.html` rejoue toute la chaîne. Il lit `dev/model.local.glb` (non versionné) : y copier son GLB, ou passer `?model=…`. Voir [[Bancs de test]].
