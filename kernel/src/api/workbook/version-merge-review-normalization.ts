import type {
  JsonValue,
  ObjectDigest,
  VersionApplyMergeResolution,
  VersionCommitExpectedHead,
  VersionGetMergeConflictDetailRequest,
  VersionMainRefName,
  VersionMergeConflict,
  VersionMergeConflictResolutionOption,
  VersionMergeConflictDetailPurpose,
  VersionMergeConflictResolutionOptionKind,
  VersionMergeConflictValueRole,
  VersionMergeResolutionPayloadPurpose,
  VersionPutMergeResolutionPayloadRequest,
  VersionRefName,
  VersionSaveMergeResolutionsRequest,
  VersionSaveMergeResolutionsResult,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import {
  mapPublicExpectedTargetHead,
  mapPublicObjectDigest,
  mapPublicTargetRef,
} from './version-attempt-metadata';
import type { VersionMergePublicOperation } from './version-merge-capability';
import { mergeReviewDiagnostic } from './version-merge-review-artifacts';
import { normalizeVersionApplyMergeResolutions } from './version-merge-resolution-normalization';

const SAVE_MERGE_RESOLUTIONS_KEYS = new Set([
  'resultId',
  'resultDigest',
  'redactionPolicyDigest',
  'targetRef',
  'expectedTargetHead',
  'resolutions',
]);
const GET_MERGE_CONFLICT_DETAIL_KEYS = new Set([
  'resultId',
  'resultDigest',
  'redactionPolicyDigest',
  'conflictId',
  'expectedConflictDigest',
  'valueRole',
  'purpose',
  'pageToken',
  'maxBytes',
  'resolutionSetDigest',
  'resolvedAttemptDigest',
  'optionId',
  'kind',
  'targetRef',
  'expectedTargetHead',
]);
const PUT_MERGE_RESOLUTION_PAYLOAD_KEYS = new Set([
  'resultId',
  'resultDigest',
  'redactionPolicyDigest',
  'conflictId',
  'expectedConflictDigest',
  'optionId',
  'kind',
  'domainPayloadSchema',
  'targetRef',
  'expectedTargetHead',
  'value',
  'purpose',
]);
const CONFLICT_DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
export type NormalizedSaveMergeResolutionsInput = {
  readonly resultId: VersionSaveMergeResolutionsRequest['resultId'];
  readonly resultDigest: ObjectDigest;
  readonly redactionPolicyDigest: ObjectDigest;
  readonly targetRef?: VersionMainRefName | VersionRefName;
  readonly expectedTargetHead?: VersionCommitExpectedHead;
  readonly resolutions: readonly VersionApplyMergeResolution[];
};

export type NormalizedGetMergeConflictDetailInput = {
  readonly resultId: VersionGetMergeConflictDetailRequest['resultId'];
  readonly resultDigest: ObjectDigest;
  readonly redactionPolicyDigest: ObjectDigest;
  readonly conflictId: string;
  readonly expectedConflictDigest: string;
  readonly valueRole: VersionMergeConflictValueRole;
  readonly purpose: VersionMergeConflictDetailPurpose;
  readonly maxBytes?: number;
  readonly resolutionSetDigest?: ObjectDigest;
  readonly resolvedAttemptDigest?: ObjectDigest;
  readonly optionId?: string;
  readonly kind?: VersionMergeConflictResolutionOptionKind;
  readonly targetRef?: VersionMainRefName | VersionRefName;
  readonly expectedTargetHead?: VersionCommitExpectedHead;
};

export type NormalizedPutMergeResolutionPayloadInput = {
  readonly resultId: VersionPutMergeResolutionPayloadRequest['resultId'];
  readonly resultDigest: ObjectDigest;
  readonly redactionPolicyDigest: ObjectDigest;
  readonly conflictId: string;
  readonly expectedConflictDigest: string;
  readonly optionId: string;
  readonly kind: VersionMergeConflictResolutionOptionKind;
  readonly domainPayloadSchema?: string;
  readonly targetRef: VersionMainRefName | VersionRefName;
  readonly expectedTargetHead: VersionCommitExpectedHead;
  readonly value: JsonValue;
  readonly purpose: VersionMergeResolutionPayloadPurpose;
};

type ResolutionValidationResult =
  | {
      readonly ok: true;
      readonly status: VersionSaveMergeResolutionsResult['status'];
    }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] };

export function normalizeSaveMergeResolutionsInput(
  input: VersionSaveMergeResolutionsRequest,
):
  | { readonly ok: true; readonly input: NormalizedSaveMergeResolutionsInput }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] } {
  const operation = 'saveMergeResolutions';
  const diagnostics: VersionStoreDiagnostic[] = [];
  if (!isRecord(input) || Array.isArray(input)) {
    diagnostics.push(invalidInputDiagnostic(operation, 'input', 'input must be an object.'));
    return { ok: false, diagnostics };
  }
  rejectUnknownKeys(operation, input, SAVE_MERGE_RESOLUTIONS_KEYS, diagnostics);

  const resultId = mapMergeResultId(input.resultId);
  if (!resultId)
    diagnostics.push(invalidInputDiagnostic(operation, 'resultId', 'resultId is invalid.'));
  const resultDigest = mapPublicObjectDigest(input.resultDigest);
  if (!resultDigest) {
    diagnostics.push(
      invalidInputDiagnostic(
        operation,
        'resultDigest',
        'resultDigest is required and must be valid.',
      ),
    );
  }
  const redactionPolicyDigest = mapPublicObjectDigest(input.redactionPolicyDigest);
  if (!redactionPolicyDigest) {
    diagnostics.push(
      invalidInputDiagnostic(
        operation,
        'redactionPolicyDigest',
        'redactionPolicyDigest is required and must be valid.',
      ),
    );
  }
  const targetRef = input.targetRef === undefined ? undefined : mapPublicTargetRef(input.targetRef);
  if (input.targetRef !== undefined && !targetRef) {
    diagnostics.push(invalidInputDiagnostic(operation, 'targetRef', 'targetRef is invalid.'));
  }
  const expectedTargetHead =
    input.expectedTargetHead === undefined
      ? undefined
      : mapPublicExpectedTargetHead(input.expectedTargetHead);
  if (input.expectedTargetHead !== undefined && !expectedTargetHead) {
    diagnostics.push(
      invalidInputDiagnostic(operation, 'expectedTargetHead', 'expectedTargetHead is invalid.'),
    );
  }
  if ((targetRef && !expectedTargetHead) || (!targetRef && expectedTargetHead)) {
    diagnostics.push(
      invalidInputDiagnostic(
        operation,
        'targetRef',
        'targetRef and expectedTargetHead must be supplied together.',
      ),
    );
  }
  const resolutions = normalizeResolutions(operation, input.resolutions, diagnostics);

  return resultId &&
    resultDigest &&
    redactionPolicyDigest &&
    resolutions &&
    diagnostics.length === 0
    ? {
        ok: true,
        input: {
          resultId,
          resultDigest,
          redactionPolicyDigest,
          ...(targetRef ? { targetRef } : {}),
          ...(expectedTargetHead ? { expectedTargetHead } : {}),
          resolutions,
        },
      }
    : { ok: false, diagnostics };
}

export function normalizeGetMergeConflictDetailInput(
  input: VersionGetMergeConflictDetailRequest,
):
  | { readonly ok: true; readonly input: NormalizedGetMergeConflictDetailInput }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] } {
  const operation = 'getMergeConflictDetail';
  const diagnostics: VersionStoreDiagnostic[] = [];
  if (!isRecord(input) || Array.isArray(input)) {
    diagnostics.push(invalidInputDiagnostic(operation, 'input', 'input must be an object.'));
    return { ok: false, diagnostics };
  }
  rejectUnknownKeys(operation, input, GET_MERGE_CONFLICT_DETAIL_KEYS, diagnostics);

  const resultId = mapMergeResultId(input.resultId);
  const resultDigest = mapPublicObjectDigest(input.resultDigest);
  const redactionPolicyDigest = mapPublicObjectDigest(input.redactionPolicyDigest);
  const conflictId = mapNonEmptyString(input.conflictId);
  const expectedConflictDigest = mapConflictDigest(input.expectedConflictDigest);
  const valueRole = mapValueRole(input.valueRole);
  const purpose = mapDetailPurpose(input.purpose);
  if (!resultId)
    diagnostics.push(invalidInputDiagnostic(operation, 'resultId', 'resultId is invalid.'));
  if (!resultDigest) {
    diagnostics.push(
      invalidInputDiagnostic(
        operation,
        'resultDigest',
        'resultDigest is required and must be valid.',
      ),
    );
  }
  if (!redactionPolicyDigest) {
    diagnostics.push(
      invalidInputDiagnostic(
        operation,
        'redactionPolicyDigest',
        'redactionPolicyDigest is required and must be valid.',
      ),
    );
  }
  if (!conflictId)
    diagnostics.push(invalidInputDiagnostic(operation, 'conflictId', 'conflictId is invalid.'));
  if (!expectedConflictDigest) {
    diagnostics.push(
      invalidInputDiagnostic(
        operation,
        'expectedConflictDigest',
        'expectedConflictDigest is invalid.',
      ),
    );
  }
  if (!valueRole)
    diagnostics.push(invalidInputDiagnostic(operation, 'valueRole', 'valueRole is invalid.'));
  if (!purpose)
    diagnostics.push(invalidInputDiagnostic(operation, 'purpose', 'purpose is invalid.'));
  if (input.pageToken !== undefined) {
    diagnostics.push(
      mergeReviewDiagnostic(
        operation,
        'VERSION_UNSUPPORTED_PAGE_TOKEN',
        'paged merge conflict detail values are not available.',
        { payload: { option: 'pageToken' } },
      ),
    );
  }
  const maxBytes = normalizeMaxBytes(operation, input.maxBytes, diagnostics);
  const resolutionSetDigest =
    input.resolutionSetDigest === undefined
      ? undefined
      : mapPublicObjectDigest(input.resolutionSetDigest);
  if (input.resolutionSetDigest !== undefined && !resolutionSetDigest) {
    diagnostics.push(
      invalidInputDiagnostic(operation, 'resolutionSetDigest', 'resolutionSetDigest is invalid.'),
    );
  }
  const resolvedAttemptDigest =
    input.resolvedAttemptDigest === undefined
      ? undefined
      : mapPublicObjectDigest(input.resolvedAttemptDigest);
  if (input.resolvedAttemptDigest !== undefined && !resolvedAttemptDigest) {
    diagnostics.push(
      invalidInputDiagnostic(
        operation,
        'resolvedAttemptDigest',
        'resolvedAttemptDigest is invalid.',
      ),
    );
  }
  const optionId = input.optionId === undefined ? undefined : mapNonEmptyString(input.optionId);
  if (input.optionId !== undefined && !optionId) {
    diagnostics.push(invalidInputDiagnostic(operation, 'optionId', 'optionId is invalid.'));
  }
  const kind = input.kind === undefined ? undefined : mapResolutionKind(input.kind);
  if (input.kind !== undefined && !kind) {
    diagnostics.push(invalidInputDiagnostic(operation, 'kind', 'resolution kind is invalid.'));
  }
  const targetRef = input.targetRef === undefined ? undefined : mapPublicTargetRef(input.targetRef);
  if (input.targetRef !== undefined && !targetRef) {
    diagnostics.push(invalidInputDiagnostic(operation, 'targetRef', 'targetRef is invalid.'));
  }
  const expectedTargetHead =
    input.expectedTargetHead === undefined
      ? undefined
      : mapPublicExpectedTargetHead(input.expectedTargetHead);
  if (input.expectedTargetHead !== undefined && !expectedTargetHead) {
    diagnostics.push(
      invalidInputDiagnostic(operation, 'expectedTargetHead', 'expectedTargetHead is invalid.'),
    );
  }
  if ((targetRef && !expectedTargetHead) || (!targetRef && expectedTargetHead)) {
    diagnostics.push(
      invalidInputDiagnostic(
        operation,
        'targetRef',
        'targetRef and expectedTargetHead must be supplied together.',
      ),
    );
  }

  return resultId &&
    resultDigest &&
    redactionPolicyDigest &&
    conflictId &&
    expectedConflictDigest &&
    valueRole &&
    purpose &&
    diagnostics.length === 0
    ? {
        ok: true,
        input: {
          resultId,
          resultDigest,
          redactionPolicyDigest,
          conflictId,
          expectedConflictDigest,
          valueRole,
          purpose,
          ...(maxBytes === undefined ? {} : { maxBytes }),
          ...(resolutionSetDigest ? { resolutionSetDigest } : {}),
          ...(resolvedAttemptDigest ? { resolvedAttemptDigest } : {}),
          ...(optionId ? { optionId } : {}),
          ...(kind ? { kind } : {}),
          ...(targetRef ? { targetRef } : {}),
          ...(expectedTargetHead ? { expectedTargetHead } : {}),
        },
      }
    : { ok: false, diagnostics };
}

export function normalizePutMergeResolutionPayloadInput(
  input: VersionPutMergeResolutionPayloadRequest,
):
  | { readonly ok: true; readonly input: NormalizedPutMergeResolutionPayloadInput }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] } {
  const operation = 'putMergeResolutionPayload';
  const diagnostics: VersionStoreDiagnostic[] = [];
  if (!isRecord(input) || Array.isArray(input)) {
    diagnostics.push(invalidInputDiagnostic(operation, 'input', 'input must be an object.'));
    return { ok: false, diagnostics };
  }
  rejectUnknownKeys(operation, input, PUT_MERGE_RESOLUTION_PAYLOAD_KEYS, diagnostics);

  const resultId = mapMergeResultId(input.resultId);
  const resultDigest = mapPublicObjectDigest(input.resultDigest);
  const redactionPolicyDigest = mapPublicObjectDigest(input.redactionPolicyDigest);
  const expectedConflictDigest = mapConflictDigest(input.expectedConflictDigest);
  const conflictId = mapNonEmptyString(input.conflictId);
  const optionId = mapNonEmptyString(input.optionId);
  const kind = mapResolutionKind(input.kind);
  const targetRef = mapPublicTargetRef(input.targetRef);
  const expectedTargetHead = mapPublicExpectedTargetHead(input.expectedTargetHead);
  const value = isJsonValue(input.value) ? cloneJson(input.value) : null;
  const purpose = mapPayloadPurpose(input.purpose);
  const domainPayloadSchema =
    input.domainPayloadSchema === undefined
      ? undefined
      : mapNonEmptyString(input.domainPayloadSchema);

  if (!resultId)
    diagnostics.push(invalidInputDiagnostic(operation, 'resultId', 'resultId is invalid.'));
  if (!resultDigest) {
    diagnostics.push(
      invalidInputDiagnostic(
        operation,
        'resultDigest',
        'resultDigest is required and must be valid.',
      ),
    );
  }
  if (!redactionPolicyDigest) {
    diagnostics.push(
      invalidInputDiagnostic(
        operation,
        'redactionPolicyDigest',
        'redactionPolicyDigest is required and must be valid.',
      ),
    );
  }
  if (!expectedConflictDigest) {
    diagnostics.push(
      invalidInputDiagnostic(
        operation,
        'expectedConflictDigest',
        'expectedConflictDigest is invalid.',
      ),
    );
  }
  if (!conflictId)
    diagnostics.push(invalidInputDiagnostic(operation, 'conflictId', 'conflictId is invalid.'));
  if (!optionId)
    diagnostics.push(invalidInputDiagnostic(operation, 'optionId', 'optionId is invalid.'));
  if (!kind)
    diagnostics.push(invalidInputDiagnostic(operation, 'kind', 'resolution kind is invalid.'));
  if (input.domainPayloadSchema !== undefined && !domainPayloadSchema) {
    diagnostics.push(
      invalidInputDiagnostic(operation, 'domainPayloadSchema', 'domainPayloadSchema is invalid.'),
    );
  }
  if (!targetRef)
    diagnostics.push(invalidInputDiagnostic(operation, 'targetRef', 'targetRef is invalid.'));
  if (!expectedTargetHead) {
    diagnostics.push(
      invalidInputDiagnostic(operation, 'expectedTargetHead', 'expectedTargetHead is invalid.'),
    );
  }
  if (value === null && input.value !== null) {
    diagnostics.push(
      invalidInputDiagnostic(operation, 'value', 'value must be JSON-serializable.'),
    );
  }
  if (!purpose)
    diagnostics.push(invalidInputDiagnostic(operation, 'purpose', 'purpose is invalid.'));

  return resultId &&
    resultDigest &&
    redactionPolicyDigest &&
    expectedConflictDigest &&
    conflictId &&
    optionId &&
    kind &&
    targetRef &&
    expectedTargetHead &&
    (value !== null || input.value === null) &&
    purpose &&
    diagnostics.length === 0
    ? {
        ok: true,
        input: {
          resultId,
          resultDigest,
          redactionPolicyDigest,
          conflictId,
          expectedConflictDigest,
          optionId,
          kind,
          ...(domainPayloadSchema ? { domainPayloadSchema } : {}),
          targetRef,
          expectedTargetHead,
          value: value as JsonValue,
          purpose,
        },
      }
    : { ok: false, diagnostics };
}

export function validateOptionalTarget(
  operation: VersionMergePublicOperation,
  ours: VersionCommitExpectedHead['commitId'],
  targetRef: VersionMainRefName | VersionRefName | undefined,
  expectedTargetHead: VersionCommitExpectedHead | undefined,
): readonly VersionStoreDiagnostic[] {
  if (!targetRef && !expectedTargetHead) return [];
  if (!targetRef || !expectedTargetHead) {
    return [
      invalidInputDiagnostic(
        operation,
        'targetRef',
        'targetRef and expectedTargetHead must be supplied together.',
      ),
    ];
  }
  return validateRequiredTarget(operation, ours, targetRef, expectedTargetHead);
}

export function validateRequiredTarget(
  operation: VersionMergePublicOperation,
  ours: VersionCommitExpectedHead['commitId'],
  _targetRef: VersionMainRefName | VersionRefName,
  expectedTargetHead: VersionCommitExpectedHead,
): readonly VersionStoreDiagnostic[] {
  if (expectedTargetHead.commitId === ours) return [];
  return [
    mergeReviewDiagnostic(
      operation,
      'VERSION_MERGE_RESOLUTION_MISMATCH',
      'expectedTargetHead must match the merge preview ours commit.',
    ),
  ];
}

export function validateResolutionsForPreview(
  operation: VersionMergePublicOperation,
  payload: {
    readonly status: 'clean' | 'conflicted';
    readonly conflicts: readonly VersionMergeConflict[];
  },
  resolutions: readonly VersionApplyMergeResolution[],
): ResolutionValidationResult {
  if (payload.status === 'clean') {
    return resolutions.length === 0
      ? { ok: true, status: 'readyToApply' }
      : {
          ok: false,
          diagnostics: [
            mergeReviewDiagnostic(
              operation,
              'VERSION_MERGE_RESOLUTION_MISMATCH',
              'clean merge preview artifacts do not accept resolutions.',
            ),
          ],
        };
  }

  const conflictsById = new Map(
    payload.conflicts.map((conflict) => [conflict.conflictId, conflict]),
  );
  const seen = new Set<string>();
  for (const resolution of resolutions) {
    if (seen.has(resolution.conflictId)) {
      return {
        ok: false,
        diagnostics: [
          mergeReviewDiagnostic(
            operation,
            'VERSION_MERGE_RESOLUTION_MISMATCH',
            'duplicate conflict resolution supplied.',
          ),
        ],
      };
    }
    seen.add(resolution.conflictId);
    const conflict = conflictsById.get(resolution.conflictId);
    if (!conflict || resolution.expectedConflictDigest !== conflict.conflictDigest) {
      return {
        ok: false,
        diagnostics: [
          mergeReviewDiagnostic(
            operation,
            'VERSION_MERGE_RESOLUTION_MISMATCH',
            'resolution does not match the merge conflict.',
          ),
        ],
      };
    }
    if (!findResolutionOption(conflict, resolution.optionId, resolution.kind)) {
      return {
        ok: false,
        diagnostics: [
          mergeReviewDiagnostic(
            operation,
            'VERSION_MERGE_RESOLUTION_MISMATCH',
            'resolution option does not match the conflict.',
          ),
        ],
      };
    }
  }

  if (resolutions.length === 0) return { ok: true, status: 'reviewOnly' };
  return {
    ok: true,
    status: resolutions.length === payload.conflicts.length ? 'readyToApply' : 'partiallyResolved',
  };
}

export function invalidInputDiagnostic(
  operation: VersionMergePublicOperation,
  option: string,
  safeMessage: string,
): VersionStoreDiagnostic {
  return mergeReviewDiagnostic(operation, 'VERSION_INVALID_OPTIONS', safeMessage, {
    payload: { option },
  });
}

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeResolutions(
  operation: VersionMergePublicOperation,
  value: unknown,
  diagnostics: VersionStoreDiagnostic[],
): readonly VersionApplyMergeResolution[] | null {
  const resolutions = normalizeVersionApplyMergeResolutions(value, diagnostics, {
    allowUndefined: false,
    invalidDiagnostic: invalidInputDiagnostic.bind(null, operation),
  });
  if (!resolutions) return null;
  for (let index = 0; index < resolutions.length; index++) {
    if (mapConflictDigest(resolutions[index].expectedConflictDigest)) continue;
    diagnostics.push(
      invalidInputDiagnostic(
        operation,
        `resolutions[${index}].expectedConflictDigest`,
        'expectedConflictDigest is invalid.',
      ),
    );
  }
  return diagnostics.length === 0 ? resolutions : null;
}

function rejectUnknownKeys(
  operation: VersionMergePublicOperation,
  value: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
  diagnostics: VersionStoreDiagnostic[],
  prefix = 'input',
): void {
  for (const key of Object.keys(value)) {
    if (allowed.has(key)) continue;
    diagnostics.push(
      invalidInputDiagnostic(operation, `${prefix}.${key}`, `Unknown field "${key}".`),
    );
  }
}

function normalizeMaxBytes(
  operation: VersionMergePublicOperation,
  value: unknown,
  diagnostics: VersionStoreDiagnostic[],
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    diagnostics.push(
      invalidInputDiagnostic(operation, 'maxBytes', 'maxBytes must be a positive integer.'),
    );
    return undefined;
  }
  return value;
}

function mapMergeResultId(value: unknown): VersionSaveMergeResolutionsRequest['resultId'] | null {
  return typeof value === 'string' &&
    value.startsWith('merge-result:') &&
    value.length > 'merge-result:'.length
    ? (value as VersionSaveMergeResolutionsRequest['resultId'])
    : null;
}

function mapConflictDigest(value: unknown): string | null {
  if (typeof value === 'string') return CONFLICT_DIGEST_RE.test(value) ? value : null;
  const digest = mapPublicObjectDigest(value);
  return digest?.algorithm === 'sha256' ? `sha256:${digest.digest}` : null;
}

function mapValueRole(value: unknown): VersionMergeConflictValueRole | null {
  return value === 'base' || value === 'ours' || value === 'theirs' || value === 'resolved'
    ? value
    : null;
}

function mapDetailPurpose(value: unknown): VersionMergeConflictDetailPurpose | null {
  return value === 'review' || value === 'resolution' ? value : null;
}

function mapPayloadPurpose(value: unknown): VersionMergeResolutionPayloadPurpose | null {
  return value === 'chooseValue' || value === 'custom' ? value : null;
}

function mapResolutionKind(value: unknown): VersionMergeConflictResolutionOptionKind | null {
  return value === 'acceptOurs' || value === 'acceptTheirs' || value === 'acceptBase'
    ? value
    : null;
}

function findResolutionOption(
  conflict: VersionMergeConflict,
  optionId: string,
  kind: VersionMergeConflictResolutionOptionKind,
): VersionMergeConflictResolutionOption | undefined {
  return conflict.resolutionOptions.find(
    (candidate) => candidate.optionId === optionId && candidate.kind === kind,
  );
}

function mapNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function isJsonValue(value: unknown, depth = 0): value is JsonValue {
  if (depth > 32) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item, depth + 1));
  if (!isRecord(value)) return false;
  return Object.values(value).every((item) => isJsonValue(item, depth + 1));
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
