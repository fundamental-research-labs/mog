import type {
  ObjectDigest,
  VersionApplyMergeResolution,
  VersionCommitExpectedHead,
  VersionMainRefName,
  VersionMergeConflict,
  VersionMergeResultId,
  VersionRefName,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import { mergePreviewArtifactRef } from '../../../../document/version-store/merge-attempt-artifacts';
import {
  REVIEW_EXTENSION_OBJECT_TYPE,
  mergeResolutionPayloadAuthorityForNamespace,
  mergeReviewDiagnostic,
  toInternalSha256Digest,
} from './version-merge-review-artifacts';
import type { VersionMergePublicOperation } from '../merge/version-merge-capability';
import { findResolutionOption } from './version-merge-review-conflicts-lookup';
import { projectReviewValue } from './version-merge-review-conflicts-projection';
import {
  type MergeResolutionPayloadRecord,
  toMergeResolutionPayloadRecord,
} from './version-merge-sealed-payload-record';
import {
  canonicalJson,
  digestsEqual,
  isObjectDigest,
  isRecord,
  objectDigestFromConflictDigest,
  objectDigestKey,
} from './version-merge-sealed-payload-utils';
import {
  VersionObjectStoreError,
  type VersionObjectRecord,
} from '../../../../document/version-store/object-store';
import type { VersionDependencyRef } from '../../../../document/version-store/object-digest';
import type { VersionGraphStore } from '../../../../document/version-store/provider-graph-store';

type ObjectDependencyRef = Extract<VersionDependencyRef, { readonly kind: 'object' }>;

export async function validateSealedResolutionPayloadRefs(input: {
  readonly graph: VersionGraphStore;
  readonly operation: VersionMergePublicOperation;
  readonly allowExecutablePayloadRefs?: boolean;
  readonly resultId: VersionMergeResultId;
  readonly resultDigest: ObjectDigest;
  readonly redactionPolicyDigest?: ObjectDigest;
  readonly targetRef?: VersionMainRefName | VersionRefName;
  readonly expectedTargetHead?: VersionCommitExpectedHead;
  readonly resolutionSetDigest?: ObjectDigest;
  readonly conflicts: readonly VersionMergeConflict[];
  readonly resolutions: readonly VersionApplyMergeResolution[];
}): Promise<readonly VersionStoreDiagnostic[]> {
  const diagnostics: VersionStoreDiagnostic[] = [];
  const seenPayloadDigests = new Set<string>();
  for (const resolution of input.resolutions) {
    if (!resolution.sealedPayloadRef) continue;
    const payloadDigestKey = objectDigestKey(resolution.sealedPayloadRef.payloadDigest);
    if (seenPayloadDigests.has(payloadDigestKey)) {
      diagnostics.push(
        sealedPayloadMismatchDiagnostic(input.operation, 'duplicate sealed payload ref supplied.'),
      );
      continue;
    }
    seenPayloadDigests.add(payloadDigestKey);
    if (input.allowExecutablePayloadRefs === false) {
      diagnostics.push(
        sealedPayloadMismatchDiagnostic(
          input.operation,
          'review-only merge attempts cannot save sealed resolution payload refs.',
        ),
      );
      continue;
    }
    const bindingDiagnostics = validateSealedRefBinding(input, resolution);
    diagnostics.push(...bindingDiagnostics);
    if (bindingDiagnostics.length > 0) continue;

    const payloadRead = await readMergeResolutionPayload(
      input.graph,
      input.operation,
      resolution.sealedPayloadRef.payloadDigest,
    );
    if (!payloadRead.ok) {
      diagnostics.push(...payloadRead.diagnostics);
      continue;
    }
    diagnostics.push(
      ...validateSealedPayloadRecord(input, resolution, payloadRead.record, payloadRead.payload),
    );
  }
  return diagnostics;
}

function validateSealedRefBinding(
  input: {
    readonly operation: VersionMergePublicOperation;
    readonly resultId: VersionMergeResultId;
    readonly resultDigest: ObjectDigest;
    readonly redactionPolicyDigest?: ObjectDigest;
    readonly targetRef?: VersionMainRefName | VersionRefName;
    readonly expectedTargetHead?: VersionCommitExpectedHead;
    readonly resolutionSetDigest?: ObjectDigest;
    readonly conflicts: readonly VersionMergeConflict[];
  },
  resolution: VersionApplyMergeResolution,
): readonly VersionStoreDiagnostic[] {
  const ref = resolution.sealedPayloadRef;
  if (!ref) return [];
  const diagnostics: VersionStoreDiagnostic[] = [];
  if (!input.targetRef || !input.expectedTargetHead) {
    diagnostics.push(
      sealedPayloadMismatchDiagnostic(
        input.operation,
        'sealed resolution payload refs require targetRef and expectedTargetHead.',
      ),
    );
  }
  if (ref.storageMode !== 'serverEncrypted') {
    diagnostics.push(
      sealedPayloadMismatchDiagnostic(
        input.operation,
        'local-only sealed resolution payload refs cannot be replayed from the provider graph.',
      ),
    );
  }
  if (ref.payloadId !== `merge-payload:${ref.payloadDigest.digest}`) {
    diagnostics.push(
      sealedPayloadMismatchDiagnostic(input.operation, 'sealed payload id does not match digest.'),
    );
  }
  if (ref.resultId !== input.resultId || !digestsEqual(ref.resultDigest, input.resultDigest)) {
    diagnostics.push(
      sealedPayloadMismatchDiagnostic(
        input.operation,
        'sealed payload result binding does not match.',
      ),
    );
  }
  if (
    ref.conflictId !== resolution.conflictId ||
    ref.optionId !== resolution.optionId ||
    ref.resolutionKind !== resolution.kind
  ) {
    diagnostics.push(
      sealedPayloadMismatchDiagnostic(
        input.operation,
        'sealed payload resolution binding does not match.',
      ),
    );
  }
  if (ref.expiresAt !== undefined) {
    const expiresAtMs = Date.parse(ref.expiresAt);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
      diagnostics.push(
        sealedPayloadMismatchDiagnostic(input.operation, 'sealed payload ref is expired.'),
      );
    }
  }
  const conflict = input.conflicts.find(
    (candidate) => candidate.conflictId === resolution.conflictId,
  );
  const option = conflict
    ? findResolutionOption(conflict, resolution.optionId, resolution.kind)
    : undefined;
  if (!conflict || resolution.expectedConflictDigest !== conflict.conflictDigest || !option) {
    diagnostics.push(
      sealedPayloadMismatchDiagnostic(
        input.operation,
        'sealed payload conflict option does not match preview.',
      ),
    );
  }
  return diagnostics;
}

async function readMergeResolutionPayload(
  graph: VersionGraphStore,
  operation: VersionMergePublicOperation,
  digest: ObjectDigest,
): Promise<
  | {
      readonly ok: true;
      readonly record: VersionObjectRecord<unknown>;
      readonly payload: MergeResolutionPayloadRecord;
    }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] }
> {
  const internalDigest = toInternalSha256Digest(digest);
  if (!internalDigest) {
    return {
      ok: false,
      diagnostics: [
        sealedPayloadMismatchDiagnostic(operation, 'sealed payload digest is invalid.'),
      ],
    };
  }
  try {
    const record = await graph.getObjectRecord<unknown>({
      kind: 'object',
      objectType: REVIEW_EXTENSION_OBJECT_TYPE,
      digest: internalDigest,
    });
    const payload = toMergeResolutionPayloadRecord(record.preimage.payload);
    if (record.preimage.objectType !== REVIEW_EXTENSION_OBJECT_TYPE || !payload) {
      return {
        ok: false,
        diagnostics: [
          sealedPayloadMismatchDiagnostic(operation, 'sealed payload object is invalid.'),
        ],
      };
    }
    return { ok: true, record, payload };
  } catch (error) {
    return {
      ok: false,
      diagnostics: [
        mergeReviewDiagnostic(
          operation,
          error instanceof VersionObjectStoreError &&
            error.diagnostic.code === 'VERSION_OBJECT_NOT_FOUND'
            ? 'VERSION_MISSING_OBJECT'
            : 'VERSION_PROVIDER_FAILED',
          'Sealed resolution payload could not be read.',
          { recoverability: error instanceof VersionObjectStoreError ? 'repair' : 'retry' },
        ),
      ],
    };
  }
}

function validateSealedPayloadRecord(
  input: {
    readonly operation: VersionMergePublicOperation;
    readonly resultId: VersionMergeResultId;
    readonly resultDigest: ObjectDigest;
    readonly redactionPolicyDigest?: ObjectDigest;
    readonly targetRef?: VersionMainRefName | VersionRefName;
    readonly expectedTargetHead?: VersionCommitExpectedHead;
    readonly resolutionSetDigest?: ObjectDigest;
    readonly conflicts: readonly VersionMergeConflict[];
  },
  resolution: VersionApplyMergeResolution,
  record: VersionObjectRecord<unknown>,
  payload: MergeResolutionPayloadRecord,
): readonly VersionStoreDiagnostic[] {
  const diagnostics: VersionStoreDiagnostic[] = [];
  const expectedRedactionPolicyDigest = input.redactionPolicyDigest ?? input.resultDigest;
  const expectedConflictDigest = objectDigestFromConflictDigest(resolution.expectedConflictDigest);
  const artifactBindingDiagnostics = validateSealedPayloadArtifactBinding(input, record);
  diagnostics.push(...artifactBindingDiagnostics);
  if (
    payload.attemptId !== input.resultId ||
    payload.resultId !== input.resultId ||
    !digestsEqual(payload.resultDigest, input.resultDigest) ||
    !digestsEqual(payload.previewArtifactDigest, input.resultDigest) ||
    !digestsEqual(payload.redactionPolicyDigest, expectedRedactionPolicyDigest) ||
    payload.conflictId !== resolution.conflictId ||
    !expectedConflictDigest ||
    !digestsEqual(payload.conflictDigest, expectedConflictDigest) ||
    payload.expectedConflictDigest !== resolution.expectedConflictDigest ||
    payload.optionId !== resolution.optionId ||
    payload.kind !== resolution.kind ||
    payload.targetRef !== input.targetRef ||
    canonicalJson(payload.expectedTargetHead) !== canonicalJson(input.expectedTargetHead) ||
    canonicalJson(payload.authority) !==
      canonicalJson(mergeResolutionPayloadAuthorityForNamespace(record.namespace)) ||
    Boolean(
      input.resolutionSetDigest &&
      (!payload.resolutionSetDigest ||
        !digestsEqual(payload.resolutionSetDigest, input.resolutionSetDigest)),
    )
  ) {
    diagnostics.push(
      sealedPayloadMismatchDiagnostic(
        input.operation,
        'sealed payload object binding does not match.',
      ),
    );
  }
  if (payload.purpose !== 'chooseValue') {
    diagnostics.push(
      sealedPayloadMismatchDiagnostic(input.operation, 'sealed payload purpose is not executable.'),
    );
  }

  const conflict = input.conflicts.find(
    (candidate) => candidate.conflictId === resolution.conflictId,
  );
  const option = conflict
    ? findResolutionOption(conflict, resolution.optionId, resolution.kind)
    : undefined;
  if (conflict && option) {
    const projected = projectReviewValue(input.operation, conflict.structural, option.value);
    if (!projected.ok) {
      diagnostics.push(...projected.diagnostics);
    } else if (canonicalJson(projected.value) !== canonicalJson(payload.value)) {
      diagnostics.push(
        sealedPayloadMismatchDiagnostic(
          input.operation,
          'sealed payload value does not match resolution option.',
        ),
      );
    }
  }
  return diagnostics;
}

function validateSealedPayloadArtifactBinding(
  input: {
    readonly operation: VersionMergePublicOperation;
    readonly resultDigest: ObjectDigest;
  },
  record: VersionObjectRecord<unknown>,
): readonly VersionStoreDiagnostic[] {
  const expectedResultDigest = toInternalSha256Digest(input.resultDigest);
  const expectedDependency = expectedResultDigest
    ? mergePreviewArtifactRef(expectedResultDigest)
    : null;
  const dependencies = record.preimage.dependencies;
  if (
    !expectedDependency ||
    dependencies.length !== 1 ||
    !isExpectedPreviewDependency(dependencies[0], expectedDependency)
  ) {
    return [
      sealedPayloadMismatchDiagnostic(
        input.operation,
        'sealed payload artifact binding does not match.',
      ),
    ];
  }
  return [];
}

function isExpectedPreviewDependency(
  actual: unknown,
  expected: ReturnType<typeof mergePreviewArtifactRef>,
): actual is ObjectDependencyRef {
  return (
    isObjectDependencyRef(actual) &&
    isObjectDependencyRef(expected) &&
    actual.objectType === expected.objectType &&
    digestsEqual(actual.digest, expected.digest)
  );
}

function isObjectDependencyRef(value: unknown): value is ObjectDependencyRef {
  return (
    isRecord(value) &&
    value.kind === 'object' &&
    typeof value.objectType === 'string' &&
    isObjectDigest(value.digest)
  );
}

function sealedPayloadMismatchDiagnostic(
  operation: VersionMergePublicOperation,
  safeMessage: string,
): VersionStoreDiagnostic {
  return mergeReviewDiagnostic(operation, 'VERSION_MERGE_RESOLUTION_MISMATCH', safeMessage, {
    recoverability: 'none',
  });
}
