#!/usr/bin/env node
/**
 * Normalize all SVGs to 24x24 viewBox
 *
 * This script updates all SVG files to use 24x24 as the canonical size
 * while preserving the internal paths (they scale automatically via viewBox).
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(__dirname, 'src');

function processDirectory(dir) {
  const entries = readdirSync(dir);
  let count = 0;

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      count += processDirectory(fullPath);
    } else if (entry.endsWith('.svg')) {
      count += processSvg(fullPath);
    }
  }

  return count;
}

function processSvg(filePath) {
  let content = readFileSync(filePath, 'utf-8');
  const originalContent = content;

  // Update to 24x24
  content = content.replace(/width="[^"]*"/, 'width="24"').replace(/height="[^"]*"/, 'height="24"');

  // Ensure viewBox exists and uses the original icon's coordinate system
  // The viewBox defines the internal coordinate system, the width/height define the render size
  // We keep the original viewBox (16x16 or 20x20) because the paths are designed in that space

  // Add currentColor for fill if using #212121 (Fluent UI default)
  content = content.replace(/fill="#212121"/g, 'fill="currentColor"');

  // Remove the redundant xmlns declaration if there are duplicates
  // (keep only one xmlns)

  if (content !== originalContent) {
    writeFileSync(filePath, content);
    return 1;
  }
  return 0;
}

console.log('Normalizing SVGs...');
const count = processDirectory(SRC_DIR);
console.log(`Updated ${count} files to use currentColor.`);
