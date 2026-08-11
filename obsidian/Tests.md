---
tags: [atelier]
---

# Tests

**64 tests, zéro dépendance ajoutée.** `npm test`.

## Le montage

`scripts/test.mjs` compile les modules testables avec **esbuild** — déjà présent via Vite — puis laisse `node --test` exécuter les `*.test.mjs`. Pas de framework.

L'arborescence de `src/` est reproduite telle quelle, pour que les imports relatifs des tests fonctionnent sans réécriture.

Deux détails qui ont demandé une correction :

> [!important] Le dossier de build reste **dans le projet** (`.test-build/`)
> Les tests de géométrie importent `three`. Depuis `%TEMP%`, Node ne sait pas le résoudre. Placé dans le projet, la résolution remonte jusqu'à `node_modules/`.

> [!important] `three` reste **externe** au bundle (`--external:three`)
> L'embarquer ferait cohabiter deux jeux de classes : un `Box3` construit par le test ne serait plus reconnu par le module testé.

## Répartition

| domaine | tests |
|---|---|
| [[Regles]] — moteur | 23 |
| [[Ouvrants]] — géométrie (`parts.ts`) | 14 |
| [[Ouvrants]] — exécution (`parts-runtime.ts`) | 27 |

## Ce qui vaut la peine d'être testé ici

Pas la couverture — les **invariants qu'un coup d'œil ne vérifie pas**.

- « le gond n'est jamais au centre du vantail » : un pivot central fait traverser le mur, et un test d'angle ne le verrait pas.
- « une rotation autour du gond garde le vantail dans l'embrasure ».
- « un capteur numérique ne bloque pas la porte grande ouverte » — régression documentée dans [[Descripteurs]].
- « configure applique un réglage **sans redécouper le modèle** » : vérifie l'identité de l'objet géométrie et le nombre de triangles de la maille.
- « le premier appel ne déclenche rien, il mémorise » — comportement voulu du moteur de [[Regles]].

## Ce qui a été attrapé avant livraison

Un seul, mais il en valait la peine : le **déclencheur numérique sur attribut** ne pouvait jamais partir, l'instantané ne gardant que la chaîne d'état. Tous les autres bugs de [[Pieges]] ont été trouvés en production.

## Vérification des types

`npm run typecheck` → `tsc --noEmit`.

> [!warning] esbuild supprime les types sans les lire
> Pendant longtemps **rien** ne les vérifiait. Le premier passage a trouvé 3 erreurs dans 10 735 lignes.

À lancer systématiquement avant `npm run build`.
