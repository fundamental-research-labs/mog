import { jest } from '@jest/globals';

import { applyPersistedMergeResult } from '../version/apply-merge/version-apply-merge-persisted';
import type { MergeApplyIntentRecord } from '../../../document/version-store/merge-apply-intent-store';
import {
  BASE,
  EXPECTED_TARGET_HEAD,
  MERGE,
  OURS,
  TARGET_REF,
  THEIRS,
  artifactContext,
  artifactFixture,
  artifactInput,
  commitId,
  digest,
  expectPublicSafeDiagnostics,
} from './version-apply-merge-persisted-recovery-test-utils';

export function registerArtifactRecoveryDiagnosticScenarios() {
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
}
