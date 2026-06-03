import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { mog: 'src/mog.ts' },
  format: ['cjs'],
  target: 'node18',
  outDir: 'dist',
  tsconfig: 'tsconfig.json',
  dts: false,
  splitting: false,
  sourcemap: true,
  clean: true,
  shims: true,
  external: [
    '@mog-sdk/node',
    'node:child_process',
    'node:crypto',
    'node:fs',
    'node:fs/promises',
    'node:net',
    'node:os',
    'node:path',
    'node:url',
  ],
});
