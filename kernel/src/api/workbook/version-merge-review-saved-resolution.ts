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
import type { VersionGraphStore } from '../../document/version-store/provider-graph-store';
import {
  mapPublicExpectedTargetHead,
  mapPublicTargetRef,
} from './version-attempt-metadata';
import type { VersionMergePublicOperation } from './version-merge-capability';
import {
  type NormalizedMergeReviewConflictSet,
  validateResolutionsForConflictSet,
} from './version-merge-review-conflicts';
import {
  mergeReviewDiagnostic,
  persistedReviewArtifactReadDiagnostics,
  toInternalSha256Digest,
} from './version-merge-review-artifacts';
import type { NormalizedGetMergeConflictDetailInput } from './version-merge-review-normalization';
import { validateSealedResolutionPayloadRefs } from './version-merge-sealed-payload';
import { normalizeVersionApplyMergeResolutions } from './version-merge-resolution-normalization';

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

type SavedResolutionPayloadTarget = Pick<
  ResolvedMergeAttemptArtifactPayload,
  'targetRef' | 'expectedTargetHead'
>;

export async function resolveSavedConflictDetailSelection(
  graph: VersionGraphStore,
  operation: 'getMergeConflictDetail',
  input: NormalizedGetMergeConflictDetailInput,
  conflictSet: NormalizedMergeReviewConflictSet,
  conflict: VersionMergeConflict,
): Promise<SavedConflictDetailSelectionResult> {
  let resolutionSetDigest = input.resolutionSetDigest;
  let attemptTarget: SavedResolutionPayloadTarget | undefined;
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
    attemptTarget = {
      targetRef: attempt.payload.targetRef,
      expectedTargetHead: attempt.payload.expectedTargetHead,
    };
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

  const payloadRefDiagnostics = await validateSavedResolutionPayloadRefs(
    graph,
    operation,
    input,
    attemptTarget,
    conflictSet,
    resolutionValidation.resolutions,
  );
  if (payloadRefDiagnostics.length > 0) {
    return { ok: false, diagnostics: payloadRefDiagnostics };
  }

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

async function validateSavedResolutionPayloadRefs(
  graph: VersionGraphStore,
  operation: VersionMergePublicOperation,
  input: NormalizedGetMergeConflictDetailInput,
  attemptTarget: SavedResolutionPayloadTarget | undefined,
  conflictSet: NormalizedMergeReviewConflictSet,
  resolutions: readonly MergeResolutionSetArtifactPayload['resolutions'][number][],
): Promise<readonly VersionStoreDiagnostic[]> {
  if (!resolutions.some((resolution) => resolution.sealedPayloadRef)) return [];
  const target =
    input.targetRef && input.expectedTargetHead
      ? { targetRef: input.targetRef, expectedTargetHead: input.expectedTargetHead }
      : attemptTarget;

  return validateSealedResolutionPayloadRefs({
    graph,
    operation,
    allowExecutablePayloadRefs: true,
    resultId: input.resultId,
    resultDigest: input.resultDigest,
    redactionPolicyDigest: input.redactionPolicyDigest,
    ...(target
      ? { targetRef: target.targetRef, expectedTargetHead: target.expectedTargetHead }
      : {}),
    conflicts: conflictSet.conflicts,
    resolutions,
  });
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
  operation: VersionMergePublicOperation,
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
  const diagnostics: VersionStoreDiagnostic[] = [];
  const resolutions = normalizeVersionApplyMergeResolutions(value.resolutions, diagnostics, {
    allowUndefined: false,
    invalidDiagnostic: () =>
      invalidReviewArtifactDiagnostic(
        operation,
        'Persisted merge resolution set artifact payload is invalid or unsupported.',
      ),
  });
  return resolutions && diagnostics.length === 0
    ? {
        schemaVersion: 1,
        recordKind: 'mergeResolutionSet',
        resolutions,
      }
    : null;
}

function toResolvedMergeAttemptArtifactPayload(
  value: unknown,
): ResolvedMergeAttemptArtifactPayload | null {
  if (!isRecord(value)) return null;
  const targetRef = mapPublicTargetRef(value.targetRef);
  const expectedTargetHead = mapPublicExpectedTargetHead(value.expectedTargetHead);
  if (
    value.schemaVersion !== 1 ||
    value.recordKind !== 'resolvedMergeAttempt' ||
    !isObjectDigest(value.resultDigest) ||
    !isObjectDigest(value.resolutionSetDigest) ||
    !targetRef ||
    !expectedTargetHead
  ) {
    return null;
  }
  return {
    schemaVersion: 1,
    recordKind: 'resolvedMergeAttempt',
    resultDigest: value.resultDigest,
    resolutionSetDigest: value.resolutionSetDigest,
    targetRef,
    expectedTargetHead,
  };
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
