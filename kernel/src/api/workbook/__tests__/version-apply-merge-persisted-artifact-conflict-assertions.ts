import { expect } from '@jest/globals';
import type {
  VersionApplyMergeResult,
  VersionMergeResult,
  VersionSealedResolutionPayloadRef,
  WorkbookCommitSummary,
} from '@mog-sdk/contracts/api';

import { mergeResolutionSetArtifactRef } from '../../../document/version-store/merge-attempt-artifacts';
import type { PersistedMergeScenario } from './version-apply-merge-persisted-artifact-test-utils';

type PersistedMergeMetadata = {
  readonly resultId: NonNullable<VersionMergeResult['resultId']>;
  readonly resultDigest: NonNullable<VersionMergeResult['resultDigest']>;
  readonly previewArtifactDigest: NonNullable<VersionMergeResult['previewArtifactDigest']>;
};

export type PersistedConflictedMergePreview = Extract<
  VersionMergeResult,
  { readonly status: 'conflicted' }
> &
  PersistedMergeMetadata;

export type ReplayedPersistedConflictPreview = Extract<
  VersionApplyMergeResult,
  { readonly status: 'conflicted' }
> &
  PersistedMergeMetadata;

export type AppliedPersistedConflictMerge = Extract<
  VersionApplyMergeResult,
  { readonly status: 'applied' }
> &
  PersistedMergeMetadata & {
    readonly resolutionSetDigest: NonNullable<VersionApplyMergeResult['resolutionSetDigest']>;
    readonly resolvedAttemptDigest: NonNullable<VersionApplyMergeResult['resolvedAttemptDigest']>;
  };

export function requirePersistedConflictedPreview(
  preview: VersionMergeResult,
): PersistedConflictedMergePreview {
  if (
    preview.status !== 'conflicted' ||
    !preview.resultId ||
    !preview.resultDigest ||
    !preview.previewArtifactDigest
  ) {
    throw new Error('expected conflicted preview to expose persisted artifact metadata');
  }
  return preview as PersistedConflictedMergePreview;
}

export function expectReplayedConflictedPreview(input: {
  readonly replayedPreview: VersionApplyMergeResult;
  readonly preview: PersistedConflictedMergePreview;
  readonly baseCommit: WorkbookCommitSummary;
  readonly oursCommit: WorkbookCommitSummary;
  readonly theirsCommit: WorkbookCommitSummary;
}): ReplayedPersistedConflictPreview {
  const { replayedPreview, preview, baseCommit, oursCommit, theirsCommit } = input;

  expect(replayedPreview).toMatchObject({
    status: 'conflicted',
    base: baseCommit.id,
    ours: oursCommit.id,
    theirs: theirsCommit.id,
    resultId: preview.resultId,
    resultDigest: preview.resultDigest,
    previewArtifactDigest: preview.previewArtifactDigest,
    changes: preview.changes,
    conflicts: expect.arrayContaining([
      expect.objectContaining({
        conflictId: preview.conflicts[0].conflictId,
        conflictDigest: preview.conflicts[0].conflictDigest,
        resolutionOptions: expect.arrayContaining([
          expect.objectContaining({ kind: 'acceptOurs' }),
          expect.objectContaining({ kind: 'acceptTheirs' }),
          expect.objectContaining({ kind: 'acceptBase' }),
        ]),
      }),
    ]),
    requiredResolutionCount: preview.conflicts.length,
    mutationGuarantee: 'preview-only',
  });
  if (replayedPreview.status !== 'conflicted') {
    throw new Error('expected replayed preview to remain conflicted');
  }

  return replayedPreview as ReplayedPersistedConflictPreview;
}

export function expectAppliedConflictMerge(input: {
  readonly applied: VersionApplyMergeResult;
  readonly preview: PersistedConflictedMergePreview;
  readonly oursCommit: WorkbookCommitSummary;
  readonly theirsCommit: WorkbookCommitSummary;
}): AppliedPersistedConflictMerge {
  const { applied, preview, oursCommit, theirsCommit } = input;

  expect(applied).toMatchObject({
    status: 'applied',
    ours: oursCommit.id,
    theirs: theirsCommit.id,
    resultId: preview.resultId,
    resultDigest: preview.resultDigest,
    previewArtifactDigest: preview.previewArtifactDigest,
    resolutionSetDigest: {
      algorithm: 'sha256',
      digest: expect.stringMatching(/^[0-9a-f]{64}$/),
    },
    resolvedAttemptDigest: {
      algorithm: 'sha256',
      digest: expect.stringMatching(/^[0-9a-f]{64}$/),
    },
    targetRef: 'refs/heads/main',
    resolutionCount: 1,
    mutationGuarantee: 'merge-commit-created',
  });
  if (applied.status !== 'applied' || !applied.resolutionSetDigest) {
    throw new Error('expected applied merge to expose a resolution set digest');
  }

  return applied as AppliedPersistedConflictMerge;
}

export async function expectPersistedResolutionSetArtifact(
  fixture: PersistedMergeScenario,
  applied: AppliedPersistedConflictMerge,
  sealedPayloadRef: VersionSealedResolutionPayloadRef,
): Promise<void> {
  const graph = await fixture.provider.openGraph(fixture.namespace, fixture.provider.accessContext);
  await expect(
    graph.getObjectRecord(mergeResolutionSetArtifactRef(applied.resolutionSetDigest)),
  ).resolves.toMatchObject({
    preimage: {
      payload: {
        resolutions: [expect.objectContaining({ sealedPayloadRef })],
      },
    },
  });
}

export async function expectMergeCommitAndResolvedCell(input: {
  readonly fixture: PersistedMergeScenario;
  readonly mergeCommitId: WorkbookCommitSummary['id'];
  readonly oursCommit: WorkbookCommitSummary;
  readonly theirsCommit: WorkbookCommitSummary;
}): Promise<void> {
  const { fixture, mergeCommitId, oursCommit, theirsCommit } = input;

  await expect(fixture.sourceWb.version.listCommits()).resolves.toMatchObject({
    ok: true,
    value: {
      items: expect.arrayContaining([
        expect.objectContaining({
          id: mergeCommitId,
          parents: [oursCommit.id, theirsCommit.id],
        }),
      ]),
    },
  });

  const mergedWb = await fixture.openMergedWorkbook();
  const checkoutMerged = await mergedWb.version.checkout({
    kind: 'commit',
    id: mergeCommitId,
  });
  if (!checkoutMerged.ok) {
    throw new Error(`expected merged checkout success: ${checkoutMerged.error.code}`);
  }
  await expect(mergedWb.activeSheet.getCell('A1')).resolves.toMatchObject({ value: 'theirs' });
}

export function expectRepeatedConflictApply(input: {
  readonly repeated: VersionApplyMergeResult;
  readonly preview: PersistedConflictedMergePreview;
  readonly applied: AppliedPersistedConflictMerge;
  readonly mergeCommitId: WorkbookCommitSummary['id'];
  readonly oursCommit: WorkbookCommitSummary;
  readonly theirsCommit: WorkbookCommitSummary;
}): void {
  const { repeated, preview, applied, mergeCommitId, oursCommit, theirsCommit } = input;

  expect(repeated).toMatchObject({
    status: 'alreadyApplied',
    ours: oursCommit.id,
    theirs: theirsCommit.id,
    resultId: preview.resultId,
    resultDigest: preview.resultDigest,
    previewArtifactDigest: preview.previewArtifactDigest,
    resolutionSetDigest: applied.resolutionSetDigest,
    resolvedAttemptDigest: applied.resolvedAttemptDigest,
    targetRef: 'refs/heads/main',
    headBefore: oursCommit.id,
    headAfter: mergeCommitId,
    commitRef: {
      id: mergeCommitId,
      refName: 'refs/heads/main',
      resolvedFrom: 'refs/heads/main',
    },
    changes: [],
    resolutionCount: 0,
    mutationGuarantee: 'ref-not-mutated',
  });
}
