import { jest } from '@jest/globals';

import type { VersionAuthor, VersionOperationContext } from '@mog-sdk/contracts/versioning';
import type { WorkbookConfig } from '../types';
import type { VersionObjectType } from '../../../document/version-store/object-digest';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../../../document/version-store/object-store';
import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
} from '../../../document/version-store/provider';
import { createSemanticMutationCapture } from '../../../document/version-store/semantic-mutation-capture';
import {
  installVersionDomainDetectorNoopsOnBridgeMock,
  versioningWithDomainSupportManifest,
} from './version-domain-support-test-utils';

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

const CREATED_AT = '2026-06-20T00:00:00.000Z';
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

function createMockEventBus() {
  const allHandlers: Array<(event: unknown) => void> = [];
  return {
    on: jest.fn().mockReturnValue(() => undefined),
    onAll: jest.fn((handler?: unknown) => {
      if (typeof handler === 'function') {
        allHandlers.push(handler as (event: unknown) => void);
      }
      return () => undefined;
    }),
    onMany: jest.fn(),
    emit: jest.fn((event: unknown) => {
      allHandlers.forEach((handler) => handler(event));
    }),
    emitBatch: jest.fn(),
    clear: jest.fn(),
  };
}

function createMockCtx(overrides: Record<string, unknown> = {}) {
  const versioning = overrides.versioning as Record<string, unknown> | undefined;
  const ctx = {
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
  installVersionDomainDetectorNoopsOnBridgeMock(ctx.computeBridge);
  return ctx;
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

describe('WorkbookVersion dirty tracking around commit', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('clears workbook dirty after a successful commit only when captured state is drained', async () => {
    const eventBus = createMockEventBus();
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(
      await initializeInput('graph-clean', 'root'),
    );
    expectInitializeSuccess(initialized);
    const semanticMutationCapture = createSemanticMutationCapture();
    const wb = createWorkbook({
      eventBus,
      versioning: {
        provider,
        semanticMutationCapture,
        snapshotRootByteSyncPort: { encodeDiff: jest.fn(async () => new Uint8Array([0x01])) },
      },
    });
    eventBus.emit({ type: 'test:dirty' });
    semanticMutationCapture.mutationCapture.recordMutationResult({
      operation: 'compute_batch_set_cells_by_position',
      operationContext: operationContext({
        operationId: 'dirty-clean-cell-write',
        sheetIds: ['sheet-1'],
        domainIds: ['cells.values'],
      }),
      directEdits: [{ sheetId: 'sheet-1', row: 0, col: 0 }],
      result: cellWriteResult(42),
    });

    const commitResult = await wb.version.commit();
    expect(commitResult).toMatchObject({ ok: true });

    expect(wb.isDirty).toBe(false);
    expect(semanticMutationCapture.readNormalCommitCaptureState()).toMatchObject({
      pendingCapturedNormalMutationCount: 0,
      pendingUncapturedNormalMutationCount: 0,
    });
  });

  it('rejects a stale dirty marker without creating an empty provider-backed commit', async () => {
    const eventBus = createMockEventBus();
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(
      await initializeInput('graph-stale-dirty', 'root'),
    );
    expectInitializeSuccess(initialized);
    const semanticMutationCapture = createSemanticMutationCapture();
    const encodeDiff = jest.fn(async () => new Uint8Array([0x03]));
    const wb = createWorkbook({
      eventBus,
      versioning: {
        provider,
        semanticMutationCapture,
        snapshotRootByteSyncPort: { encodeDiff },
      },
    });
    eventBus.emit({ type: 'test:stale-dirty-marker' });

    const commitResult = await wb.version.commit();

    expect(commitResult).toMatchObject({
      ok: false,
      error: {
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_MISSING_CHANGE_SET',
            data: expect.objectContaining({
              mutationGuarantee: 'no-write-attempted',
              payload: expect.objectContaining({
                reason: 'empty-normal-capture',
                dirtyWorkingState: true,
                pendingCapturedNormalMutationCount: 0,
                pendingUncapturedNormalMutationCount: 0,
              }),
            }),
          }),
        ],
      },
    });
    expect(encodeDiff).not.toHaveBeenCalled();
    expect(wb.isDirty).toBe(true);
    expect(semanticMutationCapture.readNormalCommitCaptureState()).toMatchObject({
      pendingCapturedNormalMutationCount: 0,
      pendingUncapturedNormalMutationCount: 0,
    });
    await expectOnlyRootCommit(provider, 'graph-stale-dirty', initialized);
  });

  it('rejects a derived-only dirty marker before a permissive write service can commit', async () => {
    const eventBus = createMockEventBus();
    const semanticMutationCapture = createSemanticMutationCapture();
    const commit = jest.fn(async () => ({
      status: 'success',
      commit: commitSummary('child'),
      diagnostics: [],
    }));
    const wb = createWorkbook({
      eventBus,
      versioning: {
        writeService: { commit } as any,
        semanticMutationCapture,
      },
    });
    eventBus.emit({ type: 'test:derived-only-dirty-marker' });
    semanticMutationCapture.mutationCapture.recordMutationResult({
      operation: 'compute_derived_output_promotion',
      operationContext: operationContext({
        operationId: 'derived-only-marker',
        kind: 'derived-output-promotion',
        capturePolicy: 'derivedOnly',
        writeAdmissionMode: 'shadowOnly',
        domainIds: ['cells.formulas'],
      }),
      result: cellWriteResult(42),
    });

    const commitResult = await wb.version.commit();

    expect(commitResult).toMatchObject(
      missingChangeSetCommitResult('uncaptured-normal-mutations'),
    );
    expect(commit).not.toHaveBeenCalled();
    expect(wb.isDirty).toBe(true);
    expect(semanticMutationCapture.readNormalCommitCaptureState()).toMatchObject({
      pendingCapturedNormalMutationCount: 0,
      pendingUncapturedNormalMutationCount: 1,
    });
  });

  it('rejects a semantic no-op dirty marker before a permissive write service can commit', async () => {
    const eventBus = createMockEventBus();
    const semanticMutationCapture = createSemanticMutationCapture();
    const commit = jest.fn(async () => ({
      status: 'success',
      commit: commitSummary('child'),
      diagnostics: [],
    }));
    const wb = createWorkbook({
      eventBus,
      versioning: {
        writeService: { commit } as any,
        semanticMutationCapture,
      },
    });
    eventBus.emit({ type: 'test:no-op-dirty-marker' });
    semanticMutationCapture.mutationCapture.recordMutationResult({
      operation: 'compute_batch_set_cells_by_position',
      operationContext: operationContext({
        operationId: 'semantic-no-op-marker',
        sheetIds: ['sheet-1'],
        domainIds: ['cells.values'],
      }),
      directEdits: [{ sheetId: 'sheet-1', row: 0, col: 0 }],
      result: emptyMutationResult(),
    });

    const commitResult = await wb.version.commit();

    expect(commitResult).toMatchObject(
      missingChangeSetCommitResult('uncaptured-normal-mutations'),
    );
    expect(commit).not.toHaveBeenCalled();
    expect(wb.isDirty).toBe(true);
    expect(semanticMutationCapture.readNormalCommitCaptureState()).toMatchObject({
      pendingCapturedNormalMutationCount: 0,
      pendingUncapturedNormalMutationCount: 1,
    });
  });

  it('keeps workbook dirty when the commit save head token is stale at baseline update time', async () => {
    const eventBus = createMockEventBus();
    const commit = jest.fn(async () => ({
      status: 'success',
      commit: commitSummary('child'),
      diagnostics: [],
    }));
    const readHead = jest.fn(async () => ({
      status: 'success',
      head: commitRef('moved', '3'),
      diagnostics: [],
    }));
    const wb = createWorkbook({
      eventBus,
      versioning: {
        writeService: { commit, readHead } as any,
      },
    });
    eventBus.emit({ type: 'test:dirty-before-commit' });

    await expect(wb.version.commit()).resolves.toMatchObject({
      ok: true,
      value: {
        id: commitId('child'),
      },
    });

    expect(readHead).toHaveBeenCalled();
    expect(wb.isDirty).toBe(true);
  });

  it('keeps workbook dirty when a local mutation is not captured by the committed range', async () => {
    const eventBus = createMockEventBus();
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-gap', 'root'));
    expectInitializeSuccess(initialized);
    const semanticMutationCapture = createSemanticMutationCapture();
    const wb = createWorkbook({
      eventBus,
      versioning: {
        provider,
        semanticMutationCapture,
        snapshotRootByteSyncPort: { encodeDiff: jest.fn(async () => new Uint8Array([0x02])) },
      },
    });
    eventBus.emit({ type: 'test:dirty' });
    semanticMutationCapture.mutationCapture.recordMutationResult({
      operation: 'compute_unsupported_normal_local_write',
      operationContext: operationContext({
        operationId: 'dirty-gap-unsupported',
        domainIds: ['unsupported'],
      }),
      result: emptyMutationResult(),
    });
    semanticMutationCapture.mutationCapture.recordMutationResult({
      operation: 'compute_batch_set_cells_by_position',
      operationContext: operationContext({
        operationId: 'dirty-gap-cell-write',
        sheetIds: ['sheet-1'],
        domainIds: ['cells.values'],
      }),
      directEdits: [{ sheetId: 'sheet-1', row: 0, col: 0 }],
      result: cellWriteResult(42),
    });

    await expect(wb.version.commit()).resolves.toMatchObject({ ok: true });

    expect(wb.isDirty).toBe(true);
    expect(semanticMutationCapture.readNormalCommitCaptureState()).toMatchObject({
      pendingCapturedNormalMutationCount: 0,
      pendingUncapturedNormalMutationCount: 1,
    });
  });

  it('keeps workbook dirty when another dirty event lands during the async commit', async () => {
    const eventBus = createMockEventBus();
    let resolveCommit!: (value: unknown) => void;
    let notifyCommitStarted!: () => void;
    const commitStarted = new Promise<void>((resolve) => {
      notifyCommitStarted = resolve;
    });
    const commit = jest.fn(() => {
      notifyCommitStarted();
      return new Promise((resolve) => {
        resolveCommit = resolve;
      });
    });
    const wb = createWorkbook({
      eventBus,
      versioning: {
        writeService: { commit } as any,
      },
    });
    eventBus.emit({ type: 'test:dirty-before-commit' });

    const commitResult = wb.version.commit();
    await commitStarted;
    eventBus.emit({ type: 'test:dirty-during-commit' });
    resolveCommit(commitSummary('child'));

    await expect(commitResult).resolves.toMatchObject({ ok: true });
    expect(wb.isDirty).toBe(true);
  });
});

function emptyMutationResult() {
  return {
    recalc: {
      changedCells: [],
      projectionChanges: [],
      errors: [],
      validationAnnotations: [],
      metrics: {},
    },
  };
}

function cellWriteResult(value: unknown) {
  return {
    recalc: {
      changedCells: [
        {
          cellId: 'cell-a1',
          sheetId: 'sheet-1',
          position: { row: 0, col: 0 },
          oldValue: null,
          value,
          extraFlags: 0,
        },
      ],
      projectionChanges: [],
      errors: [],
      validationAnnotations: [],
      metrics: {},
    },
  };
}

function commitSummary(label: string) {
  return {
    id: commitId(label),
    parents: [commitId('root')],
    createdAt: CREATED_AT,
    author: VERSION_AUTHOR,
  };
}

function commitRef(label: string, revision: string) {
  return {
    id: commitId(label),
    refName: 'refs/heads/main',
    resolvedFrom: 'HEAD',
    refRevision: { kind: 'counter', value: revision },
  };
}

function commitId(label: string) {
  const byte = label === 'child' ? 'b' : label === 'moved' ? 'c' : 'a';
  return `commit:sha256:${byte.repeat(64)}`;
}

function operationContext(
  overrides: Partial<VersionOperationContext> = {},
): VersionOperationContext {
  return {
    operationId: 'operation-1',
    kind: 'mutation',
    author: VERSION_AUTHOR,
    createdAt: CREATED_AT,
    domainIds: ['test'],
    capturePolicy: 'commitEligible',
    writeAdmissionMode: 'capture',
    ...overrides,
  };
}

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

function missingChangeSetCommitResult(reason: string) {
  return {
    ok: false,
    error: {
      diagnostics: [
        expect.objectContaining({
          code: 'VERSION_MISSING_CHANGE_SET',
          data: expect.objectContaining({
            mutationGuarantee: 'no-write-attempted',
            payload: expect.objectContaining({
              reason,
              pendingCapturedNormalMutationCount: 0,
              pendingUncapturedNormalMutationCount: 1,
            }),
          }),
        }),
      ],
    },
  };
}

async function expectOnlyRootCommit(
  provider: ReturnType<typeof createInMemoryVersionStoreProvider>,
  graphId: string,
  initialized: Extract<VersionGraphInitializeResult, { status: 'success' }>,
): Promise<void> {
  const graph = await provider.openGraph(namespaceForDocumentScope(DOCUMENT_SCOPE, graphId));
  await expect(graph.readHead()).resolves.toMatchObject({
    status: 'success',
    head: {
      id: initialized.rootCommit.id,
      refRevision: initialized.initialHead.revision,
    },
  });
  const listed = await graph.listCommits();
  expect(listed).toMatchObject({
    status: 'success',
    commits: [{ id: initialized.rootCommit.id }],
  });
  if (listed.status !== 'success') {
    throw new Error(`expected commit list success: ${listed.diagnostics[0]?.code}`);
  }
  expect(listed.commits).toHaveLength(1);
}
