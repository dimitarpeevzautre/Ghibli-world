import * as THREE from 'three';
import { ChimneyEmitter } from './VillageLayout';

/**
 * Living-world particle effects, kept cheap: two CPU-updated THREE.Points systems (chimney
 * smoke + drifting leaves), each a single draw call with a custom billboard point shader that
 * supports per-particle size, alpha and colour.
 */

const pointVertex = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  uniform float uScale;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(-mv.z, 0.1);
    gl_Position = projectionMatrix * mv;
    vAlpha = aAlpha;
    vColor = aColor;
  }
`;

const pointFragment = /* glsl */ `
  precision highp float;
  uniform sampler2D uTex;
  uniform vec3 uTint;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec4 t = texture2D(uTex, gl_PointCoord);
    float a = t.a * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uTint * vColor * t.rgb, a);
  }
`;

function softCircleTexture(): THREE.CanvasTexture {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function leafTexture(): THREE.CanvasTexture {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  ctx.translate(s / 2, s / 2);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  // simple pointed leaf
  ctx.moveTo(0, -26);
  ctx.quadraticCurveTo(20, -6, 0, 26);
  ctx.quadraticCurveTo(-20, -6, 0, -26);
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makePoints(count: number, tex: THREE.Texture, tint: THREE.Color, scale: number): {
  points: THREE.Points;
  pos: Float32Array;
  size: Float32Array;
  alpha: Float32Array;
} {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const alpha = new Float32Array(count);
  const color = new Float32Array(count * 3).fill(1);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
  geo.setAttribute('aColor', new THREE.BufferAttribute(color, 3));
  const mat = new THREE.ShaderMaterial({
    vertexShader: pointVertex,
    fragmentShader: pointFragment,
    uniforms: {
      uTex: { value: tex },
      uTint: { value: tint },
      uScale: { value: scale },
    },
    transparent: true,
    depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return { points, pos, size, alpha };
}

export class Effects {
  readonly group = new THREE.Group();
  smokeEnabled = true;
  leavesEnabled = true;

  private rng = 99173;

  // smoke
  private smokeCount: number;
  private smoke: ReturnType<typeof makePoints>;
  private sVel: Float32Array;
  private sUp: Float32Array;
  private sHome: Float32Array;
  private sAge: Float32Array;
  private sLife: Float32Array;

  // leaves
  private leafCount = 200;
  private leaves: ReturnType<typeof makePoints>;
  private lVel: Float32Array;
  private lSwirl: Float32Array;

  constructor(
    private readonly chimneys: ChimneyEmitter[],
    private readonly center: THREE.Vector3,
    private readonly radius: number,
  ) {
    this.group.name = 'Effects';

    // --- smoke ---
    const perChimney = 16;
    this.smokeCount = Math.max(1, chimneys.length) * perChimney;
    this.smoke = makePoints(this.smokeCount, softCircleTexture(), new THREE.Color('#d9d4cb'), 220);
    this.sVel = new Float32Array(this.smokeCount * 3);
    this.sUp = new Float32Array(this.smokeCount * 3);
    this.sHome = new Float32Array(this.smokeCount * 3);
    this.sAge = new Float32Array(this.smokeCount);
    this.sLife = new Float32Array(this.smokeCount);
    for (let i = 0; i < this.smokeCount; i++) this.initSmoke(i, true);
    this.group.add(this.smoke.points);

    // --- leaves ---
    this.leaves = makePoints(this.leafCount, leafTexture(), new THREE.Color('#ffffff'), 90);
    this.lVel = new Float32Array(this.leafCount);
    this.lSwirl = new Float32Array(this.leafCount * 2);
    const leafColors = ['#c8772f', '#d8a93f', '#a8702a', '#6f8f4a', '#b5462f'];
    const colAttr = this.leaves.points.geometry.getAttribute('aColor') as THREE.BufferAttribute;
    for (let i = 0; i < this.leafCount; i++) {
      this.initLeaf(i, true);
      const col = new THREE.Color(leafColors[Math.floor(this.rand() * leafColors.length)]);
      colAttr.setXYZ(i, col.r, col.g, col.b);
    }
    colAttr.needsUpdate = true;
    this.group.add(this.leaves.points);
  }

  private rand(): number {
    this.rng = (this.rng * 1664525 + 1013904223) >>> 0;
    return this.rng / 0xffffffff;
  }

  // --- smoke particle lifecycle ---
  private initSmoke(i: number, stagger: boolean): void {
    const ch = this.chimneys.length ? this.chimneys[i % this.chimneys.length] : null;
    const p = ch ? ch.position : this.center.clone().multiplyScalar(this.radius);
    const up = ch ? ch.up : this.center;
    const i3 = i * 3;
    this.sHome[i3] = p.x;
    this.sHome[i3 + 1] = p.y;
    this.sHome[i3 + 2] = p.z;
    this.sUp[i3] = up.x;
    this.sUp[i3 + 1] = up.y;
    this.sUp[i3 + 2] = up.z;

    // small tangent jitter on the rise
    const rise = 1.1 + this.rand() * 0.7;
    const tx = (this.rand() - 0.5) * 0.5;
    const tz = (this.rand() - 0.5) * 0.5;
    this.sVel[i3] = up.x * rise + tx;
    this.sVel[i3 + 1] = up.y * rise + tz;
    this.sVel[i3 + 2] = up.z * rise + (this.rand() - 0.5) * 0.5;

    this.smoke.pos[i3] = p.x;
    this.smoke.pos[i3 + 1] = p.y;
    this.smoke.pos[i3 + 2] = p.z;
    this.sLife[i] = 3.0 + this.rand() * 2.5;
    this.sAge[i] = stagger ? this.rand() * this.sLife[i] : 0;
    this.smoke.size[i] = 1.2;
    this.smoke.alpha[i] = 0;
  }

  private initLeaf(i: number, stagger: boolean): void {
    // Spawn within a disc around the village centre, somewhere above the ground.
    const ang = this.rand() * 0.34;
    const az = this.rand() * Math.PI * 2;
    // tangent basis at centre
    const up0 = this.center;
    const t = arbitraryTangent(up0);
    const b = new THREE.Vector3().copy(up0).cross(t).normalize();
    const dir = new THREE.Vector3()
      .copy(up0)
      .multiplyScalar(Math.cos(ang))
      .addScaledVector(t.clone().multiplyScalar(Math.cos(az)).addScaledVector(b, Math.sin(az)), Math.sin(ang))
      .normalize();
    const height = stagger ? 1 + this.rand() * 12 : 9 + this.rand() * 4;
    const p = dir.multiplyScalar(this.radius + height);
    const i3 = i * 3;
    this.leaves.pos[i3] = p.x;
    this.leaves.pos[i3 + 1] = p.y;
    this.leaves.pos[i3 + 2] = p.z;
    this.lVel[i] = 1.2 + this.rand() * 1.0; // fall speed
    this.lSwirl[i * 2] = this.rand() * Math.PI * 2;
    this.lSwirl[i * 2 + 1] = 0.6 + this.rand() * 0.8;
    this.leaves.size[i] = 0.5 + this.rand() * 0.4;
    this.leaves.alpha[i] = 0.95;
  }

  update(dt: number, time: number): void {
    if (this.smokeEnabled) this.updateSmoke(dt);
    this.smoke.points.visible = this.smokeEnabled;
    if (this.leavesEnabled) this.updateLeaves(dt, time);
    this.leaves.points.visible = this.leavesEnabled;
  }

  private updateSmoke(dt: number): void {
    for (let i = 0; i < this.smokeCount; i++) {
      this.sAge[i] += dt;
      if (this.sAge[i] >= this.sLife[i]) {
        this.initSmoke(i, false);
        continue;
      }
      const i3 = i * 3;
      // buoyant rise + gentle outward spread
      this.sVel[i3] += this.sUp[i3] * 0.4 * dt;
      this.sVel[i3 + 1] += this.sUp[i3 + 1] * 0.4 * dt;
      this.sVel[i3 + 2] += this.sUp[i3 + 2] * 0.4 * dt;
      this.smoke.pos[i3] += this.sVel[i3] * dt;
      this.smoke.pos[i3 + 1] += this.sVel[i3 + 1] * dt;
      this.smoke.pos[i3 + 2] += this.sVel[i3 + 2] * dt;
      const f = this.sAge[i] / this.sLife[i];
      this.smoke.size[i] = 1.0 + f * 3.2;
      this.smoke.alpha[i] = Math.min(f / 0.2, 1) * (1 - Math.max((f - 0.5) / 0.5, 0)) * 0.5;
    }
    this.flush(this.smoke);
  }

  private updateLeaves(dt: number, time: number): void {
    const tmp = new THREE.Vector3();
    for (let i = 0; i < this.leafCount; i++) {
      const i3 = i * 3;
      tmp.set(this.leaves.pos[i3], this.leaves.pos[i3 + 1], this.leaves.pos[i3 + 2]);
      const len = tmp.length();
      const up = tmp.clone().multiplyScalar(1 / len);
      const height = len - this.radius;
      if (height <= 0.4) {
        this.initLeaf(i, false);
        continue;
      }
      // tangent swirl
      const t = arbitraryTangent(up);
      const b = up.clone().cross(t);
      const phase = this.lSwirl[i * 2] + time * this.lSwirl[i * 2 + 1];
      const swirl = 0.5;
      this.leaves.pos[i3] += (-up.x * this.lVel[i] + (t.x * Math.cos(phase) + b.x * Math.sin(phase)) * swirl) * dt;
      this.leaves.pos[i3 + 1] += (-up.y * this.lVel[i] + (t.y * Math.cos(phase) + b.y * Math.sin(phase)) * swirl) * dt;
      this.leaves.pos[i3 + 2] += (-up.z * this.lVel[i] + (t.z * Math.cos(phase) + b.z * Math.sin(phase)) * swirl) * dt;
      this.leaves.alpha[i] = Math.min(height / 2, 0.95); // fade as they settle
    }
    this.flush(this.leaves);
  }

  private flush(p: ReturnType<typeof makePoints>): void {
    const g = p.points.geometry;
    (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true;
  }
}

function arbitraryTangent(up: THREE.Vector3): THREE.Vector3 {
  const seed = Math.abs(up.y) < 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  return seed.cross(up).normalize();
}
