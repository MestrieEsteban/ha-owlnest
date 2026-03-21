# Environment & Weather

Owlnest can synchronize the 3D scene's lighting and atmosphere with real-world conditions from Home Assistant — sun position, weather, and day/night cycle.

---

## Sun synchronization

Connect the sun entity to drive the directional light and sky shader in real time.

```yaml
type: custom:owlnest-card
scene_id: my_home
model_url: /local/models/house.glb
sun_entity: sun.sun
```

HA's `sun.sun` entity exposes `elevation` and `azimuth` attributes. Owlnest uses them to:

- Position the directional sun light in the 3D scene
- Adjust sky color (dawn orange → day blue → dusk red → night dark)
- Control ambient light intensity
- Manage fog color to match the sky tone

**Day/night behavior:**

| Time | Effect |
|---|---|
| Day (elevation > 10°) | Bright directional light, blue sky |
| Golden hour (0–10°) | Warm orange tones, low angle light |
| Dusk (−2° to 0°) | Transition to night sky |
| Night (< −2°) | Dark sky, blue ambient, no sun light |

---

## Weather synchronization

Connect a weather entity to trigger atmospheric effects in the scene.

```yaml
type: custom:owlnest-card
scene_id: my_home
model_url: /local/models/house.glb
weather_entity: weather.home
```

**Supported HA weather states and their effects:**

| HA state | Visual effect |
|---|---|
| `sunny` | Clear sky, full sun |
| `clear-night` | Dark sky, no weather |
| `partlycloudy` | Normal sky |
| `cloudy` | Dimmed light, grey fog |
| `fog` | Heavy fog, reduced visibility |
| `windy` / `windy-variant` | Wind particle trails |
| `rainy` | Rain particles, dark fog |
| `pouring` | Heavy rain, dense fog |
| `lightning` | Atmospheric dimming + lightning flashes |
| `lightning-rainy` | Rain + lightning storm |
| `snowy` | Snow particle field |
| `snowy-rainy` | Mixed snow and light rain |
| `hail` | Fast-falling hail particles |
| `exceptional` | Very dark atmosphere |

---

## Weather effects in detail

### Rain

Animated falling line segments. Heavier rain = more particles, faster fall speed.

Three intensities:
- `rainy` → 900 particles, moderate speed
- `pouring` → 1400 particles, high speed
- `lightning-rainy` → same as pouring + lightning

### Snow

Soft white point particles drifting down with a gentle wind sway. Tracks macro wind oscillation.

### Wind

Horizontal streaks moving across the scene. Direction and speed oscillate subtly over time.

### Fog

No particles — instead, the scene's exponential fog density increases and the fog color shifts to grey-blue. Combined with reduced ambient light for an overcast feel.

### Lightning

Random point light flashes at varying intervals (3–12 seconds). The flash intensity decays quickly (~0.16 seconds). Triggers for `lightning` and `lightning-rainy` states.

### Hail

Short, fast-falling line segments — chunky and opaque compared to rain.

---

## Rendering settings

Fine-tune the scene atmosphere in the card config:

```yaml
rendering:
  exposure: 1.0               # overall brightness multiplier
  fog_density: 0.018          # base fog density (higher = more fog)
  ground_color: "#4a6741"     # colour of the ground plane
  shadows: true               # enable shadow casting from the sun
  sky: true                   # show the sky shader
  ambient_intensity: 0.7      # base ambient light strength
  sun_intensity: 0.9          # directional light strength multiplier
  transparent_background: false  # make the scene background transparent
```

---

## Scene simulation mode

Owlnest includes a **simulation mode** (sun icon in the HUD) that lets you preview any time of day and weather condition without waiting for real conditions.

This is useful for:
- Testing lighting setups at night while it's daytime
- Checking how your scene looks in fog or snow
- Demonstrating the scene to others

In simulation mode, HA data is not used for environment updates — only for entity states.

---

## Tips

- Always add `sun_entity: sun.sun` — it makes the scene feel alive even without weather
- `fog_density: 0.018` is a good default for interior-heavy models; increase slightly for exterior models with a large outdoor area
- Set `transparent_background: true` if you want the card to blend into your dashboard theme
- Simulation mode is great for screenshots and demos
