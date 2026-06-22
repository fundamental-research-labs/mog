import { defineConfig, type Options } from 'tsup';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// In Docker fleet builds, kernel dist/ doesn't exist so DTS generation fails.
// Skip DTS when TSUP_SKIP_DTS=1 — fleet only needs the JS bundle.
const skipDts = process.env.TSUP_SKIP_DTS === '1';

const bundledWorkspacePackages: Options['noExternal'] = [
  /^@mog\//,
  /^@rust-bridge\//,
  '@mog-sdk/contracts',
  /^@mog-sdk\/kernel(?:\/.*)?$/,
];

const nativeExternals = [
  '@mog-sdk/darwin-arm64',
  '@mog-sdk/darwin-x64',
  '@mog-sdk/linux-x64-gnu',
  '@mog-sdk/linux-x64-musl',
  '@mog-sdk/linux-arm64-gnu',
  '@mog-sdk/linux-arm64-musl',
  '@mog-sdk/win32-x64-msvc',
  '@tauri-apps/api/core',
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
];

function applyWorkspaceAliases(
  options: NonNullable<Parameters<NonNullable<Options['esbuildOptions']>>[0]>,
  transportEntry: string,
): void {
  options.alias = {
    ...options.alias,
    '@mog-sdk/kernel/host-lifecycle-internal': resolve(
      __dirname,
      '../../kernel/src/host-lifecycle-internal.ts',
    ),
    '@mog-sdk/kernel/storage': resolve(__dirname, '../../kernel/src/storage/index.ts'),
    '@mog-sdk/kernel': resolve(__dirname, '../../kernel/src/index.ts'),
    '@mog/transport': resolve(__dirname, transportEntry),
    '@rust-bridge/client': resolve(__dirname, '../../infra/rust-bridge/client/src/index.ts'),
  };
}

export default defineConfig([
  {
    entry: { index: 'src/index.ts', 'version-store': 'src/version-store.ts' },
    format: ['esm', 'cjs'],
    platform: 'node',
    target: 'node18',
    outDir: 'dist',
    tsconfig: 'tsconfig.build.json',
    dts: !skipDts,
    splitting: false,
    sourcemap: true,
    clean: true,
    // Fix import.meta.url for CJS builds (used by napi-loader's createRequire)
    shims: true,
    esbuildOptions(options) {
      options.conditions = ['development', 'node', 'import', 'default'];
      options.sourcesContent = false;
      applyWorkspaceAliases(options, '../../infra/transport/src/index.ts');
    },
    noExternal: bundledWorkspacePackages,
    external: nativeExternals,
  },
  {
    entry: { wasm: 'src/wasm.ts', workerd: 'src/workerd.ts' },
    format: ['esm'],
    platform: 'browser',
    target: 'es2022',
    outDir: 'dist',
    tsconfig: 'tsconfig.build.json',
    dts: !skipDts,
    splitting: false,
    sourcemap: true,
    clean: false,
    shims: false,
    esbuildOptions(options) {
      options.conditions = ['development', 'workerd', 'browser', 'import', 'default'];
      options.sourcesContent = false;
      applyWorkspaceAliases(options, '../../infra/transport/src/index.wasm.ts');
    },
    esbuildPlugins: [
      {
        name: 'mog-sdk-wasm-stubs',
        setup(build) {
          build.onResolve({ filter: /^\.\/filesystem-provider$/ }, (args) => {
            if (!args.importer.endsWith('/kernel/src/document/providers/registry.ts')) {
              return;
            }
            return {
              path: resolve(__dirname, 'src/wasm-stubs/filesystem-provider.ts'),
            };
          });
        },
      },
    ],
    noExternal: [...bundledWorkspacePackages, '@mog-sdk/chart-raster-wasm'],
  },
]);
