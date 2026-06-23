import type { VersionAuthor, VersionOperationContext } from '@mog-sdk/contracts/versioning';

import {
  VERSION_OBJECT_SCHEMA_VERSION,
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
  type VersionObjectType,
} from '../object-store';
import type {
  PendingRemoteSegmentOperationContext,
  PendingRemoteSegmentStore,
} from '../pending-remote-segment-store';
import {
  InMemoryVersionDocumentProviderBackend,
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
  type VersionGraphStore,
} from '../provider';

const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  principalScope: 'principal-1',
};

const AUTHOR: VersionAuthor = {
  authorId: 'remote-user-1',
  actorKind: 'user',
  displayName: 'Remote User One',
};

export async function createPendingRemoteCaptureFixture() {
  const provider = createInMemoryVersionStoreProvider({
    documentScope: DOCUMENT_SCOPE,
    backend: new InMemoryVersionDocumentProviderBackend(),
    durability: 'snapshot-test-double',
  });
  const namespace = await initializeProvider(provider);
  const graph = await provider.openGraph(namespace);
  const registryRead = await provider.readGraphRegistry();
  if (registryRead.status !== 'ok') throw new Error('expected graph registry');

  return {
    provider,
    namespace,
    graph,
    registry: registryRead.registry,
  };
}

export async function createPendingRemoteCaptureFixtureWithPendingStore() {
  const fixture = await createPendingRemoteCaptureFixture();
  const pendingRemoteSegmentStore = await fixture.provider.openPendingRemoteSegmentStore(
    fixture.namespace,
  );

  return {
    ...fixture,
    pendingRemoteSegmentStore,
  };
}

export function semanticChange(changeId: string) {
  return {
    structural: {
      kind: 'metadata',
      changeId,
      domain: 'cells.values',
      entityId: 'cell-1',
      propertyPath: ['value'],
    },
    before: { kind: 'value', value: null },
    after: { kind: 'value', value: 'Remote value' },
  };
}

export function pendingRemoteOperationContext(
  overrides: Partial<VersionOperationContext> & {
    readonly providerId?: string;
    readonly authorityRef?: string;
    readonly remoteSessionId?: string;
    readonly correlationId?: string;
    readonly causationIds?: readonly string[];
    readonly collaboration?: Partial<NonNullable<VersionOperationContext['collaboration']>>;
  } = {},
): PendingRemoteSegmentOperationContext {
  const {
    providerId,
    authorityRef,
    remoteSessionId,
    correlationId,
    causationIds,
    collaboration: collaborationOverrides,
    ...contextOverrides
  } = overrides;
  const collaboration = {
    sourceKind: 'providerLiveInbound',
    originKind: 'provider',
    stableOriginId: 'provider-stable-1',
    providerId: providerId ?? 'provider-raw-1',
    providerKind: 'indexeddb',
    authorityRef: authorityRef ?? 'authority-raw-1',
    epoch: 'epoch-1',
    updateId: 'remote-update-1',
    sequence: '7',
    payloadHash: '3'.repeat(64),
    provenancePayloadHash: '5'.repeat(64),
    trustStatus: 'verified',
    authorState: 'singleRemote',
    remoteSessionId: remoteSessionId ?? 'remote-session-raw-1',
    correlationId: correlationId ?? 'correlation-raw-1',
    causationIds: causationIds ?? ['cause-raw-1'],
    replay: false,
    system: false,
    commitGrouping: 'pendingRemote',
    validationDiagnosticCount: 0,
    ...collaborationOverrides,
  } satisfies NonNullable<VersionOperationContext['collaboration']>;

  return {
    operationId: contextOverrides.operationId ?? 'operation-1',
    kind: 'sync-import',
    author: AUTHOR,
    createdAt: '2026-06-21T00:00:01.000Z',
    workbookId: 'workbook-1',
    domainIds: ['cells.values'],
    capturePolicy: 'commitEligible',
    writeAdmissionMode: 'capture',
    ...contextOverrides,
    collaboration,
  };
}

export function expectNoRawProviderIdentity(
  collaboration: NonNullable<VersionOperationContext['collaboration']>,
): void {
  expect(collaboration).not.toHaveProperty('providerId');
  expect(collaboration).not.toHaveProperty('providerKind');
  expect(collaboration).not.toHaveProperty('authorityRef');
  expect(collaboration).not.toHaveProperty('remoteSessionId');
  expect(collaboration).not.toHaveProperty('correlationId');
  expect(collaboration).not.toHaveProperty('causationIds');
}

export function expectMutationSegmentHasNoRawProviderIdentity(
  record: VersionObjectRecord<unknown> | undefined,
): void {
  expect(record).toBeDefined();
  const payload = record?.preimage.payload;
  if (!isRecord(payload)) throw new Error('expected mutation segment payload');
  const operationContext = payload.operationContext;
  if (!isRecord(operationContext) || !isRecord(operationContext.collaboration)) {
    throw new Error('expected mutation segment operation context');
  }
  expectNoRawProviderIdentity(
    operationContext.collaboration as NonNullable<VersionOperationContext['collaboration']>,
  );
  const mutations = payload.mutations;
  if (!Array.isArray(mutations) || !isRecord(mutations[0])) {
    throw new Error('expected mutation segment mutation payload');
  }
  const mutationOperationContext = mutations[0].operationContext;
  if (!isRecord(mutationOperationContext) || !isRecord(mutationOperationContext.collaboration)) {
    throw new Error('expected mutation operation context payload');
  }
  expectNoRawProviderIdentity(
    mutationOperationContext.collaboration as NonNullable<VersionOperationContext['collaboration']>,
  );
}

export function expectHistorySuspensionMutationSegment(
  record: VersionObjectRecord<unknown> | undefined,
): void {
  expect(record).toBeDefined();
  const payload = record?.preimage.payload;
  if (!isRecord(payload)) throw new Error('expected mutation segment payload');
  expect(payload).toMatchObject({
    historySuspension: {
      status: 'verified',
      reason: 'no-matching-semantic-mutations',
      capturePolicy: 'historyGap',
      writeAdmissionMode: 'captureSuspendedWithGap',
    },
    mutations: [],
    changeIds: [],
  });
  const operationContext = payload.operationContext;
  if (!isRecord(operationContext) || !isRecord(operationContext.collaboration)) {
    throw new Error('expected mutation segment operation context');
  }
  expect(operationContext).toMatchObject({
    capturePolicy: 'historyGap',
    writeAdmissionMode: 'captureSuspendedWithGap',
  });
  expectNoRawProviderIdentity(
    operationContext.collaboration as NonNullable<VersionOperationContext['collaboration']>,
  );
}

export function graphWithObjectWriteFailure(graph: VersionGraphStore): VersionGraphStore {
  return {
    ...graph,
    putObjects: async () => ({
      status: 'failed',
      mutationGuarantee: 'no-objects-written',
      diagnostics: [
        {
          code: 'VERSION_STORE_UNAVAILABLE',
          severity: 'error',
          message: 'Injected object write failure for provider-raw authority-raw.',
          objectType: 'workbook.mutationSegment.v1',
          details: {
            providerId: 'provider-raw',
            authorityRef: 'authority-raw',
            remoteSessionId: 'remote-session-raw',
          },
        },
      ],
    }),
  };
}

export function failingReadPendingRemoteSegmentStore(
  namespace: VersionGraphNamespace,
): PendingRemoteSegmentStore {
  return {
    namespace,
    reserveSegment: async () => {
      throw new Error('unexpected reserve');
    },
    readBySegmentId: async () => ({
      status: 'missing',
      record: null,
      diagnostics: [],
    }),
    readByIdempotencyKey: async () => ({
      status: 'failed',
      record: null,
      diagnostics: [
        {
          code: 'VERSION_PROVIDER_FAILED',
          message: 'Injected read failure.',
          recoverability: 'retry',
          details: {
            providerId: 'provider-raw',
            providerRefId: 'ProviderA',
            authorityRef: 'authority-raw',
            remoteSessionId: 'remote-session-raw',
            stableDetail: 'kept',
          },
        },
      ],
    }),
    listByState: async () => ({ status: 'success', records: [], diagnostics: [] }),
    completeSegment: async () => ({
      status: 'missing',
      record: null,
      diagnostics: [],
    }),
  };
}

export function failingReservePendingRemoteSegmentStore(
  namespace: VersionGraphNamespace,
): PendingRemoteSegmentStore {
  return {
    namespace,
    reserveSegment: async () => ({
      status: 'failed',
      record: null,
      diagnostics: [
        {
          code: 'VERSION_PROVIDER_FAILED',
          message: 'Injected reservation failure.',
          recoverability: 'retry',
          details: {
            providerId: 'provider-raw',
            providerRefId: 'ProviderA',
            authorityRef: 'authority-raw',
            remoteSessionId: 'remote-session-raw',
            stableDetail: 'kept',
          },
        },
      ],
    }),
    readBySegmentId: async () => ({
      status: 'missing',
      record: null,
      diagnostics: [],
    }),
    readByIdempotencyKey: async () => ({
      status: 'missing',
      record: null,
      diagnostics: [],
    }),
    listByState: async () => ({ status: 'success', records: [], diagnostics: [] }),
    completeSegment: async () => ({
      status: 'missing',
      record: null,
      diagnostics: [],
    }),
  };
}

async function initializeProvider(provider: {
  initializeGraph(input: VersionGraphInitializeInput): Promise<VersionGraphInitializeResult>;
}): Promise<VersionGraphNamespace> {
  const input = await initializeInput('graph-1');
  const initialized = await provider.initializeGraph(input);
  expect(initialized.status).toBe('success');
  if (initialized.status !== 'success') {
    throw new Error(`expected initialize success: ${initialized.diagnostics[0]?.code}`);
  }
  return namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1');
}

async function initializeInput(graphId: string): Promise<VersionGraphInitializeInput> {
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, graphId);
  return {
    expectedRegistryRevision: null,
    graphId,
    rootWrite: {
      snapshotRootRecord: await objectRecord(
        'workbook.snapshotRoot.v1',
        { label: 'root', sheets: [] },
        namespace,
      ),
      semanticChangeSetRecord: await objectRecord(
        'workbook.semanticChangeSet.v1',
        { label: 'root', changes: [] },
        namespace,
      ),
      author: AUTHOR,
      createdAt: '2026-06-20T00:00:00.000Z',
      completenessDiagnostics: [],
    },
  };
}

async function objectRecord(
  objectType: VersionObjectType,
  payload: unknown,
  namespace: VersionGraphNamespace,
): Promise<VersionObjectRecord<unknown>> {
  return createVersionObjectRecord(namespace, {
    objectType,
    schemaVersion: VERSION_OBJECT_SCHEMA_VERSION,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [],
    payload,
  });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
