import { jest } from '@jest/globals';

import type { WorkbookCommitId } from '@mog-sdk/contracts/api';

import { applyPersistedMergeResult } from '../version/apply-merge/version-apply-merge-persisted';
import { recoverStagedMergeCommitIfAlreadyApplied } from '../version/apply-merge/persisted-artifact/version-apply-merge-persisted-artifact-recovery';
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
  artifactFixture,
  blockedApplyMergeResult,
  intentStoreDiagnostics,
  mutateDigest,
  persistedIntentContext,
  persistedIntentInput,
  providerErrorDiagnostic,
  refReadSuccess,
  resolutionMismatchDiagnostic,
  staleArtifactResult,
} from './version-apply-merge-persisted-recovery-test-utils';

export function registerStagedFastForwardRecoveryScenarios() {
  it('returns staleTargetHead for staged fast-forward intents before writer calls', async () => {
    const fixture = await artifactFixture('fast-forward-stale-before-writer');
    const record: MergeApplyIntentRecord = { ...fixture.record, applyKind: 'fastForward' };
    const readRef = jest.fn(async () => refReadSuccess(ADVANCED));
    const fastForwardMerge = jest.fn();

    const result = await applyPersistedMergeResult(
      persistedIntentContext({ fixture, record, readRef, fastForwardMerge }),
      persistedIntentInput(fixture),
      { targetRef: TARGET_REF, expectedTargetHead: EXPECTED_TARGET_HEAD },
    );

    expect(result).toMatchObject({
      status: 'staleTargetHead',
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      resultId: `merge-result:${fixture.resolvedAttemptDigest.digest}`,
      resultDigest: RESULT_DIGEST,
      resolutionSetDigest: fixture.resolutionSetDigest,
      resolvedAttemptDigest: fixture.resolvedAttemptDigest,
      targetRef: TARGET_REF,
      headBefore: OURS,
      headAfter: ADVANCED,
      diagnostics: [],
      mutationGuarantee: 'ref-not-mutated',
    });
    expect(fastForwardMerge).not.toHaveBeenCalled();
  });
}

export function registerStagedArtifactRecoveryScenarios() {
  it('does not recover a staged artifact intent from a non-matching merge commit', async () => {
    const fixture = await artifactFixture('non-matching-merge-commit');
    const completeIntent = jest.fn();
    const readRefCasProof = jest.fn();
    const staleTargetHeadArtifactResult = jest.fn(
      (_input, record: MergeApplyIntentRecord, currentHead: WorkbookCommitId) =>
        staleArtifactResult(record, currentHead),
    );

    const result = await recoverStagedMergeCommitIfAlreadyApplied({
      graph: {
        readCommit: jest.fn(async () => ({
          status: 'success',
          commit: {
            payload: {
              parentCommitIds: [OURS, THEIRS],
              resolvedMergeAttemptDigest: mutateDigest(fixture.resolvedAttemptDigest),
            },
          },
          diagnostics: [],
        })),
      } as any,
      store: {
        namespace: fixture.namespace,
        beginIntent: jest.fn(),
        readByIntentId: jest.fn(),
        readByIdempotencyKey: jest.fn(),
        readRefCasProof,
        completeIntent,
      },
      input: {
        resultId: fixture.resultId,
        resultDigest: RESULT_DIGEST,
        previewArtifactDigest: RESULT_DIGEST,
        resolutionSetDigest: fixture.resolutionSetDigest,
        resolvedAttemptDigest: fixture.resolvedAttemptDigest,
        resolutions: [],
      },
      record: fixture.record,
      readCurrentTargetHead: jest.fn(async () => ({ ok: true, commitId: MERGE })),
      resultFromTerminalArtifactIntent: jest.fn(),
      staleTargetHeadArtifactResult,
      blockedApplyMergeResult,
      mapProviderDiagnostics: jest.fn(),
      providerErrorDiagnostic,
      intentStoreDiagnostics,
      resolutionMismatchDiagnostic,
    });

    expect(result).toMatchObject({
      status: 'staleTargetHead',
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      headAfter: MERGE,
      diagnostics: [],
      mutationGuarantee: 'ref-not-mutated',
    });
    expect(staleTargetHeadArtifactResult).toHaveBeenCalledTimes(1);
    expect(readRefCasProof).not.toHaveBeenCalled();
    expect(completeIntent).not.toHaveBeenCalled();
  });
}
