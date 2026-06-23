import { jest } from '@jest/globals';

import { applyPersistedMergeResult } from '../version-apply-merge-persisted';
import {
  BASE,
  EXPECTED_TARGET_HEAD,
  MERGE,
  OURS,
  RESULT_DIGEST,
  TARGET_REF,
  THEIRS,
  artifactContext,
  artifactFixture,
  artifactInput,
  refReadSuccess,
} from './version-apply-merge-persisted-recovery-test-utils';

export function registerArtifactCompletionRecoveryScenarios() {
  it('exposes the visible merge head when artifact intent completion fails after write', async () => {
    const fixture = await artifactFixture('completion-failure-visible-head');
    const readRef = jest.fn(async () => refReadSuccess(OURS));
    const readCommit = jest.fn(async () => ({
      status: 'success',
      commit: {
        payload: {
          parentCommitIds: [OURS, THEIRS],
          resolvedMergeAttemptDigest: fixture.resolvedAttemptDigest,
        },
      },
      diagnostics: [],
    }));
    const mergeCommit = jest.fn(async () => ({
      status: 'success',
      commitRef: { id: MERGE, refName: TARGET_REF, resolvedFrom: TARGET_REF },
      diagnostics: [],
    }));
    const completeIntent = jest.fn(async () => ({
      status: 'failed',
      record: null,
      diagnostics: [
        {
          code: 'VERSION_PROVIDER_FAILED',
          message: 'completion failed',
          recoverability: 'retry',
        },
      ],
    }));

    const result = await applyPersistedMergeResult(
      artifactContext({
        fixture,
        record: fixture.record,
        readRef,
        readCommit,
        mergeCommit,
        completeIntent,
      }),
      artifactInput(),
      { targetRef: TARGET_REF, expectedTargetHead: EXPECTED_TARGET_HEAD },
    );

    expect(result).toMatchObject({
      status: 'blocked',
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      resultId: fixture.resultId,
      resultDigest: RESULT_DIGEST,
      previewArtifactDigest: RESULT_DIGEST,
      resolutionSetDigest: fixture.resolutionSetDigest,
      resolvedAttemptDigest: fixture.resolvedAttemptDigest,
      targetRef: TARGET_REF,
      headBefore: OURS,
      headAfter: MERGE,
      mutationGuarantee: 'unknown-after-crash',
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_PROVIDER_FAILED',
          safeMessage: 'completion failed',
        }),
      ],
    });
    expect(readRef).toHaveBeenCalledWith(TARGET_REF);
    expect(readCommit).toHaveBeenCalledWith(MERGE);
    expect(mergeCommit).toHaveBeenCalledTimes(1);
    expect(completeIntent).toHaveBeenCalledTimes(1);
  });
}
