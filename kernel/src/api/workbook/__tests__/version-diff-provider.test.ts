import { jest } from '@jest/globals';

import type { VersionAuthor } from '@mog-sdk/contracts/versioning';
import type { WorkbookConfig } from '../types';
import type { VersionNormalCommitCapture } from '../../../document/version-store/commit-service';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../../../document/version-store/object-store';
import type { VersionObjectType } from '../../../document/version-store/object-digest';
import {
  createInMemoryVersionStoreProvider,
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

const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  principalScope: 'principal-1',
};
const CREATED_AT = '2026-06-20T00:00:00.000Z';
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

describe('WorkbookVersion provider-backed diff facade', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('executes semantic diff through wb.version.diff when provider-backed versioning is configured', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
    expectInitializeSuccess(initialized);

    const captureNormalCommit = jest.fn(createSemanticDiffCommitCapture('child'));
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

    await expect(wb.version.diff(initialized.rootCommit.id, committed.id)).resolves.toEqual({
      status: 'success',
      items: [
        {
          structural: {
            kind: 'metadata',
            changeId: 'child-change-1',
            domain: 'cell',
            entityId: 'sheet-1!A1',
            propertyPath: ['value'],
          },
          before: { kind: 'value', value: 1 },
          after: { kind: 'value', value: 2 },
          display: {
            sheetName: { kind: 'value', value: 'Sheet1' },
            address: { kind: 'value', value: 'A1' },
          },
        },
      ],
      readRevision: { kind: 'counter', value: '1' },
      order: 'semantic-change-order',
      diagnostics: [],
    });
  });

  it('continues to degrade cleanly when a provider registry is unavailable', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const wb = createWorkbook({
      versioning: {
        provider,
        captureNormalCommit: jest.fn(createSemanticDiffCommitCapture('unused')),
      },
    });

    await expect(
      wb.version.diff(`commit:sha256:${'1'.repeat(64)}`, `commit:sha256:${'2'.repeat(64)}`),
    ).resolves.toMatchObject({
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
  });
});

function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected initialize success: ${result.diagnostics[0]?.issueCode}`);
  }
}

async function initializeInput(
  graphId: string,
  label: string,
): Promise<VersionGraphInitializeInput> {
  const namespace = {
    workspaceId: DOCUMENT_SCOPE.workspaceId,
    documentId: DOCUMENT_SCOPE.documentId,
    graphId,
    principalScope: DOCUMENT_SCOPE.principalScope,
  };
  return {
    expectedRegistryRevision: null,
    graphId,
    rootWrite: {
      snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
        label,
        sheets: [],
      }),
      semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
        schemaVersion: 1,
        changes: [],
      }),
      author: VERSION_AUTHOR,
      createdAt: CREATED_AT,
      completenessDiagnostics: [],
    },
  };
}

function createSemanticDiffCommitCapture(label: string): VersionNormalCommitCapture {
  return async ({ namespace, currentMain }) => ({
    status: 'success',
    input: {
      snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
        label,
        parent: currentMain.commitId,
        sheets: [],
      }),
      semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
        schemaVersion: 1,
        label,
        changes: [
          {
            changeId: `${label}-change-1`,
            domain: 'cell',
            entityId: 'sheet-1!A1',
            propertyPath: ['value'],
            before: { kind: 'value', value: 1 },
            after: { kind: 'value', value: 2 },
            display: {
              sheetName: { kind: 'value', value: 'Sheet1' },
              address: { kind: 'value', value: 'A1' },
            },
          },
        ],
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
