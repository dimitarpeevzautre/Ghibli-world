import * as THREE from 'three';

/**
 * Painterly sky dome: a large inward-facing sphere with a soft watercolour gradient
 * (warm horizon -> soft blue zenith) and a few gentle, drifting cloud streaks generated
 * from value noise. No texture assets required.
 */

const skyVertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const skyFragmentShader = /* glsl */ `
  precision highp float;

  uniform vec3 uHorizonColor;
  uniform vec3 uZenithColor;
  uniform vec3 uGroundColor;
  uniform vec3 uCloudColor;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uTime;
  uniform float uCloudAmount;

  varying vec3 vDir;

  // --- cheap value noise / fbm ---
  vec3 hash3(vec3 p) {
    p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
             dot(p, vec3(269.5, 183.3, 246.1)),
             dot(p, vec3(113.5, 271.9, 124.6)));
    return fract(sin(p) * 43758.5453123);
  }
  float noise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = hash3(i + vec3(0,0,0)).x;
    float n100 = hash3(i + vec3(1,0,0)).x;
    float n010 = hash3(i + vec3(0,1,0)).x;
    float n110 = hash3(i + vec3(1,1,0)).x;
    float n001 = hash3(i + vec3(0,0,1)).x;
    float n101 = hash3(i + vec3(1,0,1)).x;
    float n011 = hash3(i + vec3(0,1,1)).x;
    float n111 = hash3(i + vec3(1,1,1)).x;
    return mix(
      mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
      mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
  }
  float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * noise(p);
      p *= 2.02;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 dir = normalize(vDir);
    float h = dir.y; // -1 .. 1, relative to the dome's own axis

    // Vertical gradient: ground haze below, warm horizon band, soft blue above.
    vec3 sky = mix(uHorizonColor, uZenithColor, smoothstep(0.0, 0.55, h));
    sky = mix(sky, uGroundColor, smoothstep(0.0, -0.35, h));

    // Soft sun glow.
    float sun = max(dot(dir, normalize(uSunDir)), 0.0);
    sky += uSunColor * pow(sun, 80.0) * 0.9;          // disc-ish core
    sky += uSunColor * pow(sun, 6.0) * 0.18;          // broad warm glow

    // Drifting watercolour cloud streaks, fading out near the horizon and below it.
    vec3 cloudCoord = dir * 2.2 + vec3(uTime * 0.012, 0.0, uTime * 0.006);
    float clouds = fbm(cloudCoord);
    clouds = smoothstep(0.55, 0.95, clouds) * uCloudAmount;
    clouds *= smoothstep(0.02, 0.35, h);
    sky = mix(sky, uCloudColor, clouds);

    gl_FragColor = vec4(sky, 1.0);
  }
`;

export class SkyDome {
  readonly mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;

  constructor(radius: number) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: skyVertexShader,
      fragmentShader: skyFragmentShader,
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uHorizonColor: { value: new THREE.Color('#f3dcc0') },
        uZenithColor: { value: new THREE.Color('#7fa9d6') },
        uGroundColor: { value: new THREE.Color('#b9c4c2') },
        uCloudColor: { value: new THREE.Color('#fbf6ee') },
        uSunDir: { value: new THREE.Vector3(0.5, 1.0, 0.3).normalize() },
        uSunColor: { value: new THREE.Color('#fff4d8') },
        uTime: { value: 0 },
        uCloudAmount: { value: 0.7 },
      },
    });

    const geometry = new THREE.SphereGeometry(radius, 48, 32);
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.name = 'SkyDome';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
  }

  /** Keep the dome centred on the camera so it always surrounds the viewer. */
  update(time: number, cameraPosition: THREE.Vector3, sunDir: THREE.Vector3): void {
    this.material.uniforms.uTime.value = time;
    this.material.uniforms.uSunDir.value.copy(sunDir);
    this.mesh.position.copy(cameraPosition);
  }

  get uniforms() {
    return this.material.uniforms;
  }
}
