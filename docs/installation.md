# Installation

This guide covers everything you need to get Owlnest running in Home Assistant.

---

## Prerequisites

- Home Assistant 2024.1 or newer
- [HACS](https://hacs.xyz/) installed
- A GLB or GLTF 3D model of your home

---

## Step 1 — Install via HACS

1. Open the HACS panel in Home Assistant
2. Go to **Frontend**
3. Click **+ Explore & Download Repositories** (top right)
4. Search for **Owlnest**
5. Click **Download**
6. **Restart Home Assistant**

> If Owlnest is not listed yet, add it as a custom repository:
> HACS → ⋮ → Custom repositories → paste the GitHub URL → Category: **Frontend**

---

## Step 2 — Add the Owlnest integration

The backend integration stores your scenes (anchors, panels, rules, camera views) in Home Assistant's persistent storage.

1. Go to **Settings → Devices & Services**
2. Click **+ Add Integration**
3. Search for **Owlnest**
4. Complete the setup flow

---

## Step 3 — Add your 3D model

Owlnest loads GLB/GLTF models from your HA `www` directory, which is served at `/local/`.

**Recommended folder structure:**

```
config/
└── www/
    └── models/
        └── house.glb
```

Your model will be accessible at `/local/models/house.glb`.

> **Tip:** Keep your model under 20 MB for best performance on mobile. See the [FAQ](faq.md) for optimization tips.

---

## Step 4 — Add the Lovelace card

In your dashboard, add a new card and use **Manual** mode:

```yaml
type: custom:owlnest-card
scene_id: my_home
model_url: /local/models/house.glb
```

| Property | Required | Description |
|---|---|---|
| `scene_id` | Yes | Unique identifier for this scene (used by the backend) |
| `model_url` | Yes | Path to your GLB/GLTF model |

---

## Optional — Lovelace resource

If the card doesn't load after installation, you may need to add the resource manually.

Go to **Settings → Dashboards → ⋮ → Resources** and add:

```
/hacsfiles/owlnest/ha-3d-floorplan.js
```

Type: **JavaScript module**

---

## Full configuration example

```yaml
type: custom:owlnest-card
scene_id: ground_floor
model_url: /local/models/house.glb
height: 600
sun_entity: sun.sun
weather_entity: weather.home
rendering:
  shadows: true
  fog_density: 0.018
  exposure: 1.0
orbit:
  min_distance: 2
  max_distance: 30
  max_polar_angle: 85
```

See [Getting Started](getting-started.md) for the next steps.
