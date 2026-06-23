import {
  VERSION_STATUS_CHILD_COMMIT_ID as CHILD_COMMIT_ID,
  VERSION_STATUS_CREATED_AT as CREATED_AT,
  VERSION_STATUS_DIFF_PAGE_TOKEN as DIFF_PAGE_TOKEN,
  VERSION_STATUS_LIST_PAGE_TOKEN as LIST_PAGE_TOKEN,
  VERSION_STATUS_REF_REVISION as REF_REVISION,
  VERSION_STATUS_ROOT_COMMIT_ID as ROOT_COMMIT_ID,
  createFakeVersionStatusGraphStore as createFakeGraphStore,
} from './version-status-test-utils';
import {
  createMockCtx,
  createWorkbook,
  resetVersionStatusWorkbookMocks,
  versionUnavailable,
} from './version-status-workbook-test-utils';

describe('WorkbookVersion status read APIs', () => {
  beforeEach(() => {
    resetVersionStatusWorkbookMocks();
  });

  it('degrades read and diff APIs and rejects commit before graph services are attached', async () => {
    const wb = createWorkbook();

    await expect(wb.version.getHead()).resolves.toMatchObject({
      ...versionUnavailable('getHead', 'VERSION_GRAPH_UNINITIALIZED'),
    });

    await expect(wb.version.listCommits()).resolves.toMatchObject({
      ...versionUnavailable('listCommits', 'VERSION_GRAPH_UNINITIALIZED'),
    });

    await expect(wb.version.readRef('HEAD')).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_GRAPH_UNINITIALIZED',
            data: expect.objectContaining({ redacted: true }),
          }),
        ],
      },
    });

    await expect(wb.version.diff(ROOT_COMMIT_ID, CHILD_COMMIT_ID)).resolves.toMatchObject({
      ...versionUnavailable('diff', 'VERSION_UNMATERIALIZABLE_COMMIT'),
    });

    await expect(wb.version.commit()).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_GRAPH_UNINITIALIZED',
            data: expect.objectContaining({
              mutationGuarantee: 'no-write-attempted',
              redacted: true,
            }),
          }),
        ],
      },
    });
  });

  it('maps an attached graph read service to public head, commit page, and ref results', async () => {
    const graphStore = createFakeGraphStore();
    const wb = createWorkbook({
      ctx: createMockCtx({
        versioning: {
          objectStore: {},
          refStore: {},
          graphStore,
        },
      }),
    });

    await expect(wb.version.getHead()).resolves.toEqual({
      ok: true,
      value: {
        id: CHILD_COMMIT_ID,
        refName: 'refs/heads/main',
        resolvedFrom: 'HEAD',
        refRevision: REF_REVISION,
      },
    });

    await expect(wb.version.listCommits({ ref: 'refs/heads/main', pageSize: 2 })).resolves.toEqual({
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
    expect(graphStore.listCommits).toHaveBeenCalledWith({ ref: 'refs/heads/main', pageSize: 2 });

    await expect(wb.version.readRef('HEAD')).resolves.toEqual({
      ok: true,
      value: {
        status: 'success',
        ref: {
          name: 'HEAD',
          target: 'refs/heads/main',
          revision: REF_REVISION,
        },
        diagnostics: [],
      },
    });

    await expect(wb.version.readRef('refs/heads/main')).resolves.toEqual({
      ok: true,
      value: {
        status: 'success',
        ref: {
          name: 'refs/heads/main',
          commitId: CHILD_COMMIT_ID,
          revision: REF_REVISION,
          updatedAt: CREATED_AT,
        },
        diagnostics: [],
      },
    });

    await expect(
      wb.version.diff(
        ROOT_COMMIT_ID,
        { kind: 'ref', name: 'HEAD' },
        {
          pageSize: 25,
          includeDerivedImpact: true,
          includeDiagnostics: true,
        },
      ),
    ).resolves.toEqual({
      ok: true,
      value: {
        items: [
          {
            structural: {
              kind: 'metadata',
              changeId: 'change-1',
              domain: 'cell',
              entityId: 'sheet-1!A1',
              propertyPath: ['value'],
            },
            before: { kind: 'value', value: 1 },
            after: {
              kind: 'value',
              value: { kind: 'formula', formula: '=A1+1', result: 2 },
            },
            display: {
              sheetName: { kind: 'value', value: 'Sheet1' },
              address: { kind: 'value', value: 'A1' },
            },
          },
        ],
        nextCursor: DIFF_PAGE_TOKEN,
        limit: 25,
        readRevision: REF_REVISION,
        order: 'semantic-change-order',
      },
    });
    expect(graphStore.diff).toHaveBeenCalledWith(
      { kind: 'commit', id: ROOT_COMMIT_ID },
      { kind: 'ref', name: 'HEAD' },
      {
        pageSize: 25,
        includeDerivedImpact: true,
        includeDiagnostics: true,
      },
    );
  });

  it('passes valid listCommits page tokens to the graph service', async () => {
    const graphStore = createFakeGraphStore();
    const wb = createWorkbook({
      ctx: createMockCtx({
        versioning: {
          graphStore,
        },
      }),
    });

    await expect(wb.version.listCommits({ pageToken: LIST_PAGE_TOKEN })).resolves.toMatchObject({
      ok: true,
      value: {
        limit: 50,
      },
    });
    expect(graphStore.listCommits).toHaveBeenCalledWith({ pageToken: LIST_PAGE_TOKEN });
  });
});
