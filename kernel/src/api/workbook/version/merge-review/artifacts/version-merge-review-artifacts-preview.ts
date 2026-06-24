import type { ObjectDigest, VersionStoreDiagnostic } from '@mog-sdk/contracts/api';

import {
  MERGE_PREVIEW_OBJECT_TYPE,
  mergePreviewArtifactRef,
  mergeResultIdForPreviewDigest,
  type MergePreviewArtifactPayload,
} from '../../../../../document/version-store/merge-attempt-artifacts';
import type { VersionGraphStore } from '../../../../../document/version-store/provider-graph-store';
import type { VersionMergePublicOperation } from '../../merge/version-merge-capability';
import {
  invalidPreviewArtifactDiagnostic,
  mergeReviewDiagnostic,
  persistedReviewArtifactReadDiagnostics,
} from './version-merge-review-artifacts-diagnostics';
import { toInternalSha256Digest } from './version-merge-review-artifacts-digests';
import { isRecord } from './version-merge-review-artifacts-guards';

export type MergeReviewPreviewReadResult =
  | { readonly ok: true; readonly payload: MergePreviewArtifactPayload }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] };

export async function readMergePreviewArtifact(
  graph: VersionGraphStore,
  operation: VersionMergePublicOperation,
  digest: ObjectDigest,
): Promise<MergeReviewPreviewReadResult> {
  const internalDigest = toInternalSha256Digest(digest);
  if (!internalDigest) {
    return {
      ok: false,
      diagnostics: [
        mergeReviewDiagnostic(
          operation,
          'VERSION_INVALID_OPTIONS',
          'resultDigest must be a sha256 merge preview digest.',
          { payload: { option: 'resultDigest' } },
        ),
      ],
    };
  }

  try {
    const record = await graph.getObjectRecord<unknown>(mergePreviewArtifactRef(internalDigest));
    if (record.preimage.objectType !== MERGE_PREVIEW_OBJECT_TYPE) {
      return { ok: false, diagnostics: [invalidPreviewArtifactDiagnostic(operation)] };
    }
    const payload = toMergePreviewArtifactPayload(record.preimage.payload);
    if (!payload) {
      return { ok: false, diagnostics: [invalidPreviewArtifactDiagnostic(operation)] };
    }
    return { ok: true, payload };
  } catch (error) {
    return {
      ok: false,
      diagnostics: persistedReviewArtifactReadDiagnostics(
        operation,
        error,
        'Persisted merge preview artifact could not be found.',
      ),
    };
  }
}

export function validateMergePreviewIdentity(
  operation: VersionMergePublicOperation,
  resultId: string,
  resultDigest: ObjectDigest,
): readonly VersionStoreDiagnostic[] {
  const internalDigest = toInternalSha256Digest(resultDigest);
  if (!internalDigest) {
    return [
      mergeReviewDiagnostic(
        operation,
        'VERSION_INVALID_OPTIONS',
        'resultDigest must be a sha256 merge preview digest.',
        { payload: { option: 'resultDigest' } },
      ),
    ];
  }
  if (resultId !== mergeResultIdForPreviewDigest(internalDigest)) {
    return [
      mergeReviewDiagnostic(
        operation,
        'VERSION_MERGE_RESOLUTION_MISMATCH',
        'resultId does not match the merge preview digest.',
        { recoverability: 'none' },
      ),
    ];
  }
  return [];
}

function toMergePreviewArtifactPayload(value: unknown): MergePreviewArtifactPayload | null {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.recordKind !== 'mergePreview') {
    return null;
  }
  if (value.status !== 'clean' && value.status !== 'conflicted') return null;
  if (
    !isWorkbookCommitId(value.base) ||
    !isWorkbookCommitId(value.ours) ||
    !isWorkbookCommitId(value.theirs) ||
    !Array.isArray(value.changes) ||
    !Array.isArray(value.conflicts)
  ) {
    return null;
  }
  return value as unknown as MergePreviewArtifactPayload;
}

function isWorkbookCommitId(value: unknown): boolean {
  return typeof value === 'string' && /^commit:sha256:[0-9a-f]{64}$/.test(value);
}
