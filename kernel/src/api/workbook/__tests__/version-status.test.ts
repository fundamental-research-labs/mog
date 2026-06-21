import { jest } from '@jest/globals';

import type { WorkbookConfig } from '../types';

const createCheckpointManagerMock = jest.fn();
const worksheetImplMock = jest.fn().mockImplementation((sheetId: string) => ({
  _sheetId: sheetId,
  _syncMetadata: jest.fn(),
  dispose: jest.fn(),
}));

jest.unstable_mockModule('../../worksheet/worksheet-impl', () => ({
  WorksheetImpl: worksheetImplMock,
}));

jest.unstable_mockModule('../../../services/checkpoint', () => ({
  createCheckpointManager: createCheckpointManagerMock,
}));

jest.unstable_mockModule('../../namespaces/records', () => ({
  get: jest.fn(),
  query: jest.fn(),
  getFieldValue: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  del: jest.fn(),
}));

jest.unstable_mockModule('../../../bridges/compute/compute-bridge', () => ({
  ComputeBridge: jest.fn(),
  createComputeBridge: jest.fn(),
  createComputeBridgeFromTransport: jest.fn(),
  extractMutationData: jest.fn(),
  identityFormulaToWire: jest.fn(),
  rustSchemaResolveEditor: jest.fn(),
  wireTableToTableConfig: jest.fn(),
  wireToIdentityFormula: jest.fn(),
  __esModule: true,
}));

const { WorkbookImpl } = await import('../workbook-impl');

function createMockEventBus() {
  return {
    on: jest.fn().mockReturnValue(() => undefined),
    onAll: jest.fn().mockReturnValue(() => undefined),
    onMany: jest.fn(),
    emit: jest.fn(),
    emitBatch: jest.fn(),
    clear: jest.fn(),
  };
}

const ROOT_COMMIT_ID = `commit:sha256:${'1'.repeat(64)}`;
const CHILD_COMMIT_ID = `commit:sha256:${'2'.repeat(64)}`;
const REF_REVISION = { kind: 'counter', value: '2' } as const;
const CREATED_AT = '2026-06-20T00:00:00.000Z';

function createMockCtx(overrides: Record<string, unknown> = {}) {
  return {
    computeBridge: {},
    writeGate: {
      assertWritable: jest.fn(),
    },
    services: {
      undo: {},
    },
    floatingObjectManager: {
      dispose: jest.fn(),
    },
    ...overrides,
  } as any;
}

function createWorkbook(overrides?: Partial<WorkbookConfig>) {
  createCheckpointManagerMock.mockReturnValue({
    create: jest.fn(),
    createSync: jest.fn(),
    restore: jest.fn(),
    list: jest.fn().mockReturnValue([]),
    get: jest.fn(),
    delete: jest.fn(),
    clear: jest.fn(),
  });

  return new WorkbookImpl({
    ctx: createMockCtx(),
    eventBus: createMockEventBus(),
    ...overrides,
  });
}

describe('WorkbookVersion status slice', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('exposes read-only version status on a created workbook', async () => {
    const wb = createWorkbook();

    const status = await wb.version.getStatus();

    expect(status.schemaVersion).toBe(1);
    expect(status.rolloutStage).toBe('shadow-only');
    expect(status.objectStoreFoundation.stage).toBe('present');
    expect(status.refLifecycleFoundation.stage).toBe('present');
    expect(status.commitApi.stage).toBe('pending');
    expect(status.checkout.stage).toBe('pending');
    expect(status.merge.stage).toBe('pending');
    expect(status.provenanceAdmission.stage).toBe('present');
    expect(status.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        'version.objectStore.serviceUnavailable',
        'version.refLifecycle.serviceUnavailable',
        'version.commitApi.pending',
        'version.checkout.pending',
        'version.merge.pending',
        'version.provenanceAdmission.present',
      ]),
    );

    expect('listCommits' in wb.version).toBe(true);
    expect('readRef' in wb.version).toBe(true);
  });

  it('degrades read APIs before a graph read service is attached', async () => {
    const wb = createWorkbook();

    await expect(wb.version.getHead()).resolves.toMatchObject({
      status: 'degraded',
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_GRAPH_UNINITIALIZED',
          redacted: true,
        }),
      ],
    });

    await expect(wb.version.listCommits()).resolves.toMatchObject({
      status: 'degraded',
      items: [],
      order: 'topological-newest',
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_GRAPH_UNINITIALIZED',
          redacted: true,
        }),
      ],
    });

    await expect(wb.version.readRef('HEAD')).resolves.toMatchObject({
      status: 'degraded',
      ref: null,
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_GRAPH_UNINITIALIZED',
          redacted: true,
        }),
      ],
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
      id: CHILD_COMMIT_ID,
      refName: 'refs/heads/main',
      resolvedFrom: 'HEAD',
      refRevision: REF_REVISION,
    });

    await expect(wb.version.listCommits({ pageSize: 2 })).resolves.toEqual({
      status: 'success',
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
      readRevision: REF_REVISION,
      order: 'topological-newest',
      diagnostics: [],
    });
    expect(graphStore.listCommits).toHaveBeenCalledWith({ pageSize: 2 });

    await expect(wb.version.readRef('HEAD')).resolves.toEqual({
      status: 'success',
      ref: {
        name: 'HEAD',
        target: 'refs/heads/main',
        revision: REF_REVISION,
      },
      diagnostics: [],
    });

    await expect(wb.version.readRef('refs/heads/main')).resolves.toEqual({
      status: 'success',
      ref: {
        name: 'refs/heads/main',
        commitId: CHILD_COMMIT_ID,
        revision: REF_REVISION,
        updatedAt: CREATED_AT,
      },
      diagnostics: [],
    });
  });

  it('returns a stale unsupported diagnostic for page tokens without calling the graph service', async () => {
    const graphStore = createFakeGraphStore();
    const wb = createWorkbook({
      ctx: createMockCtx({
        versioning: {
          graphStore,
        },
      }),
    });

    await expect(wb.version.listCommits({ pageToken: 'opaque-token' })).resolves.toMatchObject({
      status: 'degraded',
      items: [],
      order: 'topological-newest',
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_STALE_PAGE_CURSOR',
          recoverability: 'unsupported',
          redacted: true,
        }),
      ],
    });
    expect(graphStore.listCommits).not.toHaveBeenCalled();
  });

  it('does not expose arbitrary branch refs in the first public read slice', async () => {
    const graphStore = createFakeGraphStore();
    const wb = createWorkbook({
      ctx: createMockCtx({
        versioning: {
          graphStore,
        },
      }),
    });

    await expect(wb.version.readRef('refs/heads/private-review')).resolves.toMatchObject({
      status: 'degraded',
      ref: null,
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_PERMISSION_DENIED',
          recoverability: 'unsupported',
          redacted: true,
        }),
      ],
    });
    expect(graphStore.readRef).not.toHaveBeenCalled();
  });

  it('does not expose deferred version mutation, checkout, merge, or diff methods', () => {
    const wb = createWorkbook();

    expect('commit' in wb.version).toBe(false);
    expect('checkout' in wb.version).toBe(false);
    expect('merge' in wb.version).toBe(false);
    expect('diff' in wb.version).toBe(false);
    expect('createBranch' in wb.version).toBe(false);
    expect('listRefs' in wb.version).toBe(false);
  });
});

function createFakeGraphStore() {
  return {
    readHead: jest.fn(async () => ({
      status: 'success',
      head: {
        id: CHILD_COMMIT_ID,
        refName: 'refs/heads/main',
        resolvedFrom: 'HEAD',
        refRevision: REF_REVISION,
      },
      main: {
        name: 'refs/heads/main',
        commitId: CHILD_COMMIT_ID,
        revision: REF_REVISION,
        updatedAt: CREATED_AT,
      },
      diagnostics: [],
    })),
    listCommits: jest.fn(async () => ({
      status: 'success',
      commits: [
        {
          id: CHILD_COMMIT_ID,
          parents: [ROOT_COMMIT_ID],
          createdAt: CREATED_AT,
          author: {
            authorId: 'user-1',
            actorKind: 'user',
            displayName: 'Public Reader',
            clientId: 'hidden-client',
          },
        },
        {
          id: ROOT_COMMIT_ID,
          parents: [],
          createdAt: CREATED_AT,
          author: {
            authorId: 'system-1',
            actorKind: 'system',
          },
        },
      ],
      readRevision: REF_REVISION,
      order: 'topological-newest',
      pageSize: 50,
      diagnostics: [],
    })),
    readRef: jest.fn(async (name: string) => ({
      status: 'success',
      ref:
        name === 'HEAD'
          ? {
              name: 'HEAD',
              target: 'refs/heads/main',
              revision: REF_REVISION,
            }
          : {
              name: 'refs/heads/main',
              commitId: CHILD_COMMIT_ID,
              revision: REF_REVISION,
              updatedAt: CREATED_AT,
            },
      diagnostics: [],
    })),
  };
}
