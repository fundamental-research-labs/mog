import type { VersionMergeConflict, VersionStoreDiagnostic } from '@mog-sdk/contracts/api';

import type { VersionGraphStore } from '../../../../document/version-store/provider-graph-store';
import { mergeReviewDiagnostic } from './version-merge-review-artifacts';
import {
  type NormalizedMergeReviewConflictSet,
  validateResolutionsForConflictSet,
} from './version-merge-review-conflicts';
import type { NormalizedGetMergeConflictDetailInput } from './version-merge-review-normalization';
import {
  readResolutionSetArtifact,
  readResolvedMergeAttemptArtifact,
} from './version-merge-review-saved-resolution-artifacts';
import {
  validateResolutionSetBinding,
  validateResolvedAttemptBinding,
} from './version-merge-review-saved-resolution-binding';
import { validateSavedResolutionPayloadRefs } from './version-merge-review-saved-resolution-payload-refs';
import type { SavedResolutionPayloadTarget } from './version-merge-review-saved-resolution-types';
import { digestsEqual } from './version-merge-review-saved-resolution-utils';

type ConflictDetailSelectionInput = Pick<
  NormalizedGetMergeConflictDetailInput,
  'valueRole' | 'purpose' | 'optionId' | 'kind'
>;

type SavedConflictDetailSelectionResult =
  | { readonly ok: true; readonly selection: ConflictDetailSelectionInput }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] };

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
    if (!input.targetRef || !input.expectedTargetHead) {
      return {
        ok: false,
        diagnostics: [
          mergeReviewDiagnostic(
            operation,
            'VERSION_MERGE_RESOLUTION_MISMATCH',
            'resolved merge attempt detail requires targetRef and expectedTargetHead.',
          ),
        ],
      };
    }
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
        purpose: input.purpose,
        ...(input.optionId ? { optionId: input.optionId } : {}),
        ...(input.kind ? { kind: input.kind } : {}),
      },
    };
  }

  const resolutionSet = await readResolutionSetArtifact(graph, operation, resolutionSetDigest);
  if (!resolutionSet.ok) return resolutionSet;

  const resolutionSetDiagnostics = validateResolutionSetBinding(
    operation,
    input,
    resolutionSet.payload,
    resolutionSet.record,
  );
  if (resolutionSetDiagnostics.length > 0) {
    return { ok: false, diagnostics: resolutionSetDiagnostics };
  }

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

  if (input.valueRole !== 'resolved') {
    return {
      ok: true,
      selection: {
        valueRole: input.valueRole,
        purpose: input.purpose,
        ...(input.optionId ? { optionId: input.optionId } : {}),
        ...(input.kind ? { kind: input.kind } : {}),
      },
    };
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
      purpose: input.purpose,
      optionId: resolution.optionId,
      kind: resolution.kind,
    },
  };
}
