import { defineConfig } from 'tsup';

// Node.js built-ins that may appear in bundled transport code (napi-loader,
// detection) but are never executed in the browser. Externalizing them
// prevents esbuild from erroring on unresolvable modules.
const NODE_BUILTINS = [
  'module',
  'fs',
  'fs/promises',
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

const MOG_SDK_INTERNAL = /^@mog-sdk\/(?!wasm(?:$|\/))/;
const EXTERNAL_BROWSER_DEPS = ['react', 'react-dom', '@mog-sdk/wasm'];
const NODE_BUILTIN_IDS = new Set([...NODE_BUILTINS, ...NODE_BUILTINS.map((id) => `node:${id}`)]);

const emptyNodeBuiltinPlugin = {
  name: 'empty-node-builtins-for-browser',
  setup(build: any) {
    build.onResolve({ filter: /.*/ }, (args: { path: string }) => {
      if (!NODE_BUILTIN_IDS.has(args.path)) return null;
      return { path: args.path, namespace: 'mog-empty-node-builtin' };
    });
    build.onLoad({ filter: /.*/, namespace: 'mog-empty-node-builtin' }, () => ({
      contents: 'export default {}; export const __mogBrowserEmptyNodeBuiltin = true;',
      loader: 'js',
    }));
  },
};

export default defineConfig({
  entry: {
    // For CDN <script> and npm import '@mog-sdk/embed'
    index: 'src/index.ts',
    // For npm import '@mog-sdk/embed/react'
    react: 'src/react/index.tsx',
    // For npm import '@mog-sdk/embed/web-component'
    'web-component': 'src/web-component/index.ts',
    // For npm import '@mog-sdk/embed/config'
    config: 'src/config.ts',
    // Workspace-private friend export for @mog/views-host.
    'internal/views-host': 'src/internal/views-host.ts',
    // Bundle-private entry used by same-page products; intentionally not in package.exports.
    client: 'src/client/index.ts',
  },
  format: ['esm', 'cjs'],
  target: 'es2020',
  platform: 'browser',
  outDir: 'dist',
  tsconfig: 'tsconfig.build.json',
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  noExternal: [/^@mog\//, MOG_SDK_INTERNAL],
  external: EXTERNAL_BROWSER_DEPS,
  esbuildPlugins: [emptyNodeBuiltinPlugin],
  esbuildOptions(options) {
    options.conditions = ['development'];
  },
  define: {
    __SDK_VERSION__: JSON.stringify(require('./package.json').version),
  },
});
