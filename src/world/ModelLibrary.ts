import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createToonMaterial } from '../render/ToonMaterial';
import { outlineHierarchy } from '../render/OutlinePass';

/**
 * Loads optional glTF/GLB models (e.g. AI-generated buildings) and prepares them to match the
 * game's look: every surface is re-materialised to the cel-shaded ToonMaterial (keeping the
 * source albedo colour/texture), an inverted-hull ink outline is added, and the model is
 * normalised so its base sits at y=0, centred on X/Z — exactly what `Planet.placeOnSurface`
 * expects. If a file is missing, the slot simply stays empty and the caller falls back to the
 * procedural prop, so the project runs with zero art and improves as GLBs are dropped in.
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
  private templates = new Map<string, THREE.Object3D>();
  private loader = new GLTFLoader();

  constructor(private readonly specs: ModelSpec[]) {}

  /** Attempt to load every spec; missing/failed files are skipped silently. */
  async preload(): Promise<void> {
    await Promise.all(this.specs.map((s) => this.tryLoad(s)));
  }

  has(name: string): boolean {
    return this.templates.has(name);
  }

  /** A ready-to-place clone of the prepared model, or null if it wasn't loaded. */
  get(name: string): THREE.Object3D | null {
    const t = this.templates.get(name);
    return t ? t.clone(true) : null;
  }

  private async tryLoad(spec: ModelSpec): Promise<void> {
    try {
      const gltf = await this.loader.loadAsync(spec.url);
      this.templates.set(spec.name, this.prepare(gltf.scene, spec));
      console.info(`[models] loaded "${spec.name}" from ${spec.url}`);
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
      mesh.material = createToonMaterial({ color });
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

    outlineHierarchy(wrapper, { thickness: 0.045, color: '#2a2018' });
    return wrapper;
  }
}
