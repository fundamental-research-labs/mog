import { jest } from '@jest/globals';

import type { VersionAuthor } from '@mog-sdk/contracts/versioning';
import type { WorkbookConfig } from '../types';
import {
  createCheckoutMaterializationService,
} from '../../../document/version-store/checkout-service';
import {
  createInMemoryWorkbookCommitStore,
  type CreateWorkbookCommitResult,
  type InMemoryWorkbookCommitStore,
} from '../../../document/version-store/commit-store';
import {
  InMemoryVersionObjectStore,
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

const NAMESPACE: VersionGraphNamespace = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  graphId: 'graph-1',
  principalScope: 'principal-1',
};
const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

type Stores = {
  readonly objectStore: InMemoryVersionObjectStore;
  readonly commitStore: InMemoryWorkbookCommitStore;
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

function createStores(): Stores {
  const objectStore = new InMemoryVersionObjectStore(NAMESPACE);
  return {
    objectStore,
    commitStore: createInMemoryWorkbookCommitStore(objectStore),
  };
}

function expectCreateSuccess(
  result: CreateWorkbookCommitResult,
): asserts result is Extract<CreateWorkbookCommitResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected commit create success: ${result.diagnostics[0]?.code}`);
  }
}

async function objectRecord(
  stores: Stores,
  objectType: VersionObjectType,
  payload: unknown,
): Promise<VersionObjectRecord<unknown>> {
  return createVersionObjectRecord(stores.objectStore.namespace, {
    objectType,
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [],
    payload,
  });
}

async function createCommit(stores: Stores, label: string) {
  const snapshotRootRecord = await objectRecord(stores, 'workbook.snapshotRoot.v1', {
    label,
    sheets: [],
  });
  const semanticChangeSetRecord = await objectRecord(stores, 'workbook.semanticChangeSet.v1', {
    label,
    changes: [],
  });
  const created = await stores.commitStore.createWorkbookCommit({
    documentId: NAMESPACE.documentId,
    parentCommitIds: [],
    snapshotRootRecord,
    semanticChangeSetRecord,
    mutationSegmentRecords: [],
    author: AUTHOR,
    createdAt: '2026-06-20T00:00:00.000Z',
    completenessDiagnostics: [],
  });
  expectCreateSuccess(created);
  return created.commit;
}

describe('WorkbookVersion checkout facade', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('degrades without fabricating workbook state when no checkout service is attached', async () => {
    const wb = createWorkbook();

    await expect(
      wb.version.checkout({ kind: 'commit', id: `commit:sha256:${'1'.repeat(64)}` }),
    ).resolves.toMatchObject({
      status: 'degraded',
      materialization: 'not-applied',
      plan: null,
      mutationGuarantee: 'no-workbook-mutation',
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_CHECKOUT_SERVICE_UNAVAILABLE',
          recoverability: 'unsupported',
          redacted: true,
          payload: expect.objectContaining({
            targetKind: 'commit',
          }),
        }),
      ],
    });
  });

  it('delegates through an attached CheckoutMaterializationService and returns a public plan', async () => {
    const stores = createStores();
    const commit = await createCommit(stores, 'root');
    const checkoutService = createCheckoutMaterializationService({
      commitReader: stores.commitStore,
      dependencyReader: {
        hasDependency: (dependency) => stores.objectStore.hasObject(dependency),
      },
    });
    const planCheckout = jest.spyOn(checkoutService, 'planCheckout');
    const wb = createWorkbook({
      ctx: createMockCtx({
        versioning: {
          checkoutService,
        },
      }),
    });

    const result = await wb.version.checkout({ kind: 'commit', id: commit.id });

    expect(planCheckout).toHaveBeenCalledWith({ target: 'commit', commitId: commit.id });
    expect(result).toMatchObject({
      status: 'success',
      materialization: 'planned',
      mutationGuarantee: 'no-workbook-mutation',
      plan: {
        strategy: 'fullSnapshot',
        commitId: commit.id,
        parentCommitIds: [],
        target: {
          kind: 'commit',
          commitId: commit.id,
        },
        requiredDependencies: [
          { role: 'snapshotRoot', objectType: 'workbook.snapshotRoot.v1' },
          { role: 'semanticChangeSet', objectType: 'workbook.semanticChangeSet.v1' },
        ],
        requiredDependencyCount: 2,
      },
      diagnostics: [],
    });
    expect(JSON.stringify(result)).not.toContain('digest');
  });
});
