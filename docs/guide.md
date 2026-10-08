# Owlnest — full guide

🇫🇷 [Version française](guide-fr.md) · ← [Back to the README](../README.md)

- [Importing your floor plan](#importing-your-floor-plan)
- [Scene navigation](#scene-navigation)
- [Anchors](#anchors)
- [Openings](#openings)
- [Camera views](#camera-views)
- [Rules engine](#rules-engine)
- [Environment](#environment)
- [Rendering and appearance](#rendering-and-appearance)
- [Keyboard shortcuts (edit mode)](#keyboard-shortcuts-edit-mode)
- [Full YAML reference](#full-yaml-reference)

---

## Importing your floor plan

[▶ Watch the import video](https://www.youtube.com/watch?v=4hBuNCvALFA) (2 min).

Drop your plan onto the card, or click **Import my floor plan** (demo banner, or top of the editor's **Config** tab) and pick the files. The card accepts:

- the folder exported by **Sweet Home 3D** (**3D view → Export to OBJ format**), its files selected together, or a zip of it;
- a `.glb` file. A `.gltf` cannot be imported as is: export a `.glb` instead.

The conversion happens in your browser, textures included. The model is then sent to Home Assistant, stored in `config/owlnest/models/` and shown right away. Only administrators can import; the limit is 300 MB.

### Lightening a heavy plan

When a plan is heavy for a wall tablet (over 150 000 triangles, or textures larger than 1024 px), the card offers to lighten it before converting, and shows the expected gain:

- **very detailed small objects** (dishes, plants, taps) are simplified, within 1 % of their size;
- **large textures** are reduced to 1024 px.

Walls, floors, doors and windows are never touched, so openings and anchors stay exact. The option is unchecked by default; the card remembers your last choice.

### Doors and windows found for you

Sweet Home 3D names the hinges and the moving parts of its doors and windows. On import, the card turns each door and window into a ready-made opening: hinges on the right side, opening towards the inside of the home, sliding panels towards each other. Cupboard and appliance doors are left out. You only pick the sensor of each opening in the **Openings** tab.

If the scene already has openings, the card asks: **Keep mine**, **Add the new ones**, or **Replace**. Replacing keeps the sensor, name, colours and direction of every door or window that is still there, and removes the openings of the previous model. The same choice is in the **Openings** tab.

### Importing again

Drop your plan again after editing it in Sweet Home 3D: anchors, rules, cards and camera views are kept, and the camera frames the new model. Importing over the demo house starts from a clean scene. An imported plan takes precedence over the card's `model_url`.

---

## Scene navigation

| Action | Mouse | Touch |
|---|---|---|
| Orbit | Left-click + drag | One finger + drag |
| Zoom | Scroll wheel | Pinch |
| Pan | Right-click + drag | Two fingers + drag |

---

## Anchors

Anchors are interactive points placed in the 3D scene. Each anchor is linked to a Home Assistant entity.

<p align="center">
  <img src="../assets/moveLight.gif" alt="Moving an anchor in the editor" width="600" />
</p>

### Supported domains

| Domain | Behavior | Visual |
|---|---|---|
| `light` | Creates a synchronized 3D light (color + brightness) | Light point with shadow |
| `switch` | On/off toggle | Switch icon |
| `sensor` | Displays real-time value | Label with value |
| `binary_sensor` | On/off indicator | Colored dot |
| `cover` | Reflects opening percentage | Progress indicator |
| `climate` | Mode indicator (heating/cooling) | Orange/blue based on action |
| `media_player` | Playing/paused indicator | Media icon |


### Light styles

For `light` entities, three styles are available:

| Style | Description |
|---|---|
| `point` | Omnidirectional light (classic bulb) |
| `spot` | Directed cone beam (recessed spotlight) |
| `beam` | Narrow focused beam (projector) |

Style and direction are configured in the anchor properties in edit mode.


### Interactions

- **Short tap** → Toggle the entity (turn light on/off, open/close cover…)
- **Long press** → Open the Home Assistant `more-info` panel for the entity

### Conditional visibility

Each anchor can be shown/hidden based on an entity's state:

> *Example: only show the bedroom temperature sensor when the door is open.*

Configure this in anchor properties → **Visible if** in the editor.

### Advanced options

| Option | Description |
|---|---|
| `label` | Custom text displayed on the label |
| `icon` | Custom MDI icon (e.g. `mdi:thermometer`) |
| `precision` | Decimal places for sensors (e.g. `0` → "18", `1` → "17.6") |
| `lightIntensity` | Light intensity multiplier (default: 1) |

---

## Openings

<p align="center">
  <img src="../assets/openings.gif" alt="A door opening with its entity, handle and state colour included" width="600" />
</p>

Openings are pieces of your model (doors, windows, shutters, a dishwasher or oven door, a reclining sofa) that move when a Home Assistant entity opens or closes. Nothing is changed in the model file: swing, slide and extend detach the piece in the card; **Plays model animations** poses the nodes already stored in the GLB.

> Imported from Sweet Home 3D? Doors and windows are added for you, set up: see [Doors and windows found for you](#doors-and-windows-found-for-you). The steps below are for anything else.

### Adding an opening

1. Edit mode → **Openings** tab → **+ Opening**
2. Click the door, window or shutter on the model
3. Configure it in the panel that opens, use **Preview** to check the movement, then save the scene

The panel is a floating window: drag it by its header to see the model behind it, and keep orbiting while it is open. **Cancel** (or **Escape**) discards your changes, or removes an opening you just created. Opening another opening keeps the settings of the current one; leaving edit mode closes the panel.

### Choosing what moves

The **Object** tree lists the model's objects and groups, like Blender's outliner. Hover a row to highlight it in the view, click it to make it the moving piece: a group moves with everything inside it. The piece you clicked is revealed and selected when the panel opens; **Clicked piece** goes back to just that fragment of the mesh. Use the filter to search by name.

### Options

| Option | Description |
|---|---|
| **Name** | Shown in the Openings list and the panel header |
| **Entity** | Drives the movement. `cover` entities follow `current_position`; `cover`, `valve`, `lock`, `binary_sensor`, `switch`, `light`, `input_boolean`, `fan` and `group` are read as open/closed |
| **Movement** | **Swings** (door, casement window), **Slides** (roller shutter, sliding door), **Extends** (awning, blind, curtain — see below) or **Plays model animations** (Blender NLA tracks in the GLB — see below) |
| **Rotation** | Swings only. **Vertical** for a door, **Horizontal** for a dishwasher/oven door or a top-hung window |
| **Hinge side** | Which edge carries the hinges: one side / the other, or **Bottom** / **Top** for a horizontal rotation |
| **Opens towards** | Which side of the wall the leaf swings to. The model doesn't know where "inside" is, so preview and flip if needed |
| **Opening angle** / **Retracts towards** / **Travel** | Amplitude and direction of the movement |
| **Duration** | Animation length, in seconds |
| **Reverse** | For entities where "open" in Home Assistant means closed on screen |
| **Closed colour** / **Open colour** | Optional tint of the object in each state (**None** to disable). In between, the tint follows the movement |

To remove an opening, click its delete button in the Openings list, then click again within 3 seconds to confirm.

### Awnings, blinds and curtains (Extends)

An **Extends** opening shrinks the selected object along one direction towards a fixed edge. The model shows it **fully open**; closing it shrinks it towards the fixed edge. For an awning, select only the **fabric** in the Object tree, not the cassette or the arms: they are separate objects, so they don't get squashed.

When you switch to **Extends**, Owlnest measures the fabric: the horizontal edge along the wall, the direction that goes down and away from it, and its inclination. You can change all of this, and **↺ Detect again** puts the detected values back.

| Option | Description |
|---|---|
| **Shrinks along** | **Out from the wall** (awning, tilted by the inclination), **Vertical** (blind, curtain that lifts) or **Along the wall** (curtain that draws to the side). The detected axis is marked |
| **Inclination below horizontal** | Out from the wall only. 0° comes out flat, 90° hangs down the wall. By default, the inclination of the fabric |
| **Fixed edge** | The edge that does not move: at the wall / the top / one end by default, or the opposite edge |
| **Size when open** / **Size when closed** | Size along the axis at 100 % and 0 %, relative to the model. Defaults: 100 % and 0 %. Set a few percent when closed to keep a sliver of fabric visible |
| **Closed at** | **0 %** for a standard `cover` (100 % = fully open). **100 %** for a cover that reports the other way round. This is the same setting as **Reverse** |
| **Follows the moving edge** | Objects that move with the free edge without being stretched, such as the front bar of an awning. Objects that touch that edge are suggested automatically (★). They are highlighted in blue in the view, and take the state tint too |

A `cover` with `current_position` is shown at that position. A `cover` that does not report a position is shown fully open or fully closed.

> **Example**: in a model where each awning is made of `motor` (cassette), `tela` (fabric) and `extremo` (front bar, child of the fabric), select `tela` and choose **Extends**. The inclination is detected and `extremo` is suggested as a follower. Only the fabric shrinks: the bar slides up to the cassette.

> **Tip**: The hinge is placed on the edge of the piece's bounding box, not on the object's origin in Blender.

### Model animations (Blender NLA)

If the GLB contains glTF animations (Blender **NLA Tracks** enabled on export), an opening can **play those animations** instead of swinging, sliding or extending. The entity's position scrubs the clip: 0 % is the first keyframe, 100 % the last, and 40 % stays 40 % of the way — the same as a shutter. Pick one or more animations; they all move together.

This motion does not detach anything: the clips pose the nodes they already animate. The Object tree and the pieces that move with the opening are hidden; highlight and tint use the common parent of those nodes (the sofa, not the whole house). Duration defaults to the animation length so it plays at Blender's speed; you can still change it.

You can add several of these openings on the same object (one cover for the right recline, another for the left). A click only reopens an opening if it hits a node that opening actually animates — not the sofa as a whole.

If two openings are given clips that move the same node, the last one applied each frame wins. Prefer disjoint clip sets.

Export from Blender with **Animation → NLA Tracks**. Actions that start at frame 1 (not 0) are handled. three.js sanitises names (`tela.001` → `tela001`).

> **Example**: a reclining sofa exported as `Reclinar_Der`, `Reclinar_Izq`, `Cabezal_Der`, `Cabezal_Izq`. Bind the right-hand cover to `Reclinar_Der` and `Cabezal_Der`; both mechanisms follow that cover's position. A second opening with the left-hand cover and the two `*_Izq` clips leaves the right side alone.

---

## Camera views

Camera views let you save viewpoints and navigate between them with smooth animation.

### Usage

1. Edit mode → **Camera** tab (or click the 📷 icon in the toolbar)
2. Position the camera where you want
3. Click **Capture view** and give it a name
4. The view appears in the navigation bar at the bottom of the scene

<p align="center">
  <img src="../assets/vue.gif" alt="Camera views navigation" width="600" />
</p>

### Hidden views

A view can be marked as **hidden**: it won't appear in the navigation bar but remains available for rules (e.g. "fly to the kitchen when motion is detected").


---

## Rules engine

Rules let you create visual automations internal to the 3D scene.

### Rule structure

```
WHEN   [trigger]       →  a state change occurs
IF     [conditions]    →  all conditions are true (optional)
THEN   [actions]       →  execute one or more actions
```

### Triggers

| Type | Description |
|---|---|
| **State change** | Fires when an entity's state changes. Optional `from` and `to` filters |

*Example: "When `binary_sensor.living_room_motion` changes from `off` to `on`"*

### Conditions

Conditions gate execution (AND logic: all must be true).

| Operator | Description |
|---|---|
| `=` | Equal |
| `≠` | Not equal |
| `>` `<` `≥` `≤` | Numeric comparisons |
| `contains` | Text contains value |

Each condition can be **negated** ("Hide if" mode).

### Actions

| Action | Description |
|---|---|
| **Go to view** | Animate camera to a saved viewpoint |
| **Highlight anchor** | Pulse an anchor in the colour of your choice |
| **Toast** | Show a short message inside the card |
| **Call service** | Call an HA service (e.g. `light.turn_on`, `notify.mobile`) |

### Concrete example

> **Rule "Intrusion alert"**
> - Trigger: `binary_sensor.front_door` changes to `on`
> - Condition: `alarm_control_panel.home` = `armed_away`
> - Actions:
>   - Go to view "Entrance"
>   - Highlight the `light.entrance` anchor in red
>   - Toast "Someone at the front door"

<p align="center">
  <img src="../assets/rules.gif" alt="Rules engine in action" width="600" />
</p>

---

## Environment

Owlnest can synchronize ambient lighting and weather effects with your Home Assistant entities.

### Sun

Set `sun_entity: sun.sun` to have sunlight follow the real sun position.

| Mode | Description |
|---|---|
| **Showcase** | Soft, flattering light, ideal for presentation |
| **Realistic** | Accurate sun position, accounting for house orientation |

In **realistic** mode, set `house_orientation` (in degrees) to align your model's north with real north:
- `0` = model front faces north
- `90` = model front faces east

### Weather

Set `weather_entity: weather.home` for dynamic visual effects:

| HA state | Visual effect |
|---|---|
| Sunny / Clear night | No effect |
| Cloudy | Dimmed light, light haze |
| Rain | Rain particles |
| Pouring | Heavy rain |
| Thunderstorm | Rain + lightning flashes |
| Snow | Snow particles |
| Fog | Dense fog |
| Hail | Hail particles |
| Wind | Wind effect |


<p align="center">
  <img src="../assets/meteo.gif" alt="Weather and sun effects" width="600" />
</p>

---

## Rendering and appearance

All rendering settings are configurable in the editor's **Config** tab.

| Setting | Description | Default |
|---|---|---|
| `shadows` | Enable shadow casting | `false` |
| `exposure` | Global brightness (tone mapping) | — |
| `fog_density` | Ambient fog density | `0.018` |
| `transparent_background` | Transparent background (see-through to dashboard) | `false` |
| `sky` | Atmospheric sky | `false` |
| `sun_intensity` | Sun light intensity | `0.8` |
| `ambient_intensity` | Ambient light intensity | `0.7` |
| `light_occlusion` | Prevent sunlight entering through open roof | `none` |

### Ground styles

| Style | Description |
|---|---|
| `none` | No ground |
| `square` | Square plane |
| `disc` | Circular disc |
| `infinite` | Infinite plane |
| `podium` | Raised pedestal |

Ground color and scale are configurable via `ground_color` and `ground_scale`.

---

## Keyboard shortcuts (edit mode)

| Key | Action |
|---|---|
| **S** | Selection tool |
| **G** | Grab mode (free movement) |
| **X** / **Y** / **Z** | Constrain movement to axis |
| **Ctrl+Z** | Undo |
| **Ctrl+Shift+Z** | Redo |
| **Delete** | Delete selected anchor |

---

## Full YAML reference

Here are all available options:

```yaml
type: custom:ha-3d-floorplan
scene_id: my_home
model_url: /local/models/house.glb
```

> **Note**: Most of these options can be configured directly from the visual editor. YAML is only needed for initial setup (`scene_id` and `model_url`).
