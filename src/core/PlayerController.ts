import * as THREE from 'three';
import { Planet } from './Planet';
import { Input } from './Input';
import { createToonMaterial } from '../render/ToonMaterial';
import { outlineHierarchy } from '../render/OutlinePass';

/**
 * Great-circle locomotion on the sphere.
 *
 * The player has a world-space `position` (a point at `radius + footHeight`) and a `forward`
 * tangent that defines heading. Each frame we:
 *   1. derive local up = normalize(position);
 *   2. keep `forward` orthogonal to up (re-projected into the tangent plane);
 *   3. apply WASD input in that tangent frame;
 *   4. re-project the new position back onto the sphere.
 * This yields motion along great circles that works identically everywhere on the globe —
 * including the "top" and "bottom" — with no lat/long pole special-casing.
 */
export class PlayerController {
  readonly root: THREE.Object3D;
  readonly position = new THREE.Vector3();
  readonly forward = new THREE.Vector3();
  readonly up = new THREE.Vector3(0, 1, 0);
  readonly right = new THREE.Vector3();

  footHeight: number;
  walkSpeed = 8.0; // world units / sec
  runMultiplier = 1.9;
  turnSpeed = 0.0022; // radians per pixel of mouse-x
  private currentSpeed = 0;

  private visual: THREE.Group;
  private bobTime = 0;
  private idleTime = 0;
  private targetQuat = new THREE.Quaternion();

  // scratch
  private _m = new THREE.Matrix4();
  private _v = new THREE.Vector3();
  private _moveDir = new THREE.Vector3();
  private _newPos = new THREE.Vector3();
  private _zAxis = new THREE.Vector3();
  private _xAxis = new THREE.Vector3();

  constructor(
    private readonly planet: Planet,
    startDirection = new THREE.Vector3(0, 1, 0.0001),
  ) {
    this.root = new THREE.Object3D();
    this.root.name = 'Player';

    this.visual = this.buildCharacter();
    this.root.add(this.visual);

    // The visual is built with its feet at local y = 0, so the root only needs a small
    // clearance to avoid clipping into the faceted ground between icosphere vertices.
    this.footHeight = 0.06;

    // Initial placement + heading.
    this.planet.surfacePoint(startDirection, this.footHeight, this.position);
    this.planet.localUp(this.position, this.up);
    this.planet.arbitraryTangent(this.up, this.forward);

    this.syncTransform(1);
  }

  // --- character geometry (placeholder, but Ghibli-ish in palette) ---
  private capsuleRadius = 0.55;
  private capsuleLength = 1.2;

  private buildCharacter(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'PlayerVisual';

    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(this.capsuleRadius, this.capsuleLength, 6, 16),
      createToonMaterial({ color: '#b5462f', shadowStrength: 0.5, rimStrength: 0.6 }), // terracotta tunic
    );
    body.name = 'PlayerBody';
    // Capsule's local origin is its centre; lift so the base sits at y=0 of the visual group.
    body.position.y = this.capsuleRadius + this.capsuleLength / 2;
    group.add(body);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 20, 16),
      createToonMaterial({ color: '#e9c9a6', shadowStrength: 0.6, rimStrength: 0.5 }), // skin
    );
    head.name = 'PlayerHead';
    head.position.y = this.capsuleRadius + this.capsuleLength + 0.28;
    group.add(head);

    // A little forward "nose"/cap brim so the facing direction is legible.
    const brim = new THREE.Mesh(
      new THREE.ConeGeometry(0.18, 0.4, 12),
      createToonMaterial({ color: '#3b2a1d', shadowStrength: 0.6, rimStrength: 0.3 }),
    );
    brim.rotation.x = Math.PI / 2;
    brim.position.set(0, head.position.y + 0.05, 0.42);
    group.add(brim);

    outlineHierarchy(group, { thickness: 0.03, color: '#241a14' });
    return group;
  }

  update(dt: number, input: Input, mouseDX: number): void {
    // 1. local up
    this.planet.localUp(this.position, this.up);

    // 2. mouse-look / touch-drag turns heading around the local up axis.
    if (input.lookActive && mouseDX !== 0) {
      this.forward.applyAxisAngle(this.up, -mouseDX * this.turnSpeed);
    }

    // keep forward tangent to the sphere
    this.orthonormalizeForward();
    this.right.copy(this.forward).cross(this.up).normalize();

    // 3. movement in the tangent plane
    const f = input.forward;
    const s = input.strafe;
    this._moveDir.set(0, 0, 0);
    if (f !== 0 || s !== 0) {
      this._moveDir
        .copy(this.forward)
        .multiplyScalar(f)
        .addScaledVector(this.right, s)
        .normalize();
    }

    const targetSpeed =
      (this._moveDir.lengthSq() > 0 ? this.walkSpeed : 0) *
      (input.running ? this.runMultiplier : 1);
    // ease speed for nicer starts/stops
    this.currentSpeed = THREE.MathUtils.damp(this.currentSpeed, targetSpeed, 10, dt);

    if (this.currentSpeed > 0.0001) {
      this._newPos
        .copy(this.position)
        .addScaledVector(this._moveDir, this.currentSpeed * dt);
      // 4. re-project onto the sphere surface
      this.planet.surfacePoint(this._newPos, this.footHeight, this.position);
      this.planet.localUp(this.position, this.up);
      this.orthonormalizeForward();
    }

    // walking bob, or a gentle idle breathing when stood still
    const moving = this.currentSpeed > 0.5;
    if (moving) {
      this.bobTime += dt * this.currentSpeed * 1.1;
      this.visual.position.y = Math.abs(Math.sin(this.bobTime)) * 0.12;
      this.visual.scale.y = 1;
    } else {
      this.idleTime += dt;
      this.visual.position.y = Math.sin(this.idleTime * 1.6) * 0.03;
      this.visual.scale.y = 1 + Math.sin(this.idleTime * 1.6) * 0.012;
    }

    this.syncTransform(dt);
  }

  /** Re-project the heading vector into the current tangent plane. */
  private orthonormalizeForward(): void {
    this._v.copy(this.up).multiplyScalar(this.forward.dot(this.up));
    this.forward.sub(this._v);
    if (this.forward.lengthSq() < 1e-8) {
      this.planet.arbitraryTangent(this.up, this.forward);
    } else {
      this.forward.normalize();
    }
  }

  /** Position the root on the surface and slerp its orientation toward the target frame. */
  private syncTransform(dt: number): void {
    this.root.position.copy(this.position);

    // Build target basis: +Y -> up, -Z -> forward (three faces down -Z).
    this._zAxis.copy(this.forward).negate();
    this._xAxis.copy(this.up).cross(this._zAxis).normalize();
    this._m.makeBasis(this._xAxis, this.up, this._zAxis);
    this.targetQuat.setFromRotationMatrix(this._m);

    if (dt >= 1) {
      this.root.quaternion.copy(this.targetQuat);
    } else {
      // Frame-rate independent slerp.
      const t = 1 - Math.exp(-12 * dt);
      this.root.quaternion.slerp(this.targetQuat, t);
    }
  }
}
