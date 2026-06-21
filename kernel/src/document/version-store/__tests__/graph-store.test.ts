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
  VERSION_GRAPH_HEAD_REF,
  VERSION_GRAPH_MAIN_REF,
  createInMemoryVersionGraphStore,
  type CommitVersionGraphInput,
  type InitializeVersionGraphInput,
  type VersionGraphCommitPageResult,
  type VersionGraphReadHeadResult,
  type VersionGraphReadRefResult,
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

function expectReadHeadSuccess(
  result: VersionGraphReadHeadResult,
): asserts result is Extract<VersionGraphReadHeadResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected readHead success: ${result.diagnostics[0]?.code}`);
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

function expectReadRefSuccess(
  result: VersionGraphReadRefResult,
): asserts result is Extract<VersionGraphReadRefResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected readRef success: ${result.diagnostics[0]?.code}`);
  }
}

function expectReadRefDegraded(
  result: VersionGraphReadRefResult,
): asserts result is Extract<VersionGraphReadRefResult, { status: 'degraded' }> {
  expect(result.status).toBe('degraded');
  if (result.status !== 'degraded') {
    throw new Error('expected readRef degraded result');
  }
}

function expectListSuccess(
  result: VersionGraphCommitPageResult,
): asserts result is Extract<VersionGraphCommitPageResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected listCommits success: ${result.diagnostics[0]?.code}`);
  }
}

function expectListFailed(
  result: VersionGraphCommitPageResult,
): asserts result is Extract<VersionGraphCommitPageResult, { status: 'failed' }> {
  expect(result.status).toBe('failed');
  if (result.status !== 'failed') {
    throw new Error('expected listCommits failure');
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
  it('returns degraded read diagnostics before main is initialized', async () => {
    const graph = createInMemoryVersionGraphStore({ namespace: NAMESPACE });

    const head = await graph.readHead();
    expectReadHeadDegraded(head);
    expect(head.head).toBeNull();
    expect(head.diagnostics).toEqual([
      expect.objectContaining({
        code: 'VERSION_GRAPH_UNINITIALIZED',
        operation: 'readHead',
        refName: VERSION_GRAPH_MAIN_REF,
      }),
    ]);

    const symbolic = await graph.readRef(VERSION_GRAPH_HEAD_REF);
    expectReadRefDegraded(symbolic);
    expect(symbolic.ref).toBeNull();
    expect(symbolic.diagnostics).toEqual([
      expect.objectContaining({
        code: 'VERSION_GRAPH_UNINITIALIZED',
        operation: 'readRef',
        refName: VERSION_GRAPH_MAIN_REF,
      }),
    ]);

    const main = await graph.readRef(VERSION_GRAPH_MAIN_REF);
    expectReadRefDegraded(main);
    expect(main.ref).toBeNull();
    expect(main.diagnostics[0]).toMatchObject({
      code: 'VERSION_GRAPH_UNINITIALIZED',
      operation: 'readRef',
    });
  });

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

  it('reads HEAD and refs/heads/main after initialization', async () => {
    const graph = createInMemoryVersionGraphStore({ namespace: NAMESPACE });
    const initialized = await graph.initializeGraph(await graphInput('root'));
    expectGraphSuccess(initialized);

    const head = await graph.readHead();
    expectReadHeadSuccess(head);
    expect(head.head).toEqual({
      id: initialized.commit.id,
      refName: VERSION_GRAPH_MAIN_REF,
      resolvedFrom: VERSION_GRAPH_HEAD_REF,
      refRevision: initialized.main.revision,
    });
    expect(head.main).toEqual(initialized.main);

    const symbolic = await graph.readRef(VERSION_GRAPH_HEAD_REF);
    expectReadRefSuccess(symbolic);
    expect(symbolic.ref).toEqual({
      name: VERSION_GRAPH_HEAD_REF,
      target: VERSION_GRAPH_MAIN_REF,
      revision: initialized.main.revision,
    });

    const main = await graph.readRef(VERSION_GRAPH_MAIN_REF);
    expectReadRefSuccess(main);
    expect(main.ref).toEqual(initialized.main);
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

  it('reads the advanced HEAD and main ref after a normal commit', async () => {
    const graph = createInMemoryVersionGraphStore({ namespace: NAMESPACE });
    const initialized = await graph.initializeGraph(await graphInput('root'));
    expectGraphSuccess(initialized);
    const committed = await graph.commit(
      commitInput(await graphInput('child'), initialized.commit.id, initialized.main.revision),
    );
    expectGraphSuccess(committed);

    const head = await graph.readHead();
    expectReadHeadSuccess(head);
    expect(head.head).toMatchObject({
      id: committed.commit.id,
      refName: VERSION_GRAPH_MAIN_REF,
      resolvedFrom: VERSION_GRAPH_HEAD_REF,
      refRevision: committed.main.revision,
    });

    const main = await graph.readRef(VERSION_GRAPH_MAIN_REF);
    expectReadRefSuccess(main);
    expect(main.ref).toEqual(committed.main);
  });

  it('creates a single-parent commit on a branch ref without advancing main', async () => {
    const graph = createInMemoryVersionGraphStore({ namespace: NAMESPACE });
    const initialized = await graph.initializeGraph(await graphInput('root'));
    expectGraphSuccess(initialized);
    const branch = graph.refStore.createBranch({
      name: 'scenario/branch-commit',
      targetCommitId: initialized.commit.id,
      expectedAbsent: true,
      createdBy: AUTHOR,
    });
    expect(branch.ok).toBe(true);
    if (!branch.ok) throw new Error(`expected branch create success: ${branch.error.code}`);

    const committed = await graph.commit({
      ...(await graphInput('branch-child')),
      targetRef: 'refs/heads/scenario/branch-commit',
      expectedHeadCommitId: initialized.commit.id,
      expectedTargetRefVersion: branch.ref.refVersion,
      parentCommitIds: [initialized.commit.id],
    });
    expectGraphSuccess(committed);

    expect(committed.commit.payload.parentCommitIds).toEqual([initialized.commit.id]);
    expect(committed.ref).toMatchObject({
      name: 'refs/heads/scenario/branch-commit',
      commitId: committed.commit.id,
      revision: refVersion('1'),
    });
    expect(committed.main).toEqual(initialized.main);

    const branchRef = await graph.readRef('refs/heads/scenario/branch-commit');
    expectReadRefSuccess(branchRef);
    expect(branchRef.ref).toEqual(committed.ref);

    const main = await graph.readRef(VERSION_GRAPH_MAIN_REF);
    expectReadRefSuccess(main);
    expect(main.ref).toEqual(initialized.main);
  });

  it('rejects stale branch target commits without advancing the branch', async () => {
    const graph = createInMemoryVersionGraphStore({ namespace: NAMESPACE });
    const initialized = await graph.initializeGraph(await graphInput('root'));
    expectGraphSuccess(initialized);
    const branch = graph.refStore.createBranch({
      name: 'scenario/stale-branch',
      targetCommitId: initialized.commit.id,
      expectedAbsent: true,
      createdBy: AUTHOR,
    });
    expect(branch.ok).toBe(true);
    if (!branch.ok) throw new Error(`expected branch create success: ${branch.error.code}`);

    const first = await graph.commit({
      ...(await graphInput('branch-first')),
      targetRef: 'refs/heads/scenario/stale-branch',
      expectedHeadCommitId: initialized.commit.id,
      expectedTargetRefVersion: branch.ref.refVersion,
    });
    expectGraphSuccess(first);

    const stale = await graph.commit({
      ...(await graphInput('branch-stale')),
      targetRef: 'refs/heads/scenario/stale-branch',
      expectedHeadCommitId: initialized.commit.id,
      expectedTargetRefVersion: branch.ref.refVersion,
    });
    expectGraphFailed(stale);
    expect(stale.mutationGuarantee).toBe('no-write-attempted');
    expect(stale.diagnostics[0]).toMatchObject({
      code: 'VERSION_REF_CONFLICT',
      refName: 'refs/heads/scenario/stale-branch',
    });

    const branchRef = await graph.readRef('refs/heads/scenario/stale-branch');
    expectReadRefSuccess(branchRef);
    expect(branchRef.ref).toEqual(first.ref);
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

  it('returns dangling-ref diagnostics when main points at a missing commit', async () => {
    const objectStore = new InMemoryVersionObjectStore(NAMESPACE);
    const refStore = createInMemoryRefStore({ versionDocumentId: NAMESPACE.documentId });
    const missingParent = commit('ed');
    const main = refStore.initializeMain({ targetCommitId: missingParent, createdBy: AUTHOR });
    expect(main.ok).toBe(true);
    if (!main.ok) throw new Error('expected fake main initialization');
    const graph = createInMemoryVersionGraphStore({ namespace: NAMESPACE, objectStore, refStore });

    const head = await graph.readHead();
    expectReadHeadDegraded(head);
    expect(head.main).toMatchObject({ name: VERSION_GRAPH_MAIN_REF, commitId: missingParent });
    expect(head.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'VERSION_DANGLING_REF',
      'VERSION_MISSING_OBJECT',
    ]);
    expect(head.diagnostics[0]).toMatchObject({
      operation: 'readHead',
      refName: VERSION_GRAPH_MAIN_REF,
      commitId: missingParent,
      objectKind: 'commit',
    });

    const symbolic = await graph.readRef(VERSION_GRAPH_HEAD_REF);
    expectReadRefDegraded(symbolic);
    expect(symbolic.ref).toEqual({
      name: VERSION_GRAPH_HEAD_REF,
      target: VERSION_GRAPH_MAIN_REF,
      revision: main.ref.refVersion,
    });
    expect(symbolic.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'VERSION_DANGLING_REF',
      'VERSION_MISSING_OBJECT',
    ]);

    const listed = await graph.listCommits();
    expectListFailed(listed);
    expect(listed.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'VERSION_DANGLING_REF',
      'VERSION_MISSING_OBJECT',
    ]);
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

  it('creates explicit two-parent merge commits by advancing the target ref head', async () => {
    const graph = createInMemoryVersionGraphStore({ namespace: NAMESPACE });
    const initialized = await graph.initializeGraph(await graphInput('root'));
    expectGraphSuccess(initialized);
    const branch = graph.refStore.createBranch({
      name: 'scenario/merge-parent',
      targetCommitId: initialized.commit.id,
      expectedAbsent: true,
      createdBy: AUTHOR,
    });
    expect(branch.ok).toBe(true);
    if (!branch.ok) throw new Error(`expected branch create success: ${branch.error.code}`);

    const ours = await graph.commit(
      commitInput(await graphInput('ours'), initialized.commit.id, initialized.main.revision),
    );
    expectGraphSuccess(ours);
    const theirs = await graph.commit({
      ...(await graphInput('theirs')),
      targetRef: 'refs/heads/scenario/merge-parent',
      expectedHeadCommitId: initialized.commit.id,
      expectedTargetRefVersion: branch.ref.refVersion,
      parentCommitIds: [initialized.commit.id],
    });
    expectGraphSuccess(theirs);

    const merge = await graph.mergeCommit({
      ...(await graphInput('merge')),
      expectedHeadCommitId: ours.commit.id,
      expectedMainRefVersion: ours.main.revision,
      mergeParentCommitId: theirs.commit.id,
    });
    expectGraphSuccess(merge);

    expect(merge.commit.payload.parentCommitIds).toEqual([ours.commit.id, theirs.commit.id]);
    expect(merge.main).toMatchObject({
      name: VERSION_GRAPH_MAIN_REF,
      commitId: merge.commit.id,
      revision: refVersion('2'),
    });

    const closure = await graph.readCommitClosure(merge.commit.id);
    expect(closure.status).toBe('success');
    if (closure.status !== 'success') throw new Error('expected closure success');
    expect(new Set(closure.commits.map((commitRecord) => commitRecord.id))).toEqual(
      new Set([merge.commit.id, ours.commit.id, theirs.commit.id, initialized.commit.id]),
    );

    const page = await graph.listCommits();
    expectListSuccess(page);
    expect(page.commits[0]).toMatchObject({
      id: merge.commit.id,
      parents: [ours.commit.id, theirs.commit.id],
    });
  });

  it('rejects merge commits whose second parent is the current target head', async () => {
    const graph = createInMemoryVersionGraphStore({ namespace: NAMESPACE });
    const initialized = await graph.initializeGraph(await graphInput('root'));
    expectGraphSuccess(initialized);

    const result = await graph.mergeCommit({
      ...(await graphInput('not-a-merge')),
      expectedHeadCommitId: initialized.commit.id,
      expectedMainRefVersion: initialized.main.revision,
      mergeParentCommitId: initialized.commit.id,
    });

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

describe('InMemoryVersionGraphStore commit listing', () => {
  it('lists current main commits in topological newest-first order', async () => {
    const graph = createInMemoryVersionGraphStore({ namespace: NAMESPACE });
    const initialized = await graph.initializeGraph(await graphInput('root'));
    expectGraphSuccess(initialized);
    const child = await graph.commit(
      commitInput(await graphInput('child'), initialized.commit.id, initialized.main.revision),
    );
    expectGraphSuccess(child);
    const grandchild = await graph.commit(
      commitInput(await graphInput('grandchild'), child.commit.id, child.main.revision),
    );
    expectGraphSuccess(grandchild);

    const page = await graph.listCommits();
    expectListSuccess(page);
    expect(page).toMatchObject({
      order: 'topological-newest',
      pageSize: 50,
      readRevision: grandchild.main.revision,
    });
    expect(page.commits.map((commitRecord) => commitRecord.id)).toEqual([
      grandchild.commit.id,
      child.commit.id,
      initialized.commit.id,
    ]);
    expect(page.commits.map((commitRecord) => commitRecord.parents)).toEqual([
      [child.commit.id],
      [initialized.commit.id],
      [],
    ]);
  });

  it('rejects invalid list page sizes before reading refs', async () => {
    const graph = createInMemoryVersionGraphStore({ namespace: NAMESPACE });

    for (const pageSize of [0, 501, 1.5]) {
      const page = await graph.listCommits({ pageSize });
      expectListFailed(page);
      expect(page.diagnostics).toEqual([
        expect.objectContaining({
          code: 'VERSION_INVALID_OPTIONS',
          operation: 'listCommits',
          option: 'pageSize',
        }),
      ]);
    }
  });

  it('returns an explicit stale cursor diagnostic for unsupported page tokens', async () => {
    const graph = createInMemoryVersionGraphStore({ namespace: NAMESPACE });

    const page = await graph.listCommits({ pageToken: 'vpt_pending_token_1234' });
    expectListFailed(page);
    expect(page.diagnostics).toEqual([
      expect.objectContaining({
        code: 'VERSION_STALE_PAGE_CURSOR',
        operation: 'listCommits',
        option: 'pageToken',
        details: { pageTokenUnsupported: true },
      }),
    ]);
  });
});
