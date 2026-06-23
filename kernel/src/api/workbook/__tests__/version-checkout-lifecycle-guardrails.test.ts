import type { Workbook } from '@mog-sdk/contracts/api';

import { DocumentFactory } from '../../document/document-factory';
import {
  installVersionDomainDetectorNoopsOnHandles,
  withVersionManifest,
} from './version-domain-support-test-utils';
import { DOCUMENT_SCOPE, initializeVersionGraph } from './version-checkout-lifecycle-test-utils';

describe('WorkbookVersion checkout lifecycle guardrails', () => {
  it('rejects dirty post-commit checkout without discarding workbook edits', async () => {
    const { provider, initialized } = await initializeVersionGraph();
    const handle = await DocumentFactory.create({
      documentId: DOCUMENT_SCOPE.documentId,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    installVersionDomainDetectorNoopsOnHandles(handle);
    let wb: Workbook | undefined;

    try {
      wb = await handle.workbook({ versioning: withVersionManifest({ provider }) });

      await wb.activeSheet.setCell('A1', 7);
      await wb.activeSheet.setCell('A2', '=A1*6');
      const commitResult = await wb.version.commit({
        expectedHead: {
          commitId: initialized.rootCommit.id,
          revision: initialized.initialHead.revision,
          symbolicHeadRevision: initialized.symbolicHead.revision,
        },
      });
      if (!commitResult.ok) throw new Error(`expected commit success: ${commitResult.error.code}`);
      const committed = commitResult.value;
      wb.markClean();

      await wb.activeSheet.setCell('A1', 99);
      await wb.activeSheet.setCell('A2', '=A1+1');
      expect(wb.isDirty).toBe(true);

      const result = await wb.version.checkout({ kind: 'commit', id: committed.id });

      expect(result).toMatchObject({
        ok: false,
        error: {
          diagnostics: [
            expect.objectContaining({
              code: 'VERSION_CHECKOUT_DIRTY_WORKING_STATE',
              data: expect.objectContaining({ recoverability: 'none', redacted: true }),
            }),
          ],
        },
      });
      await expect(wb.activeSheet.getCell('A1')).resolves.toMatchObject({ value: 99 });
      await expect(wb.activeSheet.getCell('A2')).resolves.toMatchObject({ value: 100 });
      expect(wb.isDirty).toBe(true);
    } finally {
      if (wb) await wb.close('skipSave');
      await handle.dispose();
    }
  });
});
