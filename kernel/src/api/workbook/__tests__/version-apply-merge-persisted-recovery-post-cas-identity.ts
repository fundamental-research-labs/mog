import { jest } from '@jest/globals';

import type { VersionMergeResultId } from '@mog-sdk/contracts/api';

import { recoverPersistedMergeApplyPostCas } from '../version/apply-merge/version-apply-merge-recovery';
import {
  RESULT_DIGEST,
  artifactFixture,
  expectPublicSafeDiagnostics,
  mutateDigest,
} from './version-apply-merge-persisted-recovery-test-utils';

export function registerPostCasRecoveryIdentityScenario(): void {
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
}
