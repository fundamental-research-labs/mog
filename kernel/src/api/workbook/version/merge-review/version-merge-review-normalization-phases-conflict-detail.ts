import type {
  ObjectDigest,
  VersionCommitExpectedHead,
  VersionGetMergeConflictDetailRequest,
  VersionMainRefName,
  VersionMergeConflictDetailPurpose,
  VersionMergeConflictResolutionOptionKind,
  VersionMergeConflictValueRole,
  VersionRefName,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import {
  mapPublicExpectedTargetHead,
  mapPublicObjectDigest,
  mapPublicTargetRef,
} from '../../version-attempt-metadata';
import { mergeReviewDiagnostic } from './version-merge-review-artifacts';
import {
  invalidInputDiagnostic,
  isRecord,
  mapConflictDigest,
  mapDetailPurpose,
  mapMergeResultId,
  mapNonEmptyString,
  mapResolutionKind,
  mapValueRole,
  normalizeMaxBytes,
  rejectUnknownKeys,
} from './version-merge-review-normalization-helpers';

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
  const hasSavedResolutionSelection =
    resolutionSetDigest !== undefined || resolvedAttemptDigest !== undefined;
  if (valueRole && valueRole !== 'resolved' && (optionId || kind || hasSavedResolutionSelection)) {
    diagnostics.push(
      invalidInputDiagnostic(
        operation,
        'valueRole',
        'optionId, kind, resolutionSetDigest, and resolvedAttemptDigest are only valid for resolved conflict detail values.',
      ),
    );
  }
  if (valueRole === 'resolved' && !hasSavedResolutionSelection && (!optionId || !kind)) {
    diagnostics.push(
      invalidInputDiagnostic(
        operation,
        'optionId',
        'optionId and kind are required for direct resolved conflict detail values.',
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
