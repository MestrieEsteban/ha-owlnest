<h1 style="margin-top:-70px" align="center">Owlnest — 3D Floorplan for Home Assistant</h1>

<p align="center">
  <strong>Visualise your home in 3D, control your devices directly from the map, and save everything without touching YAML.</strong>
</p>

<p align="center">
  <img src="docs/assets/preview.png" alt="Owlnest preview" width="800"/>
</p>

---

## What is Owlnest?

Owlnest is a **mono-repo** containing two tightly coupled pieces:

| Part | Type | Role |
|---|---|---|
| **Owlnest Integration** | HA custom integration | Stores scenes (model, anchors, views) in Home Assistant |
| **Owlnest Card** | Lovelace custom card | Renders the 3D floorplan, syncs entity states, lets you edit |

Together they eliminate the YAML copy/paste workflow: you edit your anchors visually, click **💾 Sauvegarder**, and the data is persisted server-side — nothing to copy, nothing to paste.

---

## Installation

### 1 — Install the backend integration

Copy `custom_components/owlnest/` into your HA `custom_components/` directory:

```
/config/
└── custom_components/
    └── owlnest/
        ├── __init__.py
        ├── config_flow.py
        ├── manifest.json
        ├── storage.py
        ├── strings.json
        └── websocket.py
```

Restart Home Assistant, then go to **Settings → Integrations → Add Integration → Owlnest** (one-click, no configuration needed).

### 2 — Install the frontend card

#### Via HACS (recommended)

1. HACS → Frontend → Search **Owlnest 3D Floorplan** → Install
2. Reload browser

#### Manual

Copy `dist/ha-3d-floorplan.js` to `/config/www/` and add a Lovelace resource:

```yaml
url: /local/ha-3d-floorplan.js
type: module
```

---

## Quick start

### With backend scene (recommended)

```yaml
type: custom:ha-3d-floorplan
scene_id: main
```

The card loads scene `main` from the backend. The model URL, anchors and camera views are all stored there — the Lovelace card YAML stays minimal forever.

### Without backend (legacy / standalone)

```yaml
type: custom:ha-3d-floorplan
model_url: /local/owlnest/floorplan.glb
anchors:
  - entity: light.salon
    position: [2.5, 1.0, -3.2]
    label: "Salon"
```

---

## Editing workflow

1. Open a dashboard with the card
2. Hover the card → click **✏️** (editor button in the bottom bar)
3. Add / move / delete anchors visually in 3D
4. Click **💾 Sauvegarder** — changes are saved to the backend instantly
5. Done — no YAML, no copy/paste, no reload needed

The **📋 YAML** button is still available as a secondary export / debug tool.

---

## Scene system

A **scene** is a JSON document stored by the backend integration in HA native storage (`.storage/owlnest.scenes`).

```json
{
  "version": 1,
  "scene_id": "main",
  "model_url": "/local/owlnest/models/floorplan.glb",
  "anchors": [
    {
      "id": "anchor_000",
      "entity": "light.salon",
      "label": "Salon",
      "position": [2.5, 1.0, -3.2]
    }
  ],
  "camera_views": [],
  "panels": [],
  "rules": []
}
```

### Multiple scenes / multiple floors

```yaml
# Ground floor
type: custom:ha-3d-floorplan
scene_id: ground_floor

# Upper floor
type: custom:ha-3d-floorplan
scene_id: first_floor

# Garage (different .glb)
type: custom:ha-3d-floorplan
scene_id: garage
```

Each scene has its own `model_url`, so different GLB files are fully supported.

---

## Full configuration reference

```yaml
type: custom:ha-3d-floorplan

# ── Source ──────────────────────────────────────────────────────────────────
scene_id: main                  # Load from backend (recommended)
# model_url: /local/model.glb   # OR: direct URL when not using backend

# ── Environment ─────────────────────────────────────────────────────────────
sun_entity: sun.sun             # Drives day/night cycle + sky colour
weather_entity: weather.home    # Drives rain / snow particle effects
height: 500                     # Card height in px (default: 75% of width)

# ── Camera ──────────────────────────────────────────────────────────────────
orbit:
  min_distance: 2
  max_distance: 40
  max_polar_angle: 85

camera_views:
  - label: "Vue générale"
    position: [0, 8, 14]
  - label: "Salon"
    position: [3, 3, 5]
    target: [2.5, 1, -2]

# ── Lights ──────────────────────────────────────────────────────────────────
lights:
  distance: 8
  decay: 2
  transition: 0.5
intensity_scale: 1.0

# ── Rendering ───────────────────────────────────────────────────────────────
rendering:
  exposure: 1.4
  shadows: true
  sky: true
  sky_elevation: 60
  fog_density: 0.018
  ground_color: "#4a6741"
  transparent_background: false # blend into dashboard background

# ── HUD ─────────────────────────────────────────────────────────────────────
ui:
  show_simulation: true
  show_editor: true
  show_lock: true
  show_capture: true
  icons:
    simulation: "☀️"
    editor: "✏️"
    lock_open: "🔓"
    lock_closed: "🔒"
    capture: "📷"

# ── Behaviour ───────────────────────────────────────────────────────────────
tap_to_toggle: false
cluster_threshold: 60           # px — group nearby anchors into radial menu
```

---

## Supported entity types

| Domain | Behaviour |
|---|---|
| `light` | Coloured point light, brightness sync, toggle on click |
| `switch` | Point light (cyan), toggle on click |
| `cover` | Point light (sky blue), intensity = open position % |
| `climate` | Point light, colour = heating / cooling mode |
| `media_player` | Point light (purple), play/pause on click |
| `sensor` | Read-only badge with value + unit |
| `binary_sensor` | Point light, on/off state |

Long-press any overlay → opens the HA **more-info** dialog.

---

## Model format

Owlnest expects a **GLB** file (binary glTF):

- **Sweet Home 3D** → Export OBJ → Blender → Export GLB
- **Blender** → File → Export → glTF 2.0 (.glb)
- Any tool with glTF export support

The model is auto-centred on load. Anchor positions are in world-space relative to that centred origin.

---

## Architecture

```
owlnest/
├── custom_components/owlnest/   # HA backend integration
│   ├── __init__.py              # async_setup_entry
│   ├── config_flow.py           # One-click HA setup (no user input)
│   ├── manifest.json
│   ├── storage.py               # OwlnestStorage (HA Store wrapper)
│   ├── strings.json
│   └── websocket.py             # WS commands: load / save / list / delete
├── src/                         # Frontend TypeScript
│   ├── ha-3d-floorplan.ts       # Main web component + Three.js orchestration
│   ├── scene.ts                 # Scene load / save / config bridge
│   ├── types.ts                 # All TypeScript interfaces
│   ├── editor.ts                # Visual anchor editor (gizmo, undo/redo)
│   ├── overlay.ts               # Entity overlays
│   ├── lights.ts                # Light sync + smooth transitions
│   ├── model.ts                 # GLTF loading + anchor detection
│   └── card-editor.ts           # Lovelace UI config panel
├── dist/                        # Production build (single JS file)
└── docs/
```

### WebSocket API

| Command | Payload | Response |
|---|---|---|
| `owlnest/list_scenes` | — | `{ scenes: string[] }` |
| `owlnest/load_scene` | `{ scene_id }` | `OwlnestScene` |
| `owlnest/save_scene` | `{ scene_id, data }` | `{ success: true }` |
| `owlnest/delete_scene` | `{ scene_id }` | `{ success: bool }` |

Scenes are stored in `.storage/owlnest.scenes` — HA's native JSON storage, backed up automatically with the rest of your config.

---

## Development

```bash
npm install
npm run dev      # dev server with HMR
npm run build    # production bundle → dist/ha-3d-floorplan.js
```

---

## Licence

MIT
