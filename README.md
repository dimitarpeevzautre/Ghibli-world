# Село (Selo)

A walkable, Studio-Ghibli-styled **miniature planet** — a tiny spherical world themed as a
rural **Bulgarian Revival-era village** (Възрожденско село) with stone-and-timber houses and
cobblestone (калдъръм) streets. *Super Mario Galaxy* locomotion meets *Only Yesterday* art
direction, running in the browser on Three.js + WebGL2.

> The world is a **real sphere**, not a curved-world shader trick. The character physically
> walks the entire surface — you can circle the globe, and there are no poles to break on.

## Quick start

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # typecheck + production build into dist/
npm run preview  # serve the production build
```

## Controls

| Input            | Action                                  |
| ---------------- | --------------------------------------- |
| **W A S D**      | Walk / strafe along the surface         |
| **Mouse**        | Look (click the canvas to capture it)   |
| **Shift**        | Run                                     |
| **Scroll**       | Zoom the follow camera                  |
| **Esc**          | Release the mouse                       |

Open the **lil-gui** panel (top-right) to live-tune cel-shading bands, ink outlines, the sun,
the painterly sky and the paper-grain post-FX.

## How the spherical world works (the core pillar)

Everything derives from a point's **direction vector** — no latitude/longitude, so there are no
pole singularities. Vectors and quaternions throughout.

- **Local up** at any point `P` is `normalize(P)` (planet is centred at the origin).
- **Great-circle walking** (`core/PlayerController.ts`): build a tangent frame from the local
  up + heading, apply WASD input in that tangent plane, then **re-project** the new position
  back onto the sphere. This produces motion along great circles that works identically over
  the whole globe, including the "top" and "bottom".
- **Orientation** is a quaternion aligning the model's `+Y` to the local up and its `+Z` to the
  heading, slerped each frame to avoid snapping.
- **Follow camera** (`core/CameraRig.ts`): holds an offset *behind and above* the player **in
  the player's local frame**, with positional/rotational damping; its up tracks the player's
  smoothed local up so circling the planet never flips the horizon.
- **Prop placement** (`core/Planet.ts → placeOnSurface`): one helper orients every building,
  tree, fence and stone so its `+Y` follows the surface normal, with a chosen yaw. The same
  helper powers `world/VillageLayout.ts`.

## Ghibli cel-shading

- **Banded diffuse** with warm-shifted shadows + Fresnel **rim light** (`render/ToonMaterial.ts`,
  custom GLSL `ShaderMaterial`; lit by a single sun fed as world-space uniforms — also works on
  `InstancedMesh`).
- **Ink outlines** via the inverted-hull method (`render/OutlinePass.ts`), instancing-aware.
- **Painterly sky dome** with a watercolour gradient + drifting noise clouds (`render/SkyDome.ts`).
- **Paper-grain / colour-grade** post-process (`render/PostFX.ts`, EffectComposer + OutputPass).

## Project layout

```
src/
  main.ts                  bootstrap: renderer, scene, loop, lil-gui
  core/
    Planet.ts              sphere geometry + surface helpers (localUp, placeOnSurface)
    PlayerController.ts     great-circle locomotion + orientation
    CameraRig.ts           damped third-person follow in the local frame
    Input.ts               keyboard + pointer-lock mouse (abstracted for later touch)
  render/
    ToonMaterial.ts        banded diffuse + rim (GLSL)
    OutlinePass.ts         inverted-hull ink outlines
    SkyDome.ts             painterly sky
    PostFX.ts              paper-grain + colour grade
  world/
    VillageLayout.ts       places landmarks/houses/streets on the sphere
    props/index.ts         house, chapel, чешма, tree, pot, haystack, cobblestone, fence…
  assets/                  glb models, ramp & texture maps (Phase 5)
```

## Build phases & status

- [x] **Phase 0 — Scaffold:** Vite + TS + Three.js, planet sphere, camera, sun.
- [x] **Phase 1 — Spherical controller:** WASD great-circle walking, third-person follow, no
      pole glitches. *(The milestone that proves the concept.)*
- [x] **Phase 2 — Cel shading:** toon material + inverted-hull outline + rim, lil-gui controls.
- [x] **Phase 3 — Atmosphere:** painterly sky dome, warm lighting, paper-grain post-FX.
- [x] **Phase 4 — World placement:** `placeOnSurface`; primitive houses/trees on the sphere,
      instanced cobblestones, fences and bushes wrapping the whole globe.
- [ ] **Phase 5 — Village assets:** swap primitives for modeled Revival houses, чешма, chapel.
- [ ] **Phase 6 — Life & polish:** chimney smoke / leaf particles, idle animation, sound,
      draw-call audit.

Props in Phases 4 are deliberately built from Three.js primitives as Bulgarian-Revival
stand-ins (terracotta roofs, whitewashed plaster, timber overhangs, stone чешма) so the world
reads correctly before real glTF/GLB models are dropped into `src/assets/`.

## Performance notes

Repeated props (cobblestones, fence posts, bushes) use `InstancedMesh` with matching instanced
outline meshes; the toon and outline shaders are instancing-aware. Distance fog (matched to the
sky) hides the far side of the globe so we never draw the whole planet at full detail.
