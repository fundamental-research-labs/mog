import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import {
  VERSION_GRAPH_HEAD_REF,
  type VersionGraphCommitRef,
  type VersionGraphRef,
  type VersionGraphWriteResult,
} from './graph';
import { expectedHeadForMergeCommit } from './commit-service-merge-helpers';
import type { WorkbookVersionCommitServiceFastForwardMergeInput } from './commit-service-types';
import type { WorkbookCommitId } from './object-digest';
import type { VersionGraphNamespace } from './object-store';
import {
  failedStoreResult,
  mapGraphDiagnostics,
  versionStoreDiagnostic,
  type VersionGraphRegistry,
  type VersionGraphStore,
  type VersionStoreDiagnostic,
  type VersionStoreFailure,
  type VersionStoreProvider,
} from './provider';

export type WorkbookVersionCommitServiceFastForwardMergeResult =
  | (Extract<VersionGraphWriteResult, { status: 'success' }> & {
      readonly commitRef: VersionGraphCommitRef;
      readonly mutationGuarantee: 'ref-fast-forwarded';
    })
  | VersionGraphWriteResult
  | VersionStoreFailure;

type OpenVisibleGraph = () => Promise<
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
>;

const VERSION_MERGE_FAST_FORWARD_AUTHOR: VersionAuthor = Object.freeze({
  authorId: 'mog.version-merge-fast-forward',
  actorKind: 'system',
  displayName: 'Mog Version Merge Fast-Forward',
});

export async function fastForwardMergeCommit(options: {
  readonly input: WorkbookVersionCommitServiceFastForwardMergeInput;
  readonly provider: VersionStoreProvider;
  readonly openVisibleGraph: OpenVisibleGraph;
}): Promise<WorkbookVersionCommitServiceFastForwardMergeResult> {
  const { input, provider } = options;
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

  const opened = await options.openVisibleGraph();
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

  const expectedHead = expectedHeadForMergeCommit(
    { ...input, changes: [], resolutionCount: 0 },
    target.ref,
  );
  if (!expectedHead.ok) {
    return failedStoreResult(expectedHead.diagnostics, 'no-write-attempted', true);
  }

  const ancestry = await isStrictAncestor(opened.graph, input.ours, input.theirs);
  if (!ancestry.ok) {
    return failedStoreResult(ancestry.diagnostics, 'no-write-attempted', true);
  }
  if (!ancestry.value) {
    return failedStoreResult(
      [
        versionStoreDiagnostic('VERSION_UNSUPPORTED_PARENT_COMMIT', {
          operation: 'commitGraphWrite',
          documentScope: provider.documentScope,
          namespace: opened.namespace,
          refName: (target.ref as VersionGraphRef).name,
          commitId: input.theirs,
          safeMessage:
            'Version merge fast-forward requires the incoming commit to descend from ours.',
          recoverability: 'none',
          mutationGuarantee: 'no-write-attempted',
          details: { expectedAncestor: input.ours },
        }),
      ],
      'no-write-attempted',
    );
  }

  const result = await opened.graph.fastForwardRef({
    targetRef: target.ref.name,
    expectedHeadCommitId: input.ours,
    expectedTargetRefVersion: expectedHead.revision,
    nextCommitId: input.theirs,
    updatedBy: VERSION_MERGE_FAST_FORWARD_AUTHOR,
  });

  if (result.status === 'success') {
    return {
      ...result,
      commitRef: {
        id: result.commit.id,
        refName: result.ref.name,
        resolvedFrom: result.ref.name,
        refRevision: result.ref.revision,
      },
      mutationGuarantee: 'ref-fast-forwarded',
    };
  }

  return failedStoreResult(
    mapGraphDiagnostics(result.diagnostics, 'commitGraphWrite'),
    result.mutationGuarantee,
    isRetryableGraphWriteFailure(result.diagnostics),
  );
}

async function isStrictAncestor(
  graph: VersionGraphStore,
  ancestor: WorkbookCommitId,
  descendant: WorkbookCommitId,
): Promise<
  | { readonly ok: true; readonly value: boolean }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] }
> {
  if (ancestor === descendant) return { ok: true, value: false };
  const closure = await graph.readCommitClosure(descendant);
  if (closure.status !== 'success') {
    return {
      ok: false,
      diagnostics: mapGraphDiagnostics(closure.diagnostics, 'commitGraphWrite'),
    };
  }
  return {
    ok: true,
    value: closure.commits.some((commit) => commit.id === ancestor),
  };
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
