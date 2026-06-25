# Selo — Phase 7: "Living Landscape" (Design Spec)

**Date:** 2026-06-25
**Status:** Approved (design), pending implementation plan

## Goal

Selo already nails the hard part — a real spherical, no-poles, cel-shaded walkable
planet. The one remaining gap is **world building**: today the planet is a perfectly
smooth green ball with uniformly-scattered props, so it reads as a tech demo rather than
the beautiful little world seen in the reference game *Messenger* (abeto).

This phase makes the world genuinely beautiful **while keeping Selo's identity** — the
muted Bulgarian-Revival Ghibli art direction stays; we add shape, color variety, regions,
water, and real composition.

### Decisions locked during brainstorming

| Decision | Choice |
| --- | --- |
| Art direction | Keep Selo's Bulgarian-Revival Ghibli soul; make it beautiful (no pivot to Messenger's saturated look) |
| Terrain drama | **Gentle rolling hills** — pastoral, comfortable for camera & walking |
| Terrain engine | **Analytic height field** — a pure `heightAt(direction)` function as the single source of truth (no `three-mesh-bvh`, no new deps) |
| Props | Keep procedural Three.js props; push fidelity/variety, don't replace with GLB |

### Non-goals (YAGNI)

- No gameplay loop (deliveries), no multiplayer, no character customization — the user's
  only concern is scenery.
- No external GLB asset pipeline change.
- No new runtime dependencies (no `three-mesh-bvh`).
- No equirectangular/painted heightmaps (would reintroduce pole seams Selo deliberately avoids).

## Core principle (unchanged)

Everything still derives from a point's **direction vector**. The height field is a pure
function of direction, so the no-poles property is preserved: there is no latitude/longitude
and no singularity anywhere on the globe.

## Architecture

### 1. `core/Terrain.ts` (new) — the height field

The single source of truth for the shape of the world. Dependency-free.

- `heightAt(dir: Vector3): number` — elevation above the base radius, as a pure function of a
  (normalized) surface direction. Composed of:
  - **Rolling hills:** 3–4 octaves of seeded value/gradient noise sampled at `dir * frequency`,
    low amplitude (~±1.5 on the radius-40 planet) for a *gentle* result.
  - **Village basin:** a smooth radial falloff centered on the village `center` that lowers and
    **flattens** the terrain locally, so the collision-spaced village sits in a gentle dip on
    near-level ground (buildings will not tilt or intersect terrain).
  - **Stream channel:** a narrow carved valley following a meandering path, lowered enough to
    hold water in its bed.
- `normalAt(dir: Vector3): Vector3` — surface normal via finite-difference gradient of `heightAt`
  along two tangent axes, crossed and normalized.
- Deterministic: driven by the existing seed system (`setSeed`) so the world is reproducible.
- Self-contained noise implementation (small value/gradient noise), no npm dependency.

Amplitude budget (radius = 40): hills ≈ ±1.5; village basin ≈ −1.0 relative to local; stream
bed ≈ −0.6. All gentle, tunable via lil-gui later.

### 2. `core/Planet.ts` — integrate the height field

- Increase `IcosahedronGeometry` detail enough for smooth hills, and **displace each vertex**
  outward by `heightAt(normalize(vertex))`. Recompute vertex normals.
- `surfacePoint(dir, h)` → `dir * (radius + heightAt(dir) + h)`.
- `localUp(point)` → `normalAt(normalize(point))` (true terrain normal). Keep a `radialUp(point)`
  helper (= `normalize(point)`) as a fallback for anything that needs a level horizon.
- `placeOnSurface(obj, dir, height, yaw, { up })` becomes height-aware and takes an up-vector mode:
  - **buildings** → radial up (stand straight, no tilt);
  - **trees / rocks / small props** → terrain-normal up (sit naturally on slopes).
- Remains the single source of truth for "where is the surface and which way is up."

### 3. Player + camera adaptation

- `core/PlayerController.ts`: after the great-circle tangent step and re-projection of the
  direction, set radial distance to `radius + heightAt(dir)` so the player hugs the terrain;
  slerp the model's up toward `normalAt(dir)`. Gentle slopes ⇒ walk feel unchanged.
- `core/CameraRig.ts`: point the rig's smoothed up at the smoothed terrain normal (it already
  damps local up), so rolling hills never flip the horizon; add a small height nudge so the
  camera clears crests. Existing camera collision is retained.

### 4. Terrain coloring & regions — vertex colors

The planet stops being one flat green. Extend `render/ToonMaterial.ts` to support per-vertex
colors (multiply the banded diffuse by vertex color, instancing path untouched). Each terrain
vertex is colored from **height + slope + low-frequency region noise**, all within the existing
`palette`:

| Region | Where | Color family |
| --- | --- | --- |
| Valley meadow | low + flat | lush warm green |
| Hillsides | mid elevation | blended greens, occasional autumn-warm pockets (region noise) |
| Highland pasture | high + gentle | paler, slightly golden grass |
| Steep faces | high slope | exposed `stone` / `stoneDark` (reads as *carved*) |
| Water's edge | near stream/pond | sandy/gravel tone |

This delivers colorful variety **without leaving the Ghibli palette**.

### 5. Composition — terrain-driven placement (`world/VillageLayout.ts`)

Replace uniform `randomDirection()` scatter with intentional, terrain-aware placement:

- **Village** in the flattened basin (already collision-spaced via the rejection sampler; now
  also height-aware).
- **Forests** as *clusters* on the hillsides (pick cluster centers, scatter trees around them
  with falloff) — real woods with clearings, not even spray.
- **Highland pasture**: sparse trees, scattered **boulders** (a new simple procedural rock prop,
  instanced), haystacks.
- **Riverside**: reeds, bushes, a couple of willows, and a **footbridge** (new simple procedural
  prop) where a path crosses the stream — a natural landmark / focal point.
- **Density gradients**: lush near water and mid-slope; sparse on tops and inside the square.
- All high-count props remain `InstancedMesh` with matching instanced outlines.

### 6. Water — stream + pond

- **Stream:** a strip/ribbon mesh following the carved channel path, with a simple toon-water
  material (gentle blue-green, semi-translucent), sitting just below its banks.
- **Pond:** the existing `createPond` prop dropped into a carved hollow.
- Animated shimmer is out of scope for this phase (can come later); keep water mostly static to
  bound the work.

### 7. Light touch — sky / fog / sun

Tune fog distance so hills gain depth, and warm the sun slightly toward golden hour to flatter
the rolling pasture. Small, done last.

## Build order (each step independently visible & testable)

- **7a — Terrain engine + planet displacement + player/camera.** Highest risk (touches
  locomotion); must be solid before anything else. Acceptance: walk the whole globe over hills
  with no clipping, no horizon flips, comfortable camera.
- **7b — Terrain coloring & regions.** Acceptance: the world reads as multi-region and is no
  longer monochrome; colors stay on-palette.
- **7c — Composition: terrain-driven placement.** Acceptance: forests cluster on hillsides,
  highland/riverside regions are distinct, village sits in its basin, nothing intersects.
- **7d — Water + footbridge + final color/fog/sun tuning.** Acceptance: stream + pond read as
  water in carved beds; footbridge landmark present; final look cohesive.

## Risks & mitigations

| Risk | Mitigation |
| --- | --- |
| Locomotion/camera discomfort on slopes | "Gentle" terrain choice; slerped normals; radial-up fallback available |
| Village buildings tilting / intersecting | Flattened village basin in `heightAt`; radial up for buildings |
| Performance regression | Terrain is one mesh; runtime `heightAt` is a few noise evals; props stay instanced |
| Non-determinism | Keep the existing seed system for a reproducible world |

## Touched files (anticipated)

- `core/Terrain.ts` (new)
- `core/Planet.ts` (height-aware surface + normals)
- `core/PlayerController.ts` (hug terrain, slerp to terrain normal)
- `core/CameraRig.ts` (up tracks terrain normal, height nudge)
- `render/ToonMaterial.ts` (optional vertex-color support)
- `world/VillageLayout.ts` (terrain-driven, clustered placement; basin-aware village)
- `world/props/index.ts` (new boulder + footbridge props; water material)
- `main.ts` (wire terrain into lil-gui tuning; fog/sun tweaks)
