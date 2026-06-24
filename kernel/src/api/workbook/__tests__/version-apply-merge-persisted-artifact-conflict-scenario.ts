import { expect, it } from '@jest/globals';
import type { VersionCommitExpectedHead, Workbook } from '@mog-sdk/contracts/api';

import {
  expectAppliedConflictMerge,
  expectMergeCommitAndResolvedCell,
  expectPersistedResolutionSetArtifact,
  expectRepeatedConflictApply,
  expectReplayedConflictedPreview,
  requirePersistedConflictedPreview,
} from './version-apply-merge-persisted-artifact-conflict-assertions';
import { sealAcceptTheirsResolution } from './version-apply-merge-persisted-artifact-conflict-resolutions';
import {
  createPersistedMergeScenario,
  PERSISTED_ARTIFACT_TARGET_REF,
} from './version-apply-merge-persisted-artifact-test-utils';

export function registerPersistedConflictArtifactScenario(): void {
  it('replays a persisted conflicted review artifact without an apply intent', async () => {
    const fixture = await createPersistedMergeScenario({
      graphId: 'graph-conflict-artifact',
      branchName: 'scenario/persisted-conflict-artifact',
      ours: [{ cell: 'A1', value: 'ours' }],
      theirs: [{ cell: 'A1', value: 'theirs' }],
    });

    try {
      const { sourceWb, baseCommit, oursCommit, theirsCommit } = fixture;
      const previewResult = await sourceWb.version.merge(
        {
          base: baseCommit.id,
          ours: oursCommit.id,
          theirs: theirsCommit.id,
        },
        {
          mode: 'preview',
          targetRef: PERSISTED_ARTIFACT_TARGET_REF,
          expectedTargetHead: fixture.expectedTargetHead,
          persistReviewRecord: true,
        },
      );
      if (!previewResult.ok) {
        throw new Error(`expected persisted conflicted preview: ${previewResult.error.code}`);
      }
      const preview = requirePersistedConflictedPreview(previewResult.value);

      const replayedPreviewResult = await sourceWb.version.applyMerge(
        {
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          previewArtifactDigest: preview.previewArtifactDigest,
        },
        { mode: 'preview' },
      );
      if (!replayedPreviewResult.ok) {
        throw new Error(`expected conflicted replay success: ${replayedPreviewResult.error.code}`);
      }
      const replayedPreview = expectReplayedConflictedPreview({
        replayedPreview: replayedPreviewResult.value,
        preview,
        baseCommit,
        oursCommit,
        theirsCommit,
      });

      const { sealedResolution, sealedPayloadRef } = await sealAcceptTheirsResolution({
        fixture,
        preview,
        conflict: replayedPreview.conflicts[0],
      });

      const appliedResult = await sourceWb.version.applyMerge(
        {
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          previewArtifactDigest: preview.previewArtifactDigest,
          resolutions: [sealedResolution],
        },
        {
          targetRef: PERSISTED_ARTIFACT_TARGET_REF,
          expectedTargetHead: fixture.expectedTargetHead,
        },
      );
      if (!appliedResult.ok) {
        throw new Error(`expected persisted conflict apply success: ${appliedResult.error.code}`);
      }
      const applied = expectAppliedConflictMerge({
        applied: appliedResult.value,
        preview,
        oursCommit,
        theirsCommit,
      });
      await expectPersistedResolutionSetArtifact(fixture, applied, sealedPayloadRef);

      const mergeCommitId = applied.commitRef.id;
      await expectMergeCommitAndResolvedCell({
        fixture,
        mergeCommitId,
        oursCommit,
        theirsCommit,
      });

      const repeated = await sourceWb.version.applyMerge(
        {
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          previewArtifactDigest: preview.previewArtifactDigest,
          resolutions: [sealedResolution],
        },
        {
          targetRef: PERSISTED_ARTIFACT_TARGET_REF,
          expectedTargetHead: fixture.expectedTargetHead,
        },
      );
      if (!repeated.ok) {
        throw new Error(
          `expected repeated persisted conflict apply success: ${repeated.error.code}`,
        );
      }
      expectRepeatedConflictApply({
        repeated: repeated.value,
        preview,
        applied,
        mergeCommitId,
        oursCommit,
        theirsCommit,
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it('applies a conflicted persisted review artifact after reopen with a fresh target ref CAS proof', async () => {
    const fixture = await createPersistedMergeScenario({
      graphId: 'graph-conflict-artifact-reopen',
      branchName: 'scenario/persisted-conflict-artifact-reopen',
      ours: [{ cell: 'A1', value: 'ours' }],
      theirs: [{ cell: 'A1', value: 'theirs' }],
    });

    try {
      const { sourceWb, baseCommit, oursCommit, theirsCommit } = fixture;
      const previewResult = await sourceWb.version.merge(
        {
          base: baseCommit.id,
          ours: oursCommit.id,
          theirs: theirsCommit.id,
        },
        {
          mode: 'preview',
          targetRef: PERSISTED_ARTIFACT_TARGET_REF,
          expectedTargetHead: fixture.expectedTargetHead,
          persistReviewRecord: true,
        },
      );
      if (!previewResult.ok) {
        throw new Error(`expected persisted conflicted preview: ${previewResult.error.code}`);
      }
      const preview = requirePersistedConflictedPreview(previewResult.value);

      const reopenedWb = await fixture.openMergedWorkbook();
      const replayedPreviewResult = await reopenedWb.version.applyMerge(
        {
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          previewArtifactDigest: preview.previewArtifactDigest,
        },
        { mode: 'preview' },
      );
      if (!replayedPreviewResult.ok) {
        throw new Error(
          `expected conflicted replay after reopen: ${replayedPreviewResult.error.code}`,
        );
      }
      const replayedPreview = expectReplayedConflictedPreview({
        replayedPreview: replayedPreviewResult.value,
        preview,
        baseCommit,
        oursCommit,
        theirsCommit,
      });

      const expectedTargetHead = await readFreshExpectedTargetHead(reopenedWb);
      expect(expectedTargetHead.commitId).toBe(oursCommit.id);
      await expect(reopenedWb.version.readRef('HEAD')).resolves.toMatchObject({
        ok: true,
        value: {
          status: 'success',
          ref: {
            name: 'HEAD',
            target: PERSISTED_ARTIFACT_TARGET_REF,
          },
        },
      });

      const { sealedResolution, sealedPayloadRef } = await sealAcceptTheirsResolution({
        fixture,
        workbook: reopenedWb,
        expectedTargetHead,
        preview,
        conflict: replayedPreview.conflicts[0],
      });

      const appliedResult = await reopenedWb.version.applyMerge(
        {
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          previewArtifactDigest: preview.previewArtifactDigest,
          resolutions: [sealedResolution],
        },
        {
          targetRef: PERSISTED_ARTIFACT_TARGET_REF,
          expectedTargetHead,
        },
      );
      if (!appliedResult.ok) {
        throw new Error(
          `expected reopened persisted conflict apply success: ${appliedResult.error.code}`,
        );
      }
      if (appliedResult.value.status === 'staleTargetHead') {
        throw new Error(
          `unexpected staleTargetHead after fresh readRef CAS proof: ${JSON.stringify({
            expectedTargetHead,
            diagnostics: appliedResult.value.diagnostics,
          })}`,
        );
      }

      const applied = expectAppliedConflictMerge({
        applied: appliedResult.value,
        preview,
        oursCommit,
        theirsCommit,
      });
      await expectPersistedResolutionSetArtifact(fixture, applied, sealedPayloadRef);
      await expectMergeCommitAndResolvedCell({
        fixture,
        mergeCommitId: applied.commitRef.id,
        oursCommit,
        theirsCommit,
      });
    } finally {
      await fixture.cleanup();
    }
  });
}

async function readFreshExpectedTargetHead(wb: Workbook): Promise<VersionCommitExpectedHead> {
  const targetRead = await wb.version.readRef(PERSISTED_ARTIFACT_TARGET_REF);
  if (!targetRead.ok) {
    throw new Error(`expected target ref read success: ${targetRead.error.code}`);
  }
  if (targetRead.value.status !== 'success' || !isConcreteMainRef(targetRead.value.ref)) {
    throw new Error(`expected concrete main ref read success: ${JSON.stringify(targetRead.value)}`);
  }
  return {
    commitId: targetRead.value.ref.commitId,
    revision: targetRead.value.ref.revision,
  };
}

function isConcreteMainRef(value: unknown): value is {
  readonly name: typeof PERSISTED_ARTIFACT_TARGET_REF;
  readonly commitId: VersionCommitExpectedHead['commitId'];
  readonly revision: VersionCommitExpectedHead['revision'];
} {
  if (!value || typeof value !== 'object') return false;
  const ref = value as {
    readonly name?: unknown;
    readonly commitId?: unknown;
    readonly revision?: unknown;
  };
  const revision = ref.revision as
    | { readonly kind?: unknown; readonly value?: unknown }
    | undefined;
  return (
    ref.name === PERSISTED_ARTIFACT_TARGET_REF &&
    typeof ref.commitId === 'string' &&
    !!revision &&
    (revision.kind === 'counter' || revision.kind === 'opaque') &&
    typeof revision.value === 'string'
  );
}
