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

/** A framed window: dark glass, a light frame and a cross muntin, with optional shutters. */
function addWindow(parent: THREE.Group, x: number, y: number, z: number, shutters = true): void {
  const w = 0.7;
  const h = 0.95;
  const frame = box(w + 0.14, h + 0.14, 0.08, palette.plaster);
  frame.position.set(x, y, z);
  parent.add(frame);
  const glass = box(w, h, 0.06, palette.window, { shadowStrength: 0.8, rimStrength: 0.5 });
  glass.position.set(x, y, z + 0.03);
  parent.add(glass);
  const mh = box(w, 0.06, 0.07, palette.plaster);
  mh.position.set(x, y, z + 0.04);
  parent.add(mh);
  const mv = box(0.06, h, 0.07, palette.plaster);
  mv.position.set(x, y, z + 0.04);
  parent.add(mv);
  if (shutters) {
    for (const sx of [-1, 1]) {
      const shutter = box(0.24, h + 0.05, 0.06, palette.timber);
      shutter.position.set(x + sx * (w / 2 + 0.18), y, z + 0.02);
      parent.add(shutter);
    }
  }
}

/**
 * A Revival house: stone ground floor, an overhanging timber upper storey (чардак) with corner
 * posts + diagonal braces, a projecting bay window ( еркер), a deep terracotta hip roof with
 * dark eaves, framed windows with shutters, a door and a chimney (whose top is recorded in
 * `userData.chimneyLocal` so smoke can be emitted from it).
 */
export function createHouse(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'House';

  const w = randRange(3.6, 4.8);
  const d = randRange(3.2, 4.2);
  const groundH = randRange(1.9, 2.4);
  const upperH = randRange(1.9, 2.3);
  const overhang = 0.5;

  const plasterColor = rand() > 0.5 ? palette.plaster : palette.plasterWarm;
  const roofColor = rand() > 0.5 ? palette.roof : palette.roofAlt;

  // Stone plinth + ground floor.
  const plinth = box(w + 0.2, 0.35, d + 0.2, palette.stoneDark);
  plinth.position.y = 0.175;
  g.add(plinth);
  const ground = box(w, groundH, d, palette.stone);
  ground.position.y = groundH / 2 + 0.2;
  g.add(ground);

  const baseTop = groundH + 0.2;
  const uw = w + overhang * 2;
  const ud = d + overhang * 2;

  // Overhanging plastered upper storey.
  const upper = box(uw, upperH, ud, plasterColor);
  upper.position.y = baseTop + upperH / 2;
  g.add(upper);

  // Timber framing: corner posts, top/bottom beams, diagonal braces on the side walls.
  const postT = 0.17;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const post = box(postT, upperH, postT, palette.timber);
      post.position.set((sx * uw) / 2, baseTop + upperH / 2, (sz * ud) / 2);
      g.add(post);
    }
  }
  for (const yy of [baseTop + 0.1, baseTop + upperH - 0.1]) {
    const beamX = box(uw, 0.16, postT, palette.timberDark);
    beamX.position.set(0, yy, ud / 2);
    g.add(beamX);
    const beamXb = beamX.clone();
    beamXb.position.z = -ud / 2;
    g.add(beamXb);
  }
  for (const sz of [-1, 1]) {
    for (const dir of [-1, 1]) {
      const brace = box(0.13, upperH * 0.95, 0.13, palette.timber);
      brace.position.set((dir * uw) / 4, baseTop + upperH / 2, (sz * ud) / 2);
      brace.rotation.z = dir * 0.5;
      g.add(brace);
    }
  }

  // Projecting bay window (еркер) on the front.
  const bayW = uw * 0.5;
  const bay = box(bayW, upperH * 0.7, 0.6, plasterColor);
  bay.position.set(0, baseTop + upperH * 0.55, ud / 2 + 0.3);
  g.add(bay);
  // corbel underneath
  const corbel = new THREE.Mesh(
    new THREE.ConeGeometry(0.5, 0.6, 4),
    mat(palette.timberDark),
  );
  corbel.rotation.y = Math.PI / 4;
  corbel.scale.set(bayW / 0.7, 1, 1);
  corbel.position.set(0, baseTop + upperH * 0.18, ud / 2 + 0.3);
  g.add(corbel);
  addWindow(g, 0, baseTop + upperH * 0.58, ud / 2 + 0.61, false);

  // Deep terracotta hip roof + a darker flared eave course beneath it.
  const roofH = randRange(1.5, 2.0);
  const roofRadius = Math.hypot(uw, ud) / 2 + 0.55;
  const eave = new THREE.Mesh(new THREE.ConeGeometry(roofRadius, 0.45, 4), mat(palette.roofAlt, { shadowStrength: 0.45 }));
  eave.rotation.y = Math.PI / 4;
  eave.position.y = baseTop + upperH + 0.18;
  g.add(eave);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(roofRadius * 0.92, roofH, 4), mat(roofColor, { shadowStrength: 0.5 }));
  roof.rotation.y = Math.PI / 4;
  roof.position.y = baseTop + upperH + 0.35 + roofH / 2;
  g.add(roof);

  // Chimney + cap; record its top for smoke emission.
  const chX = uw * 0.22;
  const chZ = -ud * 0.12;
  const chTopY = baseTop + upperH + roofH * 0.7;
  const chimney = box(0.46, 1.3, 0.46, palette.stoneDark);
  chimney.position.set(chX, baseTop + upperH + roofH * 0.5, chZ);
  g.add(chimney);
  const cap = box(0.6, 0.16, 0.6, palette.stone);
  cap.position.set(chX, chTopY, chZ);
  g.add(cap);
  g.userData.chimneyLocal = new THREE.Vector3(chX, chTopY + 0.2, chZ);

  // Door with frame + lintel.
  const doorFrame = box(1.06, 1.86, 0.1, palette.timber);
  doorFrame.position.set(0, 0.2 + 0.93, d / 2 + 0.01);
  g.add(doorFrame);
  const door = box(0.86, 1.66, 0.12, palette.timberDark);
  door.position.set(0, 0.2 + 0.83, d / 2 + 0.04);
  g.add(door);

  // Upper-storey windows flanking the bay, + a ground-floor window.
  addWindow(g, -uw * 0.3, baseTop + upperH * 0.55, ud / 2 + 0.02);
  addWindow(g, uw * 0.3, baseTop + upperH * 0.55, ud / 2 + 0.02);
  addWindow(g, w * 0.3, 0.2 + groundH * 0.55, d / 2 + 0.02);

  g.userData.footprint = Math.max(w, d) * 0.5 + 0.15;
  outlineHierarchy(g, { thickness: 0.045, color: palette.ink });
  return g;
}

/** A small cross (vertical + horizontal bars) centred at the given point. */
function addCross(parent: THREE.Group, x: number, y: number, z: number, s = 1): void {
  const v = box(0.12 * s, 0.9 * s, 0.12 * s, palette.ink);
  v.position.set(x, y, z);
  parent.add(v);
  const h = box(0.5 * s, 0.12 * s, 0.12 * s, palette.ink);
  h.position.set(x, y + 0.12 * s, z);
  parent.add(h);
}

/** Small Orthodox chapel: plastered nave, apse, a domed drum, a stone bell-tower and crosses. */
export function createChapel(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'Chapel';

  const w = 4.4;
  const d = 6.2;
  const bodyH = 3.4;

  const body = box(w, bodyH, d, palette.plaster);
  body.position.y = bodyH / 2;
  g.add(body);

  // Gable roof along the nave, with a small dark eave.
  const gable = new THREE.Mesh(new THREE.ConeGeometry(w * 0.74, 1.7, 4), mat(palette.roof, { shadowStrength: 0.5 }));
  gable.rotation.y = Math.PI / 4;
  gable.scale.set(1, 1, d / w);
  gable.position.y = bodyH + 0.85;
  g.add(gable);

  // Apse at the back.
  const apse = new THREE.Mesh(
    new THREE.CylinderGeometry(w * 0.45, w * 0.45, bodyH * 0.85, 14, 1, false, -Math.PI / 2, Math.PI),
    mat(palette.plaster),
  );
  apse.position.set(0, (bodyH * 0.85) / 2, -d / 2);
  g.add(apse);

  // Domed drum over the nave (Orthodox cupola).
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 1.0, 14), mat(palette.plaster));
  drum.position.set(0, bodyH + 1.5, -d * 0.1);
  g.add(drum);
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(0.95, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    mat('#7d8a93', { shadowStrength: 0.5, rimStrength: 0.5 }),
  );
  dome.position.set(0, bodyH + 2.0, -d * 0.1);
  g.add(dome);
  addCross(g, 0, bodyH + 3.0, -d * 0.1, 0.7);

  // Stone bell-tower at the front, with an arched opening.
  const towerH = 5.6;
  const tower = box(1.7, towerH, 1.7, palette.stone);
  tower.position.set(0, towerH / 2, d / 2 - 0.85);
  g.add(tower);
  const belfry = box(1.0, 1.0, 0.5, palette.window, { shadowStrength: 0.8 });
  belfry.position.set(0, towerH - 1.0, d / 2 - 0.85 + 0.62);
  g.add(belfry);
  const towerRoof = new THREE.Mesh(new THREE.ConeGeometry(1.5, 1.7, 4), mat(palette.roofAlt, { shadowStrength: 0.5 }));
  towerRoof.rotation.y = Math.PI / 4;
  towerRoof.position.set(0, towerH + 0.85, d / 2 - 0.85);
  g.add(towerRoof);
  addCross(g, 0, towerH + 2.0, d / 2 - 0.85);

  g.userData.footprint = Math.max(w, d) * 0.5 + 0.2;
  outlineHierarchy(g, { thickness: 0.05, color: palette.ink });
  return g;
}

/** Stone чешма (public water fountain): an arched wall with two spouts, a trough and a cornice. */
export function createCheshma(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'Cheshma';

  const wall = box(2.6, 2.8, 0.7, palette.stone);
  wall.position.y = 1.4;
  g.add(wall);

  // Cornice cap.
  const cornice = box(2.9, 0.3, 0.95, palette.stoneDark);
  cornice.position.y = 2.85;
  g.add(cornice);

  // Recessed arched niche: rectangular recess + a half-cylinder arch on top.
  const niche = box(1.3, 1.5, 0.32, palette.stoneDark);
  niche.position.set(0, 1.3, 0.33);
  g.add(niche);
  const arch = new THREE.Mesh(
    new THREE.CylinderGeometry(0.65, 0.65, 0.32, 14, 1, false, 0, Math.PI),
    mat(palette.stoneDark),
  );
  arch.rotation.z = -Math.PI / 2;
  arch.rotation.y = Math.PI / 2;
  arch.position.set(0, 2.05, 0.33);
  g.add(arch);

  // Long stone trough + water.
  const trough = box(2.4, 0.55, 0.95, palette.stoneDark);
  trough.position.set(0, 0.5, 0.75);
  g.add(trough);
  const water = box(2.1, 0.12, 0.7, '#7fb0c0', { shadowStrength: 0.85, rimStrength: 0.6 });
  water.position.set(0, 0.74, 0.75);
  g.add(water);

  // Two brass spouts.
  for (const sx of [-0.5, 0.5]) {
    const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.45, 8), mat('#7a5a32'));
    spout.rotation.x = Math.PI / 2.4;
    spout.position.set(sx, 1.15, 0.5);
    g.add(spout);
  }

  g.userData.footprint = 1.7;
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

/** A single low-poly boulder (hero prop). */
export function createBoulder(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'Boulder';
  const r = randRange(0.5, 1.1);
  const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), mat(palette.stone, { shadowStrength: 0.6, rimStrength: 0.12 }));
  rock.scale.set(randRange(0.9, 1.3), randRange(0.6, 0.9), randRange(0.9, 1.3));
  rock.position.y = r * 0.45;
  g.add(rock);
  outlineHierarchy(g, { thickness: 0.03, color: palette.ink });
  return g;
}

/** Geometry + material for instanced scattered boulders. */
export function boulderGeometry(): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(0.7, 0);
  geo.scale(1.1, 0.7, 1.1);
  return geo;
}
export function boulderMaterial(): THREE.ShaderMaterial {
  return mat(palette.stone, { shadowStrength: 0.6, rimStrength: 0.12 });
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
  geo.translate(0, 0.35, 0); // base near y = 0
  return geo;
}
export function bushMaterial(): THREE.ShaderMaterial {
  return mat(palette.leafB, { shadowStrength: 0.5, windStrength: 0.18 });
}

// --- instanced trees (one trunk field + one foliage field per kind, sharing matrices) ---
// Geometries bake their height in (base at y = 0) so a single surface matrix places the whole
// tree; per-instance scale gives size variety. Splitting trunk/foliage keeps draw calls tiny.

export function leafyTrunkGeometry(): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(0.22, 0.32, 1.5, 7);
  geo.translate(0, 0.75, 0);
  return geo;
}
export function leafyFoliageGeometry(): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(1.45, 1);
  geo.scale(1, 0.95, 1);
  geo.translate(0, 2.5, 0);
  return geo;
}
export function cypressTrunkGeometry(): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(0.16, 0.24, 0.8, 6);
  geo.translate(0, 0.4, 0);
  return geo;
}
export function cypressFoliageGeometry(): THREE.BufferGeometry {
  const geo = new THREE.ConeGeometry(0.9, 4.6, 8);
  geo.translate(0, 0.8 + 2.3, 0);
  return geo;
}
export function trunkMaterial(): THREE.ShaderMaterial {
  return mat(palette.trunk, { shadowStrength: 0.55 });
}
export function foliageMaterial(color: string): THREE.ShaderMaterial {
  return mat(color, { shadowStrength: 0.5, windStrength: 0.22 });
}

/** A heavy wooden gate (порта) flanked by stone piers — placed along garden walls. */
export function createGate(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'Gate';
  for (const sx of [-1, 1]) {
    const pier = box(0.4, 2.2, 0.5, palette.stone);
    pier.position.set(sx * 0.95, 1.1, 0);
    g.add(pier);
  }
  const doors = box(1.5, 1.9, 0.18, palette.timberDark);
  doors.position.set(0, 0.95, 0);
  g.add(doors);
  const split = box(0.06, 1.9, 0.2, palette.ink);
  split.position.set(0, 0.95, 0.01);
  g.add(split);
  // little tiled roof over the gate
  const roof = new THREE.Mesh(new THREE.ConeGeometry(1.6, 0.6, 4), mat(palette.roof, { shadowStrength: 0.5 }));
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(1, 1, 0.45);
  roof.position.set(0, 2.5, 0);
  g.add(roof);
  outlineHierarchy(g, { thickness: 0.035, color: palette.ink });
  return g;
}

/** A long stone-and-timber barn with a gable roof — for outlying farmsteads. */
export function createBarn(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'Barn';
  const w = randRange(3.0, 3.8);
  const d = randRange(5.0, 7.0);
  const h = randRange(2.2, 2.8);
  const stoneH = h * 0.4;
  const base = box(w, stoneH, d, palette.stone);
  base.position.y = stoneH / 2;
  g.add(base);
  const tim = box(w, h - stoneH, d, palette.timber);
  tim.position.y = stoneH + (h - stoneH) / 2;
  g.add(tim);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(w * 0.74, 1.4, 4), mat(palette.roofAlt, { shadowStrength: 0.5 }));
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(1, 1, d / w);
  roof.position.y = h + 0.7;
  g.add(roof);
  const door = box(1.5, 1.9, 0.12, palette.timberDark);
  door.position.set(0, 0.95, d / 2 + 0.02);
  g.add(door);
  g.userData.footprint = Math.max(w, d) * 0.5 + 0.15;
  outlineHierarchy(g, { thickness: 0.045, color: palette.ink });
  return g;
}

/** A wayside stone cross (крайпътен кръст) for a far hilltop. */
export function createWaysideCross(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'WaysideCross';
  const base = box(1.0, 0.6, 1.0, palette.stone);
  base.position.y = 0.3;
  g.add(base);
  const plinth = box(0.5, 0.5, 0.5, palette.stoneDark);
  plinth.position.y = 0.85;
  g.add(plinth);
  addCross(g, 0, 1.7, 0, 1.5);
  g.userData.footprint = 0.9;
  outlineHierarchy(g, { thickness: 0.03, color: palette.ink });
  return g;
}

/** A flat pond (still water + muddy bank), to nestle into a hollow. No outline (flat disc). */
export function createPond(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'Pond';
  const r = randRange(3.0, 5.0);
  const bank = new THREE.Mesh(new THREE.CircleGeometry(r + 0.7, 28), mat('#6b5a3a', { shadowStrength: 0.6 }));
  bank.geometry.rotateX(-Math.PI / 2);
  bank.position.y = 0.04;
  g.add(bank);
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(r, 28),
    mat('#6fa6bf', { shadowStrength: 0.9, rimStrength: 0.5 }),
  );
  water.geometry.rotateX(-Math.PI / 2);
  water.position.y = 0.08;
  g.add(water);
  return g;
}

/** A small timber footbridge to span the stream. Spans along local +Z. */
export function createFootbridge(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'Footbridge';
  const deck = box(1.6, 0.16, 3.4, palette.wood, { shadowStrength: 0.6 });
  deck.position.y = 0.5;
  g.add(deck);
  for (const sx of [-0.7, 0.7]) {
    const rail = box(0.1, 0.5, 3.4, palette.timberDark);
    rail.position.set(sx, 0.8, 0);
    g.add(rail);
    for (const sz of [-1.5, 0, 1.5]) {
      const post = box(0.14, 0.7, 0.14, palette.timber);
      post.position.set(sx, 0.55, sz);
      g.add(post);
    }
  }
  g.userData.footprint = 1.2;
  outlineHierarchy(g, { thickness: 0.035, color: palette.ink });
  return g;
}

/** Toon water surface material (gentle, slightly translucent). */
export function waterMaterial(): THREE.ShaderMaterial {
  const m = mat('#4fb3d9', { shadowStrength: 1.0, rimStrength: 0.6, bands: 2 });
  m.transparent = true;
  m.opacity = 0.92;
  m.side = THREE.DoubleSide;
  return m;
}

/** A few stepped retaining walls with planted strips — terraced hillside gardens. */
export function createTerrace(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'Terrace';
  const rows = 3;
  const len = randRange(4.5, 6.5);
  for (let i = 0; i < rows; i++) {
    const y = 0.25 + i * 0.45;
    const z = i * 1.7 - 1.7;
    const wall = box(len, 0.5, 0.35, palette.stone);
    wall.position.set(0, y, z);
    g.add(wall);
    const strip = box(len - 0.2, 0.14, 1.3, palette.leafB, { shadowStrength: 0.5 });
    strip.position.set(0, y + 0.05, z + 0.85);
    g.add(strip);
  }
  outlineHierarchy(g, { thickness: 0.03, color: palette.ink });
  return g;
}
