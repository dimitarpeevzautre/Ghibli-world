import * as THREE from 'three';
import { createToonMaterial } from '../render/ToonMaterial';
import { addOutline } from '../render/OutlinePass';
import { Terrain } from './Terrain';

/**
 * The planet is a REAL sphere centred at the origin — no curved-world vertex trickery.
 * Every piece of surface logic in the project derives from a point's direction vector,
 * so this class is the single source of truth for "where is the surface and which way is up".
 */
export class Planet {
  readonly radius: number;
  readonly terrain: Terrain;
  readonly mesh: THREE.Mesh;
  readonly group: THREE.Group;

  private static readonly UP = new THREE.Vector3(0, 1, 0);

  constructor(radius = 40, center = new THREE.Vector3(0, 1, 0).normalize()) {
    this.radius = radius;
    this.terrain = new Terrain(center);
    this.group = new THREE.Group();
    this.group.name = 'Planet';

    const geometry = new THREE.IcosahedronGeometry(radius, 24);
    this.displace(geometry); // push vertices to terrain height + set analytic normals

    const material = createToonMaterial({
      color: '#ffffff',     // white base; per-vertex terrain colour provides the hue
      bands: 3,
      shadowStrength: 0.6,
      rimStrength: 0.15,
      vertexColors: true,
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

  /** Local "up": the true terrain surface normal at the given world-space point. */
  localUp(point: THREE.Vector3, target = new THREE.Vector3()): THREE.Vector3 {
    return this.terrain.normalAt(this._p1.copy(point).normalize(), this.radius, target);
  }

  /** Pure radial up (level horizon) — fallback for anything that must ignore slope. */
  radialUp(point: THREE.Vector3, target = new THREE.Vector3()): THREE.Vector3 {
    return target.copy(point).normalize();
  }

  /** World-space point on (or above) the surface for a given outward direction. */
  surfacePoint(direction: THREE.Vector3, height = 0, target = new THREE.Vector3()): THREE.Vector3 {
    const d = this._p1.copy(direction).normalize();
    return target.copy(d).multiplyScalar(this.radius + this.terrain.heightAt(d) + height);
  }

  /**
   * Orient and place an object on the sphere so its local +Y aligns with the outward surface
   * normal and its local +Z faces a tangent direction chosen by `yaw`. At `yaw = 0` the object
   * faces `arbitraryTangent(dir)`; positive yaw spins it around the normal. Because the zero
   * tangent is deterministic, callers can compute a yaw that makes a prop face anywhere (see
   * VillageLayout.yawFacingCenter). Reused for every prop — buildings, trees, fences, stones.
   */
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

  private _p1 = new THREE.Vector3();
  private _p2 = new THREE.Vector3();
  private _p3 = new THREE.Vector3();
  private _basis = new THREE.Matrix4();

  /**
   * A unit tangent vector at `direction`, pointing toward `reference` as much as possible.
   * Used to give props/paths a consistent "north" to orient against.
   */
  tangentToward(
    direction: THREE.Vector3,
    reference: THREE.Vector3,
    target = new THREE.Vector3(),
  ): THREE.Vector3 {
    const up = direction.clone().normalize();
    target.copy(reference).sub(up.clone().multiplyScalar(reference.dot(up)));
    if (target.lengthSq() < 1e-6) {
      // Reference was parallel to up; fall back to an arbitrary tangent.
      target.copy(this.arbitraryTangent(up));
    }
    return target.normalize();
  }

  /** Any unit tangent at the given outward direction. */
  arbitraryTangent(direction: THREE.Vector3, target = new THREE.Vector3()): THREE.Vector3 {
    const up = direction.clone().normalize();
    const seed = Math.abs(up.y) < 0.99 ? Planet.UP : new THREE.Vector3(1, 0, 0);
    return target.copy(seed).cross(up).normalize();
  }
}
