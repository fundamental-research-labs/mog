import type { Workbook } from '@mog-sdk/contracts/api';

import { DocumentFactory } from '../../document/document-factory';
import { expectedCellDiff } from './version-indexeddb-public-cell-edit-diff-test-utils';
import { withVersionManifest } from './version-domain-support-test-utils';
import {
  createSourceXlsx,
  DOCUMENT_ID,
  durableIndexedDbVersioning,
} from './version-xlsx-import-root-test-utils';

const EDIT_ADDRESS = 'C3';
const EDIT_VALUE = 'authored edit after import root';

export function registerAuthoredEditAfterImportRootScenario(): void {
  it('commits a public cell edit after an XLSX import-root commit', async () => {
    const xlsxBytes = await createSourceXlsx();
    const imported = await DocumentFactory.createFromXlsx(
      { type: 'bytes', data: xlsxBytes },
      {
        documentId: `${DOCUMENT_ID}-authored-edit`,
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

      await wb.activeSheet.setCell(EDIT_ADDRESS, EDIT_VALUE);
      await expect(wb.activeSheet.getValue(EDIT_ADDRESS)).resolves.toBe(EDIT_VALUE);

      const committedResult = await wb.version.commit({
        message: 'authored edit after XLSX import root',
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
      if (!committedResult.ok) {
        throw new Error(`expected authored edit commit: ${committedResult.error.code}`);
      }

      const diffResult = await wb.version.diff(rootHead.id, committedResult.value.id);
      if (!diffResult.ok) {
        throw new Error(`expected authored edit diff: ${JSON.stringify(diffResult.error)}`);
      }
      expect(diffResult.value.items).toEqual(
        expect.arrayContaining([expectedCellDiff(EDIT_ADDRESS, EDIT_VALUE)]),
      );
    } finally {
      await wb?.close('skipSave').catch(() => {});
      await imported.handle.dispose().catch(() => {});
    }
  });
}
