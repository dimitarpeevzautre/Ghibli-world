import * as THREE from 'three';
import { createToonMaterial, ToonMaterialOptions } from '../../render/ToonMaterial';
import { outlineHierarchy } from '../../render/OutlinePass';

/**
 * Village prop factories. Everything is built from Three.js primitives as Bulgarian-Revival
 * stand-ins (terracotta roofs, whitewashed plaster, timber overhangs, stone fountains) so the
 * world reads correctly before real GLB models are swapped in. Each prop is built with its
 * base at y = 0 growing along +Y, so `Planet.placeOnSurface` aligns it to the surface normal.
 */

// --- shared palette (warm, slightly desaturated Ghibli) ---
export const palette = {
  plaster: '#e9e2d0',
  plasterWarm: '#e7d6b8',
  stone: '#9c958a',
  stoneDark: '#7d756a',
  timber: '#7a5436',
  timberDark: '#5b3d27',
  roof: '#b5562f',
  roofAlt: '#a8492a',
  trunk: '#6b4a30',
  leafA: '#6f8f4a',
  leafB: '#5d7d3e',
  leafCypress: '#46663a',
  geranium: '#c83b2f',
  hay: '#cba649',
  wood: '#7c5a3a',
  window: '#33414d',
  ink: '#2a2018',
} as const;

function mat(color: string, opts: Partial<ToonMaterialOptions> = {}): THREE.ShaderMaterial {
  return createToonMaterial({ color, shadowStrength: 0.55, rimStrength: 0.3, ...opts });
}

function box(
  w: number,
  h: number,
  d: number,
  color: string,
  opts?: Partial<ToonMaterialOptions>,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, opts));
  return m;
}

let rngState = 1337;
/** Deterministic RNG so the village is identical on every load. */
export function rand(): number {
  rngState = (rngState * 1664525 + 1013904223) >>> 0;
  return rngState / 0xffffffff;
}
export function setSeed(seed: number): void {
  rngState = seed >>> 0;
}
export function randRange(a: number, b: number): number {
  return a + (b - a) * rand();
}

/**
 * A Revival house: stone/plaster ground floor, an overhanging timber upper storey (чардак),
 * a deep terracotta hip roof, shutters, a door and a chimney.
 */
export function createHouse(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'House';

  const w = randRange(3.4, 4.6);
  const d = randRange(3.0, 4.0);
  const groundH = randRange(2.0, 2.6);
  const upperH = randRange(1.8, 2.3);
  const overhang = 0.45;

  const plasterColor = rand() > 0.5 ? palette.plaster : palette.plasterWarm;
  const roofColor = rand() > 0.5 ? palette.roof : palette.roofAlt;

  // Ground floor (stone or whitewashed plaster).
  const ground = box(w, groundH, d, rand() > 0.6 ? palette.stone : plasterColor);
  ground.position.y = groundH / 2;
  g.add(ground);

  // Overhanging timber upper storey.
  const upper = box(w + overhang * 2, upperH, d + overhang * 2, palette.plaster);
  upper.position.y = groundH + upperH / 2;
  g.add(upper);

  // Timber framing hints on the upper storey (corner posts).
  const postT = 0.18;
  const uw = w + overhang * 2;
  const ud = d + overhang * 2;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const post = box(postT, upperH, postT, palette.timber);
      post.position.set((sx * uw) / 2, groundH + upperH / 2, (sz * ud) / 2);
      g.add(post);
    }
  }
  // a mid timber band
  const band = box(uw, 0.16, ud, palette.timberDark);
  band.position.y = groundH + upperH * 0.55;
  g.add(band);

  // Deep terracotta hip roof (4-sided pyramid, oversized for deep eaves).
  const roofH = randRange(1.4, 1.9);
  const roofRadius = Math.hypot(uw, ud) / 2 + 0.5;
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(roofRadius, roofH, 4),
    mat(roofColor, { shadowStrength: 0.5 }),
  );
  roof.rotation.y = Math.PI / 4; // align flat faces to walls
  roof.position.y = groundH + upperH + roofH / 2;
  g.add(roof);

  // Chimney.
  const chimney = box(0.5, 1.0, 0.5, palette.stoneDark);
  chimney.position.set(uw * 0.2, groundH + upperH + roofH * 0.6, ud * 0.1);
  g.add(chimney);

  // Door.
  const door = box(0.9, 1.6, 0.12, palette.timberDark);
  door.position.set(0, 0.8, d / 2 + 0.02);
  g.add(door);

  // Windows + shutters on the upper storey, front face.
  for (const sx of [-1, 1]) {
    const win = box(0.7, 0.9, 0.1, palette.window);
    win.position.set(sx * uw * 0.25, groundH + upperH * 0.55, ud / 2 + 0.02);
    g.add(win);
    for (const shx of [-1, 1]) {
      const shutter = box(0.22, 0.9, 0.08, palette.timber);
      shutter.position.set(sx * uw * 0.25 + shx * 0.46, groundH + upperH * 0.55, ud / 2 + 0.04);
      g.add(shutter);
    }
  }

  outlineHierarchy(g, { thickness: 0.045, color: palette.ink });
  return g;
}

/** Small Orthodox chapel with a stone bell-tower and a cross. */
export function createChapel(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'Chapel';

  const w = 4.2;
  const d = 6.0;
  const bodyH = 3.4;

  const body = box(w, bodyH, d, palette.plaster);
  body.position.y = bodyH / 2;
  g.add(body);

  // Gable roof (a 4-sided pyramid stretched along the nave).
  const gable = new THREE.Mesh(
    new THREE.ConeGeometry(w * 0.72, 1.7, 4),
    mat(palette.roof, { shadowStrength: 0.5 }),
  );
  gable.rotation.y = Math.PI / 4;
  gable.scale.set(1, 1, d / w);
  gable.position.y = bodyH + 0.85;
  g.add(gable);

  // Apse (semicircular-ish) at the back.
  const apse = new THREE.Mesh(
    new THREE.CylinderGeometry(w * 0.45, w * 0.45, bodyH * 0.85, 12, 1, false, -Math.PI / 2, Math.PI),
    mat(palette.plaster),
  );
  apse.position.set(0, (bodyH * 0.85) / 2, -d / 2);
  g.add(apse);

  // Stone bell-tower at the front.
  const towerH = 5.5;
  const tower = box(1.6, towerH, 1.6, palette.stone);
  tower.position.set(0, towerH / 2, d / 2 - 0.8);
  g.add(tower);
  const towerRoof = new THREE.Mesh(
    new THREE.ConeGeometry(1.4, 1.6, 4),
    mat(palette.roofAlt, { shadowStrength: 0.5 }),
  );
  towerRoof.rotation.y = Math.PI / 4;
  towerRoof.position.set(0, towerH + 0.8, d / 2 - 0.8);
  g.add(towerRoof);

  // Cross.
  const crossV = box(0.12, 0.9, 0.12, palette.ink);
  crossV.position.set(0, towerH + 2.0, d / 2 - 0.8);
  g.add(crossV);
  const crossH = box(0.5, 0.12, 0.12, palette.ink);
  crossH.position.set(0, towerH + 2.05, d / 2 - 0.8);
  g.add(crossH);

  outlineHierarchy(g, { thickness: 0.05, color: palette.ink });
  return g;
}

/** Stone чешма (public water fountain) with a basin and spout. */
export function createCheshma(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'Cheshma';

  const wall = box(2.4, 2.6, 0.7, palette.stone);
  wall.position.y = 1.3;
  g.add(wall);

  // Decorative arch niche.
  const niche = box(1.2, 1.4, 0.3, palette.stoneDark);
  niche.position.set(0, 1.3, 0.32);
  g.add(niche);

  // Basin.
  const basin = box(2.0, 0.5, 1.1, palette.stoneDark);
  basin.position.set(0, 0.45, 0.7);
  g.add(basin);
  const water = box(1.7, 0.12, 0.8, '#7fb0c0', { shadowStrength: 0.8, rimStrength: 0.6 });
  water.position.set(0, 0.66, 0.7);
  g.add(water);

  // Spout.
  const spout = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.06, 0.4, 8),
    mat(palette.ink),
  );
  spout.rotation.x = Math.PI / 2.3;
  spout.position.set(0, 1.1, 0.45);
  g.add(spout);

  outlineHierarchy(g, { thickness: 0.04, color: palette.ink });
  return g;
}

/** A leafy walnut/plum tree (default) or a tall cypress. */
export function createTree(kind: 'leafy' | 'cypress' = 'leafy'): THREE.Group {
  const g = new THREE.Group();
  g.name = 'Tree';

  if (kind === 'cypress') {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.26, 0.8, 6), mat(palette.trunk));
    trunk.position.y = 0.4;
    g.add(trunk);
    const h = randRange(4.0, 6.0);
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.9, h, 8), mat(palette.leafCypress));
    body.position.y = 0.8 + h / 2;
    g.add(body);
  } else {
    const trunkH = randRange(1.2, 1.8);
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.32, trunkH, 7),
      mat(palette.trunk),
    );
    trunk.position.y = trunkH / 2;
    g.add(trunk);

    const clusters = 3;
    for (let i = 0; i < clusters; i++) {
      const r = randRange(1.1, 1.7);
      const leaf = new THREE.Mesh(
        new THREE.IcosahedronGeometry(r, 1),
        mat(rand() > 0.5 ? palette.leafA : palette.leafB, { shadowStrength: 0.5 }),
      );
      leaf.position.set(
        randRange(-0.7, 0.7),
        trunkH + randRange(0.4, 1.4),
        randRange(-0.7, 0.7),
      );
      leaf.scale.y = randRange(0.85, 1.05);
      g.add(leaf);
    }
  }

  outlineHierarchy(g, { thickness: 0.04, color: '#23301c' });
  return g;
}

/** A small clay pot with red geraniums (мушкато). */
export function createPot(): THREE.Group {
  const g = new THREE.Group();
  const pot = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.16, 0.32, 8),
    mat('#b06a44'),
  );
  pot.position.y = 0.16;
  g.add(pot);
  for (let i = 0; i < 4; i++) {
    const f = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 0), mat(palette.geranium));
    f.position.set(randRange(-0.15, 0.15), 0.4 + randRange(0, 0.1), randRange(-0.15, 0.15));
    g.add(f);
  }
  outlineHierarchy(g, { thickness: 0.02, color: palette.ink });
  return g;
}

/** A conical haystack. */
export function createHaystack(): THREE.Group {
  const g = new THREE.Group();
  const h = randRange(1.8, 2.6);
  const hay = new THREE.Mesh(new THREE.ConeGeometry(randRange(1.2, 1.7), h, 10), mat(palette.hay));
  hay.position.y = h / 2;
  g.add(hay);
  outlineHierarchy(g, { thickness: 0.035, color: '#8a6a2a' });
  return g;
}

/** A stacked woodpile. */
export function createWoodpile(): THREE.Group {
  const g = new THREE.Group();
  const rows = 3;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < 4 - r; c++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 1.4, 6), mat(palette.wood));
      log.rotation.z = Math.PI / 2;
      log.position.set(0, 0.16 + r * 0.26, -0.6 + c * 0.28 + r * 0.14);
      g.add(log);
    }
  }
  outlineHierarchy(g, { thickness: 0.025, color: palette.timberDark });
  return g;
}

/** Geometry + material for an instanced cobblestone (калдъръм). */
export function cobblestoneGeometry(): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(0.35, 0);
  geo.scale(1, 0.45, 1); // flatten
  return geo;
}
export function cobblestoneMaterial(): THREE.ShaderMaterial {
  return mat(palette.stone, { shadowStrength: 0.6, rimStrength: 0.1 });
}

/** Geometry + material for an instanced fence post + rails (we instance the post). */
export function fencePostGeometry(): THREE.BufferGeometry {
  return new THREE.BoxGeometry(0.18, 1.1, 0.18);
}
export function fenceMaterial(): THREE.ShaderMaterial {
  return mat(palette.timber, { shadowStrength: 0.55 });
}

/** Geometry + material for instanced bushes/shrubs scattered over the hills. */
export function bushGeometry(): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(0.7, 1);
  geo.scale(1, 0.7, 1);
  return geo;
}
export function bushMaterial(): THREE.ShaderMaterial {
  return mat(palette.leafB, { shadowStrength: 0.5 });
}
