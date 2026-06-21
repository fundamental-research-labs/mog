import { jest } from '@jest/globals';
import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import type { WorkbookConfig } from '../types';
import {
  InMemoryVersionDocumentProviderBackend,
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
  type VersionDocumentScope,
} from '../../../document/version-store/provider';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../../../document/version-store/object-store';
import type { VersionObjectType } from '../../../document/version-store/object-digest';

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
  return {
    on: jest.fn().mockReturnValue(() => undefined),
    onAll: jest.fn().mockReturnValue(() => undefined),
    onMany: jest.fn(),
    emit: jest.fn(),
    emitBatch: jest.fn(),
    clear: jest.fn(),
  };
}

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

describe('WorkbookVersion provider-backed ref lifecycle facade', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('routes public branch refs through the provider-attached lifecycle service', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
    expectInitializeSuccess(initialized);
    const graph = await provider.openGraph(namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1'));
    const childInput = await initializeInput('graph-1', 'branch-target');
    const child = await graph.commit({
      ...childInput.rootWrite,
      expectedHeadCommitId: initialized.rootCommit.id,
      expectedMainRefVersion: initialized.initialHead.revision,
    });
    expect(child.status).toBe('success');
    if (child.status !== 'success') {
      throw new Error(`expected child graph commit: ${child.diagnostics[0]?.code}`);
    }

    const wb = createWorkbook({
      versioning: {
        provider,
      },
    });

    await expect(
      wb.version.createBranch({
        name: 'scenario/provider-ref' as any,
        targetCommitId: initialized.rootCommit.id,
      }),
    ).resolves.toMatchObject({
      status: 'success',
      ref: {
        name: 'refs/heads/scenario/provider-ref',
        commitId: initialized.rootCommit.id,
        revision: { kind: 'counter', value: '0' },
      },
      diagnostics: [],
    });

    await expect(wb.version.readRef('refs/heads/scenario/provider-ref' as any)).resolves
      .toMatchObject({
        status: 'success',
        ref: {
          name: 'refs/heads/scenario/provider-ref',
          commitId: initialized.rootCommit.id,
          revision: { kind: 'counter', value: '0' },
        },
        diagnostics: [],
      });

    await expect(wb.version.listRefs({ prefix: 'scenario' as any })).resolves.toMatchObject({
      status: 'success',
      items: [
        expect.objectContaining({
          name: 'refs/heads/scenario/provider-ref',
          commitId: initialized.rootCommit.id,
        }),
      ],
      diagnostics: [],
    });

    await expect(
      wb.version.fastForwardBranch({
        name: 'scenario/provider-ref' as any,
        nextCommitId: child.commit.id,
        expectedHead: initialized.rootCommit.id,
        expectedRefRevision: { kind: 'counter', value: '0' },
      }),
    ).resolves.toMatchObject({
      status: 'success',
      ref: {
        name: 'refs/heads/scenario/provider-ref',
        commitId: child.commit.id,
        revision: { kind: 'counter', value: '1' },
      },
      diagnostics: [],
    });

    const status = await wb.version.getStatus();
    expect(status.refLifecycleFoundation).toMatchObject({
      stage: 'present',
      available: true,
      diagnostics: [
        expect.objectContaining({ code: 'version.refLifecycle.foundationPresent' }),
      ],
    });
  });

  it('fails closed for branch writes when the provider is read-only', async () => {
    const backend = new InMemoryVersionDocumentProviderBackend();
    const writer = createInMemoryVersionStoreProvider({
      documentScope: DOCUMENT_SCOPE,
      backend,
    });
    const initialized = await writer.initializeGraph(await initializeInput('graph-1', 'root'));
    expectInitializeSuccess(initialized);
    const provider = createInMemoryVersionStoreProvider({
      documentScope: DOCUMENT_SCOPE,
      backend,
      readOnly: true,
    });
    const wb = createWorkbook({
      versioning: {
        provider,
      },
    });

    await expect(wb.version.listRefs()).resolves.toMatchObject({
      status: 'success',
      items: [
        expect.objectContaining({
          name: 'refs/heads/main',
          commitId: initialized.rootCommit.id,
        }),
      ],
      diagnostics: [],
    });

    await expect(
      wb.version.createBranch({
        name: 'scenario/read-only' as any,
        targetCommitId: initialized.rootCommit.id,
      }),
    ).resolves.toMatchObject({
      status: 'degraded',
      ref: null,
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_REF_WRITE_UNAVAILABLE',
          mutationGuarantee: 'no-write-attempted',
        }),
      ],
    });

    await expect(wb.version.listRefs({ prefix: 'scenario' as any })).resolves.toMatchObject({
      status: 'success',
      items: [],
      diagnostics: [],
    });
  });
});

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

function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected version graph initialize success: ${result.diagnostics[0]?.code}`);
  }
}
