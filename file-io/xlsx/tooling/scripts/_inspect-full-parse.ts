#!/usr/bin/env npx tsx
/**
 * Quick inspection script to see what parse_xlsx_full returns.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const scriptDir = dirname(new URL(import.meta.url).pathname);
const pkgDir = join(scriptDir, '..', '..', '..', '..', 'compute', 'wasm', 'npm');
const wasmPath = join(pkgDir, 'compute_core_wasm_bg.wasm');
const jsModulePath = join(pkgDir, 'compute_core_wasm.js');

const wasmBytes = readFileSync(wasmPath);
const wasmJsModule = await import(pathToFileURL(jsModulePath).href);
await wasmJsModule.default(wasmBytes);

const xlsxPath = process.argv[2];
if (!xlsxPath) {
  console.error('Usage: tsx _inspect-full-parse.ts <path-to-xlsx>');
  process.exit(1);
}

const xlsxData = readFileSync(xlsxPath);
const result = wasmJsModule.parse_xlsx_full(new Uint8Array(xlsxData));

// Dump raw keys to understand snake_case vs camelCase
console.log('Top-level keys:', Object.keys(result));
console.log();

// Check if styles/theme are strings
console.log('typeof styles:', typeof result.styles);
console.log('typeof theme:', typeof result.theme);
if (typeof result.styles === 'string') {
  console.log('Styles (first 1000 chars):', (result.styles as string).slice(0, 1000));
}
if (typeof result.theme === 'string') {
  console.log('Theme (full):', result.theme);
}

// Parse styles if it's a string
let styles: any = result.styles;
if (typeof styles === 'string') {
  styles = JSON.parse(styles);
}
if (styles) {
  console.log('\nParsed styles keys:', Object.keys(styles));
  // Try snake_case
  const numFmts = styles.number_formats ?? styles.numberFormats;
  const fonts = styles.fonts;
  const fills = styles.fills;
  const borders = styles.borders;
  const cellXfs = styles.cell_xfs ?? styles.cellXfs;
  console.log('  number_formats:', numFmts?.length);
  console.log('  fonts:', fonts?.length);
  console.log('  fills:', fills?.length);
  console.log('  borders:', borders?.length);
  console.log('  cell_xfs:', cellXfs?.length);

  if (fonts?.length > 0) {
    console.log('\n  First 3 fonts:');
    for (let i = 0; i < Math.min(3, fonts.length); i++) {
      console.log(`    font[${i}]:`, JSON.stringify(fonts[i]));
    }
  }
  if (fills?.length > 0) {
    console.log('\n  First 5 fills:');
    for (let i = 0; i < Math.min(5, fills.length); i++) {
      console.log(`    fill[${i}]:`, JSON.stringify(fills[i]));
    }
  }
  if (numFmts?.length > 0) {
    console.log('\n  Number formats:');
    for (const nf of numFmts) {
      console.log(`    nf:`, JSON.stringify(nf));
    }
  }
  if (cellXfs?.length > 0) {
    console.log('\n  First 5 cellXfs:');
    for (let i = 0; i < Math.min(5, cellXfs.length); i++) {
      console.log(`    xf[${i}]:`, JSON.stringify(cellXfs[i]));
    }
  }
}

// Check theme
let theme: any = result.theme;
if (typeof theme === 'string') {
  theme = JSON.parse(theme);
}
if (theme) {
  console.log('\nParsed theme keys:', Object.keys(theme));
  console.log('  Theme:', JSON.stringify(theme).slice(0, 1000));
}

// Check sheets
if (result.sheets?.[0]) {
  const s = result.sheets[0];
  console.log('\nSheet keys:', Object.keys(s));
  console.log(`Sheet 0: "${s.name}" cells: ${s.cells?.length}`);

  // Show first 5 cells with full detail
  for (let i = 0; i < Math.min(5, s.cells?.length ?? 0); i++) {
    console.log(`  cell[${i}]:`, JSON.stringify(s.cells[i]));
  }
}
