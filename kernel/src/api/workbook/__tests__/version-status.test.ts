import { jest } from '@jest/globals';

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
import {
  VERSION_STATUS_CHILD_COMMIT_ID as CHILD_COMMIT_ID,
  VERSION_STATUS_CREATED_AT as CREATED_AT,
  VERSION_STATUS_DIFF_PAGE_TOKEN as DIFF_PAGE_TOKEN,
  VERSION_STATUS_REF_REVISION as REF_REVISION,
  VERSION_STATUS_ROOT_COMMIT_ID as ROOT_COMMIT_ID,
  createFakeVersionStatusGraphStore as createFakeGraphStore,
} from './version-status-test-utils';
import { versioningWithDomainSupportManifest } from './version-domain-support-test-utils';

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

const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  principalScope: 'principal-1',
};
const VERSION_AUTHOR = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
} as const;

function createMockCtx(overrides: Record<string, unknown> = {}) {
  const versioning = overrides.versioning as Record<string, unknown> | undefined;
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
    ...(versioning ? { versioning: versioningWithDomainSupportManifest(versioning) } : {}),
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

  const versioning = overrides?.versioning as Record<string, unknown> | undefined;
  return new WorkbookImpl({
    ctx: createMockCtx(),
    eventBus: createMockEventBus(),
    ...overrides,
    ...(versioning ? { versioning: versioningWithDomainSupportManifest(versioning) } : {}),
  });
}

function versionUnavailable(
  operation: 'getHead' | 'listCommits' | 'diff',
  code: string,
  data: Record<string, unknown> = {},
) {
  return {
    ok: false,
    error: {
      code: 'target_unavailable',
      target: `workbook.version.${operation}`,
      diagnostics: [
        expect.objectContaining({
          code,
          data: expect.objectContaining({ redacted: true, ...data }),
        }),
      ],
    },
  };
}

describe('WorkbookVersion status slice', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('exposes read-only version status on a created workbook', async () => {
    const wb = createWorkbook();

    const status = await wb.version.getStatus();

    expect(status.schemaVersion).toBe(1);
    expect(status.rolloutStage).toBe('disabled');
    expect(status.objectStoreFoundation.stage).toBe('present');
    expect(status.refLifecycleFoundation.stage).toBe('present');
    expect(status.commitApi.stage).toBe('pending');
    expect(status.checkout.stage).toBe('pending');
    expect(status.merge.stage).toBe('pending');
    expect(status.provenanceAdmission.stage).toBe('unavailable');
    expect(status.provenanceAdmission.available).toBe(false);
    expect(new Set(status.diagnostics.map((diagnostic) => diagnostic.code)).size).toBe(
      status.diagnostics.length,
    );
    expect(status.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        'version.objectStore.serviceUnavailable',
        'version.refLifecycle.serviceUnavailable',
        'version.commitApi.pending',
        'version.checkout.pending',
        'version.merge.pending',
        'version.provenanceAdmission.vc09TruthUnavailable',
        'version.provenanceAdmission.mutationAdmissionFoundationPresent',
      ]),
    );
    expect(status.provenanceAdmission.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'version.provenanceAdmission.vc09TruthUnavailable',
          data: expect.objectContaining({
            requiredSlice: 'VC-09',
            pendingRemotePromotionServiceAttached: false,
          }),
        }),
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

    await expect(wb.version.listCommits({ pageToken: DIFF_PAGE_TOKEN })).resolves.toMatchObject({
      ok: true,
      value: {
        limit: 50,
      },
    });
    expect(graphStore.listCommits).toHaveBeenCalledWith({ pageToken: DIFF_PAGE_TOKEN });
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
      { kind: 'ref', name: 'refs/heads/private-review' as any },
      { kind: 'ref', name: 'HEAD' },
    );

    expect(result).toMatchObject({
      ...versionUnavailable('diff', 'VERSION_PERMISSION_DENIED', {
        recoverability: 'unsupported',
        payload: expect.objectContaining({ refName: 'redacted' }),
      }),
    });
    expect(JSON.stringify(result)).not.toContain('private-review');
    expect(graphStore.diff).not.toHaveBeenCalled();
  });

  it('maps public commit options to an attached version write service', async () => {
    const commit = jest.fn(async () => ({
      status: 'success',
      summary: {
        id: CHILD_COMMIT_ID,
        parents: [ROOT_COMMIT_ID],
        createdAt: CREATED_AT,
        author: VERSION_AUTHOR,
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
      ok: true,
      value: {
        id: CHILD_COMMIT_ID,
        parents: [ROOT_COMMIT_ID],
        createdAt: CREATED_AT,
        author: { actorKind: 'user', displayName: 'User One', redacted: true },
      },
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

    const committedResult = await wb.version.commit({
      expectedHead: {
        commitId: initialized.rootCommit.id,
        revision: initialized.initialHead.revision,
        symbolicHeadRevision: initialized.symbolicHead.revision,
      },
    });
    if (!committedResult.ok) {
      throw new Error(`expected provider-backed commit success: ${committedResult.error.code}`);
    }
    const committed = committedResult.value;

    expect(captureNormalCommit).toHaveBeenCalledTimes(1);
    expect(committed).toMatchObject({
      parents: [initialized.rootCommit.id],
      createdAt: CREATED_AT,
      author: { actorKind: 'user', displayName: 'User One', redacted: true },
    });
    expect(committed.id).not.toBe(initialized.rootCommit.id);

    await expect(wb.version.getHead()).resolves.toMatchObject({
      ok: true,
      value: {
        id: committed.id,
        refName: VERSION_GRAPH_MAIN_REF,
        resolvedFrom: 'HEAD',
        refRevision: { kind: 'counter', value: '1' },
      },
    });
    await expect(wb.version.listCommits()).resolves.toMatchObject({
      ok: true,
      value: {
        items: [
          expect.objectContaining({ id: committed.id, parents: [initialized.rootCommit.id] }),
          expect.objectContaining({ id: initialized.rootCommit.id, parents: [] }),
        ],
        limit: 50,
      },
    });
    const status = await wb.version.getStatus();
    expect(status.checkout).toMatchObject({ stage: 'present', available: true });
    expect(status.checkout.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'version.checkout.serviceAttached',
    ]);

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

    await expect(wb.version.commit()).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_MISSING_CHANGE_SET',
            data: expect.objectContaining({
              mutationGuarantee: 'no-write-attempted',
              redacted: true,
            }),
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
    ['author', 'VERSION_PERMISSION_DENIED'],
    ['parents', 'VERSION_PERMISSION_DENIED'],
    ['segmentIds', 'VERSION_INVALID_OPTIONS'],
    ['unknownField', 'VERSION_INVALID_OPTIONS'],
  ])('rejects unsafe commit option %s before the write service is called', async (field, issue) => {
    const commit = jest.fn();
    const wb = createWorkbook({
      ctx: createMockCtx({
        versioning: {
          writeService: { commit },
        },
      }),
    });

    await expect(wb.version.commit({ [field]: 'spoofed' } as any)).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [
          expect.objectContaining({
            code: issue,
            data: expect.objectContaining({
              mutationGuarantee: 'no-write-attempted',
              redacted: true,
            }),
          }),
        ],
      },
    });
    expect(commit).not.toHaveBeenCalled();
  });

  it('rejects unsupported root/import commit modes before the write service is called', async () => {
    const commit = jest.fn();
    const wb = createWorkbook({
      ctx: createMockCtx({
        versioning: {
          writeService: { commit },
        },
      }),
    });

    await expect(wb.version.commit({ mode: { kind: 'root' } })).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [expect.objectContaining({ code: 'VERSION_INVALID_OPTIONS' })],
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

    await expect(wb.version.commit()).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [expect.objectContaining({ code: 'VERSION_GRAPH_UNINITIALIZED' })],
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
