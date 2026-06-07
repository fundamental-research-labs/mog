import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
const packageJsonPath = join(packageDir, 'package.json');
const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));

const requiredFiles = [
  'compute_chart_render_wasm.js',
  'compute_chart_render_wasm_bg.wasm',
  'compute_chart_render_wasm.d.ts',
  'compute_chart_render_wasm_bg.wasm.d.ts',
];

for (const file of requiredFiles) {
  if (!packageJson.files.includes(file)) {
    throw new Error(`package.json files[] is missing ${file}`);
  }
  await readFile(join(packageDir, file));
}

if (packageJson.exports?.['./wasm'] !== './compute_chart_render_wasm_bg.wasm') {
  throw new Error('package.json must export ./wasm as the raw chart raster wasm artifact');
}

const declarations = await readFile(join(packageDir, 'compute_chart_render_wasm.d.ts'), 'utf8');
for (const expected of [
  'export class RenderChartMarksImageResult',
  'export function render_chart_marks_image',
  'WebAssembly.Module',
]) {
  if (!declarations.includes(expected)) {
    throw new Error(`generated declarations are missing ${expected}`);
  }
}

const module = await import(pathToFileURL(join(packageDir, 'compute_chart_render_wasm.js')));
const wasmBytes = await readFile(join(packageDir, 'compute_chart_render_wasm_bg.wasm'));
await module.default({
  module_or_path: wasmBytes.buffer.slice(
    wasmBytes.byteOffset,
    wasmBytes.byteOffset + wasmBytes.byteLength,
  ),
});

const result = module.render_chart_marks_image(
  JSON.stringify({
    version: 1,
    marks: [
      {
        type: 'rect',
        x: 1,
        y: 1,
        width: 6,
        height: 4,
        style: { fill: '#ff0000' },
      },
    ],
    options: {
      kind: 'raster',
      format: 'png',
      mimeType: 'image/png',
      width: 8,
      height: 6,
      pixelRatio: 1,
      physicalWidth: 8,
      physicalHeight: 6,
      backgroundColor: '#ffffff',
      fittingMode: 'fill',
      frame: {
        exportWidth: 8,
        exportHeight: 6,
        contentX: 0,
        contentY: 0,
        contentWidth: 8,
        contentHeight: 6,
      },
    },
  }),
);

const pngHeader = [137, 80, 78, 71, 13, 10, 26, 10];
if (
  result.format !== 'png' ||
  result.width !== 8 ||
  result.height !== 6 ||
  !pngHeader.every((byte, index) => result.bytes[index] === byte)
) {
  throw new Error('WASM chart raster smoke render did not return an 8x6 PNG');
}
