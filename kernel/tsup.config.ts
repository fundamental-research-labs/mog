import { defineConfig } from 'tsup';

const INTERNAL_WORKSPACE_DEPS = [
  /^@mog\//,
  /^@mog-sdk\/spreadsheet-contracts(?:\/.*)?$/,
  /^@rust-bridge\//,
];

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    internal: 'src/internal.ts',
    'keyboard/index': 'src/keyboard/index.ts',
    'security/index': 'src/security/index.ts',
    'storage/index': 'src/storage/index.ts',
    'testing/index': 'src/testing/index.ts',
    'api/index': 'src/api/index.ts',
    'api/app/index': 'src/api/app/index.ts',
    'services/capabilities/index': 'src/services/capabilities/index.ts',
    'contracts/api': 'src/contracts/api.ts',
    'host-lifecycle-internal': 'src/host-lifecycle-internal.ts',
  },
  format: ['esm'],
  target: 'es2020',
  platform: 'browser',
  outDir: 'dist',
  tsconfig: 'tsconfig.json',
  dts: false,
  splitting: false,
  sourcemap: true,
  clean: true,
  // Public @mog-sdk/* packages cannot publish runtime dependencies on internal
  // @mog/* packages. Kernel still imports chart internals in source, so tsup
  // bundles those workspace packages into dist and they stay devDependencies.
  noExternal: INTERNAL_WORKSPACE_DEPS,
  external: ['@mog-sdk/contracts', '@mog-sdk/contracts/*', '@mog-sdk/wasm', 'xstate'],
  esbuildOptions(options) {
    options.conditions = ['development', 'browser', 'import', 'default'];
  },
});
