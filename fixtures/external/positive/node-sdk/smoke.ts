import { createWorkbook, Workbook, Worksheet, CreateWorkbookOptions, api } from '@mog-sdk/node';

async function main(): Promise<void> {
  // 1. Create a workbook
  const wb: Workbook = await createWorkbook({ userTimezone: 'UTC' });

  // 2. Get the active sheet
  const ws: Worksheet = wb.activeSheet;

  // 3. Set cell values
  await ws.setCell('A1', 42);
  await ws.setCell('A2', '=A1*2');

  // 4. Read values back
  const a1 = await ws.getValue('A1');
  if (a1 !== 42) throw new Error(`Expected 42, got ${a1}`);

  const a2 = await ws.getValue('A2');
  if (a2 !== 84) throw new Error(`Expected 84, got ${a2}`);

  // 5. Verify api introspection exists
  if (typeof api !== 'object') throw new Error('api export missing');
  const _: CreateWorkbookOptions = { userTimezone: 'UTC' };

  // 6. Dispose
  await wb.dispose();

  console.log('PASS: node-sdk fixture');
}

main().catch((e) => {
  console.error('FAIL: node-sdk fixture');
  console.error(e);
  process.exit(1);
});
