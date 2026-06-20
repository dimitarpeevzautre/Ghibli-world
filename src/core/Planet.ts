import * as THREE from 'three';
import { createToonMaterial } from '../render/ToonMaterial';
import { addOutline } from '../render/OutlinePass';

/**
 * The planet is a REAL sphere centred at the origin — no curved-world vertex trickery.
 * Every piece of surface logic in the project derives from a point's direction vector,
 * so this class is the single source of truth for "where is the surface and which way is up".
 */
export class Planet {
  readonly radius: number;
  readonly mesh: THREE.Mesh;
  readonly group: THREE.Group;

  private static readonly UP = new THREE.Vector3(0, 1, 0);

  constructor(radius = 40) {
    this.radius = radius;
    this.group = new THREE.Group();
    this.group.name = 'Planet';

    // Icosphere -> even triangle distribution (no pole pinching like lat/long spheres).
    const geometry = new THREE.IcosahedronGeometry(radius, 24);
    const material = createToonMaterial({
      color: '#8aa05a', // warm village green
      bands: 3,
      shadowStrength: 0.6,
      rimStrength: 0.15,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'PlanetSurface';
    this.group.add(this.mesh);

    // A faint ink rim around the whole globe helps it read as a drawn object.
    addOutline(this.mesh, { thickness: 0.12, color: '#3a4226' });
  }

  /** Local "up" at a world-space point: the outward surface normal. */
  localUp(point: THREE.Vector3, target = new THREE.Vector3()): THREE.Vector3 {
    return target.copy(point).normalize();
  }

  /** World-space point on (or above) the surface for a given outward direction. */
  surfacePoint(
    direction: THREE.Vector3,
    height = 0,
    target = new THREE.Vector3(),
  ): THREE.Vector3 {
    return target.copy(direction).normalize().multiplyScalar(this.radius + height);
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
  ): void {
    const up = this._p1.copy(direction).normalize();
    this.surfacePoint(up, height, object.position);

    // facing (+Z) = zero tangent rotated around the normal by yaw.
    const facing = this.arbitraryTangent(up, this._p2).applyAxisAngle(up, yaw);
    const xAxis = this._p3.copy(up).cross(facing).normalize();
    this._basis.makeBasis(xAxis, up, facing);
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
