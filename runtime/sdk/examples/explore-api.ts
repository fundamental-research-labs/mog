/**
 * Explore the Worksheet API interactively.
 *
 * Edit this file to try any worksheet method. The engine is ready to go.
 *
 *   node run.cjs examples/explore-api.ts
 */
import type { Workbook } from '../src/index';

export default async function (wb: Workbook) {
  const ws = wb.activeSheet;

  // ── Sheet info ────────────────────────────────────────────────────────
  console.log('Sheet name:', await ws.getName());
  console.log('Sheet index:', ws.getIndex());
  console.log('Sheet count:', await wb.getSheetCount());
  console.log('Sheet names:', await wb.getSheetNames());

  // ── Write a small dataset ─────────────────────────────────────────────
  await ws.setRange('A1', [
    ['Name', 'Score', 'Grade'],
    ['Alice', 92, '=IF(B2>=90,"A","B")'],
    ['Bob', 85, '=IF(B3>=90,"A","B")'],
    ['Carol', 97, '=IF(B4>=90,"A","B")'],
  ]);
  await ws.setCell('B5', '=AVERAGE(B2:B4)');

  // ── Read back ─────────────────────────────────────────────────────────
  console.log('\n--- Raw data ---');
  const range = await ws.getRange('A1:C5');
  for (let r = 0; r < range.length; r++) {
    const row = range[r].map((c) => {
      if (c.formula) return `${c.value}(${c.formula})`;
      return String(c.value ?? '');
    });
    console.log(`  Row ${r}: ${row.join(' | ')}`);
  }

  // ── LLM-friendly output ───────────────────────────────────────────────
  console.log('\n--- describeRange ---');
  console.log(await ws.describeRange('A1:C5'));

  console.log('\n--- describe B5 ---');
  console.log(await ws.describe('B5'));

  console.log('\n--- summarize ---');
  console.log(await ws.summarize());

  // ── Search ────────────────────────────────────────────────────────────
  console.log('\n--- findByValue("Alice") ---');
  console.log(await ws.findByValue('Alice'));

  console.log('\n--- getUsedRange ---');
  console.log(await ws.getUsedRange());

  // ── Formula introspection ─────────────────────────────────────────────
  console.log('\n--- getFormula("C2") ---');
  console.log(await ws.getFormula('C2'));

  console.log('\n--- getRawCellData("B5", true) ---');
  console.log(await ws.getRawCellData('B5', true));
}
