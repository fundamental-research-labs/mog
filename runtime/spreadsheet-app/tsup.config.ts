import { defineConfig } from 'tsup';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
  entry: { index: 'src/index.tsx' },
  format: ['esm'],
  target: 'es2020',
  platform: 'browser',
  outDir: 'dist',
  tsconfig: 'tsconfig.build.json',
  dts: false,
  splitting: false,
  sourcemap: true,
  clean: true,
  noExternal: [/^@mog\//, /^@mog-sdk\/(?!wasm(?:$|\/))/, /^@rust-bridge\//],
  external: [
    '@mog-sdk/kernel',
    '@mog-sdk/kernel/security',
    'react',
    'react/jsx-runtime',
    'react/jsx-dev-runtime',
    'react-dom',
    'react-dom/client',
    '@xstate/react',
    'lucide-react',
    'use-sync-external-store',
    'use-sync-external-store/shim',
    'use-sync-external-store/shim/with-selector',
    'xstate',
    'zustand',
    'zustand/*',
  ],
  esbuildPlugins: [emptyNodeBuiltinPlugin],
  esbuildOptions(options) {
    options.conditions = ['development', ...(options.conditions ?? [])];
    options.alias = {
      ...options.alias,
      '@rust-bridge/client': resolve(__dirname, '../../infra/rust-bridge/client/src/index.ts'),
      '@mog-sdk/kernel/host-lifecycle-internal': resolve(
        __dirname,
        '../../kernel/src/host-lifecycle-internal.ts',
      ),
      '@mog-sdk/kernel/app-api': resolve(__dirname, '../../kernel/src/api/app/index.ts'),
      '@mog-sdk/kernel/keyboard': resolve(__dirname, '../../kernel/src/keyboard/index.ts'),
      '@mog-sdk/kernel/security': resolve(__dirname, '../../kernel/src/security/index.ts'),
      '@mog-sdk/kernel/storage': resolve(__dirname, '../../kernel/src/storage/index.ts'),
      '@mog-sdk/kernel': resolve(__dirname, '../../kernel/src/index.ts'),
      '@mog-sdk/sheet-view': resolve(__dirname, '../../views/sheet-view/src/index.ts'),
    };
  },
});
