import { jest } from '@jest/globals';

import type { VersionMergeInput } from '@mog-sdk/contracts/api';

export const BASE = `commit:sha256:${'1'.repeat(64)}` as VersionMergeInput['base'];
export const OURS = `commit:sha256:${'2'.repeat(64)}` as VersionMergeInput['ours'];
export const THEIRS = `commit:sha256:${'3'.repeat(64)}` as VersionMergeInput['theirs'];
export const RESULT_DIGEST = { algorithm: 'sha256', digest: 'a'.repeat(64) } as const;
export const CONFLICT_DIGEST = { algorithm: 'sha256', digest: 'b'.repeat(64) } as const;
export const TARGET_REF = 'refs/heads/main';
export const EXPECTED_TARGET_HEAD = { commitId: OURS, revision: { kind: 'counter', value: '1' } };
export const HOST_POLICY_SECRET = 'host-principal-secret@example.test';
export const REVIEW_ENDPOINTS = [
  {
    method: 'saveMergeResolutions',
    capability: 'version:mergeApply',
    input: {
      resultId: 'merge-result:hidden',
      resultDigest: RESULT_DIGEST,
      redactionPolicyDigest: RESULT_DIGEST,
      resolutions: [],
    },
  },
  {
    method: 'getMergeConflictDetail',
    capability: 'version:mergePreview',
    input: {
      resultId: 'merge-result:hidden',
      resultDigest: RESULT_DIGEST,
      redactionPolicyDigest: RESULT_DIGEST,
      conflictId: 'conflict:hidden',
      expectedConflictDigest: CONFLICT_DIGEST,
      valueRole: 'base',
      purpose: 'review',
    },
  },
  {
    method: 'putMergeResolutionPayload',
    capability: 'version:mergeApply',
    input: {
      resultId: 'merge-result:hidden',
      resultDigest: RESULT_DIGEST,
      redactionPolicyDigest: RESULT_DIGEST,
      conflictId: 'conflict:hidden',
      expectedConflictDigest: CONFLICT_DIGEST,
      optionId: 'option:hidden',
      kind: 'acceptTheirs',
      targetRef: TARGET_REF,
      expectedTargetHead: EXPECTED_TARGET_HEAD,
      value: { secret: true },
      purpose: 'chooseValue',
    },
  },
] as const;

export function providerProbeContext(versioningExtra: Record<string, unknown> = {}) {
  const providerLookup = jest.fn();
  const providerTouch = jest.fn();
  const service = {
    saveMergeResolutions: providerTouch,
    getMergeConflictDetail: providerTouch,
    putMergeResolutionPayload: providerTouch,
    readMergeAttempt: providerTouch,
    writeMergeResolutionPayload: providerTouch,
    sealMergeResolutionPayload: providerTouch,
  };
  const versioning: Record<string, unknown> = { ...versioningExtra };

  for (const key of [
    'mergeResolutionService',
    'mergeReviewService',
    'mergePayloadService',
    'payloadService',
    'provider',
    'publicService',
  ]) {
    Object.defineProperty(versioning, key, { get: () => (providerLookup(key), service) });
  }
  for (const key of Object.keys(service)) {
    Object.defineProperty(versioning, key, { get: () => (providerLookup(key), providerTouch) });
  }

  return { ctx: { versioning }, providerLookup, providerTouch };
}
