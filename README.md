# Owlnest

**Custom Lovelace card — plan 3D interactif pour Home Assistant**

Visualise ton logement en 3D avec lumières dynamiques, cycle jour/nuit, météo, et ancres sur tes entités HA. Navigable à la souris ou au tactile, éditeur d'ancres intégré.

---

## Fonctionnalités

- Modèle 3D GLB chargé depuis `/local/`
- Lumières PointLight synchronisées avec tes entités `light.*`
- Cycle jour/nuit piloté par `sun.sun` (azimut, élévation, ambiance)
- Particules météo (pluie / neige) depuis une entité `weather.*`
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

## Configuration YAML

```yaml
type: custom:ha-3d-floorplan
model_url: /local/floorplan.glb
height: 800
intensity_scale: 0.2
sun_entity: sun.sun
weather_entity: weather.ma_ville

orbit:
  min_distance: 1
  max_distance: 30
  max_polar_angle: 86   # degrés — empêche de passer sous le sol

lights:
  distance: 8           # portée des PointLights (mètres modèle)
  decay: 2              # atténuation physique
  transition: 0.4       # secondes pour les changements d'état

tap_to_toggle: true     # clic vide = masquer/afficher les overlays

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

| Option | Type | Défaut | Description |
|---|---|---|---|
| `model_url` | `string` | — | **Requis.** URL du fichier GLB |
| `height` | `number` | 60% largeur | Hauteur de la carte en px |
| `intensity_scale` | `number` | `1.0` | Multiplicateur d'intensité des lumières |
| `sun_entity` | `string` | — | Entité `sun.sun` pour le cycle jour/nuit |
| `weather_entity` | `string` | — | Entité `weather.*` pour la météo |
| `tap_to_toggle` | `boolean` | `false` | Clic vide = masquer/afficher les overlays |
| `orbit.min_distance` | `number` | `1` | Distance minimum du zoom |
| `orbit.max_distance` | `number` | `20` | Distance maximum du zoom |
| `orbit.max_polar_angle` | `number` | `85` | Angle max en degrés (empêche de passer sous le sol) |
| `lights.distance` | `number` | `6` | Portée des PointLights |
| `lights.decay` | `number` | `2` | Atténuation physique |
| `lights.transition` | `number` | `0.5` | Durée de transition en secondes |
| `camera_views` | `array` | — | Liste de vues prédéfinies (barre de navigation) |
| `anchors` | `array` | — | Liste des entités positionnées en 3D |

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

| Outil | Action |
|---|---|
| **Sélectionner** | Clique sur une ancre → gizmo X/Y/Z pour déplacer |
| **Ajouter** | Clique sur le modèle → popup pour saisir l'entity_id |
| **Supprimer** | Clique sur une ancre pour la supprimer |
| **Export YAML** | Génère le bloc `anchors:` complet à copier dans ton YAML |

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
| `light.*` | Bouton coloré, intensité reflétée |
| `switch.*` | Bouton on/off |
| `cover.*` | Bouton ouvert/fermé |
| `sensor.*` | Valeur + unité |
| `binary_sensor.*` | État on/off |
| autres | Bouton générique |
