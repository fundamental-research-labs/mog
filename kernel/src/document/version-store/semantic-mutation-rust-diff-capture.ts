import type { VersionNormalCommitCaptureInput } from './commit-service';
import type { VersionStoreFailure } from './provider';
import { missingNormalSemanticChangeSetFailure } from './semantic-mutation-capture-diagnostics';
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
    if (input.reviewChanges.length === 0) {
      return failedSemanticCapture(
        input,
        'Normal version commits require a non-empty semantic change set.',
      );
    }
    return {
      status: 'success',
      payload: { schemaVersion: 1, changes: input.reviewChanges },
    };
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

  try {
    const semanticDiff = await input.semanticStateReader.diffSemanticStates(
      input.beforeSemanticState.state,
      afterSemanticState.state,
    );
    const blockingDiagnosticCount =
      semanticDiff.diagnostics?.filter((diagnostic) => diagnostic.severity === 'error').length ?? 0;
    if (blockingDiagnosticCount > 0) {
      return failedSemanticCapture(
        input,
        'Rust semantic diff reported blocking diagnostics for this mutation range.',
        { blockingDiagnosticCount },
      );
    }
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
