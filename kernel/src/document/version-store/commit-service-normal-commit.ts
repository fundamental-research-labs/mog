import type {
  VersionAnnotationText,
  VersionCommitOptions,
  WorkbookCommitAnnotationSummary,
} from '@mog-sdk/contracts/api';

import { VERSION_GRAPH_HEAD_REF, VERSION_GRAPH_MAIN_REF } from './graph';
import {
  diagnosticsForGraphRead,
  isRetryableGraphWriteFailure,
  mapCommitGraphDiagnostics,
} from './commit-service-diagnostics';
import { expectedHeadForCommit } from './commit-service-merge-helpers';
import { normalizeCommitOptions, normalizeCommitTargetRef } from './commit-service-options';
import { openVisibleVersionGraph } from './commit-service-open-graph';
import { materializeSnapshotRootForNormalCommit } from './commit-service-snapshot-materialization';
import type {
  VersionNormalCommitCapture,
  VersionNormalCommitCaptureFinalizeResult,
  VersionNormalCommitCaptureResult,
  VersionNormalCommitCaptureSuccess,
  WorkbookVersionCommitServiceCommitResult,
} from './commit-service-types';
import { failedStoreResult, versionStoreDiagnostic, type VersionStoreProvider } from './provider';
import type { SnapshotRootByteSyncPort } from './snapshot-root-capture';

export type WorkbookVersionCommitServiceNormalCommitContext = {
  readonly provider: VersionStoreProvider;
  readonly captureNormalCommit?: VersionNormalCommitCapture;
  readonly snapshotRootByteSyncPort?: SnapshotRootByteSyncPort;
};

export async function commitWorkbookVersion(
  context: WorkbookVersionCommitServiceNormalCommitContext,
  options: VersionCommitOptions = {},
): Promise<WorkbookVersionCommitServiceCommitResult> {
  const { provider } = context;
  const normalizedOptions = normalizeCommitOptions(options, provider);
  if (!normalizedOptions.ok) {
    return failedStoreResult(normalizedOptions.diagnostics, 'no-write-attempted');
  }
  const commitOptionsInput = normalizedOptions.options;

  if (!provider.capabilities.reads.graphRegistry) {
    return failedStoreResult(
      [
        versionStoreDiagnostic('VERSION_STORE_UNAVAILABLE', {
          operation: 'commitGraphWrite',
          documentScope: provider.documentScope,
          safeMessage: 'Version graph registry reads are unavailable for this document.',
          recoverability: 'retry',
          mutationGuarantee: 'no-write-attempted',
        }),
      ],
      'no-write-attempted',
      true,
    );
  }

  if (!provider.capabilities.writes.commitGraphWrite) {
    return failedStoreResult(
      [
        versionStoreDiagnostic('VERSION_STORE_READ_ONLY', {
          operation: 'commitGraphWrite',
          documentScope: provider.documentScope,
          safeMessage: 'Version graph writes are disabled for this document.',
          mutationGuarantee: 'no-write-attempted',
        }),
      ],
      'no-write-attempted',
    );
  }

  const opened = await openVisibleVersionGraph(provider, 'commitGraphWrite');
  if (!opened.ok) {
    return failedStoreResult(opened.diagnostics, 'no-write-attempted', opened.retryable);
  }

  const head = await opened.graph.readRef(VERSION_GRAPH_HEAD_REF);
  if (head.status !== 'success' || head.ref.name !== VERSION_GRAPH_HEAD_REF) {
    return failedStoreResult(
      diagnosticsForGraphRead(head.diagnostics, 'commitGraphWrite'),
      'no-write-attempted',
    );
  }

  const main = await opened.graph.readRef(VERSION_GRAPH_MAIN_REF);
  if (main.status !== 'success' || main.ref.name !== VERSION_GRAPH_MAIN_REF) {
    return failedStoreResult(
      diagnosticsForGraphRead(main.diagnostics, 'commitGraphWrite'),
      'no-write-attempted',
    );
  }

  const normalizedTarget = normalizeCommitTargetRef(commitOptionsInput, provider);
  if (!normalizedTarget.ok) {
    return failedStoreResult(normalizedTarget.diagnostics, 'no-write-attempted');
  }

  const targetRefName = normalizedTarget.refName;
  const commitOptions = normalizedTarget.options;
  const target =
    targetRefName === VERSION_GRAPH_MAIN_REF ? main : await opened.graph.readRef(targetRefName);
  if (target.status !== 'success' || target.ref.name === VERSION_GRAPH_HEAD_REF) {
    return failedStoreResult(
      diagnosticsForGraphRead(target.diagnostics, 'commitGraphWrite'),
      'no-write-attempted',
    );
  }

  const expectedHead = expectedHeadForCommit(commitOptions, target.ref, head.ref);
  if (!expectedHead.ok) {
    return failedStoreResult(expectedHead.diagnostics, 'no-write-attempted', true);
  }

  if (!context.captureNormalCommit) {
    return failedStoreResult(
      [
        versionStoreDiagnostic('VERSION_MISSING_CHANGE_SET', {
          operation: 'commitGraphWrite',
          documentScope: provider.documentScope,
          namespace: opened.namespace,
          refName: target.ref.name,
          commitId: target.ref.commitId,
          safeMessage:
            'No production mutation capture service is attached for normal version commits.',
          mutationGuarantee: 'no-write-attempted',
        }),
      ],
      'no-write-attempted',
    );
  }

  let captured: VersionNormalCommitCaptureResult;
  try {
    captured = await context.captureNormalCommit({
      provider,
      graph: opened.graph,
      accessContext: provider.accessContext,
      namespace: opened.namespace,
      registry: opened.registry,
      currentHead: head.ref,
      currentMain: main.ref,
      currentRef: target.ref,
      options: commitOptions,
    });
  } catch {
    return failedStoreResult(
      [
        versionStoreDiagnostic('VERSION_PROVIDER_FAILED', {
          operation: 'commitGraphWrite',
          documentScope: provider.documentScope,
          namespace: opened.namespace,
          refName: target.ref.name,
          commitId: target.ref.commitId,
          safeMessage: 'Version commit capture failed before graph mutation.',
          recoverability: 'retry',
          mutationGuarantee: 'no-write-attempted',
        }),
      ],
      'no-write-attempted',
      true,
    );
  }

  if (captured.status !== 'success') {
    return captured;
  }

  if ((captured.input.mutationSegmentRecords?.length ?? 0) === 0) {
    finalizeNormalCommitCapture(captured, {
      status: 'failed',
      diagnostics: [
        versionStoreDiagnostic('VERSION_MISSING_CHANGE_SET', {
          operation: 'commitGraphWrite',
          documentScope: provider.documentScope,
          namespace: opened.namespace,
          refName: target.ref.name,
          commitId: target.ref.commitId,
          safeMessage: 'Normal version commits require a non-empty captured mutation range.',
          mutationGuarantee: 'no-write-attempted',
        }),
      ],
    });
    return failedStoreResult(
      [
        versionStoreDiagnostic('VERSION_MISSING_CHANGE_SET', {
          operation: 'commitGraphWrite',
          documentScope: provider.documentScope,
          namespace: opened.namespace,
          refName: target.ref.name,
          commitId: target.ref.commitId,
          safeMessage: 'Normal version commits require a non-empty captured mutation range.',
          mutationGuarantee: 'no-write-attempted',
        }),
      ],
      'no-write-attempted',
    );
  }

  const commitContent = await materializeSnapshotRootForNormalCommit({
    provider,
    namespace: opened.namespace,
    snapshotRootByteSyncPort: context.snapshotRootByteSyncPort,
    captured,
  });
  if (commitContent.status !== 'success') {
    finalizeNormalCommitCapture(captured, {
      status: 'failed',
      diagnostics: commitContent.diagnostics,
    });
    return commitContent;
  }

  const result = await opened.graph.commit({
    ...commitContent.input,
    ...commitAnnotationInput(commitContent.input.annotation, commitOptions),
    targetRef: target.ref.name,
    expectedHeadCommitId: expectedHead.commitId,
    expectedTargetRefVersion: expectedHead.revision,
    parentCommitIds: [expectedHead.commitId],
  });

  if (result.status === 'success') {
    finalizeNormalCommitCapture(captured, {
      status: 'success',
      commitId: result.commit.id,
    });
    return {
      ...result,
      commitRef: {
        id: result.commit.id,
        refName: result.ref.name,
        resolvedFrom:
          commitOptions.targetRef === undefined ? VERSION_GRAPH_HEAD_REF : result.ref.name,
        refRevision: result.ref.revision,
      },
    };
  }
  const diagnostics = mapCommitGraphDiagnostics(result.diagnostics);
  finalizeNormalCommitCapture(captured, { status: 'failed', diagnostics });
  return failedStoreResult(
    diagnostics,
    result.mutationGuarantee,
    isRetryableGraphWriteFailure(result.diagnostics),
  );
}

function commitAnnotationInput(
  existing: WorkbookCommitAnnotationSummary | undefined,
  options: VersionCommitOptions,
): { readonly annotation?: WorkbookCommitAnnotationSummary } {
  const message = options.message;
  if (message === undefined) return existing ? { annotation: existing } : {};
  const text = annotationTextFromMessage(message);
  if (!text) return existing ? { annotation: existing } : {};
  return {
    annotation: {
      ...(existing ?? {}),
      message: text,
    },
  };
}

function annotationTextFromMessage(message: string): VersionAnnotationText | undefined {
  return message.trim().length > 0 ? { kind: 'text', value: message } : undefined;
}

function finalizeNormalCommitCapture(
  captured: VersionNormalCommitCaptureSuccess,
  result: VersionNormalCommitCaptureFinalizeResult,
): void {
  try {
    captured.finalize?.(result);
  } catch {
    // Commit success/failure is authoritative; capture finalization must not
    // mask the graph write result returned to the caller.
  }
}
