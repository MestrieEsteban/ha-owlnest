<p align="center">
  <img src="assets/logo.svg" alt="Owlnest" width="200" />
</p>

<h1 align="center">Owlnest</h1>

<p align="center">
  <strong>Your home in 3D, right inside Home Assistant.</strong><br/>
  Load a 3D model, place your devices, control everything in real time.
</p>

<p align="center">
  <a href="#installation"><img src="https://img.shields.io/badge/Home%20Assistant-2024.1%2B-41BDF5?style=for-the-badge&logo=homeassistant&logoColor=white" alt="Home Assistant" /></a>
  <a href="#installation"><img src="https://img.shields.io/badge/HACS-Custom-FF6F00?style=for-the-badge&logo=homeassistantcommunitystore&logoColor=white" alt="HACS" /></a>
  <a href="https://github.com/MestrieEsteban/ha-owlnest/releases/latest"><img src="https://img.shields.io/github/v/release/MestrieEsteban/ha-owlnest?style=for-the-badge&color=6C63FF" alt="Release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/MestrieEsteban/ha-owlnest?style=for-the-badge&color=22C55E" alt="License" /></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/status-beta-orange?style=for-the-badge" alt="Beta" />
</p>

<p align="center">
  <a href="#-features">Features</a> •
  <a href="#-installation">Installation</a> •
  <a href="#-quick-start">Quick start</a> •
  <a href="#-full-guide">Full guide</a> •
  <a href="#-faq">FAQ</a>
</p>

<p align="center">
  🌐 <a href="README-FR.md"><strong>Version française disponible ici</strong></a>
</p>

<p align="center">
  <a href="https://www.youtube.com/watch?v=_MbcDL5JaTE">
    <img src="https://img.youtube.com/vi/_MbcDL5JaTE/maxresdefault.jpg" alt="Watch the demo" width="700" />
  </a>
</p>

---

> **⚠️ Beta** — Owlnest is under active development. Features may change, bugs may appear. Feedback and bug reports are very welcome via [Issues](https://github.com/MestrieEsteban/ha-owlnest/issues).

## 💬 Why Owlnest?

Existing 3D floorplan solutions for Home Assistant rely on static Blender renders: one image per light state, a new render for every color or condition. Nothing interactive, nothing alive.

I wanted something different: real-time 3D lights, a visual editor, weather effects, camera animations. Everything I wished existed. And I figured others might feel the same way, so I shared it.

<p align="center">
  <img src="assets/OnOffLight.gif" alt="Real-time light control demo" width="700" />
</p>

---

## ✨ Features

| | Feature | Description |
|---|---|---|
| 🏠 | **Interactive 3D scene** | Load any GLB/GLTF model and navigate freely with mouse or touch |
| 💡 | **Synchronized lights** | Your `light.*` entities drive real 3D lights — color, brightness, smooth transitions |
| 📍 | **Interactive anchors** | Tap to toggle, long-press for details. Supports lights, sensors, covers, climate, media players |
| 🚪 | **Animated openings** | Doors, windows, shutters and appliance doors swing or slide, awnings or curtains extend, and complex motions stored in the GLB (Blender NLA) play with their entity's state |
| 👁️ | **See through walls** | Whatever stands between you and the rooms fades out as you orbit, and comes back behind you |
| 📐 | **Any unit** | Metres, centimetres, inches: distances, lights and weather all derive from the model's own size |
| 🎥 | **Camera views** | Save named viewpoints and fly between them with smooth transitions |
| ⚡ | **Rules engine** | *Motion detected → fly to room*, *Door opened → show panel* |
| 🌦️ | **Dynamic weather** | Realistic sun from `sun.sun`, rain/snow/fog/storm particles from your weather entity |
| 🎨 | **Visual editor** | Configure everything in-scene, no YAML needed |
| 🌍 | **Multilingual** | English and French included |

---

## 🎬 In action

A quick look at what Owlnest does. Each part links to its chapter of the full guide.

### 📍 Place your devices

<p align="center">
  <img src="assets/moveLight.gif" alt="Moving an anchor in the editor" width="600" />
</p>

Click on the model to drop an anchor, pick the entity from a list, then drag it where it belongs. No coordinates, no YAML.

→ Learn more: [Anchors](docs/guide.md#anchors)

### 🚪 Doors and shutters that move

<p align="center">
  <img src="assets/openings.gif" alt="A door opening with its entity, handle and state colour included" width="600" />
</p>

A door, a window or a shutter follows its entity: it swings, slides or rolls, takes a colour per state, and carries its handle along.

→ Learn more: [Openings](docs/guide.md#openings)

### ⚡ Rules that drive the view

<p align="center">
  <img src="assets/rules.gif" alt="Rules engine in action" width="600" />
</p>

When something happens in the house, the card reacts: fly to the room, highlight an anchor, show a message.

→ Learn more: [Rules engine](docs/guide.md#rules-engine)

### 🎥 Camera views

<p align="center">
  <img src="assets/vue.gif" alt="Camera views navigation" width="600" />
</p>

Save the angles you like and fly from one to the other in a click.

→ Learn more: [Camera views](docs/guide.md#camera-views)

### 🌦️ Weather and daylight

<p align="center">
  <img src="assets/meteo.gif" alt="Weather and sun effects" width="600" />
</p>

The sun follows `sun.sun` and the sky follows your weather entity: rain, snow, fog and night fall on the model.

→ Learn more: [Environment](docs/guide.md#environment)

---

## 📦 Installation

Owlnest is a Home Assistant integration that carries its own Lovelace card. You
install one thing; the card is served and registered for you.

### Via HACS (recommended)

You need [HACS](https://hacs.xyz) installed first. Owlnest is not in the default
store yet, so it is added as a custom repository.

> **1. Open the custom repositories dialog**
>
> Click **HACS** in the sidebar, then the **⋮** menu at the top right of the page,
> and choose **Custom repositories**.
>
> **2. Add this repository**
>
> Paste `https://github.com/MestrieEsteban/ha-owlnest` in the repository field.
>
> In the type/category field, choose **Integration** — not Dashboard, not Plugin.
> This matters: HACS installs one category per repository, and Owlnest ships its
> card *inside* the integration. Picking anything else installs half of it.
>
> Click **Add**. The dialog closes and Owlnest appears in the HACS list.
>
> **3. Download it**
>
> Search for **Owlnest** in HACS, open it, and click **Download**. HACS copies the
> files to `config/custom_components/owlnest/`, card included.
>
> **4. Restart Home Assistant**
>
> **Settings → System**, then the power icon at the top right → **Restart Home
> Assistant**. A newly downloaded integration is only picked up on restart.
>
> **5. Add the integration**
>
> **Settings → Devices & Services → Add Integration**, search **Owlnest**, and
> confirm. There is nothing to configure.
>
> **6. Force-reload your browser**
>
> Press **Ctrl+Shift+R** (**Cmd+Shift+R** on macOS). Your browser still holds the
> page from before the card existed, and would otherwise report
> `Custom element doesn't exist: ha-3d-floorplan`.

There is no Lovelace resource to declare. The integration serves the card itself,
so card and backend always share a version.

> **Already added it with the wrong category?** Remove the repository from HACS,
> delete `config/custom_components/owlnest/` if it is still there, then start again
> at step 1 with **Integration** selected.

### Manual installation

> 1. Download the source of the [latest release](https://github.com/MestrieEsteban/ha-owlnest/releases/latest)
> 2. Copy `custom_components/owlnest/` to `config/custom_components/owlnest/`
> 3. **Restart** Home Assistant
> 4. Add the integration: **Settings → Devices & Services → Add → Owlnest**
>
> The card ships inside that folder, so there is no separate JavaScript file to
> place and no Lovelace resource to declare.
>
> Then **force-reload your browser** (Ctrl+Shift+R), same reason as above.

### Requirements

- Home Assistant **2024.1** or later
- A **GLB** or **GLTF** 3D model (exported from Blender, Sweet Home 3D, SketchUp, etc.)

---

## 🚀 Quick start

### 1. Prepare your 3D model

Place your `.glb` file in the `config/www/models/` folder of your HA instance.

### 2. Add the card

On any dashboard, add a manual card:

```yaml
type: custom:ha-3d-floorplan
scene_id: my_home
model_url: /local/models/house.glb
```

### 3. Place your devices

1. Click the **✏️ pencil icon** to enter edit mode
2. In the **Anchors** tab, click **+ Add**
3. Pick an entity (e.g. `light.living_room`)
4. Click in the scene to place the anchor
5. Click **💾 Save**

> **Tip**: Press **G** to grab and move an anchor freely (Blender-style), then **X**, **Y** or **Z** to constrain to an axis.

---

## 📖 Full guide

Everything about the editor, openings, camera views, rules and rendering lives in the **[full guide](docs/guide.md)**:

- [Scene navigation](docs/guide.md#scene-navigation)
- [Anchors](docs/guide.md#anchors)
- [Openings](docs/guide.md#openings)
- [Camera views](docs/guide.md#camera-views)
- [Rules engine](docs/guide.md#rules-engine)
- [Environment](docs/guide.md#environment)
- [Rendering and appearance](docs/guide.md#rendering-and-appearance)
- [Keyboard shortcuts (edit mode)](docs/guide.md#keyboard-shortcuts-edit-mode)
- [Full YAML reference](docs/guide.md#full-yaml-reference)

---

## ❓ FAQ

<details>
<summary><strong>Where can I get a 3D model of my home?</strong></summary>

You can create your model with:
- **Sweet Home 3D** (free, simple) → export as OBJ then convert to GLB with Blender
- **Blender** (free, advanced) → export directly to GLB
- **SketchUp** (freemium) → export via GLTF plugin
- **Floorplanner.com** (online) → export and convert

The recommended format is **GLB** (binary GLTF) for optimal performance.
</details>

<details>
<summary><strong>My model doesn't show up</strong></summary>

- Make sure the file is in `config/www/` and accessible via `/local/...`
- Check the URL in the config (no spaces, correct extension)
- Open the browser console (F12) to see errors
- Test your GLB file on [gltf-viewer.donmccurdy.com](https://gltf-viewer.donmccurdy.com/) to verify it's valid
</details>

<details>
<summary><strong>Lights don't respond</strong></summary>

- The anchor must be linked to a `light.*` domain entity
- Verify the entity exists in Home Assistant (**Developer Tools → States**)
- Make sure the Owlnest integration is installed and active
</details>

<details>
<summary><strong>Scene doesn't save</strong></summary>

- The backend integration must be installed: **Settings → Devices & Services** → check that **Owlnest** appears
- A `scene_id` must be set in the card configuration
- Check the browser console for WebSocket errors
</details>

<details>
<summary><strong>Can I have multiple scenes?</strong></summary>

Yes! Each card can have a different `scene_id`. You can have one scene per floor, per room, or per building.
</details>

<details>
<summary><strong>The model is too big / too small</strong></summary>

Owlnest uses the 3D model's units as-is. If your model is at scale in Blender (1 unit = 1 meter), it will be the right size. Otherwise, resize it in your 3D software before exporting.
</details>

<details>
<summary><strong>Can I use custom MDI icons?</strong></summary>

Yes! In anchor properties, set the `icon` field to any MDI icon (e.g. `mdi:thermometer`, `mdi:door-open`). The full list is at [pictogrammers.com/library/mdi](https://pictogrammers.com/library/mdi/).
</details>

<details>
<summary><strong>Performance is poor</strong></summary>

- Reduce your 3D model complexity (polygon count)
- Disable shadows (`shadows: false`)
- Disable the atmospheric sky (`sky: false`)
- Turn off weather effects if unused
</details>

---

## 🤝 Contributing

Contributions are welcome! Feel free to open an [issue](https://github.com/MestrieEsteban/ha-owlnest/issues) to report bugs or suggest features.

---

## 📄 License

[MIT](LICENSE) — Esteban Mestrie

The demo house is built from the [Furniture Kit](https://kenney.nl/assets/furniture-kit) by [Kenney](https://kenney.nl), released under CC0.
