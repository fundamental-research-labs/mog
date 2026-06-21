import type {
  VersionCommitExpectedHead,
  VersionCommitOptions,
  VersionMainRefName,
  VersionMergeChange,
  VersionRefName,
} from '@mog-sdk/contracts/api';

import {
  VERSION_GRAPH_HEAD_REF,
  VERSION_GRAPH_MAIN_REF,
  type VersionGraphBranchRefName,
  type VersionGraphCommitRef,
  type VersionGraphCommitContentInput,
  type VersionGraphCommitPageResult,
  type VersionGraphReadHeadResult,
  type VersionGraphReadRefResult,
  type VersionGraphRef,
  type VersionGraphSymbolicRef,
  type VersionGraphWriteResult,
} from './graph-store';
import {
  fastForwardMergeCommit,
  type WorkbookVersionCommitServiceFastForwardMergeResult,
} from './commit-service-fast-forward';
import {
  expectedHeadForCommit,
  expectedHeadForMergeCommit,
  finalizeMergeCommitCapture,
} from './commit-service-merge-helpers';
import { parseWorkbookCommitId, type WorkbookCommitId } from './object-digest';
import { type VersionGraphNamespace } from './object-store';
import {
  VersionStoreProviderError,
  failedStoreResult,
  mapGraphDiagnostics,
  versionStoreDiagnostic,
  type VersionAccessContext,
  type VersionGraphRegistry,
  type VersionStoreDiagnostic,
  type VersionStoreFailure,
  type VersionGraphStore,
  type VersionStoreProvider,
} from './provider';
import { REF_NAME_STORAGE_PREFIX, validateRefName } from './ref-name';
import { refVersionsEqual, type RefVersion } from './ref-store';
import { namespaceForRegistry } from './registry';
import {
  captureWorkbookSnapshotRootRecord,
  type SnapshotRootByteSyncPort,
} from './snapshot-root-capture';

export type VersionNormalCommitCaptureInput = {
  readonly provider: VersionStoreProvider;
  readonly graph: VersionGraphStore;
  readonly accessContext: VersionAccessContext;
  readonly namespace: VersionGraphNamespace;
  readonly registry: VersionGraphRegistry;
  readonly currentHead: VersionGraphSymbolicRef;
  readonly currentMain: VersionGraphRef;
  readonly currentRef: VersionGraphRef;
  readonly options: VersionCommitOptions;
};

export type VersionMergeCommitCaptureInput = {
  readonly provider: VersionStoreProvider;
  readonly graph: VersionGraphStore;
  readonly accessContext: VersionAccessContext;
  readonly namespace: VersionGraphNamespace;
  readonly registry: VersionGraphRegistry;
  readonly currentRef: VersionGraphRef;
  readonly base: WorkbookCommitId;
  readonly ours: WorkbookCommitId;
  readonly theirs: WorkbookCommitId;
  readonly targetRef: VersionMainRefName | VersionRefName;
  readonly expectedTargetHead: VersionCommitExpectedHead;
  readonly changes: readonly VersionMergeChange[];
  readonly resolutionCount: number;
};

export type VersionNormalCommitCaptureFinalizeResult =
  | {
      readonly status: 'success';
      readonly commitId: WorkbookCommitId;
    }
  | {
      readonly status: 'failed';
      readonly diagnostics?: readonly VersionStoreDiagnostic[];
    };

export type VersionNormalCommitContentInput = Omit<
  VersionGraphCommitContentInput,
  'snapshotRootRecord'
> &
  Partial<Pick<VersionGraphCommitContentInput, 'snapshotRootRecord'>>;

export type VersionNormalCommitCaptureSuccess = {
  readonly status: 'success';
  readonly input: VersionNormalCommitContentInput;
  readonly diagnostics?: readonly VersionStoreDiagnostic[];
  readonly finalize?: (result: VersionNormalCommitCaptureFinalizeResult) => void;
};

export type VersionNormalCommitCaptureResult =
  | VersionNormalCommitCaptureSuccess
  | VersionStoreFailure;

export type VersionMergeCommitCaptureSuccess = {
  readonly status: 'success';
  readonly input: VersionGraphCommitContentInput;
  readonly diagnostics?: readonly VersionStoreDiagnostic[];
  readonly finalize?: (result: VersionNormalCommitCaptureFinalizeResult) => void;
};

export type VersionMergeCommitCaptureResult =
  | VersionMergeCommitCaptureSuccess
  | VersionStoreFailure;

type VersionNormalCommitMaterializedCaptureSuccess = Omit<
  VersionNormalCommitCaptureSuccess,
  'input'
> & {
  readonly input: VersionGraphCommitContentInput;
};

type VersionNormalCommitMaterializedCaptureResult =
  | VersionNormalCommitMaterializedCaptureSuccess
  | VersionStoreFailure;

export type VersionNormalCommitCapture = (
  input: VersionNormalCommitCaptureInput,
) => Promise<VersionNormalCommitCaptureResult> | VersionNormalCommitCaptureResult;

export type VersionMergeCommitCapture = (
  input: VersionMergeCommitCaptureInput,
) => Promise<VersionMergeCommitCaptureResult> | VersionMergeCommitCaptureResult;

export type WorkbookVersionCommitServiceMergeCommitInput = {
  readonly base: WorkbookCommitId;
  readonly ours: WorkbookCommitId;
  readonly theirs: WorkbookCommitId;
  readonly targetRef: VersionMainRefName | VersionRefName;
  readonly expectedTargetHead: VersionCommitExpectedHead;
  readonly changes: readonly VersionMergeChange[];
  readonly resolutionCount: number;
};

export type WorkbookVersionCommitServiceFastForwardMergeInput = Omit<
  WorkbookVersionCommitServiceMergeCommitInput,
  'changes' | 'resolutionCount'
>;

export type WorkbookVersionCommitServiceOptions = {
  readonly provider: VersionStoreProvider;
  readonly captureNormalCommit?: VersionNormalCommitCapture;
  readonly captureMergeCommit?: VersionMergeCommitCapture;
  readonly snapshotRootByteSyncPort?: SnapshotRootByteSyncPort;
};

export type WorkbookVersionCommitServiceCommitResult =
  | (Extract<VersionGraphWriteResult, { status: 'success' }> & {
      readonly commitRef: VersionGraphCommitRef;
    })
  | VersionGraphWriteResult
  | VersionStoreFailure;

export type WorkbookVersionCommitServiceReadHeadResult =
  | VersionGraphReadHeadResult
  | {
      readonly status: 'degraded';
      readonly head: null;
      readonly diagnostics: readonly VersionStoreDiagnostic[];
    };

export type WorkbookVersionCommitServiceReadRefResult =
  | VersionGraphReadRefResult
  | {
      readonly status: 'degraded';
      readonly ref: null;
      readonly diagnostics: readonly VersionStoreDiagnostic[];
    };

export type WorkbookVersionCommitServiceListCommitsResult =
  | VersionGraphCommitPageResult
  | {
      readonly status: 'failed';
      readonly diagnostics: readonly VersionStoreDiagnostic[];
    };

type NormalizedCommitTargetRefResult =
  | {
      readonly ok: true;
      readonly refName: VersionGraphBranchRefName;
      readonly options: VersionCommitOptions;
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly VersionStoreDiagnostic[];
    };

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
    const opened = await this.openVisibleGraph('readHead');
    if (!opened.ok) {
      return { status: 'degraded', head: null, diagnostics: opened.diagnostics };
    }
    return opened.graph.readHead();
  }

  async readRef(name: string): Promise<WorkbookVersionCommitServiceReadRefResult> {
    const opened = await this.openVisibleGraph('readRef');
    if (!opened.ok) {
      return { status: 'degraded', ref: null, diagnostics: opened.diagnostics };
    }
    return opened.graph.readRef(name);
  }

  async listCommits(
    options: {
      readonly pageSize?: number;
    } = {},
  ): Promise<WorkbookVersionCommitServiceListCommitsResult> {
    const opened = await this.openVisibleGraph('listCommits');
    if (!opened.ok) {
      return { status: 'failed', diagnostics: opened.diagnostics };
    }
    return opened.graph.listCommits(options);
  }

  async commit(
    options: VersionCommitOptions = {},
  ): Promise<WorkbookVersionCommitServiceCommitResult> {
    if (options.mode !== undefined && options.mode.kind !== 'normal') {
      return failedStoreResult(
        [
          versionStoreDiagnostic('VERSION_INVALID_OPTIONS', {
            operation: 'commitGraphWrite',
            documentScope: this.provider.documentScope,
            safeMessage: 'Provider-backed commit service supports only normal commits.',
            mutationGuarantee: 'no-write-attempted',
            details: { option: 'mode' },
          }),
        ],
        'no-write-attempted',
      );
    }

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

    const opened = await this.openVisibleGraph('commitGraphWrite');
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

    const normalizedTarget = normalizeCommitTargetRef(options, this.provider);
    if (!normalizedTarget.ok) {
      return failedStoreResult(normalizedTarget.diagnostics, 'no-write-attempted');
    }

    const targetRefName = normalizedTarget.refName;
    const commitOptions = normalizedTarget.options;
    const target =
      targetRefName === VERSION_GRAPH_MAIN_REF
        ? main
        : await opened.graph.readRef(targetRefName);
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

    const commitContent = await this.materializeSnapshotRootForNormalCommit(opened, captured);
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
    const diagnostics = mapGraphDiagnostics(result.diagnostics, 'commitGraphWrite');
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

    const opened = await this.openVisibleGraph('commitGraphWrite');
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

    const diagnostics = mapGraphDiagnostics(result.diagnostics, 'commitGraphWrite');
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
      openVisibleGraph: () => this.openVisibleGraph('commitGraphWrite'),
    });
  }

  private async materializeSnapshotRootForNormalCommit(
    opened: {
      readonly namespace: VersionGraphNamespace;
    },
    captured: Extract<VersionNormalCommitCaptureResult, { status: 'success' }>,
  ): Promise<VersionNormalCommitMaterializedCaptureResult> {
    if (!this.snapshotRootByteSyncPort) {
      if (captured.input.snapshotRootRecord) {
        return captured as VersionNormalCommitMaterializedCaptureSuccess;
      }
      return failedStoreResult(
        [
          versionStoreDiagnostic('VERSION_MISSING_CHANGE_SET', {
            operation: 'commitGraphWrite',
            documentScope: this.provider.documentScope,
            namespace: opened.namespace,
            safeMessage:
              'No production snapshot-root capture service is attached for normal version commits.',
            mutationGuarantee: 'no-write-attempted',
          }),
        ],
        'no-write-attempted',
      );
    }

    try {
      const snapshotRootRecord = await captureWorkbookSnapshotRootRecord(
        opened.namespace,
        this.snapshotRootByteSyncPort,
      );
      return {
        ...captured,
        input: {
          ...captured.input,
          snapshotRootRecord,
        },
      };
    } catch {
      return failedStoreResult(
        [
          versionStoreDiagnostic('VERSION_PROVIDER_FAILED', {
            operation: 'commitGraphWrite',
            documentScope: this.provider.documentScope,
            namespace: opened.namespace,
            safeMessage: 'Version commit capture failed before graph mutation.',
            recoverability: 'retry',
            mutationGuarantee: 'no-write-attempted',
          }),
        ],
        'no-write-attempted',
        true,
      );
    }
  }

  private async openVisibleGraph(
    operation: 'readHead' | 'readRef' | 'listCommits' | 'commitGraphWrite',
  ): Promise<
    | {
        readonly ok: true;
        readonly registry: VersionGraphRegistry;
        readonly namespace: VersionGraphNamespace;
        readonly graph: VersionGraphStore;
      }
    | {
        readonly ok: false;
        readonly diagnostics: readonly VersionStoreDiagnostic[];
        readonly retryable: boolean;
      }
  > {
    try {
      const registryRead = await this.provider.readGraphRegistry();
      if (registryRead.status !== 'ok') {
        return {
          ok: false,
          diagnostics: retargetProviderDiagnostics(registryRead.diagnostics, operation),
          retryable: registryRead.status === 'absent',
        };
      }

      const namespace = namespaceForRegistry(registryRead.registry);
      const graph = await this.provider.openGraph(namespace, this.provider.accessContext);
      return { ok: true, registry: registryRead.registry, namespace, graph };
    } catch (error) {
      return {
        ok: false,
        diagnostics: diagnosticsFromProviderError(error, operation, this.provider),
        retryable: true,
      };
    }
  }
}

function normalizeCommitTargetRef(
  options: VersionCommitOptions,
  provider: VersionStoreProvider,
): NormalizedCommitTargetRefResult {
  const value = options.targetRef;
  if (value === undefined) {
    return { ok: true, refName: VERSION_GRAPH_MAIN_REF, options };
  }
  if (typeof value !== 'string') {
    return {
      ok: false,
      diagnostics: [
        invalidTargetRefDiagnostic(provider, 'targetRef must be a string.', {
          option: 'targetRef',
          issue: 'notString',
        }),
      ],
    };
  }
  if (value === VERSION_GRAPH_HEAD_REF) {
    return {
      ok: false,
      diagnostics: [
        invalidTargetRefDiagnostic(
          provider,
          'Version commit targetRef must be a concrete refs/heads/* ref.',
          { option: 'targetRef', issue: 'reservedSymbolicHead' },
        ),
      ],
    };
  }

  const branchName = value.startsWith(REF_NAME_STORAGE_PREFIX)
    ? value.slice(REF_NAME_STORAGE_PREFIX.length)
    : value;
  const parsed = validateRefName(branchName, 'targetRef');
  if (!parsed.ok) {
    return {
      ok: false,
      diagnostics: parsed.diagnostics.map((diagnostic) =>
        invalidTargetRefDiagnostic(
          provider,
          'Version commit targetRef must name a public-safe version branch.',
          { option: 'targetRef', issue: diagnostic.issue, refName: 'redacted' },
        ),
      ),
    };
  }

  const refName = `${REF_NAME_STORAGE_PREFIX}${parsed.name}` as VersionGraphBranchRefName;
  return {
    ok: true,
    refName,
    options: value === refName ? options : { ...options, targetRef: refName },
  };
}

function invalidTargetRefDiagnostic(
  provider: VersionStoreProvider,
  safeMessage: string,
  details: Readonly<Record<string, string | number | boolean | null>>,
): VersionStoreDiagnostic {
  return versionStoreDiagnostic('VERSION_INVALID_OPTIONS', {
    operation: 'commitGraphWrite',
    documentScope: provider.documentScope,
    safeMessage,
    recoverability: 'none',
    mutationGuarantee: 'no-write-attempted',
    details,
  });
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

function diagnosticsForGraphRead(
  diagnostics: readonly unknown[],
  operation: 'commitGraphWrite',
): readonly VersionStoreDiagnostic[] {
  if (diagnostics.length === 0) {
    return [
      versionStoreDiagnostic('VERSION_PROVIDER_FAILED', {
        operation,
        safeMessage: 'Version graph read failed before commit.',
        recoverability: 'retry',
        mutationGuarantee: 'no-write-attempted',
      }),
    ];
  }
  return mapGraphDiagnostics(diagnostics as Parameters<typeof mapGraphDiagnostics>[0], operation);
}

function isRetryableGraphWriteFailure(
  diagnostics: readonly Parameters<typeof mapGraphDiagnostics>[0][number][],
): boolean {
  return diagnostics.some(
    (diagnostic) =>
      diagnostic.code === 'VERSION_REF_CONFLICT' ||
      diagnostic.code === 'VERSION_GRAPH_CONFLICT' ||
      diagnostic.code === 'VERSION_OBJECT_STORE_FAILURE',
  );
}

function diagnosticsFromProviderError(
  error: unknown,
  operation: 'readHead' | 'readRef' | 'listCommits' | 'commitGraphWrite',
  provider: VersionStoreProvider,
): readonly VersionStoreDiagnostic[] {
  if (error instanceof VersionStoreProviderError) {
    return retargetProviderDiagnostics(error.diagnostics, operation);
  }
  if (operation === 'commitGraphWrite') {
    return [
      versionStoreDiagnostic('VERSION_PROVIDER_FAILED', {
        operation,
        documentScope: provider.documentScope,
        safeMessage: 'Version store provider failed before returning graph state.',
        recoverability: 'retry',
        mutationGuarantee: 'no-write-attempted',
      }),
    ];
  }
  return [
    versionStoreDiagnostic('VERSION_PROVIDER_FAILED', {
      operation: 'openGraph',
      documentScope: provider.documentScope,
      safeMessage: 'Version store provider failed before returning graph state.',
      recoverability: 'retry',
    }),
  ];
}

function retargetProviderDiagnostics(
  diagnostics: readonly VersionStoreDiagnostic[],
  operation: 'readHead' | 'readRef' | 'listCommits' | 'commitGraphWrite',
): readonly VersionStoreDiagnostic[] {
  if (operation !== 'commitGraphWrite') return diagnostics;
  return diagnostics.map((diagnostic) => ({
    ...diagnostic,
    operation,
    mutationGuarantee: diagnostic.mutationGuarantee ?? 'no-write-attempted',
  }));
}
