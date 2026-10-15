import { defineConfig } from 'tsup';

// One CommonJS bundle (shared package inlined): the input @yao-pkg/pkg turns into an .exe (Phase 4).
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  target: 'node20',
  platform: 'node',
  noExternal: ['@printbox/shared', 'zod'],
  sourcemap: true,
  clean: true,
});
