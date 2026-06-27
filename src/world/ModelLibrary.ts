import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createToonMaterial } from '../render/ToonMaterial';
import { addOutline } from '../render/OutlinePass';

/**
 * Loads optional glTF/GLB models (e.g. CC0 village buildings) and prepares them to match the
 * game's look: every surface is re-materialised to the cel-shaded ToonMaterial (keeping the
 * source albedo colour AND texture), an inverted-hull ink outline is added, and the model is
 * normalised so its base sits at y=0, centred on X/Z — exactly what `Planet.placeOnSurface`
 * expects. Missing files leave the slot empty and the caller falls back to the procedural prop.
 *
 * Several specs may share a `name` (e.g. four `house` variants); `get(name)` then hands them out
 * round-robin, so the village gets variety while staying deterministic (placement order is fixed).
 *
 * Drop files in `public/models/` (served at `./models/<name>.glb`).
 */
export interface ModelSpec {
  name: string;
  url: string;
  /** If set, uniformly scale the model so its height matches this many world units. */
  targetHeight?: number;
}

export class ModelLibrary {
  private variants = new Map<string, THREE.Object3D[]>();
  private counters = new Map<string, number>();
  private loader = new GLTFLoader();

  constructor(private readonly specs: ModelSpec[]) {}

  /** Attempt to load every spec; missing/failed files are skipped silently. */
  async preload(): Promise<void> {
    await Promise.all(this.specs.map((s) => this.tryLoad(s)));
  }

  has(name: string): boolean {
    return (this.variants.get(name)?.length ?? 0) > 0;
  }

  /** A ready-to-place clone of the next variant for `name` (round-robin), or null if none loaded. */
  get(name: string): THREE.Object3D | null {
    const list = this.variants.get(name);
    if (!list || list.length === 0) return null;
    const i = (this.counters.get(name) ?? 0) % list.length;
    this.counters.set(name, i + 1);
    return list[i].clone(true);
  }

  private async tryLoad(spec: ModelSpec): Promise<void> {
    try {
      const gltf = await this.loader.loadAsync(spec.url);
      const prepared = this.prepare(gltf.scene, spec);
      const list = this.variants.get(spec.name) ?? [];
      list.push(prepared);
      this.variants.set(spec.name, list);
      console.info(`[models] loaded "${spec.name}" variant from ${spec.url}`);
    } catch {
      // Expected until art exists — fall back to the procedural prop.
    }
  }

  /** Re-material to toon + outline, recentre base to origin, optional scale, compute footprint. */
  private prepare(model: THREE.Object3D, spec: ModelSpec): THREE.Object3D {
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const src = mesh.material as THREE.MeshStandardMaterial | undefined;
      const color = src && src.color ? '#' + src.color.getHexString() : '#c8b8a0';
      mesh.material = createToonMaterial({ color, map: src?.map ?? null });
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });

    // Normalise placement: a wrapper is what gets placed (placeOnSurface overwrites .position),
    // while the inner model carries the centring offset + scale.
    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    const scale = spec.targetHeight && size.y > 1e-4 ? spec.targetHeight / size.y : 1;
    model.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
    model.scale.multiplyScalar(scale);

    const wrapper = new THREE.Group();
    wrapper.name = `model:${spec.name}`;
    wrapper.add(model);
    wrapper.userData.footprint = Math.max(size.x, size.z) * 0.5 * scale + 0.15;

    // Ink outline at a CONSTANT world thickness. addOutline extrudes in each mesh's local space,
    // so divide by that mesh's accumulated world scale — otherwise large-scaled models (e.g. the
    // windmill, scaled up from small native units) get a huge black inverted-hull shell.
    wrapper.updateMatrixWorld(true);
    const ws = new THREE.Vector3();
    const meshes: THREE.Mesh[] = [];
    wrapper.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !m.name.endsWith('__outline')) meshes.push(m);
    });
    for (const mesh of meshes) {
      mesh.getWorldScale(ws);
      const s = Math.max(ws.x, ws.y, ws.z) || 1;
      addOutline(mesh, { thickness: 0.05 / s, color: '#2a2018' });
    }
    return wrapper;
  }
}
