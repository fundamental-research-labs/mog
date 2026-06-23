import { expect, it, jest } from '@jest/globals';

import {
  BASE,
  DIGEST_A,
  DIGEST_B,
  DIGEST_C,
  EXPECTED_TARGET_HEAD,
  invalidCommitPayloadFailureMatcher,
  mergeInput,
  OURS,
  TARGET_REF,
  THEIRS,
  workbookVersionWithMergeService,
} from './version-merge-provider-test-utils';

export function describeMergeProviderMetadataScenarios(): void {
  it('passes through validated provider merge attempt metadata', async () => {
    const result = {
      status: 'clean',
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      changes: [],
      conflicts: [],
      diagnostics: [],
      mutationGuarantee: 'preview-only',
      previewArtifactDigest: DIGEST_B,
      resultDigest: DIGEST_A,
      resolutionSetDigest: DIGEST_C,
      resolvedAttemptDigest: DIGEST_A,
      attemptPersistence: 'persisted',
      attemptKind: 'applyable',
      resultId: `merge-result:${DIGEST_A.digest}`,
      targetRef: TARGET_REF,
      expectedTargetHead: EXPECTED_TARGET_HEAD,
      applicationPlanDigest: DIGEST_B,
      applyEligibilityDigest: DIGEST_C,
    } as const;
    const merge = jest.fn(async () => result);
    const version = workbookVersionWithMergeService(merge);

    await expect(version.merge(mergeInput())).resolves.toStrictEqual({
      ok: true,
      value: result,
    });
  });

  it('blocks provider merge attempts with malformed persistence metadata', async () => {
    const merge = jest.fn(async () => ({
      status: 'clean',
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      changes: [],
      conflicts: [],
      diagnostics: [],
      mutationGuarantee: 'preview-only',
      resultDigest: { algorithm: 'sha256', digest: 'not-a-digest' },
    }));
    const version = workbookVersionWithMergeService(merge);

    await expect(version.merge(mergeInput())).resolves.toMatchObject(
      invalidCommitPayloadFailureMatcher(),
    );
  });

  it('blocks provider merge attempts with malformed preview artifact metadata', async () => {
    const merge = jest.fn(async () => ({
      status: 'clean',
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      changes: [],
      conflicts: [],
      diagnostics: [],
      mutationGuarantee: 'preview-only',
      previewArtifactDigest: { algorithm: 'sha256', digest: 'not-a-digest' },
    }));
    const version = workbookVersionWithMergeService(merge);

    await expect(version.merge(mergeInput())).resolves.toMatchObject(
      invalidCommitPayloadFailureMatcher(),
    );
  });
}
