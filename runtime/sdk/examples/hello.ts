/**
 * Hello World — boot the engine, write cells, read them back.
 *
 *   node run.cjs examples/hello.ts
 */
import type { Workbook } from '../src/index';

export default async function (wb: Workbook) {
  const ws = wb.activeSheet;

  // Write some values
  await ws.setCell('A1', 42);
  await ws.setCell('A2', 58);
  await ws.setCell('A3', '=A1+A2');

  // Read single cell
  const cell = await ws.getCell('A3');
  console.log('A3 cell:', cell);

  // LLM-friendly description
  const desc = await ws.describe('A3');
  console.log('A3 describe:', desc);

  // Read a range
  const range = await ws.getRange('A1:A3');
  console.log('Range A1:A3:', JSON.stringify(range, null, 2));

  // Used range
  const used = await ws.getUsedRange();
  console.log('Used range:', used);
}
