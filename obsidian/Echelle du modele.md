---
tags: [architecture, contrainte]
---

# Échelle du modèle

> [!important] Owlnest n'impose aucune unité
> Un modèle peut arriver en mètres, en centimètres ou en pouces. Tout ce qui
> dépend d'une distance se déduit de son **envergure**, jamais d'une constante.

C'est un choix produit, pas une commodité technique. Demander à l'utilisateur de
remettre son plan à l'échelle dans Blender — ou de lancer un script — revient à
lui demander de ne pas utiliser la carte. Voir [[floor3d-card]], dont c'est
précisément la barrière d'entrée.

## La grandeur de référence

`_modelSpan` : la plus grande dimension de la boîte englobante du modèle.

| modèle | envergure |
|---|---|
| une maison en mètres | ~12 |
| un export Sweet Home 3D en centimètres | 600 à 800 |

`verticalAxis()` complète le repère : une habitation est toujours plus étendue au
sol qu'en hauteur, donc l'axe de plus faible étendue est la verticale. Marche sur
un export Y-up comme Z-up.

## Ce qui s'y adapte

| réglage | règle |
|---|---|
| taille des vignettes de caméra | fraction de l'envergure |
| limites d'orbite | `0,05 × span` à `3 × span` |
| plan de coupe proche | `0,1 × distance minimale d'orbite` |
| plan de coupe éloigné | `8 × span` |
| densité du brouillard | `réglage × 10 / span` |
| séparation des dalles coplanaires | `2e-3 × span` |
| écart du sol du décor sous le modèle | `2 × 2e-3 × span` |
| écart du plan d'occlusion au-dessus | `2e-3 × span` |
| cotes du gizmo d'ancre | multiples du rayon de marqueur |
| seuil d'arrivée d'un vol caméra | `5e-4 × span` |
| plan proche et biais des ombres | fraction de la portée |
| **portée des lumières** | `8 × span / 12` |
| **intensité des lumières** | `3 × (span / 12)²` |

Un réglage saisi explicitement par l'utilisateur est toujours respecté : il est
exprimé dans l'unité de *son* modèle. Seules les valeurs par défaut se
transposent.

## Le piège du carré

> [!danger] L'intensité ne suit pas la distance, elle suit son carré
> `THREE.PointLight` avec `decay: 2` obéit à la loi du carré inverse :
> l'éclairement reçu vaut `intensité / distance²`.
>
> Éloigner tout d'un facteur 51 demande donc **2 652 fois** plus d'intensité, pas
> 51 fois. Corriger seulement la portée laisse la lampe invisible.

Vérification de l'invariant, à position relative égale :

```
mètres       éclairement 2.083
centimètres  éclairement 2.083
```

Valeurs obtenues sur un modèle réel de 618 unités :

```
portée par défaut     8  →  412
intensité             3  →  7 957 candelas
```

## Symptômes déjà rencontrés

Tous avaient la même cause et des apparences différentes — c'est ce qui les rend
coûteux à diagnostiquer.

- **« On ne voit même pas la lumière »** — portée de 8 cm, intensité noyée.
- **« Plus on zoome, plus la vignette rétrécit »** — taille demandée en mètres.
- **« La caméra est bloquée, on ne voit qu'un mur »** — orbite plafonnée à 100.
- **« Tout est bleu, le modèle ne charge pas »** — brouillard saturé dès 3 m.
- **Scintillement des sols** — plan de coupe proche collé à zéro, précision de
  profondeur ruinée. Voir [[Pieges]].
- **« Le gizmo d'ancre est invisible »** — flèches de 6 mm, zone cliquable de 1 mm.
- **« Ça scintille dès que j'active un sol »** — décor posé un dixième de
  millimètre sous le plancher.
- **Rayures sombres sur les murs éclairés** — acné d'ombre, plan proche du
  frustum d'ombre non proportionné.

> [!warning] Un piège en corrigeant ces écarts
> Descendre le sol du décor d'un écart ramenait le disque du podium — placé à
> `sol + écart` — exactement sur le plancher du modèle. Après toute modification
> d'un empilement, vérifier **toutes** les altitudes, pas seulement celle qu'on
> vient de bouger.

> [!tip] Réflexe
> Devant un symptôme visuel inexplicable sur un nouveau modèle, vérifier
> l'envergure avant toute chose. Quatre bugs distincts sur cinq venaient de là.
