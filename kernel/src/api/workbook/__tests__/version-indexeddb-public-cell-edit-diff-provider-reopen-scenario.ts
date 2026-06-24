import type { Workbook } from '@mog-sdk/contracts/api';

import { DocumentFactory } from '../../document/document-factory';
import { INDEXEDDB_VERSION_STORE_PROVIDER_KIND } from '../../../document/version-store/provider-indexeddb/backend';
import { withVersionManifest } from './version-domain-support-test-utils';
import {
  DOCUMENT_ID,
  expectedCellDiff,
  GRAPH_ID,
  rootWrite,
} from './version-indexeddb-public-cell-edit-diff-test-utils';

export function registerProviderReopenPublicCellEditDiffScenario(): void {
  it('persists real public cell edit commits and semantic diffs across provider selection reopen', async () => {
    const firstHandle = await DocumentFactory.create({
      documentId: DOCUMENT_ID,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    let firstWb: Workbook | undefined;
    let reopenedHandle: Awaited<ReturnType<typeof DocumentFactory.create>> | undefined;
    let reopenedWb: Workbook | undefined;

    try {
      firstWb = await firstHandle.workbook({
        versioning: withVersionManifest({
          providerSelection: {
            kind: INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
            requireDurablePersistence: true,
            initialize: {
              graphId: GRAPH_ID,
              rootWrite: await rootWrite('root'),
            },
          },
        }),
      });
      const rootHeadResult = await firstWb.version.getHead();
      expect(rootHeadResult).toMatchObject({
        ok: true,
        value: { refName: 'refs/heads/main', resolvedFrom: 'HEAD' },
      });
      if (!rootHeadResult.ok) {
        throw new Error(`expected initialized head: ${rootHeadResult.error.code}`);
      }
      const rootHead = rootHeadResult.value;
      if (!rootHead.refRevision) {
        throw new Error('expected initialized head to include a ref revision');
      }

      await firstWb.activeSheet.setCell('A1', 5);
      await firstWb.activeSheet.setFormula('A2', '=A1*2');

      const committedResult = await firstWb.version.commit({
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
        throw new Error(`expected indexeddb public commit: ${committedResult.error.code}`);
      }
      const committed = committedResult.value;

      await firstWb.close('skipSave');
      firstWb = undefined;
      await firstHandle.dispose();

      reopenedHandle = await DocumentFactory.create({
        documentId: DOCUMENT_ID,
        environment: 'headless',
        userTimezone: 'UTC',
      });
      reopenedWb = await reopenedHandle.workbook({
        versioning: withVersionManifest({
          providerSelection: {
            kind: INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
            requireDurablePersistence: true,
          },
        }),
      });

      await expect(reopenedWb.version.getHead()).resolves.toMatchObject({
        ok: true,
        value: {
          id: committed.id,
          refName: 'refs/heads/main',
          resolvedFrom: 'HEAD',
        },
      });
      await expect(reopenedWb.version.listCommits()).resolves.toMatchObject({
        ok: true,
        value: {
          items: expect.arrayContaining([
            expect.objectContaining({ id: committed.id, parents: [rootHead.id] }),
            expect.objectContaining({ id: rootHead.id, parents: [] }),
          ]),
        },
      });
      const diffResult = await reopenedWb.version.diff(rootHead.id, committed.id);
      if (!diffResult.ok) {
        throw new Error(`expected indexeddb diff: ${JSON.stringify(diffResult.error)}`);
      }
      expect(diffResult).toMatchObject({
        ok: true,
        value: {
          items: expect.arrayContaining([
            expectedCellDiff('A1', 5),
            expectedCellDiff('A2', { kind: 'formula', formula: '=A1*2', result: 10 }),
          ]),
        },
      });
    } finally {
      if (reopenedWb) await reopenedWb.close('skipSave');
      if (reopenedHandle) await reopenedHandle.dispose();
      if (firstWb) await firstWb.close('skipSave');
      await firstHandle.dispose();
    }
  });
}
