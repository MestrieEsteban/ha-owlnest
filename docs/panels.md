# 3D Panels

Panels are floating information cards displayed directly inside the 3D scene. They show entity states, room summaries, or static annotations — without leaving the 3D view.

---

## Panel types

### Room panel

Summarises a room with an optional icon, name, and up to 4 entity states.

**Best for:** labelling spaces with the most relevant live information (temperature, occupancy, lights on/off…).

```yaml
type: room
name: "Living Room"
icon: "🛋️"
entities:
  - sensor.salon_temperature
  - light.salon
  - binary_sensor.motion_salon
size: medium
accentColor: "#7dd3fc"
```

**Display options:**

| Option | Default | Description |
|---|---|---|
| `show.name` | `true` | Show the room name |
| `show.icon` | `true` | Show the emoji/icon |
| `show.entities` | `true` | Show the entity list |

---

### Entity panel

Focuses on a single entity — displays the state value prominently, with an optional action button.

**Best for:** sensors, switches, or any single-entity interaction point.

```yaml
type: entity
name: "Thermostat"
entity_id: climate.salon
label: "Salon"
size: small
show:
  label: true
  state: true
  unit: true
  button: true
action:
  domain: climate
  service: set_temperature
  service_data:
    temperature: 21
```

**Display options:**

| Option | Default | Description |
|---|---|---|
| `show.label` | `true` | Show the label above the state |
| `show.state` | `true` | Show the current state value |
| `show.unit` | `true` | Show the unit of measurement |
| `show.button` | `false` | Show an action button |

---

### Info panel

A static annotation: icon + title + optional subtitle. Non-interactive.

**Best for:** labelling spaces, objects, or areas with fixed contextual information.

```yaml
type: info
name: "Server Room"
icon: "🖥️"
subtitle: "Do not enter"
color: "#fbbf24"
size: small
```

**Display options:**

| Option | Default | Description |
|---|---|---|
| `show.icon` | `true` | Show the icon |
| `show.name` | `true` | Show the name |
| `show.subtitle` | `true` | Show the subtitle |

---

## Common properties

All panel types share these base properties:

| Property | Required | Description |
|---|---|---|
| `type` | Yes | `room`, `entity`, or `info` |
| `name` | Yes | Display name |
| `position` | Yes | `[x, y, z]` world coordinates |
| `size` | No | `small`, `medium` (default), or `large` |
| `accentColor` | No | Accent color (overrides template default) |
| `visible` | No | Editorial show/hide (default `true`) |
| `visibleIf` | No | Runtime condition — see below |

---

## Panel sizes

| Size | Width (metres) |
|---|---|
| `small` | 0.6 m |
| `medium` | 1.0 m (default) |
| `large` | 1.5 m |

The panel always faces the camera (billboard behavior).

---

## Adding a panel

1. Enter **edit mode**
2. Go to the **Panels** tab in the editor
3. Click **Add panel** and choose a type
4. The panel appears in the scene — drag it to position
5. Fill in the properties in the right panel

---

## Conditional visibility

Show or hide a panel based on entity state:

```yaml
visibleIf:
  entity_id: binary_sensor.motion_garage
  operator: eq
  value: "on"
```

The panel only renders when the condition is true.

You can also use [Rules](rules.md) to show/hide panels on state changes:

```yaml
trigger:
  type: entity_state
  entity_id: binary_sensor.door_front
  to: "on"
actions:
  - type: show_card
    card_id: front_door_panel
```

---

## Tips

- Use **Room panels** as permanent room labels
- Use **Entity panels** near appliances (thermostat, TV, washing machine)
- Use **Info panels** for static annotations (floor labels, zone names)
- Combine `visibleIf` with motion sensors to show context-sensitive info
