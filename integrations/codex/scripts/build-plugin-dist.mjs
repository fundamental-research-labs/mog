import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(packageRoot, '../..');
const pluginRoot = resolve(repoRoot, 'plugins/mog');
const spreadsheetAppDist = resolve(repoRoot, 'runtime/spreadsheet-app/dist');
const browserRoot = resolve(pluginRoot, 'dist/browser');
const browserAssets = resolve(browserRoot, 'assets');
const mcpRoot = resolve(pluginRoot, 'dist/mcp');
const wasmPackageJson = JSON.parse(
  await readFile(resolve(repoRoot, 'compute/wasm/npm/package.json'), 'utf8'),
);
const wasmPackageBaseUrl = `https://cdn.jsdelivr.net/npm/@mog-sdk/wasm@${wasmPackageJson.version}/`;
const importMap = {
  imports: {
    '@mog-sdk/wasm': `${wasmPackageBaseUrl}compute_core_wasm.js`,
  },
};
const importMapJson = JSON.stringify(importMap, null, 2);

function stripVendoredFontFaces(css) {
  return css.replace(/@font-face\{[^{}]*url\([^)]*\.(?:ttf|otf|woff2?)[^{}]*\}/gi, '');
}

await rm(resolve(pluginRoot, 'dist'), { recursive: true, force: true });
await mkdir(browserAssets, { recursive: true });
await mkdir(mcpRoot, { recursive: true });

await writeFile(
  resolve(browserRoot, 'index.html'),
  `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' data: blob:; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cdn.jsdelivr.net; connect-src 'self' https://cdn.jsdelivr.net; worker-src 'self' blob:;">
  <link rel="stylesheet" href="/assets/spreadsheet-app.css">
  <link rel="stylesheet" href="/assets/host.css">
  <title>Mog Spreadsheet</title>
</head>
<body>
  <div id="root" data-mog-codex-state="loading"></div>
  <script type="importmap">${importMapJson}</script>
  <script type="module" src="/assets/browser.js"></script>
</body>
</html>
`,
);

const spreadsheetCss = await readFile(resolve(spreadsheetAppDist, 'styles.css'), 'utf8');

await Promise.all([
  writeFile(resolve(browserAssets, 'spreadsheet-app.css'), stripVendoredFontFaces(spreadsheetCss)),
  copyFile(resolve(packageRoot, 'src/browser/host.css'), resolve(browserAssets, 'host.css')),
  writeFile(resolve(browserAssets, 'import-map.json'), importMapJson),
]);

const shared = {
  bundle: true,
  sourcemap: false,
  logLevel: 'info',
  define: {
    'process.env.NODE_ENV': '"production"',
  },
};

await Promise.all([
  esbuild.build({
    ...shared,
    entryPoints: [resolve(packageRoot, 'src/mcp/server.ts')],
    outfile: resolve(mcpRoot, 'server.mjs'),
    platform: 'node',
    format: 'esm',
    target: 'node18',
    banner: {
      js: '#!/usr/bin/env node',
    },
  }),
  esbuild.build({
    ...shared,
    entryPoints: [resolve(packageRoot, 'src/browser/App.ts')],
    outfile: resolve(browserAssets, 'browser.js'),
    platform: 'browser',
    format: 'esm',
    target: 'es2022',
    external: ['@mog-sdk/wasm'],
  }),
]);
