import { VERSION_GRAPH_MAIN_REF, createInMemoryVersionGraphStore } from '../graph';
import {
  AUTHOR,
  NAMESPACE,
  commitInput,
  expectGraphFailed,
  expectGraphSuccess,
  expectListSuccess,
  graphInput,
  refVersion,
} from './graph-store-test-utils';

describe('InMemoryVersionGraphStore merge and fast-forward writes', () => {
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
});
