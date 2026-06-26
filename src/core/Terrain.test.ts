import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Terrain } from './Terrain';

const CENTER = new THREE.Vector3(0, 1, 0).normalize();
const RADIUS = 42;

function randDir(i: number): THREE.Vector3 {
  // deterministic pseudo-random unit vectors (no Math.random in tests)
  const a = i * 2.39996, b = i * 1.61803;
  return new THREE.Vector3(Math.cos(a) * Math.cos(b), Math.sin(b), Math.sin(a) * Math.cos(b)).normalize();
}

describe('Terrain.heightAt', () => {
  const terrain = new Terrain(CENTER);

  it('is deterministic for the same direction', () => {
    const d = randDir(7);
    expect(terrain.heightAt(d)).toBe(terrain.heightAt(d.clone()));
  });

  it('stays within a gentle, bounded range', () => {
    for (let i = 0; i < 500; i++) {
      const h = terrain.heightAt(randDir(i));
      expect(Number.isFinite(h)).toBe(true);
      expect(h).toBeLessThan(2.0);     // hill amplitude ~1.5
      expect(h).toBeGreaterThan(-3.0); // basin + stream carve
    }
  });

  it('flattens and lowers the village basin at the centre', () => {
    const heights: number[] = [];
    for (let k = 0; k < 12; k++) {
      const az = (k / 12) * Math.PI * 2;
      // a ring at a small angular radius around the centre
      const t = new THREE.Vector3(1, 0, 0);
      const b = new THREE.Vector3().crossVectors(CENTER, t).normalize();
      const dir = CENTER.clone().multiplyScalar(Math.cos(0.06))
        .addScaledVector(t.clone().multiplyScalar(Math.cos(az)).addScaledVector(b, Math.sin(az)), Math.sin(0.06))
        .normalize();
      heights.push(terrain.heightAt(dir));
    }
    const max = Math.max(...heights), min = Math.min(...heights);
    expect(max - min).toBeLessThan(0.25);       // flat
    expect(terrain.heightAt(CENTER)).toBeLessThan(-0.5); // a dip
  });
});

describe('Terrain.normalAt', () => {
  it('returns an outward unit normal', () => {
    const terrain = new Terrain(CENTER);
    for (let i = 0; i < 50; i++) {
      const d = randDir(i + 100);
      const n = terrain.normalAt(d, RADIUS);
      expect(n.length()).toBeCloseTo(1, 5);
      expect(n.dot(d)).toBeGreaterThan(0); // points away from the core
    }
  });

  it('is exactly radial on perfectly flat terrain', () => {
    const flat = new Terrain(CENTER, { hillAmplitude: 0, basinDepth: 0, streamDepth: 0 });
    const d = randDir(3);
    const n = flat.normalAt(d, RADIUS);
    expect(n.dot(d)).toBeCloseTo(1, 4);
  });
});

describe('Terrain.colorAt', () => {
  it('gives the riverbank a different colour from the highland', () => {
    const terrain = new Terrain(CENTER);
    const water = terrain.colorAt(terrain.streamPath[Math.floor(terrain.streamPath.length / 2)], RADIUS);
    const land = terrain.colorAt(randDir(999), RADIUS);
    expect(water.getHexString()).not.toBe(land.getHexString());
  });

  it('returns a defined colour everywhere', () => {
    const terrain = new Terrain(CENTER);
    for (let i = 0; i < 50; i++) {
      const c = terrain.colorAt(randDir(i + 5), RADIUS);
      expect(c).toBeInstanceOf(THREE.Color);
    }
  });
});
