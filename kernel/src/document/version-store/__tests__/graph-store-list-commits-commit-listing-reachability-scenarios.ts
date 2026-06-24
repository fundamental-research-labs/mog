import { VERSION_GRAPH_MAIN_REF, createInMemoryVersionGraphStore } from '../graph';
import {
  AUTHOR,
  NAMESPACE,
  commitInput,
  expectGraphSuccess,
  expectListSuccess,
  graphInput,
} from './graph-store-test-utils';

export function registerListCommitsCommitListingReachabilityScenarios(): void {
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

    const mainPage = await graph.listCommits({ ref: VERSION_GRAPH_MAIN_REF });
    expectListSuccess(mainPage);
    expect(mainPage.commits.map((commitRecord) => commitRecord.id)).toEqual([
      grandchild.commit.id,
      child.commit.id,
      initialized.commit.id,
    ]);
  });

  it('lists commits reachable from a branch ref head', async () => {
    const graph = createInMemoryVersionGraphStore({ namespace: NAMESPACE });
    const initialized = await graph.initializeGraph(await graphInput('root'));
    expectGraphSuccess(initialized);
    const branch = graph.refStore.createBranch({
      name: 'scenario/list-commits',
      targetCommitId: initialized.commit.id,
      expectedAbsent: true,
      createdBy: AUTHOR,
    });
    expect(branch.ok).toBe(true);
    if (!branch.ok) throw new Error(`expected branch create success: ${branch.error.code}`);

    const main = await graph.commit(
      commitInput(await graphInput('main'), initialized.commit.id, initialized.main.revision),
    );
    expectGraphSuccess(main);
    const branchCommit = await graph.commit({
      ...(await graphInput('branch')),
      targetRef: 'refs/heads/scenario/list-commits',
      expectedHeadCommitId: initialized.commit.id,
      expectedTargetRefVersion: branch.ref.refVersion,
      parentCommitIds: [initialized.commit.id],
    });
    expectGraphSuccess(branchCommit);

    const page = await graph.listCommits({ ref: 'refs/heads/scenario/list-commits' });
    expectListSuccess(page);
    expect(page.readRevision).toEqual(branchCommit.ref.revision);
    expect(page.commits.map((commitRecord) => commitRecord.id)).toEqual([
      branchCommit.commit.id,
      initialized.commit.id,
    ]);
  });

  it('lists commits reachable from an explicit commit id', async () => {
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

    const page = await graph.listCommits({ from: child.commit.id });
    expectListSuccess(page);
    expect(page.readRevision).toEqual(grandchild.main.revision);
    expect(page.commits.map((commitRecord) => commitRecord.id)).toEqual([
      child.commit.id,
      initialized.commit.id,
    ]);
  });
}
