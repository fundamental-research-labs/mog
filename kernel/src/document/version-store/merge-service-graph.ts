import type { WorkbookCommitId } from '@mog-sdk/contracts/api';

import type { WorkbookCommit } from './commit-store';
import type { VersionMergeBaseCommitRead } from './merge-base-resolution';
import { diagnostic, graphDiagnostics, type MergeDiagnostic } from './merge-service-diagnostics';
import { VersionObjectStoreError, type VersionGraphNamespace } from './object-store';
import {
  VersionStoreProviderError,
  type VersionGraphStore,
  type VersionStoreProvider,
} from './provider';
import { namespaceForRegistry } from './registry';

export async function openVisibleMergeGraph(provider: VersionStoreProvider): Promise<
  | {
      readonly ok: true;
      readonly namespace: VersionGraphNamespace;
      readonly graph: VersionGraphStore;
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly MergeDiagnostic[];
    }
> {
  try {
    const registryRead = await provider.readGraphRegistry();
    if (registryRead.status !== 'ok') {
      return { ok: false, diagnostics: graphDiagnostics(registryRead.diagnostics) };
    }

    const namespace = namespaceForRegistry(registryRead.registry);
    const graph = await provider.openGraph(namespace, provider.accessContext);
    return { ok: true, namespace, graph };
  } catch (error) {
    if (error instanceof VersionStoreProviderError) {
      return { ok: false, diagnostics: graphDiagnostics(error.diagnostics) };
    }
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          'VERSION_PROVIDER_ERROR',
          'Version store provider failed before returning graph state.',
          {
            severity: 'fatal',
            recoverability: 'retry',
          },
        ),
      ],
    };
  }
}

export async function readPreviewCommit(
  graph: VersionGraphStore,
  commitId: WorkbookCommitId,
  branch: 'ours' | 'theirs',
): Promise<
  | { readonly ok: true; readonly commit: VersionMergeBaseCommitRead }
  | { readonly ok: false; readonly diagnostics: readonly MergeDiagnostic[] }
> {
  const closure = await graph.readCommitClosure(commitId);
  if (closure.status !== 'success') {
    return { ok: false, diagnostics: graphDiagnostics(closure.diagnostics, { branch }) };
  }

  const commit = closure.commits.find((candidate) => candidate.id === commitId);
  if (!commit) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          'VERSION_UNMATERIALIZABLE_COMMIT',
          'Merge commit is absent from its readable commit closure.',
          { payload: { branch } },
        ),
      ],
    };
  }

  return { ok: true, commit: { commit, closure: closure.commits } };
}

export function directChildDiagnostic(
  baseCommitId: WorkbookCommitId,
  commit: WorkbookCommit,
  branch: 'ours' | 'theirs',
): MergeDiagnostic | null {
  if (
    commit.payload.parentCommitIds.length === 1 &&
    commit.payload.parentCommitIds[0] === baseCommitId
  ) {
    return null;
  }

  return diagnostic(
    'VERSION_MERGE_UNSUPPORTED_ANCESTRY',
    'Merge preview requires non-ancestral divergent commits to be direct children of base.',
    {
      payload: {
        branch,
        parentCount: commit.payload.parentCommitIds.length,
        parentMatchesBase: commit.payload.parentCommitIds[0] === baseCommitId,
      },
    },
  );
}

export async function readSemanticChangeSet(
  graph: VersionGraphStore,
  commit: WorkbookCommit,
): Promise<
  | { readonly ok: true; readonly payload: unknown }
  | { readonly ok: false; readonly diagnostics: readonly MergeDiagnostic[] }
> {
  try {
    const record = await graph.getObjectRecord<unknown>({
      kind: 'object',
      objectType: 'workbook.semanticChangeSet.v1',
      digest: commit.payload.semanticChangeSetDigest,
    });
    return { ok: true, payload: record.preimage.payload };
  } catch (error) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          error instanceof VersionObjectStoreError &&
            error.diagnostic.code === 'VERSION_OBJECT_NOT_FOUND'
            ? 'VERSION_MISSING_OBJECT'
            : 'VERSION_PROVIDER_ERROR',
          'Merge preview semantic change-set object could not be read.',
          {
            recoverability: error instanceof VersionObjectStoreError ? 'repair' : 'retry',
          },
        ),
      ],
    };
  }
}
