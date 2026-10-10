# Apparence de la maison

Ajoutée le 11 octobre 2026, à la demande d'Esteban : « la maison ressemble toujours à un bloc pas beau, ça manque de charme et de personnalisation ». Voir [[Interface]], [[Etages]].

## Façade (plan)

- `plan.facade` : `smooth` (défaut), `render` (crépi), `brick`, `wood` (bardage), `stone`. Motifs dessinés sur canevas (`facadeTexture`, `plan/textures.ts`), clairs, teintés par `plan.outside`. Taille d'un motif : `FACADE_METERS`.
- Les faces verticales des prismes ont des UV le long du mur (`u` = projection sur la direction de l'arête, mesurée dans la scène : deux morceaux d'un même mur se raccordent), `v` = hauteur.
- Seules les faces côté dehors prennent la matière (`Palette.facade`) ; côté pièce, la peinture.
- `plan.plinth` : soubassement de 35 cm, 1,5 cm en saillie, teinte `plinthColor` (la façade désaturée et plus sombre, jamais sous une luminosité de 0,3). Coupé aux portes (pas de morceau de mur au sol à leur place). Marqué comme mur : il s'abaisse avec lui (murs bas).
- Les étages reprennent la façade du rez-de-chaussée, sauf la leur (`buildHouse`). Choisir une couleur ou une matière dans Réglages l'applique à toute la maison (les réglages propres aux étages sont effacés).
- Réglable dans **Réglages → Apparence** et dans la bulle **Mon logement** de l'éditeur de plan (palette `FACADE_COLORS`).

## Jardin (scène)

- `rendering.garden` : `none` (défaut), `some`, `lush`. `card/garden.ts` : troncs, boules et cônes de feuillage, buissons, en quatre `InstancedMesh` (quatre appels de dessin quel que soit le nombre). Tirage fixe, hors de la maison (sa boîte plus 1,6 m), dans le sol. Unités : mètres, ou centimètres si la maison dépasse 100 unités.
- Planté avec le sol (`EnvironmentController.addGround`), retiré avec lui.
- Pelouse : un grain très léger (`grassTexture`), répété tous les 2 m.

## Ombre au pied des murs

- Couleurs par sommet sur les murs (`aoAt` dans `build.ts`) : 35 % plus sombre au ras du sol, s'estompe sur 1,20 m. Calculé une fois : aucun coût à l'affichage. Matières `Palette.wall` / `facade` avec `vertexColors`.

## La nuit

- L'ambiance de nuit relevée (facteur 1,1 en vitrine, teinte bleutée plus claire) : la maison reste lisible le soir sur une tablette.
- **Vitres allumées** : chaque ouverture connaît les pièces de part et d'autre (`userData.owlnestRooms`, posé par `buildOpening`). La nuit (`EnvironmentController.isNight`, soleil réel ou simulé), les vitres d'une pièce dont une lampe est allumée prennent une matière chaude partagée (`litGlass`). `_updateWindowGlow` ne retouche rien si la nuit, les lampes et la maison n'ont pas changé.

## Réglages réorganisés

- Sections : **Scène**, **Apparence** (façade, toit, jardin, sol, fond), **Lumière** (soleil, ambiance, luminosité, ombres, pas de soleil par le haut), **Caméra et pastilles** (zooms, inclinaison en degrés, voir à travers, regroupement en pixels), **Performance** (matériel détecté replié), **Langue**.
- Mode du soleil et orientation passent dans **Ambiance**, sous l'entité soleil (et n'apparaissent qu'avec elle) ; la brume aussi.
- Interrupteurs à la place des cases à cocher, choix en boutons, pastilles de couleur avec une pastille « la mienne ».
- **Corrigé** : chaque réglage renvoyait toute la section rendu figée à l'ouverture du menu (un réglage en annulait un autre) ; le menu n'envoie plus que ce qui change, la carte fusionne. Les intensités de lumière n'agissaient pas sans entité soleil, et la météo écrasait le cycle du soleil (une nuit pluvieuse redevenait claire) : l'éclairage est maintenant réglage × cycle du soleil × météo.
- **Corrigé** : le sol se pose sous le point le plus bas de la maison (une maison chargée sur son étage flottait 1,4 m au-dessus).
