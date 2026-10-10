---
tags: [fonctionnalite, import]
---

# Import sh3d

Déposer un fichier Sweet Home 3D (`.sh3d`) sur la carte, ou passer par le bouton de l'encart Sweet Home 3D de l'éditeur : la maison arrive en **plan modifiable**, pas en modèle figé. Code : `src/import/sh3d-home.ts` (lecture, conversion), `sh3d-furniture.ts` (meubles), `sh3d-migrate.ts` (compatibilité), `_importSh3d` dans la carte.

## Ce que contient un `.sh3d`

Une archive zip. Mesuré sur les six fichiers d'Esteban (octobre 2026) :

- `Home.xml` (depuis Sweet Home 3D 5.3) : la maison décrite. Un fichier plus ancien n'a que `Home`, un objet Java sérialisé : on refuse avec un message qui dit de le réenregistrer.
- Les modèles des meubles : soit une entrée seule (`3`, un OBJ sans MTL), soit un dossier (`17/ficus.obj` + `.mtl` + textures). Les PNG numérotés sont les icônes.
- **Aucun des six fichiers n'a de `<room>` ni de `<level>`** : les pièces se déduisent des murs fermés. Une maison dont les murs ne se rejoignent pas (MaisonHA) n'aurait donc presque pas de pièces ni de sols : voir plus bas comment on les ferme.

> [!important] Les matières sans MTL
> Un modèle du catalogue de Sweet Home 3D cite ses matières par leur nom (`flblonde`, `flgrey`, `amber`) sans fichier de matières : elles sont fournies par le logiciel. Leurs couleurs sont reconstituées d'après le nom (`namedColor`). Une couleur imposée au meuble (`color='FFAE7400'`) ou par matière (`<material>`) est cuite dans le GLB.

## Pièces et sols d'une maison mal fermée

Les six fichiers ont des murs qui ne se rejoignent pas : parfois de quelques centimètres (dessin rapide), souvent d'un à deux mètres (cuisine ouverte, palier). Sans espace fermé, pas de pièce, donc ni sol ni nom.

Deux passes, dans l'ordre :

1. **`closeGaps`** (graph.ts) : un bout de mur libre à moins de 30 cm d'un autre mur est prolongé jusqu'à lui ; deux bouts libres proches se rejoignent à l'angle de leurs murs. Deux murs parallèles (un mur doublé) ne sont jamais reliés.
2. **`closeOpenAreas`** (sh3d-home.ts) : les vraies ouvertures sont fermées par une **limite de pièce**, un mur de hauteur nulle. Elle n'est gardée que si elle ferme un espace de plus, et refusée si elle crée une pièce de moins de 0,8 m² (un liseré le long d'un mur). Deux bouts libres se relient jusqu'à 4 m, dans n'importe quelle direction : c'est le côté ouvert d'une pièce en U.

Une limite de pièce (`isBoundary`) ferme l'espace pour le calcul des pièces, n'a ni semelle ni volume en 3D, et se dessine en pointillés dans l'éditeur, où on peut « en faire un mur ». C'est un mur ordinaire de hauteur 0 : aucun format nouveau, les scènes existantes ne changent pas.

Mesuré : MaisonHA passe de 2 pièces à 4 (toutes avec un sol), cuisine1 de 0 à 1, azaz de 2 à 6.

## Conventions vérifiées

- Centimètres, `y` vers le bas du plan, angles en radians dans le sens horaire : comme notre plan, en mètres. Rotation d'un meuble : `angle × 180 / π`, sans changement de signe (vérifié à l'œil sur MaisonHA : canapé, rideaux, chaises).
- Côté **droit** d'un mur (`rightSideColor`) : à droite en marchant du début à la fin sur le plan, `(-dy, dx)`. Vérifié : le mur nord de MaisonHA a sa face droite peinte, côté maison.
- Un meuble importé garde son **élévation explicite**, même 0 : sinon la hauteur automatique poserait une chaise glissée sous une table *sur* la table.

> [!warning] Non vérifié
> Le sens de courbure d'un mur courbe (`arcExtent`) et le côté d'ouverture d'une porte (gonds, battant) sont déduits sans exemple pour comparer. Aucun des six fichiers n'a de mur courbe.

## Compatibilité avec l'ancien import (export OBJ)

Avant, on importait l'**export OBJ** : un modèle en centimètres, Y en haut, recentré sur le centre de sa boîte (`_loadModel`). Ancres, vues et ouvrants sont posés dans ce repère.

À l'import d'un `.sh3d` par-dessus, on compare la boîte des **murs** de l'ancien modèle (l'export les nomme `wall_…`) à celle des murs du `.sh3d` : échelle et axes se retrouvent (`fitSh3d`, Y en haut ou Z en haut passé par Blender). Au-delà de 5 % d'écart, ce n'est pas le même logement : on ne déplace rien et on le dit.

Mesuré dans le banc : une ancre posée au-dessus du canapé retombe au même endroit à **0,2 mm** près ; un ouvrant relié à un capteur passe au vantail de la nouvelle porte avec capteur, nom, durée, couleurs et états d'ouverture. Un ancien ouvrant sans porte à moins de 80 cm est perdu, et l'import le dit.

## Limites assumées

- Un seul niveau : le plus bas qui a des murs.
- Mur en pente : droit, à mi-hauteur.
- Les modèles de portes et fenêtres de Sweet Home 3D ne sont pas repris : l'éditeur construit les siens.
- Chaque modèle de meuble est envoyé à l'intégration (un envoi par variante). MaisonHA : 19 envois, 3,2 Mo. Un modèle de plus de 8 000 triangles est allégé.

Voir [[Chantiers ouverts]] : les murs bas mis de côté attendaient justement ces données.

## Plusieurs niveaux (10 octobre 2026)

Depuis le 10 octobre (soir), **tous les niveaux qui ont des murs** sont importés : `homeToHouse` appelle `homeToPlan(home, names, levelId)` pour chacun, le plus bas devient le rez-de-chaussée, les autres des étages à `(élévation du niveau − celle du plus bas) × 0,01` m. Sweet Home 3D met tous les niveaux dans le même repère : ils tombent pile les uns sur les autres. Chaque meuble garde son niveau (`PendingItem.floor`, puis `FurnitureImport.floors`). La question « quel niveau importer ? » a disparu. Voir [[Etages]].
