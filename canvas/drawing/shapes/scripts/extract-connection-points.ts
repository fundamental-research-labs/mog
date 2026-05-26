#!/usr/bin/env tsx
/**
 * Extract connection point (cxnLst) data from OOXML presetShapeDefinitions.xml
 * and merge it into the existing preset-shape-data.json.
 *
 * Usage:
 *   npx tsx canvas/drawing/shapes/scripts/extract-connection-points.ts
 *
 * Reads:  file-io/ooxml/spec/ecma-376/part1/presetShapeDefinitions.xml
 * Updates: canvas/drawing/shapes/src/presets/preset-shape-data.json
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { XMLParser } from 'fast-xml-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..');
const XML_PATH = join(
  REPO_ROOT,
  'os',
  'file-io',
  'ooxml',
  'spec',
  'ecma-376',
  'part1',
  'presetShapeDefinitions.xml',
);
const JSON_PATH = join(__dirname, '..', 'src', 'presets', 'preset-shape-data.json');

// ─── Types ──────────────────────────────────────────────────────────────────

interface ConnectionPoint {
  ang: string;
  x: string;
  y: string;
}

// ─── Parse XML ──────────────────────────────────────────────────────────────

const xmlContent = readFileSync(XML_PATH, 'utf-8');

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // Preserve text content
  textNodeName: '#text',
  // Always parse as array for consistency on lists
  isArray: (name: string) => {
    return name === 'cxn';
  },
});

const parsed = parser.parse(xmlContent);
const root = parsed['presetShapeDefinitons']; // note: typo in the actual XML

if (!root) {
  console.error('ERROR: Could not find <presetShapeDefinitons> root element');
  process.exit(1);
}

// ─── Extract cxnLst for each shape ──────────────────────────────────────────

const cxnData: Record<string, ConnectionPoint[]> = {};
let shapesWithCxn = 0;
let totalCxnPoints = 0;

for (const [shapeName, shapeDef] of Object.entries(root)) {
  if (typeof shapeDef !== 'object' || shapeDef === null) continue;

  const shape = shapeDef as Record<string, unknown>;
  const cxnLst = shape['cxnLst'] as Record<string, unknown> | undefined;
  if (!cxnLst) continue;

  const cxnEntries = cxnLst['cxn'];
  if (!cxnEntries) continue;

  const cxnArray = Array.isArray(cxnEntries) ? cxnEntries : [cxnEntries];
  const points: ConnectionPoint[] = [];

  for (const cxn of cxnArray) {
    const ang = cxn['@_ang'] as string;
    const pos = cxn['pos'] as Record<string, string> | undefined;
    if (!pos) continue;

    const x = pos['@_x'] as string;
    const y = pos['@_y'] as string;

    if (ang !== undefined && x !== undefined && y !== undefined) {
      points.push({ ang, x, y });
    }
  }

  if (points.length > 0) {
    cxnData[shapeName] = points;
    shapesWithCxn++;
    totalCxnPoints += points.length;
  }
}

console.log(
  `Extracted cxnLst from ${shapesWithCxn} shapes (${totalCxnPoints} total connection points)`,
);

// ─── Merge into existing JSON ───────────────────────────────────────────────

const existingJson = JSON.parse(readFileSync(JSON_PATH, 'utf-8')) as Record<
  string,
  Record<string, unknown>
>;

let merged = 0;
let skipped = 0;

for (const [shapeName, points] of Object.entries(cxnData)) {
  if (existingJson[shapeName]) {
    existingJson[shapeName]['cxnLst'] = points;
    merged++;
  } else {
    // Shape exists in XML but not in our JSON (shouldn't happen normally)
    skipped++;
    console.warn(`  Warning: shape "${shapeName}" has cxnLst but is not in preset-shape-data.json`);
  }
}

console.log(`Merged cxnLst into ${merged} shapes in preset-shape-data.json`);
if (skipped > 0) {
  console.log(`Skipped ${skipped} shapes not found in JSON`);
}

// ─── Write updated JSON ─────────────────────────────────────────────────────

writeFileSync(JSON_PATH, JSON.stringify(existingJson, null, 2) + '\n', 'utf-8');
console.log(`Updated ${JSON_PATH}`);
