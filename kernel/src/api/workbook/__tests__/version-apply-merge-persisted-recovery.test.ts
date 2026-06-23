import { jest } from '@jest/globals';

import type { WorkbookCommitId } from '@mog-sdk/contracts/api';

import { applyPersistedMergeResult } from '../version-apply-merge-persisted';
import { recoverStagedMergeCommitIfAlreadyApplied } from '../version-apply-merge-persisted-artifact-recovery';
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
  blockedApplyMergeResult,
  commitId,
  digest,
  expectPublicSafeDiagnostics,
  intentStoreDiagnostics,
  mutateDigest,
  persistedIntentContext,
  persistedIntentInput,
  providerErrorDiagnostic,
  refReadSuccess,
  resolutionMismatchDiagnostic,
  staleArtifactResult,
} from './version-apply-merge-persisted-recovery-test-utils';

describe('persisted applyMerge artifact recovery hardening', () => {
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

  it('keeps terminal artifact read diagnostics public-safe', async () => {
    const fixture = await artifactFixture('public-safe-artifact-diagnostics');
    const rawCommit = commitId('a');
    const rawDigest = digest('b').digest;
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

    const result = await applyPersistedMergeResult(
      artifactContext({
        fixture,
        record,
        readRef: jest.fn(async () => ({
          status: 'degraded',
          ref: null,
          diagnostics: [
            {
              issueCode: 'VERSION_PERMISSION_DENIED',
              safeMessage: `Denied ${rawCommit} sha256:${rawDigest}`,
              message: `Denied ${rawCommit} sha256:${rawDigest}`,
              recoverability: 'retry',
            },
          ],
        })),
      }),
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
          issueCode: 'VERSION_PERMISSION_DENIED',
          safeMessage: 'Version applyMerge provider denied access to required version data.',
          redacted: true,
        }),
      ],
    });
    expectPublicSafeDiagnostics(result.diagnostics, [rawCommit, rawDigest, `sha256:${rawDigest}`]);
  });
});
