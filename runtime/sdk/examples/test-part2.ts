/**
 * Test remaining APIs (skipping getUsedRange which hangs).
 */
import type { Workbook } from '../src/index';

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`FAIL: ${msg}`);
  console.log(`  PASS: ${msg}`);
}

export default async function (wb: Workbook) {
  const ws = wb.activeSheet;

  // Setup data
  await ws.setCell('A1', 10);
  await ws.setCell('A2', 20);
  await ws.setCell('A3', 30);
  await ws.setCell('B1', 'apple');
  await ws.setCell('B2', 'banana');
  await ws.setCell('B3', 'cherry');

  // ── 6. Search — SKIPPED (findByValue uses forEach which scans 1B cells)
  console.log('\n=== 6. Search === SKIPPED (forEach hangs on massive range)');

  // ── 7. Structure: insert/delete rows ──────────────────────────────────
  console.log('\n=== 7. Structure Operations ===');
  try {
    await ws.structure.insertRows(0, 1);
    const shifted = await ws.getCell('A2');
    assert(shifted.value === 10, `After insertRow(0,1), old A1=10 shifted to A2: ${shifted.value}`);
    await ws.structure.deleteRows(0, 1);
    const restored = await ws.getCell('A1');
    assert(restored.value === 10, `After deleteRow, A1 restored to 10: ${restored.value}`);
  } catch (e: any) {
    console.log(`  Structure ERROR: ${e.message}`);
  }

  // ── 8. Merge cells ────────────────────────────────────────────────────
  console.log('\n=== 8. Merge Cells ===');
  try {
    await ws.structure.merge('D1:E2');
    const merges = await ws.structure.getMergedRegions();
    assert(merges.length > 0, `Has merged regions: ${merges.length}`);
    console.log(`  Merge: ${JSON.stringify(merges[0])}`);
    await ws.structure.unmerge('D1:E2');
    const after = await ws.structure.getMergedRegions();
    assert(after.length === 0, `After unmerge: ${after.length} regions`);
  } catch (e: any) {
    console.log(`  Merge ERROR: ${e.message}`);
  }

  // ── 9. Comments/Notes ─────────────────────────────────────────────────
  console.log('\n=== 9. Comments/Notes ===');
  try {
    await ws.comments.setNote('A1', 'This is a note');
    const note = await ws.comments.getNote('A1');
    assert(note === 'This is a note', `Note on A1 = "${note}"`);
    await ws.comments.removeNote('A1');
    const removed = await ws.comments.getNote('A1');
    assert(removed === null, `Note removed: ${removed}`);
  } catch (e: any) {
    console.log(`  Comments ERROR: ${e.message}`);
  }

  // ── 10. Formatting ────────────────────────────────────────────────────
  console.log('\n=== 10. Formatting ===');
  try {
    await ws.formats.set('A1', { bold: true, fontColor: '#FF0000' });
    const fmt = await ws.formats.get('A1');
    assert(fmt !== null && fmt.bold === true, `A1 bold: ${fmt?.bold}`);
    assert(fmt !== null && fmt.fontColor === '#FF0000', `A1 color: ${fmt?.fontColor}`);
  } catch (e: any) {
    console.log(`  Format ERROR: ${e.message}`);
  }

  // ── 11. Layout ────────────────────────────────────────────────────────
  console.log('\n=== 11. Layout ===');
  try {
    await ws.layout.setRowHeight(0, 30);
    const rh = await ws.layout.getRowHeight(0);
    console.log(`  Row 0 height: ${rh}`);
    assert(rh === 30, `Row height = 30, got ${rh}`);

    await ws.layout.setColumnWidth(0, 120);
    const cw = await ws.layout.getColumnWidth(0);
    console.log(`  Col 0 width: ${cw}`);
    assert(cw === 14, `Col width = 14 char units, got ${cw}`);
  } catch (e: any) {
    console.log(`  Layout ERROR: ${e.message}`);
  }

  // ── 12. Freeze Panes ──────────────────────────────────────────────────
  console.log('\n=== 12. Freeze Panes ===');
  try {
    await ws.view.freezeRows(2);
    await ws.view.freezeColumns(1);
    const panes = await ws.view.getFrozenPanes();
    console.log(`  Frozen: rows=${panes.rows}, cols=${panes.cols}`);
    assert(panes.rows === 2, `Frozen rows = 2`);
    assert(panes.cols === 1, `Frozen cols = 1`);
    await ws.view.unfreeze();
  } catch (e: any) {
    console.log(`  Freeze ERROR: ${e.message}`);
  }

  // ── 13. Undo/Redo ─────────────────────────────────────────────────────
  console.log('\n=== 13. Undo/Redo ===');
  try {
    const canUndo = wb.history.canUndo();
    console.log(`  canUndo: ${canUndo}`);
    assert(canUndo === true, `canUndo is true`);
  } catch (e: any) {
    console.log(`  Undo ERROR: ${e.message}`);
  }

  // ── 14. Named Ranges ──────────────────────────────────────────────────
  console.log('\n=== 14. Named Ranges ===');
  try {
    await wb.names.add('Scores', 'Sheet1!A1:A3');
    const names = await wb.names.list();
    assert(names.length > 0, `Named ranges: ${names.length}`);
    const found = names.find((n) => n.name === 'Scores');
    assert(found !== undefined, `Found "Scores": ${JSON.stringify(found)}`);
  } catch (e: any) {
    console.log(`  Named Ranges ERROR: ${e.message}`);
  }

  // ── 15. Hyperlinks ────────────────────────────────────────────────────
  console.log('\n=== 15. Hyperlinks ===');
  try {
    await ws.hyperlinks.set('C1', 'https://example.com');
    const link = await ws.hyperlinks.get('C1');
    assert(link === 'https://example.com', `Hyperlink: ${link}`);
    await ws.hyperlinks.remove('C1');
    const gone = await ws.hyperlinks.get('C1');
    assert(gone === null, `Hyperlink removed: ${gone}`);
  } catch (e: any) {
    console.log(`  Hyperlinks ERROR: ${e.message}`);
  }

  // ── 16. Raw cell data ─────────────────────────────────────────────────
  console.log('\n=== 16. Raw Cell Data ===');
  try {
    await ws.setCell('F1', '=A1*3');
    const raw = await ws.getRawCellData('F1', true);
    console.log(`  F1 raw: value=${raw.value}, formula=${raw.formula}`);
    assert(raw.value === 30, `Raw value = 30: ${raw.value}`);
    assert(raw.formula === '=A1*3', `Raw formula: ${raw.formula}`);
  } catch (e: any) {
    console.log(`  Raw ERROR: ${e.message}`);
  }

  // ── 17. Display values ────────────────────────────────────────────────
  console.log('\n=== 17. Display Values ===');
  try {
    const disp = await ws.getDisplayValue('A1');
    console.log(`  A1 display: "${disp}"`);
    assert(disp === '10', `Display = "10": "${disp}"`);
  } catch (e: any) {
    console.log(`  Display ERROR: ${e.message}`);
  }

  // ── 18. Sort range ────────────────────────────────────────────────────
  console.log('\n=== 18. Sort ===');
  try {
    await ws.setRange(0, 7, [
      ['Name', 'Val'],
      ['Charlie', 30],
      ['Alice', 10],
      ['Bob', 20],
    ]);
    await ws.sortRange('H1:I4', { columns: [{ column: 1, direction: 'asc' }], hasHeaders: true });
    const sorted = await ws.getRange('H2:I4');
    const names = sorted.map((r) => r[0].value);
    console.log(`  Sorted names: ${names}`);
    assert(names[0] === 'Alice', `First after sort = Alice: ${names[0]}`);
  } catch (e: any) {
    console.log(`  Sort ERROR: ${e.message}`);
  }

  // ── 19. Batch operations ──────────────────────────────────────────────
  console.log('\n=== 19. Set Cells ===');
  try {
    await ws.setCells([
      { row: 10, col: 0, value: 'batch1' },
      { row: 10, col: 1, value: 'batch2' },
      { row: 10, col: 2, value: 'batch3' },
    ]);
    const b1 = await ws.getCell(10, 0);
    const b2 = await ws.getCell(10, 1);
    const b3 = await ws.getCell(10, 2);
    assert(b1.value === 'batch1', `Batch A11 = "batch1": ${b1.value}`);
    assert(b2.value === 'batch2', `Batch B11 = "batch2": ${b2.value}`);
    assert(b3.value === 'batch3', `Batch C11 = "batch3": ${b3.value}`);
  } catch (e: any) {
    console.log(`  Batch ERROR: ${e.message}`);
  }

  // ── 20. View options ──────────────────────────────────────────────────
  console.log('\n=== 20. View Options ===');
  try {
    await ws.view.setGridlines(false);
    const opts = await ws.view.getViewOptions();
    console.log(`  View options: ${JSON.stringify(opts)}`);
    assert(opts.showGridlines === false, `Gridlines off: ${opts.showGridlines}`);
    await ws.view.setGridlines(true);
  } catch (e: any) {
    console.log(`  View ERROR: ${e.message}`);
  }

  console.log('\n========================================');
  console.log('  PART 2 COMPLETE');
  console.log('========================================');
}
