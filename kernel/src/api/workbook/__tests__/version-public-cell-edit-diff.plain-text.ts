import type { Workbook } from '@mog-sdk/contracts/api';

import { DocumentFactory } from '../../document/document-factory';
import { createInMemoryVersionStoreProvider } from '../../../document/version-store/provider';
import { withVersionManifest } from './version-domain-support-test-utils';
import {
  DOCUMENT_ID,
  DOCUMENT_SCOPE,
  expectInitializeSuccess,
  expectedCellDiff,
  expectedSemanticDigest,
  initializeInput,
  readSemanticChangeSetPayload,
} from './version/public-cell-edit-diff.helpers';

export function registerPublicPlainTextEditScenario(): void {
  it('commits a single plain text edit from public APIs', async () => {
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
      await wb.activeSheet.setCell('A1', 'base');

      const commitResult = await wb.version.commit({
        expectedHead: {
          commitId: initialized.rootCommit.id,
          revision: initialized.initialHead.revision,
          symbolicHeadRevision: initialized.symbolicHead.revision,
        },
      });
      if (!commitResult.ok) {
        throw new Error(
          `expected public text edit commit success: ${commitResult.error.code}: ${JSON.stringify(
            commitResult.error,
          )}`,
        );
      }

      const storedSemanticChangeSet = await readSemanticChangeSetPayload(
        provider,
        commitResult.value.id,
      );
      expect(storedSemanticChangeSet).toMatchObject({
        schemaVersion: 1,
        source: {
          kind: 'rustSemanticDiff',
          beforeStateDigest: expectedSemanticDigest(),
          afterStateDigest: expectedSemanticDigest(),
        },
        reviewChanges: [expectedCellDiff('A1', 'base')],
      });
      expect(storedSemanticChangeSet.semanticDiff.changes.length).toBeGreaterThan(0);

      const diffResult = await wb.version.diff(initialized.rootCommit.id, commitResult.value.id);
      expect(diffResult).toMatchObject({
        ok: true,
        value: {
          items: [expectedCellDiff('A1', 'base')],
        },
      });
    } finally {
      if (wb) await wb.close('skipSave');
      await handle.dispose();
    }
  });
}
