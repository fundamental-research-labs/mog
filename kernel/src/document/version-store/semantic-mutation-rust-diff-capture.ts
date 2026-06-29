import type { VersionNormalCommitCaptureInput } from './commit-service';
import type { VersionStoreFailure } from './provider';
import { missingNormalSemanticChangeSetFailure } from './semantic-mutation-capture-diagnostics';
import {
  COMPACT_CELL_VALUE_REVIEW_PROJECTION_MIN_CHANGE_COUNT,
  compactPlainCellValueReviewChanges,
  reviewChangesWithSheetDisplayNames,
  type CompactCellValueReviewProjection,
} from './semantic-review-projection';
import type { VersionSemanticStateReaderPort } from './semantic-state-reader';
import type { SemanticWorkbookStateEnvelope } from '../../bridges/compute/compute-types.gen';

export async function buildRustBackedSemanticChangeSetPayload(input: {
  readonly commit: VersionNormalCommitCaptureInput;
  readonly semanticStateReader?: VersionSemanticStateReaderPort;
  readonly beforeSemanticState?: SemanticWorkbookStateEnvelope;
  readonly semanticStateCaptureFailure?: string;
  readonly reviewChanges: readonly unknown[];
}): Promise<{ readonly status: 'success'; readonly payload: unknown } | VersionStoreFailure> {
  if (!input.semanticStateReader) {
    return failedSemanticCapture(
      input,
      'Normal version commits require a Rust semantic state reader.',
    );
  }

  if (input.semanticStateCaptureFailure) {
    return failedSemanticCapture(input, input.semanticStateCaptureFailure);
  }
  if (!input.beforeSemanticState) {
    return failedSemanticCapture(
      input,
      'Rust semantic before-state was not captured before the pending mutation range.',
    );
  }

  let afterSemanticState: SemanticWorkbookStateEnvelope;
  try {
    afterSemanticState = await input.semanticStateReader.readCurrentSemanticState();
  } catch (error) {
    return failedSemanticCapture(
      input,
      error instanceof Error ? error.message : 'Rust semantic after-state read failed.',
    );
  }

  const reviewChanges = reviewChangesWithSheetDisplayNames({
    reviewChanges: input.reviewChanges,
    beforeState: input.beforeSemanticState.state,
    afterState: afterSemanticState.state,
  });

  if (canUseReviewProjectionOnlyPayload(reviewChanges)) {
    if (sameDigest(input.beforeSemanticState.stateDigest, afterSemanticState.stateDigest)) {
      return failedSemanticCapture(
        input,
        'Normal version commits require a semantic state change.',
      );
    }
    const compactReviewProjection = compactPlainCellValueReviewChanges(reviewChanges);
    return {
      status: 'success',
      payload: {
        schemaVersion: 1,
        source: {
          kind: 'rustSemanticStateReviewProjection',
          beforeStateDigest: input.beforeSemanticState.stateDigest,
          afterStateDigest: afterSemanticState.stateDigest,
          reviewProjectionChangeCount: reviewChanges.length,
        },
        changes: [],
        semanticDiff: {
          beforeDigest: input.beforeSemanticState.stateDigest,
          afterDigest: afterSemanticState.stateDigest,
          changes: [],
        },
        ...(compactReviewProjection
          ? { compactReviewProjection }
          : { reviewChanges }),
      },
    };
  }

  try {
    const semanticDiff = await input.semanticStateReader.diffSemanticStates(
      input.beforeSemanticState.state,
      afterSemanticState.state,
    );
    if (semanticDiff.changes.length === 0) {
      return failedSemanticCapture(
        input,
        'Normal version commits require a non-empty Rust semantic diff.',
      );
    }

    return {
      status: 'success',
      payload: {
        schemaVersion: 1,
        source: {
          kind: 'rustSemanticDiff',
          beforeStateDigest: semanticDiff.beforeDigest,
          afterStateDigest: semanticDiff.afterDigest,
        },
        changes: semanticDiff.changes,
        semanticDiff,
        reviewChanges,
      },
    };
  } catch (error) {
    return failedSemanticCapture(
      input,
      error instanceof Error ? error.message : 'Rust semantic diff failed.',
    );
  }
}

export function buildReviewProjectionOnlySemanticChangeSetPayload(
  reviewChanges: readonly unknown[],
): { readonly status: 'success'; readonly payload: unknown } {
  const compactReviewProjection = compactPlainCellValueReviewChanges(reviewChanges);
  return {
    status: 'success',
    payload: {
      schemaVersion: 1,
      source: {
        kind: 'semanticMutationProjection',
        reviewProjectionChangeCount: reviewChanges.length,
      },
      changes: [],
      ...(compactReviewProjection
        ? { compactReviewProjection }
        : { reviewChanges }),
    },
  };
}

export function buildCompactReviewProjectionOnlySemanticChangeSetPayload(
  compactReviewProjection: CompactCellValueReviewProjection,
): { readonly status: 'success'; readonly payload: unknown } {
  return {
    status: 'success',
    payload: {
      schemaVersion: 1,
      source: {
        kind: 'semanticMutationProjection',
        reviewProjectionChangeCount: compactReviewProjection.changeCount,
      },
      changes: [],
      compactReviewProjection,
    },
  };
}

export function canUseReviewProjectionOnlyPayload(reviewChanges: readonly unknown[]): boolean {
  return (
    reviewChanges.length >= COMPACT_CELL_VALUE_REVIEW_PROJECTION_MIN_CHANGE_COUNT &&
    compactPlainCellValueReviewChanges(reviewChanges) !== null
  );
}

function sameDigest(left: unknown, right: unknown): boolean {
  return (
    isRecord(left) &&
    isRecord(right) &&
    left.algorithm === 'sha256' &&
    right.algorithm === 'sha256' &&
    typeof left.digest === 'string' &&
    left.digest === right.digest
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function failedSemanticCapture(
  input: {
    readonly commit: VersionNormalCommitCaptureInput;
  },
  reason: string,
  details: Readonly<Record<string, string | number | boolean | null>> = {},
): VersionStoreFailure {
  return missingNormalSemanticChangeSetFailure({
    commit: input.commit,
    safeMessage: reason,
    details,
  });
}
