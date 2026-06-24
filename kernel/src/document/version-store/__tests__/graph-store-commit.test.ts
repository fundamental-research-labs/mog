import {
  VERSION_GRAPH_HEAD_REF,
  VERSION_GRAPH_MAIN_REF,
  createInMemoryVersionGraphStore,
} from '../graph';
import {
  AUTHOR,
  NAMESPACE,
  commit,
  commitInput,
  expectGraphFailed,
  expectGraphSuccess,
  expectReadHeadSuccess,
  expectReadRefSuccess,
  graphInput,
  refVersion,
} from './graph-store-test-utils';

describe('InMemoryVersionGraphStore linear and branch commits', () => {
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
});
