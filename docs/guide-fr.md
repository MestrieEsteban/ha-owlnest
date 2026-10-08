# Owlnest — guide complet

🇬🇧 [English version](guide.md) · ← [Retour au README](../README-FR.md)

- [Importer votre plan](#importer-votre-plan)
- [Navigation dans la scène](#navigation-dans-la-scène)
- [Ancres](#ancres)
- [Ouvrants](#ouvrants)
- [Vues caméra](#vues-caméra)
- [Moteur de règles](#moteur-de-règles)
- [Environnement](#environnement)
- [Rendu et apparence](#rendu-et-apparence)
- [Raccourcis clavier (mode édition)](#raccourcis-clavier-mode-édition)
- [Configuration YAML complète](#configuration-yaml-complète)

---

## Importer votre plan

[▶ Voir la vidéo de l'import](https://www.youtube.com/watch?v=4hBuNCvALFA) (2 min, en anglais).

Glissez votre plan sur la carte, ou cliquez sur **Importer mon plan** (bandeau de la démo, ou haut de l'onglet **Config** de l'éditeur) et choisissez les fichiers. La carte accepte :

- le dossier exporté par **Sweet Home 3D** (**Vue 3D → Exporter au format OBJ**), ses fichiers sélectionnés ensemble, ou un zip de ce dossier ;
- un fichier `.glb`. Un `.gltf` ne s'importe pas tel quel : exportez plutôt un `.glb`.

La conversion se fait dans votre navigateur, textures comprises. Le modèle est ensuite envoyé à Home Assistant, rangé dans `config/owlnest/models/` et affiché aussitôt. Seuls les administrateurs peuvent importer ; la limite est de 300 Mo.

### Alléger un plan lourd

Quand un plan est lourd pour une tablette murale (plus de 150 000 triangles, ou des textures de plus de 1024 px), la carte propose de l'alléger avant la conversion, et affiche le gain attendu :

- les **petits objets très détaillés** (vaisselle, plantes, robinets) sont simplifiés, à 1 % de leur taille près ;
- les **grandes textures** sont réduites à 1024 px.

Murs, sols, portes et fenêtres ne sont jamais touchés : ouvrants et ancres restent exacts. L'option est décochée par défaut ; la carte retient votre dernier choix.

### Portes et fenêtres repérées pour vous

Sweet Home 3D nomme les gonds et les parties mobiles de ses portes et fenêtres. À l'import, la carte transforme chaque porte et fenêtre en ouvrant tout réglé : gonds du bon côté, ouverture vers l'intérieur du logement, vantaux coulissants l'un vers l'autre. Les portes de placard et d'électroménager sont laissées de côté. Il ne reste qu'à choisir le capteur de chaque ouvrant dans l'onglet **Ouvrants**.

Si la scène a déjà des ouvrants, la carte demande : **Garder les miens**, **Ajouter les nouveaux** ou **Remplacer**. Remplacer garde le capteur, le nom, les couleurs et le sens de chaque porte ou fenêtre encore présente, et retire les ouvrants de l'ancien modèle. Le même choix existe dans l'onglet **Ouvrants**.

### Importer à nouveau

Glissez à nouveau votre plan après l'avoir retouché dans Sweet Home 3D : ancres, règles, cartes et vues caméra sont gardées, et la caméra cadre le nouveau modèle. Importer par-dessus la maison de démo repart d'une scène vierge. Un plan importé passe devant le `model_url` de la carte.

---

## Navigation dans la scène

| Action | Souris | Tactile |
|---|---|---|
| Orbiter | Clic gauche + glisser | Un doigt + glisser |
| Zoomer | Molette | Pincer |
| Panoramique | Clic droit + glisser | Deux doigts + glisser |

---

## Ancres

Les ancres sont des points interactifs placés dans la scène 3D. Chaque ancre est liée à une entité Home Assistant.

<p align="center">
  <img src="../assets/moveLight.gif" alt="Déplacement d'une ancre dans l'éditeur" width="600" />
</p>

### Domaines supportés

| Domaine | Comportement | Visuel |
|---|---|---|
| `light` | Crée une lumière 3D synchronisée (couleur + intensité) | Point lumineux avec ombre |
| `switch` | On/off toggle | Icône interrupteur |
| `sensor` | Affiche la valeur en temps réel | Étiquette avec valeur |
| `binary_sensor` | Indicateur on/off | Point coloré |
| `cover` | Reflète le % d'ouverture | Barre de progression |
| `climate` | Indicateur de mode (chauffage/refroidissement) | Orange/bleu selon l'action |
| `media_player` | Indicateur lecture/pause | Icône media |


### Styles de lumière

Pour les entités `light`, trois styles sont disponibles :

| Style | Description |
|---|---|
| `point` | Lumière omnidirectionnelle (ampoule classique) |
| `spot` | Faisceau conique dirigé (spot encastré) |
| `beam` | Faisceau étroit et concentré (projecteur) |

Le style et la direction se configurent dans les propriétés de l'ancre en mode édition.


### Interactions

- **Clic court** → Toggle l'entité (allumer/éteindre la lumière, ouvrir/fermer le volet…)
- **Appui long** → Ouvre le panneau `more-info` de Home Assistant pour l'entité

### Visibilité conditionnelle

Chaque ancre peut être masquée/affichée selon l'état d'une entité :

> *Exemple : n'afficher le capteur de température de la chambre que lorsque la porte est ouverte.*

Configurez cela dans les propriétés de l'ancre → **Visible si** dans l'éditeur.

### Options avancées

| Option | Description |
|---|---|
| `label` | Texte personnalisé affiché sur l'étiquette |
| `icon` | Icône MDI personnalisée (ex: `mdi:thermometer`) |
| `precision` | Nombre de décimales pour les capteurs (ex: `0` → "18", `1` → "17.6") |
| `lightIntensity` | Multiplicateur d'intensité lumineuse (défaut: 1) |

---

## Ouvrants

<p align="center">
  <img src="../assets/openings.gif" alt="Une porte qui s'ouvre avec son entité, poignée et couleur d'état comprises" width="600" />
</p>

Les ouvrants sont des pièces de votre modèle (portes, fenêtres, volets, porte de lave-vaisselle ou de four, fauteuil inclinable) qui bougent quand une entité Home Assistant s'ouvre ou se ferme. Le fichier du modèle n'est pas modifié : pivoter, coulisser et se dérouler détachent la pièce dans la carte ; **Joue les animations du modèle** pose les nœuds déjà enregistrés dans le GLB.

> Plan importé depuis Sweet Home 3D ? Portes et fenêtres sont ajoutées pour vous, toutes réglées : voir [Portes et fenêtres repérées pour vous](#portes-et-fenêtres-repérées-pour-vous). Les étapes ci-dessous servent pour tout le reste.

### Ajouter un ouvrant

1. Mode édition → onglet **Ouvrants** → **+ Ouvrant**
2. Cliquez la porte, la fenêtre ou le volet sur le modèle
3. Réglez-le dans le panneau qui s'ouvre, vérifiez le mouvement avec **Aperçu**, puis enregistrez la scène

Le panneau est une fenêtre flottante : déplacez-la par son en-tête pour voir le modèle derrière, et continuez à tourner autour pendant qu'elle est ouverte. **Annuler** (ou **Échap**) abandonne vos changements, ou supprime un ouvrant tout juste créé. Ouvrir un autre ouvrant conserve les réglages du précédent ; quitter le mode édition ferme le panneau.

### Choisir ce qui bouge

L'arborescence **Objet** liste les objets et groupes du modèle, comme l'outliner de Blender. Survolez une ligne pour la surligner dans la vue, cliquez-la pour en faire la pièce mobile : un groupe bouge avec tout son contenu. La pièce cliquée est révélée et sélectionnée à l'ouverture du panneau ; **Pièce cliquée** revient au seul morceau de maille. Le filtre recherche par nom.

### Options

| Option | Description |
|---|---|
| **Nom** | Affiché dans la liste des ouvrants et l'en-tête du panneau |
| **Entité** | Pilote le mouvement. Les entités `cover` suivent `current_position` ; `cover`, `valve`, `lock`, `binary_sensor`, `switch`, `light`, `input_boolean`, `fan` et `group` sont lues comme ouvert/fermé |
| **Mouvement** | **Pivote** (porte, fenêtre à battant), **Coulisse** (volet roulant, baie), **Se déroule** (store banne, store, rideau — voir plus bas) ou **Joue les animations du modèle** (pistes NLA de Blender dans le GLB — voir plus bas) |
| **Rotation** | Battants uniquement. **Verticale** pour une porte, **Horizontale** pour un lave-vaisselle, un four ou une fenêtre à soufflet |
| **Côté des gonds** | L'arête qui porte les gonds : un côté / l'autre, ou **En bas** / **En haut** pour une rotation horizontale |
| **S'ouvre vers** | Le côté du mur vers lequel pivote le vantail. Le modèle ne sait pas où est l'intérieur : vérifiez à l'aperçu et inversez si besoin |
| **Angle d'ouverture** / **Se retire vers** / **Course** | Amplitude et sens du mouvement |
| **Durée** | Durée de l'animation, en secondes |
| **Inverser** | Pour les entités dont « ouvert » dans Home Assistant signifie fermé à l'écran |
| **Couleur fermé** / **Couleur ouvert** | Teinte facultative de l'objet dans chaque état (**Aucune** pour désactiver). Entre les deux, la teinte suit le mouvement |

Pour supprimer un ouvrant, cliquez son bouton de suppression dans la liste, puis cliquez à nouveau dans les 3 secondes pour confirmer.

### Stores bannes, stores et rideaux (Se déroule)

Un ouvrant **Se déroule** replie l'objet choisi le long d'une direction, vers une arête fixe. Le modèle le montre **grand ouvert** ; en se fermant, il se replie vers l'arête fixe. Pour un store banne, choisissez seulement la **toile** dans l'arborescence « Objet », pas le coffre ni les bras : ce sont des objets séparés, ils ne sont donc pas écrasés.

En passant à **Se déroule**, Owlnest mesure la toile : son arête horizontale le long du mur, la direction qui descend en s'en éloignant, et son inclinaison. Tout reste modifiable, et **↺ Détecter à nouveau** revient aux valeurs mesurées.

| Option | Description |
|---|---|
| **Se replie le long de** | **Sortant du mur** (store banne, incliné selon l'inclinaison), **La verticale** (store, rideau qui se relève) ou **Le mur** (rideau qui se tire de côté). L'axe détecté est signalé |
| **Inclinaison sous l'horizontale** | Axe sortant du mur uniquement. 0° sort à plat, 90° descend le long du mur. Par défaut, celle de la toile |
| **Arête fixe** | L'arête qui ne bouge pas : contre le mur / en haut / à un bout par défaut, ou l'arête opposée |
| **Taille ouvert** / **Taille fermé** | Taille le long de l'axe à 100 % et à 0 %, par rapport au modèle. Par défaut 100 % et 0 %. Quelques pour cent une fois fermé laissent voir un liseré de toile |
| **Fermé à** | **0 %** pour un `cover` standard (100 % = grand ouvert). **100 %** pour un volet qui rapporte l'inverse. C'est le même réglage que **Inverser** |
| **Suit l'arête mobile** | Objets qui se déplacent avec l'arête libre sans être étirés, comme la barre de charge d'un store. Ceux qui touchent cette arête sont suggérés d'office (★). Ils sont surlignés en bleu dans la vue et prennent aussi la teinte d'état |

Un `cover` qui rapporte `current_position` s'affiche à cette position. Un `cover` sans position s'affiche grand ouvert ou fermé.

> **Exemple** : dans un modèle où chaque store est fait de `motor` (coffre), `tela` (toile) et `extremo` (barre de charge, enfant de la toile), choisissez `tela` puis **Se déroule**. L'inclinaison est détectée et `extremo` est proposé comme suiveur. Seule la toile se replie : la barre remonte jusqu'au coffre.

> **Astuce** : le gond est placé sur l'arête de la boîte englobante de la pièce, pas sur l'origine de l'objet dans Blender.

### Animations du modèle (NLA de Blender)

Si le GLB contient des animations glTF (option **NLA Tracks** à l'export Blender), un ouvrant peut **jouer ces animations** au lieu de pivoter, coulisser ou se dérouler. La position de l'entité parcourt la piste : 0 % est la première image clé, 100 % la dernière, et 40 % reste à 40 % du chemin — comme un volet. Choisissez une ou plusieurs animations ; elles avancent toutes ensemble.

Ce mouvement ne détache rien : les pistes posent les nœuds qu'elles animent déjà. L'arborescence Objet et les pièces emmenées par l'ouvrant sont masquées ; le surlignage et la teinte prennent le parent commun de ces nœuds (le canapé, pas toute la maison). La durée reprend celle de l'animation pour la jouer à la vitesse de Blender ; vous pouvez encore la changer.

On peut poser plusieurs de ces ouvrants sur le même objet (un `cover` pour l'inclinaison droite, un autre pour la gauche). Un clic ne rouvre un ouvrant que s'il tombe sur un nœud que cet ouvrant anime vraiment — pas le canapé entier.

Si deux ouvrants reçoivent des animations qui bougent le même nœud, c'est le dernier posé à chaque image qui l'emporte. Préférez des ensembles de pistes disjoints.

Exportez depuis Blender avec **Animation → NLA Tracks**. Les actions qui commencent à l'image 1 (et non 0) sont gérées. three.js assainit les noms (`tela.001` → `tela001`).

> **Exemple** : un fauteuil inclinable exporté en `Reclinar_Der`, `Reclinar_Izq`, `Cabezal_Der`, `Cabezal_Izq`. Liez le `cover` de droite à `Reclinar_Der` et `Cabezal_Der` : les deux mécanismes suivent la position de ce volet. Un second ouvrant avec le `cover` de gauche et les deux pistes `*_Izq` laisse le côté droit tranquille.

---

## Vues caméra

Les vues caméra vous permettent de sauvegarder des points de vue et de naviguer entre eux avec une animation fluide.

### Utilisation

1. Mode édition → onglet **Camera** (ou cliquez l'icône 📷 dans la barre d'outils)
2. Positionnez la caméra où vous voulez
3. Cliquez **Capturer la vue** et donnez un nom
4. La vue apparaît dans la barre de navigation en bas de la scène

<p align="center">
  <img src="../assets/vue.gif" alt="Navigation entre vues caméra" width="600" />
</p>

### Vues cachées

Une vue peut être marquée comme **cachée** : elle n'apparaît pas dans la barre de navigation mais reste utilisable par les règles (ex: « voler vers la cuisine quand un mouvement est détecté »).


---

## Moteur de règles

Les règles permettent de créer des automatisations visuelles internes à la scène 3D.

### Structure d'une règle

```
QUAND  [trigger]       →  un changement d'état se produit
SI     [conditions]    →  toutes les conditions sont vraies (optionnel)
ALORS  [actions]       →  exécuter une ou plusieurs actions
```

### Triggers

| Type | Description |
|---|---|
| **Changement d'état** | Se déclenche quand l'état d'une entité change. Filtres optionnels `de` et `vers` |

*Exemple : « Quand `binary_sensor.mouvement_salon` passe de `off` à `on` »*

### Conditions

Les conditions filtrent l'exécution (logique **ET** : toutes doivent être vraies).

| Opérateur | Description |
|---|---|
| `=` | Égal |
| `≠` | Différent |
| `>` `<` `≥` `≤` | Comparaisons numériques |
| `contient` | Le texte contient la valeur |

Chaque condition peut être **inversée** (mode « Masquer si »).

### Actions

| Action | Description |
|---|---|
| **Aller à la vue** | Anime la caméra vers une vue sauvegardée |
| **Mettre en évidence** | Fait pulser une ancre dans la couleur de votre choix |
| **Message** | Affiche un court message dans la carte |
| **Appeler un service** | Appelle un service HA (ex: `light.turn_on`, `notify.mobile`) |

### Exemple concret

> **Règle « Alerte intrusion »**
> - Trigger : `binary_sensor.porte_entree` passe à `on`
> - Condition : `alarm_control_panel.maison` = `armed_away`
> - Actions :
>   - Aller à la vue « Entrée »
>   - Mettre en évidence l'ancre `light.entree` en rouge
>   - Message « Quelqu'un à la porte »

<p align="center">
  <img src="../assets/rules.gif" alt="Moteur de règles en action" width="600" />
</p>

---

## Environnement

Owlnest peut synchroniser l'éclairage ambiant et les effets météo avec vos entités Home Assistant.

### Soleil

Configurez `sun_entity: sun.sun` pour que la lumière du soleil suive la position réelle.

| Mode | Description |
|---|---|
| **Showcase** | Lumière douce et flatteuse, idéale pour la présentation |
| **Réaliste** | Position solaire fidèle à la réalité, avec prise en compte de l'orientation de la maison |

En mode **réaliste**, configurez `house_orientation` (en degrés) pour aligner le nord du modèle avec le nord réel :
- `0` = la face avant du modèle pointe vers le nord
- `90` = la face avant pointe vers l'est

### Météo

Configurez `weather_entity: weather.maison` pour des effets visuels dynamiques :

| État HA | Effet visuel |
|---|---|
| Ensoleillé / Nuit claire | Aucun effet |
| Nuageux | Lumière tamisée, brume légère |
| Pluie | Particules de pluie |
| Pluie forte | Pluie dense |
| Orage | Pluie + éclairs |
| Neige | Particules de neige |
| Brouillard | Brouillard dense |
| Grêle | Particules de grêle |
| Vent | Effet de vent |


<p align="center">
  <img src="../assets/meteo.gif" alt="Effets météo et soleil" width="600" />
</p>

---

## Rendu et apparence

Tous les paramètres de rendu se configurent dans l'onglet **Config** de l'éditeur.

| Paramètre | Description | Défaut |
|---|---|---|
| `shadows` | Active les ombres portées | `false` |
| `exposure` | Luminosité globale (tone mapping) | — |
| `fog_density` | Densité du brouillard ambiant | `0.018` |
| `transparent_background` | Fond transparent (laisse voir le dashboard) | `false` |
| `sky` | Ciel atmosphérique | `false` |
| `sun_intensity` | Intensité du soleil | `0.8` |
| `ambient_intensity` | Intensité de la lumière ambiante | `0.7` |
| `light_occlusion` | Empêche le soleil d'entrer par le toit ouvert | `none` |

### Styles de sol

| Style | Description |
|---|---|
| `none` | Pas de sol |
| `square` | Plan carré |
| `disc` | Disque circulaire |
| `infinite` | Plan infini |
| `podium` | Socle surélevé |

Le sol est configurable en couleur et en échelle via `ground_color` et `ground_scale`.

---

## Raccourcis clavier (mode édition)

| Touche | Action |
|---|---|
| **S** | Outil sélection |
| **G** | Mode grab (déplacement libre) |
| **X** / **Y** / **Z** | Contraindre le déplacement à un axe |
| **Ctrl+Z** | Annuler |
| **Ctrl+Shift+Z** | Rétablir |
| **Suppr** | Supprimer l'ancre sélectionnée |

---

## Configuration YAML complète

Voici l'ensemble des options disponibles :

```yaml
type: custom:ha-3d-floorplan
scene_id: ma_maison
model_url: /local/models/maison.glb
```

> **Note** : La plupart de ces options sont configurables directement depuis l'éditeur visuel. Le YAML n'est nécessaire que pour la configuration initiale (`scene_id` et `model_url`).
