#!/usr/bin/env node
/**
 * Fast prerequisite check for generated icon components.
 *
 * The public source projection omits generated TSX files, but `tsc -b` reads
 * `src/index.ts` directly. Keep normal typecheck incremental by doing cheap
 * mtime/existence checks and invoking the full SVGR generator only when needed.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(scriptDir, '..');
const srcDir = join(packageRoot, 'src');
const generatorPath = join(scriptDir, 'generate.mjs');
const indexPath = join(srcDir, 'index.ts');

function svgToPascal(svgFilename) {
  const stem = svgFilename.replace(/\.svg$/, '');
  if (/^\d/.test(stem)) {
    const parts = stem.split('-');
    return (
      parts[0].toUpperCase() +
      parts
        .slice(1)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join('')
    );
  }
  return stem
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function collectSvgInputs() {
  const inputs = [];
  const categories = readdirSync(srcDir)
    .filter((entry) => {
      const fullPath = join(srcDir, entry);
      return statSync(fullPath).isDirectory();
    })
    .sort();

  for (const category of categories) {
    const categoryDir = join(srcDir, category);
    for (const file of readdirSync(categoryDir)
      .filter((entry) => entry.endsWith('.svg'))
      .sort()) {
      const componentName = svgToPascal(file);
      inputs.push({
        svgPath: join(categoryDir, file),
        componentPath: join(categoryDir, `${componentName}.tsx`),
      });
    }
  }

  return inputs;
}

function newestMtimeMs(paths) {
  return Math.max(...paths.map((path) => statSync(path).mtimeMs));
}

function needsGeneration() {
  if (process.argv.includes('--force')) return true;

  const inputs = collectSvgInputs();
  if (inputs.length === 0) return false;

  const inputPaths = [generatorPath, ...inputs.map((input) => input.svgPath)];
  const generatedPaths = [indexPath, ...inputs.map((input) => input.componentPath)];

  if (generatedPaths.some((path) => !existsSync(path))) return true;

  const newestInput = newestMtimeMs(inputPaths);
  const oldestGenerated = Math.min(...generatedPaths.map((path) => statSync(path).mtimeMs));

  return oldestGenerated < newestInput;
}

function assertGenerated() {
  const missing = [];
  for (const input of collectSvgInputs()) {
    if (!existsSync(input.componentPath)) missing.push(input.componentPath);
  }
  if (!existsSync(indexPath)) missing.push(indexPath);

  if (missing.length > 0) {
    throw new Error(`Icon generation did not produce expected files:\n${missing.join('\n')}`);
  }
}

if (needsGeneration()) {
  execFileSync(process.execPath, [generatorPath], {
    cwd: packageRoot,
    stdio: 'inherit',
  });
}

assertGenerated();
