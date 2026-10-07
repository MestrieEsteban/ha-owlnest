<p align="center">
  <img src="assets/logo.svg" alt="Owlnest" width="120" />
</p>

<h1 align="center">Owlnest</h1>

<p align="center">
  <strong>A 3D floorplan for Home Assistant.</strong><br />
  Your lights and devices in a model of your home, with an editor to place them.
</p>

<p align="center">
  <a href="https://github.com/MestrieEsteban/ha-owlnest/releases/latest"><img src="https://img.shields.io/github/v/release/MestrieEsteban/ha-owlnest?style=flat-square&color=6C63FF" alt="Latest release" /></a>
  <a href="#installation"><img src="https://img.shields.io/badge/HACS-Integration-41BDF5?style=flat-square" alt="HACS integration" /></a>
  <a href="https://github.com/MestrieEsteban/ha-owlnest/issues"><img src="https://img.shields.io/badge/status-beta-orange?style=flat-square" alt="Beta: feedback welcome" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/MestrieEsteban/ha-owlnest?style=flat-square&color=22C55E" alt="MIT license" /></a>
</p>

<p align="center">
  <a href="https://mestrieesteban.github.io/ha-owlnest/?lang=en"><img src="https://img.shields.io/badge/%E2%96%B6%20Try%20the%20live%20demo-6C63FF?style=for-the-badge" alt="Try the live demo" height="40" /></a>
</p>

<p align="center">
  <a href="https://mestrieesteban.github.io/ha-owlnest/?lang=en"><strong>▶ Live demo</strong></a> ·
  <a href="#installation">Install</a> ·
  <a href="#quick-start">Try it</a> ·
  <a href="docs/guide.md">Full guide</a> ·
  <a href="https://www.youtube.com/watch?v=_MbcDL5JaTE">Video demo</a> ·
  <a href="README-FR.md">Français</a>
</p>

<p align="center">
  <a href="https://www.youtube.com/watch?v=_MbcDL5JaTE">
    <img src="https://img.youtube.com/vi/_MbcDL5JaTE/maxresdefault.jpg" alt="Watch the Owlnest video demo" width="700" />
  </a>
</p>

Owlnest is a Home Assistant card that displays your home in 3D. Lights in the model follow your actual lamps: on/off, colour and brightness. You can also place sensors and have doors or shutters move with their entity's state.

## Why Owlnest?

3D floorplan solutions for Home Assistant rely on static Blender renders: one image per light state, a new render for every colour or condition. Nothing interactive, nothing alive.

I wanted something else: real-time 3D lights, a visual editor, weather, animations. Everything I wished I could find. And I thought others might be looking for the same thing, so I shared it.

A demo house is included so you can try the card with your own lights before making a model of your home.

> **Beta:** the project is still in development. There are bugs, and settings may change. If something goes wrong, you can report it in the [issues](https://github.com/MestrieEsteban/ha-owlnest/issues).

## Features

| Feature | Details |
|---|---|
| Lights | On/off, brightness and colour synchronized with `light.*` entities. |
| Doors and shutters | Swinging, sliding, extending or playback of animations in the GLB. |
| Sensors | Values displayed wherever you place their anchors. |
| Controls | Tap an anchor to control the device, hold it to open its details. The action depends on the entity type. |
| Rules | Move the camera, highlight an anchor or show a message based on an entity's state. |
| Weather and sun | Lighting from `sun.sun`; rain, snow, fog and storms from your weather entity. |
| Walls | Objects blocking the rooms fade as you orbit the model. |
| Navigation | Mouse, touch and saved viewpoints. |

Anchors support `light`, `switch`, `sensor`, `binary_sensor`, `cover`, `climate` and `media_player`. The interface is available in English and French.

## In action

<table>
  <tr>
    <th colspan="2">Lights synchronized in real time</th>
  </tr>
  <tr>
    <td colspan="2" align="center"><img src="assets/OnOffLight.gif" alt="Lights changing in the 3D home as their Home Assistant entities are toggled" width="800" /></td>
  </tr>
  <tr>
    <td colspan="2">When a lamp turns on or changes colour, the light in the model follows. You can also control it from its anchor. <a href="docs/guide.md#anchors">Light settings →</a></td>
  </tr>
  <tr>
    <th>Placing devices</th>
    <th>Doors and shutters</th>
  </tr>
  <tr>
    <td><img src="assets/moveLight.gif" alt="Placing and moving a device anchor in the visual editor" width="400" /></td>
    <td><img src="assets/openings.gif" alt="A door moving with its entity, including its handle and state colour" width="400" /></td>
  </tr>
  <tr>
    <td>Place anchors on the model and move them in the editor. Each one can be linked to an entity. <a href="docs/guide.md#anchors">Anchor guide →</a></td>
    <td>A door or shutter moves with its entity. Set up and preview the movement in the editor. <a href="docs/guide.md#openings">Opening guide →</a></td>
  </tr>
  <tr>
    <th>Camera views</th>
    <th>Rules</th>
  </tr>
  <tr>
    <td><img src="assets/vue.gif" alt="Smooth camera transitions between saved viewpoints of the home" width="400" /></td>
    <td><img src="assets/rules.gif" alt="Visual rules making the scene react to Home Assistant entity states" width="400" /></td>
  </tr>
  <tr>
    <td>Save a viewpoint to return to it later. <a href="docs/guide.md#camera-views">Camera guide →</a></td>
    <td>For example, a motion sensor can trigger a switch to that room's camera view. <a href="docs/guide.md#rules-engine">Rules guide →</a></td>
  </tr>
  <tr>
    <th colspan="2">Weather and sun</th>
  </tr>
  <tr>
    <td colspan="2" align="center"><img src="assets/meteo.gif" alt="Weather effects and changing daylight in the 3D scene" width="400" /></td>
  </tr>
  <tr>
    <td colspan="2">The sun follows <code>sun.sun</code>. Rain, snow and fog depend on your weather entity. <a href="docs/guide.md#environment">Environment settings →</a></td>
  </tr>
</table>

<p align="center">
  <a href="https://mestrieesteban.github.io/ha-owlnest/?lang=en"><img src="https://img.shields.io/badge/%E2%96%B6%20Try%20the%20live%20demo-6C63FF?style=for-the-badge" alt="Try the live demo" height="40" /></a>
</p>

## Installation

**Requires Home Assistant 2024.1 or later.** Owlnest installs as an integration and includes its Lovelace card. The card is registered automatically.

### With HACS

1. In **HACS**, open **⋮ → Custom repositories**.
2. Add `https://github.com/MestrieEsteban/ha-owlnest` and select **Integration** as the category.
3. Search for **Owlnest** in HACS and download it.
4. **Restart Home Assistant**.
5. Go to **Settings → Devices & Services → Add Integration**, search for **Owlnest** and confirm.
6. Force-reload your browser with **Ctrl+Shift+R** (**Cmd+Shift+R** on macOS).

> Choose the **Integration** category in HACS. The card is bundled inside the integration; there is no separate card download or Lovelace resource to add.

<details>
<summary><strong>Manual installation</strong></summary>

1. Download the source archive of the [latest release](https://github.com/MestrieEsteban/ha-owlnest/releases/latest).
2. Copy its `custom_components/owlnest/` folder into your Home Assistant `config/custom_components/` directory, including the `frontend/` folder.
3. Restart Home Assistant.
4. Add **Owlnest** from **Settings → Devices & Services → Add Integration**.
5. Force-reload your browser.

The card and demo model are included in the integration folder.

</details>

## Quick start

### Try the included demo house

After installation, edit a dashboard and add a **Manual** card:

```yaml
type: custom:ha-3d-floorplan
scene_id: owlnest_demo
```

Without a `model_url`, Owlnest loads the included house. Click a **+** marker on a lamp or the television and choose one of your Home Assistant entities. The link is saved automatically.

Try toggling a linked light. You can also drag to orbit, scroll to zoom, or use touch gestures to explore the house.

### Use your own home

Export your model as **GLB** (recommended) or **GLTF**. For a GLB named `house.glb`:

1. Create `config/www/models/` if needed and place the file there.
2. Add a card with this configuration:

   ```yaml
   type: custom:ha-3d-floorplan
   scene_id: my_home
   model_url: /local/models/house.glb
   ```

   If you already tried the demo, open the in-scene editor's **Config** tab and select or create `my_home`; set the model URL there and click **Apply**. The card remembers the scene selected in the editor.

3. Open the editor with the **pencil** if it isn't already open.
4. In **Anchors**, click **+ Add**, click the model to place the anchor, then choose an entity such as `light.living_room`.
5. Adjust its position and wait for the save indicator. Click **Done** to leave the editor; changes are saved automatically.

`scene_id` identifies the saved scene. `model_url` points to the 3D file. Once the card is set up, continue in the visual editor.

**Editing tip:** press **G** to move a selected anchor, then **X**, **Y** or **Z** to constrain movement to an axis.

## Documentation

| Topic | Guide |
|---|---|
| Navigate with mouse or touch | [Scene navigation](docs/guide.md#scene-navigation) |
| Configure devices, labels and visibility | [Anchors](docs/guide.md#anchors) |
| Animate doors, shutters or GLB animations | [Openings](docs/guide.md#openings) |
| Save viewpoints and move between them | [Camera views](docs/guide.md#camera-views) |
| Make the view react to entity states | [Rules engine](docs/guide.md#rules-engine) |
| Connect the sun and weather | [Environment](docs/guide.md#environment) |
| Adjust shadows, exposure and the scene's appearance | [Rendering and appearance](docs/guide.md#rendering-and-appearance) |
| Find shortcuts or card configuration | [Keyboard shortcuts](docs/guide.md#keyboard-shortcuts-edit-mode) · [YAML reference](docs/guide.md#full-yaml-reference) |

## Troubleshooting

<details>
<summary><strong>“Custom element doesn't exist: ha-3d-floorplan”</strong></summary>

Check that Owlnest was downloaded as an **Integration** in HACS, then restart Home Assistant and add it in **Settings → Devices & Services**. Force-reload the browser afterwards.

If the repository was added under another category, remove that HACS entry and add it again as **Integration**. For a manual installation, check that `custom_components/owlnest/frontend/ha-3d-floorplan.js` is present.

</details>

<details>
<summary><strong>My model doesn't appear</strong></summary>

Check that `config/www/models/house.glb` is accessible at `/local/models/house.glb` on your Home Assistant instance. The filename and `model_url` must match. For GLTF, keep any referenced textures and binary files accessible at their relative paths too.

If the file is accessible but still fails to load, check the browser console for the loading error.

</details>

<details>
<summary><strong>A light doesn't respond, or changes aren't saved</strong></summary>

For lights, check that the anchor is linked to the intended `light.*` entity and that the entity is available in **Developer Tools → States**.

For saving, check that the Owlnest integration is active and that a scene is selected with a `scene_id`. The editor's save indicator reports whether changes have been saved. Check the browser console for WebSocket errors if saving fails.

</details>

<details>
<summary><strong>The scene runs slowly, or the scale looks wrong</strong></summary>

Reduce the model's polygon count and texture sizes. In the editor's **Config** tab, disable shadows and the atmospheric sky if needed; unused weather effects can also be disabled.

Models can use metres, centimetres or inches: distance-dependent effects adapt to the model's overall size. If objects are out of proportion within the model, correct them in your 3D software before exporting.

</details>

## Contributing

To report a bug or suggest a feature, [open an issue](https://github.com/MestrieEsteban/ha-owlnest/issues). For bugs, include your Home Assistant and Owlnest versions, steps to reproduce the problem and any browser errors.

To work on the code, see [DEVELOPMENT.md](DEVELOPMENT.md) for local setup, testing and the Home Assistant development workflow. That guide is currently in French.

## License and credits

[MIT](LICENSE) · Esteban Mestrie.

The included demo house uses the [Furniture Kit](https://kenney.nl/assets/furniture-kit) by [Kenney](https://kenney.nl), released under CC0.
