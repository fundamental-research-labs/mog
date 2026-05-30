import { defineConfig } from 'tsup';

// Node.js built-ins that may appear in bundled transport/kernel code but are
// never executed in the browser. Externalizing prevents esbuild resolution errors.
const NODE_BUILTINS = [
  'module',
  'fs',
  'path',
  'os',
  'url',
  'crypto',
  'stream',
  'buffer',
  'child_process',
  'worker_threads',
  'util',
  'events',
  'net',
  'http',
  'https',
  'tls',
  'dns',
  'dgram',
  'zlib',
];

export default defineConfig({
  entry: {
    index: 'index.tsx',
    register: 'register.ts',
    'src/infra/context/embed-runtime-context': 'src/infra/context/embed-runtime-context.tsx',
    'src/infra/services/index': 'src/infra/services/index.ts',
    'chrome-collab': 'src/entries/chrome-collab.ts',
    'chrome-layers': 'src/entries/chrome-layers.ts',
    'dev/testing-panel': 'src/dev/testing-panel-contribution.tsx',
    'hooks-collab': 'src/entries/hooks-collab.ts',
  },
  format: 'esm',
  target: 'es2022',
  platform: 'browser',
  outDir: 'dist',
  splitting: true,
  sourcemap: true,
  clean: true,
  // Inline all workspace packages — this is the whole point.
  // Exclude @mog-sdk/wasm which must remain external (loaded at runtime via asyncWebAssembly).
  noExternal: [/^@mog\//, /^@mog-sdk\/(?!wasm)/],
  external: [
    // Peer deps — must match the consumer's version
    'react',
    'react-dom',
    'react/jsx-runtime',
    'react-dom/client',
    // WASM binary loaded at runtime via asyncWebAssembly
    '@mog-sdk/wasm',
    // Platform-specific binaries (desktop only)
    '@mog/compute-core-napi',
    /^@tauri-apps\//,
    '@rust-bridge/client',
    /^@mog-sdk\/darwin/,
    /^@mog-sdk\/linux/,
    /^@mog-sdk\/win32/,
    // Node built-ins (never executed in browser)
    ...NODE_BUILTINS,
  ],
  esbuildOptions(options) {
    // Required for React JSX transform
    options.jsx = 'automatic';
    // Resolve workspace packages via the `development` condition so esbuild
    // finds raw .ts source (most @mog/* packages don't ship pre-built dist/).
    options.conditions = ['development', 'import', 'default'];
    // Ensure extensionless imports (e.g. in @mog/icons) resolve .tsx/.ts files
    options.resolveExtensions = ['.tsx', '.ts', '.jsx', '.js', '.json'];
  },
});
