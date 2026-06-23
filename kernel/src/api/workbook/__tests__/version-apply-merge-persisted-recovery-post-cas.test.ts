import { jest } from '@jest/globals';

import type { VersionMergeResultId } from '@mog-sdk/contracts/api';

import { recoverPersistedMergeApplyPostCas } from '../version-apply-merge-recovery';
import {
  ADVANCED,
  BASE,
  OURS,
  RESULT_DIGEST,
  THEIRS,
  artifactFixture,
  commitId,
  digest,
  expectPublicSafeDiagnostics,
  mutateDigest,
  recoveryContext,
  refReadSuccess,
} from './version-apply-merge-persisted-recovery-test-utils';

describe('persisted applyMerge post-CAS recovery hardening', () => {
  it('keeps post-CAS recovery provider diagnostics public-safe', async () => {
    const fixture = await artifactFixture('public-safe-recovery-diagnostics');
    const rawCommit = commitId('9');
    const rawDigest = digest('8').digest;
    const result = await recoverPersistedMergeApplyPostCas(
      recoveryContext({
        fixture,
        record: fixture.record,
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
      { resolvedAttemptDigest: fixture.resolvedAttemptDigest, resultDigest: RESULT_DIGEST },
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
          safeMessage:
            'Version applyMerge recovery provider denied access to required version data.',
          redacted: true,
        }),
      ],
    });
    expectPublicSafeDiagnostics(result.diagnostics, [rawCommit, rawDigest, `sha256:${rawDigest}`]);
  });

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

  it('blocks post-CAS recovery when recovery identifiers name different operations', async () => {
    const fixture = await artifactFixture('post-cas-identity-mismatch');
    const readGraphRegistry = jest.fn();
    const openGraph = jest.fn();
    const openMergeApplyIntentStore = jest.fn();
    const wrongResultId =
      `merge-result:${mutateDigest(fixture.resolvedAttemptDigest).digest}` as VersionMergeResultId;

    const result = await recoverPersistedMergeApplyPostCas(
      {
        versioning: {
          provider: {
            accessContext: {},
            readGraphRegistry,
            openGraph,
            openMergeApplyIntentStore,
          },
        },
      } as Parameters<typeof recoverPersistedMergeApplyPostCas>[0],
      {
        resultId: wrongResultId,
        resolvedAttemptDigest: fixture.resolvedAttemptDigest,
        resultDigest: RESULT_DIGEST,
      },
    );

    expect(result).toMatchObject({
      status: 'blocked',
      base: null,
      ours: null,
      theirs: null,
      mutationGuarantee: 'no-write-attempted',
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_MERGE_RESOLUTION_MISMATCH',
          safeMessage: 'recovery resultId does not match resolvedAttemptDigest.',
          redacted: true,
        }),
      ],
    });
    expect(readGraphRegistry).not.toHaveBeenCalled();
    expect(openGraph).not.toHaveBeenCalled();
    expect(openMergeApplyIntentStore).not.toHaveBeenCalled();
    expectPublicSafeDiagnostics(result.diagnostics, [
      fixture.resolvedAttemptDigest.digest,
      wrongResultId,
      RESULT_DIGEST.digest,
    ]);
  });
});
