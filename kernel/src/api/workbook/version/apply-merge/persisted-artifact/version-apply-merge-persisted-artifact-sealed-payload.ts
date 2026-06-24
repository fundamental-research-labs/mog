import type {
  ObjectDigest,
  VersionApplyMergeResolution,
  VersionCommitExpectedHead,
  VersionMainRefName,
  VersionMergeConflict,
  VersionMergeResultId,
  VersionRefName,
  VersionStoreDiagnostic,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import {
  MERGE_PREVIEW_OBJECT_TYPE,
  mergePreviewArtifactRef,
  type MergePreviewArtifactPayload,
} from '../../../../../document/version-store/merge-attempt-artifacts';
import type { ObjectDigest as InternalObjectDigest } from '../../../../../document/version-store/object-digest';
import type { VersionGraphStore } from '../../../../../document/version-store/provider-graph-store';
import {
  invalidPreviewArtifactDiagnostic,
  persistedPreviewArtifactReadDiagnostic,
} from './version-apply-merge-persisted-artifact-diagnostics';
import { validateSealedResolutionPayloadRefs } from '../../merge-review/version-merge-sealed-payload';

const WORKBOOK_COMMIT_ID_RE = /^commit:sha256:[0-9a-f]{64}$/;

export async function readPreviewArtifact(
  graph: VersionGraphStore,
  digest: ObjectDigest,
): Promise<
  | { readonly ok: true; readonly payload: MergePreviewArtifactPayload }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] }
> {
  try {
    const internalDigest = toInternalSha256Digest(digest);
    if (!internalDigest) return { ok: false, diagnostics: [invalidPreviewArtifactDiagnostic()] };
    const record = await graph.getObjectRecord<unknown>(mergePreviewArtifactRef(internalDigest));
    if (record.preimage.objectType !== MERGE_PREVIEW_OBJECT_TYPE) {
      return { ok: false, diagnostics: [invalidPreviewArtifactDiagnostic()] };
    }
    const payload = toMergePreviewArtifactPayload(record.preimage.payload);
    if (!payload) return { ok: false, diagnostics: [invalidPreviewArtifactDiagnostic()] };
    return { ok: true, payload };
  } catch (error) {
    return {
      ok: false,
      diagnostics: [persistedPreviewArtifactReadDiagnostic(error)],
    };
  }
}

export function validatePersistedMergePreviewSealedPayloadRefs(input: {
  readonly graph: VersionGraphStore;
  readonly resultId: VersionMergeResultId;
  readonly resultDigest: ObjectDigest;
  readonly targetRef: VersionMainRefName | VersionRefName;
  readonly expectedTargetHead: VersionCommitExpectedHead;
  readonly conflicts: readonly VersionMergeConflict[];
  readonly resolutions: readonly VersionApplyMergeResolution[];
}): Promise<readonly VersionStoreDiagnostic[]> {
  return validateSealedResolutionPayloadRefs({
    graph: input.graph,
    operation: 'applyMerge',
    resultId: input.resultId,
    resultDigest: input.resultDigest,
    targetRef: input.targetRef,
    expectedTargetHead: input.expectedTargetHead,
    conflicts: input.conflicts,
    resolutions: input.resolutions,
  });
}

export function digestsEqual(
  left: { readonly algorithm: string; readonly digest: string },
  right: { readonly algorithm: string; readonly digest: string },
): boolean {
  return left.algorithm === right.algorithm && left.digest === right.digest;
}

export function isInternalSha256Digest(value: ObjectDigest): boolean {
  return Boolean(toInternalSha256Digest(value));
}

export function toInternalSha256Digest(value: ObjectDigest): InternalObjectDigest | null {
  return value.algorithm === 'sha256' ? (value as InternalObjectDigest) : null;
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

function isWorkbookCommitId(value: unknown): value is WorkbookCommitId {
  return typeof value === 'string' && WORKBOOK_COMMIT_ID_RE.test(value);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
