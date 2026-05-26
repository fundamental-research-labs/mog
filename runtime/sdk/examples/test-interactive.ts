/**
 * Interactive API test — exercises the unified API progressively.
 */
import type { Workbook } from '../src/index';

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`FAIL: ${msg}`);
  console.log(`  PASS: ${msg}`);
}

export default async function (wb: Workbook) {
  const ws = wb.activeSheet;

  // ── 1. Basic cell read/write ──────────────────────────────────────────
  console.log('\n=== 1. Basic Cell Operations ===');
  await ws.setCell('A1', 42);
  await ws.setCell('B1', 'hello');
  await ws.setCell('C1', true);
  await ws.setCell('A2', 100);
  await ws.setCell('A3', '=A1+A2');

  const a1 = await ws.getCell('A1');
  assert(a1.value === 42, `A1 = 42, got ${a1.value}`);

  const b1 = await ws.getCell('B1');
  assert(b1.value === 'hello', `B1 = "hello", got ${b1.value}`);

  const c1 = await ws.getCell('C1');
  assert(c1.value === true, `C1 = true, got ${c1.value}`);

  const a3 = await ws.getCell('A3');
  assert(a3.value === 142, `A3 = 142 (=A1+A2), got ${a3.value}`);
  assert(a3.formula === '=A1+A2', `A3 formula = "=A1+A2", got ${a3.formula}`);

  // ── 2. setRange (numeric overload) + getRange ─────────────────────────
  console.log('\n=== 2. Range Operations ===');
  await ws.setRange(0, 3, [
    ['Name', 'Score'],
    ['Alice', 92],
    ['Bob', 85],
  ]);

  const range = await ws.getRange('D1:E3');
  assert(range[0][0].value === 'Name', `D1 = "Name", got ${range[0][0].value}`);
  assert(range[1][1].value === 92, `E2 = 92, got ${range[1][1].value}`);
  assert(range[2][0].value === 'Bob', `D3 = "Bob", got ${range[2][0].value}`);

  // ── 3. Formula computation ────────────────────────────────────────────
  console.log('\n=== 3. Formulas ===');
  await ws.setCell('E4', '=SUM(E2:E3)');
  await ws.setCell('E5', '=AVERAGE(E2:E3)');
  await ws.setCell('E6', '=IF(E4>200,"high","low")');

  const sum = await ws.getCell('E4');
  assert(sum.value === 177, `SUM(E2:E3) = 177, got ${sum.value}`);

  const avg = await ws.getCell('E5');
  assert(avg.value === 88.5, `AVERAGE = 88.5, got ${avg.value}`);

  const ifResult = await ws.getCell('E6');
  assert(ifResult.value === 'low', `IF result = "low", got ${ifResult.value}`);

  const formula = await ws.getFormula('E4');
  assert(formula === '=SUM(E2:E3)', `getFormula = "=SUM(E2:E3)", got ${formula}`);

  // ── 4. Sheet management ───────────────────────────────────────────────
  console.log('\n=== 4. Sheet Management ===');
  assert((await wb.getSheetCount()) === 1, `Initial sheet count = 1`);
  const sheet2 = await wb.sheets.add('Data');
  assert((await wb.getSheetCount()) === 2, `After add, sheet count = 2`);
  const names = await wb.getSheetNames();
  assert(names.includes('Data'), `Sheet names include "Data": ${names}`);

  // Write to second sheet
  await sheet2.setCell('A1', 'on sheet 2');
  const s2a1 = await sheet2.getCell('A1');
  assert(s2a1.value === 'on sheet 2', `Sheet2 A1 = "on sheet 2"`);

  // Switch back
  wb.sheets.setActive(0);
  const active = wb.activeSheet;
  assert((await active.getName()) === 'Sheet1', `Active sheet = Sheet1`);

  // ── 5. Describe / Summarize (LLM-friendly) ───────────────────────────
  console.log('\n=== 5. LLM-Friendly Output ===');
  const desc = await ws.describe('E4');
  console.log(`  describe(E4): ${desc}`);
  assert(desc.includes('177'), `describe includes value 177`);

  const usedRange = await ws.getUsedRange();
  console.log(`  usedRange: ${usedRange}`);
  assert(usedRange !== null, `usedRange is not null`);

  // ── 6. Search ─────────────────────────────────────────────────────────
  console.log('\n=== 6. Search ===');
  const found = await ws.findByValue('hello');
  assert(found.length > 0, `findByValue("hello") found ${found.length} cell(s): ${found}`);

  // ── 7. Structure: insert/delete rows ──────────────────────────────────
  console.log('\n=== 7. Structure Operations ===');
  const beforeInsert = await ws.getCell('A1');
  await ws.structure.insertRows(0, 1); // Insert 1 row at top
  const afterInsert = await ws.getCell('A2'); // Old A1 should now be A2
  assert(
    afterInsert.value === beforeInsert.value,
    `After insertRow, old A1 shifted to A2: ${afterInsert.value}`,
  );
  await ws.structure.deleteRows(0, 1); // Delete the inserted row
  const afterDelete = await ws.getCell('A1');
  assert(afterDelete.value === 42, `After deleteRow, A1 restored to 42: ${afterDelete.value}`);

  // ── 8. Merge cells ────────────────────────────────────────────────────
  console.log('\n=== 8. Merge Cells ===');
  await ws.structure.merge('G1:H2');
  const merges = await ws.structure.getMergedRegions();
  assert(merges.length > 0, `Has merged regions: ${merges.length}`);
  await ws.structure.unmerge('G1:H2');
  const afterUnmerge = await ws.structure.getMergedRegions();
  assert(afterUnmerge.length === 0, `After unmerge: ${afterUnmerge.length} regions`);

  // ── 9. Comments/Notes ─────────────────────────────────────────────────
  console.log('\n=== 9. Comments/Notes ===');
  await ws.comments.setNote('A1', 'This is a note');
  const note = await ws.comments.getNote('A1');
  assert(note === 'This is a note', `Note on A1 = "${note}"`);
  await ws.comments.removeNote('A1');
  const afterRemove = await ws.comments.getNote('A1');
  assert(afterRemove === null, `Note removed`);

  // ── 10. Formatting ────────────────────────────────────────────────────
  console.log('\n=== 10. Formatting ===');
  await ws.formats.set('A1', { bold: true, fontColor: '#FF0000' });
  const fmt = await ws.formats.get('A1');
  assert(fmt !== null && fmt.bold === true, `A1 is bold: ${fmt?.bold}`);
  assert(fmt !== null && fmt.fontColor === '#FF0000', `A1 fontColor = #FF0000: ${fmt?.fontColor}`);

  // ── 11. Layout ────────────────────────────────────────────────────────
  console.log('\n=== 11. Layout ===');
  await ws.layout.setRowHeight(0, 30);
  const rh = await ws.layout.getRowHeight(0);
  console.log(`  Row 0 height: ${rh}`);
  assert(rh === 30, `Row height = 30, got ${rh}`);

  await ws.layout.setColumnWidth(0, 120);
  const cw = await ws.layout.getColumnWidth(0);
  console.log(`  Col 0 width: ${cw}`);
  assert(cw === 14, `Col width = 14 char units, got ${cw}`);

  // ── 12. Freeze panes ─────────────────────────────────────────────────
  console.log('\n=== 12. Freeze Panes ===');
  await ws.view.freezeRows(1);
  await ws.view.freezeColumns(1);
  const panes = await ws.view.getFrozenPanes();
  console.log(`  Frozen: rows=${panes.rows}, cols=${panes.cols}`);
  assert(panes.rows === 1, `Frozen rows = 1`);
  assert(panes.cols === 1, `Frozen cols = 1`);
  await ws.view.unfreeze();

  // ── 13. Undo/Redo ────────────────────────────────────────────────────
  console.log('\n=== 13. Undo/Redo ===');
  await ws.setCell('Z1', 'before undo');
  const canUndo = wb.history.canUndo();
  console.log(`  canUndo: ${canUndo}`);
  assert(canUndo === true, `canUndo is true after mutations`);

  // ── 14. Named Ranges ──────────────────────────────────────────────────
  console.log('\n=== 14. Named Ranges ===');
  await wb.names.add('MyRange', 'Sheet1!A1:A3');
  const namedRanges = await wb.names.list();
  assert(namedRanges.length > 0, `Named ranges count: ${namedRanges.length}`);
  const myRange = namedRanges.find((n) => n.name === 'MyRange');
  assert(myRange !== undefined, `Found "MyRange" in list`);
  console.log(`  MyRange: ${JSON.stringify(myRange)}`);

  // ── 15. Hyperlinks ────────────────────────────────────────────────────
  console.log('\n=== 15. Hyperlinks ===');
  await ws.hyperlinks.set('F1', 'https://example.com');
  const link = await ws.hyperlinks.get('F1');
  assert(link === 'https://example.com', `Hyperlink on F1: ${link}`);
  await ws.hyperlinks.remove('F1');
  const afterRemoveLink = await ws.hyperlinks.get('F1');
  assert(afterRemoveLink === null, `Hyperlink removed`);

  // ── 16. getRawCellData ────────────────────────────────────────────────
  console.log('\n=== 16. Raw Cell Data ===');
  const raw = await ws.getRawCellData('E4', true);
  console.log(`  E4 raw: value=${raw.value}, formula=${raw.formula}`);
  assert(raw.formula === '=SUM(E2:E3)', `Raw formula matches`);

  // ── 17. Display values ────────────────────────────────────────────────
  console.log('\n=== 17. Display Values ===');
  const disp = await ws.getDisplayValue('A1');
  console.log(`  A1 display: "${disp}"`);
  assert(disp === '42', `Display value of 42 is "42", got "${disp}"`);

  // ── Summary ───────────────────────────────────────────────────────────
  console.log('\n========================================');
  console.log('  ALL TESTS PASSED');
  console.log('========================================');
}
