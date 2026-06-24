import type {
  ObjectDigest,
  VersionApplyMergeResolution,
  VersionCommitExpectedHead,
  VersionMainRefName,
  VersionRefName,
  VersionSaveMergeResolutionsRequest,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import {
  mapPublicExpectedTargetHead,
  mapPublicObjectDigest,
  mapPublicTargetRef,
} from '../../version-attempt-metadata';
import {
  invalidInputDiagnostic,
  isRecord,
  mapMergeResultId,
  normalizeResolutions,
  rejectUnknownKeys,
} from './version-merge-review-normalization-helpers';

const SAVE_MERGE_RESOLUTIONS_KEYS = new Set([
  'resultId',
  'resultDigest',
  'redactionPolicyDigest',
  'targetRef',
  'expectedTargetHead',
  'resolutions',
]);

export type NormalizedSaveMergeResolutionsInput = {
  readonly resultId: VersionSaveMergeResolutionsRequest['resultId'];
  readonly resultDigest: ObjectDigest;
  readonly redactionPolicyDigest: ObjectDigest;
  readonly targetRef?: VersionMainRefName | VersionRefName;
  readonly expectedTargetHead?: VersionCommitExpectedHead;
  readonly resolutions: readonly VersionApplyMergeResolution[];
};

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
