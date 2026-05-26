import type { Workbook } from '../src/index';

export default async function (wb: Workbook) {
  const ws = wb.activeSheet;

  await ws.setCell('A1', 42);
  await ws.setCell('B2', 'hello');

  console.log('About to call getUsedRange...');
  try {
    const used = await ws.getUsedRange();
    console.log('getUsedRange result:', used);
  } catch (e: any) {
    console.log('getUsedRange ERROR:', e.message);
  }

  console.log('About to call findByValue...');
  try {
    const found = await ws.findByValue(42);
    console.log('findByValue result:', found);
  } catch (e: any) {
    console.log('findByValue ERROR:', e.message);
  }

  console.log('About to call summarize...');
  try {
    const summary = await ws.summarize();
    console.log('summarize result:', summary);
  } catch (e: any) {
    console.log('summarize ERROR:', e.message);
  }

  console.log('DONE');
}
