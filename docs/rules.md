# Rules

Rules are Owlnest's automation system. They let you react to Home Assistant state changes directly inside the 3D scene — flying to a room, showing a panel, hiding an anchor, or calling any HA service.

---

## Concept

A rule has three parts:

```
TRIGGER  →  CONDITIONS  →  ACTIONS
```

- **Trigger:** what fires the rule (a state change)
- **Conditions:** optional guards (all must pass — AND logic)
- **Actions:** what happens when the rule fires

Rules are evaluated every time entity states change in HA.

---

## Trigger types

### `entity_state`

Fires when a specific entity changes state.

```yaml
trigger:
  type: entity_state
  entity_id: binary_sensor.motion_salon
```

**Optional filters:**

```yaml
trigger:
  type: entity_state
  entity_id: binary_sensor.motion_salon
  from: "off"   # only fire when coming from this state
  to: "on"      # only fire when going to this state
```

If neither `from` nor `to` is specified, the rule fires on any state change.

---

## Conditions

Conditions are optional additional checks evaluated after the trigger fires. All conditions must pass (AND logic).

```yaml
conditions:
  - entity_id: alarm_control_panel.home
    operator: eq
    value: "armed_away"
  - entity_id: sensor.time
    operator: gte
    value: "22:00"
```

**Available operators:**

| Operator | Meaning | Example |
|---|---|---|
| `eq` | Equal | `state == "on"` |
| `neq` | Not equal | `state != "unavailable"` |
| `gt` | Greater than | `temperature > 25` |
| `lt` | Less than | `temperature < 10` |
| `gte` | Greater than or equal | `brightness >= 80` |
| `lte` | Less than or equal | `battery <= 20` |
| `contains` | String contains | `media_title contains "Netflix"` |

**Evaluating attributes:**

```yaml
conditions:
  - entity_id: climate.salon
    attribute: current_temperature
    operator: gt
    value: 25
```

**Negate a condition:**

```yaml
conditions:
  - entity_id: input_boolean.vacation_mode
    operator: eq
    value: "on"
    negate: true   # "vacation mode is NOT on"
```

---

## Actions

### `go_to_view`

Fly the camera to a saved view.

```yaml
actions:
  - type: go_to_view
    view_id: salon_view
```

The `view_id` is shown in the Views editor. Useful for drawing attention to a room when an event occurs.

---

### `show_card`

Make a 3D panel visible.

```yaml
actions:
  - type: show_card
    card_id: front_door_panel
```

---

### `hide_card`

Hide a 3D panel.

```yaml
actions:
  - type: hide_card
    card_id: front_door_panel
```

---

### `call_service`

Call any Home Assistant service.

```yaml
actions:
  - type: call_service
    domain: light
    service: turn_on
    service_data:
      entity_id: light.salon
      brightness_pct: 100
      color_name: red
```

---

## Multiple actions

A rule can execute multiple actions in sequence:

```yaml
actions:
  - type: go_to_view
    view_id: garden_view
  - type: show_card
    card_id: garden_alert
  - type: call_service
    domain: notify
    service: notify
    service_data:
      message: "Motion detected in garden"
```

---

## Complete examples

### Motion in garden → fly to garden view

```yaml
trigger:
  type: entity_state
  entity_id: binary_sensor.motion_garden
  to: "on"
actions:
  - type: go_to_view
    view_id: garden_view
```

---

### Front door open → show door panel (only when home)

```yaml
trigger:
  type: entity_state
  entity_id: binary_sensor.door_front
  to: "on"
conditions:
  - entity_id: person.esteban
    operator: eq
    value: "home"
actions:
  - type: show_card
    card_id: front_door_panel
```

---

### Front door closed → hide door panel

```yaml
trigger:
  type: entity_state
  entity_id: binary_sensor.door_front
  to: "off"
actions:
  - type: hide_card
    card_id: front_door_panel
```

---

### High CO2 → turn on ventilation + fly to room

```yaml
trigger:
  type: entity_state
  entity_id: sensor.co2_bedroom
conditions:
  - entity_id: sensor.co2_bedroom
    operator: gt
    value: 1200
actions:
  - type: go_to_view
    view_id: bedroom_view
  - type: call_service
    domain: switch
    service: turn_on
    service_data:
      entity_id: switch.ventilation_bedroom
```

---

## Managing rules

Rules are managed in the **Rules** tab of the editor (edit mode). Each rule can be:
- **Enabled/disabled** without deleting it
- Given a **label** for readability
- Reordered (rules are evaluated in order)

---

## Tips

- Keep rules focused — one trigger, one intent
- Use `conditions` to avoid false positives (e.g. only react when someone is home)
- Combine `go_to_view` + `show_card` for a "camera-to-event" experience
- Use `visibleIf` on anchors/panels for passive visibility — reserve rules for active transitions
