# Getting Started

Once Owlnest is installed and the card is on your dashboard, this guide walks you through the first steps to set up your 3D home.

---

## 1. Load a 3D model

Owlnest supports **GLB** and **GLTF** formats.

**Recommended tools to create your model:**
- [Blender](https://www.blender.org/) — free, powerful, export as GLB
- [Sweet Home 3D](https://www.sweethome3d.com/) — beginner-friendly floor plan tool, exports to OBJ then convert to GLB via Blender
- Any tool that can export to GLB/GLTF

**Place your model in:**
```
config/www/models/house.glb
```

**Reference it in the card config:**
```yaml
type: custom:owlnest-card
scene_id: my_home
model_url: /local/models/house.glb
```

> **Model tips:**
> - Keep it under 20 MB for smooth performance
> - Use "Y up" orientation in your export settings
> - Baked textures render faster than PBR materials

---

## 2. Navigate the scene

Once the model loads, you can navigate freely with mouse or touch:

| Action | Mouse | Touch |
|---|---|---|
| Rotate | Left-click + drag | 1 finger drag |
| Zoom | Scroll wheel | Pinch |
| Pan | Right-click + drag | 2 finger drag |
| Fly to view | Click a view in the HUD | Tap a view |

The camera has configurable limits in the card YAML:

```yaml
orbit:
  min_distance: 2       # minimum zoom distance
  max_distance: 30      # maximum zoom distance
  max_polar_angle: 85   # maximum tilt in degrees
```

---

## 3. Enter edit mode

Click the **pencil icon** in the top-right corner of the card to enter edit mode.

In edit mode you can:
- Add, move, and delete anchors
- Configure entity associations
- Add and position 3D panels
- Create and save camera views

**Toolbar shortcuts:**

| Key | Action |
|---|---|
| `A` | Add anchor |
| `G` | Grab (move) selected anchor |
| `R` | Rotate (for spot/beam lights) |
| `X` | Delete selected anchor |
| `H` | Toggle visibility |
| `Ctrl+D` | Duplicate |
| `Ctrl+Z` | Undo |
| `Ctrl+Y` | Redo |

---

## 4. Add your first anchor

An anchor is an interactive marker placed in the 3D scene, linked to a Home Assistant entity.

1. Press `A` or click **+ Add** in the toolbar
2. Click anywhere in the 3D scene to place the anchor
3. In the properties panel on the right, select an **entity** (e.g. `light.salon`)
4. The anchor is now live — it reflects the entity's current state in 3D

**What happens when you interact with an anchor:**
- **Single tap / click** → toggles the entity (on/off)
- **Long press** → opens a detail panel (brightness, color, etc.)

See [Anchors](anchors.md) for full configuration options.

---

## 5. Create a camera view

Camera views let you save named positions and fly between them.

1. Navigate to the desired position in the scene
2. In the **Views** tab of the editor, click **Save current view**
3. Give it a name (e.g. "Living Room")
4. The view appears in the HUD pill bar at the bottom of the card

Clicking a view name flies the camera smoothly to that position.

See [Views](views.md) for more details.

---

## 6. Add a 3D panel

Panels are floating info cards displayed directly in the 3D scene.

1. In edit mode, go to **Panels** in the editor
2. Click **Add panel**
3. Choose a type: **Room**, **Entity**, or **Info**
4. Position it by dragging in the scene
5. Configure the content (entity, name, icon…)

See [Panels](panels.md) for all panel types and options.

---

## 7. Save your scene

Changes are **auto-saved** with a 2-second debounce. You'll see a status indicator:

| Indicator | Meaning |
|---|---|
| `●` | Unsaved changes |
| `⏳` | Saving… |
| `✓` | Saved |

You can also click **✓ Done** in the toolbar to exit edit mode and confirm the save.
