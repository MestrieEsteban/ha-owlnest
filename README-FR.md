<p align="center">
  <img src="assets/logo.svg" alt="Owlnest" width="200" />
</p>

<h1 align="center">Owlnest</h1>

<p align="center">
  <strong>Votre maison en 3D, directement dans Home Assistant.</strong><br/>
  Chargez un modèle 3D, placez vos appareils, contrôlez tout en temps réel.
</p>

<p align="center">
  <a href="#installation"><img src="https://img.shields.io/badge/Home%20Assistant-2024.1%2B-41BDF5?style=for-the-badge&logo=homeassistant&logoColor=white" alt="Home Assistant" /></a>
  <a href="#installation"><img src="https://img.shields.io/badge/HACS-Custom-FF6F00?style=for-the-badge&logo=homeassistantcommunitystore&logoColor=white" alt="HACS" /></a>
  <a href="https://github.com/MestrieEsteban/ha-owlnest/releases/latest"><img src="https://img.shields.io/github/v/release/MestrieEsteban/ha-owlnest?style=for-the-badge&color=6C63FF" alt="Release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/MestrieEsteban/ha-owlnest?style=for-the-badge&color=22C55E" alt="License" /></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/statut-beta-orange?style=for-the-badge" alt="Beta" />
</p>

<p align="center">
  <a href="#-fonctionnalités">Fonctionnalités</a> •
  <a href="#-installation">Installation</a> •
  <a href="#-démarrage-rapide">Démarrage rapide</a> •
  <a href="#-guide-complet">Guide complet</a> •
  <a href="#-faq">FAQ</a>
</p>

<p align="center">
  🌐 <a href="README.md"><strong>English version available here</strong></a>
</p>

---

> **⚠️ Beta** — Owlnest est en développement actif. Des fonctionnalités peuvent changer et des bugs peuvent apparaître. Vos retours et signalements sont les bienvenus via les [Issues](https://github.com/MestrieEsteban/ha-owlnest/issues).

## 💬 Pourquoi Owlnest ?

Les solutions de plan 3D pour Home Assistant reposent sur des rendus Blender statiques une image par état de lumière, un nouveau rendu à chaque couleur ou condition. Rien d'interactif, rien de vivant.

J'ai voulu autre chose des lumières 3D temps réel, un éditeur visuel, de la météo, des animations. Tout ce que j'aurais aimé trouver. Et je me suis dit que d'autres étaient peut-être dans le même cas, alors j'ai partagé.

<p align="center">
  <img src="assets/OnOffLight.gif" alt="Démo contrôle des lumières en temps réel" width="700" />
</p>

---

## ✨ Fonctionnalités

| | Fonctionnalité | Description |
|---|---|---|
| 🏠 | **Scène 3D interactive** | Chargez n'importe quel modèle GLB/GLTF et naviguez librement avec la souris ou le tactile |
| 💡 | **Lumières synchronisées** | Vos entités `light.*` pilotent de vraies lumières 3D — couleur, intensité, transitions fluides |
| 📍 | **Ancres interactives** | Tap pour allumer/éteindre, appui long pour les détails. Compatible : lumières, capteurs, volets, climat, media players |
| 🃏 | **Cartes 3D** | Panneaux d'information flottants dans la scène — résumé de pièce, valeur de capteur, bouton d'action |
| 🎥 | **Vues caméra** | Sauvegardez des points de vue nommés et naviguez entre eux avec une transition animée |
| ⚡ | **Moteur de règles** | *Mouvement détecté → voler vers la pièce*, *Porte ouverte → afficher un panneau* |
| 🌦️ | **Météo dynamique** | Soleil réaliste depuis `sun.sun`, pluie/neige/brouillard/éclairs depuis votre entité météo |
| 🎨 | **Éditeur visuel** | Tout se configure dans la scène, sans écrire de YAML |
| 🌍 | **Multilingue** | Français et anglais inclus |

---

## 📦 Installation

Owlnest se compose de deux parties :
- **Carte Lovelace** (frontend) — le fichier JavaScript
- **Intégration HA** (backend) — pour la sauvegarde des scènes

### Via HACS (recommandé)

> 1. Ouvrir **HACS** → **Frontend** → menu ⋮ → **Dépôts personnalisés**
> 2. Ajouter `https://github.com/MestrieEsteban/ha-owlnest` en catégorie **Plugin**
> 3. Rechercher **Owlnest 3D Floorplan** et installer
> 4. Copier le dossier `custom_components/owlnest/` dans votre répertoire `config/custom_components/`
> 5. **Redémarrer** Home Assistant
> 6. Aller dans **Paramètres → Appareils & Services → Ajouter une intégration** → chercher **Owlnest**

### Installation manuelle

> 1. Télécharger `ha-3d-floorplan.js` depuis la [dernière release](https://github.com/MestrieEsteban/ha-owlnest/releases/latest)
> 2. Placer le fichier dans `config/www/ha-3d-floorplan.js`
> 3. Ajouter la ressource Lovelace : **Paramètres → Tableaux de bord → Ressources → Ajouter**
>    - URL : `/local/ha-3d-floorplan.js`
>    - Type : Module JavaScript
> 4. Copier `custom_components/owlnest/` dans `config/custom_components/owlnest/`
> 5. **Redémarrer** Home Assistant
> 6. Ajouter l'intégration : **Paramètres → Appareils & Services → Ajouter → Owlnest**

### Prérequis

- Home Assistant **2024.1** ou supérieur
- Un modèle 3D au format **GLB** ou **GLTF** (exporté depuis Blender, Sweet Home 3D, SketchUp, etc.)

---

## 🚀 Démarrage rapide

### 1. Préparer votre modèle 3D

Placez votre fichier `.glb` dans le dossier `config/www/models/` de votre instance HA.

### 2. Ajouter la carte

Dans n'importe quel tableau de bord, ajoutez une carte manuelle :

```yaml
type: custom:owlnest-card
scene_id: ma_maison
model_url: /local/models/maison.glb
```

### 3. Placer vos appareils

1. Cliquez sur l'icône **✏️ crayon** pour entrer en mode édition
2. Dans l'onglet **Anchors**, cliquez **+ Ajouter**
3. Choisissez une entité (ex: `light.salon`)
4. Cliquez dans la scène pour placer l'ancre
5. Cliquez **💾 Sauvegarder**

> **Astuce** : Utilisez la touche **G** pour déplacer une ancre librement (style Blender), puis **X**, **Y** ou **Z** pour contraindre le mouvement à un axe.

---

## 📖 Guide complet

### Navigation dans la scène

| Action | Souris | Tactile |
|---|---|---|
| Orbiter | Clic gauche + glisser | Un doigt + glisser |
| Zoomer | Molette | Pincer |
| Panoramique | Clic droit + glisser | Deux doigts + glisser |

---

### Ancres

Les ancres sont des points interactifs placés dans la scène 3D. Chaque ancre est liée à une entité Home Assistant.

<p align="center">
  <img src="assets/moveLight.gif" alt="Déplacement d'une ancre dans l'éditeur" width="600" />
</p>

#### Domaines supportés

| Domaine | Comportement | Visuel |
|---|---|---|
| `light` | Crée une lumière 3D synchronisée (couleur + intensité) | Point lumineux avec ombre |
| `switch` | On/off toggle | Icône interrupteur |
| `sensor` | Affiche la valeur en temps réel | Étiquette avec valeur |
| `binary_sensor` | Indicateur on/off | Point coloré |
| `cover` | Reflète le % d'ouverture | Barre de progression |
| `climate` | Indicateur de mode (chauffage/refroidissement) | Orange/bleu selon l'action |
| `media_player` | Indicateur lecture/pause | Icône media |


#### Styles de lumière

Pour les entités `light`, trois styles sont disponibles :

| Style | Description |
|---|---|
| `point` | Lumière omnidirectionnelle (ampoule classique) |
| `spot` | Faisceau conique dirigé (spot encastré) |
| `beam` | Faisceau étroit et concentré (projecteur) |

Le style et la direction se configurent dans les propriétés de l'ancre en mode édition.


#### Interactions

- **Clic court** → Toggle l'entité (allumer/éteindre la lumière, ouvrir/fermer le volet…)
- **Appui long** → Ouvre le panneau `more-info` de Home Assistant pour l'entité

#### Visibilité conditionnelle

Chaque ancre peut être masquée/affichée selon l'état d'une entité :

> *Exemple : n'afficher le capteur de température de la chambre que lorsque la porte est ouverte.*

Configurez cela dans les propriétés de l'ancre → **Visible si** dans l'éditeur.

#### Options avancées

| Option | Description |
|---|---|
| `label` | Texte personnalisé affiché sur l'étiquette |
| `icon` | Icône MDI personnalisée (ex: `mdi:thermometer`) |
| `precision` | Nombre de décimales pour les capteurs (ex: `0` → "18", `1` → "17.6") |
| `lightIntensity` | Multiplicateur d'intensité lumineuse (défaut: 1) |

---

### Cartes 3D

Les cartes sont des panneaux d'information qui flottent dans la scène. Elles font toujours face à la caméra (billboard).

#### Types de cartes

| Type | Usage | Contenu |
|---|---|---|
| **Room** | Résumé d'une pièce | Icône + nom + jusqu'à 4 valeurs d'entités |
| **Entity** | Focus sur un appareil | État principal + unité + bouton d'action optionnel |
| **Info** | Annotation statique | Icône + titre + sous-titre |

#### Tailles

| Taille | Largeur 3D |
|---|---|
| `small` | 0.6 mètre |
| `medium` | 1.0 mètre (défaut) |
| `large` | 1.5 mètre |

#### Ajouter une carte

1. Mode édition → onglet **Cards**
2. Cliquez **+ Ajouter** et choisissez le type
3. Remplissez les champs (nom, entités, couleur d'accent…)
4. Utilisez le gizmo pour positionner la carte dans la scène

Les cartes supportent aussi la **visibilité conditionnelle** (comme les ancres).

---

### Vues caméra

Les vues caméra vous permettent de sauvegarder des points de vue et de naviguer entre eux avec une animation fluide.

#### Utilisation

1. Mode édition → onglet **Camera** (ou cliquez l'icône 📷 dans la barre d'outils)
2. Positionnez la caméra où vous voulez
3. Cliquez **Capturer la vue** et donnez un nom
4. La vue apparaît dans la barre de navigation en bas de la scène

<p align="center">
  <img src="assets/vue.gif" alt="Navigation entre vues caméra" width="600" />
</p>

#### Vues cachées

Une vue peut être marquée comme **cachée** : elle n'apparaît pas dans la barre de navigation mais reste utilisable par les règles (ex: « voler vers la cuisine quand un mouvement est détecté »).


---

### Moteur de règles

Les règles permettent de créer des automatisations visuelles internes à la scène 3D.

#### Structure d'une règle

```
QUAND  [trigger]       →  un changement d'état se produit
SI     [conditions]    →  toutes les conditions sont vraies (optionnel)
ALORS  [actions]       →  exécuter une ou plusieurs actions
```

#### Triggers

| Type | Description |
|---|---|
| **Changement d'état** | Se déclenche quand l'état d'une entité change. Filtres optionnels `de` et `vers` |

*Exemple : « Quand `binary_sensor.mouvement_salon` passe de `off` à `on` »*

#### Conditions

Les conditions filtrent l'exécution (logique **ET** : toutes doivent être vraies).

| Opérateur | Description |
|---|---|
| `=` | Égal |
| `≠` | Différent |
| `>` `<` `≥` `≤` | Comparaisons numériques |
| `contient` | Le texte contient la valeur |

Chaque condition peut être **inversée** (mode « Masquer si »).

#### Actions

| Action | Description |
|---|---|
| **Aller à la vue** | Anime la caméra vers une vue sauvegardée |
| **Afficher une carte** | Rend une carte 3D visible |
| **Masquer une carte** | Cache une carte 3D |
| **Appeler un service** | Appelle un service HA (ex: `light.turn_on`, `notify.mobile`) |

#### Exemple concret

> **Règle « Alerte intrusion »**
> - Trigger : `binary_sensor.porte_entree` passe à `on`
> - Condition : `alarm_control_panel.maison` = `armed_away`
> - Actions :
>   - Aller à la vue « Entrée »
>   - Afficher la carte « Alerte porte »

<p align="center">
  <img src="assets/rules.gif" alt="Moteur de règles en action" width="600" />
</p>

---

### Environnement

Owlnest peut synchroniser l'éclairage ambiant et les effets météo avec vos entités Home Assistant.

#### Soleil

Configurez `sun_entity: sun.sun` pour que la lumière du soleil suive la position réelle.

| Mode | Description |
|---|---|
| **Showcase** | Lumière douce et flatteuse, idéale pour la présentation |
| **Réaliste** | Position solaire fidèle à la réalité, avec prise en compte de l'orientation de la maison |

En mode **réaliste**, configurez `house_orientation` (en degrés) pour aligner le nord du modèle avec le nord réel :
- `0` = la face avant du modèle pointe vers le nord
- `90` = la face avant pointe vers l'est

#### Météo

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
  <img src="assets/meteo.gif" alt="Effets météo et soleil" width="600" />
</p>

---

### Rendu et apparence

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

#### Styles de sol

| Style | Description |
|---|---|
| `none` | Pas de sol |
| `square` | Plan carré |
| `disc` | Disque circulaire |
| `infinite` | Plan infini |
| `podium` | Socle surélevé |

Le sol est configurable en couleur et en échelle via `ground_color` et `ground_scale`.

---

### Raccourcis clavier (mode édition)

| Touche | Action |
|---|---|
| **S** | Outil sélection |
| **G** | Mode grab (déplacement libre) |
| **X** / **Y** / **Z** | Contraindre le déplacement à un axe |
| **Ctrl+Z** | Annuler |
| **Ctrl+Shift+Z** | Rétablir |
| **Suppr** | Supprimer l'ancre sélectionnée |

---

### Configuration YAML complète

Voici l'ensemble des options disponibles :

```yaml
type: custom:owlnest-card
scene_id: ma_maison
model_url: /local/models/maison.glb
```

> **Note** : La plupart de ces options sont configurables directement depuis l'éditeur visuel. Le YAML n'est nécessaire que pour la configuration initiale (`scene_id` et `model_url`).

---

## ❓ FAQ

<details>
<summary><strong>Où trouver un modèle 3D de ma maison ?</strong></summary>

Vous pouvez créer votre modèle avec :
- **Sweet Home 3D** (gratuit, simple) → exporter en OBJ puis convertir en GLB avec Blender
- **Blender** (gratuit, avancé) → exporter directement en GLB
- **SketchUp** (freemium) → exporter via plugin GLTF
- **Floorplanner.com** (en ligne) → exporter et convertir

Le format recommandé est **GLB** (GLTF binaire) pour des performances optimales.
</details>

<details>
<summary><strong>Mon modèle ne s'affiche pas</strong></summary>

- Vérifiez que le fichier est bien dans `config/www/` et accessible via `/local/...`
- Vérifiez l'URL dans la config (pas d'espace, bonne extension)
- Ouvrez la console du navigateur (F12) pour voir les erreurs
- Testez votre fichier GLB sur [gltf-viewer.donmccurdy.com](https://gltf-viewer.donmccurdy.com/) pour vérifier qu'il est valide
</details>

<details>
<summary><strong>Les lumières ne répondent pas</strong></summary>

- L'ancre doit être liée à une entité de domaine `light.*`
- Vérifiez que l'entité existe dans Home Assistant (**Outils de développement → États**)
- Assurez-vous que l'intégration Owlnest est bien installée et active
</details>

<details>
<summary><strong>La scène ne se sauvegarde pas</strong></summary>

- L'intégration backend doit être installée : **Paramètres → Appareils & Services** → vérifiez que **Owlnest** apparaît
- Un `scene_id` doit être défini dans la configuration de la carte
- Vérifiez la console du navigateur pour d'éventuelles erreurs WebSocket
</details>

<details>
<summary><strong>Puis-je avoir plusieurs scènes ?</strong></summary>

Oui ! Chaque carte peut avoir un `scene_id` différent. Vous pouvez avoir une scène par étage, par pièce, ou par bâtiment.
</details>

<details>
<summary><strong>Le modèle est trop gros / trop petit</strong></summary>

Owlnest utilise les unités du modèle 3D telles quelles. Si votre modèle est à l'échelle dans Blender (1 unité = 1 mètre), il sera à la bonne taille. Sinon, redimensionnez-le dans votre logiciel 3D avant export.
</details>

<details>
<summary><strong>Puis-je utiliser des icônes MDI personnalisées ?</strong></summary>

Oui ! Dans les propriétés d'une ancre, renseignez le champ `icon` avec n'importe quelle icône MDI (ex: `mdi:thermometer`, `mdi:door-open`). La liste complète est sur [pictogrammers.com/library/mdi](https://pictogrammers.com/library/mdi/).
</details>

<details>
<summary><strong>La performance est mauvaise</strong></summary>

- Réduisez la complexité de votre modèle 3D (nombre de polygones)
- Désactivez les ombres (`shadows: false`)
- Désactivez le ciel atmosphérique (`sky: false`)
- Fermez les effets météo si inutilisés
</details>

---

## 🤝 Contribuer

Les contributions sont les bienvenues ! N'hésitez pas à ouvrir une [issue](https://github.com/MestrieEsteban/ha-owlnest/issues) pour signaler un bug ou proposer une fonctionnalité.

---

## 📄 Licence

[MIT](LICENSE) — Esteban Mestrie
