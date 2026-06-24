import { expect } from '@jest/globals';

import type { IndexedDbVersionStoreProvider } from '../../../document/version-store/provider-indexeddb/backend';
import {
  AUTHOR,
  DOCUMENT_ID,
  DOCUMENT_SCOPE,
  DocumentFactory,
  GRAPH_ID,
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
import type {
  FastForwardRecoveryStage,
  PersistedFastForwardMergePreview,
} from './version-indexeddb-persisted-apply-recovery-fast-forward-types';

type DocumentHandle = Awaited<ReturnType<typeof DocumentFactory.create>>;

const BRANCH_REF = 'scenario/indexeddb-recovery-incoming' as any;
const MAIN_REF = 'refs/heads/main' as any;

export async function stageFastForwardIntentAfterTargetRefMove(
  provider: IndexedDbVersionStoreProvider,
): Promise<FastForwardRecoveryStage> {
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, GRAPH_ID);
  expectInitializeSuccess(
    await provider.initializeGraph({
      expectedRegistryRevision: null,
      graphId: GRAPH_ID,
      rootWrite: await rootWrite('recovery-root'),
    }),
  );

  let firstHandle: DocumentHandle | undefined;
  let firstWb: Workbook | undefined;

  try {
    firstHandle = await DocumentFactory.create({
      documentId: DOCUMENT_ID,
      environment: 'headless',
      userTimezone: 'UTC',
    });
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
      name: BRANCH_REF,
      targetCommitId: oursCommit.id,
      expectedAbsent: true,
    });
    if (!branch.ok) throw new Error(`expected branch create success: ${branch.error.code}`);

    await firstWb.activeSheet.setCell('C1', 'theirs');
    const theirsCommit = await expectCommit(
      firstWb.version.commit({
        targetRef: BRANCH_REF,
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
        targetRef: MAIN_REF,
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
    const persistedPreview = preview.value as PersistedFastForwardMergePreview;

    const intentId = intentIdForMergeResultId(persistedPreview.resultId);
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
      targetRef: MAIN_REF,
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
    firstHandle = undefined;

    return {
      namespace,
      preview: persistedPreview,
      intentId,
      expectedTargetHead,
      oursCommitId: oursCommit.id,
      theirsCommitId: theirsCommit.id,
    };
  } finally {
    if (firstWb) await firstWb.close('skipSave');
    if (firstHandle) await firstHandle.dispose();
  }
}
