# Owlnest

**Custom Lovelace card — plan 3D interactif pour Home Assistant**

Visualise ton logement en 3D avec lumières dynamiques, cycle jour/nuit, météo, et ancres sur tes entités HA. Navigable à la souris ou au tactile, éditeur d'ancres intégré.

---

## Fonctionnalités

- Modèle 3D GLB chargé depuis `/local/`
- Lumières PointLight synchronisées avec tes entités `light.*`
- Cycle jour/nuit piloté par `sun.sun` (azimut, élévation, ambiance)
- Ciel procédural adaptatif (lever/coucher de soleil, nuit)
- Brouillard atmosphérique configurable
- Particules météo (pluie / neige) depuis une entité `weather.*`
- **Panneau de simulation** : slider heure + météo, sans aucune entité HA
- Ancres sur n'importe quelle entité : lumière, switch, volet, capteur…
- Vues caméra configurables avec fly-to animé
- Éditeur d'ancres intégré : ajout, déplacement (gizmo X/Y/Z), suppression, export YAML
- Capture de vue caméra → YAML prêt à coller
- Sauvegarde automatique de la position caméra (localStorage)
- Tap-to-toggle pour masquer/afficher les overlays

---

## Build

```bash
npm install
npm run build
# → dist/ha-3d-floorplan.js
```

---

## Installation dans Home Assistant

1. Copier `dist/ha-3d-floorplan.js` dans `config/www/ha-3d-floorplan.js`
2. Dans HA → **Paramètres → Tableaux de bord → Ressources** :
   - URL : `/local/ha-3d-floorplan.js`
   - Type : **Module JavaScript**
3. Vider le cache du navigateur (Ctrl+Shift+R)

---

## Configuration YAML complète

```yaml
type: custom:ha-3d-floorplan
model_url: /local/floorplan.glb
height: 800
intensity_scale: 0.2
sun_entity: sun.sun
weather_entity: weather.ma_ville
tap_to_toggle: true

orbit:
  min_distance: 1
  max_distance: 30
  max_polar_angle: 86   # degrés — empêche de passer sous le sol

lights:
  distance: 8           # portée des PointLights (mètres modèle)
  decay: 2              # atténuation physique
  transition: 0.4       # secondes pour les changements d'état

rendering:
  exposure: 1.4         # luminosité globale (tone mapping)
  sun_intensity: 0.8    # intensité de la lumière directionnelle soleil
  ambient_intensity: 0.7 # intensité de la lumière ambiante (hémisphère)
  shadows: true         # activer les ombres douces (PCFSoftShadowMap)
  sky: true             # ciel procédural (Rayleigh scattering)
  sky_elevation: 60     # élévation soleil par défaut en degrés (si pas de sun_entity)
  fog_density: 0.018    # densité du brouillard exponentiel
  ground_color: "#4a6741"      # couleur du plan de sol
  background_color: "#0d1117"  # couleur de fond si sky: false

camera_views:
  - label: "Vue globale"
    position: [0, 8, 12]
    target: [0, 0, 0]
  - label: "Salon"
    position: [2, 3, 4]
    target: [2, 0, 0]

anchors:
  - entity: light.salon
    label: Salon
    position: [-0.305, 0.17, -0.369]
  - entity: switch.prise_bureau
    label: Bureau
    position: [1.2, 0.5, 0.8]
  - entity: cover.volet_chambre
    label: Volet chambre
    position: [-1.0, 1.2, -0.5]
  - entity: sensor.temperature_salon
    label: Température
    position: [0.5, 1.0, 0.3]
```

---

## Options

### Options générales

| Option | Type | Défaut | Description |
|---|---|---|---|
| `model_url` | `string` | — | **Requis.** URL du fichier GLB (ex: `/local/floorplan.glb`) |
| `height` | `number` | 75% largeur | Hauteur de la carte en pixels |
| `intensity_scale` | `number` | `1.0` | Multiplicateur d'intensité des lumières PointLight |
| `sun_entity` | `string` | — | Entité `sun.sun` pour piloter le cycle jour/nuit automatiquement |
| `weather_entity` | `string` | — | Entité `weather.*` pour les particules pluie/neige automatiques |
| `tap_to_toggle` | `boolean` | `false` | Un clic dans le vide masque/affiche tous les overlays |
| `cluster_threshold` | `number` | — | Distance en pixels pour regrouper les ancres proches en menu radial. Désactivé par défaut. |

### `orbit` — Contrôle de la caméra

| Option | Type | Défaut | Description |
|---|---|---|---|
| `orbit.min_distance` | `number` | `1` | Distance minimum du zoom |
| `orbit.max_distance` | `number` | `100` | Distance maximum du zoom |
| `orbit.max_polar_angle` | `number` | `86.4` | Angle max en degrés (empêche de passer sous le sol) |

### `lights` — Lumières des entités

| Option | Type | Défaut | Description |
|---|---|---|---|
| `lights.distance` | `number` | `6` | Portée des PointLights (unités modèle) |
| `lights.decay` | `number` | `2` | Atténuation physique (2 = physiquement correct) |
| `lights.transition` | `number` | `0.5` | Durée de la transition on/off en secondes |

### `rendering` — Rendu 3D et ambiance

| Option | Type | Défaut | Description |
|---|---|---|---|
| `rendering.exposure` | `number` | `1.4` | Multiplicateur de luminosité global (tone mapping ACES Filmic) |
| `rendering.sun_intensity` | `number` | `0.8` | Intensité de la lumière directionnelle soleil (0 = éteint, 2 = très fort) |
| `rendering.ambient_intensity` | `number` | `0.7` | Intensité de la lumière ambiante hémisphérique (ciel + sol) |
| `rendering.shadows` | `boolean` | `true` | Active les ombres douces (PCFSoftShadowMap). Mettre `false` pour améliorer les perfs. |
| `rendering.sky` | `boolean` | `true` | Ciel procédural Rayleigh (dégradé bleu, lever/coucher de soleil). Si `false`, utilise `background_color`. |
| `rendering.sky_elevation` | `number` | `60` | Élévation du soleil en degrés utilisée au chargement si aucune `sun_entity` n'est définie. `0` = horizon, `90` = zénith. |
| `rendering.fog_density` | `number` | `0.018` | Densité du brouillard exponentiel. `0` = pas de brouillard, `0.05` = très dense. |
| `rendering.ground_color` | `string` | `"#4a6741"` | Couleur hexadécimale du plan de sol visible sous le modèle. |
| `rendering.background_color` | `string` | `"#0d1117"` | Couleur de fond utilisée quand `sky: false`. |

---

## Ancres

Deux formats supportés :

**Format position manuelle (recommandé — via l'éditeur intégré) :**
```yaml
anchors:
  - entity: light.salon
    label: Salon           # optionnel
    position: [x, y, z]
```

**Format legacy Blender (objets nommés `ha_anchor_*`) :**
```yaml
anchors:
  ha_anchor_salon: light.salon
  ha_anchor_cuisine: light.cuisine
```

---

## Éditeur d'ancres

Survole la carte et clique sur **✏️** pour entrer en mode édition.

| Outil | Raccourci | Action |
|---|---|---|
| **Sélectionner (S)** | `S` | Clique sur une ancre → gizmo X/Y/Z pour déplacer |
| **Ajouter (A)** | `A` | Clique sur le modèle → popup pour saisir l'entity_id |
| **Supprimer (D)** | `D` ou `Del` | Clique sur une ancre pour la supprimer |
| **Annuler** | `Ctrl+Z` | Annule la dernière action |
| **Rétablir** | `Ctrl+Y` | Rétablit l'action annulée |
| **Désélectionner** | `Esc` | Désélectionne ou revient à l'outil sélection |
| **Export YAML** | — | Génère le bloc `anchors:` complet à copier dans ton YAML |

---

## Simulation journée / météo ☀️

Survole la carte et clique sur **☀️** pour ouvrir le panneau de simulation. Cela permet de tester l'apparence à différentes heures de la journée et par différentes conditions météo, **sans avoir besoin de `sun_entity` ou `weather_entity`**.

Le panneau propose :

- **Actif** : case à cocher pour activer/désactiver la simulation (quand désactivé, les entités HA reprennent le contrôle)
- **Heure** : slider de 0h à 24h qui ajuste l'élévation solaire et l'ambiance lumineuse
- **Météo** : 4 préréglages
  - ☀️ **Soleil** — ciel clair, lumière pleine
  - ⛅ **Nuageux** — lumière atténuée, atmosphère voilée
  - 🌧️ **Pluie** — particules pluie + ambiance sombre
  - ❄️ **Neige** — particules neige + ambiance froide

---

## Capture de vue

Navigue vers la position caméra voulue, survole la carte et clique sur **📷**.
Un popup affiche le bloc YAML prêt à coller sous `camera_views:`.

---

## Vues caméra

Si `camera_views` est défini, une barre de navigation apparaît en bas de la carte.
Clique sur un bouton pour animer la caméra vers cette vue.

---

## Types d'entités supportés

| Domaine | Overlay |
|---|---|
| `light.*` | Bouton coloré, intensité reflétée dans la scène 3D |
| `switch.*` | Bouton on/off |
| `cover.*` | Bouton ouvert/fermé |
| `sensor.*` | Valeur + unité |
| `binary_sensor.*` | État on/off |
| `media_player.*` | Play/pause |
| autres | Bouton générique → ouvre la carte HA |
