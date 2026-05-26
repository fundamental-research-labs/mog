import { copyFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EMBED_ROOT = resolve(__dirname, '..');
const DIST = resolve(EMBED_ROOT, 'dist');
const wasmSourceDir = resolve(EMBED_ROOT, '../../compute/wasm/npm');

for (const file of ['compute_core_wasm_bg.wasm', 'compute_core_wasm_bg.wasm.br']) {
  const source = resolve(wasmSourceDir, file);
  if (!existsSync(source)) continue;
  copyFileSync(source, resolve(DIST, file));
}
