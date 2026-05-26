/**
 * Test getRange with formulas — validates the batch_get_cells fix.
 *
 * This is the manual integration test for:
 *   the batch getCells formula readback invariant
 *
 * Bug 1 (ghost cells): getRange() should return computed values for formula cells
 *        (not null). Previously formulas set via setCellsByPosition appeared as
 *        "ghost cells" in the CRDT mirror and were skipped.
 *
 * Bug 2 (formula text): getRange() should return actual formula text (e.g. "=SUM(A1:A3)")
 *        not undefined. Previously the code used edit_text as a proxy for formula text,
 *        which was wrong (edit_text is for date/time editing display).
 *
 *   node run.cjs examples/getrange-test.ts
 */
import type { Workbook } from '../src/index';

export default async function (wb: Workbook) {
  const ws = wb.activeSheet;

  console.log('=== getRange batch_get_cells Integration Test ===\n');

  // ── Setup: values + formulas ──────────────────────────────────────────
  await ws.setCell('A1', 10);
  await ws.setCell('A2', 20);
  await ws.setCell('A3', 30);
  await ws.setCell('A4', '=SUM(A1:A3)');

  await ws.setCell('B1', 'Hello');
  await ws.setCell('B2', true);
  // B3 left empty intentionally
  await ws.setCell('B4', '=A4*2');

  // ── Test 1: getRange returns formula cell values (Bug 1) ──────────────
  console.log('Test 1: Formula cells return computed values');
  const range = await ws.getRange('A1:B4');
  console.log('  Range A1:B4:', JSON.stringify(range, null, 2));

  const a4 = range[3][0]; // row 3 (0-indexed), col 0
  console.log(`  A4 value: ${JSON.stringify(a4.value)} (expected: 60)`);
  console.log(`  A4 formula: ${JSON.stringify(a4.formula)} (expected: "=SUM(A1:A3)")`);

  const b4 = range[3][1];
  console.log(`  B4 value: ${JSON.stringify(b4.value)} (expected: 120)`);
  console.log(`  B4 formula: ${JSON.stringify(b4.formula)} (expected: "=A4*2")`);

  // ── Test 2: Empty cells return {value: null} ──────────────────────────
  console.log('\nTest 2: Empty cells return null');
  const b3 = range[2][1]; // row 2, col 1 — intentionally empty
  console.log(`  B3 value: ${JSON.stringify(b3.value)} (expected: null)`);

  // ── Test 3: Non-formula cells work ────────────────────────────────────
  console.log('\nTest 3: Non-formula cells');
  console.log(`  A1 value: ${JSON.stringify(range[0][0].value)} (expected: 10)`);
  console.log(`  B1 value: ${JSON.stringify(range[0][1].value)} (expected: "Hello")`);
  console.log(`  B2 value: ${JSON.stringify(range[1][1].value)} (expected: true)`);

  // ── Test 4: getRangeWithIdentity ──────────────────────────────────────
  console.log('\nTest 4: getRangeWithIdentity returns cellId + displayString');
  const identified = await ws.getRangeWithIdentity(0, 0, 3, 1);
  for (const cell of identified) {
    console.log(
      `  (${cell.row},${cell.col}) cellId=${cell.cellId.slice(0, 8)}... value=${JSON.stringify(cell.value)} formula=${cell.formulaText ?? '-'} display="${cell.displayString}"`,
    );
  }

  // ── Test 5: getRawCellData with formula ───────────────────────────────
  console.log('\nTest 5: getRawCellData returns formula text');
  const raw = await ws.getRawCellData('A4', true);
  console.log(`  A4 raw formula: ${JSON.stringify(raw.formula)} (expected: "=SUM(A1:A3)")`);
  const rawValue = await ws.getRawCellData('A4', false);
  console.log(`  A4 raw value: ${JSON.stringify(rawValue.value)} (expected: 60)`);

  // ── Test 6: Numeric bounds overload ───────────────────────────────────
  console.log('\nTest 6: getRange with numeric bounds');
  const numRange = await ws.getRange(0, 0, 1, 1); // A1:B2
  console.log(`  (0,0)-(1,1): ${JSON.stringify(numRange.map((r) => r.map((c) => c.value)))}`);

  // ── Test 7: describeRange (LLM-friendly) ──────────────────────────────
  console.log('\nTest 7: describeRange');
  const desc = await ws.describeRange('A1:B4');
  console.log(desc);

  console.log('\n=== All tests printed. Review output above. ===');
}
