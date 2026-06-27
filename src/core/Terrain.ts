import * as THREE from 'three';

export type Region = 'meadow' | 'hillside' | 'highland' | 'rock' | 'waterside' | 'snow';

export interface TerrainConfig {
  hillAmplitude?: number;
  hillFrequency?: number;
  basinRadius?: number;
  basinDepth?: number;
  streamWidth?: number;
  streamDepth?: number;
  seed?: number;
}

// Vivid storybook ground tones (bolder than classic muted Ghibli, to read as a colourful planet).
const GROUND = {
  meadow: new THREE.Color('#93d63c'),
  hillA: new THREE.Color('#5dc22c'),
  hillB: new THREE.Color('#3a9622'),
  autumn: new THREE.Color('#ef8c16'),
  highland: new THREE.Color('#e6d23f'),
  rock: new THREE.Color('#9a8f7e'),
  sand: new THREE.Color('#f1da86'),
  snow: new THREE.Color('#f2f6f9'),
};

// A few hero mountains (fixed directions) so the planet has a sculpted silhouette.
const PEAKS = [
  { dir: new THREE.Vector3(0.9, 0.12, 0.42).normalize(), h: 18, w: 0.30 },
  { dir: new THREE.Vector3(-0.5, -0.18, 0.85).normalize(), h: 13, w: 0.26 },
  { dir: new THREE.Vector3(-0.25, -0.86, -0.45).normalize(), h: 21, w: 0.34 },
  { dir: new THREE.Vector3(0.35, 0.55, -0.76).normalize(), h: 11, w: 0.24 },
];

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
    this.hillAmplitude = config.hillAmplitude ?? 6.0;
    this.hillFrequency = config.hillFrequency ?? 1.9;
    this.basinRadius = config.basinRadius ?? 0.3;
    this.basinDepth = config.basinDepth ?? 2.2;
    this.streamWidth = config.streamWidth ?? 0.06;
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

    // 1b. hero mountains — a few gaussian peaks for a sculpted silhouette
    for (const p of PEAKS) {
      const a = Math.acos(THREE.MathUtils.clamp(d.dot(p.dir), -1, 1));
      h += p.h * Math.exp(-(a * a) / (p.w * p.w));
    }

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
    // Fresh local `d` (not the shared _d scratch): normalAt()/heightAt() below use _d internally, so reusing it would alias.
    const d = dir.clone().normalize();
    if (this.distanceToStream(d) < this.streamWidth * 1.8) return 'waterside';
    const h = this.heightAt(d);
    if (h > 12) return 'snow'; // only the hero-mountain tops reach this
    const n = this.normalAt(d, radius, this._n);
    const slope = 1 - Math.max(0, n.dot(d));
    if (slope > 0.22) return 'rock';
    const hn = clamp01((h + this.basinDepth) / (this.hillAmplitude + this.basinDepth));
    if (hn < 0.4) return 'meadow';
    if (hn < 0.85) return 'hillside';
    return 'highland';
  }

  colorAt(dir: THREE.Vector3, radius: number, target = new THREE.Color()): THREE.Color {
    // Fresh local `d` (not the shared _d scratch): normalAt()/heightAt() below use _d internally, so reusing it would alias.
    const d = dir.clone().normalize();
    switch (this.regionAt(d, radius)) {
      case 'waterside': return target.copy(GROUND.sand);
      case 'snow': return target.copy(GROUND.snow);
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
