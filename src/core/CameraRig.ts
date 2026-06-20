import * as THREE from 'three';
import { PlayerController } from './PlayerController';

/**
 * Third-person follow camera that holds an offset behind and above the player **in the
 * player's local frame**. Position, look-target and the camera's up vector are all damped,
 * and the up tracks the player's (smoothed) local up so circling the planet never flips the
 * horizon violently. Mouse-Y pitches; the wheel zooms.
 */
export class CameraRig {
  distance = 12;
  height = 5.5;
  lookHeight = 2.2;
  pitch = 0.35; // radians above the horizon
  minPitch = -0.25;
  maxPitch = 1.15;
  pitchSpeed = 0.0025;
  minDistance = 6;
  maxDistance = 24;

  /** Solid meshes to keep the camera from passing through (set from VillageLayout). */
  colliders: THREE.Object3D[] = [];
  collisionMargin = 0.6; // keep this far off a wall
  minClampDistance = 2.5; // never come closer than this to the look target

  private smoothedUp = new THREE.Vector3(0, 1, 0);
  private smoothedTarget = new THREE.Vector3();
  private currentPos = new THREE.Vector3();
  private initialized = false;
  private raycaster = new THREE.Raycaster();
  private _dir = new THREE.Vector3();

  // scratch
  private _offset = new THREE.Vector3();
  private _right = new THREE.Vector3();
  private _desired = new THREE.Vector3();
  private _q = new THREE.Quaternion();

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    private readonly player: PlayerController,
  ) {}

  update(dt: number, mouseDY: number, wheel: number, lookActive: boolean): void {
    // Pitch + zoom from input.
    if (lookActive && mouseDY !== 0) {
      this.pitch = THREE.MathUtils.clamp(
        this.pitch - mouseDY * this.pitchSpeed,
        this.minPitch,
        this.maxPitch,
      );
    }
    if (wheel !== 0) {
      this.distance = THREE.MathUtils.clamp(
        this.distance + wheel * 0.01,
        this.minDistance,
        this.maxDistance,
      );
    }

    const playerUp = this.player.up;
    const playerFwd = this.player.forward;
    const playerPos = this.player.position;

    // Smooth the up to keep the horizon stable while traversing the globe.
    const upT = 1 - Math.exp(-6 * dt);
    this.smoothedUp.lerp(playerUp, upT).normalize();

    // Build the camera offset in the player's local frame: behind (-forward) and above (+up),
    // then rotate it up/down by pitch around the local right axis.
    this._right.copy(playerFwd).cross(playerUp).normalize();
    this._offset
      .copy(playerFwd)
      .multiplyScalar(-this.distance) // behind
      .addScaledVector(playerUp, this.height); // above
    this._q.setFromAxisAngle(this._right, this.pitch);
    this._offset.applyQuaternion(this._q);

    this._desired.copy(playerPos).add(this._offset);

    const target = this._target(playerPos, playerUp);

    // Pull the desired position in if a wall sits between it and the look target.
    this.clampToColliders(this.smoothedTarget.lengthSq() > 0 ? this.smoothedTarget : target, this._desired);

    if (!this.initialized) {
      this.currentPos.copy(this._desired);
      this.smoothedTarget.copy(target);
      this.smoothedUp.copy(playerUp);
      this.initialized = true;
    } else {
      // Spring out gently, but snap inward fast so we never sit inside a wall.
      const pullingIn = this._desired.distanceToSquared(target) < this.currentPos.distanceToSquared(target);
      const posT = 1 - Math.exp(-(pullingIn ? 22 : 9) * dt);
      const tgtT = 1 - Math.exp(-12 * dt);
      this.currentPos.lerp(this._desired, posT);
      this.smoothedTarget.lerp(target, tgtT);
    }

    // Final hard clamp so the smoothed position itself never clips through a wall.
    this.clampToColliders(this.smoothedTarget, this.currentPos);

    this.camera.position.copy(this.currentPos);
    this.camera.up.copy(this.smoothedUp);
    this.camera.lookAt(this.smoothedTarget);
  }

  /** If a collider lies between `from` and `to`, pull `to` (in place) to just before the hit. */
  private clampToColliders(from: THREE.Vector3, to: THREE.Vector3): void {
    if (this.colliders.length === 0) return;
    this._dir.copy(to).sub(from);
    const dist = this._dir.length();
    if (dist < 1e-4) return;
    this._dir.divideScalar(dist);
    this.raycaster.set(from, this._dir);
    this.raycaster.far = dist;
    const hits = this.raycaster.intersectObjects(this.colliders, false);
    if (hits.length > 0) {
      const d = Math.max(hits[0].distance - this.collisionMargin, this.minClampDistance);
      to.copy(from).addScaledVector(this._dir, d);
    }
  }

  private _tmpTarget = new THREE.Vector3();
  private _target(playerPos: THREE.Vector3, up: THREE.Vector3): THREE.Vector3 {
    return this._tmpTarget.copy(playerPos).addScaledVector(up, this.lookHeight);
  }

  get position(): THREE.Vector3 {
    return this.camera.position;
  }
}
