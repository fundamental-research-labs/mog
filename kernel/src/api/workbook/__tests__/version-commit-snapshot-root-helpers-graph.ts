import {
  namespaceForDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
} from '../../../document/version-store/provider';
import {
  CREATED_AT,
  DOCUMENT_SCOPE,
  VERSION_AUTHOR,
} from './version-commit-snapshot-root-helpers-fixtures';
import { objectRecord } from './version-commit-snapshot-root-helpers-object-records';
import type { InMemoryVersionStoreProvider } from './version-commit-snapshot-root-helpers-versioning';

export type InitializedVersionGraph = Extract<VersionGraphInitializeResult, { status: 'success' }>;

export function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is InitializedVersionGraph {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected initialize success: ${result.diagnostics[0]?.code}`);
  }
}

export async function initializeInput(
  graphId: string,
  label: string,
): Promise<VersionGraphInitializeInput> {
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, graphId);
  return {
    expectedRegistryRevision: null,
    graphId,
    rootWrite: {
      snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
        label,
        sheets: [],
      }),
      semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
        label,
        changes: [],
      }),
      author: VERSION_AUTHOR,
      createdAt: CREATED_AT,
      completenessDiagnostics: [],
    },
  };
}

export async function expectOnlyRootCommit(
  provider: InMemoryVersionStoreProvider,
  graphId: string,
  initialized: InitializedVersionGraph,
): Promise<void> {
  const graph = await provider.openGraph(namespaceForDocumentScope(DOCUMENT_SCOPE, graphId));
  await expect(graph.readHead()).resolves.toMatchObject({
    status: 'success',
    head: {
      id: initialized.rootCommit.id,
      refRevision: initialized.initialHead.revision,
    },
  });
  const listed = await graph.listCommits();
  expect(listed).toMatchObject({
    status: 'success',
    commits: [{ id: initialized.rootCommit.id }],
  });
  if (listed.status !== 'success') {
    throw new Error(`expected commit list success: ${listed.diagnostics[0]?.code}`);
  }
  expect(listed.commits).toHaveLength(1);
}
