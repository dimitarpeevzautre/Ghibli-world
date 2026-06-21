# Adding high-quality models (AI image-to-3D workflow)

The world runs entirely on procedural geometry, but any building can be replaced by a real
glTF/GLB model. This guide covers producing those models with AI image-to-3D tools and dropping
them in so they automatically pick up the game's cel-shaded look.

## How the pipeline works

1. You generate a `.glb` and put it in **`public/models/`** with one of these names:
   `house.glb`, `chapel.glb`, `cheshma.glb`, `barn.glb`, `gate.glb`, `cross.glb`.
2. On startup `ModelLibrary` loads each file (missing ones are skipped → procedural fallback).
3. For every model it automatically:
   - re-materialises all surfaces to the **ToonMaterial** (banded shading + warm shadows + rim),
     keeping the model's base albedo colour;
   - adds the **inverted-hull ink outline**;
   - **normalises** it: recentres the base to the origin and scales it to a sensible height,
     so it drops onto the sphere correctly with no manual fiddling;
   - enables **cast/receive shadows**.

So your job is only to produce a clean GLB. Style-matching (toon + outline) is automatic.

## Step 1 — Gather references

AI image-to-3D works best from a **single clean reference image** per asset. Use the Bulgarian
Revival references from the brief (Koprivshtitsa, Bozhentsi, Tryavna, Plovdiv Old Town, Melnik)
— a 3/4 front view, plain background, even lighting. You can also first generate a concept image
with an image model, then feed that into the 3D generator.

## Step 2 — Generate

Recommended tools (image- or text-to-3D, GLB export). Check each tool's **commercial license**
before shipping output:

| Tool   | Notes |
| ------ | ----- |
| **Meshy** | Image→3D + text→3D, PBR textures, GLB export, retopo option. Good all-rounder. |
| **Tripo** | Fast, clean topology, image→3D. |
| **Rodin (Hyper3D)** | Strong on buildings/props, high detail. |
| **Luma Genie** | Text→3D, quick concepting. |

Prompt pattern (text), or attach the reference (image-to-3D) with a short style note:

- **House** — "Bulgarian National Revival village house, stone ground floor, whitewashed
  timber-framed overhanging upper storey, deep terracotta tiled hip roof, wooden shutters and a
  carved bay window, stylised low-poly, clean topology, flat warm colours"
- **Chapel** — "small Bulgarian Orthodox village chapel, white plaster walls, apse, a domed drum
  with a cross, a stone bell-tower, terracotta roof, stylised"
- **Чешма** — "old Bulgarian stone public drinking fountain (cheshma), arched niche, brass
  spouts, stone trough, weathered, stylised"
- **Barn / Gate / Cross** — similar phrasing; keep them simple and rustic.

Aim for a **stylised / low-to-mid poly** result (it matches the toon look better than photoreal),
and **flat warm colours** rather than busy textures.

## Step 3 — Export settings

- Format **GLB** (binary, single file).
- **Up axis = +Y**, **forward = +Z** if the tool asks (the loader assumes Y-up).
- Apply transforms; keep the mesh reasonably **centred** (the loader re-centres anyway).
- Triangulated is fine. Target **< ~30k triangles** per building for smooth mobile performance.
- Embed textures in the GLB. Keep texture maps **≤ 1–2K**.
- The loader rescales to a fixed height, so the source scale doesn't matter — but a single,
  upright, ground-level orientation does.

## Step 4 — Drop it in

Save as `public/models/<name>.glb`, then `npm run dev` (or push to redeploy). The building is
swapped in automatically with the toon + outline treatment. Delete the file to revert to
procedural.

### Tuning per model

In `src/main.ts` the `modelLibrary` spec list sets a `targetHeight` per model (world units) —
adjust if a model comes in too big/small. Footprint (for collision) is derived from the model's
bounds automatically.

## Tips for a cohesive look

- Keep a **consistent palette** across models (terracotta roofs, weathered white plaster, warm
  timber) so they sit together — the toon shader keeps each model's base colours.
- Prefer **chunky, simplified forms**; fine photoreal detail fights the ink outline.
- Generate a few **house variants** (we currently load one `house.glb` for all houses — extending
  `ModelLibrary` to pick randomly between `house1/2/3.glb` is a small change if you want variety).
- Roofs/walls read best as **flat colour or gently hand-painted** textures, not noisy PBR.

## Licensing

AI-generated 3D output and any reference imagery you feed in are subject to the generator's terms
and the source image's rights. Confirm commercial-use rights for anything you ship publicly.
