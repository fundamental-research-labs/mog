import { defineConfig } from 'tsup';

const standalone = process.env.MOG_CLI_STANDALONE === '1';
const outDir = process.env.MOG_CLI_OUT_DIR ?? 'dist';

export default defineConfig({
  entry: { mog: 'src/mog.ts' },
  format: ['cjs'],
  target: 'node18',
  outDir,
  tsconfig: 'tsconfig.json',
  dts: false,
  splitting: false,
  sourcemap: true,
  clean: true,
  shims: true,
  noExternal: standalone ? ['@mog-sdk/node'] : [],
  external: [
    ...(standalone ? [] : ['@mog-sdk/node']),
    '@mog-sdk/darwin-arm64',
    '@mog-sdk/darwin-x64',
    '@mog-sdk/linux-x64-gnu',
    '@mog-sdk/linux-x64-musl',
    '@mog-sdk/linux-arm64-gnu',
    '@mog-sdk/linux-arm64-musl',
    '@mog-sdk/win32-x64-msvc',
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
