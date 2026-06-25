import type { ObjectDigest, VersionResult, VersionStoreDiagnostic } from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../../../context';
import {
  MERGE_PREVIEW_OBJECT_TYPE,
  mergePreviewArtifactRef,
  type MergePreviewArtifactPayload,
} from '../../../../document/version-store/merge-attempt-artifacts';
import type { VersionGraphStore } from '../../../../document/version-store/provider-graph-store';
import {
  getVersionMergeCapabilityDecision,
  type VersionMergePublicCapability,
  type VersionMergePublicOperation,
  versionMergeCapabilityDisabledDiagnostic,
} from '../merge/version-merge-capability';
import {
  mergeReviewDiagnostic,
  persistedReviewArtifactReadDiagnostics,
  toInternalSha256Digest,
} from './version-merge-review-artifacts';
import {
  versionFailureFromStoreDiagnostics,
  versionResultFromMergeEndpointDiagnostics,
} from '../../version-result';

type MergeReviewPreviewReadResult =
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
    return payload
      ? { ok: true, payload }
      : { ok: false, diagnostics: [invalidPreviewArtifactDiagnostic(operation)] };
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

export function mergeEndpointPreflight<T>(
  ctx: DocumentContext,
  operation: VersionMergePublicOperation,
): VersionResult<T> | null {
  const decision = getVersionMergeCapabilityDecision(ctx, capabilityForOperation(operation));
  if (decision.enabled) return null;
  return versionResultFromMergeEndpointDiagnostics(operation, [
    versionMergeCapabilityDisabledDiagnostic(operation, decision),
  ]);
}

export function mergeEndpointFailure<T>(
  operation: VersionMergePublicOperation,
  diagnostics: readonly VersionStoreDiagnostic[],
): VersionResult<T> {
  return versionFailureFromStoreDiagnostics(operation, diagnostics);
}

function invalidPreviewArtifactDiagnostic(
  operation: VersionMergePublicOperation,
): VersionStoreDiagnostic {
  return mergeReviewDiagnostic(
    operation,
    'VERSION_INVALID_COMMIT_PAYLOAD',
    'Persisted merge preview artifact payload is invalid or unsupported.',
    { recoverability: 'repair' },
  );
}

function toMergePreviewArtifactPayload(value: unknown): MergePreviewArtifactPayload | null {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.recordKind !== 'mergePreview') {
    return null;
  }
  if (
    value.status !== 'clean' &&
    value.status !== 'conflicted' &&
    value.status !== 'fastForward' &&
    value.status !== 'alreadyMerged'
  ) {
    return null;
  }
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

function capabilityForOperation(
  operation: VersionMergePublicOperation,
): VersionMergePublicCapability {
  switch (operation) {
    case 'merge':
    case 'getMergeConflictDetail':
      return 'version:mergePreview';
    case 'applyMerge':
    case 'saveMergeResolutions':
    case 'putMergeResolutionPayload':
      return 'version:mergeApply';
  }
}

function isWorkbookCommitId(value: unknown): boolean {
  return typeof value === 'string' && /^commit:sha256:[0-9a-f]{64}$/.test(value);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
