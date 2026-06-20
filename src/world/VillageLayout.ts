import * as THREE from 'three';
import { Planet } from '../core/Planet';
import { makeOutlineMaterial } from '../render/OutlinePass';
import {
  createHouse,
  createChapel,
  createCheshma,
  createTree,
  createPot,
  createHaystack,
  createWoodpile,
  cobblestoneGeometry,
  cobblestoneMaterial,
  fencePostGeometry,
  fenceMaterial,
  bushGeometry,
  bushMaterial,
  setSeed,
  rand,
  randRange,
} from './props';

const UP = new THREE.Vector3(0, 1, 0);

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

export class VillageLayout {
  readonly group = new THREE.Group();

  // scratch
  private _q = new THREE.Quaternion();
  private _spin = new THREE.Quaternion();
  private _pos = new THREE.Vector3();
  private _scale = new THREE.Vector3();
  private _m = new THREE.Matrix4();
  private _tan = new THREE.Vector3();
  private _bitan = new THREE.Vector3();

  constructor(
    private readonly planet: Planet,
    private readonly center = new THREE.Vector3(0, 1, 0).normalize(),
  ) {
    this.group.name = 'Village';
    setSeed(20260620);
    this.build();
  }

  /** Compose a surface transform: +Y -> normal at `dir`, spun by `yaw`, scaled. */
  private surfaceMatrix(dir: THREE.Vector3, height: number, yaw: number, scale: number): THREE.Matrix4 {
    const d = this._tan.copy(dir).normalize();
    this._pos.copy(d).multiplyScalar(this.planet.radius + height);
    this._q.setFromUnitVectors(UP, d);
    this._spin.setFromAxisAngle(d, yaw);
    this._q.premultiply(this._spin);
    this._scale.setScalar(scale);
    return this._m.compose(this._pos, this._q, this._scale);
  }

  /**
   * A direction at angular distance `angle` (radians) from `this.center`, around the center
   * by `azimuth`. Lets us lay out the square/streets without ever touching lat/long.
   */
  private dirAround(angle: number, azimuth: number, target = new THREE.Vector3()): THREE.Vector3 {
    // Build a tangent basis at the center.
    this.planet.arbitraryTangent(this.center, this._tan);
    this._bitan.copy(this.center).cross(this._tan).normalize();
    const t = this._tan.clone().multiplyScalar(Math.cos(azimuth)).addScaledVector(this._bitan, Math.sin(azimuth));
    // Rotate the center vector toward `t` by `angle`.
    return target
      .copy(this.center)
      .multiplyScalar(Math.cos(angle))
      .addScaledVector(t, Math.sin(angle))
      .normalize();
  }

  private place(obj: THREE.Object3D, dir: THREE.Vector3, yaw: number, scale = 1): void {
    this.planet.placeOnSurface(obj, dir, 0, yaw);
    obj.scale.multiplyScalar(scale);
    this.group.add(obj);
  }

  /** Yaw that makes a prop's +Z face toward the village center (so houses face the square). */
  private yawFacingCenter(dir: THREE.Vector3): number {
    // Tangent at dir pointing toward center.
    const toCenter = this.planet.tangentToward(dir, this.center, new THREE.Vector3());
    // Reference tangent that corresponds to yaw=0 (arbitraryTangent used by placeOnSurface? No —
    // placeOnSurface spins +X/+Z arbitrarily). We approximate facing by measuring angle between
    // the prop's +Z after align and the desired tangent. Simpler: derive yaw from a fixed ref.
    const ref = this.planet.arbitraryTangent(dir, new THREE.Vector3());
    const refBi = dir.clone().normalize().cross(ref).normalize();
    return Math.atan2(toCenter.dot(refBi), toCenter.dot(ref));
  }

  private build(): void {
    const R = this.planet.radius;

    // --- Landmarks at the square ---
    const cheshma = createCheshma();
    this.place(cheshma, this.center, this.yawFacingCenter(this.center), 1);

    const chapelDir = this.dirAround(0.16, 0.6);
    const chapel = createChapel();
    this.place(chapel, chapelDir, this.yawFacingCenter(chapelDir), 1);

    // --- Ring of houses around the square ---
    const houseCount = 9;
    for (let i = 0; i < houseCount; i++) {
      const azimuth = (i / houseCount) * Math.PI * 2 + randRange(-0.12, 0.12);
      const angle = randRange(0.12, 0.2);
      const dir = this.dirAround(angle, azimuth);
      const house = createHouse();
      // Face the square, with a little jitter.
      this.place(house, dir, this.yawFacingCenter(dir) + randRange(-0.2, 0.2), 1);

      // Dress each house: a pot, sometimes a woodpile / haystack nearby.
      const sideAz = azimuth + randRange(-0.05, 0.05);
      this.place(createPot(), this.dirAround(angle + 0.035, sideAz), rand() * Math.PI * 2, 1);
      if (rand() > 0.5) {
        this.place(createWoodpile(), this.dirAround(angle + 0.05, azimuth + 0.04), rand() * Math.PI * 2, 1);
      }
      if (rand() > 0.6) {
        this.place(createHaystack(), this.dirAround(angle + 0.07, azimuth - 0.05), rand() * Math.PI * 2, randRange(0.8, 1.1));
      }
    }

    // --- Cobblestone square + radiating streets (instanced калдъръм) ---
    this.buildCobblestones();

    // --- Garden fences around the square ---
    this.buildFences();

    // --- Countryside: trees + bushes wrapping the whole globe ---
    this.buildScatter();

    void R;
  }

  private buildCobblestones(): void {
    const stones: { dir: THREE.Vector3; yaw: number; scale: number }[] = [];

    // Fill the square (a disc of small angular radius around the center).
    const squareR = 0.13;
    const ringCount = 7;
    for (let r = 0; r < ringCount; r++) {
      const ang = (r / ringCount) * squareR;
      const perRing = Math.max(1, Math.floor(r * 6));
      for (let a = 0; a < perRing; a++) {
        const az = (a / perRing) * Math.PI * 2 + randRange(-0.1, 0.1);
        stones.push({
          dir: this.dirAround(ang + randRange(-0.006, 0.006), az),
          yaw: rand() * Math.PI * 2,
          scale: randRange(0.8, 1.25),
        });
      }
    }

    // A few winding streets radiating outward (great-circle arcs from center).
    const streets = 4;
    for (let s = 0; s < streets; s++) {
      const baseAz = (s / streets) * Math.PI * 2 + randRange(-0.2, 0.2);
      const steps = 60;
      for (let k = 0; k < steps; k++) {
        const ang = squareR + (k / steps) * 0.5;
        // gentle wind
        const az = baseAz + Math.sin(k * 0.25) * 0.05;
        for (let w = -1; w <= 1; w++) {
          stones.push({
            dir: this.dirAround(ang, az + w * 0.012),
            yaw: rand() * Math.PI * 2,
            scale: randRange(0.7, 1.1),
          });
        }
      }
    }

    const field = new InstancedField(cobblestoneGeometry(), cobblestoneMaterial(), stones.length, 0.02, '#5a554c');
    stones.forEach((s, i) => field.set(i, this.surfaceMatrix(s.dir, -0.05, s.yaw, s.scale)));
    field.finalize(stones.length);
    field.addTo(this.group);
  }

  private buildFences(): void {
    const posts: { dir: THREE.Vector3; yaw: number }[] = [];
    const fenceRings = 2;
    for (let f = 0; f < fenceRings; f++) {
      const ang = 0.22 + f * 0.02;
      const count = 70;
      for (let i = 0; i < count; i++) {
        // leave gaps for streets
        if (i % 18 < 3) continue;
        const az = (i / count) * Math.PI * 2;
        posts.push({ dir: this.dirAround(ang, az), yaw: az });
      }
    }
    const field = new InstancedField(fencePostGeometry(), fenceMaterial(), posts.length, 0.02, '#4a3322');
    posts.forEach((p, i) => field.set(i, this.surfaceMatrix(p.dir, 0.55, p.yaw, 1)));
    field.finalize(posts.length);
    field.addTo(this.group);
  }

  private buildScatter(): void {
    // Trees scattered over the entire sphere (denser away from the square), plus cypresses.
    const leafy: { dir: THREE.Vector3; yaw: number; scale: number }[] = [];
    const cypress: { dir: THREE.Vector3; yaw: number; scale: number }[] = [];
    const bushes: { dir: THREE.Vector3; yaw: number; scale: number }[] = [];

    const treeTotal = 260;
    for (let i = 0; i < treeTotal; i++) {
      const dir = this.randomDirection();
      const distToCenter = Math.acos(THREE.MathUtils.clamp(dir.dot(this.center), -1, 1));
      // keep the square + immediate streets clear of trees
      if (distToCenter < 0.26) continue;
      const entry = { dir, yaw: rand() * Math.PI * 2, scale: randRange(0.8, 1.3) };
      if (rand() > 0.78) cypress.push(entry);
      else leafy.push(entry);
    }

    // Bushes everywhere for ground texture.
    const bushTotal = 420;
    for (let i = 0; i < bushTotal; i++) {
      const dir = this.randomDirection();
      const distToCenter = Math.acos(THREE.MathUtils.clamp(dir.dot(this.center), -1, 1));
      if (distToCenter < 0.2) continue;
      bushes.push({ dir, yaw: rand() * Math.PI * 2, scale: randRange(0.6, 1.4) });
    }

    // Trees are non-trivial groups, so we *clone* a few master trees and place copies.
    // (Instancing whole hierarchies is overkill for this density; cloning keeps it simple.)
    this.placeTreeClones(leafy, 'leafy');
    this.placeTreeClones(cypress, 'cypress');

    // Bushes are cheap + uniform -> instanced.
    const field = new InstancedField(bushGeometry(), bushMaterial(), bushes.length, 0.025, '#2c3a22');
    bushes.forEach((b, i) => field.set(i, this.surfaceMatrix(b.dir, 0.3 * b.scale, b.yaw, b.scale)));
    field.finalize(bushes.length);
    field.addTo(this.group);
  }

  private placeTreeClones(
    list: { dir: THREE.Vector3; yaw: number; scale: number }[],
    kind: 'leafy' | 'cypress',
  ): void {
    // Build a small set of master trees, then clone (sharing geometry/material) for variety.
    const masters = Array.from({ length: 6 }, () => createTree(kind));
    for (const entry of list) {
      const master = masters[Math.floor(rand() * masters.length)];
      const clone = master.clone();
      this.place(clone, entry.dir, entry.yaw, entry.scale);
    }
  }

  private randomDirection(target = new THREE.Vector3()): THREE.Vector3 {
    // Uniform point on the unit sphere.
    const u = rand() * 2 - 1;
    const theta = rand() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    return target.set(r * Math.cos(theta), u, r * Math.sin(theta)).normalize();
  }
}
