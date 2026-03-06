# ha-3d-floorplan

Custom Lovelace card — 3D floorplan avec lumières dynamiques.

## Build

```bash
npm install
npm run build
# → dist/ha-3d-floorplan.js
```

## Installation dans Home Assistant

1. Copier `dist/ha-3d-floorplan.js` dans `config/www/ha-3d-floorplan.js`
2. Dans HA → Paramètres → Tableaux de bord → Ressources :
   - URL : `/local/ha-3d-floorplan.js`
   - Type : Module JavaScript
3. Copier ton modèle GLB dans `config/www/floorplan.glb`

## Configuration YAML

```yaml
type: custom:ha-3d-floorplan
model_url: /local/floorplan.glb
height: 500          # px, optionnel (défaut : 60% de la largeur)
intensity_scale: 1.0 # multiplicateur d'intensité, optionnel
show_debug_anchors: false  # true = sphères jaunes sur les anchors
anchors:
  ha_anchor_salon:   light.salon
  ha_anchor_cuisine: light.cuisine
  ha_anchor_chambre: light.chambre_principale
```

## Convention de nommage des anchors

Dans Blender (ou ton éditeur 3D), nommer les objets vides / empties :

```
ha_anchor_<nom_libre>
```

Exemple : `ha_anchor_salon`, `ha_anchor_spot_bureau`, etc.

Le nom doit correspondre exactement à la clé du dictionnaire `anchors` dans le YAML.

## Comportement

| Action | Résultat |
|--------|----------|
| Clic sur un anchor | `light.toggle` sur l'entité mappée |
| Survol d'un anchor | Tooltip `<anchorName> • on/off` |
| OrbitControls | Rotation (drag), zoom (scroll), pan (clic droit) |

## Attributs lumière lus depuis HA

- `brightness` → intensité (0-255)
- `rgb_color` → couleur prioritaire
- `hs_color` → couleur fallback (converti en HSL)
- `state === "on"` → lumière visible, sinon cachée
