import * as THREE from 'three';
import GUI from 'lil-gui';

import { Planet } from './core/Planet';
import { Input } from './core/Input';
import { PlayerController } from './core/PlayerController';
import { CameraRig } from './core/CameraRig';
import { SkyDome } from './render/SkyDome';
import { PostFX } from './render/PostFX';
import { VillageLayout } from './world/VillageLayout';
import {
  updateToonLighting,
  toonGlobals,
  applyToonGlobals,
} from './render/ToonMaterial';
import { setOutlineThickness, setOutlineColor } from './render/OutlinePass';

// ---------------------------------------------------------------------------
// Renderer + scene
// ---------------------------------------------------------------------------
const container = document.getElementById('app')!;
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  55,
  window.innerWidth / window.innerHeight,
  0.1,
  3000,
);

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------
const PLANET_RADIUS = 42;
const planet = new Planet(PLANET_RADIUS);
scene.add(planet.group);

const village = new VillageLayout(planet, new THREE.Vector3(0, 1, 0).normalize());
scene.add(village.group);

const player = new PlayerController(planet, new THREE.Vector3(0.0, 1.0, 0.06).normalize());
// Face the village square at spawn so the opening shot looks inward toward the чешма.
planet.tangentToward(player.up, new THREE.Vector3(0, 1, 0), player.forward);
scene.add(player.root);

const input = new Input(renderer.domElement);
const cameraRig = new CameraRig(camera, player);

const sky = new SkyDome(PLANET_RADIUS * 9);
scene.add(sky.mesh);

const postFX = new PostFX(renderer, scene, camera);

// ---------------------------------------------------------------------------
// Sun / atmosphere state (drives both the toon shading and the sky)
// ---------------------------------------------------------------------------
const atmosphere = {
  sunAzimuth: 0.7,
  sunElevation: 0.9,
  lightColor: new THREE.Color('#fff1d6'),
  ambient: new THREE.Color('#5d6f8c'),
  fogColor: new THREE.Color('#cfe0ec'),
  fogNear: 110,
  fogFar: 300,
};

const sunDir = new THREE.Vector3();
function updateSunDir(): void {
  const e = atmosphere.sunElevation;
  const a = atmosphere.sunAzimuth;
  const horiz = Math.cos(e);
  sunDir.set(Math.cos(a) * horiz, Math.sin(e), Math.sin(a) * horiz).normalize();
}
updateSunDir();

// ---------------------------------------------------------------------------
// lil-gui — live tuning
// ---------------------------------------------------------------------------
const gui = new GUI({ title: 'Село — tuning' });
gui.close();

const fToon = gui.addFolder('Cel shading');
fToon.add(toonGlobals, 'bands', 1, 5, 1).onChange(applyToonGlobals);
fToon.add(toonGlobals, 'rimStrength', 0, 2, 0.01).onChange(applyToonGlobals);
fToon.addColor({ shadow: '#' + toonGlobals.shadowTint.getHexString() }, 'shadow').onChange((v: string) => {
  toonGlobals.shadowTint.set(v);
  applyToonGlobals();
});
fToon.addColor({ rim: '#' + toonGlobals.rimColor.getHexString() }, 'rim').onChange((v: string) => {
  toonGlobals.rimColor.set(v);
  applyToonGlobals();
});

const fOutline = gui.addFolder('Ink outlines');
const outlineState = { thickness: 0.045, color: '#2a2018' };
fOutline.add(outlineState, 'thickness', 0, 0.2, 0.005).onChange((v: number) => setOutlineThickness(v));
fOutline.addColor(outlineState, 'color').onChange((v: string) => setOutlineColor(v));

const fSun = gui.addFolder('Sun & atmosphere');
fSun.add(atmosphere, 'sunAzimuth', 0, Math.PI * 2, 0.01).onChange(updateSunDir);
fSun.add(atmosphere, 'sunElevation', -0.2, Math.PI / 2, 0.01).onChange(updateSunDir);
fSun.addColor({ light: '#' + atmosphere.lightColor.getHexString() }, 'light').onChange((v: string) =>
  atmosphere.lightColor.set(v),
);
fSun.addColor({ ambient: '#' + atmosphere.ambient.getHexString() }, 'ambient').onChange((v: string) =>
  atmosphere.ambient.set(v),
);
fSun.add(atmosphere, 'fogNear', 0, 400, 1);
fSun.add(atmosphere, 'fogFar', 50, 800, 1);

const fSky = gui.addFolder('Sky');
fSky.add(sky.uniforms.uCloudAmount, 'value', 0, 1.5, 0.01).name('clouds');
fSky.addColor({ horizon: '#' + (sky.uniforms.uHorizonColor.value as THREE.Color).getHexString() }, 'horizon')
  .onChange((v: string) => (sky.uniforms.uHorizonColor.value as THREE.Color).set(v));
fSky.addColor({ zenith: '#' + (sky.uniforms.uZenithColor.value as THREE.Color).getHexString() }, 'zenith')
  .onChange((v: string) => (sky.uniforms.uZenithColor.value as THREE.Color).set(v));

const fPost = gui.addFolder('Paper / grade');
fPost.add(postFX, 'enabled').name('grain pass');
fPost.add(postFX.grainPass.uniforms.uGrain, 'value', 0, 0.25, 0.005).name('grain');
fPost.add(postFX.grainPass.uniforms.uVignette, 'value', 0, 1, 0.01).name('vignette');
fPost.add(postFX.grainPass.uniforms.uSaturation, 'value', 0.5, 1.2, 0.01).name('saturation');
fPost.add(postFX.grainPass.uniforms.uWarmth, 'value', -0.1, 0.2, 0.005).name('warmth');

const fPlayer = gui.addFolder('Player & camera');
fPlayer.add(player, 'walkSpeed', 2, 20, 0.5);
fPlayer.add(player, 'runMultiplier', 1, 3, 0.1);
fPlayer.add(cameraRig, 'distance', 6, 24, 0.5).listen();
fPlayer.add(cameraRig, 'height', 1, 12, 0.5);
fPlayer.close();

// Note: props ship with individually-tuned outline widths; the slider above overrides them
// globally only once the user drags it.

// ---------------------------------------------------------------------------
// Resize
// ---------------------------------------------------------------------------
window.addEventListener('resize', () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  postFX.setSize(renderer.domElement.width, renderer.domElement.height);
});

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();
let elapsed = 0;

function tick(): void {
  const dt = Math.min(clock.getDelta(), 0.05); // clamp big stalls
  elapsed += dt;

  const mouse = input.consumeMouseDelta();
  const wheel = input.consumeWheel();

  player.update(dt, input, mouse.x);
  cameraRig.update(dt, mouse.y, wheel, input.lookActive);

  updateToonLighting({
    lightDir: sunDir,
    lightColor: atmosphere.lightColor,
    ambient: atmosphere.ambient,
    fogColor: atmosphere.fogColor,
    fogNear: atmosphere.fogNear,
    fogFar: atmosphere.fogFar,
  });

  sky.update(elapsed, camera.position, sunDir);

  postFX.render(dt, elapsed);

  requestAnimationFrame(tick);
}

// Hide the loader once the first frame is ready.
requestAnimationFrame(() => {
  const loader = document.getElementById('loader');
  if (loader) loader.classList.add('hidden');
  tick();
});
