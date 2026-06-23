import { jest } from '@jest/globals';

const { WorkbookVersionImpl } = await import('../version');

const ROOT_COMMIT_ID = `commit:sha256:${'1'.repeat(64)}`;
const CHILD_COMMIT_ID = `commit:sha256:${'2'.repeat(64)}`;
const MISSING_COMMIT_ID = `commit:sha256:${'9'.repeat(64)}`;
const PAGE_TOKEN = 'vpt_aaaaaaaaaaaa';
const DIFF_PAGE_TOKEN = 'mog-vdiff-v1.semantic-change-order.cursor-handle';
const REF_REVISION = { kind: 'counter', value: '2' } as const;
const CREATED_AT = '2026-06-20T00:00:00.000Z';

type FakeGraphStore = ReturnType<typeof createFakeGraphStore>;

function createVersion(graphStore: FakeGraphStore) {
  return new WorkbookVersionImpl({
    versioning: {
      graphStore,
    },
  } as any);
}

function createFakeGraphStore() {
  return {
    listCommits: jest.fn(async () => successPage()),
  };
}

function childCommitSummary() {
  return {
    id: CHILD_COMMIT_ID,
    parents: [ROOT_COMMIT_ID],
    createdAt: CREATED_AT,
    author: {
      authorId: 'user-1',
      actorKind: 'user',
      displayName: 'Public Reader',
      clientId: 'hidden-client',
    },
  };
}

function rootCommitSummary() {
  return {
    id: ROOT_COMMIT_ID,
    parents: [],
    createdAt: CREATED_AT,
    author: {
      authorId: 'system-1',
      actorKind: 'system',
    },
  };
}

function successPage(overrides: Record<string, unknown> = {}) {
  return {
    status: 'success',
    commits: [childCommitSummary(), rootCommitSummary()],
    readRevision: REF_REVISION,
    order: 'topological-newest',
    pageSize: 50,
    diagnostics: [],
    ...overrides,
  };
}

function expectUnavailable(code: string, option?: string) {
  return {
    ok: false,
    error: {
      code: 'target_unavailable',
      target: 'workbook.version.listCommits',
      diagnostics: [
        expect.objectContaining({
          code,
          data: expect.objectContaining({
            redacted: true,
            ...(option
              ? {
                  payload: expect.objectContaining({ option }),
                }
              : {}),
          }),
        }),
      ],
    },
  };
}

describe('WorkbookVersion listCommits selectors', () => {
  it('forwards public ref and commit roots without leaking unsupported options to the graph service', async () => {
    const graphStore = createFakeGraphStore();
    graphStore.listCommits
      .mockResolvedValueOnce(successPage())
      .mockResolvedValueOnce(successPage())
      .mockResolvedValueOnce(successPage({ commits: [rootCommitSummary()] }))
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
  });

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
  });

  it('validates listCommits options before calling the graph service', async () => {
    const cases: readonly [string, unknown, string, string | undefined][] = [
      ['non-object options', null, 'VERSION_INVALID_OPTIONS', 'options'],
      ['unknown option', { unexpected: true }, 'VERSION_INVALID_OPTIONS', 'unexpected'],
      ['bad page size', { pageSize: 0 }, 'VERSION_INVALID_OPTIONS', 'pageSize'],
      [
        'ref and from together',
        { ref: 'refs/heads/main', from: ROOT_COMMIT_ID },
        'VERSION_INVALID_OPTIONS',
        'ref',
      ],
      ['malformed commit id', { from: 'commit:sha256:bad' }, 'VERSION_INVALID_COMMIT_ID', 'from'],
      [
        'unknown ref namespace',
        { ref: 'refs/heads/private-review' },
        'VERSION_INVALID_OPTIONS',
        'ref',
      ],
      ['uppercase ref', { ref: 'refs/heads/scenario/Bad' }, 'VERSION_INVALID_OPTIONS', 'ref'],
      ['non-heads ref', { ref: 'refs/tags/not-public' }, 'VERSION_INVALID_OPTIONS', 'ref'],
      [
        'non-boolean includeOrphans',
        { includeOrphans: 'yes' },
        'VERSION_INVALID_OPTIONS',
        'includeOrphans',
      ],
      [
        'unsupported includeOrphans',
        { includeOrphans: true },
        'VERSION_PERMISSION_DENIED',
        'includeOrphans',
      ],
      [
        'non-boolean includeDiagnostics',
        { includeDiagnostics: 'yes' },
        'VERSION_INVALID_OPTIONS',
        'includeDiagnostics',
      ],
      ['malformed pageToken', { pageToken: 'bad-token' }, 'VERSION_INVALID_OPTIONS', 'pageToken'],
      [
        'wrong-operation pageToken',
        { pageToken: DIFF_PAGE_TOKEN },
        'VERSION_STALE_PAGE_CURSOR',
        'pageToken',
      ],
    ];

    for (const [_name, options, code, option] of cases) {
      const graphStore = createFakeGraphStore();
      const version = createVersion(graphStore);
      const result = await version.listCommits(options as never);
      expect(result).toMatchObject({
        ok: false,
        error: {
          code: 'target_unavailable',
          target: 'workbook.version.listCommits',
          diagnostics: expect.arrayContaining([
            expect.objectContaining({
              code,
              data: expect.objectContaining({
                redacted: true,
                ...(option ? { payload: expect.objectContaining({ option }) } : {}),
              }),
            }),
          ]),
        },
      });
      expect(JSON.stringify(result)).not.toContain(
        typeof options === 'object' && options && 'ref' in options
          ? String((options as { ref?: unknown }).ref)
          : 'refs/heads/private-review',
      );
      expect(graphStore.listCommits).not.toHaveBeenCalled();
    }
  });

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
      .mockResolvedValueOnce(successPage({ nextPageToken: 'bad-token' }))
      .mockResolvedValueOnce(successPage({ nextPageToken: 'vpt_next_page' }));
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
  });
});
