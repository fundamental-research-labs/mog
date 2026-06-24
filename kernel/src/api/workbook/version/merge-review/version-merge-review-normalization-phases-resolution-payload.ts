import type {
  JsonValue,
  ObjectDigest,
  VersionCommitExpectedHead,
  VersionMainRefName,
  VersionMergeConflictResolutionOptionKind,
  VersionMergeResolutionPayloadPurpose,
  VersionPutMergeResolutionPayloadRequest,
  VersionRefName,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import {
  mapPublicExpectedTargetHead,
  mapPublicObjectDigest,
  mapPublicTargetRef,
} from '../../version-attempt-metadata';
import {
  cloneJson,
  invalidInputDiagnostic,
  isJsonValue,
  isRecord,
  mapConflictDigest,
  mapMergeResultId,
  mapNonEmptyString,
  mapPayloadPurpose,
  mapResolutionKind,
  rejectUnknownKeys,
} from './version-merge-review-normalization-helpers';

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
  if (purpose === 'chooseValue' && domainPayloadSchema) {
    diagnostics.push(
      invalidInputDiagnostic(
        operation,
        'domainPayloadSchema',
        'domainPayloadSchema is only valid for custom resolution payloads.',
      ),
    );
  }

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
