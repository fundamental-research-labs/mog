import {
  PARENT_A_COMMIT_ID,
  PARENT_B_COMMIT_ID,
  ROOT_COMMIT_ID,
  childCommitSummary,
  createFakeGraphStore,
  createVersion,
  mergeCommitSummary,
  parentCommitSummary,
  rootCommitSummary,
  successPage,
} from './version-list-commits-selectors-test-utils';

describe('WorkbookVersion listCommits selector provider payload validation', () => {
  it('rejects provider pages that violate root traversal and topological order', async () => {
    const graphStore = createFakeGraphStore();
    const version = createVersion(graphStore);

    graphStore.listCommits.mockResolvedValueOnce(successPage());
    await expect(version.listCommits({ from: ROOT_COMMIT_ID })).resolves.toMatchObject({
      ok: false,
      error: {
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_INVALID_COMMIT_PAYLOAD',
            data: expect.objectContaining({
              payload: expect.objectContaining({ rootMismatch: true }),
            }),
          }),
        ],
      },
    });
    expect(graphStore.listCommits).toHaveBeenLastCalledWith({ from: ROOT_COMMIT_ID });

    graphStore.listCommits.mockResolvedValueOnce(
      successPage({ commits: [rootCommitSummary(), childCommitSummary()] }),
    );
    await expect(version.listCommits()).resolves.toMatchObject({
      ok: false,
      error: {
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_INVALID_COMMIT_PAYLOAD',
            data: expect.objectContaining({
              payload: expect.objectContaining({ itemIndex: 1, rootTraversal: false }),
            }),
          }),
        ],
      },
    });
    expect(graphStore.listCommits).toHaveBeenLastCalledWith({});

    graphStore.listCommits.mockResolvedValueOnce(successPage({ order: 'semantic-change-order' }));
    await expect(version.listCommits()).resolves.toMatchObject({
      ok: false,
      error: {
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_INVALID_COMMIT_PAYLOAD',
            data: expect.objectContaining({
              payload: expect.objectContaining({ orderMismatch: true }),
            }),
          }),
        ],
      },
    });
    expect(graphStore.listCommits).toHaveBeenLastCalledWith({});

    graphStore.listCommits.mockResolvedValueOnce(
      successPage({
        commits: [
          mergeCommitSummary(),
          parentCommitSummary(PARENT_B_COMMIT_ID),
          parentCommitSummary(PARENT_A_COMMIT_ID),
        ],
      }),
    );
    await expect(version.listCommits()).resolves.toMatchObject({
      ok: false,
      error: {
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_INVALID_COMMIT_PAYLOAD',
            data: expect.objectContaining({
              payload: expect.objectContaining({ deterministicOrder: false }),
            }),
          }),
        ],
      },
    });
    expect(graphStore.listCommits).toHaveBeenLastCalledWith({});
  });
});
