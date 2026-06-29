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

export function registerPublicCopyRangeScenario(): void {
  it('commits a public copy range edit after the source value is already committed', async () => {
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
      const sheet = wb.activeSheet;

      await sheet.setCell('A1', 'source');
      const seedCommit = await wb.version.commit({
        expectedHead: {
          commitId: initialized.rootCommit.id,
          revision: initialized.initialHead.revision,
          symbolicHeadRevision: initialized.symbolicHead.revision,
        },
      });
      if (!seedCommit.ok) {
        throw new Error(
          `expected seed commit success: ${seedCommit.error.code}: ${JSON.stringify(
            seedCommit.error,
          )}`,
        );
      }

      const seedHead = await wb.version.getHead();
      if (!seedHead.ok || !seedHead.value.refRevision) {
        throw new Error(`expected seed head with ref revision: ${JSON.stringify(seedHead)}`);
      }

      await sheet.copyFrom('A1', 'B1');
      await expect(sheet.getValue('B1')).resolves.toBe('source');

      const copyCommit = await wb.version.commit({
        expectedHead: {
          commitId: seedHead.value.id,
          revision: seedHead.value.refRevision,
        },
      });
      if (!copyCommit.ok) {
        throw new Error(
          `expected copy range commit success: ${copyCommit.error.code}: ${JSON.stringify(
            copyCommit.error,
          )}`,
        );
      }

      const storedSemanticChangeSet = await readSemanticChangeSetPayload(
        provider,
        copyCommit.value.id,
      );
      expect(storedSemanticChangeSet).toMatchObject({
        schemaVersion: 1,
        source: {
          kind: 'rustSemanticDiff',
          beforeStateDigest: expectedSemanticDigest(),
          afterStateDigest: expectedSemanticDigest(),
        },
        reviewChanges: [expectedCellDiff('B1', 'source')],
      });
      expect(storedSemanticChangeSet.semanticDiff.changes.length).toBeGreaterThan(0);

      const diffResult = await wb.version.diff(seedCommit.value.id, copyCommit.value.id);
      expect(diffResult).toMatchObject({
        ok: true,
        value: {
          items: [expectedCellDiff('B1', 'source')],
        },
      });
    } finally {
      if (wb) await wb.close('skipSave');
      await handle.dispose();
    }
  });
}
