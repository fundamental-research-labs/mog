#!/usr/bin/env node
/**
 * render-icon.mjs
 *
 * Renders an SVG icon to PNG for visual inspection.
 * Used in the agentic icon editing loop: Edit SVG → Render → View → Iterate
 *
 * Usage:
 *   node render-icon.mjs <svg-path> [options]
 *
 * Options:
 *   --out, -o     Output path (default: auto-generated in drafts/)
 *   --bg          Background color (default: white, use 'transparent' for none)
 *   --dpi         DPI multiplier for higher resolution (default: 4)
 *   --version, -v Version label for the draft (e.g., v0.1, v0.2)
 *
 * Examples:
 *   node render-icon.mjs src/clipboard/cut.svg
 *   node render-icon.mjs src/clipboard/cut.svg -v v0.2
 *   node render-icon.mjs src/clipboard/cut.svg --bg transparent --dpi 8
 */

import { Resvg } from '@resvg/resvg-js';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { basename, join, resolve } from 'path';

// Parse arguments
const args = process.argv.slice(2);

if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage: node render-icon.mjs <svg-path> [options]

Options:
  --out, -o     Output path (default: auto-generated in drafts/)
  --bg          Background color (default: white, use 'transparent' for none)
  --dpi         DPI multiplier for sharper rendering (default: 4, meaning 4x)
  --version, -v Version label for the draft (e.g., v0.1, v0.2)

The tool renders icons at multiple sizes (16, 24, 32, 64px) side by side.
With default --dpi 4, this produces a crisp 864x464 image.

Output:
  - PNG saved to drafts/<category>/<icon-name>-<version>.png
  - SVG copied to drafts/<category>/<icon-name>-<version>.svg

Examples:
  node render-icon.mjs src/clipboard/cut.svg
  node render-icon.mjs src/clipboard/cut.svg -v v0.2
  node render-icon.mjs src/clipboard/cut.svg --dpi 8
`);
  process.exit(0);
}

// Parse options
const svgPath = args[0];
let outPath = null;
let bgColor = 'white';
let dpi = 4;
let version = null;

for (let i = 1; i < args.length; i++) {
  const arg = args[i];
  if ((arg === '--out' || arg === '-o') && args[i + 1]) {
    outPath = args[++i];
  } else if (arg === '--bg' && args[i + 1]) {
    bgColor = args[++i];
  } else if (arg === '--dpi' && args[i + 1]) {
    dpi = parseInt(args[++i], 10);
  } else if ((arg === '--version' || arg === '-v') && args[i + 1]) {
    version = args[++i];
  }
}

// Read SVG
const fullPath = resolve(process.cwd(), svgPath);
let svgContent;
try {
  svgContent = readFileSync(fullPath, 'utf-8');
} catch (e) {
  console.error(`Error reading SVG: ${fullPath}`);
  console.error(e.message);
  process.exit(1);
}

// Extract icon name and category from path
// e.g., src/clipboard/cut.svg -> category: clipboard, name: cut
const pathParts = svgPath.split('/');
const iconName = basename(svgPath, '.svg');
const category = pathParts.length >= 3 ? pathParts[pathParts.length - 2] : 'misc';

// Auto-generate version if not provided
if (!version) {
  // Find next version number
  const draftsDir = resolve(process.cwd(), 'drafts', category);
  if (existsSync(draftsDir)) {
    const files = require('fs').readdirSync(draftsDir);
    const escapedName = iconName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const versionPattern = new RegExp(`^${escapedName}-v(\\d+\\.\\d+)\\.png$`);
    let maxVersion = 0;
    for (const file of files) {
      const match = file.match(versionPattern);
      if (match) {
        const v = parseFloat(match[1]);
        if (v > maxVersion) maxVersion = v;
      }
    }
    version = `v${(maxVersion + 0.1).toFixed(1)}`;
  } else {
    version = 'v0.1';
  }
}

// Set up output paths
const draftsDir = resolve(process.cwd(), 'drafts', category);
mkdirSync(draftsDir, { recursive: true });

const pngOutPath = outPath || join(draftsDir, `${iconName}-${version}.png`);
const svgOutPath = join(draftsDir, `${iconName}-${version}.svg`);

// Replace CSS variable references with their fallback values
// resvg doesn't support CSS custom properties, so we extract the fallback
// Pattern: var(--icon-accent-blue, #2563eb) -> #2563eb
function replaceCssVariables(svg) {
  // Match var(--name, fallback) and extract the fallback value
  return svg.replace(/var\(--[^,]+,\s*([^)]+)\)/g, '$1');
}

// Replace currentColor with black for rendering
// In browsers, currentColor inherits from CSS color property
// For standalone SVG rendering, we use black as the default
function replaceCurrentColor(svg) {
  return svg.replace(/currentColor/g, 'black');
}

if (svgContent.includes('var(--')) {
  svgContent = replaceCssVariables(svgContent);
}

if (svgContent.includes('currentColor')) {
  svgContent = replaceCurrentColor(svgContent);
}

/**
 * Create a multi-size preview image at high DPI
 */
function renderMultiSize(svg, background, dpiMultiplier) {
  const sizes = [16, 24, 32, 64];
  const padding = 16;
  const labelHeight = 20;

  // Calculate total canvas size (at 1x)
  const totalWidth = sizes.reduce((sum, s) => sum + s, 0) + padding * (sizes.length + 1);
  const maxSize = Math.max(...sizes);
  const totalHeight = maxSize + padding * 2 + labelHeight;

  // Create a simple SVG canvas with all sizes
  let x = padding;
  let innerSvgs = '';

  for (const s of sizes) {
    // Center vertically
    const y = padding + (maxSize - s) / 2;

    // Extract inner content from SVG (everything inside <svg>...</svg>)
    const innerMatch = svg.match(/<svg[^>]*>([\s\S]*)<\/svg>/i);
    const innerContent = innerMatch ? innerMatch[1] : '';

    // Get viewBox
    const viewBoxMatch = svg.match(/viewBox=["']([^"']+)["']/);
    const viewBox = viewBoxMatch ? viewBoxMatch[1] : '0 0 24 24';

    innerSvgs += `
      <svg x="${x}" y="${y}" width="${s}" height="${s}" viewBox="${viewBox}">
        ${innerContent}
      </svg>
      <text x="${x + s / 2}" y="${totalHeight - 8}" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="11" fill="#666">${s}px</text>
    `;

    x += s + padding;
  }

  const canvasSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${totalHeight}">
      <rect width="100%" height="100%" fill="${background === 'transparent' ? 'none' : background}"/>
      ${innerSvgs}
    </svg>
  `;

  const opts = {
    background: background === 'transparent' ? undefined : background,
    fitTo: {
      mode: 'width',
      value: totalWidth * dpiMultiplier,
    },
    font: {
      loadSystemFonts: true,
    },
  };

  const resvg = new Resvg(canvasSvg, opts);
  return resvg.render();
}

// Render
console.log(`Rendering: ${svgPath}`);
console.log(`  Category: ${category}`);
console.log(`  Version: ${version}`);
console.log(`  DPI: ${dpi}x`);
console.log(`  Background: ${bgColor}`);

const rendered = renderMultiSize(svgContent, bgColor, dpi);
const pngData = rendered.asPng();

// Write outputs
writeFileSync(resolve(process.cwd(), pngOutPath), pngData);
copyFileSync(fullPath, resolve(process.cwd(), svgOutPath));

console.log(`  PNG: ${pngOutPath}`);
console.log(`  SVG: ${svgOutPath}`);
console.log(`  Dimensions: ${rendered.width}x${rendered.height}`);
console.log('Done!');
