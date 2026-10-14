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

## Où ça se règle (13 octobre 2026)

Toute l'apparence de la maison se règle dans le plan, bulle « Mon logement » : couleur et matière de façade, soubassement, toit (`plan.roof`, `plan.roofColor`). L'onglet Réglages n'a plus qu'un renvoi vers le plan ; il garde le jardin, le sol et le fond, qui sont le décor.

Ces réglages valent pour tous les niveaux : ils vivent sur le rez-de-chaussée. Quand on dessine un étage, la carte les injecte dans le niveau montré et les remonte à l'enregistrement (`HOUSE` dans `openPlanEditor`). L'ancien `rendering.roof` reste lu tant que le plan ne dit rien.

## Terrain et ciel (13 octobre 2026)

**Dans le plan.** « Mon logement » porte aussi le décor : ciel, jardin, style et couleur du sol, fond transparent. Ce sont des réglages de scène (`rendering`), pas du plan : l'éditeur les lit et les écrit par `opts.scenery`, hors de son historique (annuler n'y touche pas). L'onglet Réglages ne garde ces champs que pour une maison importée sans plan.

**Ciel peint** (`card/sky-paint.ts`, `rendering.sky_style`). Le ciel est peint une fois sur un canevas 4096 × 1024 (dégradé, nuages, étoiles), posé sur un dôme centré sur la caméra, dessiné en premier, sans brume ni exposition : les couleurs sont celles du canevas. Aucun fichier à télécharger.

- `auto` (défaut) : suit la météo de Home Assistant et l'heure. Dégagé par `sunny` / `clear-night`, quelques nuages par `partlycloudy`, vent ou sans météo connue, couvert pour tout le reste (pluie, neige, brouillard, nuageux).
- `clear`, `clouds` : fixes, mais suivent quand même jour, crépuscule et nuit.
- `studio` : dégradé sombre, toujours le même.
- `simple` : l'ancien dégradé physique de three.js.

Pièges rencontrés : `scene.background` avec une image équirectangulaire sortait flou (three la convertit en cube de 512) et délavé (elle passe par l'exposition). D'où le dôme à part. La brume reprend la couleur de l'horizon, atténuée de jour puisqu'elle, passe par l'exposition.

## Ciel : ce qui a été retenu (13 octobre 2026, suite)

Trois essais, un seul gardé :

1. **Nuages peints sur le canevas** (taches floues) : faisaient faux. Abandonné.
2. **Photos de ciel** (panoramas Poly Haven, CC0) : très réalistes, donc en décalage complet avec une maison stylisée et des arbres en facettes. Abandonné sur l'avis d'Esteban, rien n'en reste dans le dépôt.
3. **Nuages en volumes à facettes** (`SkyClouds` dans `card/sky-paint.ts`) : le même langage que le jardin et la maison. Retenu.

Les nuages : un seul maillage instancié (un appel de dessin), des boules à facettes dont l'ombrage est figé dans les couleurs des sommets, sans calcul de lumière. Ils suivent la caméra comme le dôme, donc sans parallaxe. Ils écrivent leur profondeur pour se recouvrir correctement entre eux, puis l'effacent (`renderer.clearDepth()` dans `onAfterRender`) pour que rien de la scène ne passe derrière. Ils sont placés bas (2° à 24° au-dessus de l'horizon) : une carte se regarde de haut, on ne voit que cette bande. Immobiles exprès : les faire dériver obligerait à redessiner en continu, ce qui coûte sur une tablette.

La nuit claire reste un fond sombre étoilé peint.

**Raccord sol et ciel.** Le ciel s'affiche tel que peint, alors que la brume (donc le sol au loin) passe par l'exposition et le rendu ACES : les deux ne se rejoignaient pas, d'où une coupure nette à l'horizon en sol infini, surtout la nuit. Deux corrections :

- le sol infini est un disque plein suivi d'une couronne qui s'efface (alpha par sommet) : il se fond dans le bas du ciel au lieu de finir sur une arête ;
- `untoned()` calcule la couleur de brume qui, une fois rendue, donne exactement celle de l'horizon. Pour les teintes claires ou vives (jour, couchant) le calcul demande des valeurs très fortes qui font une bande criarde à mi-distance : on retombe alors sur une simple atténuation.

Sous un ciel peint, la brume garde la couleur de l'horizon quelle que soit la météo (`_skyFog`) : le ciel porte déjà le temps qu'il fait.

## Balcons, terrasses et toits plats (14 octobre 2026)

La matière de façade (pierre, brique...) ne couvrait que les murs pleine hauteur côté dehors. Trois trous, corrigés :

- **Les murets des toits plats** et la bande de dalle entre deux étages étaient d'un aplat de couleur. Ils passent par `facadePiece()` (`plan/build.ts`) : même couleur, même motif, mêmes coordonnées de texture que les murs.
- **Un mur bas** (moins de 1,30 m : garde-corps de balcon, de terrasse) prend la façade des deux côtés, même quand une pièce (le balcon) le borde.
- **Un balcon ou une terrasse** (pièce dont moins de la moitié du tour est en murs pleine hauteur, test `enclosed()` dans `plan/graph.ts`, le même que pour le toit) compte comme dehors : le mur entre le salon et le balcon prend la façade côté balcon.

Un mur sans pièce d'aucun côté a aussi la façade sur le dessus et les chants.
