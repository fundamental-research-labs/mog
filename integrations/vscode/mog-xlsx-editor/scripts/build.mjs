import { copyFile, cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(packageRoot, '../../..');
const spreadsheetAppDist = resolve(repoRoot, 'runtime/spreadsheet-app/dist');
const distDir = resolve(packageRoot, 'dist');
const mediaDir = resolve(packageRoot, 'media');
const watch = process.argv.includes('--watch');

async function copySpreadsheetAppAssets() {
  await rm(mediaDir, { recursive: true, force: true });
  await mkdir(mediaDir, { recursive: true });
  await copyFile(resolve(packageRoot, 'webview/host.css'), resolve(mediaDir, 'host.css'));
  await copyFile(
    resolve(spreadsheetAppDist, 'styles.css'),
    resolve(mediaDir, 'spreadsheet-app.css'),
  );
  await copyFile(
    resolve(spreadsheetAppDist, 'compute_core_wasm_bg.wasm'),
    resolve(mediaDir, 'compute_core_wasm_bg.wasm'),
  );
  await cp(resolve(spreadsheetAppDist, 'assets'), resolve(mediaDir, 'assets'), {
    recursive: true,
  });
}

const sharedOptions = {
  bundle: true,
  sourcemap: true,
  logLevel: 'info',
};

const extensionOptions = {
  ...sharedOptions,
  entryPoints: [resolve(packageRoot, 'src/extension.ts')],
  outfile: resolve(distDir, 'extension.cjs'),
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode', 'exceljs'],
};

const webviewOptions = {
  ...sharedOptions,
  sourcemap: false,
  entryPoints: [resolve(packageRoot, 'webview/index.ts')],
  outfile: resolve(mediaDir, 'webview.js'),
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  define: {
    'process.env.NODE_ENV': '"production"',
  },
};

const e2eOptions = {
  ...sharedOptions,
  entryPoints: [resolve(packageRoot, 'tests/e2e/suite/index.ts')],
  outfile: resolve(distDir, 'e2e/index.cjs'),
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode'],
};

await copySpreadsheetAppAssets();
await mkdir(distDir, { recursive: true });

if (watch) {
  const extensionContext = await esbuild.context(extensionOptions);
  const webviewContext = await esbuild.context(webviewOptions);
  await Promise.all([extensionContext.watch(), webviewContext.watch()]);
  console.log('[mog-xlsx-editor] watching extension and webview bundles');
} else {
  await Promise.all([
    esbuild.build(extensionOptions),
    esbuild.build(webviewOptions),
    esbuild.build(e2eOptions),
  ]);
}
