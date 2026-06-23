import {
  expectCommit,
  expectHead,
  requireRefRevision,
  resolutionFor,
  type Workbook,
} from './version-indexeddb-persisted-apply-recovery-test-utils';
import type {
  MergeCommitRecoveryStage,
  PersistedConflictedMergePreview,
} from './version-indexeddb-persisted-apply-recovery-merge-commit-types';

export const BRANCH_REF = 'scenario/indexeddb-merge-recovery' as any;
export const MAIN_REF = 'refs/heads/main' as any;

export type PersistedConflictedMergePreviewStage = Pick<
  MergeCommitRecoveryStage,
  'preview' | 'resolution' | 'expectedTargetHead' | 'oursCommitId' | 'theirsCommitId'
>;

export async function createPersistedConflictedMergePreview({
  firstWb,
  branchWb,
}: {
  readonly firstWb: Workbook;
  readonly branchWb: Workbook;
}): Promise<PersistedConflictedMergePreviewStage> {
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

  return {
    preview: persistedPreview,
    resolution: resolutionFor(persistedPreview.conflicts[0], 'acceptTheirs'),
    expectedTargetHead,
    oursCommitId: oursCommit.id,
    theirsCommitId: theirsCommit.id,
  };
}
