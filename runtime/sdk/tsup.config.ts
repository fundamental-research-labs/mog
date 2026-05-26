import { defineConfig } from 'tsup';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// In Docker fleet builds, kernel dist/ doesn't exist so DTS generation fails.
// Skip DTS when TSUP_SKIP_DTS=1 — fleet only needs the JS bundle.
const skipDts = process.env.TSUP_SKIP_DTS === '1';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  target: 'node18',
  outDir: 'dist',
  tsconfig: 'tsconfig.build.json',
  dts: !skipDts,
  splitting: false,
  sourcemap: true,
  clean: true,
  // Fix import.meta.url for CJS builds (used by napi-loader's createRequire)
  shims: true,

  // Resolve workspace package exports via the "development" condition so esbuild
  // reads .ts source directly. This avoids needing built dist/ for kernel and
  // contracts — critical in Docker where only types-* are pre-built.
  esbuildOptions(options) {
    options.conditions = ['development', 'node', 'import', 'default'];
    options.sourcesContent = false;
    options.alias = {
      ...options.alias,
      '@mog-sdk/kernel/host-lifecycle-internal': resolve(
        __dirname,
        '../../kernel/src/host-lifecycle-internal.ts',
      ),
      '@mog-sdk/kernel/storage': resolve(__dirname, '../../kernel/src/storage/index.ts'),
      '@mog-sdk/kernel': resolve(__dirname, '../../kernel/src/index.ts'),
      '@mog/transport': resolve(__dirname, '../../infra/transport/src/index.ts'),
      '@rust-bridge/client': resolve(__dirname, '../../infra/rust-bridge/client/src/index.ts'),
    };
  },

  // Bundle all internal workspace packages into the output.
  noExternal: [/^@mog\//, /^@rust-bridge\//, '@mog-sdk/contracts', /^@mog-sdk\/kernel(?:\/.*)?$/],

  // Keep these out of the bundle
  external: [
    // Native addon packages (resolved at runtime)
    '@mog-sdk/darwin-arm64',
    '@mog-sdk/darwin-x64',
    '@mog-sdk/linux-x64-gnu',
    '@mog-sdk/linux-x64-musl',
    '@mog-sdk/linux-arm64-gnu',
    '@mog-sdk/linux-arm64-musl',
    '@mog-sdk/win32-x64-msvc',
    // Tauri desktop runtime (dynamic import, not needed in Node)
    '@tauri-apps/api/core',

    // Node.js builtins
    'module',
    'node:fs/promises',
    'node:fs',
    'node:path',
    'node:crypto',
    'node:os',
    'node:stream',
    'node:buffer',
    'node:util',
    'node:process',
    'node:module',
    'fs',
    'path',
    'crypto',
    'os',
    'stream',
    'buffer',
    'util',
    'process',
  ],
});
