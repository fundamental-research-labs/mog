import type { VersionNormalCommitCaptureInput } from './commit-service';
import type { VersionStoreFailure } from './provider';
import { missingNormalSemanticChangeSetFailure } from './semantic-mutation-capture-diagnostics';
import type { VersionSemanticStateReaderPort } from './semantic-state-reader';
import type { SemanticWorkbookStateEnvelope } from '../../bridges/compute/compute-types.gen';

const REVIEW_PROJECTION_SEMANTIC_DIFF_BYPASS_MIN_CHANGE_COUNT = 10_000;

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

  if (canUseReviewProjectionOnlyPayload(input.reviewChanges)) {
    if (sameDigest(input.beforeSemanticState.stateDigest, afterSemanticState.stateDigest)) {
      return failedSemanticCapture(
        input,
        'Normal version commits require a semantic state change.',
      );
    }
    return {
      status: 'success',
      payload: {
        schemaVersion: 1,
        source: {
          kind: 'rustSemanticStateReviewProjection',
          beforeStateDigest: input.beforeSemanticState.stateDigest,
          afterStateDigest: afterSemanticState.stateDigest,
          reviewProjectionChangeCount: input.reviewChanges.length,
        },
        changes: [],
        semanticDiff: {
          beforeDigest: input.beforeSemanticState.stateDigest,
          afterDigest: afterSemanticState.stateDigest,
          changes: [],
        },
        reviewChanges: input.reviewChanges,
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
        reviewChanges: input.reviewChanges,
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
  return {
    status: 'success',
    payload: {
      schemaVersion: 1,
      source: {
        kind: 'semanticMutationProjection',
        reviewProjectionChangeCount: reviewChanges.length,
      },
      changes: [],
      reviewChanges,
    },
  };
}

export function canUseReviewProjectionOnlyPayload(reviewChanges: readonly unknown[]): boolean {
  return (
    reviewChanges.length >= REVIEW_PROJECTION_SEMANTIC_DIFF_BYPASS_MIN_CHANGE_COUNT &&
    reviewChanges.every(isPlainCellValueReviewChange)
  );
}

function isPlainCellValueReviewChange(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const structural = value.structural;
  if (!isRecord(structural)) return false;
  if (structural.kind !== 'metadata' || structural.domain !== 'cell') return false;
  if (!Array.isArray(structural.propertyPath)) return false;
  if (structural.propertyPath.length !== 1 || structural.propertyPath[0] !== 'value') {
    return false;
  }
  return isPlainCellValueEndpoint(value.before) && isPlainCellValueEndpoint(value.after);
}

function isPlainCellValueEndpoint(value: unknown): boolean {
  if (!isRecord(value) || value.kind !== 'value') return false;
  return isPlainCellReviewValue(value.value);
}

function isPlainCellReviewValue(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  return isRecord(value) && value.kind === 'blank' && Object.keys(value).length === 1;
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
