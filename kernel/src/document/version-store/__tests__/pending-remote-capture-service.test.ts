import type { VersionAuthor, VersionOperationContext } from '@mog-sdk/contracts/versioning';

import {
  capturePendingRemoteSemanticMutations,
  type PendingRemoteSemanticMutationCaptureRecord,
} from '../pending-remote-capture-service';
import {
  InMemoryVersionDocumentProviderBackend,
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
} from '../provider';
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

describe('pending remote capture service', () => {
  it('captures by sanitized stable remote identity across raw provider local echoes', async () => {
    const provider = createInMemoryVersionStoreProvider({
      documentScope: DOCUMENT_SCOPE,
      backend: new InMemoryVersionDocumentProviderBackend(),
      durability: 'snapshot-test-double',
    });
    const namespace = await initializeProvider(provider);
    const graph = await provider.openGraph(namespace);
    const registryRead = await provider.readGraphRegistry();
    if (registryRead.status !== 'ok') throw new Error('expected graph registry');
    const pendingRemoteSegmentStore = await provider.openPendingRemoteSegmentStore(namespace);

    const recordedContext = pendingRemoteOperationContext({
      operationId: 'operation-recorded',
      providerId: 'provider-raw-a',
      authorityRef: 'authority-raw-a',
      remoteSessionId: 'remote-session-raw-a',
      correlationId: 'correlation-raw-a',
      causationIds: ['cause-raw-a'],
    });
    const echoContext = pendingRemoteOperationContext({
      operationId: 'operation-local-echo',
      providerId: 'provider-raw-b',
      authorityRef: 'authority-raw-b',
      remoteSessionId: 'remote-session-raw-b',
      correlationId: 'correlation-raw-b',
      causationIds: ['cause-raw-b'],
    });
    const records: readonly PendingRemoteSemanticMutationCaptureRecord[] = [
      {
        sequence: 1,
        operation: 'compute_apply_sync_update',
        capturedAt: recordedContext.createdAt,
        operationContext: recordedContext,
        changes: [semanticChange('change-1')],
      },
    ];

    const first = await capturePendingRemoteSemanticMutations({
      capture: {
        provider,
        graph,
        accessContext: provider.accessContext,
        namespace,
        registry: registryRead.registry,
        pendingRemoteSegmentStore,
        operationContext: echoContext,
      },
      records,
      mutationSegmentPayload: (record) => ({
        schemaVersion: 1,
        operationContext: record.operationContext,
      }),
    });

    expect(first.status).toBe('success');
    if (first.status !== 'success') throw new Error('expected first capture success');
    expect(first.reservationStatus).toBe('created');
    expect(first.capturedRecordSequences).toEqual([1]);
    expectNoRawProviderIdentity(first.record.operationContext.collaboration);
    expect(first.record.syncIdentity).not.toHaveProperty('providerId');
    expect(first.record.syncIdentity).not.toHaveProperty('authorityRef');
    expectMutationSegmentHasNoRawProviderIdentity(first.objectRecords?.mutationSegmentRecord);

    const second = await capturePendingRemoteSemanticMutations({
      capture: {
        provider,
        graph,
        accessContext: provider.accessContext,
        namespace,
        registry: registryRead.registry,
        pendingRemoteSegmentStore,
        operationContext: pendingRemoteOperationContext({
          operationId: 'operation-local-echo-2',
          providerId: 'provider-raw-c',
          authorityRef: 'authority-raw-c',
          remoteSessionId: 'remote-session-raw-c',
          correlationId: 'correlation-raw-c',
          causationIds: ['cause-raw-c'],
        }),
      },
      records: [],
      mutationSegmentPayload: (record) => record,
    });

    expect(second).toMatchObject({
      status: 'success',
      reservationStatus: 'existing',
      record: { pendingRemoteSegmentId: first.record.pendingRemoteSegmentId },
      capturedRecordSequences: [],
    });
  });

  it('redacts raw provider identity from pending remote capture diagnostics', async () => {
    const provider = createInMemoryVersionStoreProvider({
      documentScope: DOCUMENT_SCOPE,
      backend: new InMemoryVersionDocumentProviderBackend(),
      durability: 'snapshot-test-double',
    });
    const namespace = await initializeProvider(provider);
    const graph = await provider.openGraph(namespace);
    const registryRead = await provider.readGraphRegistry();
    if (registryRead.status !== 'ok') throw new Error('expected graph registry');

    const result = await capturePendingRemoteSemanticMutations({
      capture: {
        provider,
        graph,
        accessContext: provider.accessContext,
        namespace,
        registry: registryRead.registry,
        pendingRemoteSegmentStore: failingReadPendingRemoteSegmentStore(namespace),
        operationContext: pendingRemoteOperationContext(),
      },
      records: [],
      mutationSegmentPayload: (record) => record,
    });

    expect(result).toMatchObject({
      status: 'failed',
      diagnostics: [
        {
          code: 'VERSION_PROVIDER_FAILED',
          details: { stableDetail: 'kept' },
        },
      ],
    });
    if (result.status !== 'failed') throw new Error('expected failed capture');
    expect(result.diagnostics[0]?.details).not.toHaveProperty('providerId');
    expect(result.diagnostics[0]?.details).not.toHaveProperty('providerRefId');
    expect(result.diagnostics[0]?.details).not.toHaveProperty('authorityRef');
    expect(result.diagnostics[0]?.details).not.toHaveProperty('remoteSessionId');
  });
});

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

function semanticChange(changeId: string) {
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

function pendingRemoteOperationContext(
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

function expectNoRawProviderIdentity(
  collaboration: NonNullable<VersionOperationContext['collaboration']>,
): void {
  expect(collaboration).not.toHaveProperty('providerId');
  expect(collaboration).not.toHaveProperty('providerKind');
  expect(collaboration).not.toHaveProperty('authorityRef');
  expect(collaboration).not.toHaveProperty('remoteSessionId');
  expect(collaboration).not.toHaveProperty('correlationId');
  expect(collaboration).not.toHaveProperty('causationIds');
}

function expectMutationSegmentHasNoRawProviderIdentity(
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

function failingReadPendingRemoteSegmentStore(
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

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
