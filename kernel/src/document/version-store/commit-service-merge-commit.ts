import { VERSION_GRAPH_HEAD_REF } from './graph';
import {
  diagnosticsForGraphRead,
  isRetryableGraphWriteFailure,
  mapCommitGraphDiagnostics,
} from './commit-service-diagnostics';
import {
  expectedHeadForMergeCommit,
  finalizeMergeCommitCapture,
} from './commit-service-merge-helpers';
import { openVisibleVersionGraph } from './commit-service-open-graph';
import type {
  VersionMergeCommitCapture,
  VersionMergeCommitCaptureResult,
  WorkbookVersionCommitServiceCommitResult,
  WorkbookVersionCommitServiceMergeCommitInput,
} from './commit-service-types';
import { failedStoreResult, versionStoreDiagnostic, type VersionStoreProvider } from './provider';

export type WorkbookVersionCommitServiceMergeCommitContext = {
  readonly provider: VersionStoreProvider;
  readonly captureMergeCommit?: VersionMergeCommitCapture;
};

export async function mergeWorkbookVersionCommit(
  context: WorkbookVersionCommitServiceMergeCommitContext,
  input: WorkbookVersionCommitServiceMergeCommitInput,
): Promise<WorkbookVersionCommitServiceCommitResult> {
  const { provider } = context;
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

  const target = await opened.graph.readRef(input.targetRef);
  if (target.status !== 'success' || target.ref.name === VERSION_GRAPH_HEAD_REF) {
    return failedStoreResult(
      diagnosticsForGraphRead(target.diagnostics, 'commitGraphWrite'),
      'no-write-attempted',
    );
  }

  const expectedHead = expectedHeadForMergeCommit(input, target.ref);
  if (!expectedHead.ok) {
    return failedStoreResult(expectedHead.diagnostics, 'no-write-attempted', true);
  }

  if (!context.captureMergeCommit) {
    return failedStoreResult(
      [
        versionStoreDiagnostic('VERSION_MISSING_CHANGE_SET', {
          operation: 'commitGraphWrite',
          documentScope: provider.documentScope,
          namespace: opened.namespace,
          refName: target.ref.name,
          commitId: target.ref.commitId,
          safeMessage: 'No production merge materialization service is attached for merge commits.',
          mutationGuarantee: 'no-write-attempted',
        }),
      ],
      'no-write-attempted',
    );
  }

  let captured: VersionMergeCommitCaptureResult;
  try {
    captured = await context.captureMergeCommit({
      provider,
      graph: opened.graph,
      accessContext: provider.accessContext,
      namespace: opened.namespace,
      registry: opened.registry,
      currentRef: target.ref,
      base: input.base,
      ours: input.ours,
      theirs: input.theirs,
      targetRef: input.targetRef,
      expectedTargetHead: input.expectedTargetHead,
      changes: input.changes,
      resolutionCount: input.resolutionCount,
      ...(input.resolvedMergeAttemptDigest === undefined
        ? {}
        : { resolvedMergeAttemptDigest: input.resolvedMergeAttemptDigest }),
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
          safeMessage: 'Version merge materialization failed before graph mutation.',
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
    finalizeMergeCommitCapture(captured, {
      status: 'failed',
      diagnostics: [
        versionStoreDiagnostic('VERSION_MISSING_CHANGE_SET', {
          operation: 'commitGraphWrite',
          documentScope: provider.documentScope,
          namespace: opened.namespace,
          refName: target.ref.name,
          commitId: target.ref.commitId,
          safeMessage: 'Merge commits require a non-empty authored merge mutation segment.',
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
          safeMessage: 'Merge commits require a non-empty authored merge mutation segment.',
          mutationGuarantee: 'no-write-attempted',
        }),
      ],
      'no-write-attempted',
    );
  }

  const result = await opened.graph.mergeCommit({
    ...captured.input,
    ...(input.resolvedMergeAttemptDigest === undefined
      ? {}
      : { resolvedMergeAttemptDigest: input.resolvedMergeAttemptDigest }),
    targetRef: target.ref.name,
    expectedHeadCommitId: input.ours,
    expectedTargetRefVersion: expectedHead.revision,
    mergeParentCommitId: input.theirs,
  });

  if (result.status === 'success') {
    finalizeMergeCommitCapture(captured, {
      status: 'success',
      commitId: result.commit.id,
    });
    return {
      ...result,
      commitRef: {
        id: result.commit.id,
        refName: result.ref.name,
        resolvedFrom: result.ref.name,
        refRevision: result.ref.revision,
      },
    };
  }

  const diagnostics = mapCommitGraphDiagnostics(result.diagnostics);
  finalizeMergeCommitCapture(captured, { status: 'failed', diagnostics });
  return failedStoreResult(
    diagnostics,
    result.mutationGuarantee,
    isRetryableGraphWriteFailure(result.diagnostics),
  );
}
