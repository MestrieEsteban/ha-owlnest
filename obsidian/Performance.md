---
tags: [architecture, contrainte]
---

# Performance

> [!important] La cible n'est pas la machine de dev
> Owlnest tourne sur une **tablette bon marché fixée au mur**. C'est la contrainte structurante du projet : on met rarement une bonne tablette en dashboard.

## Profils de qualité

`src/quality.ts` — `'auto' | 'high' | 'balanced' | 'low'`.

```ts
interface QualityProfile {
  anchorShadows: boolean; anchorShadowMap: number; sunShadowMap: number;
  shadowFilter: THREE.ShadowMapType; maxPixelRatio: number; antialias: boolean;
  particleScale: number; cardTextureWidth: number;
  maxFps: number; cameraRefreshMs: number;
}
```

`detectLevel()` décide d'après la chaîne GPU, `hardwareConcurrency` et le ratio de pixels.

> [!tip] Le gain le plus important, de loin
> `balanced` et `low` mettent `anchorShadows: false`.
>
> Une lumière ponctuelle qui projette une ombre fait rendre la scène **six fois** (cube map). C'est le premier poste de coût sur GPU faible, avant la résolution et l'antialiasing.

## Autres leviers en place

- **Rendu à la demande** : `_dirty` / `_requestRender()`. On ne dessine que si quelque chose a changé.
- **Plafond d'images par seconde** (`maxFps`), avec une tolérance pour ne pas rater une image quand le pas de l'écran ne divise pas l'intervalle.
- **Pause hors écran** : `_setupVisibility()` — onglet HA masqué, écran éteint, carte hors du viewport → aucun GPU consommé.
- **Ombres du soleil non recalculées en continu** : `shadowMap.autoUpdate = false` + `_requestShadowUpdate()`.
- **Frustum d'ombre ajusté au modèle** : `_fitSunShadow()`.
- Flux caméra cadencé par `cameraRefreshMs`.

## Le principe qui guide les nouveautés

**Le calcul lourd va dans l'éditeur ; la tablette lit un résultat.**

Illustration avec les [[Ouvrants]] : l'analyse en composantes connexes coûte ~70 ms pour 92 407 triangles. Elle a lieu **une fois, dans l'éditeur**. La scène ne mémorise qu'un triangle d'amorce par ouvrant, et l'exécution se contente de le retrouver.

Coûts mesurés :

| | |
|---|---|
| analyse complète du modèle | 68–94 ms |
| extraction d'une pièce | 3,5 ms |
| une image avec une porte en mouvement | 0,50 ms |

## Poids du bundle

~1,20 Mo, 278 Ko gzip. Dominé par `three`.

## À surveiller

L'échelle en centimètres de [[Modele 3D]] fausse `lights.distance`, les limites d'orbite et la densité du brouillard d'un facteur ~100. Pas encore corrigé — voir [[Chantiers ouverts]].
