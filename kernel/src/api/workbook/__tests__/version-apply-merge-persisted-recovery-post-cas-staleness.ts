import { jest } from '@jest/globals';

import { recoverPersistedMergeApplyPostCas } from '../version/apply-merge/version-apply-merge-recovery';
import {
  ADVANCED,
  BASE,
  OURS,
  RESULT_DIGEST,
  THEIRS,
  artifactFixture,
  expectPublicSafeDiagnostics,
  mutateDigest,
  recoveryContext,
  refReadSuccess,
} from './version-apply-merge-persisted-recovery-test-utils';

export function registerPostCasRecoveryStalenessScenarios(): void {
  it('blocks post-CAS recovery when the recovered target head is stale', async () => {
    const fixture = await artifactFixture('post-cas-stale-target');
    const readRefCasProof = jest.fn();
    const completeIntent = jest.fn();

    const result = await recoverPersistedMergeApplyPostCas(
      recoveryContext({
        fixture,
        record: { ...fixture.record, applyKind: 'fastForward' },
        readRef: jest.fn(async () => refReadSuccess(ADVANCED)),
        readRefCasProof,
        completeIntent,
      }),
      { resolvedAttemptDigest: fixture.resolvedAttemptDigest, resultDigest: RESULT_DIGEST },
    );

    expect(result).toMatchObject({
      status: 'blocked',
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      mutationGuarantee: 'ref-not-mutated',
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_REF_CONFLICT',
          recoverability: 'retry',
          payload: expect.objectContaining({
            operation: 'applyMergeRecovery',
            reason: 'staleTargetHead',
          }),
          redacted: true,
        }),
      ],
    });
    expect(readRefCasProof).not.toHaveBeenCalled();
    expect(completeIntent).not.toHaveBeenCalled();
    expectPublicSafeDiagnostics(result.diagnostics, [
      ADVANCED,
      THEIRS,
      RESULT_DIGEST.digest,
      fixture.resolvedAttemptDigest.digest,
    ]);
  });

  it('blocks post-CAS recovery when the supplied resultDigest is stale', async () => {
    const fixture = await artifactFixture('post-cas-stale-result-digest');
    const readRef = jest.fn();
    const readRefCasProof = jest.fn();
    const completeIntent = jest.fn();
    const staleResultDigest = mutateDigest(RESULT_DIGEST);

    const result = await recoverPersistedMergeApplyPostCas(
      recoveryContext({
        fixture,
        record: fixture.record,
        readRef,
        readRefCasProof,
        completeIntent,
      }),
      { resolvedAttemptDigest: fixture.resolvedAttemptDigest, resultDigest: staleResultDigest },
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
          safeMessage: 'recovery resultDigest does not match.',
          redacted: true,
        }),
      ],
    });
    expect(readRef).not.toHaveBeenCalled();
    expect(readRefCasProof).not.toHaveBeenCalled();
    expect(completeIntent).not.toHaveBeenCalled();
    expectPublicSafeDiagnostics(result.diagnostics, [
      RESULT_DIGEST.digest,
      staleResultDigest.digest,
    ]);
  });
}
