/**
 * Debug script — minimal boot/dispose to isolate the hang.
 * Run with: npx tsx examples/debug-hang.ts
 */
import type { Workbook } from '../src/index';

export default async function (wb: Workbook) {
  console.log('[debug] script start');
  const ws = wb.activeSheet;
  await ws.setCell('A1', 42);
  const val = await ws.getValue('A1');
  console.log('[debug] A1 =', val);
  console.log('[debug] script done');
}
