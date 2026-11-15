# Owlnest — performance and model optimizer

Heavy models (tens of MB, millions of triangles) run fine on a PC but can stutter on a wall tablet. The card ships a measuring kit (performance HUD, benchmark) and an optimizer that proposes a catalog of selective changes, each with an estimated gain and a quality cost.

- [Measuring](#measuring)
- [The optimizer](#the-optimizer)
- [Catalog](#catalog)
- [Optimizing on import](#optimizing-on-import)
- [Command line](#command-line)
- [Comparison with gltf-viewer](#comparison-with-gltf-viewer)

---

## Measuring

### Performance HUD

**Config → Performance → Show performance** displays, at the top left of the card:

- frames per second, frame time, draw calls, triangles, shader programs;
- estimated GPU memory (geometry and textures), number of geometries and textures;
- load phases: download, decode, merge (batching), shader compile and first frame.

Frames per second are capped by the screen refresh rate (vsync, usually 60): a model that "does 60" can still have headroom. Compare frame time and draw calls between two versions, not just the frame rate.

### Benchmark

**Config → Performance → Benchmark (10 s)** runs a fixed 360° orbit around the model for 10 seconds, at the distance of the model's size and a 55° elevation, without the frame cap. It reports average frames per second, p95 frame time, draw calls, triangles and GPU memory, then puts the camera back. **Export** downloads the result as JSON (browser, pixel ratio, canvas size and model included), so runs from different devices can be compared.

The trajectory is always the same: two runs on the same device are comparable. Don't touch the screen during the run.

### Tablet baseline (do this first)

1. On the tablet, open the dashboard with the card, in the browser or companion app you normally use. Close other apps.
2. Turn on **Show performance**, wait for the load phases to appear, and note them (download, decode, first frame).
3. Run **Benchmark (10 s)** twice and keep the second result (the first one sometimes includes shader compilation). Export it.
4. Repeat after every change you save, and compare.

---

## The optimizer

**Config → Performance → Optimize model…** (admin only, for models loaded from a URL; not for drawn plans or the demo). A side panel opens:

1. **Analyze** downloads the model and inspects it in a background worker (the card stays usable). The optimizer code (~400 KB) is only downloaded at that moment. For a model over 30 MB on a device with little memory, a warning recommends doing it from a PC: it is the same card and the same flow.
2. Pick a **preset** (Safe, Balanced, Aggressive) or tick items one by one. Each item shows its estimated gain, its cost (none / low / medium / high) and its category.
3. **Rendering** items (A) apply immediately and do not touch the file. They are stored in the scene with **Save**, or reverted when the panel is closed without saving.
4. **Model** items (B lossless, C destructive) need **Preview & compare**: the card runs a benchmark, builds the optimized file in the worker, loads it in place of the current model (nothing is uploaded yet), and runs the benchmark again. The table shows before/after (triangles, primitives, textures, GPU memory, file size, frames per second, draw calls). It also lists any opening, effect or light host that can no longer be found in the optimized model.
5. **Save** uploads the optimized file as a new `<model>-opt-<date>.glb`, points the scene at it and records the operation in the history. The original file is never overwritten. When a destructive item is selected, **Keep a separate copy of the original file** is forced on: the server makes a copy (`<model>-orig-<date>.glb`) before switching.
6. **Restore original model** puts the original URL back (`model_original_url`). The optimized file stays on the server; **Model files** lists every file with its size and lets you delete the ones that are no longer used (files referenced by a scene cannot be deleted).

Protected nodes: anchors, light hosts, openings (parts), effects, animated nodes and `ha_anchor_*` nodes are never renamed, merged or simplified. The list is built automatically from the active scene.

### Rendering settings written to the scene

| Setting | Item | Description |
|---|---|---|
| `physical_materials: false` | A1 | Clearcoat, sheen, iridescence and fine specular are turned off: cheaper shaders. |
| `transmission: false` | A2 | Refractive glass becomes plain translucent glass: one full render pass less per frame. |
| `shadow_policy` | A3 | `all`, `selective` (objects smaller than `shadow_min_size` × model size, or matching `shadow_exclude`, cast no shadow), `sun-only`, `none`. |
| `sun_shadow_static: true` | A4 | The sun shadow is computed once and no longer follows the sun. |
| `spatial_batching` | A5 | Cell size in meters: static meshes are merged by material and by cell, so the camera only draws the cells it sees. |
| `max_pixel_ratio`, `max_fps` | A6 | Caps above the quality profile. |
| `hidden_patterns` | A7 | Regex of object names hidden at display time (still in the file). |
| `max_texture_size`, `texture_anisotropy` | A8 | Textures sent to the GPU are downscaled; anisotropic filtering is capped. |

---

## Catalog

| Item | Category | What it does | Typical cost |
|---|---|---|---|
| A1 | Rendering | Physical materials → standard | Low |
| A2 | Rendering | Transmission off | Low |
| A3 | Rendering | Selective shadows | Low |
| A4 | Rendering | Static sun shadow | Medium |
| A5 | Rendering | Spatial batching | None |
| A6 | Rendering | Pixel ratio / FPS cap | Low to medium |
| A7 | Rendering | Hide objects | Content (reversible) |
| A8 | Rendering | Texture size and anisotropy cap | Low |
| B1 | Lossless | Deduplicate + prune unused data | None |
| B2 | Lossless | Weld vertices + GPU instancing of repeated meshes | None |
| B3 | Lossless | Draco → meshopt + quantization (automatic for Draco input) | None visible |
| B4 | Lossless | Remove unused vertex attributes | None |
| C1 | Destructive | Simplify human figures (target triangles) | Medium |
| C2 | Destructive | Simplify dense props (ratio) | Low to medium |
| C3 | Destructive | Shrink book and cover textures | Low |
| C4 | Destructive | Shrink normal and roughness maps | Low |
| C5 | Destructive | KTX2 textures — not available in the card (needs the KTX-Software tools) | — |
| C6 | Destructive | Bake A1 + A2 into the file, single-sided closed meshes | Low |
| C7 | Destructive | Join static meshes (node names disappear) | Structural |

About B3: Home Assistant serves files without compression, and a meshopt file is bigger than the same Draco file (it is designed to be gzipped). In exchange, decoding is much faster and the Draco decoder (downloaded from Google's CDN) is no longer needed. On the reference model, B3 alone takes the file from 35.7 to 52.2 MB, but cuts geometry GPU memory from 131 to 78 MB. Combined with C1, the file shrinks again.

---

## Optimizing on import

When you drop a `.glb`, the card offers **Optimize for tablets?**: **Keep as is**, **Lossless only** (Safe preset) or **Recommended (slight loss)** (Balanced preset). The dropped file is uploaded first and kept as the original; the optimized version becomes the model, and the suggested rendering settings are pre-filled. If the optimization fails, the original is used and a message says so. The choice is remembered for the next import.

---

## Command line

The same optimizer runs from a PC, on the same core:

```bash
npm run optimize-glb -- model.glb model-opt.glb --preset balanced
npm run optimize-glb -- model.glb model-opt.glb --only B1,C1,C3 --param C1.target=25000
npm run optimize-glb -- model.glb --each --report report.json
```

| Option | Description |
|---|---|
| `--preset safe\|balanced\|aggressive` | Pre-selection (default: balanced). |
| `--only B1,C1,C3` | Exactly these items (overrides the preset). |
| `--param C1.target=25000` | Item parameter (repeatable). |
| `--keep <regex>` | Extra protected node names (repeatable). |
| `--scene <scene.json>` | Owlnest scene exported from the card: protects its anchors, light hosts, openings and effects. Recommended. |
| `--report <report.json>` | Writes the analysis and results as JSON. |
| `--each` | Measures each model item alone against the input, without writing a file. |

Upload the result with the card's import, or copy it to `/config/owlnest/models/` and point `model_url` at it.

---

## Comparison with gltf-viewer

[gltf-viewer](https://gltf-viewer.donmccurdy.com/) is a neutral reference: same three.js, no Owlnest features. The comparison tells what is due to the model and what is due to the card.

### Protocol

1. Same tablet, same browser, same orientation, screen always on, other apps closed.
2. Produce the variants with the CLI (or by saving from the card and downloading them from **Model files**):
   - **v3**: the original;
   - **v3 + rendering**: the original, with A1–A6 in the card (no new file);
   - **v3 + lossless**: `--preset safe`;
   - **v3 + destructive**: `--preset balanced` (and `aggressive`).
3. **gltf-viewer**: open each file, open the stats panel (**Performance**), turn the model by hand at a steady pace for 10 s, note the average frames per second and the draw calls. Leave the viewer's default lighting.
4. **Card, viewer-equivalent**: Config → shadows off, reflections off, no effects, `max_pixel_ratio` equal to the viewer's (the device pixel ratio, often 2 on a tablet; or set both to 1). Run the benchmark twice, keep the second.
5. **Card, production**: your normal settings. Benchmark twice, keep the second. Export the JSON.
6. Fill in the matrix below.

### Matrix

CLI size estimates for a **production furnished home GLB** (~36 MB, Draco, ~3.6 M triangles), measured with glTF-Transform 4.5 (outputs pass glTF Validator with 0 errors and keep the original bounds exactly). The binary itself is not published; only these numbers are.

| Variant | File | Triangles | Primitives | Texture GPU | Geometry GPU |
|---|---|---|---|---|---|
| Original (Draco) | 35.7 MB | 3.62 M | 1,586 | 149.9 MB | 130.8 MB |
| + lossless (safe) | 52.2 MB | 3.62 M | 1,586 | 149.9 MB | 77.7 MB |
| + destructive (balanced) | 24.3 MB | 1.55 M | 1,550 | 84.4 MB | 33.1 MB |
| + destructive (aggressive) | 19.9 MB | 1.24 M | 286 | 69.5 MB | 32.0 MB |

### PC card benchmarks (same model class)

Measured in the card on a desktop PC (canvas 1664×855, DPR 1), fixed orbit benchmark. Numbers are illustrative of a real furnished apartment; paths and filenames are omitted on purpose.

| Stage | avg FPS | p95 frame (ms) | Draw calls | Triangles | GPU mem |
|---|---|---|---|---|---|
| Baseline settings | 67.3 | 17.1 | 1,632 | ~2.43 M | ~230 MB |
| Aggressive preview (before → after) | 117 → 112 | — | 388 → 306 | — → 2.21 M | 232 → 124 MB |
| Chosen history B1+B3+B4+C7 | 116.3 | 11.5 | 304 | ~4.20 M\* | ~227 MB |

\*HUD triangle count after C7 join can rise because frustum culling no longer drops as many separate meshes; draw calls still drop sharply.

Gains of the chosen config vs baseline settings: **+73% FPS**, **−81% draw calls**, similar VRAM (no C3/C4 texture shrink in that history).

Frames per second on the tablet (fill in with your device):

| Variant | gltf-viewer | Card, viewer-equivalent | Card, production |
|---|---|---|---|
| Original | | | |
| + rendering (A1–A6) | n/a | | |
| + lossless | | | |
| + destructive (balanced) | | | |
| + destructive (aggressive) | | | |
| + KTX2 | not available (C5) | | |

How to read it: if the card in viewer-equivalent mode is close to gltf-viewer, the remaining gap in production comes from shadows, reflections and effects (rendering items A). If both are slow, the model itself is the bottleneck (model items B and C).
