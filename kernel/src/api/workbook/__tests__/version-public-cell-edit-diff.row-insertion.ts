import type { Workbook } from '@mog-sdk/contracts/api';

import { DocumentFactory } from '../../document/document-factory';
import { createInMemoryVersionStoreProvider } from '../../../document/version-store/provider';
import { withVersionManifest } from './version-domain-support-test-utils';
import {
  DOCUMENT_ID,
  DOCUMENT_SCOPE,
  expectInitializeSuccess,
  expectedRowOrderDiff,
  initializeInput,
  readSemanticChangeSetPayload,
} from './version/public-cell-edit-diff.helpers';

export function registerPublicRowInsertionScenario(): void {
  it('commits a public row insertion with rows-columns review diff evidence', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
    expectInitializeSuccess(initialized);

    const handle = await DocumentFactory.create({
      documentId: DOCUMENT_ID,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    let wb: Workbook | undefined;

    try {
      wb = await handle.workbook({ versioning: withVersionManifest({ provider }) });
      const activeSheet = wb.activeSheet;
      await activeSheet.setCell('A2', '=A1*2');
      await activeSheet.structure.insertRows(1, 1);
      await expect(activeSheet.getFormula('A3')).resolves.toBe('=A1*2');

      const commitResult = await wb.version.commit({
        expectedHead: {
          commitId: initialized.rootCommit.id,
          revision: initialized.initialHead.revision,
          symbolicHeadRevision: initialized.symbolicHead.revision,
        },
      });
      if (!commitResult.ok) {
        throw new Error(
          `expected public row insertion commit success: ${commitResult.error.code}: ${JSON.stringify(
            commitResult.error,
          )}`,
        );
      }

      const storedSemanticChangeSet = await readSemanticChangeSetPayload(
        provider,
        commitResult.value.id,
      );
      expect(storedSemanticChangeSet.reviewChanges).toEqual(
        expect.arrayContaining([expectedRowOrderDiff('2:2')]),
      );

      const diffResult = await wb.version.diff(initialized.rootCommit.id, commitResult.value.id);
      expect(diffResult).toMatchObject({
        ok: true,
        value: {
          items: expect.arrayContaining([expectedRowOrderDiff('2:2')]),
        },
      });
    } finally {
      if (wb) await wb.close('skipSave');
      await handle.dispose();
    }
  });
}
