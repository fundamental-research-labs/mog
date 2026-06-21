import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import {
  parseWorkbookCommitId,
  type VersionDependencyRef,
  type VersionObjectType,
  type WorkbookCommitId,
} from '../object-digest';
import {
  InMemoryVersionObjectStore,
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../object-store';
import { createInMemoryRefStore, type RefVersion } from '../ref-store';
import {
  VERSION_GRAPH_MAIN_REF,
  createInMemoryVersionGraphStore,
  type CommitVersionGraphInput,
  type InitializeVersionGraphInput,
  type VersionGraphWriteResult,
} from '../graph-store';

const NAMESPACE: VersionGraphNamespace = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  graphId: 'graph-1',
  principalScope: 'principal-1',
};

const OTHER_NAMESPACE: VersionGraphNamespace = {
  ...NAMESPACE,
  documentId: 'document-2',
};

const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

function commit(byte: string): WorkbookCommitId {
  return parseWorkbookCommitId(`commit:sha256:${byte.repeat(32)}`);
}

function refVersion(value: string): RefVersion {
  return { kind: 'counter', value };
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

async function objectRecord(
  objectType: VersionObjectType,
  payload: unknown,
  namespace: VersionGraphNamespace = NAMESPACE,
  dependencies: readonly VersionDependencyRef[] = [],
): Promise<VersionObjectRecord<unknown>> {
  return createVersionObjectRecord(namespace, {
    objectType,
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies,
    payload,
  });
}

async function graphInput(
  label: string,
  namespace: VersionGraphNamespace = NAMESPACE,
  snapshotDependencies: readonly VersionDependencyRef[] = [],
): Promise<InitializeVersionGraphInput> {
  const snapshotRootRecord = await objectRecord(
    'workbook.snapshotRoot.v1',
    { label, sheets: [] },
    namespace,
    snapshotDependencies,
  );
  const semanticChangeSetRecord = await objectRecord(
    'workbook.semanticChangeSet.v1',
    { label, changes: [] },
    namespace,
  );

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
  parentCommitIds?: readonly WorkbookCommitId[],
): CommitVersionGraphInput {
  return {
    ...input,
    expectedHeadCommitId,
    expectedMainRefVersion,
    ...(parentCommitIds === undefined ? {} : { parentCommitIds }),
  };
}

describe('InMemoryVersionGraphStore initialization', () => {
  it('initializes a graph with a root commit and refs/heads/main', async () => {
    const graph = createInMemoryVersionGraphStore({ namespace: NAMESPACE });
    const initialized = await graph.initializeGraph(await graphInput('root'));
    expectGraphSuccess(initialized);

    expect(initialized.main).toMatchObject({
      name: VERSION_GRAPH_MAIN_REF,
      commitId: initialized.commit.id,
      revision: refVersion('0'),
    });
    expect(initialized.commit.payload.parentCommitIds).toEqual([]);

    const closure = await graph.readCommitClosure(initialized.commit.id);
    expect(closure.status).toBe('success');
    if (closure.status !== 'success') throw new Error('expected closure success');
    expect(closure.commits.map((commitRecord) => commitRecord.id)).toEqual([initialized.commit.id]);
  });

  it('is idempotent when the same root commit is initialized again', async () => {
    const graph = createInMemoryVersionGraphStore({ namespace: NAMESPACE });
    const input = await graphInput('root');

    const first = await graph.initializeGraph(input);
    const second = await graph.initializeGraph(input);

    expectGraphSuccess(first);
    expectGraphSuccess(second);
    expect(second.commit.id).toBe(first.commit.id);
    expect(second.main).toEqual(first.main);
  });
});

describe('InMemoryVersionGraphStore normal commits', () => {
  it('creates a single-parent commit and advances refs/heads/main by CAS', async () => {
    const graph = createInMemoryVersionGraphStore({ namespace: NAMESPACE });
    const initialized = await graph.initializeGraph(await graphInput('root'));
    expectGraphSuccess(initialized);

    const committed = await graph.commit(
      commitInput(await graphInput('child'), initialized.commit.id, initialized.main.revision),
    );
    expectGraphSuccess(committed);

    expect(committed.commit.payload.parentCommitIds).toEqual([initialized.commit.id]);
    expect(committed.main).toMatchObject({
      name: VERSION_GRAPH_MAIN_REF,
      commitId: committed.commit.id,
      revision: refVersion('1'),
    });

    const closure = await graph.readCommitClosure(committed.commit.id);
    expect(closure.status).toBe('success');
    if (closure.status !== 'success') throw new Error('expected closure success');
    expect(closure.commits.map((commitRecord) => commitRecord.id)).toEqual([
      committed.commit.id,
      initialized.commit.id,
    ]);
  });

  it('rejects stale expected-head commits without advancing main', async () => {
    const graph = createInMemoryVersionGraphStore({ namespace: NAMESPACE });
    const initialized = await graph.initializeGraph(await graphInput('root'));
    expectGraphSuccess(initialized);

    const stale = await graph.commit(
      commitInput(await graphInput('stale'), commit('ff'), initialized.main.revision),
    );

    expectGraphFailed(stale);
    expect(stale.mutationGuarantee).toBe('no-write-attempted');
    expect(stale.diagnostics[0]).toMatchObject({ code: 'VERSION_REF_CONFLICT' });
    expect(graph.refStore.getRef('main')).toMatchObject({
      ok: true,
      ref: { targetCommitId: initialized.commit.id, refVersion: initialized.main.revision },
    });
  });

  it('rejects a missing current parent before advancing main', async () => {
    const objectStore = new InMemoryVersionObjectStore(NAMESPACE);
    const refStore = createInMemoryRefStore({ versionDocumentId: NAMESPACE.documentId });
    const missingParent = commit('ee');
    const main = refStore.initializeMain({ targetCommitId: missingParent, createdBy: AUTHOR });
    expect(main.ok).toBe(true);
    if (!main.ok) throw new Error('expected fake main initialization');
    const graph = createInMemoryVersionGraphStore({ namespace: NAMESPACE, objectStore, refStore });

    const result = await graph.commit(
      commitInput(await graphInput('missing-parent'), missingParent, main.ref.refVersion),
    );

    expectGraphFailed(result);
    expect(result.mutationGuarantee).toBe('ref-not-mutated');
    expect(result.diagnostics[0]).toMatchObject({ code: 'VERSION_MISSING_PARENT' });
    expect(refStore.getRef('main')).toMatchObject({
      ok: true,
      ref: { targetCommitId: missingParent, refVersion: main.ref.refVersion },
    });
  });

  it('rejects wrong-namespace dependency records before object writes', async () => {
    const graph = createInMemoryVersionGraphStore({ namespace: NAMESPACE });
    const initialized = await graph.initializeGraph(await graphInput('root'));
    expectGraphSuccess(initialized);

    const result = await graph.commit(
      commitInput(
        await graphInput('wrong-namespace', OTHER_NAMESPACE),
        initialized.commit.id,
        initialized.main.revision,
      ),
    );

    expectGraphFailed(result);
    expect(result.mutationGuarantee).toBe('no-write-attempted');
    expect(result.diagnostics[0]).toMatchObject({ code: 'VERSION_WRONG_NAMESPACE' });
    expect(graph.refStore.getRef('main')).toMatchObject({
      ok: true,
      ref: { targetCommitId: initialized.commit.id, refVersion: initialized.main.revision },
    });
  });

  it('rejects unsupported multi-parent creation in VC-04', async () => {
    const graph = createInMemoryVersionGraphStore({ namespace: NAMESPACE });
    const initialized = await graph.initializeGraph(await graphInput('root'));
    expectGraphSuccess(initialized);

    const result = await graph.commit(
      commitInput(await graphInput('merge'), initialized.commit.id, initialized.main.revision, [
        initialized.commit.id,
        initialized.commit.id,
      ]),
    );

    expectGraphFailed(result);
    expect(result.mutationGuarantee).toBe('no-write-attempted');
    expect(result.diagnostics[0]).toMatchObject({
      code: 'VERSION_UNSUPPORTED_PARENT_COMMIT',
    });
  });

  it('returns object-store failure diagnostics without advancing main', async () => {
    const graph = createInMemoryVersionGraphStore({ namespace: NAMESPACE });
    const initialized = await graph.initializeGraph(await graphInput('root'));
    expectGraphSuccess(initialized);
    const missingChunk = await objectRecord('workbook.snapshotChunk.v1', {
      chunkId: 'missing',
    });

    const result = await graph.commit(
      commitInput(
        await graphInput('object-store-failure', NAMESPACE, [
          {
            kind: 'object',
            objectType: 'workbook.snapshotChunk.v1',
            digest: missingChunk.digest,
          },
        ]),
        initialized.commit.id,
        initialized.main.revision,
      ),
    );

    expectGraphFailed(result);
    expect(result.mutationGuarantee).toBe('ref-not-mutated');
    expect(result.diagnostics[0]).toMatchObject({ code: 'VERSION_OBJECT_STORE_FAILURE' });
    expect(graph.refStore.getRef('main')).toMatchObject({
      ok: true,
      ref: { targetCommitId: initialized.commit.id, refVersion: initialized.main.revision },
    });
  });
});
