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

## Le second modèle : un export Sweet Home 3D

Ajouté en août 2026 : `Modele3D/Small-flat-35mq-compressed.obj`, un appartement de 35 m². **Bien meilleur que le premier**, pour une raison qui change la conception des [[Ouvrants]].

### Il est nommé

816 groupes, avec la convention Sweet Home 3D :

```
sweethome3d_opening_on_hinge_1_door     ← le vantail
sweethome3d_hinge_1, sweethome3d_hinge_1_2   ← les gonds, en objets nommés
sweethome3d_window_pane_on_hinge_1     ← le vitrage ouvrant
sweethome3d_opening_on_hinge_1_handle  ← la poignée
wall_1_2 … wall_10_N · frame_door_Cube · room_11 · ground_1
```

> [!important] Les gonds sont dans le modèle
> La position du pivot est **donnée**, plus à deviner. `hingePivot()` et le choix « un côté / l'autre côté » deviennent un repli, pas la méthode principale. C'est aussi ce sur quoi s'appuie [[floor3d-card]].

### Il est propre

| | premier GLB | cet export |
|---|---|---|
| orientation | Z-up, sol à −216 | **Y-up, sol à 0** |
| étendue | 788 × 733 × 250 cm | 600 × 250 × 618 cm |
| unité | centimètres | centimètres |

### Mais 98 % de son poids est du mobilier

902 486 triangles au total, dont :

| | triangles | part |
|---|---|---|
| (groupes sans nom) | 259 920 | 28,8 % |
| `Kitchenware_144` | 154 112 | 17,1 % |
| `Kitchenware_110` | 115 200 | 12,8 % |
| … | | |
| **architecture** | **17 692** | **2,0 %** |
| mobilier et objets | 884 794 | 98,0 % |

Des tasses à café, des horloges, des livres aux pages modélisées. **L'architecture seule est cinq fois plus légère que le premier modèle.**

### Conversion

`scripts/obj2glb.mjs` — OBJ + MTL → GLB, en préservant **un nœud nommé par groupe**.

```bash
node scripts/obj2glb.mjs Modele3D/x.obj Modele3D/x-archi.glb "--only=^(wall|ground|room|frame|sweethome3d)"
```

| variante | filtre | taille | triangles |
|---|---|---|---|
| `flat-full.glb` | aucun | 20,2 Mo | 902 486 |
| `flat-lite.glb` | `--max-tris=2500` | 5,97 Mo | 196 892 |
| **`flat-archi.glb`** | architecture | **0,50 Mo** | **17 692** |

Seul `flat-archi.glb` est versionné ; les sources et les lourds sont ignorés.

> [!warning] Ne pas déréférencer les indices
> Première tentative : 79,5 Mo → **81 Mo**. En écrivant chaque triangle avec trois sommets uniques, on perd le partage que l'OBJ assurait. La déduplication par triplet `v/vt/vn` plus un index en `Uint16` ramène à 25 %.

Les textures ne sont pas embarquées (77 JPEG/PNG à côté de l'OBJ) : elles pèsent bien plus que la géométrie et un plan n'en a pas besoin.

### Mesures sur `flat-archi.glb`

```
141 mailles · analyse 12 ms  (contre 74 ms sur le premier modèle)
porte trouvée : sweethome3d_opening_on_hinge_1_door_72, 202 × 80 × 4 cm
0,76 ms par image, porte en mouvement
```

## Reproduire ces mesures

`dev/parts-harness.html` rejoue toute la chaîne. Il lit `dev/model.local.glb` (non versionné) : y copier son GLB, ou passer `?model=…`. Voir [[Bancs de test]].
