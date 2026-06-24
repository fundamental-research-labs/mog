import {
  VERSION_STATUS_CHILD_COMMIT_ID as CHILD_COMMIT_ID,
  VERSION_STATUS_ROOT_COMMIT_ID as ROOT_COMMIT_ID,
  createFakeVersionStatusGraphStore as createFakeGraphStore,
} from './version-status-test-utils';
import {
  createMockCtx,
  createWorkbook,
  resetVersionStatusWorkbookMocks,
  versionUnavailable,
} from './version-status-workbook-test-utils';

describe('WorkbookVersion status access diagnostics', () => {
  beforeEach(() => {
    resetVersionStatusWorkbookMocks();
  });

  it('redacts invalid private refs before any graph or branch service call', async () => {
    const graphStore = createFakeGraphStore();
    const wb = createWorkbook({
      ctx: createMockCtx({
        versioning: {
          graphStore,
        },
      }),
    });

    const result = await wb.version.readRef('refs/heads/private-review.lock');
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'target_unavailable' },
    });
    if (result.ok) throw new Error('expected private readRef to fail');
    expect(result.error.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'VERSION_INVALID_OPTIONS',
          data: expect.objectContaining({
            payload: expect.objectContaining({ refName: 'redacted' }),
            redacted: true,
          }),
        }),
      ]),
    );
    expect(graphStore.readRef).not.toHaveBeenCalled();
  });

  it('requires an attached public ref lifecycle service for arbitrary valid branch refs', async () => {
    const graphStore = createFakeGraphStore();
    const wb = createWorkbook({
      ctx: createMockCtx({
        versioning: {
          graphStore,
        },
      }),
    });

    await expect(wb.version.readRef('refs/heads/review/private-review')).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_GRAPH_UNINITIALIZED',
            data: expect.objectContaining({
              recoverability: 'unsupported',
              redacted: true,
            }),
          }),
        ],
      },
    });
    expect(graphStore.readRef).not.toHaveBeenCalled();
  });

  it('returns degraded diagnostics when no semantic diff service is attached', async () => {
    const graphStore = createFakeGraphStore({ includeDiff: false });
    const wb = createWorkbook({
      ctx: createMockCtx({
        versioning: {
          graphStore,
        },
      }),
    });

    await expect(wb.version.diff(ROOT_COMMIT_ID, CHILD_COMMIT_ID)).resolves.toMatchObject({
      ...versionUnavailable('diff', 'VERSION_UNMATERIALIZABLE_COMMIT', {
        recoverability: 'unsupported',
      }),
    });
  });

  it('validates diff inputs before the diff service is called', async () => {
    const graphStore = createFakeGraphStore();
    const wb = createWorkbook({
      ctx: createMockCtx({
        versioning: {
          graphStore,
        },
      }),
    });

    await expect(
      wb.version.diff(
        { kind: 'commit', id: 'commit:sha256:BAD' as any },
        { kind: 'ref', name: 'refs/heads/main' },
        {
          pageSize: 0,
          pageToken: 'bad-token',
          includeDerivedImpact: 'yes' as any,
          includeDiagnostics: true,
          extra: true,
        } as any,
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: 'VERSION_INVALID_OPTIONS',
            data: expect.objectContaining({ redacted: true }),
          }),
        ]),
      },
    });
    expect(graphStore.diff).not.toHaveBeenCalled();
  });

  it('redacts unsupported diff ref selectors before the diff service is called', async () => {
    const graphStore = createFakeGraphStore();
    const wb = createWorkbook({
      ctx: createMockCtx({
        versioning: {
          graphStore,
        },
      }),
    });

    const result = await wb.version.diff(
      { kind: 'ref', name: 'refs/heads/private-review.lock' as any },
      { kind: 'ref', name: 'HEAD' },
    );

    expect(result).toMatchObject({
      ...versionUnavailable('diff', 'VERSION_PERMISSION_DENIED', {
        recoverability: 'unsupported',
        payload: expect.objectContaining({ refName: 'redacted' }),
      }),
    });
    expect(JSON.stringify(result)).not.toContain('private-review.lock');
    expect(graphStore.diff).not.toHaveBeenCalled();
  });
});
