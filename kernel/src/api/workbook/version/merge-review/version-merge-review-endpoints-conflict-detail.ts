import type {
  VersionGetMergeConflictDetailRequest,
  VersionMergeConflictDetailResult,
  VersionResult,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../../../context';
import {
  findExpectedConflict,
  normalizeMergeReviewConflicts,
  projectResolutionOptions,
  projectReviewValue,
  selectConflictDetailValue,
} from './version-merge-review-conflicts';
import {
  mergeReviewDiagnostic,
  openMergeReviewGraph,
  validateMergePreviewIdentity,
} from './version-merge-review-artifacts';
import {
  normalizeGetMergeConflictDetailInput,
  validateOptionalTarget,
} from './version-merge-review-normalization';
import {
  mergeEndpointFailure,
  mergeEndpointPreflight,
  readMergePreviewArtifact,
} from './version-merge-review-endpoints-shared';
import { resolveSavedConflictDetailSelection } from './version-merge-review-saved-resolution';

export async function getMergeConflictDetailWorkbookVersion(
  ctx: DocumentContext,
  input: VersionGetMergeConflictDetailRequest,
): Promise<VersionResult<VersionMergeConflictDetailResult>> {
  const preflight = mergeEndpointPreflight<VersionMergeConflictDetailResult>(
    ctx,
    'getMergeConflictDetail',
  );
  if (preflight) return preflight;

  const normalized = normalizeGetMergeConflictDetailInput(input);
  if (!normalized.ok) return mergeEndpointFailure('getMergeConflictDetail', normalized.diagnostics);

  const identityDiagnostics = validateMergePreviewIdentity(
    'getMergeConflictDetail',
    normalized.input.resultId,
    normalized.input.resultDigest,
  );
  if (identityDiagnostics.length > 0) {
    return mergeEndpointFailure('getMergeConflictDetail', identityDiagnostics);
  }

  const opened = await openMergeReviewGraph(ctx, 'getMergeConflictDetail');
  if (!opened.ok) return mergeEndpointFailure('getMergeConflictDetail', opened.diagnostics);

  const artifact = await readMergePreviewArtifact(
    opened.graph,
    'getMergeConflictDetail',
    normalized.input.resultDigest,
  );
  if (!artifact.ok) return mergeEndpointFailure('getMergeConflictDetail', artifact.diagnostics);

  const targetDiagnostics = validateOptionalTarget(
    'getMergeConflictDetail',
    artifact.payload.ours,
    normalized.input.targetRef,
    normalized.input.expectedTargetHead,
  );
  if (targetDiagnostics.length > 0) {
    return mergeEndpointFailure('getMergeConflictDetail', targetDiagnostics);
  }

  if (artifact.payload.status !== 'clean' && artifact.payload.status !== 'conflicted') {
    return mergeEndpointFailure('getMergeConflictDetail', [
      mergeReviewDiagnostic(
        'getMergeConflictDetail',
        'VERSION_MERGE_RESOLUTION_MISMATCH',
        'ancestry merge preview artifacts do not expose conflict detail.',
      ),
    ]);
  }

  const conflictSet = await normalizeMergeReviewConflicts(
    'getMergeConflictDetail',
    artifact.payload.conflicts,
  );
  if (!conflictSet.ok) {
    return mergeEndpointFailure('getMergeConflictDetail', conflictSet.diagnostics);
  }

  const conflict = findExpectedConflict(
    'getMergeConflictDetail',
    conflictSet.conflictSet,
    normalized.input.conflictId,
    normalized.input.expectedConflictDigest,
  );
  if (!conflict.ok) return mergeEndpointFailure('getMergeConflictDetail', conflict.diagnostics);

  const savedSelection = await resolveSavedConflictDetailSelection(
    opened.graph,
    'getMergeConflictDetail',
    normalized.input,
    conflictSet.conflictSet,
    conflict.conflict,
  );
  if (!savedSelection.ok) {
    return mergeEndpointFailure('getMergeConflictDetail', savedSelection.diagnostics);
  }

  const selected = selectConflictDetailValue(
    'getMergeConflictDetail',
    conflictSet.conflictSet,
    conflict.conflict,
    savedSelection.selection,
  );
  if (!selected.ok) return mergeEndpointFailure('getMergeConflictDetail', selected.diagnostics);

  const value = projectReviewValue(
    'getMergeConflictDetail',
    conflict.conflict.structural,
    selected.value,
  );
  if (!value.ok) return mergeEndpointFailure('getMergeConflictDetail', value.diagnostics);

  const resolutionOptions = projectResolutionOptions('getMergeConflictDetail', conflict.conflict);
  if (!resolutionOptions.ok) {
    return mergeEndpointFailure('getMergeConflictDetail', resolutionOptions.diagnostics);
  }

  const resultBase = {
    schemaVersion: 1 as const,
    conflictId: conflict.conflict.conflictId,
    conflictDigest: conflict.conflict.conflictDigest,
    valueRole: savedSelection.selection.valueRole,
    purpose: normalized.input.purpose,
    resolutionOptions: resolutionOptions.options,
    value: value.value,
  };
  return {
    ok: true,
    value:
      normalized.input.purpose === 'review'
        ? { ...resultBase, kind: 'reviewValue' }
        : { ...resultBase, kind: 'resolutionPayload' },
  };
}
