import { expect, it } from '@jest/globals';
import type { Workbook } from '@mog-sdk/contracts/api';

import { DocumentFactory } from '../../document/document-factory';
import { withVersionManifest } from './version-domain-support-test-utils';
import {
  INDEXEDDB_PERSISTED_APPLY_DOCUMENT_ID as DOCUMENT_ID,
  INDEXEDDB_PERSISTED_APPLY_GRAPH_ID as GRAPH_ID,
  rootWrite,
} from './version-indexeddb-persisted-apply-test-utils';
import {
  expectCommit,
  expectHead,
  requireRefRevision,
} from './version-indexeddb-persisted-apply-test-helpers';
import { INDEXEDDB_VERSION_STORE_PROVIDER_KIND } from '../../../document/version-store/provider-indexeddb-backend';

export function describeIndexedDbPersistedApplyFastForwardScenarios(): void {
  it('applies a persisted fast-forward result after provider-selection reopen', async () => {
    const firstHandle = await DocumentFactory.create({
      documentId: DOCUMENT_ID,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    let firstWb: Workbook | undefined;
    let reopenedHandle: Awaited<ReturnType<typeof DocumentFactory.create>> | undefined;
    let reopenedWb: Workbook | undefined;
    let checkoutHandle: Awaited<ReturnType<typeof DocumentFactory.create>> | undefined;
    let checkoutWb: Workbook | undefined;

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
      const rootHead = await expectHead(firstWb);

      await firstWb.activeSheet.setCell('A1', 'base');
      const baseCommit = await expectCommit(
        firstWb.version.commit({
          expectedHead: {
            commitId: rootHead.id,
            revision: requireRefRevision(rootHead),
          },
        }),
      );
      const baseHead = await expectHead(firstWb);

      await firstWb.activeSheet.setCell('B1', 'ours');
      const oursCommit = await expectCommit(
        firstWb.version.commit({
          expectedHead: {
            commitId: baseCommit.id,
            revision: requireRefRevision(baseHead),
          },
        }),
      );
      const oursHead = await expectHead(firstWb);

      const branch = await firstWb.version.createBranch({
        name: 'scenario/indexeddb-persisted-incoming' as any,
        targetCommitId: oursCommit.id,
        expectedAbsent: true,
      });
      if (!branch.ok) throw new Error(`expected branch create success: ${branch.error.code}`);

      await firstWb.activeSheet.setCell('C1', 'theirs');
      const theirsCommit = await expectCommit(
        firstWb.version.commit({
          targetRef: 'scenario/indexeddb-persisted-incoming' as any,
          expectedHead: {
            commitId: oursCommit.id,
            revision: branch.value.revision,
          },
        }),
      );

      const expectedTargetHead = {
        commitId: oursCommit.id,
        revision: requireRefRevision(oursHead),
      };
      const preview = await firstWb.version.merge(
        {
          base: baseCommit.id,
          ours: oursCommit.id,
          theirs: theirsCommit.id,
        },
        {
          mode: 'preview',
          targetRef: 'refs/heads/main' as any,
          expectedTargetHead,
          persistReviewRecord: true,
        },
      );
      if (!preview.ok)
        throw new Error(`expected persisted merge preview success: ${preview.error.code}`);
      expect(preview.value).toMatchObject({
        status: 'fastForward',
        resultId: expect.stringMatching(/^merge-result:[0-9a-f]{64}$/),
        resultDigest: {
          algorithm: 'sha256',
          digest: expect.stringMatching(/^[0-9a-f]{64}$/),
        },
        attemptPersistence: 'persisted',
        attemptKind: 'applyable',
      });
      if (
        preview.value.status !== 'fastForward' ||
        !preview.value.resultId ||
        !preview.value.resultDigest
      ) {
        throw new Error('expected persisted fast-forward preview to expose result id and digest');
      }

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

      const applied = await reopenedWb.version.applyMerge(
        {
          resultId: preview.value.resultId,
          resultDigest: preview.value.resultDigest,
        },
        {
          targetRef: 'refs/heads/main' as any,
          expectedTargetHead,
        },
      );
      if (!applied.ok)
        throw new Error(`expected persisted apply success after reopen: ${applied.error.code}`);
      expect(applied.value).toMatchObject({
        status: 'fastForwarded',
        ours: oursCommit.id,
        theirs: theirsCommit.id,
        commitRef: {
          id: theirsCommit.id,
          refName: 'refs/heads/main',
          resolvedFrom: 'refs/heads/main',
        },
        resultId: preview.value.resultId,
        resultDigest: preview.value.resultDigest,
        targetRef: 'refs/heads/main',
        headBefore: oursCommit.id,
        headAfter: theirsCommit.id,
        mutationGuarantee: 'ref-fast-forwarded',
      });

      checkoutHandle = await DocumentFactory.create({
        documentId: DOCUMENT_ID,
        environment: 'headless',
        userTimezone: 'UTC',
      });
      checkoutWb = await checkoutHandle.workbook({
        versioning: withVersionManifest({
          providerSelection: {
            kind: INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
            requireDurablePersistence: true,
          },
        }),
      });
      const checkout = await checkoutWb.version.checkout({ kind: 'commit', id: theirsCommit.id });
      if (!checkout.ok)
        throw new Error(`expected checkout after persisted apply: ${checkout.error.code}`);
      await expect(checkoutWb.activeSheet.getCell('A1')).resolves.toMatchObject({ value: 'base' });
      await expect(checkoutWb.activeSheet.getCell('B1')).resolves.toMatchObject({ value: 'ours' });
      await expect(checkoutWb.activeSheet.getCell('C1')).resolves.toMatchObject({
        value: 'theirs',
      });
    } finally {
      if (checkoutWb) await checkoutWb.close('skipSave');
      if (checkoutHandle) await checkoutHandle.dispose();
      if (reopenedWb) await reopenedWb.close('skipSave');
      if (reopenedHandle) await reopenedHandle.dispose();
      if (firstWb) await firstWb.close('skipSave');
      await firstHandle.dispose();
    }
  });
}
