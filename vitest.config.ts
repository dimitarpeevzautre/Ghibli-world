import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node', // terrain math is pure; no DOM needed
    include: ['src/**/*.test.ts'],
  },
});
