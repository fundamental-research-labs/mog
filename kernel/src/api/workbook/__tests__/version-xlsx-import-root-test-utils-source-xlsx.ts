import 'fake-indexeddb/auto';

import { createWorkbook } from '../create-workbook';

export async function createSourceXlsx(a1Value = 'Imported'): Promise<Uint8Array> {
  const wb = await createWorkbook({ documentId: 'vc10-xlsx-import-source', userTimezone: 'UTC' });
  try {
    await wb.activeSheet.setCell('A1', a1Value);
    await wb.activeSheet.setCell('B1', 42);
    return wb.toXlsx();
  } finally {
    await wb.close('skipSave').catch(() => {
      wb.dispose();
    });
  }
}
