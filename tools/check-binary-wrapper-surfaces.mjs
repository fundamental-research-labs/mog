#!/usr/bin/env node

// Gate: check:binary-wrapper-surfaces
//
// Classifies WASM and native binary wrapper exports against the host
// boundary disposition model. Raw authority surfaces (principal mutation,
// Yrs/CRDT state, import/export bytes, raw workbook data) must be
// explicitly classified; unclassified raw-authority exports fail the check.
//
// Reads package-inventory.jsonc for binary-wrapper packages, then scans
// generated .d.ts files in compute/wasm/npm/ (and compute/napi/ if present).
// No build step required beyond wasm-pack having run.
//
// Usage:
//   pnpm check:binary-wrapper-surfaces          # verifies and refreshes outside CI
//   pnpm update:binary-wrapper-surfaces

import { readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');
const UPDATE_MODE = process.argv.includes('--update');
const CI_MODE = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
const AUTO_UPDATE_MODE = !UPDATE_MODE && !CI_MODE;
const UPDATE_COMMAND = 'pnpm update:binary-wrapper-surfaces';

// ── JSONC loader ────────────────────────────────────────────────────────

function loadJsonc(filePath) {
  const raw = readFileSync(filePath, 'utf-8');
  const stripped = raw.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const noTrailingCommas = stripped.replace(/,\s*([\]}])/g, '$1');
  return JSON.parse(noTrailingCommas);
}

// ── Raw authority pattern matchers ──────────────────────────────────────
// Each entry: { category, patterns (tested against export name), requiredDisposition }

const RAW_AUTHORITY_RULES = [
  {
    category: 'raw-principal-mutation',
    patterns: [
      /set_active_principal/i,
      /setActivePrincipal/,
      /make_principal/i,
      /makePrincipal/,
      /active_principal/i,
      /activePrincipal/,
    ],
    allowed: ['cooperative-legacy', 'trusted-adapter-only'],
  },
  {
    category: 'raw-yrs-crdt-state',
    patterns: [
      /yrs_state/i,
      /sync_update/i,
      /state_vector/i,
      /apply_update/i,
      /encode_state/i,
      /decode_update/i,
      /apply_sync_update/i,
      /current_state_vector/i,
      /encode_diff/i,
      /encode_state_vector/i,
      /sync_full_state/i,
      /drain_pending_updates/i,
      /init_from_yrs/i,
      /settle_for_mirror/i,
      /_yrs$/i,
      /_yrs_/i,
    ],
    allowed: ['cooperative-legacy', 'authorized-materialization-api'],
  },
  {
    category: 'raw-import-export-bytes',
    patterns: [
      /to_xlsx/i,
      /from_xlsx/i,
      /import_bytes/i,
      /export_bytes/i,
      /export_to_xlsx_bytes/i,
      /import_from_xlsx_bytes/i,
      /import_from_csv_bytes/i,
      /import_sheets_from_xlsx/i,
      /xlsx_parse_lazy/i,
      /snapshot/i,
    ],
    allowed: ['cooperative-legacy', 'authorized-materialization-api'],
  },
  {
    category: 'raw-workbook-data',
    patterns: [
      /get_cell_value/i,
      /set_cell_value/i,
      /get_cell_data/i,
      /get_raw_cell_data/i,
      /get_raw_value/i,
      /set_cell$/i,
      /set_cell_binary/i,
      /batch_set_cells/i,
      /batch_clear_cells/i,
      /get_cells_in_range/i,
      /get_range_values/i,
      /get_display_text/i,
      /get_display_value/i,
      /get_effective_value/i,
      /get_value_for_editing/i,
      /get_all_cells/i,
      /import_values/i,
    ],
    allowed: ['cooperative-legacy'],
  },
];

// ── Inline disposition map ──────────────────────────────────────────────
// Known exports and their host-boundary classification.
// "cooperative-legacy" = currently raw but tracked for future wrapping.

const KNOWN_DISPOSITIONS = {
  // Principal mutation
  compute_set_active_principal: 'cooperative-legacy',
  compute_make_principal: 'cooperative-legacy',
  compute_active_principal: 'cooperative-legacy',

  // Yrs / CRDT state
  compute_apply_sync_update: 'cooperative-legacy',
  compute_current_state_vector: 'cooperative-legacy',
  compute_encode_diff: 'cooperative-legacy',
  compute_encode_state_vector: 'cooperative-legacy',
  compute_sync_full_state: 'cooperative-legacy',
  compute_drain_pending_updates: 'cooperative-legacy',
  compute_init_from_yrs_state: 'cooperative-legacy',
  compute_settle_for_mirror: 'cooperative-legacy',
  compute_get_all_cells_yrs: 'cooperative-legacy',
  compute_get_cell_id_at_yrs: 'cooperative-legacy',
  compute_get_cells_in_range_yrs: 'cooperative-legacy',
  compute_relocate_cells_yrs: 'cooperative-legacy',

  // Import/export bytes
  compute_export_to_xlsx_bytes: 'cooperative-legacy',
  compute_import_from_xlsx_bytes: 'cooperative-legacy',
  compute_import_from_xlsx_bytes_deferred: 'cooperative-legacy',
  compute_import_from_csv_bytes: 'cooperative-legacy',
  compute_import_sheets_from_xlsx: 'cooperative-legacy',
  xlsx_parse_lazy: 'cooperative-legacy',
  xlsx_parse_lazy_with_mode: 'cooperative-legacy',
  compute_add_compute_sheet: 'cooperative-legacy',

  // Raw workbook data access
  compute_get_cell_value: 'cooperative-legacy',
  compute_set_cell: 'cooperative-legacy',
  compute_set_cell_binary: 'cooperative-legacy',
  compute_set_cell_value_as_text: 'cooperative-legacy',
  compute_set_cell_value_parsed: 'cooperative-legacy',
  compute_set_cell_values_parsed: 'cooperative-legacy',
  compute_batch_set_cells: 'cooperative-legacy',
  compute_batch_set_cells_by_position: 'cooperative-legacy',
  compute_batch_clear_cells: 'cooperative-legacy',
  compute_get_cell_data: 'cooperative-legacy',
  compute_get_cell_data_by_id_hex: 'cooperative-legacy',
  compute_get_raw_cell_data: 'cooperative-legacy',
  compute_get_raw_value: 'cooperative-legacy',
  compute_get_cells_in_range: 'cooperative-legacy',
  compute_get_range_values_2d: 'cooperative-legacy',
  compute_get_display_text_2d: 'cooperative-legacy',
  compute_get_display_value: 'cooperative-legacy',
  compute_get_effective_value: 'cooperative-legacy',
  compute_get_value_for_editing: 'cooperative-legacy',
  compute_get_all_cells_yrs: 'cooperative-legacy',
  compute_import_values: 'cooperative-legacy',
  compute_set_cells_batch: 'cooperative-legacy',
};

// ── Discover binary-wrapper packages ────────────────────────────────────

function discoverDtsFiles() {
  const inventory = loadJsonc(join(ROOT, 'tools/package-inventory.jsonc'));
  const binaryWrappers = Object.entries(inventory)
    .filter(([, meta]) => meta.disposition === 'binary-wrapper')
    .map(([name]) => name);

  // Known paths to scan for generated .d.ts
  const scanDirs = [join(ROOT, 'compute/wasm/npm'), join(ROOT, 'compute/napi')];

  const results = [];

  for (const dir of scanDirs) {
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.d.ts') && !f.includes('_bg.wasm.d.ts'))
      .sort();
    for (const f of files) {
      results.push({ dir, file: f, path: join(dir, f) });
    }
  }

  return { binaryWrappers, dtsFiles: results };
}

function discoverNativePackageManifests() {
  const nativePkgDir = join(ROOT, 'compute/napi/npm');
  if (!existsSync(nativePkgDir)) {
    return [];
  }
  return readdirSync(nativePkgDir)
    .sort()
    .map((entry) => join(nativePkgDir, entry, 'package.json'))
    .filter((manifestPath) => existsSync(manifestPath));
}

function validateNativePackageManifest(manifestPath, binaryWrappers) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  const relPath = relative(ROOT, manifestPath);
  const failures = [];

  if (!binaryWrappers.includes(manifest.name)) {
    failures.push(`${relPath}: package ${manifest.name} is not classified as binary-wrapper`);
  }
  if (typeof manifest.main !== 'string' || !manifest.main.endsWith('.node')) {
    failures.push(`${relPath}: main must point at a .node binary`);
  }
  if (Object.prototype.hasOwnProperty.call(manifest, 'types')) {
    failures.push(`${relPath}: native binary wrapper must not publish TypeScript declarations`);
  }
  if (Object.prototype.hasOwnProperty.call(manifest, 'exports')) {
    failures.push(`${relPath}: native binary wrapper must not publish additional exports`);
  }
  if (
    !Array.isArray(manifest.files) ||
    manifest.files.length !== 1 ||
    manifest.files[0] !== manifest.main
  ) {
    failures.push(`${relPath}: files must contain exactly the native binary main`);
  }

  return {
    manifest,
    relPath,
    failures,
  };
}

// ── Extract exports from a .d.ts file ───────────────────────────────────

function extractExports(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const exports = [];
  // Match: export function name(, export class name, export const name,
  // export type name, export interface name, export enum name
  const re =
    /^export\s+(?:function|class|const|type|interface|enum)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/gm;
  let m;
  while ((m = re.exec(content)) !== null) {
    exports.push(m[1]);
  }
  return exports;
}

// ── Classify a single export name ───────────────────────────────────────

function classify(name) {
  // Check inline disposition map first
  if (KNOWN_DISPOSITIONS[name]) {
    return { disposition: KNOWN_DISPOSITIONS[name], source: 'known' };
  }

  // Check if it matches any raw-authority pattern
  for (const rule of RAW_AUTHORITY_RULES) {
    for (const pat of rule.patterns) {
      if (pat.test(name)) {
        return {
          disposition: 'unclassified',
          source: 'pattern-match',
          category: rule.category,
          allowed: rule.allowed,
        };
      }
    }
  }

  // wbindgen internals: safe to ignore
  if (name.startsWith('__wbindgen') || name === 'initSync' || name === 'wasm_start') {
    return { disposition: 'wasm-internal', source: 'auto' };
  }

  // Everything else: general compute API surface (not raw authority)
  return { disposition: 'cooperative-legacy', source: 'default' };
}

function sameDispositionEntry(a, b) {
  return (
    a?.disposition === b?.disposition &&
    a?.category === b?.category &&
    Object.keys(a ?? {}).length === Object.keys(b ?? {}).length
  );
}

function dispositionDiff(currentData, expectedData) {
  const currentNames = new Set(Object.keys(currentData));
  const expectedNames = new Set(Object.keys(expectedData));

  const added = [...expectedNames].filter((name) => !currentNames.has(name)).sort();
  const removed = [...currentNames].filter((name) => !expectedNames.has(name)).sort();
  const changed = [...expectedNames]
    .filter((name) => currentNames.has(name))
    .filter((name) => !sameDispositionEntry(currentData[name], expectedData[name]))
    .sort();

  return { added, removed, changed };
}

function printLimitedList(label, items, format = (item) => item) {
  if (items.length === 0) return;
  const limit = 12;
  console.log(`  ${label} (${items.length}):`);
  for (const item of items.slice(0, limit)) {
    console.log(`    - ${format(item)}`);
  }
  if (items.length > limit) {
    console.log(`    ... and ${items.length - limit} more`);
  }
}

function printStaleDispositionReport(outPath, expectedData, { status = 'FAIL', action } = {}) {
  const relPath = relative(ROOT, outPath);
  let currentData;

  try {
    currentData = loadJsonc(outPath);
  } catch (error) {
    console.log(`\n[${status}] ${relPath} is not readable as JSONC.`);
    console.log(`  ${error.message}`);
    if (action) {
      console.log(`  ${action}`);
    }
    return;
  }

  const diff = dispositionDiff(currentData, expectedData);
  const changedSummary = (name) => {
    const before = currentData[name] ?? {};
    const after = expectedData[name] ?? {};
    const beforeText = before.category
      ? `${before.disposition}/${before.category}`
      : before.disposition;
    const afterText = after.category ? `${after.disposition}/${after.category}` : after.disposition;
    return `${name}: ${beforeText} -> ${afterText}`;
  };

  console.log(`\n[${status}] ${relPath} is stale.`);
  printLimitedList('Added', diff.added);
  printLimitedList('Removed', diff.removed);
  printLimitedList('Changed', diff.changed, changedSummary);

  if (diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0) {
    console.log('  Only generated metadata or formatting changed.');
  }

  if (action) {
    console.log(`  ${action}`);
  }
}

function renderDispositionData(data) {
  const lines = ['{'];

  for (const [name, entry] of Object.entries(data)) {
    lines.push(`  ${JSON.stringify(name)}: {`);
    lines.push(`    "disposition": ${JSON.stringify(entry.disposition)},`);
    if (entry.category) {
      lines.push(`    "category": ${JSON.stringify(entry.category)},`);
    }
    lines.push('  },');
  }

  lines.push('}');
  return lines.join('\n');
}

function writeDispositionInventory(outPath, expectedContent) {
  writeFileSync(outPath, expectedContent);
  console.log(`\nDisposition inventory written to ${relative(ROOT, outPath)}`);
}

// ── Main ────────────────────────────────────────────────────────────────

function main() {
  const wasmPkgDir = join(ROOT, 'compute/wasm/npm');
  if (!existsSync(wasmPkgDir)) {
    console.log('[FAIL] WASM package not built; run pnpm build:public-artifacts first');
    process.exit(1);
  }

  const { binaryWrappers, dtsFiles } = discoverDtsFiles();
  const nativePackageManifests = discoverNativePackageManifests();

  if (dtsFiles.length === 0) {
    console.log(
      '[FAIL] No .d.ts files found in binary-wrapper paths; run pnpm build:public-artifacts first',
    );
    process.exit(1);
  }

  console.log(`Binary-wrapper packages in inventory: ${binaryWrappers.join(', ')}`);
  console.log(`Scanning ${dtsFiles.length} .d.ts file(s)\n`);

  const allClassified = [];
  const counters = {};
  let unclassifiedRawAuthority = [];
  let manifestFailures = [];

  for (const { path: dtsPath, file } of dtsFiles) {
    const exports = extractExports(dtsPath);
    const relPath = relative(ROOT, dtsPath);
    console.log(`  ${relPath}: ${exports.length} exports`);

    for (const name of exports) {
      const result = classify(name);
      const entry = { name, file, ...result };
      allClassified.push(entry);
      counters[result.disposition] = (counters[result.disposition] || 0) + 1;

      if (result.disposition === 'unclassified') {
        unclassifiedRawAuthority.push(entry);
      }
    }
  }

  for (const manifestPath of nativePackageManifests) {
    const { manifest, relPath, failures } = validateNativePackageManifest(
      manifestPath,
      binaryWrappers,
    );
    console.log(`  ${relPath}: native binary package`);
    manifestFailures = manifestFailures.concat(failures);
    const entry = {
      name: `native-package:${manifest.name}`,
      file: relPath,
      disposition: 'native-binary-wrapper',
      source: 'package-manifest',
    };
    allClassified.push(entry);
    counters[entry.disposition] = (counters[entry.disposition] || 0) + 1;
  }

  // ── Report ──────────────────────────────────────────────────────────

  const total = allClassified.length;
  console.log(`\nTotal exports: ${total}`);
  console.log('Classification breakdown:');
  for (const [disp, count] of Object.entries(counters).sort()) {
    const pct = ((count / total) * 100).toFixed(1);
    console.log(`  ${disp}: ${count} (${pct}%)`);
  }

  if (unclassifiedRawAuthority.length > 0) {
    console.log(
      `\n[FAIL] ${unclassifiedRawAuthority.length} raw-authority export(s) are unclassified:`,
    );
    for (const e of unclassifiedRawAuthority) {
      console.log(`  - ${e.name}  (${e.category}, allowed: ${e.allowed.join(' | ')})`);
    }
  } else {
    console.log('\n[OK] All raw-authority exports are classified.');
  }

  if (manifestFailures.length > 0) {
    console.log(`\n[FAIL] ${manifestFailures.length} native binary package manifest issue(s):`);
    for (const failure of manifestFailures) {
      console.log(`  - ${failure}`);
    }
  } else {
    console.log('[OK] Native binary packages expose only platform .node wrappers.');
  }

  // ── Write disposition file ──────────────────────────────────────────

  const dispositionData = {};
  for (const entry of allClassified) {
    dispositionData[entry.name] = {
      disposition: entry.disposition,
      ...(entry.category ? { category: entry.category } : {}),
    };
  }

  const outPath = join(ROOT, 'tools/binary-wrapper-surface-disposition.jsonc');
  const expectedContent = [
    '// Auto-generated by check-binary-wrapper-surfaces.mjs',
    `// Do not edit manually. Re-run: ${UPDATE_COMMAND}`,
    '//',
    `// Total exports: ${total}`,
    renderDispositionData(dispositionData),
    '',
  ].join('\n');
  const hasContractFailures = unclassifiedRawAuthority.length > 0 || manifestFailures.length > 0;

  if (UPDATE_MODE) {
    writeDispositionInventory(outPath, expectedContent);
  } else if (!existsSync(outPath)) {
    if (AUTO_UPDATE_MODE && !hasContractFailures) {
      writeDispositionInventory(outPath, expectedContent);
    } else {
      console.log(
        `\n[FAIL] Missing ${relative(ROOT, outPath)}. Regenerate with: ${UPDATE_COMMAND}`,
      );
      process.exit(1);
    }
  } else {
    const currentContent = readFileSync(outPath, 'utf-8');
    if (currentContent !== expectedContent) {
      if (AUTO_UPDATE_MODE && !hasContractFailures) {
        printStaleDispositionReport(outPath, dispositionData, {
          status: 'FIXED',
          action: 'Regenerated inventory. Review and commit the diff.',
        });
        writeFileSync(outPath, expectedContent);
      } else {
        printStaleDispositionReport(outPath, dispositionData, {
          action: `Regenerate with: ${UPDATE_COMMAND}`,
        });
        process.exit(1);
      }
    } else {
      console.log(`\nDisposition inventory is current: ${relative(ROOT, outPath)}`);
    }
  }

  process.exit(hasContractFailures ? 1 : 0);
}

main();
