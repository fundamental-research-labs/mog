import type { Workbook } from '@mog-sdk/contracts/api';

import { DocumentFactory } from '../../document/document-factory';
import { withVersionManifest } from './version-domain-support-test-utils';
import {
  createSourceXlsx,
  DOCUMENT_ID,
  durableIndexedDbVersioning,
} from './version-xlsx-import-root-test-utils';

const EDIT_ADDRESS = 'A1';
const EDIT_VALUE = 'alpha';

export function registerNewSheetEditAfterImportRootScenario(): void {
  it('commits a new sheet plus authored cell edit after an XLSX import-root commit', async () => {
    const xlsxBytes = await createSourceXlsx();
    const imported = await DocumentFactory.createFromXlsx(
      { type: 'bytes', data: xlsxBytes },
      {
        documentId: `${DOCUMENT_ID}-new-sheet-edit`,
        environment: 'headless',
        userTimezone: 'UTC',
      },
    );
    expect(imported.success).toBe(true);
    if (!imported.success || !imported.handle) {
      throw new Error(`expected XLSX import success: ${imported.error?.message}`);
    }

    let wb: Workbook | undefined;
    try {
      wb = await imported.handle.workbook({
        versioning: withVersionManifest(durableIndexedDbVersioning()),
      });

      const rootHeadResult = await wb.version.getHead();
      expect(rootHeadResult).toMatchObject({
        ok: true,
        value: {
          refName: 'refs/heads/main',
          resolvedFrom: 'HEAD',
        },
      });
      if (!rootHeadResult.ok) {
        throw new Error(`expected import-root head: ${rootHeadResult.error.code}`);
      }
      const rootHead = rootHeadResult.value;
      if (!rootHead.refRevision) {
        throw new Error('expected import-root head to include a ref revision');
      }

      const sheet = await wb.sheets.add();
      await sheet.setCell(EDIT_ADDRESS, EDIT_VALUE);
      await expect(sheet.getValue(EDIT_ADDRESS)).resolves.toBe(EDIT_VALUE);

      const committedResult = await wb.version.commit({
        message: 'new sheet edit after XLSX import root',
        expectedHead: {
          commitId: rootHead.id,
          revision: rootHead.refRevision,
        },
      });
      expect(committedResult).toMatchObject({
        ok: true,
        value: {
          parents: [rootHead.id],
        },
      });
    } finally {
      await wb?.close('skipSave').catch(() => {});
      await imported.handle.dispose().catch(() => {});
    }
  });
}
