import * as THREE from 'three';
import GUI from 'lil-gui';

import { Planet } from './core/Planet';
import { Input } from './core/Input';
import { PlayerController } from './core/PlayerController';
import { CameraRig } from './core/CameraRig';
import { SkyDome } from './render/SkyDome';
import { PostFX } from './render/PostFX';
import { VillageLayout } from './world/VillageLayout';
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
  { name: 'house', url: './models/house.glb', targetHeight: 6.5 },
  { name: 'chapel', url: './models/chapel.glb', targetHeight: 10 },
  { name: 'cheshma', url: './models/cheshma.glb', targetHeight: 3.2 },
  { name: 'barn', url: './models/barn.glb', targetHeight: 4.5 },
  { name: 'gate', url: './models/gate.glb', targetHeight: 3.2 },
  { name: 'cross', url: './models/cross.glb', targetHeight: 2.6 },
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
  ambient: new THREE.Color('#9fb2cc'),  // bright sky-bounce fill so shadows aren't muddy
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
  await modelLibrary.preload();

  const village = new VillageLayout(planet, VILLAGE_CENTER, modelLibrary);
  scene.add(village.group);

  const player = new PlayerController(planet, new THREE.Vector3(0.0, 1.0, 0.06).normalize());
  planet.tangentToward(player.up, new THREE.Vector3(0, 1, 0), player.forward); // face the square
  player.obstacles = village.obstacles;
  scene.add(player.root);

  const cameraRig = new CameraRig(camera, player);
  cameraRig.colliders = village.colliders;

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
  const OVERVIEW = new URLSearchParams(location.search).has('overview'); // diagnostic far camera

  function tick(): void {
    const dt = Math.min(clock.getDelta(), 0.05);
    elapsed += dt;

    const mouse = input.consumeMouseDelta();
    const wheel = input.consumeWheel();

    player.update(dt, input, mouse.x);
    if (OVERVIEW) {
      const a = parseFloat(new URLSearchParams(location.search).get('a') ?? '2.2');
      const el = parseFloat(new URLSearchParams(location.search).get('el') ?? '0.6');
      const R = 135;
      camera.position.set(Math.cos(a) * Math.cos(el) * R, Math.sin(el) * R, Math.sin(a) * Math.cos(el) * R);
      camera.up.set(0, 1, 0);
      camera.lookAt(0, 0, 0);
    } else {
      cameraRig.update(dt, mouse.y, wheel, input.lookActive);
    }

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
