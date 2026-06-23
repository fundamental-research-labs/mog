import { expect, it } from '@jest/globals';

import {
  AUTHOR,
  DOCUMENT_ID,
  DOCUMENT_SCOPE,
  DocumentFactory,
  GRAPH_ID,
  createIndexedDbVersionStoreProvider,
  expectCommit,
  expectHead,
  expectInitializeSuccess,
  intentIdForMergeResultId,
  namespaceForDocumentScope,
  requireRefRevision,
  rootWrite,
  withVersionManifest,
  type Workbook,
} from './version-indexeddb-persisted-apply-recovery-test-utils';

export function registerFastForwardRecoveryScenario(): void {
  it('finalizes a staged fast-forward intent when the target ref was already moved before retry', async () => {
    const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, GRAPH_ID);
    const provider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    expectInitializeSuccess(
      await provider.initializeGraph({
        expectedRegistryRevision: null,
        graphId: GRAPH_ID,
        rootWrite: await rootWrite('recovery-root'),
      }),
    );

    const firstHandle = await DocumentFactory.create({
      documentId: DOCUMENT_ID,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    let firstWb: Workbook | undefined;
    let reopenedProvider: ReturnType<typeof createIndexedDbVersionStoreProvider> | undefined;
    let reopenedHandle: Awaited<ReturnType<typeof DocumentFactory.create>> | undefined;
    let reopenedWb: Workbook | undefined;

    try {
      firstWb = await firstHandle.workbook({ versioning: withVersionManifest({ provider }) });
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
        name: 'scenario/indexeddb-recovery-incoming' as any,
        targetCommitId: oursCommit.id,
        expectedAbsent: true,
      });
      if (!branch.ok) throw new Error(`expected branch create success: ${branch.error.code}`);

      await firstWb.activeSheet.setCell('C1', 'theirs');
      const theirsCommit = await expectCommit(
        firstWb.version.commit({
          targetRef: 'scenario/indexeddb-recovery-incoming' as any,
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
      if (
        preview.value.status !== 'fastForward' ||
        !preview.value.resultId ||
        !preview.value.resultDigest
      ) {
        throw new Error('expected persisted fast-forward preview to expose result id and digest');
      }

      const intentId = intentIdForMergeResultId(preview.value.resultId);
      if (!intentId) throw new Error('expected resultId to map to an intent id');
      const intentStore = await provider.openMergeApplyIntentStore(namespace);
      const stagedIntent = await intentStore.readByIntentId(intentId);
      expect(stagedIntent).toMatchObject({
        status: 'found',
        record: { state: 'staging' },
      });
      if (stagedIntent.status !== 'found') throw new Error('expected staged intent to be readable');
      expect(stagedIntent.record.terminal).toBeUndefined();

      const graph = await provider.openGraph(namespace, provider.accessContext);
      const simulatedRefMove = await graph.fastForwardRef({
        targetRef: 'refs/heads/main' as any,
        expectedHeadCommitId: oursCommit.id,
        expectedTargetRefVersion: expectedTargetHead.revision,
        nextCommitId: theirsCommit.id,
        updatedBy: AUTHOR,
      });
      expect(simulatedRefMove).toMatchObject({
        status: 'success',
        commit: { id: theirsCommit.id },
        ref: { name: 'refs/heads/main' },
      });

      await firstWb.close('skipSave');
      firstWb = undefined;
      await firstHandle.dispose();
      await provider.close('test-teardown');

      reopenedProvider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
      reopenedHandle = await DocumentFactory.create({
        documentId: DOCUMENT_ID,
        environment: 'headless',
        userTimezone: 'UTC',
      });
      reopenedWb = await reopenedHandle.workbook({
        versioning: withVersionManifest({ provider: reopenedProvider }),
      });

      const recovered = await reopenedWb.version.applyMerge(
        {
          resultId: preview.value.resultId,
          resultDigest: preview.value.resultDigest,
        },
        {
          targetRef: 'refs/heads/main' as any,
          expectedTargetHead,
        },
      );
      if (!recovered.ok)
        throw new Error(`expected persisted apply recovery success: ${recovered.error.code}`);
      expect(recovered.value).toMatchObject({
        status: 'alreadyApplied',
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
        changes: [],
        resolutionCount: 0,
        mutationGuarantee: 'ref-not-mutated',
      });

      const finalizedStore = await reopenedProvider.openMergeApplyIntentStore(namespace);
      await expect(finalizedStore.readByIntentId(intentId)).resolves.toMatchObject({
        status: 'found',
        record: {
          state: 'finalized',
          terminal: {
            status: 'fastForwarded',
            headBefore: oursCommit.id,
            headAfter: theirsCommit.id,
            commitId: theirsCommit.id,
          },
        },
      });
    } finally {
      if (reopenedWb) await reopenedWb.close('skipSave');
      if (reopenedHandle) await reopenedHandle.dispose();
      if (reopenedProvider) await reopenedProvider.close('test-teardown');
      if (firstWb) await firstWb.close('skipSave');
      await provider.close('test-teardown');
      await firstHandle.dispose();
    }
  });
}
