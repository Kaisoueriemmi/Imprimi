import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/** API tests against a real PostgreSQL started by Testcontainers (Docker required). */
export default defineConfig({
  test: {
    include: ['test/**/*.int-spec.ts'],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    // One container per file; files run one after the other to keep Docker load predictable.
    fileParallelism: false,
  },
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
