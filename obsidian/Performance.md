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

## Les meubles de l'éditeur de plan

Ils se chargent **après** la maison, donc après la fusion des objets immobiles (`StaticBatch`). Sans refaire la fusion, chaque meuble coûte environ **3 appels de dessin** (612 maillages pour les 217 meubles du catalogue).

Mesuré dans `dev/plan-harness.html`, maison « Maison » et 40 meubles :

| | appels de dessin |
|---|---|
| maison seule | 75 |
| 40 meubles, sans refusion | 284 |
| 40 meubles, refusionnés | **79** |

La refusion coûte **6 ms**, une fois par reconstruction du plan.

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

## Tablette, 11 octobre 2026 (« ça bug vraiment trop »)

Quatre causes trouvées et corrigées :

- **Lampes allumées ou éteintes = shaders recompilés.** Chaque lampe crée une vraie lumière ; three.js recompile tous les programmes quand le nombre de lumières visibles change. Mesuré sur le PC de dev : près d'une seconde gelée au premier allumage (7 programmes compilés), bien plus sur tablette. Désormais un **budget de lumières** par niveau (`anchorLights` : 8 haute, 3 équilibrée, 0 basse) : les lumières du budget restent visibles en permanence, seule leur intensité varie (`owlnestReal`, `stepTransitions`), celles de l'étage regardé d'abord (`_applyFloorLights`). Au-delà, une lampe ne se voit que sur sa pastille et ses vitres la nuit. Plus aucune recompilation en usage.
- **Flou sous chaque pastille** (`backdrop-filter`) : 25 flous recalculés sur la 3D à chaque image de mouvement. Retiré.
- **Pastilles placées par `left`/`top`** : une mise en page de la page par image et par pastille. Placées par la propriété `translate` (`placeAt`, repli `left`/`top` sur les vieux navigateurs).
- **Flou derrière les barres** (`.ow-surface`) : gardé en qualité haute seulement (`CardHud.setLite`, classe `ow-lite`).
- En prime : hors qualité haute, les ombres suivent les murs bas une fois qu'ils ont fini de descendre, plus à chaque image.

**Compteur de performances** : Réglages → Performance → « Afficher les performances », retenu sur l'appareil (`owlnest_perf_hud`). Images par seconde, temps total par image et part du rendu, appels de dessin, triangles, résolution, pastilles, lumières, qualité, matériel détecté.

## Glisser dans le plan (14 octobre 2026)

Chaque mouvement du doigt pendant un glissé dans le plan reconstruisait toute la maison en 3D, puis la regroupait (fusion des objets immobiles) : le dessin saccadait, surtout sur tablette. Désormais l'aperçu 3D n'est appliqué qu'au plus toutes les 120 ms (le dernier état demandé gagne) et le regroupement attend la fin du geste (`_planPreviewing`). Mesure sur le banc de test, 30 mouvements d'affilée : 1,24 s avant, 0,55 s après (le rythme de l'écran).
