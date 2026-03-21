# Anchors

Anchors are interactive 3D markers placed directly in the scene, each linked to a Home Assistant entity. They are the primary way to interact with your smart home devices inside Owlnest.

---

## What is an anchor?

An anchor appears as a small icon floating in the 3D scene at the position you choose. Its appearance reflects the current state of the linked entity (on/off, color, brightness). Tapping it triggers an action.

---

## Supported entity types

| Domain | Icon | Tap action |
|---|---|---|
| `light` | Bulb | Toggle on/off |
| `switch` | Switch | Toggle on/off |
| `cover` | Blinds | Toggle open/close |
| `climate` | Thermometer | Toggle on/off |
| `media_player` | Play button | Toggle play/pause |
| `sensor` | Chart | Show value |
| `binary_sensor` | Circle | Show state |

Any other domain is supported — it will use a generic icon.

---

## Adding an anchor

1. Enter **edit mode** (pencil icon)
2. Press `A` or click **+ Add** in the toolbar
3. Click a position in the 3D scene
4. The anchor appears and the properties panel opens on the right
5. Select an **entity** from the autocomplete list

---

## Moving an anchor

- **Grab tool (G):** Press `G` while an anchor is selected, then move the mouse. Press `X`, `Y`, or `Z` to constrain to an axis. Press `Enter` to confirm, `Esc` to cancel.
- **Direct drag:** Click and hold on an anchor, then drag it to the new position. Release to confirm.
- **Gizmo arrows:** Arrows appear on the selected anchor — drag an arrow to move along that axis.

---

## Anchor properties

### Entity association

```
Entity: light.salon
```

Start typing to search across all your HA entities.

### Label

Displayed as a tooltip on hover. Defaults to the entity's friendly name.

### Light style

For `light` entities, choose how the 3D light renders:

| Style | Description |
|---|---|
| `point` | Omnidirectional glow (default) |
| `spot` | Directed cone of light |
| `beam` | Narrow focused beam |

Spot and Beam lights expose an **orientation gizmo** (press `R`) so you can aim the light.

### Light intensity

A multiplier (0–5) applied on top of the HA brightness value.

### Conditional visibility (`visibleIf`)

Show or hide the anchor based on a condition:

```yaml
visibleIf:
  entity_id: binary_sensor.motion_salon
  operator: eq
  value: "on"
```

The anchor only appears when the condition is true. Useful for context-sensitive markers (e.g. show a camera anchor only when motion is detected).

**Available operators:**

| Operator | Meaning |
|---|---|
| `eq` | Equal to |
| `neq` | Not equal to |
| `gt` | Greater than |
| `lt` | Less than |
| `gte` | Greater than or equal |
| `lte` | Less than or equal |
| `contains` | String contains |

Add `negate: true` to invert the result ("hide if" instead of "show if").

---

## Interaction

| Interaction | Result |
|---|---|
| Single tap / click | Toggle entity |
| Long press (650ms) | Open long-press action (configurable via rules) |

When multiple anchors overlap (e.g. a dense room), they collapse into a **cluster**. Tap the cluster to expand it and access individual anchors.

---

## Hiding an anchor

- Press `H` to toggle visibility while the anchor is selected
- Hidden anchors remain in the scene data but are invisible in view mode
- Useful for anchors you want to keep but not always display

---

## Keyboard shortcuts (edit mode)

| Key | Action |
|---|---|
| `A` | Add anchor |
| `G` | Grab (move) |
| `R` | Rotate (spot/beam) |
| `H` | Hide/show |
| `X` | Delete |
| `Ctrl+D` | Duplicate |
| `Ctrl+Z` | Undo |
| `Ctrl+Y` | Redo |

Right-click an anchor for the context menu with all these options.
