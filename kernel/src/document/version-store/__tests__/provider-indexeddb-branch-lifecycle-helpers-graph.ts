import type { VersionObjectType } from '../object-digest';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../object-store';
import {
  namespaceForDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
} from '../provider';
import { createIndexedDbVersionStoreProvider } from '../provider-indexeddb/backend';
import { AUTHOR, DOCUMENT_SCOPE } from './provider-indexeddb-branch-lifecycle-helpers-context';

export async function createBranchFixture(graphId: string) {
  const provider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
  const initialized = await provider.initializeGraph(await initializeInput(graphId));
  expectInitializeSuccess(initialized);
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, graphId);
  const graph = await provider.openGraph(namespace);
  const concurrentCommit = await graph.commit({
    ...(await rootWrite('race-concurrent', namespace)),
    expectedHeadCommitId: initialized.rootCommit.id,
    expectedMainRefVersion: initialized.initialHead.revision,
    parentCommitIds: [initialized.rootCommit.id],
  });
  expect(concurrentCommit.status).toBe('success');
  if (concurrentCommit.status !== 'success') throw new Error('expected concurrent commit success');
  const rollbackCommit = await graph.commit({
    ...(await rootWrite('race-rollback', namespace)),
    expectedHeadCommitId: concurrentCommit.commit.id,
    expectedMainRefVersion: concurrentCommit.main.revision,
    parentCommitIds: [concurrentCommit.commit.id],
  });
  expect(rollbackCommit.status).toBe('success');
  if (rollbackCommit.status !== 'success') throw new Error('expected rollback commit success');
  const created = await graph.createBranch({
    name: 'scenario/idb-race',
    targetCommitId: initialized.rootCommit.id,
    expectedAbsent: true,
    createdBy: AUTHOR,
  });
  expect(created.ok).toBe(true);
  if (!created.ok) throw new Error('expected branch create success');
  return {
    initialized,
    namespace,
    branch: created.branch,
    concurrentCommitId: concurrentCommit.commit.id,
    rollbackCommitId: rollbackCommit.commit.id,
  };
}

export async function initializeInput(graphId: string): Promise<VersionGraphInitializeInput> {
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, graphId);
  return {
    expectedRegistryRevision: null,
    graphId,
    rootWrite: await rootWrite('root', namespace),
  };
}

export async function rootWrite(
  label: string,
  namespace: VersionGraphNamespace,
): Promise<VersionGraphInitializeInput['rootWrite']> {
  return {
    snapshotRootRecord: await objectRecord(
      'workbook.snapshotRoot.v1',
      { label, sheets: [] },
      namespace,
    ),
    semanticChangeSetRecord: await objectRecord(
      'workbook.semanticChangeSet.v1',
      { label, changes: [] },
      namespace,
    ),
    author: AUTHOR,
    createdAt: '2026-06-20T00:00:00.000Z',
    completenessDiagnostics: [],
  };
}

export function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected initialize success: ${result.diagnostics[0]?.code}`);
  }
}

async function objectRecord(
  objectType: VersionObjectType,
  payload: unknown,
  namespace: VersionGraphNamespace,
): Promise<VersionObjectRecord<unknown>> {
  return createVersionObjectRecord(namespace, {
    objectType,
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [],
    payload,
  });
}
