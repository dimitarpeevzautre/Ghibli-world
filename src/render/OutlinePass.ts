import * as THREE from 'three';

/**
 * Inverted-hull ink outline.
 *
 * For a "hero" mesh we render a back-faced copy of its geometry, pushed outward along the
 * vertex normals by a fixed (view-independent) thickness, in a warm near-black. Because we
 * cull front faces and keep depth testing on, the silhouette pokes out around the real mesh
 * as a clean ink line that wraps the whole planet's worth of props.
 */

const outlineVertexShader = /* glsl */ `
  uniform float uThickness;
  void main() {
    vec3 inflated = position + normalize(normal) * uThickness;
    #ifdef USE_INSTANCING
      inflated = (instanceMatrix * vec4(inflated, 1.0)).xyz;
    #endif
    gl_Position = projectionMatrix * modelViewMatrix * vec4(inflated, 1.0);
  }
`;

const outlineFragmentShader = /* glsl */ `
  precision highp float;
  uniform vec3 uColor;
  void main() {
    gl_FragColor = vec4(uColor, 1.0);
  }
`;

export interface OutlineOptions {
  thickness?: number;
  color?: THREE.ColorRepresentation;
}

const outlineMaterials = new Set<THREE.ShaderMaterial>();

/**
 * Returns a child outline mesh sharing the source geometry. Add it as a sibling/child so it
 * tracks the source transform. Safe to call on a mesh that is later instanced? No — for
 * InstancedMesh use `makeOutlineMaterial` directly on a second InstancedMesh.
 */
export function makeOutlineMaterial(options: OutlineOptions = {}): THREE.ShaderMaterial {
  const material = new THREE.ShaderMaterial({
    vertexShader: outlineVertexShader,
    fragmentShader: outlineFragmentShader,
    uniforms: {
      uThickness: { value: options.thickness ?? 0.04 },
      uColor: { value: new THREE.Color(options.color ?? '#2b211c') },
    },
    side: THREE.BackSide,
  });
  outlineMaterials.add(material);
  return material;
}

/** Add an inverted-hull outline as a child of `mesh`, returning the outline mesh. */
export function addOutline(mesh: THREE.Mesh, options: OutlineOptions = {}): THREE.Mesh {
  const outline = new THREE.Mesh(mesh.geometry, makeOutlineMaterial(options));
  outline.name = `${mesh.name || 'mesh'}__outline`;
  // The outline lives in the parent's space already (shares the mesh's transform via child).
  mesh.add(outline);
  return outline;
}

/** Recursively give every Mesh under `root` an inverted-hull outline. */
export function outlineHierarchy(root: THREE.Object3D, options: OutlineOptions = {}): void {
  const meshes: THREE.Mesh[] = [];
  root.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh && !obj.name.endsWith('__outline')) {
      meshes.push(obj as THREE.Mesh);
    }
  });
  for (const mesh of meshes) addOutline(mesh, options);
}

export function setOutlineThickness(thickness: number): void {
  for (const m of outlineMaterials) m.uniforms.uThickness.value = thickness;
}

export function setOutlineColor(color: THREE.ColorRepresentation): void {
  for (const m of outlineMaterials) (m.uniforms.uColor.value as THREE.Color).set(color);
}
