const COMMIT_A = `commit:sha256:${'1'.repeat(64)}`;
const COMMIT_B = `commit:sha256:${'2'.repeat(64)}`;
const DIGEST_A = digest('a');
const DIGEST_B = digest('b');
const DIGEST_C = digest('c');

export { COMMIT_A, COMMIT_B, DIGEST_A, DIGEST_B, DIGEST_C };

export const RESULT_ID_A = `merge-result:${DIGEST_A.digest}`;
export const RESULT_ID_C = `merge-result:${DIGEST_C.digest}`;
export const EXPECTED_TARGET_HEAD = {
  commitId: COMMIT_A,
  revision: { kind: 'counter' as const, value: '1' },
  symbolicHeadRevision: { kind: 'opaque' as const, value: 'main@1' },
};
export const EXPECTED_MERGE_METADATA_KEYS = [
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
];

export function createMergeMetadataSource() {
  return {
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
}

export function createApplyMetadataSource() {
  return {
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
  };
}

function digest(seed: string) {
  return { algorithm: 'sha256' as const, digest: seed.repeat(64) };
}
