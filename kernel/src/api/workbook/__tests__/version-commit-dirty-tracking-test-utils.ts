import { expect, jest } from '@jest/globals';

import type { VersionAuthor, VersionOperationContext } from '@mog-sdk/contracts/versioning';
import type { WorkbookConfig } from '../types';
import type { VersionObjectType } from '../../../document/version-store/object-digest';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../../../document/version-store/object-store';
import {
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
  type createInMemoryVersionStoreProvider,
} from '../../../document/version-store/provider';
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

export const CREATED_AT = '2026-06-20T00:00:00.000Z';
export const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  principalScope: 'principal-1',
};
export const VERSION_AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

export function resetVersionCommitDirtyTrackingMocks() {
  jest.clearAllMocks();
}

export function createMockEventBus() {
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

export function createMockCtx(overrides: Record<string, unknown> = {}) {
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

export function createWorkbook(overrides?: Partial<WorkbookConfig>) {
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

export function emptyMutationResult() {
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

export function cellWriteResult(value: unknown) {
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

export function commitSummary(label: string) {
  return {
    id: commitId(label),
    parents: [commitId('root')],
    createdAt: CREATED_AT,
    author: VERSION_AUTHOR,
  };
}

export function commitRef(label: string, revision: string) {
  return {
    id: commitId(label),
    refName: 'refs/heads/main',
    resolvedFrom: 'HEAD',
    refRevision: { kind: 'counter', value: revision },
  };
}

export function commitId(label: string) {
  const byte = label === 'child' ? 'b' : label === 'moved' ? 'c' : 'a';
  return `commit:sha256:${byte.repeat(64)}`;
}

export function operationContext(
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

export function expectInitializeSuccess(
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

export async function initializeInput(
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

export function missingChangeSetCommitResult(reason: string) {
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

export async function expectOnlyRootCommit(
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
