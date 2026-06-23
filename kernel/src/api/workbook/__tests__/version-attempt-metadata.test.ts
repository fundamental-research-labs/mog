import {
  mapVersionApplyMergeAttemptMetadata,
  mapVersionMergeAttemptMetadata,
} from '../version-attempt-metadata';

const COMMIT_A = `commit:sha256:${'1'.repeat(64)}`;
const COMMIT_B = `commit:sha256:${'2'.repeat(64)}`;
const DIGEST_A = digest('a');
const DIGEST_B = digest('b');
const DIGEST_C = digest('c');
const RESULT_ID_A = `merge-result:${DIGEST_A.digest}`;
const RESULT_ID_C = `merge-result:${DIGEST_C.digest}`;
const EXPECTED_TARGET_HEAD = {
  commitId: COMMIT_A,
  revision: { kind: 'counter' as const, value: '1' },
  symbolicHeadRevision: { kind: 'opaque' as const, value: 'main@1' },
};

describe('version attempt metadata normalization', () => {
  it('normalizes merge metadata deterministically and redacts unsafe provider payloads', () => {
    const source = {
      status: 'clean',
      base: COMMIT_A,
      ours: COMMIT_A,
      theirs: COMMIT_B,
      changes: [],
      conflicts: [],
      diagnostics: [],
      mutationGuarantee: 'preview-only',
      source: { providerPath: '/private/provider/cache' },
      sourcePayload: { accessToken: 'secret-token' },
      operation: { actorSessionId: 'session-secret' },
      operationPayload: { rawMutation: { value: 'private-cell-value' } },
      applyEligibilityDigest: DIGEST_C,
      applicationPlanDigest: DIGEST_B,
      expectedTargetHead: EXPECTED_TARGET_HEAD,
      targetRef: 'main',
      expiresAt: '2026-06-23T12:00:00.000Z',
      resultId: RESULT_ID_C,
      attemptKind: 'applyable',
      attemptPersistence: 'persisted',
      resolvedAttemptDigest: DIGEST_C,
      resolutionSetDigest: DIGEST_B,
      resultDigest: DIGEST_A,
      previewArtifactDigest: DIGEST_A,
    };

    const metadata = mapVersionMergeAttemptMetadata(source);

    expect(metadata).toEqual({
      previewArtifactDigest: DIGEST_A,
      resultDigest: DIGEST_A,
      resolutionSetDigest: DIGEST_B,
      resolvedAttemptDigest: DIGEST_C,
      attemptPersistence: 'persisted',
      attemptKind: 'applyable',
      resultId: RESULT_ID_C,
      expiresAt: '2026-06-23T12:00:00.000Z',
      targetRef: 'refs/heads/main',
      expectedTargetHead: EXPECTED_TARGET_HEAD,
      applicationPlanDigest: DIGEST_B,
      applyEligibilityDigest: DIGEST_C,
    });
    expect(Object.keys(metadata ?? {})).toEqual([
      'previewArtifactDigest',
      'resultDigest',
      'resolutionSetDigest',
      'resolvedAttemptDigest',
      'attemptPersistence',
      'attemptKind',
      'resultId',
      'expiresAt',
      'targetRef',
      'expectedTargetHead',
      'applicationPlanDigest',
      'applyEligibilityDigest',
    ]);
    expect(metadata?.previewArtifactDigest).not.toBe(source.previewArtifactDigest);
    expect(metadata).not.toHaveProperty('source');
    expect(metadata).not.toHaveProperty('operation');
    expect(metadata).not.toHaveProperty('sourcePayload');
    expect(metadata).not.toHaveProperty('operationPayload');
  });

  it('rejects merge metadata with noncanonical or stale fields', () => {
    expect(
      mapVersionMergeAttemptMetadata({
        resultId: 'merge-result:review-main',
        resultDigest: DIGEST_A,
      }),
    ).toBeNull();
    expect(
      mapVersionMergeAttemptMetadata({
        resultId: RESULT_ID_A,
        previewArtifactDigest: DIGEST_A,
        resultDigest: DIGEST_A,
        redactionPolicyDigest: DIGEST_B,
      }),
    ).toBeNull();
    expect(
      mapVersionMergeAttemptMetadata({
        resultId: RESULT_ID_A,
        previewArtifactDigest: DIGEST_A,
        resultDigest: DIGEST_A,
        mergePreviewArtifact: { digest: DIGEST_A },
      }),
    ).toBeNull();
  });

  it('rejects result ids that do not close over canonical digest metadata', () => {
    expect(
      mapVersionMergeAttemptMetadata({
        resultId: RESULT_ID_A,
        resultDigest: DIGEST_A,
        resolvedAttemptDigest: DIGEST_C,
      }),
    ).toBeNull();
    expect(
      mapVersionMergeAttemptMetadata({
        resultId: RESULT_ID_C,
        previewArtifactDigest: DIGEST_A,
        resultDigest: DIGEST_A,
      }),
    ).toBeNull();
  });

  it('normalizes apply metadata with the same redaction and closure guarantees', () => {
    const metadata = mapVersionApplyMergeAttemptMetadata({
      status: 'fastForwarded',
      commitRef: { id: COMMIT_B },
      diagnostics: [],
      mutationGuarantee: 'ref-fast-forwarded',
      resultId: RESULT_ID_C,
      previewArtifactDigest: DIGEST_A,
      resultDigest: DIGEST_B,
      resolutionSetDigest: DIGEST_B,
      resolvedAttemptDigest: DIGEST_C,
      targetRef: 'refs/heads/main',
      headBefore: COMMIT_A,
      headAfter: COMMIT_B,
      applicationPlanDigest: DIGEST_A,
      sourcePayload: { providerPath: '/private/apply/source' },
      operationPayload: { rawMutation: { value: 'private-apply-value' } },
    });

    expect(metadata).toEqual({
      resultId: RESULT_ID_C,
      previewArtifactDigest: DIGEST_A,
      resultDigest: DIGEST_B,
      resolutionSetDigest: DIGEST_B,
      resolvedAttemptDigest: DIGEST_C,
      targetRef: 'refs/heads/main',
      headBefore: COMMIT_A,
      headAfter: COMMIT_B,
      applicationPlanDigest: DIGEST_A,
    });
    expect(metadata).not.toHaveProperty('sourcePayload');
    expect(metadata).not.toHaveProperty('operationPayload');

    expect(
      mapVersionApplyMergeAttemptMetadata({
        resultId: RESULT_ID_A,
        resolvedAttemptDigest: DIGEST_C,
      }),
    ).toBeNull();
    expect(
      mapVersionApplyMergeAttemptMetadata({
        resultId: RESULT_ID_A,
        resultDigest: DIGEST_A,
        applyPlanDigest: DIGEST_B,
      }),
    ).toBeNull();
  });
});

function digest(seed: string) {
  return { algorithm: 'sha256' as const, digest: seed.repeat(64) };
}
