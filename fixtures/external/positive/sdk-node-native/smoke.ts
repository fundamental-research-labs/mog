import {
  createWorkbook,
  type Workbook,
  type Worksheet,
  type CreateWorkbookOptions,
} from '@mog-sdk/sdk/node';

async function main(): Promise<void> {
  const opts: CreateWorkbookOptions = { userTimezone: 'UTC' };
  const wb: Workbook = await createWorkbook(opts);

  try {
    const ws: Worksheet = wb.activeSheet;
    await ws.setCell('A1', 42);
    await ws.setCell('A2', '=A1*2');

    const a2 = await ws.getValue('A2');
    if (a2 !== 84) throw new Error(`Expected 84, got ${a2}`);
  } finally {
    await wb.dispose();
  }

  console.log('PASS: sdk-node-native fixture');
}

main().catch((e) => {
  console.error('FAIL: sdk-node-native fixture');
  console.error(e);
  process.exit(1);
});
