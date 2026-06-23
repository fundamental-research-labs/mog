import { InMemoryVersionObjectStore, VersionObjectMemoryBackend } from '../object-store';
import { createInMemoryRefStore } from '../ref-store';
import {
  VERSION_GRAPH_HEAD_REF,
  VERSION_GRAPH_MAIN_REF,
  createInMemoryVersionGraphStore,
} from '../graph-store';
import {
  AUTHOR,
  NAMESPACE,
  OTHER_NAMESPACE,
  commit,
  commitInput,
  expectGraphFailed,
  expectGraphSuccess,
  expectListFailed,
  expectListSuccess,
  expectReadHeadDegraded,
  expectReadHeadSuccess,
  expectReadRefDegraded,
  expectReadRefSuccess,
  graphInput,
  objectRecord,
  persistRootCommitForReadDiagnostics,
  refVersion,
} from './graph-store-test-utils';

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

  it.each([
    { label: 'missing-dependency', code: 'VERSION_MISSING_DEPENDENCY' },
    { label: 'corrupt-dependency', code: 'VERSION_OBJECT_STORE_FAILURE' },
  ] as const)('returns structured graph read diagnostics for $label', async ({ label, code }) => {
    const backend = new VersionObjectMemoryBackend();
    const objectStore = new InMemoryVersionObjectStore(NAMESPACE, { backend });
    const graph = createInMemoryVersionGraphStore({ namespace: NAMESPACE, objectStore });
    const persisted = await persistRootCommitForReadDiagnostics(backend, objectStore, label);
    if (code === 'VERSION_OBJECT_STORE_FAILURE') {
      const corrupt = await objectRecord('workbook.semanticChangeSet.v1', {
        changes: ['corrupt'],
      });
      backend.putCorruptRecordForTesting(NAMESPACE, persisted.semanticChangeSet.digest, {
        ...corrupt,
        digest: persisted.semanticChangeSet.digest,
      });
    }
    expect(
      graph.refStore.initializeMain({ targetCommitId: persisted.commitId, createdBy: AUTHOR }),
    ).toMatchObject({ ok: true });

    const dependency = {
      kind: 'object',
      objectType: 'workbook.semanticChangeSet.v1',
      digest: persisted.semanticChangeSet.digest,
    };
    const head = await graph.readHead();
    expectReadHeadDegraded(head);
    expect(head.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'VERSION_DANGLING_REF',
      code,
    ]);
    expect(head.diagnostics[1]).toMatchObject({
      code,
      operation: 'readHead',
      commitId: persisted.commitId,
      objectDigest: persisted.semanticChangeSet.digest,
      dependency,
    });
    expect(JSON.stringify(head.diagnostics)).not.toContain('"path"');

    const closure = await graph.readCommitClosure(persisted.commitId);
    expect(closure.status).toBe('failed');
    if (closure.status !== 'failed') throw new Error('expected closure failure');
    expect(closure.diagnostics).toEqual([
      expect.objectContaining({
        code,
        operation: 'readCommitClosure',
        commitId: persisted.commitId,
        objectDigest: persisted.semanticChangeSet.digest,
      }),
    ]);

    const listed = await graph.listCommits();
    expectListFailed(listed);
    expect(listed.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'VERSION_DANGLING_REF',
      code,
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

  it('fast-forwards the target ref to an existing descendant commit without creating a commit', async () => {
    const graph = createInMemoryVersionGraphStore({ namespace: NAMESPACE });
    const initialized = await graph.initializeGraph(await graphInput('root'));
    expectGraphSuccess(initialized);
    const branch = graph.refStore.createBranch({
      name: 'scenario/fast-forward',
      targetCommitId: initialized.commit.id,
      expectedAbsent: true,
      createdBy: AUTHOR,
    });
    expect(branch.ok).toBe(true);
    if (!branch.ok) throw new Error(`expected branch create success: ${branch.error.code}`);

    const incoming = await graph.commit({
      ...(await graphInput('incoming')),
      targetRef: 'refs/heads/scenario/fast-forward',
      expectedHeadCommitId: initialized.commit.id,
      expectedTargetRefVersion: branch.ref.refVersion,
      parentCommitIds: [initialized.commit.id],
    });
    expectGraphSuccess(incoming);

    const fastForward = await graph.fastForwardRef({
      expectedHeadCommitId: initialized.commit.id,
      expectedMainRefVersion: initialized.main.revision,
      nextCommitId: incoming.commit.id,
      updatedBy: AUTHOR,
    });
    expectGraphSuccess(fastForward);
    expect(fastForward.commit.id).toBe(incoming.commit.id);
    expect(fastForward.main).toMatchObject({
      name: VERSION_GRAPH_MAIN_REF,
      commitId: incoming.commit.id,
      revision: refVersion('1'),
    });

    const page = await graph.listCommits();
    expectListSuccess(page);
    expect(page.commits.map((commitRecord) => commitRecord.id)).toEqual([
      incoming.commit.id,
      initialized.commit.id,
    ]);
    expect(page.commits[0].parents).toEqual([initialized.commit.id]);

    const stale = await graph.fastForwardRef({
      expectedHeadCommitId: initialized.commit.id,
      expectedMainRefVersion: initialized.main.revision,
      nextCommitId: incoming.commit.id,
      updatedBy: AUTHOR,
    });
    expectGraphFailed(stale);
    expect(stale).toMatchObject({
      mutationGuarantee: 'no-write-attempted',
      diagnostics: [expect.objectContaining({ code: 'VERSION_REF_CONFLICT' })],
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
