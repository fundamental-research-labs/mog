import 'fake-indexeddb/auto';

import type { ObjectDigest, WorkbookCommitId } from '@mog-sdk/contracts/api';

import type { VersionObjectRecord } from '../../../document/version-store/object-store';
import {
  namespaceForDocumentScope,
  type VersionDocumentScope,
} from '../../../document/version-store/provider';
import { INDEXEDDB_VERSION_STORE_PROVIDER_KIND } from '../../../document/version-store/provider-indexeddb/backend';
import {
  createDefaultVersionStoreProviderRegistry,
  selectVersionStoreProvider,
} from '../../../document/version-store/provider-registry';
import { DOCUMENT_ID } from './version-xlsx-import-root-test-utils-constants';

export async function readRootSemanticChangeSetPayload(
  rootCommitId: WorkbookCommitId,
  documentId = DOCUMENT_ID,
): Promise<Record<string, unknown>> {
  const { graph, root } = await readRootCommit(rootCommitId, documentId);
  const semanticRecord = await graph.getObjectRecord({
    kind: 'object',
    objectType: 'workbook.semanticChangeSet.v1',
    digest: root.commit.payload.semanticChangeSetDigest,
  });
  return semanticRecord.preimage.payload as Record<string, unknown>;
}

export async function readRootCommitPayload(
  rootCommitId: WorkbookCommitId,
  documentId = DOCUMENT_ID,
): Promise<Record<string, unknown>> {
  const { root } = await readRootCommit(rootCommitId, documentId);
  return root.commit.payload as unknown as Record<string, unknown>;
}

export async function readRootSnapshotRootRecord(
  rootCommitId: WorkbookCommitId,
  documentId = DOCUMENT_ID,
): Promise<VersionObjectRecord<unknown>> {
  const { graph, root } = await readRootCommit(rootCommitId, documentId);
  return graph.getObjectRecord({
    kind: 'object',
    objectType: 'workbook.snapshotRoot.v1',
    digest: root.commit.payload.snapshotRootDigest as ObjectDigest,
  });
}

export async function expectImportBranchCounts(
  documentId: string,
  expected: {
    readonly externalChange: number;
    readonly newRoot: number;
  },
): Promise<void> {
  const documentScope: VersionDocumentScope = { documentId };
  const provider = selectVersionStoreProvider(
    {
      kind: INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
      documentScope,
      requireDurablePersistence: true,
    },
    createDefaultVersionStoreProviderRegistry(),
  );
  const registry = await provider.readGraphRegistry();
  expect(registry.status).toBe('ok');
  if (registry.status !== 'ok') {
    throw new Error(`expected version registry: ${registry.diagnostics[0]?.code}`);
  }
  const graph = await provider.openGraph(
    namespaceForDocumentScope(documentScope, registry.registry.currentGraphId),
  );
  const branches = await graph.listBranches({ prefix: 'import' });
  expect(branches).toMatchObject({ ok: true });
  if (!branches.ok) {
    throw new Error(`expected import branches: ${branches.error.code}`);
  }
  expect(
    branches.branches.filter((branch) => /^import\/external-change\//.test(branch.name)),
  ).toHaveLength(expected.externalChange);
  expect(
    branches.branches.filter((branch) => /^import\/new-root\//.test(branch.name)),
  ).toHaveLength(expected.newRoot);
}

async function readRootCommit(rootCommitId: WorkbookCommitId, documentId: string) {
  const documentScope: VersionDocumentScope = { documentId };
  const provider = selectVersionStoreProvider(
    {
      kind: INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
      documentScope,
      requireDurablePersistence: true,
    },
    createDefaultVersionStoreProviderRegistry(),
  );
  const registry = await provider.readGraphRegistry();
  expect(registry.status).toBe('ok');
  if (registry.status !== 'ok') {
    throw new Error(`expected version registry: ${registry.diagnostics[0]?.code}`);
  }
  const graph = await provider.openGraph(
    namespaceForDocumentScope(documentScope, registry.registry.currentGraphId),
  );
  const root = await graph.readCommit(rootCommitId);
  expect(root.status).toBe('success');
  if (root.status !== 'success') {
    throw new Error(`expected root commit: ${root.diagnostics[0]?.code}`);
  }
  return { graph, root };
}
