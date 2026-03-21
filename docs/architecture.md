# Architecture

This document describes the technical structure of Owlnest for contributors and advanced users.

---

## Overview

Owlnest is split into two parts that communicate via Home Assistant's WebSocket API:

```
┌─────────────────────────────┐
│   Frontend (Lovelace card)  │
│   Three.js + TypeScript     │
│   Web Component             │
└────────────┬────────────────┘
             │  WebSocket (HA callWS)
             │
┌────────────▼────────────────┐
│   Backend (HA Integration)  │
│   custom_components/owlnest │
│   Python                    │
└────────────┬────────────────┘
             │
┌────────────▼────────────────┐
│   Home Assistant Core       │
│   Entity states             │
│   Persistent Storage        │
└─────────────────────────────┘
```

---

## Frontend

**Stack:** TypeScript, Three.js, Vite

**Entry point:** `src/ha-3d-floorplan.ts` — the Web Component (`<owlnest-card>`) registered as `custom:owlnest-card`

### Source structure

```
src/
├── ha-3d-floorplan.ts     # Main Web Component — lifecycle, hass updates, HUD
├── editor.ts              # Edit mode — gizmos, grab tool, keyboard shortcuts
├── scene.ts               # Three.js scene setup — renderer, camera, OrbitControls
├── overlay.ts             # AnchorOverlay, ClusterOverlay — 2D-on-3D markers
├── lights.ts              # Light synchronization — HA state → Three.js lights
├── model.ts               # GLB/GLTF loading via GLTFLoader
├── types.ts               # All shared TypeScript types
├── i18n.ts                # Internationalization (en/fr)
│
├── card/
│   ├── edit-panel.ts      # Editor side panel (properties, anchors, views, rules)
│   ├── environment.ts     # Sun + weather effects (sky, rain, snow, fog, lightning…)
│   ├── simulation.ts      # Simulation mode controller
│   └── view-manager.ts    # Camera views — save, fly-to, HUD pills
│
├── cards/
│   ├── types.ts           # SceneCard type system (RoomCard, EntityCard, InfoCard)
│   └── renderer.ts        # 3D panel rendering
│
├── panels/
│   └── gizmo.ts           # XYZ translation gizmo + rotation rings (edit mode)
│
└── rules/
    ├── types.ts           # Rule / Trigger / Condition / Action types
    └── engine.ts          # Pure evaluation functions (no side effects)
```

### Data flow (view mode)

```
hass setter called (HA state change)
  │
  ├─ rules/engine.ts → triggerFired() + conditionsMet()
  │     └─ execute actions (go_to_view, show_card, call_service…)
  │
  ├─ lights.ts → syncLightsToScene()
  │     └─ HA light state → Three.js PointLight / SpotLight intensity + color
  │
  ├─ environment.ts → updateFromHass()
  │     ├─ sun.sun elevation/azimuth → directional light + sky shader
  │     └─ weather entity state → weather particles + atmosphere
  │
  └─ overlay.ts → update anchor visibility (visibleIf conditions)
```

### Data flow (edit mode)

```
User drags anchor (G-grab or direct drag)
  │
  ├─ editor.ts → _onPointerMove() → move EditableAnchor position
  ├─ lights.ts → syncEditorLightsToScene() (live preview)
  └─ (no save until confirm)

User confirms (Enter / pointerup)
  │
  ├─ position written to EditableAnchor
  ├─ auto-save debounce starts (2s)
  └─ backend WebSocket: owlnest/save_scene
```

---

## Backend

**Stack:** Python, Home Assistant integration

**Location:** `custom_components/owlnest/`

### WebSocket commands

The frontend communicates with the backend via `hass.callWS()`:

| Command | Description |
|---|---|
| `owlnest/list_scenes` | List all saved scene IDs |
| `owlnest/load_scene` | Load a scene by `scene_id` |
| `owlnest/save_scene` | Save / update a scene |
| `owlnest/delete_scene` | Delete a scene |

### Persistence

Scenes are stored in HA's [Store](https://developers.home-assistant.io/docs/dev_101_hass/#persistent-storage) — a JSON file in `.storage/owlnest_scenes.json`.

Each scene is an `OwlnestScene` object:

```typescript
interface OwlnestScene {
  version: number;
  scene_id: string;
  model_url?: string;
  anchors: OwlnestAnchor[];
  camera_views: CameraView[];
  cards: SceneCard[];
  rules: OwlnestRule[];
  settings?: SceneSettings;
}
```

---

## Build

```bash
npx vite build
```

Output: `dist/ha-3d-floorplan.js` — a single bundled JS file deployed via HACS to `www/community/owlnest/`.

**Tech stack versions:**
- Three.js r170+
- TypeScript 5+
- Vite 6+

---

## Key design decisions

| Decision | Reason |
|---|---|
| Single bundle JS | Simpler HACS deployment, no module resolution issues in HA |
| WebSocket for scene data | Avoids YAML config bloat — scenes live in HA storage, not `configuration.yaml` |
| Pure rule engine | `rules/engine.ts` has no Three.js imports — easy to unit test in isolation |
| `_editorDragging` flag | Prevents auto-save and hass updates during drag operations (avoids flicker) |
| 2-second save debounce | Batches rapid edits into a single backend write |
| `passive: true` on touchstart | Required for scroll performance — touchend handles the action |

---

## Contributing

1. Clone the repo
2. `npm install`
3. `npx vite build --watch` for live rebuilds
4. Copy `dist/ha-3d-floorplan.js` to your HA `www/community/owlnest/` folder
5. Hard-refresh the browser (Ctrl+Shift+R) after each build

Types are strict — `tsconfig.json` enforces `strict: true`. No `any` except where Three.js internals require it.
