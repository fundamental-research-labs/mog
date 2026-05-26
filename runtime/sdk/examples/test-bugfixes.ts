/**
 * E2E regression tests for 6 API bugs found via headless server / SDK usage.
 *
 * Run: node run.cjs examples/test-bugfixes.ts
 *
 * Each test reproduces the EXACT scenario from the bug report against the
 * real Rust compute core (via NAPI).
 */
import type { Workbook } from '../src/index';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (!condition) {
    failed++;
    console.log(`  FAIL: ${msg}`);
  } else {
    passed++;
    console.log(`  PASS: ${msg}`);
  }
}

async function getValue(ws: any, address: string): Promise<any> {
  const raw = await ws.getRawCellData(address, false);
  return raw.value;
}

export default async function (wb: Workbook) {
  const ws = wb.activeSheet;

  // =========================================================================
  // Bug #1: sortRange crashes internally
  // "Cannot read properties of undefined (reading 'map')" at worksheet-impl.ts
  // =========================================================================
  console.log('\n=== Bug #1: sortRange should sort without crashing ===');
  try {
    await ws.setCell('A1', 30);
    await ws.setCell('A2', 10);
    await ws.setCell('A3', 20);
    await wb.calculate();

    // This was the exact crash scenario
    await ws.sortRange('A1:A3', {
      columns: [{ column: 0, direction: 'asc' }],
    });
    await wb.calculate();

    const a1 = await getValue(ws, 'A1');
    const a2 = await getValue(ws, 'A2');
    const a3 = await getValue(ws, 'A3');
    assert(a1 === 10, `After sort asc, A1=10 (got ${a1})`);
    assert(a2 === 20, `After sort asc, A2=20 (got ${a2})`);
    assert(a3 === 30, `After sort asc, A3=30 (got ${a3})`);
  } catch (e: any) {
    failed++;
    console.log(`  FAIL (exception): ${e.message}`);
  }

  // Clear for next test
  await ws.clearData('A1:Z100');

  // =========================================================================
  // Bug #1b: sortRange should reject missing columns option
  // =========================================================================
  console.log('\n=== Bug #1b: sortRange rejects bad options ===');
  try {
    await ws.setCell('A1', 1);
    await ws.sortRange('A1:A2', {} as any);
    failed++;
    console.log('  FAIL: Expected an error for missing columns');
  } catch (e: any) {
    assert(
      e.message.toLowerCase().includes('columns'),
      `Throws clear error about columns: "${e.message}"`,
    );
  }

  await ws.clearData('A1:Z100');

  // =========================================================================
  // Bug #2: autoFill overwrites source range
  // Seed [1,2] in A1:A2, fill to A1:A10 → should preserve source
  // =========================================================================
  console.log('\n=== Bug #2: autoFill should preserve source cells ===');
  try {
    await ws.setCell('A1', 1);
    await ws.setCell('A2', 2);
    await wb.calculate();

    await ws.autoFill('A1:A2', 'A1:A10');
    await wb.calculate();

    const src1 = await getValue(ws, 'A1');
    const src2 = await getValue(ws, 'A2');
    assert(src1 === 1, `Source A1 preserved: 1 (got ${src1})`);
    assert(src2 === 2, `Source A2 preserved: 2 (got ${src2})`);

    const a3 = await getValue(ws, 'A3');
    const a10 = await getValue(ws, 'A10');
    assert(a3 === 3, `Filled A3=3 (got ${a3})`);
    assert(a10 === 10, `Filled A10=10 (got ${a10})`);
  } catch (e: any) {
    failed++;
    console.log(`  FAIL (exception): ${e.message}`);
  }

  await ws.clearData('A1:Z100');

  // =========================================================================
  // Bug #3: autoFill formulas wiped, not filled
  // A1=10, A2="=A1+5", autoFill A2 down → A3 should have =A2+5
  // =========================================================================
  console.log('\n=== Bug #3: autoFill should propagate formulas ===');
  try {
    await ws.setCell('A1', 10);
    await ws.setCell('A2', '=A1+5');
    await wb.calculate();

    const a2Before = await getValue(ws, 'A2');
    assert(a2Before === 15, `A2=A1+5=15 before fill (got ${a2Before})`);

    // Verify formula is stored
    const formulaBefore = await ws.getFormula('A2');
    console.log(`  DEBUG: A2 formula before fill = "${formulaBefore}"`);

    await ws.autoFill('A2:A2', 'A3:A5');
    await wb.calculate();

    // Debug: check raw cell data
    const a3Raw = await ws.getRawCellData('A3', true);
    console.log(`  DEBUG: A3 raw after fill = ${JSON.stringify(a3Raw)}`);

    // Source formula preserved
    const a2After = await getValue(ws, 'A2');
    assert(a2After === 15, `Source A2 still 15 after fill (got ${a2After})`);

    // Filled cells should have formulas, NOT null
    const a3 = await getValue(ws, 'A3');
    assert(a3 !== null && a3 !== undefined, `A3 is not null (got ${a3})`);
    assert(a3 === 20, `A3=A2+5=20 (got ${a3})`);

    const a4 = await getValue(ws, 'A4');
    assert(a4 === 25, `A4=A3+5=25 (got ${a4})`);

    const a5 = await getValue(ws, 'A5');
    assert(a5 === 30, `A5=A4+5=30 (got ${a5})`);
  } catch (e: any) {
    failed++;
    console.log(`  FAIL (exception): ${e.message}`);
  }

  await ws.clearData('A1:Z100');

  // =========================================================================
  // Bug #4: clearData is not a function
  // ws.clearData was undefined
  // =========================================================================
  console.log('\n=== Bug #4: clearData should exist and work ===');
  try {
    assert(
      typeof ws.clearData === 'function',
      `clearData is a function (type: ${typeof ws.clearData})`,
    );

    await ws.setCell('A1', 'hello');
    await ws.setCell('A2', 42);
    await wb.calculate();

    const before = await getValue(ws, 'A1');
    assert(before === 'hello', `A1 has value before clear: ${before}`);

    await ws.clearData('A1:A2');
    await wb.calculate();

    const after1 = await getValue(ws, 'A1');
    const after2 = await getValue(ws, 'A2');
    assert(after1 === null, `A1 is null after clear (got ${after1})`);
    assert(after2 === null, `A2 is null after clear (got ${after2})`);
  } catch (e: any) {
    failed++;
    console.log(`  FAIL (exception): ${e.message}`);
  }

  // =========================================================================
  // Bug #5: sheets.rename allows duplicate names
  // rename("Sheet1", "Sheet2") should fail when Sheet2 exists
  // =========================================================================
  console.log('\n=== Bug #5: sheets.rename should reject duplicates ===');
  try {
    const originalName = await ws.getName();
    const ws2 = await wb.sheets.add('SecondSheet');
    assert((await ws2.getName()) === 'SecondSheet', `Created sheet "SecondSheet"`);

    // Try renaming original to "SecondSheet" — should throw
    let threw = false;
    try {
      await wb.sheets.rename(0, 'SecondSheet');
    } catch (e: any) {
      threw = true;
      assert(e.message.includes('already exists'), `Error says name exists: "${e.message}"`);
    }
    assert(threw, `Rename to duplicate name threw an error`);

    // Case-insensitive: "SECONDSHEET" should also be rejected
    threw = false;
    try {
      await wb.sheets.rename(0, 'SECONDSHEET');
    } catch (e: any) {
      threw = true;
    }
    assert(threw, `Case-insensitive duplicate also rejected`);

    // But renaming a sheet to its own name with different casing should work
    try {
      await wb.sheets.rename('SecondSheet', 'SECONDSHEET');
      const newName = await ws2.getName();
      assert(true, `Self-rename to different casing succeeded (now: "${newName}")`);
    } catch (e: any) {
      failed++;
      console.log(`  FAIL: Self-rename to different casing should work: ${e.message}`);
    }
  } catch (e: any) {
    failed++;
    console.log(`  FAIL (exception): ${e.message}`);
  }

  // =========================================================================
  // Bug #6: getSheet is case-sensitive
  // Docs say case-insensitive but it's not
  // =========================================================================
  console.log('\n=== Bug #6: getSheet should be case-insensitive ===');
  try {
    // We already have "SecondSheet" (or "SECONDSHEET" after rename)
    await wb.sheets.add('TestSheet');

    const exact = await wb.getSheet('TestSheet');
    assert(exact !== null && exact !== undefined, `Exact match finds sheet`);

    const lower = await wb.getSheet('testsheet');
    assert(lower !== null && lower !== undefined, `Lowercase lookup finds sheet`);

    const upper = await wb.getSheet('TESTSHEET');
    assert(upper !== null && upper !== undefined, `UPPERCASE lookup finds sheet`);

    // getSheet may throw or return null for non-existent sheets
    let nonexistent: any = null;
    try {
      nonexistent = await wb.getSheet('NoSuchSheet');
    } catch {
      // Throwing is acceptable behavior for non-existent sheet
    }
    assert(!nonexistent, `Non-existent returns falsy or throws`);
  } catch (e: any) {
    failed++;
    console.log(`  FAIL (exception): ${e.message}`);
  }

  // =========================================================================
  // Summary
  // =========================================================================
  console.log(`\n${'='.repeat(60)}`);
  console.log(`RESULTS: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
  console.log(`${'='.repeat(60)}`);

  if (failed > 0) {
    throw new Error(`${failed} assertion(s) failed`);
  }
}
