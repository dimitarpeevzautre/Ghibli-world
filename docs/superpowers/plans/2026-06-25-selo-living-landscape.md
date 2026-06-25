# Selo "Living Landscape" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Selo's smooth green sphere gentle rolling-hill terrain, multi-region color, terrain-driven composition, and water — making the world beautiful while keeping its Bulgarian-Revival Ghibli identity.

**Architecture:** A new dependency-free `core/Terrain.ts` exposes a pure `heightAt(direction)` height field (noise hills + a flattened village basin + a carved stream channel) plus `normalAt` and `colorAt`. `Planet` owns a `Terrain` and routes all surface queries through it, so the player, camera, collision, and prop placement follow the terrain automatically. Coloring is done with per-vertex colors on the planet mesh; placement is rewritten to cluster props by region.

**Tech Stack:** TypeScript, Three.js 0.169, Vite, lil-gui. Vitest (new dev-only) for unit-testing the pure terrain math.

## Global Constraints

Copied from the design spec (`docs/superpowers/specs/2026-06-25-selo-living-landscape-design.md`). Every task implicitly includes these:

- **No new runtime dependencies.** Vitest may be added as a **devDependency** only. No `three-mesh-bvh`.
- **Preserve the no-poles property:** all terrain is a pure function of the surface direction vector — no latitude/longitude, no singularities.
- **Deterministic:** terrain shape and placement must be reproducible. The height field must NOT call the shared `rand()` (it must use its own pure hash noise so it cannot perturb `VillageLayout`'s seeded placement).
- **Stay on-palette:** ground/region colors are muted Ghibli tones (greens, stone-grey, warm sand, soft autumn gold). No saturated/cartoon colors.
- **Gentle terrain:** hill amplitude ≈ ±1.5 on the radius-42 planet; village basin ≈ −1.0; stream bed ≈ −0.7.
- **Keep high-count props instanced** (`InstancedMesh` + matching instanced outline), as today.
- Planet radius is **42** (passed from `main.ts`); never hard-code it in modules — take it as a parameter or read `planet.radius`.

---

## File structure

| File | Responsibility | Action |
| --- | --- | --- |
| `src/core/Terrain.ts` | Height field, normals, region + color classification, stream path. Pure, dependency-free. | Create |
| `src/core/Terrain.test.ts` | Unit tests for the terrain math. | Create |
| `src/core/Planet.ts` | Own a `Terrain`; terrain-aware `surfacePoint`/`localUp`/`placeOnSurface`; displace + color the mesh. | Modify |
| `src/render/ToonMaterial.ts` | Optional per-vertex color support. | Modify |
| `src/world/props/index.ts` | New `createBoulder`, `createFootbridge`, boulder instanced geo/material, water material. | Modify |
| `src/world/VillageLayout.ts` | Terrain-aware `surfaceMatrix`; region-driven clustered placement; stream + footbridge. | Modify |
| `src/main.ts` | Pass village center to `Planet`; final fog/sun tuning. | Modify |
| `package.json`, `vitest.config.ts` | Test runner. | Modify / Create |

---

## Task 1: Terrain module + test runner

**Files:**
- Modify: `package.json` (add `vitest` devDependency + `test` script)
- Create: `vitest.config.ts`
- Create: `src/core/Terrain.ts`
- Test: `src/core/Terrain.test.ts`

**Interfaces:**
- Consumes: nothing (pure module; imports only `three`).
- Produces:
  - `type Region = 'meadow' | 'hillside' | 'highland' | 'rock' | 'waterside'`
  - `interface TerrainConfig { hillAmplitude?: number; hillFrequency?: number; basinRadius?: number; basinDepth?: number; streamWidth?: number; streamDepth?: number; seed?: number }`
  - `class Terrain` with:
    - `constructor(center: THREE.Vector3, config?: TerrainConfig)`
    - `readonly center: THREE.Vector3`
    - `readonly streamPath: THREE.Vector3[]` (unit directions sampling the river)
    - `heightAt(dir: THREE.Vector3): number`
    - `normalAt(dir: THREE.Vector3, radius: number, target?: THREE.Vector3): THREE.Vector3`
    - `regionAt(dir: THREE.Vector3, radius: number): Region`
    - `colorAt(dir: THREE.Vector3, radius: number, target?: THREE.Color): THREE.Color`

- [ ] **Step 1: Add the test runner**

Edit `package.json` — add to `devDependencies` and `scripts`:

```jsonc
// scripts:
"test": "vitest run",
"test:watch": "vitest",
// devDependencies:
"vitest": "^2.1.4"
```

Then install:

```bash
npm install
```

- [ ] **Step 2: Configure vitest (node env, only test files)**

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node', // terrain math is pure; no DOM needed
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 3: Write the failing tests**

Create `src/core/Terrain.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Terrain } from './Terrain';

const CENTER = new THREE.Vector3(0, 1, 0).normalize();
const RADIUS = 42;

function randDir(i: number): THREE.Vector3 {
  // deterministic pseudo-random unit vectors (no Math.random in tests)
  const a = i * 2.39996, b = i * 1.61803;
  return new THREE.Vector3(Math.cos(a) * Math.cos(b), Math.sin(b), Math.sin(a) * Math.cos(b)).normalize();
}

describe('Terrain.heightAt', () => {
  const terrain = new Terrain(CENTER);

  it('is deterministic for the same direction', () => {
    const d = randDir(7);
    expect(terrain.heightAt(d)).toBe(terrain.heightAt(d.clone()));
  });

  it('stays within a gentle, bounded range', () => {
    for (let i = 0; i < 500; i++) {
      const h = terrain.heightAt(randDir(i));
      expect(Number.isFinite(h)).toBe(true);
      expect(h).toBeLessThan(2.0);     // hill amplitude ~1.5
      expect(h).toBeGreaterThan(-3.0); // basin + stream carve
    }
  });

  it('flattens and lowers the village basin at the centre', () => {
    const heights: number[] = [];
    for (let k = 0; k < 12; k++) {
      const az = (k / 12) * Math.PI * 2;
      // a ring at a small angular radius around the centre
      const t = new THREE.Vector3(1, 0, 0);
      const b = new THREE.Vector3().crossVectors(CENTER, t).normalize();
      const dir = CENTER.clone().multiplyScalar(Math.cos(0.06))
        .addScaledVector(t.clone().multiplyScalar(Math.cos(az)).addScaledVector(b, Math.sin(az)), Math.sin(0.06))
        .normalize();
      heights.push(terrain.heightAt(dir));
    }
    const max = Math.max(...heights), min = Math.min(...heights);
    expect(max - min).toBeLessThan(0.25);       // flat
    expect(terrain.heightAt(CENTER)).toBeLessThan(-0.5); // a dip
  });
});

describe('Terrain.normalAt', () => {
  it('returns an outward unit normal', () => {
    const terrain = new Terrain(CENTER);
    for (let i = 0; i < 50; i++) {
      const d = randDir(i + 100);
      const n = terrain.normalAt(d, RADIUS);
      expect(n.length()).toBeCloseTo(1, 5);
      expect(n.dot(d)).toBeGreaterThan(0); // points away from the core
    }
  });

  it('is exactly radial on perfectly flat terrain', () => {
    const flat = new Terrain(CENTER, { hillAmplitude: 0, basinDepth: 0, streamDepth: 0 });
    const d = randDir(3);
    const n = flat.normalAt(d, RADIUS);
    expect(n.dot(d)).toBeCloseTo(1, 4);
  });
});

describe('Terrain.colorAt', () => {
  it('gives the riverbank a different colour from the highland', () => {
    const terrain = new Terrain(CENTER);
    const water = terrain.colorAt(terrain.streamPath[Math.floor(terrain.streamPath.length / 2)], RADIUS);
    const land = terrain.colorAt(randDir(999), RADIUS);
    expect(water.getHexString()).not.toBe(land.getHexString());
  });

  it('returns a defined colour everywhere', () => {
    const terrain = new Terrain(CENTER);
    for (let i = 0; i < 50; i++) {
      const c = terrain.colorAt(randDir(i + 5), RADIUS);
      expect(c).toBeInstanceOf(THREE.Color);
    }
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npm run test`
Expected: FAIL — `Cannot find module './Terrain'` (file not created yet).

- [ ] **Step 5: Implement `Terrain.ts`**

Create `src/core/Terrain.ts`:

```ts
import * as THREE from 'three';

export type Region = 'meadow' | 'hillside' | 'highland' | 'rock' | 'waterside';

export interface TerrainConfig {
  hillAmplitude?: number;
  hillFrequency?: number;
  basinRadius?: number;
  basinDepth?: number;
  streamWidth?: number;
  streamDepth?: number;
  seed?: number;
}

// Muted Ghibli ground tones — kept local so `core` never depends on `world`.
const GROUND = {
  meadow: new THREE.Color('#7c9a4e'),
  hillA: new THREE.Color('#6f8f4a'),
  hillB: new THREE.Color('#577636'),
  autumn: new THREE.Color('#b0853a'),
  highland: new THREE.Color('#a7ad5c'),
  rock: new THREE.Color('#9c958a'),
  sand: new THREE.Color('#c9b78f'),
};

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
// smoothstep in [edge0, edge1]
function sstep(edge0: number, edge1: number, x: number): number {
  return smooth(clamp01((x - edge0) / (edge1 - edge0)));
}

// Deterministic 0..1 hash of an integer lattice cell (no Math.random — pure).
function hash3(ix: number, iy: number, iz: number, seed: number): number {
  let h = (ix | 0) * 374761393 + (iy | 0) * 668265263 + (iz | 0) * 2147483647 + (seed | 0) * 982451653;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

// Trilinear value noise in [-1, 1].
function valueNoise(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const u = smooth(fx), v = smooth(fy), w = smooth(fz);
  const c = (dx: number, dy: number, dz: number) => hash3(ix + dx, iy + dy, iz + dz, seed);
  const x00 = lerp(c(0, 0, 0), c(1, 0, 0), u);
  const x10 = lerp(c(0, 1, 0), c(1, 1, 0), u);
  const x01 = lerp(c(0, 0, 1), c(1, 0, 1), u);
  const x11 = lerp(c(0, 1, 1), c(1, 1, 1), u);
  const y0 = lerp(x00, x10, v);
  const y1 = lerp(x01, x11, v);
  return lerp(y0, y1, w) * 2 - 1;
}

export class Terrain {
  readonly center: THREE.Vector3;
  readonly streamPath: THREE.Vector3[] = [];

  private readonly hillAmplitude: number;
  private readonly hillFrequency: number;
  private readonly basinRadius: number;
  private readonly basinDepth: number;
  private readonly streamWidth: number;
  private readonly streamDepth: number;
  private readonly seed: number;

  // scratch (reused; single-threaded build/runtime use)
  private _d = new THREE.Vector3();
  private _t1 = new THREE.Vector3();
  private _t2 = new THREE.Vector3();
  private _pa = new THREE.Vector3();
  private _pb = new THREE.Vector3();
  private _p0 = new THREE.Vector3();
  private _n = new THREE.Vector3();

  constructor(center: THREE.Vector3, config: TerrainConfig = {}) {
    this.center = center.clone().normalize();
    this.hillAmplitude = config.hillAmplitude ?? 1.5;
    this.hillFrequency = config.hillFrequency ?? 1.7;
    this.basinRadius = config.basinRadius ?? 0.34;
    this.basinDepth = config.basinDepth ?? 1.0;
    this.streamWidth = config.streamWidth ?? 0.045;
    this.streamDepth = config.streamDepth ?? 0.7;
    this.seed = config.seed ?? 1337;
    this.buildStreamPath();
  }

  /** A meandering river that runs through the valley, offset ~0.45 rad from the village centre. */
  private buildStreamPath(): void {
    const t = this.arbitraryTangent(this.center, new THREE.Vector3());
    const b = this.center.clone().cross(t).normalize();
    const N = 80;
    for (let k = 0; k <= N; k++) {
      const along = (k / N - 0.5) * 2.2;          // sweep along the valley
      const perp = 0.45 + Math.sin(along * 3) * 0.08; // offset + gentle meander
      const len = Math.hypot(along, perp);
      // exponential map of the tangent vector (t*along + b*perp) at `center` onto the sphere
      const dir = this.center.clone().multiplyScalar(Math.cos(len));
      if (len > 1e-6) {
        dir.addScaledVector(t, (along / len) * Math.sin(len));
        dir.addScaledVector(b, (perp / len) * Math.sin(len));
      }
      this.streamPath.push(dir.normalize());
    }
  }

  private arbitraryTangent(dir: THREE.Vector3, target: THREE.Vector3): THREE.Vector3 {
    const up = this._d.copy(dir).normalize();
    const seed = Math.abs(up.y) < 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    return target.copy(seed).cross(up).normalize();
  }

  /** Smallest angular distance (radians) from `dir` to the river. */
  private distanceToStream(dir: THREE.Vector3): number {
    let min = Infinity;
    for (const p of this.streamPath) {
      const a = Math.acos(THREE.MathUtils.clamp(dir.dot(p), -1, 1));
      if (a < min) min = a;
    }
    return min;
  }

  /** Elevation above the base radius, as a pure function of surface direction. */
  heightAt(dir: THREE.Vector3): number {
    const d = this._d.copy(dir).normalize();

    // 1. rolling hills — 4 octaves of value noise on the direction vector
    let h = 0, amp = 1, freq = this.hillFrequency, norm = 0;
    for (let o = 0; o < 4; o++) {
      h += amp * valueNoise(d.x * freq, d.y * freq, d.z * freq, this.seed + o);
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    h = (h / norm) * this.hillAmplitude;

    // 2. village basin — flatten + lower the ground near the centre
    const ang = Math.acos(THREE.MathUtils.clamp(d.dot(this.center), -1, 1));
    const basin = 1 - sstep(this.basinRadius * 0.45, this.basinRadius, ang);
    h = lerp(h, -this.basinDepth, basin);

    // 3. stream channel — carve a narrow bed
    const carve = 1 - sstep(0, this.streamWidth, this.distanceToStream(d));
    h -= carve * this.streamDepth;

    return h;
  }

  /** Outward surface normal via finite differences of the displaced surface position. */
  normalAt(dir: THREE.Vector3, radius: number, target = new THREE.Vector3()): THREE.Vector3 {
    const d = this._d.copy(dir).normalize();
    const e = 0.0015;
    this.arbitraryTangent(d, this._t1);
    this._t2.copy(d).cross(this._t1).normalize();

    this.surfacePos(d, radius, this._p0);
    this.surfacePos(this._pa.copy(d).addScaledVector(this._t1, e).normalize(), radius, this._pa);
    this.surfacePos(this._pb.copy(d).addScaledVector(this._t2, e).normalize(), radius, this._pb);

    this._pa.sub(this._p0);
    this._pb.sub(this._p0);
    target.copy(this._pa).cross(this._pb).normalize();
    if (target.dot(d) < 0) target.negate();
    return target;
  }

  private surfacePos(dir: THREE.Vector3, radius: number, target: THREE.Vector3): THREE.Vector3 {
    return target.copy(dir).multiplyScalar(radius + this.heightAt(dir));
  }

  regionAt(dir: THREE.Vector3, radius: number): Region {
    const d = dir.clone().normalize();
    if (this.distanceToStream(d) < this.streamWidth * 1.8) return 'waterside';
    const n = this.normalAt(d, radius, this._n);
    const slope = 1 - Math.max(0, n.dot(d));
    if (slope > 0.16) return 'rock';
    const h = this.heightAt(d);
    const hn = clamp01((h + this.basinDepth) / (this.hillAmplitude + this.basinDepth));
    if (hn < 0.34) return 'meadow';
    if (hn < 0.72) return 'hillside';
    return 'highland';
  }

  colorAt(dir: THREE.Vector3, radius: number, target = new THREE.Color()): THREE.Color {
    const d = dir.clone().normalize();
    switch (this.regionAt(d, radius)) {
      case 'waterside': return target.copy(GROUND.sand);
      case 'rock': return target.copy(GROUND.rock);
      case 'meadow': return target.copy(GROUND.meadow);
      case 'highland': return target.copy(GROUND.highland);
      case 'hillside': {
        // blend two greens, with occasional warm autumn pockets from a low-freq noise
        const a = (valueNoise(d.x * 0.8, d.y * 0.8, d.z * 0.8, this.seed + 50) + 1) * 0.5;
        if (a > 0.62) return target.copy(GROUND.hillA).lerp(GROUND.autumn, sstep(0.62, 1, a) * 0.8);
        return target.copy(GROUND.hillA).lerp(GROUND.hillB, a);
      }
    }
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test`
Expected: PASS (all Terrain suites green).

- [ ] **Step 7: Verify the build still typechecks**

Run: `npm run build`
Expected: typecheck + Vite build succeed (test files typecheck because `vitest` types are installed).

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json vitest.config.ts src/core/Terrain.ts src/core/Terrain.test.ts
git commit -m "feat(terrain): analytic height field (hills + village basin + stream)"
```

---

## Task 2: Integrate the height field into Planet (7a)

Make `Planet` own a `Terrain` and route every surface query through it, so the player, camera, collision and props follow the terrain. Also make `VillageLayout.surfaceMatrix` terrain-aware so instanced props don't float.

**Files:**
- Modify: `src/core/Planet.ts`
- Modify: `src/world/VillageLayout.ts` (`surfaceMatrix` only)
- Modify: `src/main.ts` (pass village centre to `Planet`)

**Interfaces:**
- Consumes: `Terrain` from Task 1.
- Produces (on `Planet`):
  - `readonly terrain: Terrain`
  - `constructor(radius?: number, center?: THREE.Vector3)`
  - `surfacePoint(dir, height?, target?)` — now `dir * (radius + terrain.heightAt(dir) + height)`
  - `localUp(point, target?)` — now `terrain.normalAt(normalize(point), radius)`
  - `radialUp(point, target?): THREE.Vector3` — pure `normalize(point)` (level-horizon fallback)
  - `placeOnSurface(object, direction, height?, yaw?, up?: 'radial' | 'normal')` — `up` defaults `'radial'`

- [ ] **Step 1: Rewrite `Planet` constructor + surface methods**

In `src/core/Planet.ts`, add the import and replace the constructor and the `localUp`/`surfacePoint`/`placeOnSurface` methods:

```ts
import { Terrain } from './Terrain';
```

Constructor (note higher displacement-aware normals; outline is added AFTER displacement):

```ts
readonly terrain: Terrain;

constructor(radius = 40, center = new THREE.Vector3(0, 1, 0).normalize()) {
  this.radius = radius;
  this.terrain = new Terrain(center);
  this.group = new THREE.Group();
  this.group.name = 'Planet';

  const geometry = new THREE.IcosahedronGeometry(radius, 24);
  this.displace(geometry); // push vertices to terrain height + set analytic normals

  const material = createToonMaterial({
    color: '#8aa05a',
    bands: 3,
    shadowStrength: 0.6,
    rimStrength: 0.15,
  });
  this.mesh = new THREE.Mesh(geometry, material);
  this.mesh.name = 'PlanetSurface';
  this.group.add(this.mesh);

  addOutline(this.mesh, { thickness: 0.12, color: '#3a4226' });
}

/** Displace each vertex to the terrain surface and assign smooth analytic normals. */
private displace(geometry: THREE.BufferGeometry): void {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const nrm = geometry.getAttribute('normal') as THREE.BufferAttribute;
  const dir = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    dir.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
    const h = this.terrain.heightAt(dir);
    pos.setXYZ(i, dir.x * (this.radius + h), dir.y * (this.radius + h), dir.z * (this.radius + h));
    this.terrain.normalAt(dir, this.radius, n);
    nrm.setXYZ(i, n.x, n.y, n.z);
  }
  pos.needsUpdate = true;
  nrm.needsUpdate = true;
}
```

Surface queries:

```ts
/** Local "up": the true terrain surface normal at the given world-space point. */
localUp(point: THREE.Vector3, target = new THREE.Vector3()): THREE.Vector3 {
  return this.terrain.normalAt(this._p1.copy(point).normalize(), this.radius, target);
}

/** Pure radial up (level horizon) — fallback for anything that must ignore slope. */
radialUp(point: THREE.Vector3, target = new THREE.Vector3()): THREE.Vector3 {
  return target.copy(point).normalize();
}

surfacePoint(direction: THREE.Vector3, height = 0, target = new THREE.Vector3()): THREE.Vector3 {
  const d = this._p1.copy(direction).normalize();
  return target.copy(d).multiplyScalar(this.radius + this.terrain.heightAt(d) + height);
}
```

`placeOnSurface` — add the `up` mode (buildings stay radial so they stand straight):

```ts
placeOnSurface(
  object: THREE.Object3D,
  direction: THREE.Vector3,
  height = 0,
  yaw = 0,
  up: 'radial' | 'normal' = 'radial',
): void {
  const dir = this._p1.copy(direction).normalize();
  this.surfacePoint(dir, height, object.position);

  const upVec = up === 'normal' ? this.terrain.normalAt(dir, this.radius, this._p2) : this._p2.copy(dir);
  const facing = this.arbitraryTangent(upVec, this._p3).applyAxisAngle(upVec, yaw);
  const xAxis = new THREE.Vector3().copy(upVec).cross(facing).normalize();
  this._basis.makeBasis(xAxis, upVec, facing);
  object.quaternion.setFromRotationMatrix(this._basis);
}
```

> Note: `arbitraryTangent`, `tangentToward`, and the `_p1/_p2/_p3/_basis` scratch fields already exist in `Planet.ts` and are unchanged.

- [ ] **Step 2: Make instanced placement terrain-aware in `VillageLayout`**

In `src/world/VillageLayout.ts`, replace `surfaceMatrix` so instanced fields sit ON the hills (add an optional terrain-normal up mode for later tasks):

```ts
private surfaceMatrix(
  dir: THREE.Vector3,
  height: number,
  yaw: number,
  scale: number,
  up: 'radial' | 'normal' = 'radial',
): THREE.Matrix4 {
  const d = this._tan.copy(dir).normalize();
  const h = this.planet.terrain.heightAt(d);
  this._pos.copy(d).multiplyScalar(this.planet.radius + h + height);
  const upVec = up === 'normal'
    ? this.planet.terrain.normalAt(d, this.planet.radius, new THREE.Vector3())
    : d;
  this._q.setFromUnitVectors(UP, upVec);
  this._spin.setFromAxisAngle(upVec, yaw);
  this._q.premultiply(this._spin);
  this._scale.setScalar(scale);
  return this._m.compose(this._pos, this._q, this._scale);
}
```

- [ ] **Step 3: Pass the village centre to `Planet` in `main.ts`**

In `src/main.ts`, change the planet construction so its terrain basin is centred on the village:

```ts
const planet = new Planet(PLANET_RADIUS, VILLAGE_CENTER);
```

(`VILLAGE_CENTER` is already declared above this line.)

- [ ] **Step 4: Typecheck + build**

Run: `npm run build`
Expected: PASS (no type errors).

- [ ] **Step 5: Manual verification — walking & camera on hills**

Run: `npm run dev` and open http://localhost:5173.
Verify ALL of:
- The planet visibly has gentle rolling hills (silhouette is no longer a perfect circle).
- The village sits in a flattened dip; its buildings stand straight and do not float or sink.
- Walking with **W A S D** over hills: the character hugs the ground (no floating/clipping) and tilts gently with slopes.
- Circling the whole globe never flips the horizon and the camera doesn't punch through hills. If the camera grazes crests, nudge `cameraRig.height` from `5.5` → `6.5` in `main.ts` and re-verify.
- Instanced props (cobbles, fences, bushes, trees) sit on the terrain, not at a single flat radius.

- [ ] **Step 6: Commit**

```bash
git add src/core/Planet.ts src/world/VillageLayout.ts src/main.ts
git commit -m "feat(terrain): displace the planet and route player/camera/placement through the height field"
```

---

## Task 3: Per-vertex color support in ToonMaterial (7b)

A small, isolated shader change so the planet mesh can be tinted per vertex. Opt-in via a new option; all existing materials are unaffected (vColor defaults to white).

**Files:**
- Modify: `src/render/ToonMaterial.ts`

**Interfaces:**
- Produces: `ToonMaterialOptions.vertexColors?: boolean`. When `true`, the material reads a `color` vec3 geometry attribute and multiplies it into the base color.

- [ ] **Step 1: Add the option + shader plumbing**

In `src/render/ToonMaterial.ts`:

Add to `ToonMaterialOptions`:

```ts
  /** Multiply the base colour by a per-vertex `color` attribute (used by the terrain mesh). */
  vertexColors?: boolean;
```

In `vertexShader`, declare the varying and (guarded) attribute, and set it. Add near the other `varying` declarations:

```glsl
  varying vec3 vColor;
  #ifdef USE_TERRAIN_COLOR
    attribute vec3 color;
  #endif
```

At the very start of `main()` in the vertex shader:

```glsl
    vColor = vec3(1.0);
    #ifdef USE_TERRAIN_COLOR
      vColor = color;
    #endif
```

In `fragmentShader`, add the varying with the others:

```glsl
  varying vec3 vColor;
```

…and fold it into the base color at the top of `main()` (replace the use of `uBaseColor` for the diffuse base):

```glsl
    vec3 baseColor = uBaseColor * vColor;
```

Then replace the two `uBaseColor` references in the diffuse block with `baseColor`:

```glsl
    vec3 shadowColor = baseColor * uShadowTint * uShadowStrength;
    vec3 diffuse = mix(shadowColor, baseColor, lit * shadow);
```

- [ ] **Step 2: Set the define when the option is on**

In `createToonMaterial`, after constructing `material`, add:

```ts
  if (options.vertexColors) {
    material.defines = { ...(material.defines ?? {}), USE_TERRAIN_COLOR: '' };
  }
```

- [ ] **Step 3: Typecheck + build**

Run: `npm run build`
Expected: PASS. (No visual change yet — nothing sets `vertexColors: true`.)

- [ ] **Step 4: Commit**

```bash
git add src/render/ToonMaterial.ts
git commit -m "feat(render): optional per-vertex colour support in the toon material"
```

---

## Task 4: Color the terrain by region (7b)

**Files:**
- Modify: `src/core/Planet.ts` (write a `color` attribute + enable `vertexColors`)

**Interfaces:**
- Consumes: `Terrain.colorAt` (Task 1), `ToonMaterialOptions.vertexColors` (Task 3).

- [ ] **Step 1: Write per-vertex colors during displacement**

In `src/core/Planet.ts`, extend `displace()` to also build a `color` attribute, and enable `vertexColors` on the material.

Update `displace` to add colors:

```ts
private displace(geometry: THREE.BufferGeometry): void {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const nrm = geometry.getAttribute('normal') as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const dir = new THREE.Vector3();
  const n = new THREE.Vector3();
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    dir.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
    const h = this.terrain.heightAt(dir);
    pos.setXYZ(i, dir.x * (this.radius + h), dir.y * (this.radius + h), dir.z * (this.radius + h));
    this.terrain.normalAt(dir, this.radius, n);
    nrm.setXYZ(i, n.x, n.y, n.z);
    this.terrain.colorAt(dir, this.radius, c);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  pos.needsUpdate = true;
  nrm.needsUpdate = true;
}
```

Update the material in the constructor to enable vertex colors (and set the base color to white so the per-vertex color is shown directly):

```ts
  const material = createToonMaterial({
    color: '#ffffff',     // white base; per-vertex terrain colour provides the hue
    bands: 3,
    shadowStrength: 0.6,
    rimStrength: 0.15,
    vertexColors: true,
  });
```

- [ ] **Step 2: Typecheck + build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Manual verification — regions read distinctly**

Run: `npm run dev`, open http://localhost:5173, circle the globe. Verify:
- The ground is no longer a single flat green: valley/meadow, hillside greens (with occasional warm autumn patches), pale highland tops, grey rock on the steeper faces, and a sandy tone tracing the riverbed line are all visible.
- Colors stay muted/Ghibli (no neon). If a region dominates, adjust thresholds in `Terrain.regionAt` (`slope > 0.16`, the `hn` cuts) and re-verify.

- [ ] **Step 4: Commit**

```bash
git add src/core/Planet.ts
git commit -m "feat(terrain): colour the planet by region (meadow/hillside/highland/rock/waterside)"
```

---

## Task 5: Boulder prop (7c)

A small procedural rock for highland and slope dressing, plus its instanced geometry/material so it can be scattered cheaply.

**Files:**
- Modify: `src/world/props/index.ts`

**Interfaces:**
- Produces:
  - `createBoulder(): THREE.Group`
  - `boulderGeometry(): THREE.BufferGeometry`
  - `boulderMaterial(): THREE.ShaderMaterial`

- [ ] **Step 1: Add the boulder prop + instanced variants**

In `src/world/props/index.ts`, add (near the other props/`cobblestoneGeometry`):

```ts
/** A single low-poly boulder (hero prop). */
export function createBoulder(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'Boulder';
  const r = randRange(0.5, 1.1);
  const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), mat(palette.stone, { shadowStrength: 0.6, rimStrength: 0.12 }));
  rock.scale.set(randRange(0.9, 1.3), randRange(0.6, 0.9), randRange(0.9, 1.3));
  rock.position.y = r * 0.45;
  g.add(rock);
  outlineHierarchy(g, { thickness: 0.03, color: palette.ink });
  return g;
}

/** Geometry + material for instanced scattered boulders. */
export function boulderGeometry(): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(0.7, 0);
  geo.scale(1.1, 0.7, 1.1);
  return geo;
}
export function boulderMaterial(): THREE.ShaderMaterial {
  return mat(palette.stone, { shadowStrength: 0.6, rimStrength: 0.12 });
}
```

- [ ] **Step 2: Typecheck + build**

Run: `npm run build`
Expected: PASS. (Not placed yet — wired up in Task 6.)

- [ ] **Step 3: Commit**

```bash
git add src/world/props/index.ts
git commit -m "feat(props): procedural boulder (hero + instanced)"
```

---

## Task 6: Region-driven composition (7c)

Replace uniform scatter with intentional, terrain-aware placement: forests cluster on hillsides, boulders/haystacks dot the highland, vegetation lines the river. Natural props orient to the terrain normal.

**Files:**
- Modify: `src/world/VillageLayout.ts`

**Interfaces:**
- Consumes: `planet.terrain` (`regionAt`, `streamPath`, `heightAt`), `boulderGeometry`/`boulderMaterial` (Task 5), the `up: 'normal'` mode of `surfaceMatrix` (Task 2).

- [ ] **Step 1: Import the boulder geometry/material**

Add `boulderGeometry, boulderMaterial` to the existing import from `./props` in `src/world/VillageLayout.ts`.

- [ ] **Step 2: Replace `buildScatter` with region-aware clustering**

In `src/world/VillageLayout.ts`, replace the whole `buildScatter` method with the version below and add the three helper methods after it. Trees/boulders use `up: 'normal'` so they sit naturally on slopes.

```ts
private buildScatter(): void {
  const leafy: Scatter[] = [...this.extraLeafy];
  const cypress: Scatter[] = [];
  const bushes: Scatter[] = [...this.extraBushes];
  const boulders: Scatter[] = [];

  this.buildForests(leafy, cypress);
  this.buildHighland(boulders, bushes);
  this.buildRiverside(leafy, bushes);

  // Light ambient bushes everywhere except the village core (keeps the globe lived-in).
  for (let i = 0; i < 360; i++) {
    const dir = this.randomDirection();
    const distToCenter = Math.acos(THREE.MathUtils.clamp(dir.dot(this.center), -1, 1));
    if (distToCenter < 0.24) continue;
    bushes.push({ dir, yaw: rand() * Math.PI * 2, scale: randRange(0.6, 1.3) });
  }

  this.buildTreeField(leafy, leafyTrunkGeometry(), leafyFoliageGeometry(), palette.leafA, '#23301c');
  this.buildTreeField(cypress, cypressTrunkGeometry(), cypressFoliageGeometry(), palette.leafCypress, '#1f2c1c');

  const bushField = new InstancedField(bushGeometry(), bushMaterial(), bushes.length, 0.025, '#2c3a22');
  bushes.forEach((b, i) => bushField.set(i, this.surfaceMatrix(b.dir, 0, b.yaw, b.scale, 'normal')));
  bushField.finalize(bushes.length);
  bushField.addTo(this.group);

  const boulderField = new InstancedField(boulderGeometry(), boulderMaterial(), boulders.length, 0.03, palette.ink);
  boulders.forEach((b, i) => boulderField.set(i, this.surfaceMatrix(b.dir, -0.1, b.yaw, b.scale, 'normal')));
  boulderField.finalize(boulders.length);
  boulderField.addTo(this.group);
}

/** Woods that cluster on hillside regions, with clearings between clusters. */
private buildForests(leafy: Scatter[], cypress: Scatter[]): void {
  let clusters = 0, attempts = 0;
  while (clusters < 7 && attempts < 400) {
    attempts++;
    const c = this.randomFarDir(0.5);
    if (this.planet.terrain.regionAt(c, this.planet.radius) !== 'hillside') continue;
    clusters++;
    const n = 14 + Math.floor(rand() * 22);
    for (let i = 0; i < n; i++) {
      const dir = this.offsetDir(c, randRange(0, 0.07), rand() * Math.PI * 2);
      this.planet.surfacePoint(dir, 0, this._wp);
      if (!this.isFree(this._wp, 1.1, 0)) continue;
      const entry = { dir, yaw: rand() * Math.PI * 2, scale: randRange(0.8, 1.3) };
      if (rand() > 0.82) cypress.push(entry);
      else leafy.push(entry);
    }
  }
}

/** Highland tops: scattered boulders, sparse haystacks, the odd lone tree. */
private buildHighland(boulders: Scatter[], bushes: Scatter[]): void {
  let placed = 0, attempts = 0;
  while (placed < 5 && attempts < 400) {
    attempts++;
    const c = this.randomFarDir(0.5);
    if (this.planet.terrain.regionAt(c, this.planet.radius) !== 'highland') continue;
    placed++;
    const n = 4 + Math.floor(rand() * 5);
    for (let i = 0; i < n; i++) {
      boulders.push({ dir: this.offsetDir(c, randRange(0, 0.08), rand() * Math.PI * 2), yaw: rand() * Math.PI * 2, scale: randRange(0.7, 1.4) });
    }
    if (rand() > 0.4) this.place(createHaystack(), this.offsetDir(c, randRange(0, 0.05), rand() * Math.PI * 2), rand() * Math.PI * 2, randRange(0.9, 1.2));
    for (let i = 0; i < 3; i++) {
      bushes.push({ dir: this.offsetDir(c, randRange(0, 0.06), rand() * Math.PI * 2), yaw: rand() * Math.PI * 2, scale: randRange(0.5, 0.9) });
    }
  }
}

/** Reeds, bushes and willows tracing the river. */
private buildRiverside(leafy: Scatter[], bushes: Scatter[]): void {
  const path = this.planet.terrain.streamPath;
  for (let i = 4; i < path.length - 4; i += 2) {
    const base = path[i];
    if (Math.acos(THREE.MathUtils.clamp(base.dot(this.center), -1, 1)) < 0.2) continue; // not in the square
    for (let s = 0; s < 2; s++) {
      bushes.push({ dir: this.offsetDir(base, randRange(0.02, 0.05), rand() * Math.PI * 2), yaw: rand() * Math.PI * 2, scale: randRange(0.5, 0.9) });
    }
    if (rand() > 0.8) {
      leafy.push({ dir: this.offsetDir(base, randRange(0.03, 0.06), rand() * Math.PI * 2), yaw: rand() * Math.PI * 2, scale: randRange(1.0, 1.4) });
    }
  }
}
```

> The old `buildScatter` also placed wild trees with a `distToCenter < 0.42` guard; that intent is preserved by `randomFarDir(0.5)` cluster centres and the per-cluster `isFree` check. The orchard/pond extras (`extraLeafy`/`extraBushes`) are still seeded in `buildCountryside` and merged in at the top of `buildScatter`.

- [ ] **Step 3: Typecheck + build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Manual verification — composition reads as intentional**

Run: `npm run dev`, open http://localhost:5173. Verify:
- Trees form real woods (clusters with clearings) on the hillsides rather than an even spray.
- Highland tops carry boulders + sparse haystacks; the village core stays clear.
- Bushes/willows line the river route.
- Nothing intersects buildings (the `isFree` checks still hold); props sit naturally on slopes (terrain-normal orientation).

- [ ] **Step 5: Commit**

```bash
git add src/world/VillageLayout.ts
git commit -m "feat(world): region-driven composition (forest clusters, highland, riverside)"
```

---

## Task 7: Water, footbridge & final tuning (7d)

Add the river water surface following the carved channel, the pond hollow, a footbridge landmark where a lane meets the river, and final fog/sun tuning.

**Files:**
- Modify: `src/world/props/index.ts` (footbridge + water material)
- Modify: `src/world/VillageLayout.ts` (stream ribbon mesh + footbridge placement)
- Modify: `src/main.ts` (fog/sun tuning)

**Interfaces:**
- Produces:
  - `createFootbridge(): THREE.Group`
  - `waterMaterial(): THREE.ShaderMaterial`
- Consumes: `planet.terrain.streamPath`, `planet.terrain.heightAt`, `planet.radius`.

- [ ] **Step 1: Add footbridge prop + water material**

In `src/world/props/index.ts`:

```ts
/** A small timber footbridge to span the stream. Spans along local +Z. */
export function createFootbridge(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'Footbridge';
  const deck = box(1.6, 0.16, 3.4, palette.wood, { shadowStrength: 0.6 });
  deck.position.y = 0.5;
  g.add(deck);
  for (const sx of [-0.7, 0.7]) {
    const rail = box(0.1, 0.5, 3.4, palette.timberDark);
    rail.position.set(sx, 0.8, 0);
    g.add(rail);
    for (const sz of [-1.5, 0, 1.5]) {
      const post = box(0.14, 0.7, 0.14, palette.timber);
      post.position.set(sx, 0.55, sz);
      g.add(post);
    }
  }
  g.userData.footprint = 1.2;
  outlineHierarchy(g, { thickness: 0.035, color: palette.ink });
  return g;
}

/** Toon water surface material (gentle, slightly translucent). */
export function waterMaterial(): THREE.ShaderMaterial {
  const m = mat('#6f9fb0', { shadowStrength: 0.9, rimStrength: 0.5 });
  m.transparent = true;
  m.opacity = 0.85;
  return m;
}
```

- [ ] **Step 2: Build the river ribbon + footbridge in `VillageLayout`**

Add `createFootbridge, waterMaterial` to the `./props` import. Add a `buildWater()` call in `build()` (after `buildScatter()`), and the method:

```ts
private build(): void {
  this.buildSquare();
  this.buildCoreHouses();
  this.buildCountryside();
  this.buildCobblestones();
  this.buildFences();
  this.buildGates();
  this.buildScatter();
  this.buildWater();
}

/** A water ribbon following the carved stream bed, plus a footbridge where a lane crosses. */
private buildWater(): void {
  const path = this.planet.terrain.streamPath;
  const halfWidth = 0.035; // angular half-width of the water surface
  const lift = 0.18;       // sit just above the carved bed
  const positions: number[] = [];
  const R = this.planet.radius;

  const left = new THREE.Vector3();
  const right = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const prevL = new THREE.Vector3();
  const prevR = new THREE.Vector3();

  const edge = (dir: THREE.Vector3, side: number, out: THREE.Vector3, perp: THREE.Vector3): void => {
    out.copy(dir).addScaledVector(perp, side * halfWidth).normalize();
    const h = this.planet.terrain.heightAt(out) + lift;
    out.multiplyScalar(R + h);
  };

  for (let i = 0; i < path.length; i++) {
    const dir = path[i];
    const next = path[Math.min(i + 1, path.length - 1)];
    tangent.copy(next).sub(dir);
    const perp = new THREE.Vector3().crossVectors(dir, tangent).normalize();
    edge(dir, -1, left, perp);
    edge(dir, 1, right, perp);
    if (i > 0) {
      // two triangles (prevL, prevR, right) and (prevL, right, left)
      positions.push(prevL.x, prevL.y, prevL.z, prevR.x, prevR.y, prevR.z, right.x, right.y, right.z);
      positions.push(prevL.x, prevL.y, prevL.z, right.x, right.y, right.z, left.x, left.y, left.z);
    }
    prevL.copy(left);
    prevR.copy(right);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  const water = new THREE.Mesh(geo, waterMaterial());
  water.name = 'StreamWater';
  this.group.add(water);

  // Footbridge where the river passes nearest a chosen lane azimuth (mid-path, outside the square).
  const mid = path[Math.floor(path.length * 0.32)];
  const bridge = createFootbridge();
  // orient the bridge's +Z across the stream (along the local perpendicular)
  const next = path[Math.floor(path.length * 0.32) + 1];
  const tan = new THREE.Vector3().subVectors(next, mid);
  const perp = new THREE.Vector3().crossVectors(mid, tan).normalize();
  const refTan = this.planet.arbitraryTangent(mid, new THREE.Vector3());
  const refBi = mid.clone().normalize().cross(refTan).normalize();
  const yaw = Math.atan2(perp.dot(refBi), perp.dot(refTan));
  this.place(bridge, mid, yaw, 1, 0.2);
  this.addColliders(bridge);
}
```

> `this.place`, `this.addColliders`, `this.planet.arbitraryTangent` already exist. The bridge is placed with a small positive height so its deck clears the water.

- [ ] **Step 3: Final fog & sun tuning in `main.ts`**

In `src/main.ts`, warm the sun slightly toward golden hour and tighten fog so the hills gain depth. Update the `atmosphere` object initial values:

```ts
const atmosphere = {
  sunAzimuth: 0.7,
  sunElevation: 0.72,           // lower sun → longer, warmer shadows across the hills
  lightColor: new THREE.Color('#ffe9c2'),
  ambient: new THREE.Color('#5d6f8c'),
  fogColor: new THREE.Color('#cfe0ec'),
  fogNear: 95,
  fogFar: 280,
};
```

- [ ] **Step 4: Typecheck + build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 5: Manual verification — water, bridge, cohesion**

Run: `npm run dev`, open http://localhost:5173. Verify:
- A river of toon water follows a meander through the valley, sitting in its carved bed (not floating above or sunk below the banks).
- The footbridge spans the stream and you can walk up to it; it casts/receives shadow like other props.
- The overall scene reads as a cohesive, beautiful little Bulgarian countryside — golden-hour warmth, hills with depth from fog.
- Adjust `halfWidth`/`lift` in `buildWater` if the water clips the banks or floats; adjust `fogFar` if the far hemisphere reads too foggy/clear.

- [ ] **Step 6: Run the full test suite + build once more**

Run: `npm run test && npm run build`
Expected: tests PASS, build PASS.

- [ ] **Step 7: Commit**

```bash
git add src/world/props/index.ts src/world/VillageLayout.ts src/main.ts
git commit -m "feat(world): river water, footbridge landmark, golden-hour tuning"
```

---

## Self-Review

**Spec coverage:**
- §1 Terrain engine (`heightAt`/`normalAt`, hills + basin + stream, deterministic, no deps) → Task 1. ✓
- §2 Planet integration (displacement, terrain-aware surface methods, `placeOnSurface` up mode) → Task 2. ✓
- §3 Player + camera adaptation → Task 2 (they already query `planet.localUp`/`surfacePoint`, so terrain-following is automatic; camera height nudge called out in 2.5). ✓
- §4 Terrain coloring & regions (vertex colors; meadow/hillside/highland/rock/waterside) → Tasks 3 + 4. ✓
- §5 Composition (forest clusters, highland boulders, riverside, density, instancing) → Tasks 5 + 6. ✓
- §6 Water (stream + pond + footbridge) → Task 7. (Pond: existing `createPond` already dropped in via `buildCountryside`; the carved hollow under it now follows from terrain — noted.) ✓
- §7 Sky/fog/sun light touch → Task 7 step 3. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code; commands have expected output. ✓

**Type consistency:** `Terrain` method signatures (`heightAt(dir)`, `normalAt(dir, radius, target?)`, `regionAt(dir, radius)`, `colorAt(dir, radius, target?)`, `streamPath`) are used identically in Planet (Tasks 2/4) and VillageLayout (Tasks 6/7). `surfaceMatrix(dir, height, yaw, scale, up?)` and `placeOnSurface(..., up?)` signatures match all call sites. `vertexColors` option (Task 3) consumed in Task 4. ✓

> One thing to watch during execution (not a blocker): `Terrain.heightAt` runs for every icosphere vertex at build (detail 24 ≈ 15k verts) and `normalAt`/`colorAt` each call `heightAt` several times, with the stream distance looping 81 path points. That is a one-time build cost of a few million cheap ops — fine. If startup ever feels slow, cache `distanceToStream` or reduce `streamPath` density; do not prematurely optimize.
