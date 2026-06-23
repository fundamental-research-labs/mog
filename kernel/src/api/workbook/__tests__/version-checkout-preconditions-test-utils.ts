import { expect, jest } from '@jest/globals';
import type { VersionHead, Workbook, WorkbookStateProvider } from '@mog-sdk/contracts/api';
import type { SheetId } from '@mog-sdk/contracts/core';
import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import { NO_HOST_OPERATION_GATE } from '../../../document/host-operation-gate';
import type { CheckoutSnapshotMaterializer } from '../../../document/version-store/checkout-apply';
import type { WorkbookCommitCompletenessDiagnostic } from '../../../document/version-store/commit-store';
import type { VersionGraphWriteResult } from '../../../document/version-store/graph-store';
import type { VersionObjectType } from '../../../document/version-store/object-digest';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../../../document/version-store/object-store';
import {
  pendingRemoteSegmentKeyMaterialForOperationContext,
  reservePersistedPendingRemoteSegment,
  type PendingRemoteSegmentOperationContext,
  type PendingRemoteSegmentStore,
  type ReservePendingRemoteSegmentInput,
} from '../../../document/version-store/pending-remote-segment-store';
import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
  type VersionGraphStore,
} from '../../../document/version-store/provider';
import {
  installVersionDomainDetectorNoopsOnWorkbook,
  withVersionManifest,
} from './version-domain-support-test-utils';

type MockEventBus = ReturnType<typeof createMockEventBus>;
type TestVersionStoreProvider = ReturnType<typeof createInMemoryVersionStoreProvider>;
export type InitializedVersionGraph = Extract<VersionGraphInitializeResult, { status: 'success' }>;

const SHEET_ID = 'sheet-1' as SheetId;
const SHEET_NAME = 'Sheet1';
const CREATED_AT = '2026-06-20T00:00:00.000Z';
const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'checkout-preconditions-doc',
  principalScope: 'principal-1',
};
const VERSION_AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};
export const PENDING_PROVIDER_SECRET = 'secret-pending-provider-write-room';
export const HISTORY_GAP_SECRET = 'secret-history-gap-marker';

const worksheetImplMock = jest.fn().mockImplementation((sheetId: string, ctx: any, meta: any) => {
  const cells = new Map<string, unknown>();
  return {
    _sheetId: sheetId,
    name: meta.name,
    index: meta.index,
    _syncMetadata: jest.fn(),
    dispose: jest.fn(),
    setCell: jest.fn(async (address: string, value: unknown) => {
      cells.set(address, value);
      ctx.eventBus.emit({ type: 'test:cell:set', sheetId, address });
    }),
    getCell: jest.fn(async (address: string) => ({
      address,
      value: cells.has(address) ? cells.get(address) : null,
    })),
  };
});

jest.unstable_mockModule('../../worksheet/worksheet-impl', () => ({
  WorksheetImpl: worksheetImplMock,
}));

const { WorkbookImpl } = await import('../workbook-impl');

export function resetCheckoutPreconditionMocks(): void {
  worksheetImplMock.mockClear();
}

export function createWorkbook(input: {
  readonly provider: TestVersionStoreProvider;
  readonly checkoutSnapshotMaterializer: CheckoutSnapshotMaterializer;
}): Workbook {
  const eventBus = createMockEventBus();
  const wb = new WorkbookImpl({
    ctx: createMockCtx(eventBus),
    eventBus,
    stateProvider: createStateProvider(),
    versioning: withVersionManifest({
      provider: input.provider,
      checkoutSnapshotMaterializer: input.checkoutSnapshotMaterializer,
    }),
  }) as Workbook;
  installVersionDomainDetectorNoopsOnWorkbook(wb);
  return wb;
}

export function failingMaterializer(): CheckoutSnapshotMaterializer {
  return {
    applySnapshot: jest.fn(async () => {
      throw new Error('checkout materialization should not run for rejected preconditions');
    }),
  };
}

export async function expectHead(wb: Workbook): Promise<VersionHead> {
  const result = await wb.version.getHead();
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`expected public version head: ${result.error.code}`);
  return result.value;
}

export async function expectHeadUnchanged(wb: Workbook, before: VersionHead): Promise<void> {
  const after = await expectHead(wb);
  expect(headProjection(after)).toEqual(headProjection(before));
}

export async function expectProviderHead(
  provider: TestVersionStoreProvider,
  graphId: string,
): Promise<ProviderHeadProjection> {
  const graph = await provider.openGraph(namespaceForDocumentScope(DOCUMENT_SCOPE, graphId));
  const result = await graph.readHead();
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected graph head read success: ${result.diagnostics[0]?.code}`);
  }
  return {
    id: result.head.id,
    refName: result.head.refName,
    resolvedFrom: result.head.resolvedFrom,
    refRevision: result.head.refRevision,
  };
}

export async function expectProviderHeadUnchanged(
  provider: TestVersionStoreProvider,
  graphId: string,
  before: ProviderHeadProjection,
): Promise<void> {
  await expect(expectProviderHead(provider, graphId)).resolves.toEqual(before);
}

export function versioningRuntimeForWorkbook(wb: Workbook): Record<string, unknown> {
  const version = wb.version as unknown as {
    readonly ctx?: { readonly versioning?: unknown };
    readonly versionContext?: { readonly versioning?: unknown };
  };
  const versioning = version.ctx?.versioning ?? version.versionContext?.versioning;
  if (!isMutableRecord(versioning)) throw new Error('expected attached versioning runtime');
  return versioning;
}

export function setSurfaceStatusService(
  wb: Workbook,
  service: {
    readonly readDirtyStatus: () => unknown;
    readonly readActiveCheckoutSession: () => unknown;
  },
): void {
  const runtime = versioningRuntimeForWorkbook(wb);
  runtime.surfaceStatusService = service;
  runtime.versionSurfaceStatusService = service;
}

export function spyOnCheckoutService(runtime: Record<string, unknown>) {
  const checkoutService = runtime.checkoutService;
  if (!isMutableRecord(checkoutService) || typeof checkoutService.checkout !== 'function') {
    throw new Error('expected attached checkout service');
  }
  return jest.spyOn(checkoutService as { checkout: (...args: unknown[]) => unknown }, 'checkout');
}

export function cleanDirtyStatus(statusRevision: string) {
  return {
    statusRevision,
    checkoutPreflightToken: `token:${statusRevision}`,
    hasUncommittedLocalChanges: false,
    commitEligibleChanges: false,
    unsupportedDirtyDomains: [],
    pendingProviderWrites: false,
    pendingRecalc: false,
    checkoutSafe: true,
    unsafeReasons: [],
    source: 'VC-05',
    diagnostics: [],
  };
}

export function unsafeAdmissionDirtyStatus() {
  const reason = {
    code: 'version.surfaceStatus.checkoutAdmissionDenied',
    severity: 'warning',
    message: 'Injected checkout admission denial.',
  };
  return {
    ...cleanDirtyStatus('generic-admission-denied'),
    checkoutSafe: false,
    unsafeReasons: [reason],
    diagnostics: [reason],
  };
}

export function unsupportedDomainDirtyStatus() {
  const reason = {
    code: 'version.surfaceStatus.unsupportedDirtyDomain',
    severity: 'warning' as const,
    message: 'Workbook has unsupported dirty domain state: secret-unsupported-domain-value.',
    dependency: 'VC-05' as const,
    data: {
      domainId: 'private-macros',
      path: 'private.unsupported.domains[0]',
      raw: 'secret-unsupported-domain-value',
    },
  };
  return {
    ...cleanDirtyStatus('unsupported-domain-admission-denied'),
    unsupportedDirtyDomains: ['private-macros'],
    checkoutSafe: false,
    unsafeReasons: [reason],
    diagnostics: [reason],
  };
}

export async function initializeVersionGraph(
  graphId: string,
  completenessDiagnostics: readonly WorkbookCommitCompletenessDiagnostic[] = [],
): Promise<{
  provider: TestVersionStoreProvider;
  initialized: InitializedVersionGraph;
}> {
  const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
  const initialized = await provider.initializeGraph(
    await initializeInput(graphId, 'root', completenessDiagnostics),
  );
  expectInitializeSuccess(initialized);
  return { provider, initialized };
}

export async function appendHeadCommit(
  provider: TestVersionStoreProvider,
  graphId: string,
  initialized: InitializedVersionGraph,
  label: string,
): Promise<Extract<VersionGraphWriteResult, { status: 'success' }>> {
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, graphId);
  const graph = await provider.openGraph(namespace);
  const input = await initializeInput(graphId, label);
  const result = await graph.commit({
    ...input.rootWrite,
    expectedHeadCommitId: initialized.rootCommit.id,
    expectedMainRefVersion: initialized.initialHead.revision,
  });
  expectGraphWriteSuccess(result);
  return result;
}

export async function persistPendingProviderWrite(
  provider: TestVersionStoreProvider,
  graphId: string,
): Promise<void> {
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, graphId);
  const graph = await provider.openGraph(namespace);
  const store = await provider.openPendingRemoteSegmentStore(namespace);
  const fixture = await pendingSegmentFixture(namespace);
  await persistAndReservePendingSegment(graph, store, fixture);
}

export function expectPublicDiagnosticsNotToLeak(
  result: unknown,
  forbidden: readonly string[],
): void {
  const serialized = JSON.stringify(result);
  for (const value of forbidden) {
    expect(serialized).not.toContain(value);
  }
}

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

function createMockCtx(eventBus: MockEventBus) {
  return {
    clock: {
      now: () => 0,
      dateNow: () => 0,
    },
    eventBus,
    computeBridge: {
      getAllSheetIds: jest.fn(async () => [SHEET_ID]),
      getSheetName: jest.fn(async () => SHEET_NAME),
      isSheetHidden: jest.fn(async () => false),
    },
    mirror: {
      getSheetIds: () => [SHEET_ID],
      getSheetMeta: () => ({ name: SHEET_NAME, hidden: false }),
    },
    writeGate: {
      assertWritable: jest.fn(),
    },
    operationGate: NO_HOST_OPERATION_GATE,
    services: {
      undo: {},
    },
    floatingObjectManager: {
      dispose: jest.fn(),
    },
    workbookLinks: {},
    workbookLinkScope: () => 'all',
    awaitMaterialized: jest.fn(async () => undefined),
    getMaterializationState: jest.fn(() => ({ status: 'ready' })),
    setPendingSelectionCheckpoint: jest.fn(),
    getPendingSelectionCheckpoint: jest.fn(() => null),
    clearPendingSelectionCheckpoint: jest.fn(),
  } as any;
}

function createStateProvider(): WorkbookStateProvider {
  return {
    getActiveSheetId: () => SHEET_ID,
    setActiveSheetId: jest.fn(),
    getActiveCell: () => null,
    getSelectedRanges: () => [],
    getActiveObjectId: () => null,
    getActiveObjectType: () => null,
  };
}

function headProjection(head: VersionHead) {
  return {
    id: head.id,
    refName: head.refName,
    resolvedFrom: head.resolvedFrom,
    refRevision: head.refRevision,
  };
}

type ProviderHeadProjection = {
  readonly id: string;
  readonly refName: string;
  readonly resolvedFrom: string;
  readonly refRevision?: unknown;
};

function isMutableRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is InitializedVersionGraph {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected initialize success: ${result.diagnostics[0]?.code}`);
  }
}

function expectGraphWriteSuccess(
  result: VersionGraphWriteResult,
): asserts result is Extract<VersionGraphWriteResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected graph write success: ${result.diagnostics[0]?.code}`);
  }
}

async function initializeInput(
  graphId: string,
  label: string,
  completenessDiagnostics: readonly WorkbookCommitCompletenessDiagnostic[] = [],
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
      completenessDiagnostics,
    },
  };
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

type PendingSegmentFixture = {
  readonly input: ReservePendingRemoteSegmentInput;
  readonly objectRecords: readonly VersionObjectRecord<unknown>[];
};

async function pendingSegmentFixture(
  namespace: VersionGraphNamespace,
): Promise<PendingSegmentFixture> {
  const operationContext = syncOperationContext();
  const keys = await pendingRemoteSegmentKeyMaterialForOperationContext(operationContext);
  const snapshotRootRecord = await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
    snapshotId: 'secret-pending-provider-snapshot',
    sheets: [],
  });
  const semanticChangeSetRecord = await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
    schemaVersion: 1,
    changes: [{ id: 'secret-pending-provider-change' }],
  });
  const mutationSegmentRecord = await objectRecord(namespace, 'workbook.mutationSegment.v1', {
    segmentId: 'secret-pending-provider-segment',
    domainId: 'runtime-diagnostics',
  });

  return {
    input: {
      pendingRemoteSegmentId: keys.pendingRemoteSegmentId,
      idempotencyKey: keys.idempotencyKey,
      operationContext,
      mutationSegmentDigest: mutationSegmentRecord.digest,
      snapshotRootDigest: snapshotRootRecord.digest,
      semanticChangeSetDigest: semanticChangeSetRecord.digest,
      createdAt: operationContext.createdAt,
    },
    objectRecords: [snapshotRootRecord, semanticChangeSetRecord, mutationSegmentRecord],
  };
}

function syncOperationContext(): PendingRemoteSegmentOperationContext {
  return {
    operationId: 'sync:providerLiveInbound:secret-pending-provider-update',
    kind: 'sync-import',
    author: {
      authorId: 'remote-user-1',
      actorKind: 'user',
      sessionId: 'remote-session-1',
    },
    createdAt: '2026-06-21T00:00:01.000Z',
    workbookId: DOCUMENT_SCOPE.documentId,
    domainIds: ['runtime-diagnostics'],
    capturePolicy: 'commitEligible',
    writeAdmissionMode: 'capture',
    collaboration: {
      sourceKind: 'providerLiveInbound',
      originKind: 'provider',
      stableOriginId: 'secret-pending-provider-origin',
      providerId: 'provider-1',
      roomId: PENDING_PROVIDER_SECRET,
      epoch: 'epoch-1',
      updateId: 'secret-pending-provider-update',
      sequence: '7',
      payloadHash: '3'.repeat(64),
      trustStatus: 'verified',
      authorState: 'singleRemote',
      remoteSessionId: 'remote-session-1',
      correlationId: 'secret-pending-provider-correlation',
      causationIds: ['secret-pending-provider-cause'],
      replay: false,
      system: false,
      commitGrouping: 'pendingRemote',
      validationDiagnosticCount: 0,
    },
  };
}

async function persistAndReservePendingSegment(
  graph: VersionGraphStore,
  store: PendingRemoteSegmentStore,
  fixture: PendingSegmentFixture,
): Promise<void> {
  await expect(graph.putObjects(fixture.objectRecords)).resolves.toMatchObject({
    status: 'success',
  });
  await expect(
    reservePersistedPendingRemoteSegment({ graph, store, input: fixture.input }),
  ).resolves.toMatchObject({ status: 'created' });
}
