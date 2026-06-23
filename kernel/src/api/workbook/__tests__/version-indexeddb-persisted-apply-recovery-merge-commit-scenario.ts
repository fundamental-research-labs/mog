import { expect, it } from '@jest/globals';

import {
  DOCUMENT_ID,
  DOCUMENT_SCOPE,
  DocumentFactory,
  GRAPH_ID,
  INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
  createIndexedDbVersionStoreProvider,
  expectCommit,
  expectHead,
  expectInitializeSuccess,
  failFirstIntentCompletion,
  intentIdForResolvedAttemptDigest,
  namespaceForDocumentScope,
  requireRefRevision,
  resolutionFor,
  rootWrite,
  withVersionManifest,
  type Workbook,
} from './version-indexeddb-persisted-apply-recovery-test-utils';

export function registerMergeCommitRecoveryScenario(): void {
  it('recovers a staged resolved mergeCommit intent when the target ref already points at the merge commit', async () => {
    const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, GRAPH_ID);
    const provider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    expectInitializeSuccess(
      await provider.initializeGraph({
        expectedRegistryRevision: null,
        graphId: GRAPH_ID,
        rootWrite: await rootWrite('merge-recovery-root'),
      }),
    );
    const failingProvider = failFirstIntentCompletion(provider);
    const firstHandle = await DocumentFactory.create({
      documentId: DOCUMENT_ID,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    const branchHandle = await DocumentFactory.create({
      documentId: DOCUMENT_ID,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    let firstWb: Workbook | undefined;
    let branchWb: Workbook | undefined;
    let reopenedHandle: Awaited<ReturnType<typeof DocumentFactory.create>> | undefined;
    let reopenedWb: Workbook | undefined;

    try {
      firstWb = await firstHandle.workbook({
        versioning: withVersionManifest({ provider: failingProvider }),
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

      const branch = await firstWb.version.createBranch({
        name: 'scenario/indexeddb-merge-recovery' as any,
        targetCommitId: baseCommit.id,
        expectedAbsent: true,
      });
      if (!branch.ok) throw new Error(`expected branch create success: ${branch.error.code}`);

      await firstWb.activeSheet.setCell('A1', 'ours');
      const oursCommit = await expectCommit(
        firstWb.version.commit({
          expectedHead: {
            commitId: baseCommit.id,
            revision: requireRefRevision(baseHead),
          },
        }),
      );
      const oursHead = await expectHead(firstWb);

      branchWb = await branchHandle.workbook({
        versioning: withVersionManifest({ provider: failingProvider }),
      });
      const checkoutBase = await branchWb.version.checkout({ kind: 'commit', id: baseCommit.id });
      if (!checkoutBase.ok) {
        throw new Error(`expected branch workbook checkout success: ${checkoutBase.error.code}`);
      }
      await branchWb.activeSheet.setCell('A1', 'theirs');
      const theirsCommit = await expectCommit(
        branchWb.version.commit({
          targetRef: 'scenario/indexeddb-merge-recovery' as any,
          expectedHead: {
            commitId: baseCommit.id,
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
        throw new Error(`expected persisted conflicted preview success: ${preview.error.code}`);
      if (
        preview.value.status !== 'conflicted' ||
        !preview.value.resultId ||
        !preview.value.resultDigest ||
        !preview.value.previewArtifactDigest
      ) {
        throw new Error('expected persisted conflicted review artifact metadata');
      }

      const resolution = resolutionFor(preview.value.conflicts[0], 'acceptTheirs');
      const interrupted = await firstWb.version.applyMerge(
        {
          resultId: preview.value.resultId,
          resultDigest: preview.value.resultDigest,
          previewArtifactDigest: preview.value.previewArtifactDigest,
          resolutions: [resolution],
        },
        {
          targetRef: 'refs/heads/main' as any,
          expectedTargetHead,
        },
      );
      expect(interrupted).toMatchObject({
        ok: false,
        error: {
          code: 'target_unavailable',
          target: 'workbook.version.applyMerge',
        },
      });
      const graph = await provider.openGraph(namespace, provider.accessContext);
      const currentRef = await graph.readRef('refs/heads/main' as any);
      expect(currentRef).toMatchObject({ status: 'success' });
      if (currentRef.status !== 'success' || !('commitId' in currentRef.ref)) {
        throw new Error('expected main ref to point at interrupted merge commit');
      }
      const mergeCommitId = currentRef.ref.commitId;
      const interruptedCommit = await graph.readCommit(mergeCommitId);
      expect(interruptedCommit).toMatchObject({
        status: 'success',
        commit: {
          payload: {
            parentCommitIds: [oursCommit.id, theirsCommit.id],
            resolvedMergeAttemptDigest: {
              algorithm: 'sha256',
              digest: expect.stringMatching(/^[0-9a-f]{64}$/),
            },
          },
        },
      });
      if (interruptedCommit.status !== 'success') {
        throw new Error(
          `expected interrupted merge commit read: ${interruptedCommit.diagnostics[0]?.code}`,
        );
      }
      const resolvedAttemptDigest = interruptedCommit.commit.payload.resolvedMergeAttemptDigest;
      if (!resolvedAttemptDigest) throw new Error('expected merge commit attempt digest');

      await branchWb.close('skipSave');
      branchWb = undefined;
      await branchHandle.dispose();
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

      const recovered = await reopenedWb.version.applyMerge(
        {
          resultId: preview.value.resultId,
          resultDigest: preview.value.resultDigest,
          previewArtifactDigest: preview.value.previewArtifactDigest,
          resolutions: [resolution],
        },
        {
          targetRef: 'refs/heads/main' as any,
          expectedTargetHead,
        },
      );
      if (!recovered.ok) throw new Error(`expected merge intent recovery: ${recovered.error.code}`);
      expect(recovered.value).toMatchObject({
        status: 'alreadyApplied',
        commitRef: {
          id: mergeCommitId,
          refName: 'refs/heads/main',
          resolvedFrom: 'refs/heads/main',
        },
        resultId: preview.value.resultId,
        resultDigest: preview.value.resultDigest,
        previewArtifactDigest: preview.value.previewArtifactDigest,
        resolvedAttemptDigest,
        targetRef: 'refs/heads/main',
        headBefore: oursCommit.id,
        headAfter: mergeCommitId,
        mutationGuarantee: 'ref-not-mutated',
      });
      const finalizedStore = await provider.openMergeApplyIntentStore(namespace);
      await expect(
        finalizedStore.readByIntentId(intentIdForResolvedAttemptDigest(resolvedAttemptDigest)),
      ).resolves.toMatchObject({
        status: 'found',
        record: {
          state: 'finalized',
          terminal: {
            status: 'applied',
            headBefore: oursCommit.id,
            headAfter: mergeCommitId,
            commitId: mergeCommitId,
            refCasProof: expect.objectContaining({ schemaVersion: 1, applyKind: 'mergeCommit' }),
          },
        },
      });
    } finally {
      if (reopenedWb) await reopenedWb.close('skipSave');
      if (reopenedHandle) await reopenedHandle.dispose();
      if (branchWb) await branchWb.close('skipSave');
      await branchHandle.dispose();
      if (firstWb) await firstWb.close('skipSave');
      await provider.close('test-teardown');
      await firstHandle.dispose();
    }
  });
}
