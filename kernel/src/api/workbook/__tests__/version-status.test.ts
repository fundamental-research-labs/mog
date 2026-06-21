import { jest } from '@jest/globals';

import type { VersionAuthor } from '@mog-sdk/contracts/versioning';
import type { WorkbookConfig } from '../types';
import type { VersionNormalCommitCapture } from '../../../document/version-store/commit-service';
import { VERSION_GRAPH_MAIN_REF } from '../../../document/version-store/graph-store';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../../../document/version-store/object-store';
import type { VersionObjectType } from '../../../document/version-store/object-digest';
import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
} from '../../../document/version-store/provider';

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
const DIFF_PAGE_TOKEN = 'vpt_aaaaaaaaaaaa';
const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  principalScope: 'principal-1',
};
const VERSION_AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

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
    expect('commit' in wb.version).toBe(true);
    expect('merge' in wb.version).toBe(true);
    expect('diff' in wb.version).toBe(true);
  });

  it('degrades read and diff APIs and rejects commit before graph services are attached', async () => {
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

    await expect(wb.version.diff(ROOT_COMMIT_ID, CHILD_COMMIT_ID)).resolves.toMatchObject({
      status: 'degraded',
      items: [],
      order: 'semantic-change-order',
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_GRAPH_UNINITIALIZED',
          redacted: true,
        }),
      ],
    });

    await expect(wb.version.commit()).rejects.toMatchObject({
      name: 'MogSdkError',
      code: 'PROVIDER_ERROR',
      operation: 'workbook.version.commit',
      details: {
        versionIssueCode: 'VERSION_GRAPH_UNINITIALIZED',
        diagnostics: [
          expect.objectContaining({
            issueCode: 'VERSION_GRAPH_UNINITIALIZED',
            mutationGuarantee: 'no-write-attempted',
            redacted: true,
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
      status: 'success',
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
      nextPageToken: DIFF_PAGE_TOKEN,
      readRevision: REF_REVISION,
      order: 'semantic-change-order',
      diagnostics: [],
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

  it('redacts invalid private refs before any graph or branch service call', async () => {
    const graphStore = createFakeGraphStore();
    const wb = createWorkbook({
      ctx: createMockCtx({
        versioning: {
          graphStore,
        },
      }),
    });

    const result = await wb.version.readRef('refs/heads/private-review');
    expect(result).toMatchObject({
      status: 'degraded',
      ref: null,
    });
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          issueCode: 'VERSION_INVALID_OPTIONS',
          payload: expect.objectContaining({ refName: 'redacted' }),
          redacted: true,
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
      status: 'degraded',
      ref: null,
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_GRAPH_UNINITIALIZED',
          recoverability: 'unsupported',
          redacted: true,
        }),
      ],
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
      status: 'degraded',
      items: [],
      order: 'semantic-change-order',
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_UNMATERIALIZABLE_COMMIT',
          recoverability: 'unsupported',
          redacted: true,
        }),
      ],
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
      status: 'degraded',
      items: [],
      order: 'semantic-change-order',
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          issueCode: 'VERSION_INVALID_OPTIONS',
          redacted: true,
        }),
      ]),
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
      { kind: 'ref', name: 'refs/heads/private-review' as any },
      { kind: 'ref', name: 'HEAD' },
    );

    expect(result).toMatchObject({
      status: 'degraded',
      items: [],
      order: 'semantic-change-order',
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_PERMISSION_DENIED',
          recoverability: 'unsupported',
          payload: expect.objectContaining({ refName: 'redacted' }),
          redacted: true,
        }),
      ],
    });
    expect(JSON.stringify(result)).not.toContain('private-review');
    expect(graphStore.diff).not.toHaveBeenCalled();
  });

  it('maps public commit options to an attached version write service', async () => {
    const commit = jest.fn(async () => ({
      status: 'success',
      commitRef: {
        id: CHILD_COMMIT_ID,
        refName: 'refs/heads/main',
        resolvedFrom: 'HEAD',
        refRevision: REF_REVISION,
      },
    }));
    const wb = createWorkbook({
      ctx: createMockCtx({
        versioning: {
          objectStore: {},
          refStore: {},
          writeService: { commit },
        },
      }),
    });

    await expect(
      wb.version.commit({
        message: 'Capture forecast edits',
        mode: { kind: 'normal' },
        expectedHead: {
          commitId: ROOT_COMMIT_ID,
          revision: REF_REVISION,
          symbolicHeadRevision: { kind: 'opaque', value: 'head-rev-1' },
        },
        redactionPolicy: {
          mode: 'strict',
          redactSecrets: true,
          redactExternalLinks: true,
          redactAgentTrace: true,
        },
      }),
    ).resolves.toEqual({
      id: CHILD_COMMIT_ID,
      refName: 'refs/heads/main',
      resolvedFrom: 'HEAD',
      refRevision: REF_REVISION,
    });
    expect(commit).toHaveBeenCalledWith({
      message: 'Capture forecast edits',
      mode: { kind: 'normal' },
      expectedHead: {
        commitId: ROOT_COMMIT_ID,
        revision: REF_REVISION,
        symbolicHeadRevision: { kind: 'opaque', value: 'head-rev-1' },
      },
      redactionPolicy: {
        mode: 'strict',
        redactSecrets: true,
        redactExternalLinks: true,
        redactAgentTrace: true,
      },
    });

    await expect(wb.version.getStatus()).resolves.toMatchObject({
      commitApi: {
        stage: 'present',
        available: true,
      },
    });
  });

  it('routes public commit through the attached provider-backed normal commit service', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
    expectInitializeSuccess(initialized);
    const captureNormalCommit = jest.fn(createNormalCommitCapture('child'));
    const wb = createWorkbook({
      versioning: {
        provider,
        captureNormalCommit,
      },
    });

    const committed = await wb.version.commit({
      expectedHead: {
        commitId: initialized.rootCommit.id,
        revision: initialized.initialHead.revision,
        symbolicHeadRevision: initialized.symbolicHead.revision,
      },
    });

    expect(captureNormalCommit).toHaveBeenCalledTimes(1);
    expect(committed).toMatchObject({
      refName: VERSION_GRAPH_MAIN_REF,
      resolvedFrom: 'HEAD',
      refRevision: { kind: 'counter', value: '1' },
    });
    expect(committed.id).not.toBe(initialized.rootCommit.id);

    await expect(wb.version.getHead()).resolves.toMatchObject({
      id: committed.id,
      refName: VERSION_GRAPH_MAIN_REF,
      resolvedFrom: 'HEAD',
      refRevision: { kind: 'counter', value: '1' },
    });
    await expect(wb.version.listCommits()).resolves.toMatchObject({
      status: 'success',
      items: [
        expect.objectContaining({ id: committed.id, parents: [initialized.rootCommit.id] }),
        expect.objectContaining({ id: initialized.rootCommit.id, parents: [] }),
      ],
      order: 'topological-newest',
    });

    const graph = await provider.openGraph(namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1'));
    await expect(graph.readHead()).resolves.toMatchObject({
      status: 'success',
      head: {
        id: committed.id,
        refRevision: { kind: 'counter', value: '1' },
      },
    });
  });

  it('returns graph-uninitialized diagnostics before capture when provider registry is absent', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const captureNormalCommit = jest.fn(createNormalCommitCapture('should-not-run'));
    const wb = createWorkbook({
      versioning: {
        provider,
        captureNormalCommit,
      },
    });

    await expect(wb.version.commit()).rejects.toMatchObject({
      name: 'MogSdkError',
      code: 'PROVIDER_ERROR',
      operation: 'workbook.version.commit',
      details: {
        versionIssueCode: 'VERSION_GRAPH_UNINITIALIZED',
        diagnostics: [
          expect.objectContaining({
            issueCode: 'VERSION_GRAPH_UNINITIALIZED',
            mutationGuarantee: 'no-write-attempted',
            redacted: true,
          }),
        ],
      },
    });
    expect(captureNormalCommit).not.toHaveBeenCalled();
  });

  it('rejects empty normal capture without advancing the initialized main ref', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
    expectInitializeSuccess(initialized);
    const captureNormalCommit = jest.fn(createEmptyNormalCommitCapture('empty'));
    const wb = createWorkbook({
      versioning: {
        provider,
        captureNormalCommit,
      },
    });

    await expect(wb.version.commit()).rejects.toMatchObject({
      name: 'MogSdkError',
      code: 'PROVIDER_ERROR',
      details: {
        versionIssueCode: 'VERSION_MISSING_CHANGE_SET',
        diagnostics: [
          expect.objectContaining({
            issueCode: 'VERSION_MISSING_CHANGE_SET',
            mutationGuarantee: 'no-write-attempted',
            redacted: true,
          }),
        ],
      },
    });
    expect(captureNormalCommit).toHaveBeenCalledTimes(1);

    const graph = await provider.openGraph(namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1'));
    await expect(graph.readHead()).resolves.toMatchObject({
      status: 'success',
      head: {
        id: initialized.rootCommit.id,
        refRevision: initialized.initialHead.revision,
      },
    });
  });

  it.each([
    ['targetRef', 'VERSION_REF_WRITE_UNAVAILABLE', 'AUTHORIZATION_DENIED'],
    ['author', 'VERSION_PERMISSION_DENIED', 'AUTHORIZATION_DENIED'],
    ['parents', 'VERSION_PERMISSION_DENIED', 'AUTHORIZATION_DENIED'],
    ['segmentIds', 'VERSION_INVALID_OPTIONS', 'INVALID_ARGUMENT'],
    ['unknownField', 'VERSION_INVALID_OPTIONS', 'INVALID_ARGUMENT'],
  ])(
    'rejects unsafe commit option %s before the write service is called',
    async (field, issue, code) => {
      const commit = jest.fn();
      const wb = createWorkbook({
        ctx: createMockCtx({
          versioning: {
            writeService: { commit },
          },
        }),
      });

      await expect(wb.version.commit({ [field]: 'spoofed' } as any)).rejects.toMatchObject({
        name: 'MogSdkError',
        code,
        details: {
          versionIssueCode: issue,
          diagnostics: [
            expect.objectContaining({
              issueCode: issue,
              mutationGuarantee: 'no-write-attempted',
              redacted: true,
            }),
          ],
        },
      });
      expect(commit).not.toHaveBeenCalled();
    },
  );

  it('rejects unsupported root/import commit modes before the write service is called', async () => {
    const commit = jest.fn();
    const wb = createWorkbook({
      ctx: createMockCtx({
        versioning: {
          writeService: { commit },
        },
      }),
    });

    await expect(wb.version.commit({ mode: { kind: 'root' } })).rejects.toMatchObject({
      name: 'MogSdkError',
      code: 'INVALID_ARGUMENT',
      details: {
        versionIssueCode: 'VERSION_INVALID_OPTIONS',
      },
    });
    expect(commit).not.toHaveBeenCalled();
  });

  it('does not treat a raw graph store commit method as the public write service', async () => {
    const graphStore = {
      ...createFakeGraphStore(),
      initializeGraph: jest.fn(),
      readCommitClosure: jest.fn(),
      commit: jest.fn(),
    };
    const wb = createWorkbook({
      ctx: createMockCtx({
        versioning: {
          graphStore,
        },
      }),
    });

    await expect(wb.version.commit()).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
      details: {
        versionIssueCode: 'VERSION_GRAPH_UNINITIALIZED',
      },
    });
    expect(graphStore.commit).not.toHaveBeenCalled();
  });

  it('exposes checkout, merge, and ref lifecycle methods', () => {
    const wb = createWorkbook();

    expect('checkout' in wb.version).toBe(true);
    expect('merge' in wb.version).toBe(true);
    expect('diff' in wb.version).toBe(true);
    expect('createBranch' in wb.version).toBe(true);
    expect('listRefs' in wb.version).toBe(true);
    expect('fastForwardBranch' in wb.version).toBe(true);
    expect('updateBranch' in wb.version).toBe(true);
    expect('deleteBranch' in wb.version).toBe(true);
  });
});

function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected initialize success: ${result.diagnostics[0]?.code}`);
  }
}

async function objectRecord(
  namespace: VersionGraphNamespace,
  objectType: VersionObjectType,
  payload: unknown,
): Promise<VersionObjectRecord<unknown>> {
  return createVersionObjectRecord(namespace, {
    objectType,
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [],
    payload,
  });
}

async function initializeInput(
  graphId: string,
  label: string,
): Promise<VersionGraphInitializeInput> {
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, graphId);
  return {
    expectedRegistryRevision: null,
    graphId,
    rootWrite: {
      snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
        label,
        sheets: [],
      }),
      semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
        label,
        changes: [],
      }),
      author: VERSION_AUTHOR,
      createdAt: CREATED_AT,
      completenessDiagnostics: [],
    },
  };
}

function createNormalCommitCapture(label: string): VersionNormalCommitCapture {
  return async ({ namespace, currentMain }) => ({
    status: 'success',
    input: {
      snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
        label,
        parent: currentMain.commitId,
        sheets: [],
      }),
      semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
        label,
        changes: [{ id: `${label}-change-1`, domain: 'test' }],
      }),
      mutationSegmentRecords: [
        await objectRecord(namespace, 'workbook.mutationSegment.v1', {
          segmentId: `${label}-segment-1`,
          baseCommitId: currentMain.commitId,
        }),
      ],
      author: VERSION_AUTHOR,
      createdAt: CREATED_AT,
      completenessDiagnostics: [],
    },
  });
}

function createEmptyNormalCommitCapture(label: string): VersionNormalCommitCapture {
  return async ({ namespace }) => ({
    status: 'success',
    input: {
      snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
        label,
        sheets: [],
      }),
      semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
        label,
        changes: [],
      }),
      mutationSegmentRecords: [],
      author: VERSION_AUTHOR,
      createdAt: CREATED_AT,
      completenessDiagnostics: [],
    },
  });
}

function createFakeGraphStore(options: { readonly includeDiff?: boolean } = {}) {
  const graphStore = {
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
    diff: jest.fn(async () => ({
      status: 'success',
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
      nextPageToken: DIFF_PAGE_TOKEN,
      readRevision: REF_REVISION,
      order: 'semantic-change-order',
      diagnostics: [],
    })),
  };

  if (options.includeDiff === false) {
    return {
      ...graphStore,
      diff: undefined,
    };
  }

  return graphStore;
}
