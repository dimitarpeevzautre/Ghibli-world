import * as THREE from 'three';
import GUI from 'lil-gui';

import { Planet } from './core/Planet';
import { Input } from './core/Input';
import { PlayerController } from './core/PlayerController';
import { CameraRig } from './core/CameraRig';
import { SkyDome } from './render/SkyDome';
import { PostFX } from './render/PostFX';
import { VillageLayout } from './world/VillageLayout';
import { NatureModels } from './world/NatureModels';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Effects } from './world/Effects';
import { ModelLibrary } from './world/ModelLibrary';
import { Ambient } from './render/Ambient';
import { updateToonLighting, toonGlobals, applyToonGlobals } from './render/ToonMaterial';
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
renderer.toneMappingExposure = 1.28;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 3000);

const PLANET_RADIUS = 42;
const VILLAGE_CENTER = new THREE.Vector3(0, 1, 0).normalize();
const planet = new Planet(PLANET_RADIUS, VILLAGE_CENTER);
scene.add(planet.group);

const sky = new SkyDome(PLANET_RADIUS * 9);
scene.add(sky.mesh);

const postFX = new PostFX(renderer, scene, camera);
const input = new Input(renderer.domElement);

const ambient = new Ambient();
const startAudio = () => ambient.start();
window.addEventListener('pointerdown', startAudio, { once: true });
window.addEventListener('keydown', startAudio, { once: true });
window.addEventListener('touchstart', startAudio, { once: true });

// Optional GLB models — drop files in public/models/ (served at ./models/<name>.glb). Any that
// load replace the procedural prop; missing ones fall back automatically. See docs/MODELS.md.
const modelLibrary = new ModelLibrary([
  // CC0 Quaternius Medieval Village set (4 house variants + landmarks) → cohesive with the nature.
  { name: 'house', url: './models/house1.glb', targetHeight: 5.5 },
  { name: 'house', url: './models/house2.glb', targetHeight: 5.5 },
  { name: 'house', url: './models/house3.glb', targetHeight: 5.0 },
  { name: 'house', url: './models/house4.glb', targetHeight: 4.8 },
  { name: 'chapel', url: './models/chapel.glb', targetHeight: 11 },
  { name: 'cheshma', url: './models/cheshma.glb', targetHeight: 2.8 },
  { name: 'barn', url: './models/barn.glb', targetHeight: 5.0 },
  { name: 'inn', url: './models/inn.glb', targetHeight: 6.5 },
  { name: 'mill', url: './models/mill.glb', targetHeight: 9.0 },
  // These have no GLB yet → procedural fallback.
  { name: 'gate', url: './models/gate.glb', targetHeight: 3.2 },
  { name: 'cross', url: './models/cross.glb', targetHeight: 2.6 },
  // Decorative village props (scattered through the square for Messenger-like detail).
  { name: 'barrel', url: './models/props/barrel.glb', targetHeight: 1.0 },
  { name: 'crate', url: './models/props/crate.glb', targetHeight: 0.9 },
  { name: 'cart', url: './models/props/cart.glb', targetHeight: 1.5 },
  { name: 'marketstand', url: './models/props/marketstand1.glb', targetHeight: 2.4 },
  { name: 'marketstand', url: './models/props/marketstand2.glb', targetHeight: 2.4 },
  { name: 'bench', url: './models/props/bench1.glb', targetHeight: 0.8 },
  { name: 'bench', url: './models/props/bench2.glb', targetHeight: 0.8 },
  { name: 'bonfire', url: './models/props/bonfire.glb', targetHeight: 1.0 },
  { name: 'gazebo', url: './models/props/gazebo.glb', targetHeight: 3.2 },
]);

// CC0 low-poly nature (Quaternius) — real trees/rocks/bushes that replace the procedural ones.
const natureModels = new NatureModels([
  { name: 'birch', url: './models/nature/tree-birch.glb', targetHeight: 5.5 },
  { name: 'maple', url: './models/nature/tree-maple.glb', targetHeight: 5.0 },
  { name: 'pine', url: './models/nature/tree-pine.glb', targetHeight: 6.0 },
  { name: 'rocks', url: './models/nature/rocks.glb', targetHeight: 1.8 },
  { name: 'bushes', url: './models/nature/bushes.glb', targetHeight: 1.1 },
  { name: 'grass', url: './models/nature/grass.glb', targetHeight: 0.7 },
  { name: 'flowers', url: './models/nature/flowers.glb', targetHeight: 0.6 },
]);

// ---------------------------------------------------------------------------
// Shadow-casting sun (the toon shader does its own shading; this only renders a
// directional shadow map sampled via getShadowMask(), and follows the player).
// ---------------------------------------------------------------------------
const sunLight = new THREE.DirectionalLight(0xffffff, 1.0);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
sunLight.shadow.camera.near = 1;
sunLight.shadow.camera.far = 260;
sunLight.shadow.camera.left = -48;
sunLight.shadow.camera.right = 48;
sunLight.shadow.camera.top = 48;
sunLight.shadow.camera.bottom = -48;
sunLight.shadow.bias = -0.0004;
sunLight.shadow.normalBias = 0.7;
scene.add(sunLight);
scene.add(sunLight.target);

function flagShadows(): void {
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!(m as THREE.Mesh).isMesh && !(m as THREE.InstancedMesh).isInstancedMesh) return;
    if (o.name.endsWith('__outline') || o.name === 'SkyDome') {
      m.castShadow = false;
      m.receiveShadow = false;
    } else if (o.name === 'PlanetSurface') {
      m.castShadow = false; // the globe only receives
      m.receiveShadow = true;
    } else {
      m.castShadow = true;
      m.receiveShadow = true;
    }
  });
}

// ---------------------------------------------------------------------------
// Sun / atmosphere state (drives both the toon shading and the sky)
// ---------------------------------------------------------------------------
const atmosphere = {
  sunAzimuth: 0.7,
  sunElevation: 0.98,           // higher, brighter sun for a clear cheerful midday
  lightColor: new THREE.Color('#fff2d4'),
  ambient: new THREE.Color('#aebbc8'),  // bright, slightly warm sky-bounce fill so shadows aren't muddy
  fogColor: new THREE.Color('#d9e8f2'),
  fogNear: 130,
  fogFar: 340,
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
// lil-gui — live tuning (folders not depending on the world are built up front)
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
// World build + loop (after optional models finish loading)
// ---------------------------------------------------------------------------
async function init(): Promise<void> {
  await Promise.all([modelLibrary.preload(), natureModels.preload()]);

  const village = new VillageLayout(planet, VILLAGE_CENTER, modelLibrary, natureModels);
  scene.add(village.group);

  // Spawn on open ground just outside the village, looking in across the square toward the
  // landscape — a nicer first view than starting on top of the fountain.
  const spawnDir = new THREE.Vector3(0, Math.cos(0.46), Math.sin(0.46)).normalize();
  const player = new PlayerController(planet, spawnDir);
  planet.tangentToward(player.up, VILLAGE_CENTER, player.forward); // face the village
  player.obstacles = village.obstacles;
  scene.add(player.root);

  // Swap the placeholder capsule for a real animated villager (CC0). Falls back silently.
  try {
    const farmer = await new GLTFLoader().loadAsync('./models/farmer.glb');
    player.setCharacter(farmer);
  } catch {
    /* keep the procedural capsule if the model is missing */
  }

  const cameraRig = new CameraRig(camera, player);
  cameraRig.colliders = village.colliders;
  cameraRig.distance = 14;
  cameraRig.height = 6.5;

  const effects = new Effects(village.chimneys, VILLAGE_CENTER, PLANET_RADIUS);
  scene.add(effects.group);

  const fLife = gui.addFolder('Life & sound');
  fLife.add(effects, 'smokeEnabled').name('chimney smoke');
  fLife.add(effects, 'leavesEnabled').name('falling leaves');
  fLife.add(ambient, 'enabled').name('ambient wind').onChange((v: boolean) => ambient.setEnabled(v));
  fLife.add(ambient, 'volume', 0, 1, 0.01).name('wind volume');

  const fPlayer = gui.addFolder('Player & camera');
  fPlayer.add(player, 'walkSpeed', 2, 20, 0.5);
  fPlayer.add(player, 'runMultiplier', 1, 3, 0.1);
  fPlayer.add(cameraRig, 'distance', 6, 24, 0.5).listen();
  fPlayer.add(cameraRig, 'height', 1, 12, 0.5);
  fPlayer.close();

  flagShadows();
  scene.updateMatrixWorld(true);

  const clock = new THREE.Clock();
  let elapsed = 0;

  function tick(): void {
    const dt = Math.min(clock.getDelta(), 0.05);
    elapsed += dt;

    const mouse = input.consumeMouseDelta();
    const wheel = input.consumeWheel();

    player.update(dt, input, mouse.x);
    cameraRig.update(dt, mouse.y, wheel, input.lookActive);

    // Keep the shadow map centred on the player, lit from the sun direction.
    sunLight.target.position.copy(player.position);
    sunLight.position.copy(player.position).addScaledVector(sunDir, 90);
    sunLight.target.updateMatrixWorld();

    updateToonLighting({
      lightDir: sunDir,
      lightColor: atmosphere.lightColor,
      ambient: atmosphere.ambient,
      fogColor: atmosphere.fogColor,
      fogNear: atmosphere.fogNear,
      fogFar: atmosphere.fogFar,
      time: elapsed,
    });

    effects.update(dt, elapsed);
    sky.update(elapsed, camera.position, sunDir);
    postFX.render(dt, elapsed);

    requestAnimationFrame(tick);
  }

  const loader = document.getElementById('loader');
  if (loader) loader.classList.add('hidden');
  tick();
}

void init();
