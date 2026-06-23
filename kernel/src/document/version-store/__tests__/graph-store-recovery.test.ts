import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import {
  parseWorkbookCommitId,
  workbookCommitIdFromObjectDigest,
  type VersionDependencyRef,
  type VersionObjectType,
  type WorkbookCommitId,
} from '../object-digest';
import {
  InMemoryVersionObjectStore,
  VersionObjectMemoryBackend,
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../object-store';
import {
  createInMemoryRefStore,
  type InMemoryRefStore,
  type RefVersion,
} from '../ref-store';
import {
  VERSION_GRAPH_MAIN_REF,
  createInMemoryVersionGraphStore,
  type CommitVersionGraphInput,
  type InitializeVersionGraphInput,
  type VersionGraphClosureReadResult,
  type VersionGraphReadHeadResult,
  type VersionGraphStoreDiagnostic,
  type VersionGraphWriteResult,
} from '../graph-store';
import { mapGraphDiagnostics } from '../provider-indexeddb-internal';

const NAMESPACE: VersionGraphNamespace = {
  workspaceId: 'workspace-secret-recovery',
  documentId: 'document-secret-recovery',
  graphId: 'graph-secret-recovery',
  principalScope: 'principal-secret-recovery',
};

const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

function commit(byte: string): WorkbookCommitId {
  return parseWorkbookCommitId(`commit:sha256:${byte.repeat(32)}`);
}

function expectGraphSuccess(
  result: VersionGraphWriteResult,
): asserts result is Extract<VersionGraphWriteResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected graph write success: ${result.diagnostics[0]?.code}`);
  }
}

function expectGraphFailed(
  result: VersionGraphWriteResult,
): asserts result is Extract<VersionGraphWriteResult, { status: 'failed' }> {
  expect(result.status).toBe('failed');
  if (result.status !== 'failed') {
    throw new Error('expected graph write failure');
  }
}

function expectReadHeadDegraded(
  result: VersionGraphReadHeadResult,
): asserts result is Extract<VersionGraphReadHeadResult, { status: 'degraded' }> {
  expect(result.status).toBe('degraded');
  if (result.status !== 'degraded') {
    throw new Error('expected readHead degraded result');
  }
}

function expectClosureFailed(
  result: VersionGraphClosureReadResult,
): asserts result is Extract<VersionGraphClosureReadResult, { status: 'failed' }> {
  expect(result.status).toBe('failed');
  if (result.status !== 'failed') {
    throw new Error('expected readCommitClosure failure');
  }
}

async function objectRecord(
  objectType: VersionObjectType,
  payload: unknown,
  dependencies: readonly VersionDependencyRef[] = [],
): Promise<VersionObjectRecord<unknown>> {
  return createVersionObjectRecord(NAMESPACE, {
    objectType,
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies,
    payload,
  });
}

async function graphInput(label: string): Promise<InitializeVersionGraphInput> {
  const snapshotRootRecord = await objectRecord('workbook.snapshotRoot.v1', {
    label,
    sheets: [],
  });
  const semanticChangeSetRecord = await objectRecord('workbook.semanticChangeSet.v1', {
    label,
    changes: [],
  });

  return {
    snapshotRootRecord,
    semanticChangeSetRecord,
    author: AUTHOR,
    createdAt: '2026-06-20T00:00:00.000Z',
    completenessDiagnostics: [],
  };
}

function commitInput(
  input: InitializeVersionGraphInput,
  expectedHeadCommitId: WorkbookCommitId,
  expectedMainRefVersion: RefVersion,
): CommitVersionGraphInput {
  return {
    ...input,
    expectedHeadCommitId,
    expectedMainRefVersion,
  };
}

async function persistRootCommitWithSemanticDependencyGap(
  backend: VersionObjectMemoryBackend,
  objectStore: InMemoryVersionObjectStore,
  mode: 'missing' | 'corrupt',
): Promise<{
  readonly commitId: WorkbookCommitId;
  readonly semanticDependency: VersionDependencyRef;
}> {
  const snapshotRoot = await objectRecord('workbook.snapshotRoot.v1', {
    label: `${mode}-snapshot`,
    sheets: [],
  });
  const semanticChangeSet = await objectRecord('workbook.semanticChangeSet.v1', {
    label: `${mode}-semantic`,
    changes: [],
  });
  const semanticDependency: VersionDependencyRef = {
    kind: 'object',
    objectType: 'workbook.semanticChangeSet.v1',
    digest: semanticChangeSet.digest,
  };
  const payload = {
    schemaVersion: 1,
    documentId: NAMESPACE.documentId,
    parentCommitIds: [],
    snapshotRootDigest: snapshotRoot.digest,
    semanticChangeSetDigest: semanticChangeSet.digest,
    author: AUTHOR,
    createdAt: '2026-06-20T00:00:00.000Z',
    completenessDiagnostics: [],
  };
  const commitRecord = await createVersionObjectRecord(NAMESPACE, {
    objectType: 'workbook.commit.v1',
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [
      semanticDependency,
      {
        kind: 'object',
        objectType: 'workbook.snapshotRoot.v1',
        digest: snapshotRoot.digest,
      },
    ],
    payload,
  });

  expect(await objectStore.putObjects([snapshotRoot])).toMatchObject({ status: 'success' });
  if (mode === 'corrupt') {
    const corruptSemantic = await objectRecord('workbook.semanticChangeSet.v1', {
      label: 'corrupt-semantic',
      changes: ['digest-mismatch'],
    });
    backend.putCorruptRecordForTesting(NAMESPACE, semanticChangeSet.digest, {
      ...corruptSemantic,
      digest: semanticChangeSet.digest,
    });
  }
  backend.putCorruptRecordForTesting(NAMESPACE, commitRecord.digest, commitRecord);

  return {
    commitId: workbookCommitIdFromObjectDigest(commitRecord.digest),
    semanticDependency,
  };
}

function initializeMainAt(refStore: InMemoryRefStore, commitId: WorkbookCommitId): void {
  expect(refStore.initializeMain({ targetCommitId: commitId, createdBy: AUTHOR })).toMatchObject({
    ok: true,
  });
}

function expectMappedRecoverability(
  diagnostics: readonly VersionGraphStoreDiagnostic[],
  recoverability: 'repair' | 'retry',
): void {
  expect(
    mapGraphDiagnostics(diagnostics, 'openGraph').map((diagnostic) => diagnostic.recoverability),
  ).toEqual(diagnostics.map(() => recoverability));
}

function expectNoRawNamespaceLeak(diagnostics: readonly VersionGraphStoreDiagnostic[]): void {
  const serialized = JSON.stringify(diagnostics);
  expect(serialized).not.toContain('"path":');
  expect(serialized).not.toContain('"namespace":');
  expect(serialized).not.toContain(NAMESPACE.workspaceId);
  expect(serialized).not.toContain(NAMESPACE.documentId);
  expect(serialized).not.toContain(NAMESPACE.graphId);
  expect(serialized).not.toContain(NAMESPACE.principalScope);
}

describe('InMemoryVersionGraphStore recovery diagnostics', () => {
  it('reports dangling missing-commit reads as repairable without mutating refs', async () => {
    const objectStore = new InMemoryVersionObjectStore(NAMESPACE);
    const refStore = createInMemoryRefStore({ versionDocumentId: NAMESPACE.documentId });
    const missingCommit = commit('ed');
    initializeMainAt(refStore, missingCommit);
    const graph = createInMemoryVersionGraphStore({ namespace: NAMESPACE, objectStore, refStore });
    const refsBefore = refStore.exportSnapshot();

    const head = await graph.readHead();
    const repeatedHead = await graph.readHead();
    expectReadHeadDegraded(head);
    expectReadHeadDegraded(repeatedHead);

    expect(head.diagnostics).toEqual(repeatedHead.diagnostics);
    expect(head.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'VERSION_DANGLING_REF',
      'VERSION_MISSING_OBJECT',
    ]);
    expect(head.diagnostics).toEqual([
      expect.objectContaining({
        code: 'VERSION_DANGLING_REF',
        operation: 'readHead',
        refName: VERSION_GRAPH_MAIN_REF,
        commitId: missingCommit,
        objectKind: 'commit',
      }),
      expect.objectContaining({
        code: 'VERSION_MISSING_OBJECT',
        operation: 'readHead',
        commitId: missingCommit,
        objectKind: 'commit',
      }),
    ]);
    expectMappedRecoverability(head.diagnostics, 'repair');
    expectNoRawNamespaceLeak(head.diagnostics);
    expect(refStore.exportSnapshot()).toEqual(refsBefore);

    const closure = await graph.readCommitClosure(missingCommit);
    const repeatedClosure = await graph.readCommitClosure(missingCommit);
    expectClosureFailed(closure);
    expectClosureFailed(repeatedClosure);
    expect(closure.diagnostics).toEqual(repeatedClosure.diagnostics);
    expect(closure.diagnostics).toEqual([
      expect.objectContaining({
        code: 'VERSION_MISSING_OBJECT',
        operation: 'readCommitClosure',
        commitId: missingCommit,
        objectKind: 'commit',
      }),
    ]);
    expectMappedRecoverability(closure.diagnostics, 'repair');
    expectNoRawNamespaceLeak(closure.diagnostics);
    expect(refStore.exportSnapshot()).toEqual(refsBefore);
  });

  it.each([
    { mode: 'missing', code: 'VERSION_MISSING_DEPENDENCY' },
    { mode: 'corrupt', code: 'VERSION_OBJECT_STORE_FAILURE' },
  ] as const)(
    'reports $mode dependency closure reads as repairable without mutating refs',
    async ({ mode, code }) => {
      const backend = new VersionObjectMemoryBackend();
      const objectStore = new InMemoryVersionObjectStore(NAMESPACE, { backend });
      const refStore = createInMemoryRefStore({ versionDocumentId: NAMESPACE.documentId });
      const graph = createInMemoryVersionGraphStore({
        namespace: NAMESPACE,
        objectStore,
        refStore,
      });
      const persisted = await persistRootCommitWithSemanticDependencyGap(
        backend,
        objectStore,
        mode,
      );
      initializeMainAt(refStore, persisted.commitId);
      const refsBefore = refStore.exportSnapshot();

      const closure = await graph.readCommitClosure(persisted.commitId);
      const repeatedClosure = await graph.readCommitClosure(persisted.commitId);
      expectClosureFailed(closure);
      expectClosureFailed(repeatedClosure);

      expect(closure.diagnostics).toEqual(repeatedClosure.diagnostics);
      expect(closure.diagnostics).toEqual([
        expect.objectContaining({
          code,
          operation: 'readCommitClosure',
          commitId: persisted.commitId,
          objectDigest: persisted.semanticDependency.digest,
          dependency: persisted.semanticDependency,
        }),
      ]);
      expectMappedRecoverability(closure.diagnostics, 'repair');
      expectNoRawNamespaceLeak(closure.diagnostics);

      const head = await graph.readHead();
      expectReadHeadDegraded(head);
      expect(head.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
        'VERSION_DANGLING_REF',
        code,
      ]);
      expectMappedRecoverability(head.diagnostics, 'repair');
      expectNoRawNamespaceLeak(head.diagnostics);
      expect(refStore.exportSnapshot()).toEqual(refsBefore);
    },
  );

  it('rejects stale expected heads before object writes or ref mutation', async () => {
    const graph = createInMemoryVersionGraphStore({ namespace: NAMESPACE });
    const initialized = await graph.initializeGraph(await graphInput('root'));
    expectGraphSuccess(initialized);
    const refsBefore = graph.refStore.exportSnapshot();
    const objectsBefore = graph.objectStore.listObjectRecords();

    const result = await graph.commit(
      commitInput(await graphInput('stale-head'), commit('ff'), initialized.main.revision),
    );

    expectGraphFailed(result);
    expect(result.mutationGuarantee).toBe('no-write-attempted');
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'VERSION_REF_CONFLICT',
        refName: VERSION_GRAPH_MAIN_REF,
        commitId: initialized.commit.id,
        details: expect.objectContaining({
          expectedHead: commit('ff'),
          actualHead: initialized.commit.id,
        }),
      }),
    ]);
    expectMappedRecoverability(result.diagnostics, 'retry');
    expectNoRawNamespaceLeak(result.diagnostics);
    expect(graph.refStore.exportSnapshot()).toEqual(refsBefore);
    expect(graph.objectStore.listObjectRecords()).toEqual(objectsBefore);
  });
});
