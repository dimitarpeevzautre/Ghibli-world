import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/**
 * Subtle hand-painted finishing pass: paper-grain overlay, gentle warm colour grade and
 * a soft vignette. Kept deliberately light so it sells "watercolour on paper" without
 * muddying the cel shading underneath.
 */
const PaperGrainShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uGrain: { value: 0.04 },
    uVignette: { value: 0.22 },
    uWarmth: { value: 0.03 },
    uSaturation: { value: 1.18 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec2 uResolution;
    uniform float uGrain;
    uniform float uVignette;
    uniform float uWarmth;
    uniform float uSaturation;
    varying vec2 vUv;

    float rand(vec2 co) {
      return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec3 color = texture2D(tDiffuse, vUv).rgb;

      // Desaturate slightly toward a warm, faded palette.
      float luma = dot(color, vec3(0.299, 0.587, 0.114));
      color = mix(vec3(luma), color, uSaturation);
      color += vec3(uWarmth, uWarmth * 0.4, -uWarmth * 0.6);

      // Paper grain: static-ish speckle that drifts very slowly.
      vec2 grainUv = vUv * uResolution / 2.0;
      float g = rand(grainUv + fract(uTime * 0.05));
      color += (g - 0.5) * uGrain;

      // Soft vignette.
      vec2 d = vUv - 0.5;
      float vig = smoothstep(0.85, 0.2, dot(d, d) * 2.4);
      color *= mix(1.0, vig, uVignette);

      gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
    }
  `,
};

export class PostFX {
  readonly composer: EffectComposer;
  readonly grainPass: ShaderPass;
  enabled = true;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));

    this.grainPass = new ShaderPass(PaperGrainShader);
    this.composer.addPass(this.grainPass);

    // OutputPass performs tone mapping + linear->sRGB once, at the very end.
    this.composer.addPass(new OutputPass());

    this.setSize(renderer.domElement.width, renderer.domElement.height);
  }

  setSize(width: number, height: number): void {
    this.composer.setSize(width, height);
    this.grainPass.uniforms.uResolution.value.set(width, height);
  }

  render(dt: number, time: number): void {
    this.grainPass.uniforms.uTime.value = time;
    this.grainPass.enabled = this.enabled;
    this.composer.render(dt);
  }
}
