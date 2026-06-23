import type { VersionCommitOptions } from '@mog-sdk/contracts/api';

import {
  VERSION_GRAPH_HEAD_REF,
  VERSION_GRAPH_MAIN_REF,
  type VersionGraphListCommitsOptions,
} from './graph-store';
import {
  fastForwardMergeCommit,
  type WorkbookVersionCommitServiceFastForwardMergeResult,
} from './commit-service-fast-forward';
import {
  diagnosticsForGraphRead,
  isRetryableGraphWriteFailure,
  mapCommitGraphDiagnostics,
} from './commit-service-diagnostics';
import {
  expectedHeadForCommit,
  expectedHeadForMergeCommit,
  finalizeMergeCommitCapture,
} from './commit-service-merge-helpers';
import { normalizeCommitOptions, normalizeCommitTargetRef } from './commit-service-options';
import { openVisibleVersionGraph } from './commit-service-open-graph';
import { materializeSnapshotRootForNormalCommit } from './commit-service-snapshot-materialization';
import type {
  VersionMergeCommitCapture,
  VersionMergeCommitCaptureResult,
  VersionNormalCommitCapture,
  VersionNormalCommitCaptureFinalizeResult,
  VersionNormalCommitCaptureResult,
  VersionNormalCommitCaptureSuccess,
  WorkbookVersionCommitServiceCommitResult,
  WorkbookVersionCommitServiceFastForwardMergeInput,
  WorkbookVersionCommitServiceListCommitsResult,
  WorkbookVersionCommitServiceMergeCommitInput,
  WorkbookVersionCommitServiceOptions,
  WorkbookVersionCommitServiceReadHeadResult,
  WorkbookVersionCommitServiceReadRefResult,
} from './commit-service-types';
import { failedStoreResult, versionStoreDiagnostic, type VersionStoreProvider } from './provider';
import type { SnapshotRootByteSyncPort } from './snapshot-root-capture';

export type {
  VersionMergeCommitCapture,
  VersionMergeCommitCaptureInput,
  VersionMergeCommitCaptureResult,
  VersionMergeCommitCaptureSuccess,
  VersionNormalCommitCapture,
  VersionNormalCommitCaptureFinalizeResult,
  VersionNormalCommitCaptureInput,
  VersionNormalCommitCaptureResult,
  VersionNormalCommitCaptureSuccess,
  VersionNormalCommitContentInput,
  WorkbookVersionCommitServiceCommitResult,
  WorkbookVersionCommitServiceFastForwardMergeInput,
  WorkbookVersionCommitServiceListCommitsResult,
  WorkbookVersionCommitServiceMergeCommitInput,
  WorkbookVersionCommitServiceOptions,
  WorkbookVersionCommitServiceReadHeadResult,
  WorkbookVersionCommitServiceReadRefResult,
} from './commit-service-types';

export class WorkbookVersionCommitService {
  private readonly provider: VersionStoreProvider;
  private readonly captureNormalCommit?: VersionNormalCommitCapture;
  private readonly captureMergeCommit?: VersionMergeCommitCapture;
  private readonly snapshotRootByteSyncPort?: SnapshotRootByteSyncPort;

  constructor(options: WorkbookVersionCommitServiceOptions) {
    this.provider = options.provider;
    this.captureNormalCommit = options.captureNormalCommit;
    this.captureMergeCommit = options.captureMergeCommit;
    this.snapshotRootByteSyncPort = options.snapshotRootByteSyncPort;
  }

  async readHead(): Promise<WorkbookVersionCommitServiceReadHeadResult> {
    const opened = await openVisibleVersionGraph(this.provider, 'readHead');
    if (!opened.ok) {
      return { status: 'degraded', head: null, diagnostics: opened.diagnostics };
    }
    return opened.graph.readHead();
  }

  async readRef(name: string): Promise<WorkbookVersionCommitServiceReadRefResult> {
    const opened = await openVisibleVersionGraph(this.provider, 'readRef');
    if (!opened.ok) {
      return { status: 'degraded', ref: null, diagnostics: opened.diagnostics };
    }
    return opened.graph.readRef(name);
  }

  async listCommits(
    options: VersionGraphListCommitsOptions = {},
  ): Promise<WorkbookVersionCommitServiceListCommitsResult> {
    const opened = await openVisibleVersionGraph(this.provider, 'listCommits');
    if (!opened.ok) {
      return { status: 'failed', diagnostics: opened.diagnostics };
    }
    return opened.graph.listCommits(options);
  }

  async commit(
    options: VersionCommitOptions = {},
  ): Promise<WorkbookVersionCommitServiceCommitResult> {
    const normalizedOptions = normalizeCommitOptions(options, this.provider);
    if (!normalizedOptions.ok) {
      return failedStoreResult(normalizedOptions.diagnostics, 'no-write-attempted');
    }
    const commitOptionsInput = normalizedOptions.options;

    if (!this.provider.capabilities.reads.graphRegistry) {
      return failedStoreResult(
        [
          versionStoreDiagnostic('VERSION_STORE_UNAVAILABLE', {
            operation: 'commitGraphWrite',
            documentScope: this.provider.documentScope,
            safeMessage: 'Version graph registry reads are unavailable for this document.',
            recoverability: 'retry',
            mutationGuarantee: 'no-write-attempted',
          }),
        ],
        'no-write-attempted',
        true,
      );
    }

    if (!this.provider.capabilities.writes.commitGraphWrite) {
      return failedStoreResult(
        [
          versionStoreDiagnostic('VERSION_STORE_READ_ONLY', {
            operation: 'commitGraphWrite',
            documentScope: this.provider.documentScope,
            safeMessage: 'Version graph writes are disabled for this document.',
            mutationGuarantee: 'no-write-attempted',
          }),
        ],
        'no-write-attempted',
      );
    }

    const opened = await openVisibleVersionGraph(this.provider, 'commitGraphWrite');
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

    const normalizedTarget = normalizeCommitTargetRef(commitOptionsInput, this.provider);
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

    if (!this.captureNormalCommit) {
      return failedStoreResult(
        [
          versionStoreDiagnostic('VERSION_MISSING_CHANGE_SET', {
            operation: 'commitGraphWrite',
            documentScope: this.provider.documentScope,
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
      captured = await this.captureNormalCommit({
        provider: this.provider,
        graph: opened.graph,
        accessContext: this.provider.accessContext,
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
            documentScope: this.provider.documentScope,
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
            documentScope: this.provider.documentScope,
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
            documentScope: this.provider.documentScope,
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
      provider: this.provider,
      namespace: opened.namespace,
      snapshotRootByteSyncPort: this.snapshotRootByteSyncPort,
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

  async mergeCommit(
    input: WorkbookVersionCommitServiceMergeCommitInput,
  ): Promise<WorkbookVersionCommitServiceCommitResult> {
    if (!this.provider.capabilities.reads.graphRegistry) {
      return failedStoreResult(
        [
          versionStoreDiagnostic('VERSION_STORE_UNAVAILABLE', {
            operation: 'commitGraphWrite',
            documentScope: this.provider.documentScope,
            safeMessage: 'Version graph registry reads are unavailable for this document.',
            recoverability: 'retry',
            mutationGuarantee: 'no-write-attempted',
          }),
        ],
        'no-write-attempted',
        true,
      );
    }

    if (!this.provider.capabilities.writes.commitGraphWrite) {
      return failedStoreResult(
        [
          versionStoreDiagnostic('VERSION_STORE_READ_ONLY', {
            operation: 'commitGraphWrite',
            documentScope: this.provider.documentScope,
            safeMessage: 'Version graph writes are disabled for this document.',
            mutationGuarantee: 'no-write-attempted',
          }),
        ],
        'no-write-attempted',
      );
    }

    const opened = await openVisibleVersionGraph(this.provider, 'commitGraphWrite');
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

    if (!this.captureMergeCommit) {
      return failedStoreResult(
        [
          versionStoreDiagnostic('VERSION_MISSING_CHANGE_SET', {
            operation: 'commitGraphWrite',
            documentScope: this.provider.documentScope,
            namespace: opened.namespace,
            refName: target.ref.name,
            commitId: target.ref.commitId,
            safeMessage:
              'No production merge materialization service is attached for merge commits.',
            mutationGuarantee: 'no-write-attempted',
          }),
        ],
        'no-write-attempted',
      );
    }

    let captured: VersionMergeCommitCaptureResult;
    try {
      captured = await this.captureMergeCommit({
        provider: this.provider,
        graph: opened.graph,
        accessContext: this.provider.accessContext,
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
            documentScope: this.provider.documentScope,
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
            documentScope: this.provider.documentScope,
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
            documentScope: this.provider.documentScope,
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

  async fastForwardMerge(
    input: WorkbookVersionCommitServiceFastForwardMergeInput,
  ): Promise<WorkbookVersionCommitServiceFastForwardMergeResult> {
    return fastForwardMergeCommit({
      input,
      provider: this.provider,
      openVisibleGraph: () => openVisibleVersionGraph(this.provider, 'commitGraphWrite'),
    });
  }
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

export function createWorkbookVersionCommitService(
  options: WorkbookVersionCommitServiceOptions,
): WorkbookVersionCommitService {
  return new WorkbookVersionCommitService(options);
}
