import type {
  ObjectDigest,
  VersionApplyMergeResolution,
  VersionCommitExpectedHead,
  VersionMainRefName,
  VersionMergeConflict,
  VersionMergeResultId,
  VersionRefName,
  VersionSealedResolutionPayloadRef,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import {
  REVIEW_EXTENSION_OBJECT_TYPE,
  mergeReviewDiagnostic,
  toInternalSha256Digest,
} from './version-merge-review-artifacts';
import type { VersionMergePublicOperation } from './version-merge-capability';
import { findResolutionOption, projectReviewValue } from './version-merge-review-conflicts';
import { mapPublicObjectDigest } from './version-attempt-metadata';
import { VersionObjectStoreError } from '../../document/version-store/object-store';
import type { VersionGraphStore } from '../../document/version-store/provider-graph-store';

const SEALED_REF_KEYS = new Set([
  'schemaVersion',
  'kind',
  'payloadId',
  'payloadDigest',
  'storageMode',
  'resultId',
  'resultDigest',
  'conflictId',
  'optionId',
  'resolutionKind',
  'expiresAt',
]);

type InvalidDiagnostic = (path: string, safeMessage: string) => VersionStoreDiagnostic;

type MergeResolutionPayloadRecord = {
  readonly schemaVersion: 1;
  readonly recordKind: 'mergeResolutionPayload';
  readonly resultId: string;
  readonly resultDigest: ObjectDigest;
  readonly conflictId: string;
  readonly expectedConflictDigest: string;
  readonly optionId: string;
  readonly kind: string;
  readonly targetRef: string;
  readonly expectedTargetHead: unknown;
  readonly purpose: string;
  readonly value: unknown;
};

export function normalizeSealedResolutionPayloadRefInput(
  value: unknown,
  path: string,
  invalidDiagnostic: InvalidDiagnostic,
  diagnostics: VersionStoreDiagnostic[],
): VersionSealedResolutionPayloadRef | null {
  if (!isRecord(value) || Array.isArray(value)) {
    diagnostics.push(invalidDiagnostic(path, 'sealedPayloadRef must be an object.'));
    return null;
  }
  for (const key of Object.keys(value)) {
    if (SEALED_REF_KEYS.has(key)) continue;
    diagnostics.push(
      invalidDiagnostic(`${path}.${key}`, `Unknown sealedPayloadRef field "${key}".`),
    );
  }

  const schemaVersion = value.schemaVersion === 1 ? 1 : null;
  const kind = value.kind === 'sealedResolutionPayload' ? value.kind : null;
  const payloadId =
    typeof value.payloadId === 'string' && value.payloadId.startsWith('merge-payload:')
      ? (value.payloadId as `merge-payload:${string}`)
      : null;
  const payloadDigest = mapPublicObjectDigest(value.payloadDigest);
  const storageMode =
    value.storageMode === 'serverEncrypted' || value.storageMode === 'localOnly'
      ? value.storageMode
      : null;
  const resultId =
    typeof value.resultId === 'string' && value.resultId.startsWith('merge-result:')
      ? (value.resultId as VersionMergeResultId)
      : null;
  const resultDigest = mapPublicObjectDigest(value.resultDigest);
  const conflictId =
    typeof value.conflictId === 'string' && value.conflictId.length > 0 ? value.conflictId : null;
  const optionId =
    typeof value.optionId === 'string' && value.optionId.length > 0 ? value.optionId : null;
  const resolutionKind =
    value.resolutionKind === 'acceptOurs' ||
    value.resolutionKind === 'acceptTheirs' ||
    value.resolutionKind === 'acceptBase'
      ? value.resolutionKind
      : null;
  const expiresAt =
    value.expiresAt === undefined
      ? undefined
      : typeof value.expiresAt === 'string' && value.expiresAt.length > 0
        ? value.expiresAt
        : null;

  if (!schemaVersion)
    diagnostics.push(invalidDiagnostic(`${path}.schemaVersion`, 'schemaVersion must be 1.'));
  if (!kind)
    diagnostics.push(invalidDiagnostic(`${path}.kind`, 'kind must be sealedResolutionPayload.'));
  if (!payloadId) diagnostics.push(invalidDiagnostic(`${path}.payloadId`, 'payloadId is invalid.'));
  if (!payloadDigest)
    diagnostics.push(invalidDiagnostic(`${path}.payloadDigest`, 'payloadDigest is invalid.'));
  if (!storageMode)
    diagnostics.push(invalidDiagnostic(`${path}.storageMode`, 'storageMode is invalid.'));
  if (!resultId) diagnostics.push(invalidDiagnostic(`${path}.resultId`, 'resultId is invalid.'));
  if (!resultDigest)
    diagnostics.push(invalidDiagnostic(`${path}.resultDigest`, 'resultDigest is invalid.'));
  if (!conflictId)
    diagnostics.push(invalidDiagnostic(`${path}.conflictId`, 'conflictId is required.'));
  if (!optionId) diagnostics.push(invalidDiagnostic(`${path}.optionId`, 'optionId is required.'));
  if (!resolutionKind) {
    diagnostics.push(invalidDiagnostic(`${path}.resolutionKind`, 'resolutionKind is invalid.'));
  }
  if (expiresAt === null)
    diagnostics.push(invalidDiagnostic(`${path}.expiresAt`, 'expiresAt is invalid.'));

  if (
    !schemaVersion ||
    !kind ||
    !payloadId ||
    !payloadDigest ||
    !storageMode ||
    !resultId ||
    !resultDigest ||
    !conflictId ||
    !optionId ||
    !resolutionKind ||
    expiresAt === null
  ) {
    return null;
  }

  return {
    schemaVersion,
    kind,
    payloadId,
    payloadDigest,
    storageMode,
    resultId,
    resultDigest,
    conflictId,
    optionId,
    resolutionKind,
    ...(expiresAt === undefined ? {} : { expiresAt }),
  };
}

export async function validateSealedResolutionPayloadRefs(input: {
  readonly graph: VersionGraphStore;
  readonly operation: VersionMergePublicOperation;
  readonly resultId: VersionMergeResultId;
  readonly resultDigest: ObjectDigest;
  readonly targetRef?: VersionMainRefName | VersionRefName;
  readonly expectedTargetHead?: VersionCommitExpectedHead;
  readonly conflicts: readonly VersionMergeConflict[];
  readonly resolutions: readonly VersionApplyMergeResolution[];
}): Promise<readonly VersionStoreDiagnostic[]> {
  const diagnostics: VersionStoreDiagnostic[] = [];
  for (const resolution of input.resolutions) {
    if (!resolution.sealedPayloadRef) continue;
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
    diagnostics.push(...validateSealedPayloadRecord(input, resolution, payloadRead.payload));
  }
  return diagnostics;
}

function validateSealedRefBinding(
  input: {
    readonly operation: VersionMergePublicOperation;
    readonly resultId: VersionMergeResultId;
    readonly resultDigest: ObjectDigest;
    readonly targetRef?: VersionMainRefName | VersionRefName;
    readonly expectedTargetHead?: VersionCommitExpectedHead;
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
  | { readonly ok: true; readonly payload: MergeResolutionPayloadRecord }
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
    return { ok: true, payload };
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
    readonly targetRef?: VersionMainRefName | VersionRefName;
    readonly expectedTargetHead?: VersionCommitExpectedHead;
    readonly conflicts: readonly VersionMergeConflict[];
  },
  resolution: VersionApplyMergeResolution,
  payload: MergeResolutionPayloadRecord,
): readonly VersionStoreDiagnostic[] {
  const diagnostics: VersionStoreDiagnostic[] = [];
  if (
    payload.resultId !== input.resultId ||
    !digestsEqual(payload.resultDigest, input.resultDigest) ||
    payload.conflictId !== resolution.conflictId ||
    payload.expectedConflictDigest !== resolution.expectedConflictDigest ||
    payload.optionId !== resolution.optionId ||
    payload.kind !== resolution.kind ||
    payload.targetRef !== input.targetRef ||
    canonicalJson(payload.expectedTargetHead) !== canonicalJson(input.expectedTargetHead) ||
    payload.purpose !== 'chooseValue'
  ) {
    diagnostics.push(
      sealedPayloadMismatchDiagnostic(
        input.operation,
        'sealed payload object binding does not match.',
      ),
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

function toMergeResolutionPayloadRecord(value: unknown): MergeResolutionPayloadRecord | null {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    value.recordKind !== 'mergeResolutionPayload'
  ) {
    return null;
  }
  if (
    typeof value.resultId !== 'string' ||
    !isObjectDigest(value.resultDigest) ||
    typeof value.conflictId !== 'string' ||
    typeof value.expectedConflictDigest !== 'string' ||
    typeof value.optionId !== 'string' ||
    typeof value.kind !== 'string' ||
    typeof value.targetRef !== 'string' ||
    typeof value.purpose !== 'string' ||
    !('expectedTargetHead' in value) ||
    !('value' in value)
  ) {
    return null;
  }
  return value as unknown as MergeResolutionPayloadRecord;
}

function sealedPayloadMismatchDiagnostic(
  operation: VersionMergePublicOperation,
  safeMessage: string,
): VersionStoreDiagnostic {
  return mergeReviewDiagnostic(operation, 'VERSION_MERGE_RESOLUTION_MISMATCH', safeMessage, {
    recoverability: 'none',
  });
}

function digestsEqual(left: ObjectDigest | undefined, right: ObjectDigest | undefined): boolean {
  return Boolean(
    left && right && left.algorithm === right.algorithm && left.digest === right.digest,
  );
}

function isObjectDigest(value: unknown): value is ObjectDigest {
  return (
    isRecord(value) &&
    value.algorithm === 'sha256' &&
    typeof value.digest === 'string' &&
    /^[0-9a-f]{64}$/.test(value.digest)
  );
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
