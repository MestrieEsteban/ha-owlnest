# FAQ

Common questions and troubleshooting tips.

---

## Installation

### The card doesn't appear after installing via HACS

1. Make sure you **restarted Home Assistant** after installation
2. Clear your browser cache (Ctrl+Shift+R)
3. Check that the Lovelace resource is registered — go to **Settings → Dashboards → ⋮ → Resources** and verify `/hacsfiles/owlnest/ha-3d-floorplan.js` is listed as a JavaScript module

---

### The Owlnest integration doesn't appear in the integration list

Make sure the `custom_components/owlnest/` folder is present in your HA config directory and that you restarted after copying it.

---

## Model

### My model doesn't load / the scene is black

- Verify the path in `model_url` — it must be relative to the `www` folder (e.g. `/local/models/house.glb`)
- Make sure the file exists at `config/www/models/house.glb`
- Open the browser console (F12) and look for 404 or CORS errors
- Try loading the model directly in a browser tab: `http://homeassistant.local:8123/local/models/house.glb`

---

### My model appears upside down or sideways

Most exporters let you set the "up" axis. In Blender:
- Go to **File → Export → glTF 2.0**
- Set **Up** to `+Y` and **Forward** to `+Z`

---

### How do I optimize a large 3D model?

- Use **Draco compression** in Blender's GLB export (reduces file size 5–10×)
- Merge small objects into larger meshes
- Reduce polygon count with the **Decimate** modifier
- Bake lighting into textures instead of using dynamic lights on the model itself
- Target under 20 MB and under 100k triangles for smooth mobile performance

---

### Supported model formats?

GLB and GLTF. GLB (binary) is preferred — it's a single self-contained file.

OBJ, FBX, STL are not supported directly. Convert them to GLB using Blender (free).

---

## Anchors & Lights

### How do I connect a light anchor to a HA entity?

1. Enter edit mode (pencil icon)
2. Select the anchor (click it)
3. In the properties panel on the right, click the entity field and start typing your entity ID (e.g. `light.salon`)
4. Select from the autocomplete list

---

### My anchor toggle works but the 3D light doesn't update

Make sure:
- The entity is a `light` domain entity
- `rendering.shadows` is not causing a performance issue that slows updates
- The anchor has the correct `lightStyle` (point, spot, or beam)

---

### Why does a light flicker in edit mode?

This can happen if you drag an anchor while a save is in progress. Owlnest uses an `_editorDragging` flag to prevent this — if you're seeing flickering, check that you're on the latest version.

---

## Rules

### My rule doesn't trigger

1. Make sure the rule is **enabled** (toggle in the Rules editor)
2. Check the `trigger.entity_id` matches exactly (copy-paste from HA developer tools)
3. Check if `from` / `to` filters are too restrictive — remove them to test
4. Open the browser console and look for errors during state changes
5. Verify `conditions` — if any condition fails, the rule is blocked

---

### The `go_to_view` action does nothing

- Make sure the `view_id` in the action matches the ID shown in the Views editor (not the label)
- Check that the view has not been deleted

---

## Performance

### The scene is slow / low FPS

- Reduce your model complexity (see model optimization above)
- Disable shadows: `rendering.shadows: false`
- Reduce fog: `rendering.fog_density: 0.005`
- Reduce the number of anchors with active lights (each is a real Three.js light source)
- On mobile, prefer `point` lights over `spot` or `beam`

---

### Weather particles cause lag

Disable weather by removing `weather_entity` from the config, or set it to an entity that always returns `sunny`.

---

## Editor

### I can't select an anchor in edit mode

- Make sure you're in **select mode** (arrow icon in the toolbar, not grab mode)
- Try right-clicking the anchor for the context menu

### My undo history is lost after a page refresh

Undo/redo is in-memory only — it doesn't persist across reloads. The saved state is always the last auto-saved version.

---

## Mobile

### Tapping an anchor toggles it twice

This was a known issue caused by the browser firing both `touchend` and synthetic `mousedown`/`mouseup` events for a single tap. It is fixed in the latest version — update via HACS.

---

## General

### Where is scene data stored?

In HA's persistent storage: `.storage/owlnest_scenes.json`. You can back this file up — it contains all your anchors, panels, rules, and views.

### Can I have multiple scenes?

Yes — each card config has a unique `scene_id`. Create as many cards as you want, each pointing to a different scene and model.

### Does Owlnest work offline?

Yes, once the model is loaded. HA entity updates require a live HA connection, but the 3D scene continues to render.
