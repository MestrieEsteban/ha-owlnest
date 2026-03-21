# Owlnest

**Owlnest** transforms Home Assistant into a fully interactive 3D smart home interface. Load a 3D model of your home, place interactive anchors on your devices, and watch your lights, sensors, and automations come to life in real time.

> Built with Three.js · Integrated with Home Assistant via HACS · No coding required

---

## What you can do

| Feature | Description |
|---|---|
| **3D interactive scene** | Load any GLB/GLTF model — free camera navigation, zoom, rotate, pan |
| **Synchronized lights** | HA lights drive real 3D lights — color and intensity update in real time |
| **Interactive anchors** | Place markers on any entity — tap to toggle, long-press for details |
| **3D panels** | Float info cards inside the scene — room summary, sensor values, entity controls |
| **Camera views** | Save named viewpoints and fly between them instantly |
| **Conditional rules** | *IF motion detected → fly to room*, *IF door open → show panel* |
| **Conditional visibility** | Show or hide anchors and panels based on entity state |
| **Dynamic weather** | Sun position tracks `sun.sun`, weather adapts to your weather entity (rain, snow, fog, storm…) |
| **Visual editor** | Place and configure everything directly inside the scene — no YAML editing needed |
| **Multilingual** | French and English out of the box |

---

## Quick Start

### 1. Install via HACS

1. Open HACS → **Frontend**
2. Click **+ Explore & Download Repositories**
3. Search for **Owlnest** and install
4. Restart Home Assistant

### 2. Add the integration

Go to **Settings → Devices & Services → Add Integration** and search for **Owlnest**.

### 3. Add the card to a dashboard

```yaml
type: custom:owlnest-card
scene_id: my_home
model_url: /local/models/house.glb
```

Place your 3D model at `config/www/models/house.glb`.

### 4. Open the editor

Click the **pencil icon** on the card to enter edit mode. Add your first anchor, associate a light entity, and see it glow in 3D — that's the first "wow" moment.

---

## Demo in 3 steps

1. **Enable edit mode** — click the pencil icon in the top-right corner of the card
2. **Add an anchor** — press `A`, click somewhere in the scene, pick a light entity
3. **Toggle the light** in HA — the 3D light updates instantly

---

## Documentation

| Guide | Description |
|---|---|
| [Installation](docs/installation.md) | Detailed installation and setup |
| [Getting Started](docs/getting-started.md) | First model, navigation, anchors, views |
| [Anchors](docs/anchors.md) | Interactive markers — placement, entities, visibility |
| [Panels 3D](docs/panels.md) | In-scene info cards (room, entity, info) |
| [Camera Views](docs/views.md) | Save viewpoints and fly between them |
| [Rules](docs/rules.md) | Conditional automations — triggers, conditions, actions |
| [Environment](docs/environment.md) | Sun, weather, day/night cycle |
| [Architecture](docs/architecture.md) | Technical overview for contributors |
| [FAQ](docs/faq.md) | Common questions and troubleshooting |

---

## Requirements

- Home Assistant 2024.1+
- HACS installed
- A GLB or GLTF 3D model of your home (Blender, Sweet Home 3D, etc.)

---

## License

MIT
