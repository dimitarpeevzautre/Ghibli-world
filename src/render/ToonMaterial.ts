import * as THREE from 'three';

/**
 * Ghibli cel-shading material.
 *
 * Implemented as a raw THREE.ShaderMaterial (GLSL) rather than MeshToonMaterial so
 * we have full control over the banding ramp, warm-shifted shadows and Fresnel rim.
 *
 * We deliberately do NOT plug into three's built-in lighting system: the planet is lit
 * by a single sun, so we feed the sun direction/colour as plain world-space uniforms.
 * That keeps everything in world space (no view-space normal gymnastics) and trivially
 * tunable from lil-gui. A module-level registry lets `updateToonLighting()` push the
 * current sun state to every material once per frame.
 */

export interface ToonMaterialOptions {
  color?: THREE.ColorRepresentation;
  /** Number of discrete shading bands (2–4 reads as hand-painted). */
  bands?: number;
  /** Warm tint multiplied into shadowed areas. */
  shadowTint?: THREE.ColorRepresentation;
  /** How dark the deepest shadow band gets (0 = black, 1 = no shadow). */
  shadowStrength?: number;
  rimColor?: THREE.ColorRepresentation;
  rimStrength?: number;
  /** Fresnel falloff for the rim; higher = thinner rim. */
  rimPower?: number;
  /** Wind sway amount for foliage (0 = rigid; buildings leave this at 0). */
  windStrength?: number;
}

export interface ToonGlobals {
  bands: number;
  shadowTint: THREE.Color;
  rimColor: THREE.Color;
  rimStrength: number;
}

const registry = new Set<THREE.ShaderMaterial>();

// Shared, lil-gui-tunable globals. Individual materials read these defaults at update time
// unless they were created with an explicit override.
export const toonGlobals: ToonGlobals = {
  bands: 3,
  shadowTint: new THREE.Color('#6a5a78'),
  rimColor: new THREE.Color('#fff3d6'),
  rimStrength: 0.5,
};

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uWindStrength;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;

  void main() {
    vec3 transformed = position;
    vec3 objNormal = normal;

    // Gentle wind sway in object space (base stays put, tops sway). Buildings use 0 strength.
    if (uWindStrength > 0.0) {
      float h = max(position.y, 0.0);
      float phase = uTime * 1.6;
      transformed.x += sin(phase) * uWindStrength * h * 0.08;
      transformed.z += cos(phase * 0.83) * uWindStrength * h * 0.08;
    }

    // ShaderMaterial gets the instanceMatrix attribute + USE_INSTANCING define for free.
    #ifdef USE_INSTANCING
      transformed = (instanceMatrix * vec4(transformed, 1.0)).xyz;
      objNormal = mat3(instanceMatrix) * objNormal;
    #endif
    vec4 worldPosition = modelMatrix * vec4(transformed, 1.0);
    vWorldPosition = worldPosition.xyz;
    // Assumes (near-)uniform scale, which all our props use.
    vWorldNormal = normalize(mat3(modelMatrix) * objNormal);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;

  uniform vec3 uBaseColor;
  uniform vec3 uLightDir;      // world-space direction TOWARD the sun
  uniform vec3 uLightColor;
  uniform vec3 uAmbient;       // sky/ground bounce
  uniform vec3 uShadowTint;
  uniform float uShadowStrength;
  uniform float uBands;
  uniform vec3 uRimColor;
  uniform float uRimStrength;
  uniform float uRimPower;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;

  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;

  // Quantize a 0..1 value into N bands with soft edges so the steps don't crawl/alias.
  float banded(float x, float bands) {
    float scaled = x * bands;
    float lower = floor(scaled);
    float frac = scaled - lower;
    // Soft step across each band boundary.
    float soft = smoothstep(0.35, 0.65, frac);
    return clamp((lower + soft) / bands, 0.0, 1.0);
  }

  void main() {
    vec3 N = normalize(vWorldNormal);
    vec3 L = normalize(uLightDir);
    vec3 V = normalize(cameraPosition - vWorldPosition);

    // Wrapped, banded diffuse.
    float ndl = dot(N, L) * 0.5 + 0.5;       // wrap lighting -> softer terminator
    float lit = banded(ndl, max(1.0, uBands));

    // Warm-shifted shadow: lerp from a tinted dark colour up to full base colour.
    vec3 shadowColor = uBaseColor * uShadowTint * uShadowStrength;
    vec3 diffuse = mix(shadowColor, uBaseColor, lit);
    vec3 color = diffuse * (uAmbient + uLightColor * lit);

    // Fresnel rim light to lift silhouettes off the sky.
    float fresnel = pow(1.0 - max(dot(N, V), 0.0), uRimPower);
    float rim = fresnel * smoothstep(0.0, 0.3, ndl) * uRimStrength;
    color += uRimColor * rim;

    // Distance fog matched to the sky so the far side of the planet melts away softly.
    float depth = length(cameraPosition - vWorldPosition);
    float fogFactor = smoothstep(uFogNear, uFogFar, depth);
    color = mix(color, uFogColor, fogFactor);

    // Output linear; the composer's OutputPass handles sRGB encoding once at the end.
    gl_FragColor = vec4(color, 1.0);
  }
`;

export function createToonMaterial(options: ToonMaterialOptions = {}): THREE.ShaderMaterial {
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uBaseColor: { value: new THREE.Color(options.color ?? '#c8b8a0') },
      uLightDir: { value: new THREE.Vector3(0.5, 1.0, 0.3).normalize() },
      uLightColor: { value: new THREE.Color('#fff1d8') },
      uAmbient: { value: new THREE.Color('#5b6b85') },
      uShadowTint: { value: new THREE.Color(options.shadowTint ?? toonGlobals.shadowTint) },
      uShadowStrength: { value: options.shadowStrength ?? 0.55 },
      uBands: { value: options.bands ?? toonGlobals.bands },
      uRimColor: { value: new THREE.Color(options.rimColor ?? toonGlobals.rimColor) },
      uRimStrength: { value: options.rimStrength ?? toonGlobals.rimStrength },
      uRimPower: { value: options.rimPower ?? 3.0 },
      uFogColor: { value: new THREE.Color('#cfe0ec') },
      uFogNear: { value: 90 },
      uFogFar: { value: 240 },
      uTime: { value: 0 },
      uWindStrength: { value: options.windStrength ?? 0 },
    },
  });
  registry.add(material);
  return material;
}

/** Push the current sun + atmosphere state to every toon material. Call once per frame. */
export function updateToonLighting(params: {
  lightDir: THREE.Vector3;
  lightColor: THREE.Color;
  ambient: THREE.Color;
  fogColor: THREE.Color;
  fogNear: number;
  fogFar: number;
  time: number;
}): void {
  for (const material of registry) {
    const u = material.uniforms;
    u.uLightDir.value.copy(params.lightDir);
    u.uLightColor.value.copy(params.lightColor);
    u.uAmbient.value.copy(params.ambient);
    u.uFogColor.value.copy(params.fogColor);
    u.uFogNear.value = params.fogNear;
    u.uFogFar.value = params.fogFar;
    u.uTime.value = params.time;
  }
}

/** Apply lil-gui global tweaks (band count / rim) to all live materials. */
export function applyToonGlobals(): void {
  for (const material of registry) {
    material.uniforms.uBands.value = toonGlobals.bands;
    material.uniforms.uShadowTint.value.copy(toonGlobals.shadowTint);
    material.uniforms.uRimColor.value.copy(toonGlobals.rimColor);
    material.uniforms.uRimStrength.value = toonGlobals.rimStrength;
  }
}
