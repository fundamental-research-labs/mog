import type {
  ObjectDigest as PublicObjectDigest,
  VersionCommitExpectedHead,
  VersionMainRefName,
  VersionRefName,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import {
  MERGE_RESOLUTION_SET_OBJECT_TYPE,
  MERGE_RESOLUTION_SET_V2_OBJECT_TYPE,
  RESOLVED_MERGE_ATTEMPT_OBJECT_TYPE,
  mergePreviewArtifactRef,
  mergeResolutionSetArtifactRef,
  mergeResolutionSetV2ArtifactRef,
  resolvedMergeAttemptArtifactRef,
  type MergeResolutionSetArtifactPayload,
  type ResolvedMergeAttemptArtifactRecord,
} from '../../../../document/version-store/merge-attempt-artifacts';
import type { VersionGraphStore } from '../../../../document/version-store/provider-graph-store';
import type { ObjectDigest as InternalObjectDigest } from '../../../../document/version-store/object-digest';
import {
  VersionObjectStoreError,
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../../../../document/version-store/object-store';
import {
  persistedReviewArtifactReadDiagnostics,
  toInternalSha256Digest,
} from './version-merge-review-artifacts';
import type { VersionMergePublicOperation } from '../merge/version-merge-capability';
import {
  invalidArtifactDigestDiagnostic,
  invalidReviewArtifactDiagnostic,
} from './version-merge-review-saved-resolution-diagnostics';
import {
  toMergeResolutionSetArtifactPayload,
  toResolvedMergeAttemptArtifactPayload,
} from './version-merge-review-saved-resolution-payloads';
import type {
  MergeReviewResolutionSetReadResult,
  MergeReviewResolvedAttemptReadResult,
} from './version-merge-review-saved-resolution-types';
import { isRecord } from './version-merge-review-saved-resolution-utils';

export async function readResolutionSetArtifact(
  graph: VersionGraphStore,
  operation: VersionMergePublicOperation,
  digest: PublicObjectDigest,
): Promise<MergeReviewResolutionSetReadResult> {
  const internalDigest = toInternalSha256Digest(digest);
  if (!internalDigest) {
    return {
      ok: false,
      diagnostics: [invalidArtifactDigestDiagnostic(operation, 'resolutionSetDigest')],
    };
  }

  const v2Read = await readResolutionSetArtifactVersion(
    graph,
    operation,
    mergeResolutionSetV2ArtifactRef(internalDigest),
    MERGE_RESOLUTION_SET_V2_OBJECT_TYPE,
  );
  if (v2Read.ok) return v2Read;
  if (!v2Read.tryAlternate) return { ok: false, diagnostics: v2Read.diagnostics };

  const v1Read = await readResolutionSetArtifactVersion(
    graph,
    operation,
    mergeResolutionSetArtifactRef(internalDigest),
    MERGE_RESOLUTION_SET_OBJECT_TYPE,
  );
  return v1Read.ok ? v1Read : { ok: false, diagnostics: v1Read.diagnostics };
}

export async function createResolvedMergeAttemptArtifactRecordForResolutionSet(
  namespace: VersionGraphNamespace,
  input: {
    readonly resultDigest: InternalObjectDigest;
    readonly resolutionSetRecord: VersionObjectRecord<MergeResolutionSetArtifactPayload>;
    readonly targetRef: VersionMainRefName | VersionRefName;
    readonly expectedTargetHead: VersionCommitExpectedHead;
  },
): Promise<ResolvedMergeAttemptArtifactRecord> {
  const resolutionSetDependency =
    input.resolutionSetRecord.preimage.objectType === MERGE_RESOLUTION_SET_V2_OBJECT_TYPE
      ? mergeResolutionSetV2ArtifactRef(input.resolutionSetRecord.digest)
      : mergeResolutionSetArtifactRef(input.resolutionSetRecord.digest);

  return createVersionObjectRecord(namespace, {
    objectType: RESOLVED_MERGE_ATTEMPT_OBJECT_TYPE,
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [mergePreviewArtifactRef(input.resultDigest), resolutionSetDependency],
    payload: {
      schemaVersion: 1,
      recordKind: 'resolvedMergeAttempt',
      resultDigest: input.resultDigest,
      resolutionSetDigest: input.resolutionSetRecord.digest,
      targetRef: input.targetRef,
      expectedTargetHead: input.expectedTargetHead,
    },
  }) as Promise<ResolvedMergeAttemptArtifactRecord>;
}

export async function readResolvedMergeAttemptArtifact(
  graph: VersionGraphStore,
  operation: VersionMergePublicOperation,
  digest: PublicObjectDigest,
): Promise<MergeReviewResolvedAttemptReadResult> {
  const internalDigest = toInternalSha256Digest(digest);
  if (!internalDigest) {
    return {
      ok: false,
      diagnostics: [invalidArtifactDigestDiagnostic(operation, 'resolvedAttemptDigest')],
    };
  }

  try {
    const record = await graph.getObjectRecord<unknown>(
      resolvedMergeAttemptArtifactRef(internalDigest),
    );
    const payload = toResolvedMergeAttemptArtifactPayload(record.preimage.payload);
    if (record.preimage.objectType !== RESOLVED_MERGE_ATTEMPT_OBJECT_TYPE || !payload) {
      return {
        ok: false,
        diagnostics: [
          invalidReviewArtifactDiagnostic(
            operation,
            'Persisted resolved merge attempt artifact payload is invalid or unsupported.',
          ),
        ],
      };
    }
    return { ok: true, payload };
  } catch (error) {
    return {
      ok: false,
      diagnostics: persistedReviewArtifactReadDiagnostics(
        operation,
        error,
        'Persisted resolved merge attempt artifact could not be found.',
      ),
    };
  }
}

type ResolutionSetReadAttempt =
  | {
      readonly ok: true;
      readonly payload: MergeResolutionSetArtifactPayload;
      readonly record: VersionObjectRecord<MergeResolutionSetArtifactPayload>;
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly VersionStoreDiagnostic[];
      readonly tryAlternate: boolean;
    };

async function readResolutionSetArtifactVersion(
  graph: VersionGraphStore,
  operation: VersionMergePublicOperation,
  ref: ReturnType<typeof mergeResolutionSetArtifactRef>,
  expectedObjectType:
    | typeof MERGE_RESOLUTION_SET_OBJECT_TYPE
    | typeof MERGE_RESOLUTION_SET_V2_OBJECT_TYPE,
): Promise<ResolutionSetReadAttempt> {
  try {
    const record = await graph.getObjectRecord<unknown>(ref);
    const payload = toMergeResolutionSetArtifactPayload(operation, record.preimage.payload);
    if (
      record.preimage.objectType !== expectedObjectType ||
      !payload ||
      !resolutionSetPayloadMatchesObjectType(payload, expectedObjectType)
    ) {
      return {
        ok: false,
        tryAlternate: false,
        diagnostics: [
          invalidReviewArtifactDiagnostic(
            operation,
            'Persisted merge resolution set artifact payload is invalid or unsupported.',
          ),
        ],
      };
    }
    return {
      ok: true,
      payload,
      record: record as VersionObjectRecord<MergeResolutionSetArtifactPayload>,
    };
  } catch (error) {
    return {
      ok: false,
      tryAlternate: isAlternateResolutionSetArtifactMiss(error),
      diagnostics: persistedReviewArtifactReadDiagnostics(
        operation,
        error,
        'Persisted merge resolution set artifact could not be found.',
      ),
    };
  }
}

function isAlternateResolutionSetArtifactMiss(error: unknown): boolean {
  const code = versionObjectReadCode(error);
  return code === 'VERSION_OBJECT_NOT_FOUND' || code === 'VERSION_OBJECT_TYPE_MISMATCH';
}

function versionObjectReadCode(error: unknown): string | null {
  if (error instanceof VersionObjectStoreError) return error.diagnostic.code;
  if (isRecord(error) && isRecord(error.diagnostic)) {
    return typeof error.diagnostic.code === 'string' ? error.diagnostic.code : null;
  }
  if (isRecord(error) && Array.isArray(error.diagnostics)) {
    const first = error.diagnostics[0];
    return isRecord(first) && typeof first.code === 'string' ? first.code : null;
  }
  return null;
}

function resolutionSetPayloadMatchesObjectType(
  payload: MergeResolutionSetArtifactPayload,
  objectType: typeof MERGE_RESOLUTION_SET_OBJECT_TYPE | typeof MERGE_RESOLUTION_SET_V2_OBJECT_TYPE,
): boolean {
  return objectType === MERGE_RESOLUTION_SET_V2_OBJECT_TYPE
    ? payload.schemaVersion === 2
    : payload.schemaVersion === 1;
}
