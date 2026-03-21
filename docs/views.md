# Camera Views

Camera views let you save named positions in the 3D scene and fly to them instantly — from the HUD, or automatically via rules.

---

## What is a camera view?

A camera view stores:
- The camera **position** (where the eye is)
- The camera **target** (what it's looking at)
- A **label** (the name shown in the HUD)

When you activate a view, the camera smoothly animates ("flies") to that position.

---

## Creating a view

1. Enter **edit mode** (pencil icon)
2. Navigate the scene to the position you want to save
3. Go to the **Views** tab in the editor panel
4. Click **Save current view**
5. Give it a name (e.g. "Living Room", "Kitchen", "Overview")

The view is immediately available in the HUD pill bar at the bottom of the card.

---

## Using views in the HUD

The pill bar at the bottom shows all your visible views. Click or tap a pill to fly to that view instantly.

Views can be **hidden** from the HUD while remaining available to rules. This is useful for automated fly-tos that you don't want cluttering the interface.

To hide a view from the HUD:
- In the Views editor, toggle the **visibility** switch next to the view name

---

## Fly-to animation

The camera transition is animated with a smooth easing curve. The duration adapts to the distance — short hops are quick, cross-scene jumps are slower.

---

## Using views in rules

Views are the primary target of the `go_to_view` action in [Rules](rules.md).

Example — fly to the garden when motion is detected outside:

```yaml
trigger:
  type: entity_state
  entity_id: binary_sensor.motion_garden
  to: "on"
actions:
  - type: go_to_view
    view_id: garden_view
```

The `view_id` is the stable identifier assigned when you create the view (visible in the editor).

---

## Locking the camera

In the top-right HUD you'll find a **lock icon**. When locked:
- The orbit controls are disabled
- The camera stays fixed at the current position
- Useful for kiosk-style displays

The lock state is saved per browser session.

---

## Tips

- Create an **"Overview"** view as your default — position it to show the whole building at once
- Create per-room views for use with motion sensor rules
- Hide views used only by rules so they don't clutter the HUD
- The **home icon** in the HUD (if configured) returns to the default view
