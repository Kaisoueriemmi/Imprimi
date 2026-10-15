import { defineConfig } from 'tsup';

// One self-contained CommonJS file (every dependency inlined): the input of @yao-pkg/pkg,
// which turns it into printbox-agent.exe.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  target: 'node20',
  platform: 'node',
  noExternal: [/.*/],
  // Optional native accelerators of `ws`, loaded in try/catch: not needed.
  external: ['bufferutil', 'utf-8-validate'],
  sourcemap: true,
  clean: true,
});
