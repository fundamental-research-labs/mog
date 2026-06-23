import { expect } from '@jest/globals';

import type { IndexedDbVersionStoreProvider } from '../../../document/version-store/provider-indexeddb-backend';
import {
  DOCUMENT_ID,
  DOCUMENT_SCOPE,
  DocumentFactory,
  GRAPH_ID,
  expectCommit,
  expectHead,
  expectInitializeSuccess,
  failFirstIntentCompletion,
  namespaceForDocumentScope,
  requireRefRevision,
  resolutionFor,
  rootWrite,
  withVersionManifest,
  type Workbook,
} from './version-indexeddb-persisted-apply-recovery-test-utils';
import type {
  MergeCommitRecoveryStage,
  PersistedConflictedMergePreview,
} from './version-indexeddb-persisted-apply-recovery-merge-commit-types';

type DocumentHandle = Awaited<ReturnType<typeof DocumentFactory.create>>;

const BRANCH_REF = 'scenario/indexeddb-merge-recovery' as any;
const MAIN_REF = 'refs/heads/main' as any;

export async function stageInterruptedResolvedMergeCommitIntent(
  provider: IndexedDbVersionStoreProvider,
): Promise<MergeCommitRecoveryStage> {
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, GRAPH_ID);
  expectInitializeSuccess(
    await provider.initializeGraph({
      expectedRegistryRevision: null,
      graphId: GRAPH_ID,
      rootWrite: await rootWrite('merge-recovery-root'),
    }),
  );
  const failingProvider = failFirstIntentCompletion(provider);
  let firstHandle: DocumentHandle | undefined;
  let branchHandle: DocumentHandle | undefined;
  let firstWb: Workbook | undefined;
  let branchWb: Workbook | undefined;

  try {
    firstHandle = await DocumentFactory.create({
      documentId: DOCUMENT_ID,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    branchHandle = await DocumentFactory.create({
      documentId: DOCUMENT_ID,
      environment: 'headless',
      userTimezone: 'UTC',
    });
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
      name: BRANCH_REF,
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
        targetRef: BRANCH_REF,
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
        targetRef: MAIN_REF,
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
    const persistedPreview = preview.value as PersistedConflictedMergePreview;

    const resolution = resolutionFor(persistedPreview.conflicts[0], 'acceptTheirs');
    const interrupted = await firstWb.version.applyMerge(
      {
        resultId: persistedPreview.resultId,
        resultDigest: persistedPreview.resultDigest,
        previewArtifactDigest: persistedPreview.previewArtifactDigest,
        resolutions: [resolution],
      },
      {
        targetRef: MAIN_REF,
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
    const currentRef = await graph.readRef(MAIN_REF);
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
    branchHandle = undefined;
    await firstWb.close('skipSave');
    firstWb = undefined;
    await firstHandle.dispose();
    firstHandle = undefined;

    return {
      namespace,
      preview: persistedPreview,
      resolution,
      expectedTargetHead,
      oursCommitId: oursCommit.id,
      theirsCommitId: theirsCommit.id,
      mergeCommitId,
      resolvedAttemptDigest,
    };
  } finally {
    if (branchWb) await branchWb.close('skipSave');
    if (branchHandle) await branchHandle.dispose();
    if (firstWb) await firstWb.close('skipSave');
    if (firstHandle) await firstHandle.dispose();
  }
}
