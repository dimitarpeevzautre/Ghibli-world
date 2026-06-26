import * as THREE from 'three';
import { Planet } from '../core/Planet';
import { ModelLibrary } from './ModelLibrary';
import { makeOutlineMaterial } from '../render/OutlinePass';
import {
  createHouse,
  createChapel,
  createCheshma,
  createGate,
  createBarn,
  createWaysideCross,
  createPond,
  createTerrace,
  createPot,
  createHaystack,
  createWoodpile,
  cobblestoneGeometry,
  cobblestoneMaterial,
  fencePostGeometry,
  fenceMaterial,
  bushGeometry,
  bushMaterial,
  leafyTrunkGeometry,
  leafyFoliageGeometry,
  cypressTrunkGeometry,
  cypressFoliageGeometry,
  trunkMaterial,
  foliageMaterial,
  palette,
  setSeed,
  rand,
  randRange,
} from './props';

const UP = new THREE.Vector3(0, 1, 0);

/** A chimney emitter: world position of the chimney top + the local surface up there. */
export interface ChimneyEmitter {
  position: THREE.Vector3;
  up: THREE.Vector3;
}

/** A circular building footprint the player is pushed out of (world centre on the surface). */
export interface Obstacle {
  center: THREE.Vector3;
  radius: number;
}

interface Scatter {
  dir: THREE.Vector3;
  yaw: number;
  scale: number;
}

/** An InstancedMesh paired with a matching inverted-hull outline InstancedMesh. */
class InstancedField {
  readonly mesh: THREE.InstancedMesh;
  readonly outline: THREE.InstancedMesh;

  constructor(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    count: number,
    outlineThickness: number,
    outlineColor: string,
  ) {
    this.mesh = new THREE.InstancedMesh(geometry, material, count);
    this.mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    this.outline = new THREE.InstancedMesh(
      geometry,
      makeOutlineMaterial({ thickness: outlineThickness, color: outlineColor }),
      count,
    );
    this.outline.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  }

  set(i: number, matrix: THREE.Matrix4): void {
    this.mesh.setMatrixAt(i, matrix);
    this.outline.setMatrixAt(i, matrix);
  }

  finalize(used: number): void {
    this.mesh.count = used;
    this.outline.count = used;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.outline.instanceMatrix.needsUpdate = true;
    this.mesh.frustumCulled = false;
    this.outline.frustumCulled = false;
  }

  addTo(group: THREE.Group): void {
    group.add(this.outline); // draw outline first
    group.add(this.mesh);
  }
}

/**
 * Lays out a "core village + countryside" map on the sphere:
 *  - a central square (чешма + chapel) with collision-spaced houses along short lanes;
 *  - a lived-in countryside spread over the WHOLE globe — lone farmsteads, an orchard, a pond,
 *    terraced gardens, a hilltop cross, fields of haystacks — linked by cobblestone paths.
 * Every building is placed through a rejection sampler that keeps footprints apart, so nothing
 * intersects. The same footprints drive player collision.
 */
export class VillageLayout {
  readonly group = new THREE.Group();
  readonly chimneys: ChimneyEmitter[] = [];
  readonly colliders: THREE.Mesh[] = [];
  readonly obstacles: Obstacle[] = [];

  // build-time bookkeeping
  private placed: Obstacle[] = [];
  private cobbles: Scatter[] = [];
  private extraLeafy: Scatter[] = [];
  private extraBushes: Scatter[] = [];
  private farmsteads: THREE.Vector3[] = [];

  // scratch (build-time only, so allocations are fine)
  private _q = new THREE.Quaternion();
  private _spin = new THREE.Quaternion();
  private _pos = new THREE.Vector3();
  private _scale = new THREE.Vector3();
  private _m = new THREE.Matrix4();
  private _tan = new THREE.Vector3();
  private _wp = new THREE.Vector3();

  constructor(
    private readonly planet: Planet,
    private readonly center = new THREE.Vector3(0, 1, 0).normalize(),
    private readonly models?: ModelLibrary,
  ) {
    this.group.name = 'Village';
    setSeed(20260620);
    this.build();
  }

  /** Use a loaded GLB model for `name` if present, otherwise the procedural prop. */
  private make(name: string, fallback: () => THREE.Object3D): THREE.Object3D {
    return this.models?.get(name) ?? fallback();
  }

  // ---------------------------------------------------------------- transforms
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

  /** A direction at angular distance `angle` from `this.center`, around it by `azimuth`. */
  private dirAround(angle: number, azimuth: number, target = new THREE.Vector3()): THREE.Vector3 {
    return this.offsetDir(this.center, angle, azimuth, target);
  }

  /** A direction `angle` away from `base`, in tangent direction `azimuth`. */
  private offsetDir(base: THREE.Vector3, angle: number, azimuth: number, target = new THREE.Vector3()): THREE.Vector3 {
    const up = base.clone().normalize();
    const t = this.planet.arbitraryTangent(up, new THREE.Vector3());
    const b = up.clone().cross(t).normalize();
    const tdir = t.multiplyScalar(Math.cos(azimuth)).addScaledVector(b, Math.sin(azimuth));
    return target.copy(up).multiplyScalar(Math.cos(angle)).addScaledVector(tdir, Math.sin(angle)).normalize();
  }

  private place(obj: THREE.Object3D, dir: THREE.Vector3, yaw: number, scale = 1, height = 0): void {
    this.planet.placeOnSurface(obj, dir, height, yaw);
    obj.scale.multiplyScalar(scale);
    this.group.add(obj);
  }

  /** Yaw that makes a prop's +Z face toward the village centre. */
  private yawFacingCenter(dir: THREE.Vector3): number {
    const toCenter = this.planet.tangentToward(dir, this.center, new THREE.Vector3());
    const ref = this.planet.arbitraryTangent(dir, new THREE.Vector3());
    const refBi = dir.clone().normalize().cross(ref).normalize();
    return Math.atan2(toCenter.dot(refBi), toCenter.dot(ref));
  }

  // ---------------------------------------------------------------- collision-aware placement
  private isFree(worldPos: THREE.Vector3, radius: number, extra = 0.4): boolean {
    for (const p of this.placed) {
      if (worldPos.distanceTo(p.center) < p.radius + radius + extra) return false;
    }
    return true;
  }

  private reserve(worldPos: THREE.Vector3, radius: number): void {
    this.placed.push({ center: worldPos.clone(), radius });
  }

  /** Register a placed building's solid (non-outline) meshes as camera colliders. */
  private addColliders(building: THREE.Object3D): void {
    building.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !m.name.endsWith('__outline')) this.colliders.push(m);
    });
  }

  private addObstacle(building: THREE.Object3D): void {
    const radius = building.userData.footprint as number | undefined;
    if (radius) this.obstacles.push({ center: building.position.clone(), radius });
  }

  private collectChimney(house: THREE.Object3D): void {
    const local = house.userData.chimneyLocal as THREE.Vector3 | undefined;
    if (!local) return;
    house.updateWorldMatrix(true, false);
    const world = house.localToWorld(local.clone());
    this.chimneys.push({ position: world, up: world.clone().normalize() });
  }

  /**
   * Try to place a building facing `yaw` at `dir`; succeeds only if its footprint is clear.
   * Registers colliders, the player obstacle, and (optionally) a chimney emitter.
   */
  private tryPlaceBuilding(group: THREE.Object3D, dir: THREE.Vector3, yaw: number, chimney = false): boolean {
    this.planet.surfacePoint(dir, 0, this._wp);
    const r = (group.userData.footprint as number) ?? 2.5;
    if (!this.isFree(this._wp, r)) return false;
    this.place(group, dir, yaw, 1);
    this.addColliders(group);
    this.addObstacle(group);
    this.reserve(this._wp, r);
    if (chimney) this.collectChimney(group);
    return true;
  }

  private randomDirection(target = new THREE.Vector3()): THREE.Vector3 {
    const u = rand() * 2 - 1;
    const theta = rand() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    return target.set(r * Math.cos(theta), u, r * Math.sin(theta)).normalize();
  }

  /** A random direction at least `minAngle` (radians) away from the village centre. */
  private randomFarDir(minAngle: number): THREE.Vector3 {
    for (let i = 0; i < 200; i++) {
      const d = this.randomDirection();
      if (Math.acos(THREE.MathUtils.clamp(d.dot(this.center), -1, 1)) > minAngle) return d;
    }
    return this.randomDirection();
  }

  // ---------------------------------------------------------------- build
  private build(): void {
    this.buildSquare();
    this.buildCoreHouses();
    this.buildCountryside();
    this.buildCobblestones();
    this.buildFences();
    this.buildGates();
    this.buildScatter();
  }

  private buildSquare(): void {
    const cheshma = this.make('cheshma', createCheshma);
    this.place(cheshma, this.center, this.yawFacingCenter(this.center), 1);
    this.addColliders(cheshma);
    this.addObstacle(cheshma);
    this.reserve(cheshma.position, cheshma.userData.footprint as number);

    const chapelDir = this.dirAround(0.18, 0.6);
    const chapel = this.make('chapel', createChapel);
    this.place(chapel, chapelDir, this.yawFacingCenter(chapelDir), 1);
    this.addColliders(chapel);
    this.addObstacle(chapel);
    this.reserve(this.planet.surfacePoint(chapelDir, 0, new THREE.Vector3()), chapel.userData.footprint as number);
  }

  private buildCoreHouses(): void {
    let placed = 0;
    let attempts = 0;
    while (placed < 16 && attempts < 600) {
      attempts++;
      const angle = randRange(0.13, 0.34);
      const az = rand() * Math.PI * 2;
      const dir = this.dirAround(angle, az);
      const house = this.make('house', createHouse);
      if (this.tryPlaceBuilding(house, dir, this.yawFacingCenter(dir) + randRange(-0.25, 0.25), true)) {
        placed++;
        // dressing in the yard (decoration, not collision-reserved)
        this.place(createPot(), this.dirAround(angle + 0.03, az + randRange(-0.02, 0.02)), rand() * Math.PI * 2);
        if (rand() > 0.5) this.place(createWoodpile(), this.dirAround(angle + 0.045, az + 0.03), rand() * Math.PI * 2);
        if (rand() > 0.7) this.place(createHaystack(), this.dirAround(angle + 0.06, az - 0.04), rand() * Math.PI * 2, randRange(0.8, 1.0));
      }
    }
  }

  private buildCountryside(): void {
    // Lone farmsteads spread far across the globe.
    let farms = 0;
    let attempts = 0;
    while (farms < 7 && attempts < 800) {
      attempts++;
      const dir = this.randomFarDir(0.6);
      const house = this.make('house', createHouse);
      if (!this.tryPlaceBuilding(house, dir, rand() * Math.PI * 2, true)) continue;
      farms++;
      this.farmsteads.push(dir.clone());
      // a barn a little way off
      const barn = this.make('barn', createBarn);
      this.tryPlaceBuilding(barn, this.offsetDir(dir, 0.13, rand() * Math.PI * 2), rand() * Math.PI * 2);
      // haystacks + woodpile dressing
      const n = 1 + Math.floor(rand() * 3);
      for (let i = 0; i < n; i++) {
        this.place(createHaystack(), this.offsetDir(dir, randRange(0.03, 0.06), rand() * Math.PI * 2), rand() * Math.PI * 2, randRange(0.9, 1.2));
      }
      if (rand() > 0.4) this.place(createWoodpile(), this.offsetDir(dir, 0.04, rand() * Math.PI * 2), rand() * Math.PI * 2);
    }

    // An orchard: a tidy grid of fruit trees in one region (added to the leafy tree field).
    const oc = this.randomFarDir(0.55);
    const ot = this.planet.arbitraryTangent(oc, new THREE.Vector3());
    const ob = oc.clone().cross(ot).normalize();
    for (let i = -2; i <= 2; i++) {
      for (let j = -2; j <= 2; j++) {
        const dir = oc.clone().addScaledVector(ot, i * 0.013).addScaledVector(ob, j * 0.013).normalize();
        this.extraLeafy.push({ dir, yaw: rand() * Math.PI * 2, scale: randRange(0.8, 1.05) });
      }
    }

    // A pond with reeds in a hollow.
    const pd = this.randomFarDir(0.5);
    this.place(createPond(), pd, rand() * Math.PI * 2, 1, -0.05);
    for (let i = 0; i < 14; i++) {
      this.extraBushes.push({
        dir: this.offsetDir(pd, randRange(0.06, 0.1), rand() * Math.PI * 2),
        yaw: rand() * Math.PI * 2,
        scale: randRange(0.5, 0.9),
      });
    }

    // Terraced gardens on a couple of hillsides.
    for (let i = 0; i < 2; i++) {
      this.place(createTerrace(), this.randomFarDir(0.45), rand() * Math.PI * 2);
    }

    // A wayside cross on a far hilltop.
    const cd = this.randomFarDir(0.7);
    this.tryPlaceBuilding(this.make('cross', createWaysideCross), cd, rand() * Math.PI * 2);

    // Fields of haystacks dotted around the countryside.
    for (let k = 0; k < 4; k++) {
      const fc = this.randomFarDir(0.4);
      const n = 2 + Math.floor(rand() * 3);
      for (let i = 0; i < n; i++) {
        this.place(createHaystack(), this.offsetDir(fc, randRange(0, 0.05), rand() * Math.PI * 2), rand() * Math.PI * 2, randRange(0.9, 1.3));
      }
    }
  }

  private buildCobblestones(): void {
    // Fill the square.
    const squareR = 0.12;
    for (let r = 0; r < 7; r++) {
      const ang = (r / 7) * squareR;
      const perRing = Math.max(1, Math.floor(r * 6));
      for (let a = 0; a < perRing; a++) {
        const az = (a / perRing) * Math.PI * 2 + randRange(-0.1, 0.1);
        this.cobbles.push({ dir: this.dirAround(ang + randRange(-0.006, 0.006), az), yaw: rand() * Math.PI * 2, scale: randRange(0.8, 1.25) });
      }
    }
    // Short winding lanes radiating through the village.
    for (let s = 0; s < 4; s++) {
      const baseAz = (s / 4) * Math.PI * 2 + randRange(-0.2, 0.2);
      for (let k = 0; k < 40; k++) {
        const ang = squareR + (k / 40) * 0.32;
        const az = baseAz + Math.sin(k * 0.25) * 0.05;
        for (let w = -1; w <= 1; w++) {
          this.cobbles.push({ dir: this.dirAround(ang, az + w * 0.012), yaw: rand() * Math.PI * 2, scale: randRange(0.7, 1.1) });
        }
      }
    }
    // Cobble paths out to the two nearest farmsteads.
    const sorted = [...this.farmsteads].sort(
      (a, b) => b.dot(this.center) - a.dot(this.center),
    );
    for (const target of sorted.slice(0, 2)) this.addPath(target);

    const field = new InstancedField(cobblestoneGeometry(), cobblestoneMaterial(), this.cobbles.length, 0.02, '#5a554c');
    this.cobbles.forEach((s, i) => field.set(i, this.surfaceMatrix(s.dir, -0.05, s.yaw, s.scale)));
    field.finalize(this.cobbles.length);
    field.addTo(this.group);
  }

  /** Lay a 2-wide great-circle cobble path from the centre out to `target`. */
  private addPath(target: THREE.Vector3): void {
    const omega = Math.acos(THREE.MathUtils.clamp(this.center.dot(target), -1, 1));
    if (omega < 1e-3) return;
    const perp = new THREE.Vector3().crossVectors(this.center, target).normalize();
    const steps = Math.max(8, Math.floor((omega * this.planet.radius) / 0.7));
    const sin = Math.sin(omega);
    for (let k = 4; k < steps - 2; k++) {
      const t = k / steps;
      const a = Math.sin((1 - t) * omega) / sin;
      const b = Math.sin(t * omega) / sin;
      const base = new THREE.Vector3().copy(this.center).multiplyScalar(a).addScaledVector(target, b).normalize();
      for (const w of [-1, 1]) {
        const dir = base.clone().addScaledVector(perp, w * 0.011).normalize();
        this.cobbles.push({ dir, yaw: rand() * Math.PI * 2, scale: randRange(0.75, 1.1) });
      }
    }
  }

  private buildFences(): void {
    const posts: { dir: THREE.Vector3; yaw: number }[] = [];
    for (let f = 0; f < 2; f++) {
      const ang = 0.4 + f * 0.02;
      const count = 64;
      for (let i = 0; i < count; i++) {
        if (i % 16 < 3) continue; // gaps for lanes
        const az = (i / count) * Math.PI * 2;
        posts.push({ dir: this.dirAround(ang, az), yaw: az });
      }
    }
    const field = new InstancedField(fencePostGeometry(), fenceMaterial(), posts.length, 0.02, '#4a3322');
    posts.forEach((p, i) => field.set(i, this.surfaceMatrix(p.dir, 0.55, p.yaw, 1)));
    field.finalize(posts.length);
    field.addTo(this.group);
  }

  private buildGates(): void {
    for (let i = 0; i < 4; i++) {
      const az = (i / 4) * Math.PI * 2 + 0.4;
      const dir = this.dirAround(0.39, az);
      const gate = this.make('gate', createGate);
      this.place(gate, dir, this.yawFacingCenter(dir), 1);
      this.addColliders(gate);
    }
  }

  private buildScatter(): void {
    const leafy: Scatter[] = [...this.extraLeafy];
    const cypress: Scatter[] = [];
    const bushes: Scatter[] = [...this.extraBushes];

    for (let i = 0; i < 320; i++) {
      const dir = this.randomDirection();
      const distToCenter = Math.acos(THREE.MathUtils.clamp(dir.dot(this.center), -1, 1));
      if (distToCenter < 0.42) continue; // keep the village core clear of wild trees
      this.planet.surfacePoint(dir, 0, this._wp);
      if (!this.isFree(this._wp, 1.3, 0)) continue; // don't grow trees inside buildings
      const entry = { dir, yaw: rand() * Math.PI * 2, scale: randRange(0.8, 1.3) };
      if (rand() > 0.78) cypress.push(entry);
      else leafy.push(entry);
    }

    for (let i = 0; i < 500; i++) {
      const dir = this.randomDirection();
      const distToCenter = Math.acos(THREE.MathUtils.clamp(dir.dot(this.center), -1, 1));
      if (distToCenter < 0.22) continue;
      bushes.push({ dir, yaw: rand() * Math.PI * 2, scale: randRange(0.6, 1.4) });
    }

    this.buildTreeField(leafy, leafyTrunkGeometry(), leafyFoliageGeometry(), palette.leafA, '#23301c');
    this.buildTreeField(cypress, cypressTrunkGeometry(), cypressFoliageGeometry(), palette.leafCypress, '#1f2c1c');

    const field = new InstancedField(bushGeometry(), bushMaterial(), bushes.length, 0.025, '#2c3a22');
    bushes.forEach((b, i) => field.set(i, this.surfaceMatrix(b.dir, 0, b.yaw, b.scale)));
    field.finalize(bushes.length);
    field.addTo(this.group);
  }

  private buildTreeField(
    list: Scatter[],
    trunkGeo: THREE.BufferGeometry,
    foliageGeo: THREE.BufferGeometry,
    foliageColor: string,
    foliageOutline: string,
  ): void {
    if (list.length === 0) return;
    const trunk = new InstancedField(trunkGeo, trunkMaterial(), list.length, 0.03, '#241a12');
    const foliage = new InstancedField(foliageGeo, foliageMaterial(foliageColor), list.length, 0.045, foliageOutline);
    list.forEach((t, i) => {
      const m = this.surfaceMatrix(t.dir, 0, t.yaw, t.scale);
      trunk.set(i, m);
      foliage.set(i, m);
    });
    trunk.finalize(list.length);
    foliage.finalize(list.length);
    trunk.addTo(this.group);
    foliage.addTo(this.group);
  }
}
