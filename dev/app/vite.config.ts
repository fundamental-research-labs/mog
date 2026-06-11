import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import svgr from 'vite-plugin-svgr';

import { mogWasmPlugin } from '@mog/vite-wasm-plugin';

/**
 * Dev-only fingerprint injection.
 *
 * Injects `<meta name="app-eval-fingerprint" content="mog-spreadsheet-dev">` into
 * index.html during `vite serve`. app-eval's `preflightUrl` fetches the URL the
 * caller passed via `--url` and looks for this tag to confirm the target is our
 * dev app (and not a random Vite/React project that happens to answer on that
 * port). The `apply: 'serve'` gate is load-bearing: the tag MUST NOT ship to a
 * production bundle. Production builds are checked by ensuring the tag is
 * absent from `dist/index.html`.
 */
function injectFingerprint(): Plugin {
  return {
    name: 'inject-app-eval-fingerprint',
    apply: 'serve', // critical: dev only, never in production bundles
    transformIndexHtml: {
      order: 'pre',
      handler(html: string) {
        return html.replace(
          /<head>/,
          '<head>\n    <meta name="app-eval-fingerprint" content="mog-spreadsheet-dev">',
        );
      },
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), ['VITE_', 'MOG_']);
  const enableHmr = env.MOG_DEV_HMR === '1' || env.MOG_DEV_HMR === 'true';
  const publicRoot = path.resolve(__dirname, '..', '..');

  // Resolver condition selection: honor the `development` export
  // condition so composite workspace packages resolve to `src/*.ts` during
  // `vite dev` (HMR path). Under `vite build` we drop the `conditions`
  // override entirely — Vite's defaults then resolve to `dist/` via the
  // `import` condition. The `command === 'serve'` gate is required: a
  // naive single-list setup leaks `development` into production bundles.
  //
  // VITE_FLEET_BUILD: fleet Docker images pre-build the SPA for static
  // serving (vite dev is too slow in Docker — unbundled ESM causes 30s+
  // SPA boot). When set, resolve to `src/*.ts` in build mode too, since
  // workspace packages don't have dist/ in the Docker image.
  const resolveConditions =
    command === 'serve' || env.VITE_FLEET_BUILD
      ? ['development', 'import', 'module', 'browser', 'default']
      : undefined;

  return {
    plugins: [
      ...mogWasmPlugin(),
      injectFingerprint(),
      react(),
      svgr({
        // Transform SVGs to React components when imported with ?react
        include: '**/*.svg?react',
        svgrOptions: {
          // Ensure SVGs use currentColor and are sized properly
          svgProps: {
            role: 'img',
          },
        },
      }),
    ],
    resolve: {
      conditions: resolveConditions,
      extensions: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.json'],
      alias: {
        // Deduplicate React to prevent multiple copies in monorepo
        react: path.resolve(__dirname, 'node_modules/react'),
        'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
        '@mog-sdk/kernel/app-api': path.resolve(publicRoot, 'kernel/src/api/app/index.ts'),
        // Private friend exports are intentionally stripped from public
        // artifacts and cannot carry a development condition. The dev app
        // still needs the host-backed lifecycle to run against source so
        // app-eval exercises the same kernel code under edit.
        '@mog-sdk/kernel/host-lifecycle-internal': path.resolve(
          publicRoot,
          'kernel/src/host-lifecycle-internal.ts',
        ),
        '@mog/app-spreadsheet/globals.css': path.resolve(
          publicRoot,
          'apps/spreadsheet/src/infra/styles/globals.css',
        ),
      },
    },
    server: {
      port: 3002,
      open: false, // Disabled to allow opening DevTools before page load
      fs: {
        allow: [path.resolve(__dirname, '..', '..'), publicRoot],
      },
      ...(enableHmr ? { hmr: true } : { hmr: false, watch: null }),
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'index.html'),
          devtools: path.resolve(__dirname, 'devtools.html'),
        },
      },
    },
    optimizeDeps: {
      // Don't pre-bundle - let Vite resolve from workspace packages
      exclude: [],
    },
  };
});
