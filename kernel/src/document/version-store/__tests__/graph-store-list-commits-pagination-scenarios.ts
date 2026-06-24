import {
  VERSION_GRAPH_MAIN_REF,
  createInMemoryVersionGraphStore,
  type VersionGraphCommitPageResult,
} from '../graph';
import {
  AUTHOR,
  NAMESPACE,
  commitInput,
  expectGraphSuccess,
  expectListFailed,
  expectListSuccess,
  graphInput,
} from './graph-store-test-utils';

type ListCommitsSuccess = Extract<VersionGraphCommitPageResult, { readonly status: 'success' }>;

export function registerListCommitsPaginationScenarios(): void {
  it('paginates current main commits with opaque in-memory page tokens', async () => {
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

    const firstPage = await graph.listCommits({ pageSize: 2 });

    expectListSuccess(firstPage);
    expect(firstPage.commits.map((commitRecord) => commitRecord.id)).toEqual([
      grandchild.commit.id,
      child.commit.id,
    ]);
    const nextPageToken = expectNextPageToken(firstPage);
    expect(nextPageToken).toMatch(/^vpt_/);
    expect(nextPageToken).not.toContain(grandchild.commit.id);
    expect(nextPageToken).not.toContain(child.commit.id);
    expect(nextPageToken).not.toContain(initialized.commit.id);

    const secondPage = await graph.listCommits({ pageSize: 2, pageToken: nextPageToken });

    expectListSuccess(secondPage);
    expect(secondPage.readRevision).toEqual(firstPage.readRevision);
    expect(secondPage.commits.map((commitRecord) => commitRecord.id)).toEqual([
      initialized.commit.id,
    ]);
    expect(secondPage).not.toHaveProperty('nextPageToken');
  });

  it('continues branch commit pages from the token root without a repeated ref selector', async () => {
    const graph = createInMemoryVersionGraphStore({ namespace: NAMESPACE });
    const initialized = await graph.initializeGraph(await graphInput('root'));
    expectGraphSuccess(initialized);
    const branch = graph.refStore.createBranch({
      name: 'scenario/list-commits-pagination',
      targetCommitId: initialized.commit.id,
      expectedAbsent: true,
      createdBy: AUTHOR,
    });
    expect(branch.ok).toBe(true);
    if (!branch.ok) throw new Error(`expected branch create success: ${branch.error.code}`);
    const branchCommit = await graph.commit({
      ...(await graphInput('branch')),
      targetRef: 'refs/heads/scenario/list-commits-pagination',
      expectedHeadCommitId: initialized.commit.id,
      expectedTargetRefVersion: branch.ref.refVersion,
      parentCommitIds: [initialized.commit.id],
    });
    expectGraphSuccess(branchCommit);

    const firstPage = await graph.listCommits({
      ref: 'refs/heads/scenario/list-commits-pagination',
      pageSize: 1,
    });

    expectListSuccess(firstPage);
    expect(firstPage.readRevision).toEqual(branchCommit.ref.revision);
    expect(firstPage.commits.map((commitRecord) => commitRecord.id)).toEqual([
      branchCommit.commit.id,
    ]);
    const nextPageToken = expectNextPageToken(firstPage);

    const secondPage = await graph.listCommits({ pageSize: 1, pageToken: nextPageToken });

    expectListSuccess(secondPage);
    expect(secondPage.readRevision).toEqual(branchCommit.ref.revision);
    expect(secondPage.commits.map((commitRecord) => commitRecord.id)).toEqual([
      initialized.commit.id,
    ]);
    expect(secondPage).not.toHaveProperty('nextPageToken');
  });

  it('rejects page tokens combined with a new root selector', async () => {
    const graph = createInMemoryVersionGraphStore({ namespace: NAMESPACE });
    const initialized = await graph.initializeGraph(await graphInput('root'));
    expectGraphSuccess(initialized);
    const child = await graph.commit(
      commitInput(await graphInput('child'), initialized.commit.id, initialized.main.revision),
    );
    expectGraphSuccess(child);

    const firstPage = await graph.listCommits({ pageSize: 1 });
    expectListSuccess(firstPage);
    const nextPageToken = expectNextPageToken(firstPage);

    const page = await graph.listCommits({
      ref: VERSION_GRAPH_MAIN_REF,
      pageToken: nextPageToken,
    });

    expectListFailed(page);
    expect(page.diagnostics).toEqual([
      expect.objectContaining({
        code: 'VERSION_STALE_PAGE_CURSOR',
        operation: 'listCommits',
        option: 'pageToken',
        details: expect.objectContaining({
          cursorCategory: 'refScopeMismatch',
          cursorRootMismatch: true,
        }),
      }),
    ]);
  });
}

function expectNextPageToken(page: ListCommitsSuccess): string {
  expect(page).toHaveProperty('nextPageToken', expect.any(String));
  const token = page.nextPageToken;
  if (typeof token !== 'string') {
    throw new Error('expected listCommits nextPageToken');
  }
  return token;
}
