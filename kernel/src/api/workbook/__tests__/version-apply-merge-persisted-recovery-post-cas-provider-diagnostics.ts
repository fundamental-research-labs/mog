import { jest } from '@jest/globals';

import { recoverPersistedMergeApplyPostCas } from '../version/apply-merge/version-apply-merge-recovery';
import {
  BASE,
  OURS,
  RESULT_DIGEST,
  THEIRS,
  artifactFixture,
  commitId,
  digest,
  expectPublicSafeDiagnostics,
  recoveryContext,
} from './version-apply-merge-persisted-recovery-test-utils';

export function registerPostCasRecoveryProviderDiagnosticsScenario(): void {
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
}
