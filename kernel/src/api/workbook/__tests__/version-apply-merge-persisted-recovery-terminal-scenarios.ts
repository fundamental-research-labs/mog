import { jest } from '@jest/globals';

import { applyPersistedMergeResult } from '../version/apply-merge/version-apply-merge-persisted';
import type { MergeApplyIntentRecord } from '../../../document/version-store/merge-apply-intent-store';
import {
  ADVANCED,
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
  expectPublicSafeDiagnostics,
  mutateDigest,
  refReadSuccess,
} from './version-apply-merge-persisted-recovery-test-utils';

export function registerTerminalArtifactReplayScenarios() {
  it('blocks terminal artifact replay when the stored intent digest identity mismatches', async () => {
    const fixture = await artifactFixture('terminal-digest-mismatch');
    const record: MergeApplyIntentRecord = {
      ...fixture.record,
      resultDigest: mutateDigest(RESULT_DIGEST),
      state: 'finalized',
      terminal: {
        status: 'applied',
        headBefore: OURS,
        headAfter: MERGE,
        commitId: MERGE,
      },
    };
    const readRef = jest.fn();
    const beginIntent = jest.fn();

    const result = await applyPersistedMergeResult(
      artifactContext({ fixture, record, readRef, beginIntent }),
      artifactInput(),
      { targetRef: TARGET_REF, expectedTargetHead: EXPECTED_TARGET_HEAD },
    );

    expect(result).toMatchObject({
      status: 'blocked',
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      mutationGuarantee: 'no-write-attempted',
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_MERGE_RESOLUTION_MISMATCH',
          safeMessage: 'persisted merge resultDigest does not match the resolved artifact.',
          redacted: true,
        }),
      ],
    });
    expectPublicSafeDiagnostics(result.diagnostics, [RESULT_DIGEST.digest, MERGE]);
    expect(readRef).not.toHaveBeenCalled();
    expect(beginIntent).not.toHaveBeenCalled();
  });

  it('returns staleTargetHead when terminal artifact replay no longer owns the target ref', async () => {
    const fixture = await artifactFixture('terminal-stale-replay');
    const record: MergeApplyIntentRecord = {
      ...fixture.record,
      state: 'finalized',
      terminal: {
        status: 'applied',
        headBefore: OURS,
        headAfter: MERGE,
        commitId: MERGE,
      },
    };
    const readRef = jest.fn(async () => refReadSuccess(ADVANCED));
    const mergeCommit = jest.fn();

    const result = await applyPersistedMergeResult(
      artifactContext({ fixture, record, readRef, mergeCommit }),
      artifactInput(),
      { targetRef: TARGET_REF, expectedTargetHead: EXPECTED_TARGET_HEAD },
    );

    expect(result).toMatchObject({
      status: 'staleTargetHead',
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
      headAfter: ADVANCED,
      diagnostics: [],
      mutationGuarantee: 'ref-not-mutated',
    });
    expect(result).not.toHaveProperty('commitRef');
    expect(readRef).toHaveBeenCalledWith(TARGET_REF);
    expect(mergeCommit).not.toHaveBeenCalled();
  });
}
