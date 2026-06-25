import type {
  VersionCommitExpectedHead,
  VersionMainRefName,
  VersionMergeResultId,
  VersionRefName,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import type { ObjectDigest, WorkbookCommitId as StoreWorkbookCommitId } from './object-digest';
import { objectDigestFromWorkbookCommitId } from './object-digest';
import { canonicalJsonStringify } from './merge-apply-intent-store-json';
import type {
  MergeApplyIntentId,
  MergeApplyIntentIdempotencyKey,
  MergeApplyRefCasProof,
  MergeApplyRefCasProofLookup,
} from './merge-apply-intent-store-types';

export async function computeMergeApplyResultDigest(input: {
  readonly status: 'clean' | 'conflicted' | 'fastForward' | 'alreadyMerged';
  readonly base: WorkbookCommitId;
  readonly ours: WorkbookCommitId;
  readonly theirs: WorkbookCommitId;
  readonly targetRef?: VersionMainRefName | VersionRefName;
  readonly expectedTargetHead?: VersionCommitExpectedHead;
}): Promise<ObjectDigest> {
  return objectDigestFor('mog.version.merge.result.v1', input);
}

export async function computeEmptyResolutionSetDigest(): Promise<ObjectDigest> {
  return objectDigestFor('mog.version.merge.empty-resolution-set.v1', {
    schemaVersion: 1,
    resolutions: [],
  });
}

export async function computeResolvedAttemptDigest(input: {
  readonly resultDigest: ObjectDigest;
  readonly resolutionSetDigest: ObjectDigest;
  readonly targetRef: VersionMainRefName | VersionRefName;
  readonly expectedTargetHead: VersionCommitExpectedHead;
}): Promise<ObjectDigest> {
  return objectDigestFor('mog.version.merge.resolved-attempt.v1', input);
}

export function intentIdForResolvedAttemptDigest(digest: ObjectDigest): MergeApplyIntentId {
  return `merge-apply-intent:sha256:${digest.digest}`;
}

export function mergeResultIdForResolvedAttemptDigest(digest: ObjectDigest): VersionMergeResultId {
  return `merge-result:${digest.digest}` as VersionMergeResultId;
}

export function intentIdForMergeResultId(
  resultId: VersionMergeResultId,
): MergeApplyIntentId | null {
  const digest = resultId.slice('merge-result:'.length);
  return /^[0-9a-f]{64}$/.test(digest) ? `merge-apply-intent:sha256:${digest}` : null;
}

export function idempotencyKeyForResolvedAttempt(input: {
  readonly resolvedAttemptDigest: ObjectDigest;
  readonly targetRef: VersionMainRefName | VersionRefName;
  readonly expectedTargetHead: VersionCommitExpectedHead;
}): MergeApplyIntentIdempotencyKey {
  return `merge-apply:${canonicalJsonStringify(input)}` as MergeApplyIntentIdempotencyKey;
}

export async function computeMergeApplyRefCasProof(
  input: MergeApplyRefCasProofLookup,
): Promise<MergeApplyRefCasProof> {
  const commitMetadataDigest = objectDigestFromWorkbookCommitId(
    input.headAfter as StoreWorkbookCommitId,
  );
  const refUpdateMetadataDigest = await objectDigestFor(
    'mog.version.merge.ref-update-metadata.v1',
    {
      schemaVersion: 1,
      applyKind: input.applyKind,
      targetRef: input.targetRef,
      headBefore: input.headBefore,
      headAfter: input.headAfter,
    },
  );
  const refLogEventDigest = await objectDigestFor('mog.version.merge.ref-log-event.v1', {
    schemaVersion: 1,
    applyKind: input.applyKind,
    commitMetadataDigest,
    refUpdateMetadataDigest,
  });
  return {
    schemaVersion: 1,
    applyKind: input.applyKind,
    commitMetadataDigest,
    refUpdateMetadataDigest,
    refLogEventDigest,
  };
}

export async function objectDigestFor(domain: string, value: unknown): Promise<ObjectDigest> {
  const input = new TextEncoder().encode(`${domain}\n${canonicalJsonStringify(value)}`);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', input);
  return { algorithm: 'sha256', digest: bytesToHex(new Uint8Array(digest)) };
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
