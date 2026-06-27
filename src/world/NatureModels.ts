import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createToonMaterial } from '../render/ToonMaterial';

/**
 * Loads CC0 low-poly nature packs (Quaternius) and turns each model into instancing-ready
 * primitives that match the game's cel-shaded look. Each source GLB holds several variants
 * laid out in a row at 100× scale (e.g. BirchTree_1..5); for every variant we bake its world
 * transform into the geometry, recentre its base to the origin, rescale to a target height, and
 * re-materialise every surface to the ToonMaterial (keeping the model's base-colour texture).
 *
 * The result feeds `VillageLayout`'s instanced fields, so hundreds of trees/rocks/bushes stay a
 * handful of draw calls. Missing files simply yield no variants and the caller falls back to the
 * procedural props, so the game still runs with zero assets.
 */
export interface NaturePrimitive {
  geometry: THREE.BufferGeometry;
  material: THREE.ShaderMaterial;
}
/** One complete model = the primitives (e.g. bark + leaves) that make it up. */
export type NatureVariant = NaturePrimitive[];

export interface NatureSpec {
  name: string; // category key: 'birch' | 'pine' | 'maple' | 'rocks' | 'bushes' | 'grass' | 'flowers'
  url: string;
  targetHeight: number; // world units the model's bounding height is scaled to
}

const FOLIAGE = /leaf|leaves|foliage|petal|flower|plant|grass|bush/i;

export class NatureModels {
  private variants = new Map<string, NatureVariant[]>();
  private loader = new GLTFLoader();

  constructor(private readonly specs: NatureSpec[]) {}

  async preload(): Promise<void> {
    await Promise.all(this.specs.map((s) => this.tryLoad(s)));
  }

  has(name: string): boolean {
    return (this.variants.get(name)?.length ?? 0) > 0;
  }

  /** All prepared variants for a category (empty if the file was missing). */
  get(name: string): NatureVariant[] {
    return this.variants.get(name) ?? [];
  }

  /** Variants of several categories concatenated (e.g. all broadleaf trees together). */
  getMany(names: string[]): NatureVariant[] {
    return names.flatMap((n) => this.get(n));
  }

  private async tryLoad(spec: NatureSpec): Promise<void> {
    try {
      const gltf = await this.loader.loadAsync(spec.url);
      gltf.scene.updateMatrixWorld(true);
      // Variant nodes are the children of the (single) RootNode, or of the scene itself.
      const root = gltf.scene.children.length === 1 ? gltf.scene.children[0] : gltf.scene;
      const nodes = root.children.length ? root.children : [root];

      const out: NatureVariant[] = [];
      for (const node of nodes) {
        const prims = this.extractVariant(node, spec.targetHeight);
        if (prims.length) out.push(prims);
      }
      if (out.length) {
        this.variants.set(spec.name, out);
        console.info(`[nature] "${spec.name}": ${out.length} variant(s) from ${spec.url}`);
      }
    } catch {
      // Expected until assets exist — caller falls back to procedural props.
    }
  }

  /** Bake one variant node's meshes into recentred, rescaled, toon-materialised primitives. */
  private extractVariant(node: THREE.Object3D, targetHeight: number): NaturePrimitive[] {
    const baked: { geometry: THREE.BufferGeometry; material: THREE.ShaderMaterial }[] = [];
    node.updateWorldMatrix(true, true);

    node.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const geometry = mesh.geometry.clone();
      geometry.applyMatrix4(mesh.matrixWorld); // bake the 100× scale + row offset into the geometry
      const src = mesh.material as THREE.MeshStandardMaterial;
      const map = (src && src.map) || null;
      const foliage = FOLIAGE.test(src?.name ?? '');
      const material = createToonMaterial({ color: '#ffffff', map, windStrength: foliage ? 0.5 : 0 });
      baked.push({ geometry, material });
    });
    if (!baked.length) return [];

    // Recentre base to origin (x/z centred, base at y=0) and scale the combined model to height.
    const bbox = new THREE.Box3();
    for (const b of baked) {
      b.geometry.computeBoundingBox();
      bbox.union(b.geometry.boundingBox!);
    }
    const size = new THREE.Vector3();
    bbox.getSize(size);
    const center = new THREE.Vector3();
    bbox.getCenter(center);
    const scale = size.y > 1e-4 ? targetHeight / size.y : 1;
    const recentre = new THREE.Matrix4()
      .makeScale(scale, scale, scale)
      .multiply(new THREE.Matrix4().makeTranslation(-center.x, -bbox.min.y, -center.z));
    for (const b of baked) b.geometry.applyMatrix4(recentre); // uniform scale + translate keeps normals valid

    return baked;
  }
}
