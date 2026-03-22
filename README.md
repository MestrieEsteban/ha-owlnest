# Owlnest — 3D Floorplan for Home Assistant

![Home Assistant](https://img.shields.io/badge/Home%20Assistant-2024.1%2B-blue?logo=homeassistant)
![HACS](https://img.shields.io/badge/HACS-Custom-orange?logo=homeassistantcommunitystore)
![License](https://img.shields.io/github/license/MestrieEsteban/ha-owlnest)

Load a 3D model of your home into Home Assistant. Place interactive anchors on your devices, control your lights, sensors and automations directly inside a real-time 3D scene.

Built with Three.js. No coding required.

---

## Features

- **3D scene** — load any GLB/GLTF model with free camera navigation
- **Synchronized lights** — HA light entities drive real 3D lights (color, intensity, on/off)
- **Interactive anchors** — tap to toggle, long-press for details, per-entity markers
- **3D panels** — floating info cards inside the scene (room summary, sensor values, controls)
- **Camera views** — save named viewpoints, fly between them
- **Rules engine** — *if motion detected → fly to room*, *if door open → show panel*
- **Conditional visibility** — show/hide anchors and panels based on entity state
- **Dynamic weather** — sun position from `sun.sun`, rain/snow/fog/storm particles from your weather entity
- **Visual editor** — place and configure everything in-scene, no YAML needed
- **Multilingual** — English and French included

---

## Installation

Owlnest has two parts: a **Lovelace card** (frontend) and a **custom integration** (backend for scene storage).

### Via HACS (recommended)

1. Open HACS in Home Assistant
2. Go to **Frontend** → click the 3 dots menu → **Custom repositories**
3. Add `https://github.com/MestrieEsteban/ha-owlnest` with category **Plugin**
4. Search for **Owlnest 3D Floorplan** and install it
5. Copy the `custom_components/owlnest` folder to your HA `config/custom_components/` directory
6. Restart Home Assistant
7. Go to **Settings → Devices & Services → Add Integration** → search **Owlnest**

### Manual installation

1. Download `ha-3d-floorplan.js` from the [latest release](https://github.com/MestrieEsteban/ha-owlnest/releases/latest)
2. Place it in `config/www/ha-3d-floorplan.js`
3. Add it as a Lovelace resource: **Settings → Dashboards → Resources → Add** → `/local/ha-3d-floorplan.js` (JavaScript module)
4. Copy `custom_components/owlnest/` to `config/custom_components/owlnest/`
5. Restart Home Assistant
6. Add the integration: **Settings → Devices & Services → Add Integration → Owlnest**

---

## Quick start

Add the card to any dashboard:

```yaml
type: custom:owlnest-card
scene_id: my_home
model_url: /local/models/house.glb
```

Place your 3D model (`.glb` or `.gltf`) in `config/www/models/`.

Then:

1. Click the **pencil icon** to enter edit mode
2. Press `A` to add an anchor, click in the scene, pick a light entity
3. Toggle the light in HA — the 3D light updates instantly

---

## Documentation

| Guide | |
|---|---|
| [Installation](docs/installation.md) | Setup and configuration |
| [Getting Started](docs/getting-started.md) | First model, navigation, anchors |
| [Anchors](docs/anchors.md) | Interactive markers and entity binding |
| [3D Panels](docs/panels.md) | In-scene info cards |
| [Camera Views](docs/views.md) | Saved viewpoints |
| [Rules](docs/rules.md) | Conditional automations |
| [Environment](docs/environment.md) | Sun, weather, day/night |
| [Architecture](docs/architecture.md) | Technical overview |
| [FAQ](docs/faq.md) | Troubleshooting |

---

## Requirements

- Home Assistant 2024.1+
- HACS (for easy installation)
- A GLB or GLTF 3D model (from Blender, Sweet Home 3D, SketchUp, etc.)

---

## License

MIT
