import type {
  ObjectDigest,
  VersionMergeConflict,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import {
  MERGE_RESOLUTION_SET_OBJECT_TYPE,
  RESOLVED_MERGE_ATTEMPT_OBJECT_TYPE,
  mergeResolutionSetArtifactRef,
  resolvedMergeAttemptArtifactRef,
  type MergeResolutionSetArtifactPayload,
  type ResolvedMergeAttemptArtifactPayload,
} from '../../document/version-store/merge-attempt-artifacts';
import { VersionObjectStoreError } from '../../document/version-store/object-store';
import type { VersionGraphStore } from '../../document/version-store/provider-graph-store';
import type { VersionMergePublicOperation } from './version-merge-capability';
import {
  type NormalizedMergeReviewConflictSet,
  validateResolutionsForConflictSet,
} from './version-merge-review-conflicts';
import {
  mergeReviewDiagnostic,
  mergeReviewProviderErrorDiagnostic,
  toInternalSha256Digest,
} from './version-merge-review-artifacts';
import type { NormalizedGetMergeConflictDetailInput } from './version-merge-review-normalization';

type ConflictDetailSelectionInput = Pick<
  NormalizedGetMergeConflictDetailInput,
  'valueRole' | 'optionId' | 'kind'
>;

type SavedConflictDetailSelectionResult =
  | { readonly ok: true; readonly selection: ConflictDetailSelectionInput }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] };

type MergeReviewResolutionSetReadResult =
  | { readonly ok: true; readonly payload: MergeResolutionSetArtifactPayload }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] };

type MergeReviewResolvedAttemptReadResult =
  | { readonly ok: true; readonly payload: ResolvedMergeAttemptArtifactPayload }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] };

export async function resolveSavedConflictDetailSelection(
  graph: VersionGraphStore,
  operation: 'getMergeConflictDetail',
  input: NormalizedGetMergeConflictDetailInput,
  conflictSet: NormalizedMergeReviewConflictSet,
  conflict: VersionMergeConflict,
): Promise<SavedConflictDetailSelectionResult> {
  let resolutionSetDigest = input.resolutionSetDigest;
  if (input.resolvedAttemptDigest) {
    const attempt = await readResolvedMergeAttemptArtifact(
      graph,
      operation,
      input.resolvedAttemptDigest,
    );
    if (!attempt.ok) return attempt;
    const attemptDiagnostics = validateResolvedAttemptBinding(operation, input, attempt.payload);
    if (attemptDiagnostics.length > 0) {
      return { ok: false, diagnostics: attemptDiagnostics };
    }
    if (
      resolutionSetDigest &&
      !digestsEqual(resolutionSetDigest, attempt.payload.resolutionSetDigest)
    ) {
      return {
        ok: false,
        diagnostics: [
          mergeReviewDiagnostic(
            operation,
            'VERSION_MERGE_RESOLUTION_MISMATCH',
            'saved resolutionSetDigest does not match the resolved merge attempt.',
          ),
        ],
      };
    }
    resolutionSetDigest = attempt.payload.resolutionSetDigest;
  }

  if (!resolutionSetDigest) {
    return {
      ok: true,
      selection: {
        valueRole: input.valueRole,
        ...(input.optionId ? { optionId: input.optionId } : {}),
        ...(input.kind ? { kind: input.kind } : {}),
      },
    };
  }

  const resolutionSet = await readResolutionSetArtifact(graph, operation, resolutionSetDigest);
  if (!resolutionSet.ok) return resolutionSet;

  const resolutionValidation = validateResolutionsForConflictSet(
    operation,
    { status: 'conflicted' },
    conflictSet,
    resolutionSet.payload.resolutions,
  );
  if (!resolutionValidation.ok) return resolutionValidation;

  const resolution = resolutionValidation.resolutions.find(
    (candidate) => candidate.conflictId === conflict.conflictId,
  );
  if (!resolution) {
    return {
      ok: false,
      diagnostics: [
        mergeReviewDiagnostic(
          operation,
          'VERSION_MERGE_RESOLUTION_MISMATCH',
          'saved resolution set does not include the requested conflict.',
        ),
      ],
    };
  }
  if (
    (input.optionId && input.optionId !== resolution.optionId) ||
    (input.kind && input.kind !== resolution.kind)
  ) {
    return {
      ok: false,
      diagnostics: [
        mergeReviewDiagnostic(
          operation,
          'VERSION_MERGE_RESOLUTION_MISMATCH',
          'saved resolution option does not match the conflict detail request.',
        ),
      ],
    };
  }

  return {
    ok: true,
    selection: {
      valueRole: input.valueRole,
      optionId: resolution.optionId,
      kind: resolution.kind,
    },
  };
}

async function readResolutionSetArtifact(
  graph: VersionGraphStore,
  operation: VersionMergePublicOperation,
  digest: ObjectDigest,
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
    const payload = toMergeResolutionSetArtifactPayload(record.preimage.payload);
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

async function readResolvedMergeAttemptArtifact(
  graph: VersionGraphStore,
  operation: VersionMergePublicOperation,
  digest: ObjectDigest,
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

function validateResolvedAttemptBinding(
  operation: VersionMergePublicOperation,
  input: NormalizedGetMergeConflictDetailInput,
  payload: ResolvedMergeAttemptArtifactPayload,
): readonly VersionStoreDiagnostic[] {
  const diagnostics: VersionStoreDiagnostic[] = [];
  if (!digestsEqual(payload.resultDigest, input.resultDigest)) {
    diagnostics.push(
      mergeReviewDiagnostic(
        operation,
        'VERSION_MERGE_RESOLUTION_MISMATCH',
        'resolved merge attempt does not match the merge preview digest.',
      ),
    );
  }
  if (input.targetRef && payload.targetRef !== input.targetRef) {
    diagnostics.push(
      mergeReviewDiagnostic(
        operation,
        'VERSION_MERGE_RESOLUTION_MISMATCH',
        'resolved merge attempt targetRef does not match.',
      ),
    );
  }
  if (
    input.expectedTargetHead &&
    canonicalJson(payload.expectedTargetHead) !== canonicalJson(input.expectedTargetHead)
  ) {
    diagnostics.push(
      mergeReviewDiagnostic(
        operation,
        'VERSION_MERGE_RESOLUTION_MISMATCH',
        'resolved merge attempt expectedTargetHead does not match.',
      ),
    );
  }
  return diagnostics;
}

function persistedReviewArtifactReadDiagnostics(
  operation: VersionMergePublicOperation,
  error: unknown,
  missingMessage: string,
): readonly VersionStoreDiagnostic[] {
  if (
    error instanceof VersionObjectStoreError &&
    error.diagnostic.code === 'VERSION_OBJECT_NOT_FOUND'
  ) {
    return [
      mergeReviewDiagnostic(operation, 'VERSION_MISSING_OBJECT', missingMessage, {
        recoverability: 'repair',
      }),
    ];
  }
  const diagnostic = providerDiagnosticFromError(error);
  if (!diagnostic) return [mergeReviewProviderErrorDiagnostic(operation)];
  const issueCode = publicArtifactIssueCode(diagnostic);
  return [
    mergeReviewDiagnostic(
      operation,
      issueCode,
      reviewArtifactSafeMessage(issueCode, missingMessage),
    ),
  ];
}

function providerDiagnosticFromError(error: unknown): Readonly<Record<string, unknown>> | null {
  if (!isRecord(error)) return null;
  const first = Array.isArray(error.diagnostics) ? error.diagnostics[0] : error.diagnostic;
  return isRecord(first) ? first : null;
}

function publicArtifactIssueCode(diagnostic: Readonly<Record<string, unknown>>): string {
  const raw =
    typeof diagnostic.issueCode === 'string'
      ? diagnostic.issueCode
      : typeof diagnostic.code === 'string'
        ? diagnostic.code
        : 'VERSION_PROVIDER_FAILED';
  switch (raw) {
    case 'VERSION_OBJECT_NOT_FOUND':
      return 'VERSION_MISSING_OBJECT';
    case 'VERSION_INVALID_COMMIT_PAYLOAD':
    case 'VERSION_MISSING_DEPENDENCY':
    case 'VERSION_MISSING_OBJECT':
    case 'VERSION_OBJECT_STORE_FAILURE':
    case 'VERSION_PERMISSION_DENIED':
    case 'VERSION_PROVIDER_FAILED':
    case 'VERSION_REF_CONFLICT':
    case 'VERSION_STALE_PAGE_CURSOR':
    case 'VERSION_STORE_UNAVAILABLE':
    case 'VERSION_UNSUPPORTED_SCHEMA':
      return raw;
    default:
      return 'VERSION_PROVIDER_FAILED';
  }
}

function reviewArtifactSafeMessage(issueCode: string, missingMessage: string): string {
  switch (issueCode) {
    case 'VERSION_MISSING_OBJECT':
      return missingMessage;
    case 'VERSION_PERMISSION_DENIED':
      return 'Version merge review is not authorized for this caller.';
    case 'VERSION_REF_CONFLICT':
      return 'Version merge review target is stale.';
    case 'VERSION_STALE_PAGE_CURSOR':
      return 'Version merge review cursor is stale.';
    default:
      return 'Version merge review provider failed.';
  }
}

function invalidReviewArtifactDiagnostic(
  operation: VersionMergePublicOperation,
  safeMessage: string,
): VersionStoreDiagnostic {
  return mergeReviewDiagnostic(operation, 'VERSION_INVALID_COMMIT_PAYLOAD', safeMessage, {
    recoverability: 'repair',
  });
}

function invalidArtifactDigestDiagnostic(
  operation: VersionMergePublicOperation,
  option: string,
): VersionStoreDiagnostic {
  return mergeReviewDiagnostic(
    operation,
    'VERSION_INVALID_OPTIONS',
    `${option} must be a sha256 merge review artifact digest.`,
    { payload: { option } },
  );
}

function toMergeResolutionSetArtifactPayload(
  value: unknown,
): MergeResolutionSetArtifactPayload | null {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    value.recordKind !== 'mergeResolutionSet' ||
    !Array.isArray(value.resolutions)
  ) {
    return null;
  }
  return value as unknown as MergeResolutionSetArtifactPayload;
}

function toResolvedMergeAttemptArtifactPayload(
  value: unknown,
): ResolvedMergeAttemptArtifactPayload | null {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    value.recordKind !== 'resolvedMergeAttempt' ||
    !isObjectDigest(value.resultDigest) ||
    !isObjectDigest(value.resolutionSetDigest) ||
    typeof value.targetRef !== 'string' ||
    !isRecord(value.expectedTargetHead)
  ) {
    return null;
  }
  return value as unknown as ResolvedMergeAttemptArtifactPayload;
}

function isObjectDigest(value: unknown): value is ObjectDigest {
  return (
    isRecord(value) &&
    value.algorithm === 'sha256' &&
    typeof value.digest === 'string' &&
    /^[0-9a-f]{64}$/.test(value.digest)
  );
}

function digestsEqual(left: ObjectDigest, right: ObjectDigest): boolean {
  return left.algorithm === right.algorithm && left.digest === right.digest;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
