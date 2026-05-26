import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import mogScope from './postcss-mog-scope.mjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(packageRoot, '../..');
const distDir = resolve(packageRoot, 'dist');
const assetsDir = resolve(distDir, 'assets');

const fontFiles = [
  'Carlito-Regular.ttf',
  'Carlito-Bold.ttf',
  'Carlito-Italic.ttf',
  'Carlito-BoldItalic.ttf',
  'Caladea-Regular.ttf',
  'Caladea-Bold.ttf',
  'Caladea-Italic.ttf',
  'Caladea-BoldItalic.ttf',
];

await mkdir(assetsDir, { recursive: true });

await Promise.all([
  copyFile(
    resolve(repoRoot, 'compute/wasm/npm/compute_core_wasm_bg.wasm'),
    resolve(distDir, 'compute_core_wasm_bg.wasm'),
  ),
  ...fontFiles.map((file) =>
    copyFile(resolve(repoRoot, 'compute/core/fonts', file), resolve(assetsDir, file)),
  ),
]);

const stylesPath = resolve(distDir, 'styles.css');
let styles = await readFile(stylesPath, 'utf8');

for (const file of fontFiles) {
  styles = styles.replaceAll(`../../../../../compute/core/fonts/${file}`, `./assets/${file}`);
}

// Strip Tailwind-generated `bg-[url(...)]` utility — it produces a bare
// `url(...)` value that webpack (Next.js) incorrectly tries to resolve as a
// file path.  The class is never used at runtime.
styles = styles.replaceAll('.bg-\\[url\\(\\.\\.\\.\\)\\]{background-image:url(...)}', '');

await writeFile(stylesPath, styles);

// Build mog-embed.css — all selectors scoped to [data-mog-engine].
// Hosts import this single file unlayered. Scoping prevents class-name
// collisions without needing CSS @layer isolation.
const scoped = await postcss([mogScope]).process(styles, { from: stylesPath });
await writeFile(resolve(distDir, 'mog-embed.css'), scoped.css);
