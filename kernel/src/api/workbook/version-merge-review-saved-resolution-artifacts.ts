import type { ObjectDigest as PublicObjectDigest } from '@mog-sdk/contracts/api';

import {
  MERGE_RESOLUTION_SET_OBJECT_TYPE,
  RESOLVED_MERGE_ATTEMPT_OBJECT_TYPE,
  mergeResolutionSetArtifactRef,
  resolvedMergeAttemptArtifactRef,
} from '../../document/version-store/merge-attempt-artifacts';
import type { VersionGraphStore } from '../../document/version-store/provider-graph-store';
import {
  persistedReviewArtifactReadDiagnostics,
  toInternalSha256Digest,
} from './version-merge-review-artifacts';
import type { VersionMergePublicOperation } from './version-merge-capability';
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

  try {
    const record = await graph.getObjectRecord<unknown>(
      mergeResolutionSetArtifactRef(internalDigest),
    );
    const payload = toMergeResolutionSetArtifactPayload(operation, record.preimage.payload);
    if (record.preimage.objectType !== MERGE_RESOLUTION_SET_OBJECT_TYPE || !payload) {
      return {
        ok: false,
        diagnostics: [
          invalidReviewArtifactDiagnostic(
            operation,
            'Persisted merge resolution set artifact payload is invalid or unsupported.',
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
        'Persisted merge resolution set artifact could not be found.',
      ),
    };
  }
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
