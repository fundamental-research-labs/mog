import type {
  ObjectDigest,
  VersionApplyMergeOptions,
  VersionApplyMergeResolution,
  VersionCommitExpectedHead,
  VersionMainRefName,
  VersionMergeResultId,
  VersionRefName,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import {
  intentIdForMergeResultId,
  type MergeApplyIntentRecord,
} from '../../../../document/version-store/merge-apply-intent-store';
import { mapPublicApplyTargetRef } from './target-ref/version-apply-merge-target-ref';
import { mapPublicExpectedTargetHead, mapPublicObjectDigest } from '../../version-attempt-metadata';
import {
  invalidApplyMergeOptionDiagnostic,
  resolutionMismatchDiagnostic,
} from './version-apply-merge-persisted-diagnostics';
import { normalizeVersionApplyMergeResolutions } from '../../version-merge-resolution-normalization';

const VERSION_APPLY_MERGE_PERSISTED_INPUT_KEYS = new Set([
  'resultId',
  'previewArtifactDigest',
  'resultDigest',
  'resolutionSetDigest',
  'resolvedAttemptDigest',
  'resolutions',
]);
const VERSION_APPLY_MERGE_OPTION_KEYS = new Set([
  'mode',
  'targetRef',
  'expectedTargetHead',
  'includeDiagnostics',
  'materializeActiveCheckout',
]);

export type NormalizedPersistedApplyMergeInput = {
  readonly resultId: VersionMergeResultId;
  readonly previewArtifactDigest?: ObjectDigest;
  readonly resultDigest: ObjectDigest;
  readonly resolutionSetDigest?: ObjectDigest;
  readonly resolvedAttemptDigest?: ObjectDigest;
  readonly resolutions: readonly VersionApplyMergeResolution[];
};

export type NormalizedPersistedApplyMergeOptions =
  | {
      readonly mode: 'preview';
    }
  | {
      readonly mode: 'apply';
      readonly targetRef: VersionMainRefName | VersionRefName;
      readonly expectedTargetHead: VersionCommitExpectedHead;
      readonly materializeActiveCheckout?: boolean;
    };

export function normalizePersistedApplyMergeInput(
  input: Readonly<Record<string, unknown>>,
  diagnostics: VersionStoreDiagnostic[],
): NormalizedPersistedApplyMergeInput | null {
  for (const key of Object.keys(input)) {
    if (VERSION_APPLY_MERGE_PERSISTED_INPUT_KEYS.has(key)) continue;
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic(`input.${key}`, `Unknown applyMerge input "${key}".`),
    );
  }

  const resultId =
    typeof input.resultId === 'string' && input.resultId.startsWith('merge-result:')
      ? (input.resultId as VersionMergeResultId)
      : undefined;
  if (!resultId || !intentIdForMergeResultId(resultId)) {
    diagnostics.push(invalidApplyMergeOptionDiagnostic('resultId', 'resultId is invalid.'));
  }

  const resultDigest = mapPublicObjectDigest(input.resultDigest);
  if (!resultDigest) {
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic(
        'resultDigest',
        'resultDigest is required and must be valid.',
      ),
    );
  }

  const previewArtifactDigest =
    input.previewArtifactDigest === undefined
      ? undefined
      : mapPublicObjectDigest(input.previewArtifactDigest);
  if (input.previewArtifactDigest !== undefined && !previewArtifactDigest) {
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic(
        'previewArtifactDigest',
        'previewArtifactDigest is invalid.',
      ),
    );
  }

  const resolutionSetDigest =
    input.resolutionSetDigest === undefined
      ? undefined
      : mapPublicObjectDigest(input.resolutionSetDigest);
  if (input.resolutionSetDigest !== undefined && !resolutionSetDigest) {
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic('resolutionSetDigest', 'resolutionSetDigest is invalid.'),
    );
  }

  const resolvedAttemptDigest =
    input.resolvedAttemptDigest === undefined
      ? undefined
      : mapPublicObjectDigest(input.resolvedAttemptDigest);
  if (input.resolvedAttemptDigest !== undefined && !resolvedAttemptDigest) {
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic(
        'resolvedAttemptDigest',
        'resolvedAttemptDigest is invalid.',
      ),
    );
  }

  const resolutions = normalizePersistedResolutions(input.resolutions, diagnostics);
  return resultId && resultDigest && resolutions
    ? {
        resultId,
        previewArtifactDigest,
        resultDigest,
        resolutionSetDigest,
        resolvedAttemptDigest,
        resolutions,
      }
    : null;
}

export function normalizePersistedApplyMergeOptions(
  input: VersionApplyMergeOptions,
  diagnostics: VersionStoreDiagnostic[],
): NormalizedPersistedApplyMergeOptions | null {
  if (!isRecord(input) || Array.isArray(input)) {
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic('options', 'applyMerge options must be an object.'),
    );
    return null;
  }
  for (const key of Object.keys(input)) {
    if (VERSION_APPLY_MERGE_OPTION_KEYS.has(key)) continue;
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic(`options.${key}`, `Unknown applyMerge option "${key}".`),
    );
  }
  let mode: 'preview' | 'apply' = 'apply';
  if (input.mode === 'preview' || input.mode === 'apply') {
    mode = input.mode;
  } else if (input.mode !== undefined) {
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic('mode', 'applyMerge mode must be "preview" or "apply".'),
    );
  }
  if (input.includeDiagnostics !== undefined && typeof input.includeDiagnostics !== 'boolean') {
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic(
        'includeDiagnostics',
        'includeDiagnostics must be a boolean.',
      ),
    );
  }
  let materializeActiveCheckout: boolean | undefined;
  if (input.materializeActiveCheckout !== undefined) {
    if (typeof input.materializeActiveCheckout !== 'boolean') {
      diagnostics.push(
        invalidApplyMergeOptionDiagnostic(
          'materializeActiveCheckout',
          'materializeActiveCheckout must be a boolean.',
        ),
      );
    } else {
      materializeActiveCheckout = input.materializeActiveCheckout;
    }
  }

  if (mode === 'preview') {
    if (input.targetRef !== undefined) {
      diagnostics.push(
        invalidApplyMergeOptionDiagnostic('targetRef', 'targetRef is valid only in apply mode.'),
      );
    }
    if (input.expectedTargetHead !== undefined) {
      diagnostics.push(
        invalidApplyMergeOptionDiagnostic(
          'expectedTargetHead',
          'expectedTargetHead is valid only in apply mode.',
        ),
      );
    }
    if (materializeActiveCheckout !== undefined) {
      diagnostics.push(
        invalidApplyMergeOptionDiagnostic(
          'materializeActiveCheckout',
          'materializeActiveCheckout is valid only in apply mode.',
        ),
      );
    }
    return diagnostics.length === 0 ? { mode: 'preview' } : null;
  }

  const targetRef = mapPublicApplyTargetRef(input.targetRef);
  const expectedTargetHead = mapPublicExpectedTargetHead(input.expectedTargetHead);
  if (!targetRef) {
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic(
        'targetRef',
        'targetRef must name main or a valid public branch.',
      ),
    );
  }
  if (!expectedTargetHead) {
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic(
        'expectedTargetHead',
        'expectedTargetHead is required in apply mode.',
      ),
    );
  }

  return targetRef && expectedTargetHead
    ? {
        mode: 'apply',
        targetRef,
        expectedTargetHead,
        ...(materializeActiveCheckout === undefined ? {} : { materializeActiveCheckout }),
      }
    : null;
}

export function validatePersistedIntentRecord(
  record: MergeApplyIntentRecord,
  input: NormalizedPersistedApplyMergeInput,
  options: Extract<NormalizedPersistedApplyMergeOptions, { readonly mode: 'apply' }>,
): readonly VersionStoreDiagnostic[] {
  const diagnostics: VersionStoreDiagnostic[] = [];
  if (record.expectedTargetHead.commitId !== record.ours) {
    diagnostics.push(
      resolutionMismatchDiagnostic(
        'persisted merge expectedTargetHead does not match the stored ours commit.',
      ),
    );
  }
  if (!digestsEqual(record.resultDigest, input.resultDigest)) {
    diagnostics.push(
      resolutionMismatchDiagnostic(
        'persisted merge resultDigest does not match the stored attempt.',
      ),
    );
  }
  if (
    input.resolutionSetDigest &&
    !digestsEqual(record.resolutionSetDigest, input.resolutionSetDigest)
  ) {
    diagnostics.push(
      resolutionMismatchDiagnostic(
        'persisted merge resolutionSetDigest does not match the stored attempt.',
      ),
    );
  }
  if (
    input.resolvedAttemptDigest &&
    !digestsEqual(record.resolvedAttemptDigest, input.resolvedAttemptDigest)
  ) {
    diagnostics.push(
      resolutionMismatchDiagnostic(
        'persisted merge resolvedAttemptDigest does not match the stored attempt.',
      ),
    );
  }
  if (record.targetRef !== options.targetRef) {
    diagnostics.push(resolutionMismatchDiagnostic('persisted merge targetRef does not match.'));
  }
  if (!expectedHeadsEqual(record.expectedTargetHead, options.expectedTargetHead)) {
    diagnostics.push(
      resolutionMismatchDiagnostic('persisted merge expectedTargetHead does not match.'),
    );
  }
  return diagnostics;
}

export function digestsEqual(
  left: { readonly algorithm: string; readonly digest: string } | undefined,
  right: { readonly algorithm: string; readonly digest: string } | undefined,
): boolean {
  return left?.algorithm === right?.algorithm && left?.digest === right?.digest;
}

function normalizePersistedResolutions(
  value: unknown,
  diagnostics: VersionStoreDiagnostic[],
): readonly VersionApplyMergeResolution[] | null {
  return normalizeVersionApplyMergeResolutions(value, diagnostics, {
    allowUndefined: true,
    invalidDiagnostic: invalidApplyMergeOptionDiagnostic,
  });
}

function expectedHeadsEqual(
  left: VersionCommitExpectedHead,
  right: VersionCommitExpectedHead,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
