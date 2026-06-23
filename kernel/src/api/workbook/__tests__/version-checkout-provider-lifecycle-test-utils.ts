import { expect, jest } from '@jest/globals';
import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import { DocumentFactory } from '../../document/document-factory';
import type { DocumentHandleInternal } from '../../document/document-handle-types';
import type { DocumentContext } from '../../../context';
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
  createVersionGraphRegistry,
  InMemoryVersionDocumentProviderBackend,
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
  type VersionGraphRegistry,
  type VersionGraphStore,
  type VersionStoreProvider,
} from '../../../document/version-store/provider';

const CREATED_AT = '2026-06-20T00:00:00.000Z';
export const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'checkout-provider-lifecycle-doc',
  principalScope: 'principal-1',
};
const VERSION_AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected initialize success: ${result.diagnostics[0]?.code}`);
  }
}

export async function initializeVersionGraph(
  options: { readonly backend?: InMemoryVersionDocumentProviderBackend } = {},
): Promise<{
  provider: ReturnType<typeof createInMemoryVersionStoreProvider>;
  initialized: Extract<VersionGraphInitializeResult, { status: 'success' }>;
}> {
  const provider = createInMemoryVersionStoreProvider({
    documentScope: DOCUMENT_SCOPE,
    ...(options.backend ? { backend: options.backend } : {}),
  });
  const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
  expectInitializeSuccess(initialized);
  return { provider, initialized };
}

export async function replaceVisibleRegistryGraph(
  backend: InMemoryVersionDocumentProviderBackend,
  graphId: string,
  label: string,
): Promise<void> {
  const input = await initializeInput(graphId, label);
  const graph = backend.getOrCreateGraph(namespaceForDocumentScope(DOCUMENT_SCOPE, graphId));
  const initialized = await graph.initializeGraph(input.rootWrite);
  if (initialized.status !== 'success') {
    throw new Error(
      `expected replacement graph initialize success: ${initialized.diagnostics[0]?.code}`,
    );
  }
  const registry = await createVersionGraphRegistry({
    documentScope: DOCUMENT_SCOPE,
    graphId,
    rootCommitId: initialized.commit.id,
    createdAt: initialized.commit.payload.createdAt,
  });
  backend.setRegistry(DOCUMENT_SCOPE, registry);
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

export async function pendingSegmentFixture(
  namespace: VersionGraphNamespace,
): Promise<PendingSegmentFixture> {
  const operationContext = syncOperationContext();
  const keys = await pendingRemoteSegmentKeyMaterialForOperationContext(operationContext);
  const snapshotRootRecord = await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
    snapshotId: 'checkout-provider-lifecycle-pending-snapshot',
    sheets: [],
  });
  const semanticChangeSetRecord = await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
    schemaVersion: 1,
    changes: [{ id: 'checkout-provider-lifecycle-pending-change' }],
  });
  const mutationSegmentRecord = await objectRecord(namespace, 'workbook.mutationSegment.v1', {
    segmentId: 'checkout-provider-lifecycle-pending-segment',
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
    operationId: 'sync:providerLiveInbound:checkout-provider-lifecycle-remote-update',
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
      stableOriginId: 'provider-stable-1',
      providerId: 'provider-1',
      roomId: 'room-1',
      epoch: 'epoch-1',
      updateId: 'checkout-provider-lifecycle-remote-update',
      sequence: '7',
      payloadHash: '3'.repeat(64),
      trustStatus: 'verified',
      authorState: 'singleRemote',
      remoteSessionId: 'remote-session-1',
      correlationId: 'checkout-provider-lifecycle-correlation',
      causationIds: ['checkout-provider-lifecycle-cause'],
      replay: false,
      system: false,
      commitGrouping: 'pendingRemote',
      validationDiagnosticCount: 0,
    },
  };
}

export async function persistAndReservePendingSegment(
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

export function providerWithFailingRegistryRead<T extends VersionStoreProvider>(
  provider: T,
): {
  readonly provider: T;
  readonly openGraphCalls: () => number;
} {
  let openGraphCalls = 0;
  const wrapped = new Proxy(provider, {
    get(target, prop, receiver) {
      if (prop === 'readGraphRegistry') {
        return async () => {
          throw new Error('registry unavailable during checkout admission');
        };
      }
      if (prop === 'openGraph') {
        return async (...args: Parameters<VersionStoreProvider['openGraph']>) => {
          openGraphCalls += 1;
          return target.openGraph(...args);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as T;

  return {
    provider: wrapped,
    openGraphCalls: () => openGraphCalls,
  };
}

export function providerWithStaleRegistryRead<T extends VersionStoreProvider>(
  provider: T,
  registry: VersionGraphRegistry,
): {
  readonly provider: T;
  readonly openGraphCalls: () => number;
  readonly useStaleRegistryAfterLiveReads: (count: number) => void;
} {
  let openGraphCalls = 0;
  let liveRegistryReadsBeforeStale = Number.POSITIVE_INFINITY;
  const wrapped = new Proxy(provider, {
    get(target, prop, receiver) {
      if (prop === 'readGraphRegistry') {
        return async () => {
          if (liveRegistryReadsBeforeStale > 0) {
            liveRegistryReadsBeforeStale -= 1;
            return target.readGraphRegistry();
          }
          return {
            status: 'ok' as const,
            registry,
            diagnostics: [],
          };
        };
      }
      if (prop === 'openGraph') {
        return async (...args: Parameters<VersionStoreProvider['openGraph']>) => {
          openGraphCalls += 1;
          return target.openGraph(...args);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as T;

  return {
    provider: wrapped,
    openGraphCalls: () => openGraphCalls,
    useStaleRegistryAfterLiveReads: (count: number) => {
      liveRegistryReadsBeforeStale = count;
    },
  };
}

export function versioningRuntimeForHandle(
  handle: Awaited<ReturnType<typeof DocumentFactory.create>>,
) {
  const context = (handle as DocumentHandleInternal).context as DocumentContext & {
    versioning?: unknown;
  };
  if (!isMutableRecord(context.versioning)) {
    throw new Error('expected attached versioning runtime');
  }
  return context.versioning;
}

function isMutableRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function bindProviderLifecycleGetAllSheetIds(
  handle: Awaited<ReturnType<typeof DocumentFactory.create>>,
): (() => Promise<unknown>) | null {
  const bridge = (
    (handle as Partial<DocumentHandleInternal>).context as DocumentContext | undefined
  )?.computeBridge;
  if (!isMutableRecord(bridge) || typeof bridge.getAllSheetIds !== 'function') return null;
  const getAllSheetIds = bridge.getAllSheetIds;
  return () => getAllSheetIds.call(bridge);
}

export function installProviderLifecycleMetadataNoops(
  handle: Awaited<ReturnType<typeof DocumentFactory.create>>,
  getAllSheetIds: (() => Promise<unknown>) | null,
): void {
  const bridge = (
    (handle as Partial<DocumentHandleInternal>).context as DocumentContext | undefined
  )?.computeBridge;
  if (!isMutableRecord(bridge)) return;
  if (getAllSheetIds) bridge.getAllSheetIds = getAllSheetIds;
  bridge.getSheetName = async () => 'Sheet1';
  bridge.isSheetHidden = async () => false;
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

export function attachStaleMaterializationVersioning(
  handle: Awaited<ReturnType<typeof DocumentFactory.create>>,
  documentScope: VersionDocumentScope,
): void {
  const context = (handle as DocumentHandleInternal).context as DocumentContext & {
    versioning?: unknown;
  };
  context.versioning = {
    provider: createInMemoryVersionStoreProvider({ documentScope }),
    checkoutService: {
      checkout: jest.fn(),
    },
  };
}
