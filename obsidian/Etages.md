# Étages

Ajoutés le 10 octobre 2026. Voir [[Owlnest 2.0]], [[Import sh3d]], [[Vues des murs]].

## Le modèle (`plan/floors.ts`, testé)

- Le plan d'origine **reste le rez-de-chaussée** : tout le code qui lit un plan continue de marcher, et un plan enregistré avant n'a rien à convertir.
- Les étages sont dans `plan.floors` : `{ id, name, elevation, doc }`, `doc` étant un plan complet sans `floors`. `groundName` renomme le rez-de-chaussée.
- Tous les niveaux partagent **l'origine du rez-de-chaussée** : un mur dessiné au même endroit tombe pile dessus.
- `floorViews` liste les niveaux du bas vers le haut, `floorDoc` / `withFloorDoc` lisent et remplacent un niveau, `addFloor` en ajoute un au-dessus du dernier (murs et pièces repris, sans portes ni meubles, à `hauteur des murs + SLAB` (20 cm)), `removeFloor`, `renameFloor`, `floorOfHeight` (le niveau d'une hauteur, à 10 cm près), `allOpenings` (toutes les portes, pour accorder les ouvrants : « Porte 4 » continue d'un étage à l'autre).

## La 3D (`plan/house.ts`)

- `buildHouse(plan, actif)` construit le rez-de-chaussée et les étages **jusqu'à l'étage montré** : ceux du dessus ne sont pas construits, on voit dans l'étage comme dans un plain-pied.
- Chaque étage est un groupe `plan_floor_<id>` à `y = elevation`.
- Seul l'étage montré garde le marquage des murs bas : les numéros de mur sont propres à chaque plan, ceux d'un autre niveau désigneraient de mauvais murs.
- **Dalles** : chaque niveau sous l'étage montré est fermé par une dalle (`plan_slab_<id>`, pièces et murs, du haut de ses murs jusqu'à 2,5 cm sous le sol du niveau suivant). Là où l'étage est plus petit, on voit un toit plat gris béton au lieu de pièces à ciel ouvert (retour d'Esteban : « c'est pas très beau »). Les sols d'un étage ont l'épaisseur d'une dalle (`plan_under_<id>`), un balcon a l'air porté.
- **Toit plat soigné** (retour d'Esteban : « pas très beau de l'extérieur ») : seul le dessus des pièces est gris béton ; au-dessus des murs de façade, la dalle prend la couleur de la façade, qui monte ainsi d'un seul tenant jusqu'au **muret** (`PARAPET`, 35 cm) posé sur les façades, sauf sous l'emprise de l'étage (`parapets`, par tronçons de 10 cm le long de chaque mur). Les murs intérieurs restent gris toit. Une façade est un mur qui a une pièce d'un seul côté (`isFacade`).
- La maison est **centrée sur le rez-de-chaussée seul** (`groundBox`) : changer d'étage ne déplace rien de ce qui est posé.
- Les meubles sont posés par niveau, dans le groupe de leur étage. La libération de la mémoire ne descend jamais dans un `plan_items` (les meubles partagent les modèles en cache), quelle que soit sa profondeur.

## La carte

- L'étage montré est retenu par appareil et par scène (`owlnest_floor_<scène>` dans le stockage du navigateur).
- Le choix d'étage est **en tête de la barre des pièces** (pas un module de plus à placer). Il n'apparaît qu'avec deux niveaux ou plus.
- Changer d'étage reconstruit la maison et déplace la caméra de la différence de hauteur.
- Pièces, panneau de pièce, lampes allumées et température : seulement l'étage montré. Une pastille d'un autre étage est masquée ; une lampe d'un étage masqué reste éteinte (`light.userData.owlnestFloorOff`, respecté par `stepTransitions` dans `lights.ts`), sinon elle éclairerait l'étage du dessous.
- L'étage d'un appareil se déduit de sa hauteur (`floorOfHeight`) : rien à enregistrer de plus dans les ancres.

## L'éditeur de plan

- Il dessine **un niveau à la fois**. La barre des niveaux est en haut à gauche du dessin : toucher un autre niveau y passe, toucher le niveau actif le renomme, « + » ajoute un étage, la corbeille retire l'étage actif (jamais le rez-de-chaussée).
- Le niveau du dessous est montré **en filigrane** (pointillés) pour dessiner pile au-dessus.
- Changer de niveau vide l'historique : annuler ne traverse pas les étages.
- Il faut un rez-de-chaussée dessiné pour ajouter un étage.

## Le toit en pente (option)

- Réglage **Ambiance → Toit** : « Ouvert (voir dedans) » (défaut) ou « En pente » (`rendering.roof = 'hip'`).
- Posé sur le **dernier niveau, quand c'est lui qu'on regarde**, et visible seulement **murs debout**, hors édition (`_syncRoof`, `_updateRoofVisibility`) : les autres vues des murs servent à voir dedans.
- Calcul (`plan/roof.ts`, testé) : le contour extérieur du niveau (`planOutline` : arêtes des pièces qui n'appartiennent qu'à une pièce, au nu extérieur des murs), débord de 30 cm, puis un **squelette droit** : chaque façade recule en montant (pente 35°), avec deux sortes d'évènements, une façade qui disparaît et un angle rentrant qui coupe une façade (le contour se scinde). Chaque façade laisse des bandes, ce sont les pans. Marche pour rectangle, L, T, sommets au milieu d'une façade.
- Rendu : un seul maillage hors fusion (`owlnestLive`), une nuance par orientation de pan et un trait sur les arêtes, pour lire la forme même quand le soleil éclaire deux pans pareil.
- Le petit jour entre l'étage et la façade du dessous est bouché : la façade monte jusqu'au sol de l'étage.

## Reste à faire

- Escaliers, trémie dans la dalle, toit.
- Choisir l'étage dans l'éditeur de la maison (Appareils, Ouvrants) : aujourd'hui il suit l'étage montré par la carte.
- Rien n'a été essayé sur le vrai Home Assistant.
