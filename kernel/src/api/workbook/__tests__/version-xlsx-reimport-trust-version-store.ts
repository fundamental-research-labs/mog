import type { ObjectDigest, WorkbookCommitId } from '@mog-sdk/contracts/api';

import type { WorkbookCommit } from '../../../document/version-store/commit-store';
import {
  namespaceForDocumentScope,
  type VersionDocumentScope,
} from '../../../document/version-store/provider';
import { INDEXEDDB_VERSION_STORE_PROVIDER_KIND } from '../../../document/version-store/provider-indexeddb/backend';
import {
  createDefaultVersionStoreProviderRegistry,
  selectVersionStoreProvider,
} from '../../../document/version-store/provider-registry';
import type { MogWorkbookVersionXlsxMetadataExpectedHead } from '../version/xlsx-metadata/xlsx-version-metadata';

export async function readLocalExpectedHead(
  documentId: string,
  workspaceId?: string,
): Promise<MogWorkbookVersionXlsxMetadataExpectedHead> {
  const { provider, graph } = await openIndexedDbGraph(documentId, workspaceId);
  try {
    const head = await graph.readHead();
    expect(head.status).toBe('success');
    if (head.status !== 'success') throw new Error(`expected local graph head`);

    const commit = await graph.readCommit(head.head.id);
    expect(commit.status).toBe('success');
    if (commit.status !== 'success') throw new Error(`expected local graph commit`);

    return {
      commitId: head.head.id,
      refName: head.head.refName,
      resolvedFrom: head.head.resolvedFrom,
      refRevision: head.head.refRevision,
      semanticChangeSetDigest: commit.commit.payload.semanticChangeSetDigest as ObjectDigest,
      snapshotRootDigest: commit.commit.payload.snapshotRootDigest as ObjectDigest,
    };
  } finally {
    await provider.close('test-teardown').catch(() => {});
  }
}

export async function readSemanticChangeSetPayload(
  commitId: WorkbookCommitId,
  documentId: string,
  workspaceId?: string,
): Promise<Record<string, unknown>> {
  const { provider, graph } = await openIndexedDbGraph(documentId, workspaceId);
  try {
    const commit = await graph.readCommit(commitId);
    expect(commit.status).toBe('success');
    if (commit.status !== 'success') throw new Error(`expected commit ${commitId}`);

    const semanticRecord = await graph.getObjectRecord({
      kind: 'object',
      objectType: 'workbook.semanticChangeSet.v1',
      digest: commit.commit.payload.semanticChangeSetDigest,
    });
    return semanticRecord.preimage.payload as Record<string, unknown>;
  } finally {
    await provider.close('test-teardown').catch(() => {});
  }
}

export async function readOnlyImportBranchCommitId(
  documentId: string,
  workspaceId?: string,
): Promise<WorkbookCommitId> {
  return (await readOnlyImportExternalChangeBranchCommit(documentId, workspaceId)).id;
}

export async function readOnlyImportExternalChangeBranchCommit(
  documentId: string,
  workspaceId?: string,
): Promise<WorkbookCommit> {
  return readOnlyImportBranchCommit(documentId, workspaceId, /^import\/external-change\//);
}

export async function readOnlyImportNewRootBranchCommit(
  documentId: string,
  workspaceId?: string,
): Promise<WorkbookCommit> {
  return readOnlyImportBranchCommit(documentId, workspaceId, /^import\/new-root\//);
}

async function readOnlyImportBranchCommit(
  documentId: string,
  workspaceId?: string,
  branchNamePattern?: RegExp,
): Promise<WorkbookCommit> {
  const { provider, graph } = await openIndexedDbGraph(documentId, workspaceId);
  try {
    const branches = await graph.listBranches({ prefix: 'import' });
    expect(branches).toMatchObject({ ok: true });
    if (!branches.ok) throw new Error(`expected import branches: ${branches.error.code}`);
    const matchingBranches = branchNamePattern
      ? branches.branches.filter((branch) => branchNamePattern.test(branch.name))
      : branches.branches;
    expect(matchingBranches).toHaveLength(1);
    const branch = matchingBranches[0];
    if (!branch) throw new Error('expected one import branch');
    if (branchNamePattern) expect(branch.name).toMatch(branchNamePattern);
    const commit = await graph.readCommit(branch.ref.targetCommitId);
    expect(commit.status).toBe('success');
    if (commit.status !== 'success') {
      throw new Error(`expected branch commit: ${commit.diagnostics[0]?.code}`);
    }
    return commit.commit;
  } finally {
    await provider.close('test-teardown').catch(() => {});
  }
}

export async function expectImportBranchCounts(
  documentId: string,
  workspaceId: string | undefined,
  expected: {
    readonly externalChange: number;
    readonly newRoot: number;
  },
): Promise<void> {
  const { provider, graph } = await openIndexedDbGraph(documentId, workspaceId);
  try {
    const branches = await graph.listBranches({ prefix: 'import' });
    expect(branches).toMatchObject({ ok: true });
    if (!branches.ok) throw new Error(`expected import branches: ${branches.error.code}`);
    expect(
      branches.branches.filter((branch) => /^import\/external-change\//.test(branch.name)),
    ).toHaveLength(expected.externalChange);
    expect(
      branches.branches.filter((branch) => /^import\/new-root\//.test(branch.name)),
    ).toHaveLength(expected.newRoot);
  } finally {
    await provider.close('test-teardown').catch(() => {});
  }
}

export async function openIndexedDbGraph(documentId: string, workspaceId?: string) {
  const documentScope: VersionDocumentScope = {
    ...(workspaceId ? { workspaceId } : {}),
    documentId,
  };
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
  return {
    provider,
    namespace: namespaceForDocumentScope(documentScope, registry.registry.currentGraphId),
    graph: await provider.openGraph(
      namespaceForDocumentScope(documentScope, registry.registry.currentGraphId),
    ),
  };
}
