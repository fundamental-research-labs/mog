import {
  CHILD_COMMIT_ID,
  CREATED_AT,
  PAGE_TOKEN,
  PUBLIC_LIST_PAGE_TOKEN,
  ROOT_COMMIT_ID,
  createFakeGraphStore,
  createVersion,
  rootCommitSummary,
  successPage,
} from './version-list-commits-selectors-test-utils';

describe('WorkbookVersion listCommits selector forwarding', () => {
  it('forwards public ref and commit roots without leaking unsupported options to the graph service', async () => {
    const graphStore = createFakeGraphStore();
    graphStore.listCommits
      .mockResolvedValueOnce(successPage())
      .mockResolvedValueOnce(successPage())
      .mockResolvedValueOnce(successPage({ commits: [rootCommitSummary()] }))
      .mockResolvedValueOnce(successPage())
      .mockResolvedValueOnce(successPage());
    const version = createVersion(graphStore);

    await expect(version.listCommits({ ref: 'refs/heads/main', pageSize: 2 })).resolves.toEqual({
      ok: true,
      value: {
        items: [
          {
            id: CHILD_COMMIT_ID,
            parents: [ROOT_COMMIT_ID],
            createdAt: CREATED_AT,
            author: {
              actorKind: 'user',
              displayName: 'Public Reader',
              redacted: true,
            },
          },
          {
            id: ROOT_COMMIT_ID,
            parents: [],
            createdAt: CREATED_AT,
            author: {
              actorKind: 'system',
              redacted: true,
            },
          },
        ],
        limit: 2,
      },
    });
    expect(graphStore.listCommits).toHaveBeenLastCalledWith({
      ref: 'refs/heads/main',
      pageSize: 2,
    });

    await expect(version.listCommits({ ref: 'HEAD' })).resolves.toMatchObject({
      ok: true,
      value: { limit: 50 },
    });
    expect(graphStore.listCommits).toHaveBeenLastCalledWith({ ref: 'HEAD' });

    await expect(
      version.listCommits({ from: ROOT_COMMIT_ID, includeDiagnostics: true }),
    ).resolves.toMatchObject({
      ok: true,
      value: { limit: 50 },
    });
    expect(graphStore.listCommits).toHaveBeenLastCalledWith({ from: ROOT_COMMIT_ID });

    await expect(version.listCommits({ pageToken: PAGE_TOKEN })).resolves.toMatchObject({
      ok: true,
      value: { limit: 50 },
    });
    expect(graphStore.listCommits).toHaveBeenLastCalledWith({ pageToken: PAGE_TOKEN });

    await expect(version.listCommits({ pageToken: PUBLIC_LIST_PAGE_TOKEN })).resolves.toMatchObject(
      {
        ok: true,
        value: { limit: 50 },
      },
    );
    expect(graphStore.listCommits).toHaveBeenLastCalledWith({
      pageToken: PUBLIC_LIST_PAGE_TOKEN,
    });
  });
});
