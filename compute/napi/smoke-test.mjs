/**
 * Smoke test for compute-core-napi native addon.
 *
 * Validates:
 * 1. The .node binary loads in Node.js
 * 2. ComputeEngine class exists and can be constructed
 * 3. Static free functions work (computeSetCurrentTime)
 * 4. Instance methods work (set cell, query range)
 * 5. Formula evaluation works (=A1+A2)
 * 6. Serde JSON round-trip works
 * 7. Multiple instances can coexist
 * 8. Quick serde overhead measurement (1K set + 1K get)
 *
 * Calling convention notes:
 * - SheetId params are [serde]-tagged → pass JSON.stringify(uuid)
 * - u32 params are [prim]-tagged → pass JS number
 * - &str params are [str]-tagged → pass JS string
 * - set_cell_value_parsed(sheet_id, row, col, input) accepts user text like "10" or "=A1+A2"
 * - Snapshot/query CellValue JSON uses primitive scalar values for numbers/strings/bools
 *
 * Usage: node smoke-test.mjs
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const addon = require('./compute-core-napi.node');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`  FAIL: ${message}`);
    failed++;
  } else {
    console.log(`  PASS: ${message}`);
    passed++;
  }
}

function assertEq(actual, expected, message) {
  if (actual !== expected) {
    console.error(
      `  FAIL: ${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
    failed++;
  } else {
    console.log(`  PASS: ${message}`);
    passed++;
  }
}

/** JSON.stringify a UUID for serde-tagged params. */
const sid = (id) => JSON.stringify(id);

// ---- Constants ----
const SHEET_ID = '00000000-0000-0000-0000-000000000001';
const CELL_A1 = '00000000-0000-0000-0000-000000000101';

function minimalSnapshot(cells = []) {
  return JSON.stringify({
    sheets: [
      {
        id: SHEET_ID,
        name: 'Sheet1',
        rows: 100,
        cols: 26,
        cells,
      },
    ],
  });
}

function unpackMutationResult(value) {
  const buf = Buffer.isBuffer(value) ? value : Buffer.from(value);
  const binaryLen = buf.readUInt32LE(0);
  return JSON.parse(buf.subarray(4 + binaryLen).toString('utf-8'));
}

// =========================================================================
// Test 1: Addon loads and exports expected symbols
// =========================================================================
console.log('\n--- Test 1: Addon loads ---');
assert(addon != null, 'addon loaded');
assert(typeof addon.ComputeEngine === 'function', 'ComputeEngine class exported');
assert(typeof addon.computeSetCurrentTime === 'function', 'computeSetCurrentTime exported');

// =========================================================================
// Test 2: Static free function — computeSetCurrentTime
// =========================================================================
console.log('\n--- Test 2: Static free functions ---');
try {
  addon.computeSetCurrentTime(45292.0);
  assert(true, 'computeSetCurrentTime() did not throw');
} catch (e) {
  assert(false, `computeSetCurrentTime() threw: ${e.message}`);
}

if (typeof addon.computeGetCfPresets === 'function') {
  try {
    const presetsJson = addon.computeGetCfPresets();
    const presets = JSON.parse(presetsJson);
    assert(presets.dataBars != null, 'CF presets have dataBars');
    assert(presets.colorScales != null, 'CF presets have colorScales');
  } catch (e) {
    assert(false, `computeGetCfPresets() threw: ${e.message}`);
  }
}

// =========================================================================
// Test 3: Construct engine from minimal snapshot
// =========================================================================
console.log('\n--- Test 3: Engine construction ---');
let engine;
try {
  engine = new addon.ComputeEngine(minimalSnapshot());
  assert(engine != null, 'engine constructed from empty snapshot');
} catch (e) {
  assert(false, `Engine construction threw: ${e.message}`);
  console.error('Cannot continue without engine');
  process.exit(1);
}

// =========================================================================
// Test 4: Initial range query
// =========================================================================
console.log('\n--- Test 4: Initial range query ---');
try {
  const initialRange = JSON.parse(engine.compute_query_range(sid(SHEET_ID), 0, 0, 1, 1));
  assert(Array.isArray(initialRange.cells), 'initial range query has cells array');
  assertEq(initialRange.cells.length, 0, 'empty snapshot has no materialized cells');
} catch (e) {
  assert(false, `Initial range query threw: ${e.message}`);
}

// =========================================================================
// Test 5: Set cells and verify formula evaluation
// =========================================================================
console.log('\n--- Test 5: Set cell + formula evaluation ---');
try {
  // Set time before recalc operations
  addon.computeSetCurrentTime(45292.0);

  engine.compute_set_cell_value_parsed(sid(SHEET_ID), 0, 0, '10');
  assert(true, 'set A1 = 10');

  engine.compute_set_cell_value_parsed(sid(SHEET_ID), 1, 0, '20');
  assert(true, 'set A2 = 20');

  // Set formula — input starts with "=" so it's parsed as a formula
  // Native write methods return a packed bytes-tuple Buffer: [4-byte LE len][binary][JSON]
  const result = unpackMutationResult(
    engine.compute_set_cell_value_parsed(sid(SHEET_ID), 2, 0, '=A1+A2'),
  );

  const a3Changed = result.recalc?.changedCells?.find(
    (c) => c.position?.row === 2 && c.position?.col === 0,
  );
  assert(a3Changed != null, 'A3 appears in recalc.changedCells');
  assertEq(a3Changed?.value, 30, '=A1+A2 evaluates to 30');
} catch (e) {
  assert(false, `Formula evaluation threw: ${e.message}`);
  console.error(e);
}

// =========================================================================
// Test 6: Range query read (replaces removed JSON viewport)
// =========================================================================
console.log('\n--- Test 6: Range query read ---');
try {
  const rqJson = engine.compute_query_range(sid(SHEET_ID), 0, 0, 3, 1);
  const rq = JSON.parse(rqJson);
  assert(rq.cells != null, 'range query has cells array');
  assert(rq.cells.length >= 2, `range query has ${rq.cells.length} cells (A1, A2 at minimum)`);

  const a1Cell = rq.cells.find((c) => c.row === 0 && c.col === 0);
  assertEq(a1Cell?.value, 10, 'range query A1 = 10');
} catch (e) {
  assert(false, `Range query read threw: ${e.message}`);
}

// =========================================================================
// Test 7: Multiple instances coexist
// =========================================================================
console.log('\n--- Test 7: Multiple instances ---');
try {
  // Create engine2 with A1 = 999 in snapshot
  const engine2 = new addon.ComputeEngine(
    minimalSnapshot([{ cellId: CELL_A1, row: 0, col: 0, value: 999 }]),
  );

  // engine2 A1 should be 999
  const rq2 = JSON.parse(engine2.compute_query_range(sid(SHEET_ID), 0, 0, 1, 1));
  const e2a1 = rq2.cells?.find((c) => c.row === 0 && c.col === 0);
  assertEq(e2a1?.value, 999, 'engine2 A1 = 999 (independent instance)');

  // engine1 A1 should still be 10
  const rq1 = JSON.parse(engine.compute_query_range(sid(SHEET_ID), 0, 0, 1, 1));
  const e1a1 = rq1.cells?.find((c) => c.row === 0 && c.col === 0);
  assertEq(e1a1?.value, 10, 'engine1 A1 = 10 (unchanged by engine2)');
} catch (e) {
  assert(false, `Multiple instances threw: ${e.message}`);
  console.error(e);
}

// =========================================================================
// Test 8: Quick serde overhead measurement
// =========================================================================
console.log('\n--- Test 8: Serde performance (1K round-trips) ---');
try {
  const perfEngine = new addon.ComputeEngine(minimalSnapshot());
  const N = 1000;

  // Warm up
  for (let i = 0; i < 10; i++) {
    perfEngine.compute_set_cell_value_parsed(sid(SHEET_ID), i, 0, String(i));
  }

  // Time 1K parsed cell writes
  const t0 = performance.now();
  for (let i = 0; i < N; i++) {
    perfEngine.compute_set_cell_value_parsed(sid(SHEET_ID), i, 0, String(i * 2));
  }
  const setTime = performance.now() - t0;

  // Time 1K get_viewport calls (single cell each)
  const t1 = performance.now();
  for (let i = 0; i < N; i++) {
    perfEngine.compute_get_effective_value(sid(SHEET_ID), i, 0);
  }
  const getTime = performance.now() - t1;

  const avgSet = ((setTime / N) * 1000).toFixed(1);
  const avgGet = ((getTime / N) * 1000).toFixed(1);
  console.log(`  1K set_cell: ${setTime.toFixed(1)}ms total, ${avgSet}μs/call avg`);
  console.log(`  1K get_value: ${getTime.toFixed(1)}ms total, ${avgGet}μs/call avg`);

  if (setTime / N > 0.1) {
    console.log('  WARNING: set_cell avg > 100μs — serde overhead may be a concern at scale');
  } else {
    console.log('  OK: serde overhead is within acceptable range');
  }
  passed++;
} catch (e) {
  assert(false, `Performance test threw: ${e.message}`);
  console.error(e);
}

// =========================================================================
// Summary
// =========================================================================
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
