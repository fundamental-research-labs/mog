import {
  CHILD_COMMIT_ID,
  MISSING_COMMIT_ID,
  PAGE_TOKEN,
  PARENT_A_COMMIT_ID,
  PUBLIC_LIST_PAGE_TOKEN,
  createFakeGraphStore,
  createVersion,
  expectUnavailable,
  successPage,
} from './version-list-commits-selectors-test-utils';

describe('WorkbookVersion listCommits selector diagnostics', () => {
  it('maps provider selector diagnostics and next page tokens through the public envelope', async () => {
    const graphStore = createFakeGraphStore();
    graphStore.listCommits
      .mockResolvedValueOnce({
        status: 'failed',
        diagnostics: [
          {
            code: 'VERSION_INVALID_OPTIONS',
            severity: 'error',
            message: 'Branch ref is not present.',
            operation: 'listCommits',
            option: 'ref',
            details: { refMissing: true },
          },
        ],
      })
      .mockResolvedValueOnce({
        status: 'failed',
        diagnostics: [
          {
            code: 'VERSION_MISSING_OBJECT',
            severity: 'error',
            message: 'Commit object is missing.',
            operation: 'listCommits',
            commitId: MISSING_COMMIT_ID,
            objectKind: 'commit',
            details: { rootKind: 'commit', rootMissing: true },
          },
        ],
      })
      .mockResolvedValueOnce({
        status: 'failed',
        diagnostics: [
          {
            code: 'VERSION_STALE_PAGE_CURSOR',
            severity: 'error',
            message: 'Page cursor is stale.',
            operation: 'listCommits',
            option: 'pageToken',
          },
        ],
      })
      .mockResolvedValueOnce({
        status: 'failed',
        diagnostics: [
          {
            code: 'VERSION_INDEX_REBUILD_REQUIRED',
            severity: 'error',
            message: 'missing index manifest at /private/path/raw-ref-secret',
            operation: 'listCommits:/private/path/raw-ref-secret',
            option: 'pageToken',
            refName: 'refs/heads/scenario/raw-ref-secret',
            objectKind: 'index',
            details: {
              indexManifestMissing: true,
              indexRebuildRequired: true,
              objectKind: 'index',
              category: 'raw-ref-secret',
              cursor: 'cursor-secret',
              path: '/private/path/raw-ref-secret',
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        status: 'failed',
        diagnostics: [
          {
            code: 'VERSION_MISSING_PARENT',
            severity: 'corruption',
            message: `missing parent ${PARENT_A_COMMIT_ID} from child ${CHILD_COMMIT_ID}`,
            operation: 'listCommits:/private/path/raw-ref-secret',
            commitId: PARENT_A_COMMIT_ID,
            objectKind: 'commit',
            details: {
              completenessMarker: 'diagnostic-read',
              completenessScope: 'graph-metadata',
              completenessCondition: 'history-gap',
              accessFiltered: true,
              missingCommitRole: 'parent',
              childCommitId: CHILD_COMMIT_ID,
              refName: 'refs/heads/scenario/raw-ref-secret',
              path: '/private/path/raw-ref-secret',
              category: 'raw-ref-secret',
            },
          },
        ],
      })
      .mockResolvedValueOnce(successPage({ nextPageToken: 'bad-token' }))
      .mockResolvedValueOnce(successPage({ nextPageToken: 'vpt_next_page' }))
      .mockResolvedValueOnce(successPage({ nextPageToken: PUBLIC_LIST_PAGE_TOKEN }));
    const version = createVersion(graphStore);

    await expect(
      version.listCommits({ ref: 'refs/heads/scenario/missing' }),
    ).resolves.toMatchObject(expectUnavailable('VERSION_INVALID_OPTIONS', 'ref'));
    expect(graphStore.listCommits).toHaveBeenLastCalledWith({ ref: 'refs/heads/scenario/missing' });

    const missingRootResult = await version.listCommits({ from: MISSING_COMMIT_ID });
    expect(missingRootResult).toMatchObject({
      ...expectUnavailable('VERSION_MISSING_OBJECT'),
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.listCommits',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_MISSING_OBJECT',
            data: expect.objectContaining({
              recoverability: 'repair',
              payload: expect.objectContaining({
                operation: 'listCommits',
                rootKind: 'commit',
                rootMissing: true,
              }),
            }),
          }),
        ],
      },
    });
    expect(graphStore.listCommits).toHaveBeenLastCalledWith({ from: MISSING_COMMIT_ID });
    expect(JSON.stringify(missingRootResult)).not.toContain(MISSING_COMMIT_ID);

    await expect(version.listCommits({ pageToken: PAGE_TOKEN })).resolves.toMatchObject(
      expectUnavailable('VERSION_STALE_PAGE_CURSOR', 'pageToken'),
    );
    expect(graphStore.listCommits).toHaveBeenLastCalledWith({ pageToken: PAGE_TOKEN });

    const missingIndexResult = await version.listCommits({ ref: 'refs/heads/main' });
    expect(missingIndexResult).toMatchObject({
      ok: false,
      error: {
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_INDEX_REBUILD_REQUIRED',
            data: expect.objectContaining({
              recoverability: 'repair',
              payload: expect.objectContaining({
                operation: 'listCommits',
                option: 'pageToken',
                objectKind: 'index',
                indexManifestMissing: true,
                indexRebuildRequired: true,
              }),
            }),
          }),
        ],
      },
    });
    expect(JSON.stringify(missingIndexResult)).not.toContain('raw-ref-secret');
    expect(JSON.stringify(missingIndexResult)).not.toContain('/private/path');
    expect(JSON.stringify(missingIndexResult)).not.toContain('cursor-secret');
    expect(graphStore.listCommits).toHaveBeenLastCalledWith({ ref: 'refs/heads/main' });

    const missingParentResult = await version.listCommits({ ref: 'refs/heads/main' });
    expect(missingParentResult).toMatchObject({
      ok: false,
      error: {
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_MISSING_PARENT',
            data: expect.objectContaining({
              recoverability: 'repair',
              payload: expect.objectContaining({
                operation: 'listCommits',
                objectKind: 'commit',
                completenessMarker: 'diagnostic-read',
                completenessScope: 'graph-metadata',
                completenessCondition: 'history-gap',
                accessFiltered: true,
                missingCommitRole: 'parent',
                condition: 'history-gap',
                historyCompleteness: 'history-gap',
              }),
            }),
          }),
        ],
      },
    });
    expect(JSON.stringify(missingParentResult)).not.toContain(PARENT_A_COMMIT_ID);
    expect(JSON.stringify(missingParentResult)).not.toContain(CHILD_COMMIT_ID);
    expect(JSON.stringify(missingParentResult)).not.toContain('raw-ref-secret');
    expect(JSON.stringify(missingParentResult)).not.toContain('/private/path');
    expect(graphStore.listCommits).toHaveBeenLastCalledWith({ ref: 'refs/heads/main' });

    await expect(version.listCommits()).resolves.toMatchObject({
      ok: false,
      error: {
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_INVALID_COMMIT_PAYLOAD',
            data: expect.objectContaining({
              payload: expect.objectContaining({
                option: 'pageToken',
                cursorMalformed: true,
              }),
            }),
          }),
        ],
      },
    });
    expect(graphStore.listCommits).toHaveBeenLastCalledWith({});

    await expect(version.listCommits()).resolves.toMatchObject({
      ok: true,
      value: {
        nextCursor: 'vpt_next_page',
        limit: 50,
      },
    });
    expect(graphStore.listCommits).toHaveBeenLastCalledWith({});

    await expect(version.listCommits()).resolves.toMatchObject({
      ok: true,
      value: {
        nextCursor: PUBLIC_LIST_PAGE_TOKEN,
        limit: 50,
      },
    });
    expect(graphStore.listCommits).toHaveBeenLastCalledWith({});
  });
});
