import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, type Plugin } from 'vite';
import svgr from 'vite-plugin-svgr';

import { mogWasmPlugin } from '@mog/vite-wasm-plugin';

/** R2 public URL where the WASM binary is hosted (too large for Pages' 25 MB limit). */
const WASM_CDN_URL =
  'https://pub-dd7bf8dc8e5b4d688814ccf986d41f53.r2.dev/wasm/compute_core_wasm_bg.wasm';

/**
 * Vite plugin that rewrites the WASM binary URL in the wasm-pack glue code
 * to point at R2 CDN instead of a local asset (which exceeds Pages' 25 MB limit).
 */
function rewriteWasmUrl(): Plugin {
  return {
    name: 'rewrite-wasm-url',
    enforce: 'pre',
    transform(code, id) {
      // Only transform the wasm-pack JS glue file
      if (!id.includes('compute_core_wasm.js')) return null;

      // Replace the URL constructor that resolves the .wasm file relative to import.meta.url
      // with a direct URL to the R2-hosted binary
      const transformed = code.replace(
        /new URL\(['"]compute_core_wasm_bg\.wasm['"],\s*import\.meta\.url\)/g,
        `new URL('${WASM_CDN_URL}')`,
      );

      if (transformed === code) {
        console.warn('[rewrite-wasm-url] No WASM URL pattern found to replace!');
        return null;
      }

      console.log('[rewrite-wasm-url] Rewrote WASM binary URL to R2 CDN');
      return { code: transformed, map: null };
    },
  };
}

/**
 * Playground Vite config — builds only the main spreadsheet app (no devtools).
 * Used for Cloudflare Pages deployment. WASM binary is loaded from R2 CDN.
 */
export default defineConfig(({ command }) => ({
  plugins: [
    ...mogWasmPlugin(),
    rewriteWasmUrl(),
    react(),
    svgr({
      include: '**/*.svg?react',
      svgrOptions: {
        svgProps: {
          role: 'img',
        },
      },
    }),
  ],
  resolve: {
    // Use `development` condition for both serve and build so @mog/* packages
    // resolve to source (bypassing dist/ which may not be built).
    conditions: ['development', 'import', 'module', 'browser', 'default'],
    alias: {
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'playground.html'),
      },
    },
    assetsInlineLimit: 0,
  },
  optimizeDeps: {
    exclude: [],
  },
}));
