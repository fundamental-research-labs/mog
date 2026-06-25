import { createHash } from 'node:crypto';
import { jest } from '@jest/globals';
import type { VersionAuthor, VersionOperationContext } from '@mog-sdk/contracts/versioning';
import {
  DEFAULT_PROVENANCE_REDACTION_POLICY,
  PROVIDER_INBOUND_V2_BASE_PROOF_FIELDS,
  PROVIDER_INBOUND_V2_SINGLE_AUTHOR_PROOF_FIELDS,
  type ProviderAuthorityProof,
  type ProviderInboundProofField,
  type ProviderInboundUpdateEnvelopeV2,
  type SyncUpdateProvenance,
} from '@mog-sdk/types-document/storage';

import type {
  MutationResult,
  ObjectDigest,
  SemanticWorkbookDiff,
  SemanticWorkbookState,
  SemanticWorkbookStateEnvelope,
  SyncApplyMutationMetadataWire,
} from '../../bridges/compute/compute-types.gen';
import {
  createAdmittedSyncApplyContext,
  toSyncApplyOperationContextWire,
  type AdmittedSyncApplyContext,
} from '../../bridges/compute/sync-apply-admission';
import { RustDocument } from '../rust-document';
import type { Provider, ProviderDocApplyUpdateMetadata } from '../providers/provider';
import {
  appliedSyncUpdateIdentityKeyMaterialForOperationContext,
  type AppliedSyncUpdateIdentityStore,
} from '../version-store/applied-sync-update-identity-store';
import {
  VERSION_OBJECT_SCHEMA_VERSION,
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectType,
} from '../version-store/object-store';
import {
  InMemoryVersionDocumentProviderBackend,
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionGraphStore,
  type VersionDocumentScope,
} from '../version-store/provider';
import type { VersionPendingRemoteCaptureResult } from '../version-store/pending-remote-capture-service';
import { createSemanticMutationCapture } from '../version-store/semantic-mutation-capture';
import type { VersionSemanticStateReaderPort } from '../version-store/semantic-state-reader';

type StubBridge = {
  subscribeUpdateV1(cb: (u: Uint8Array) => void): { unsubscribe: () => void };
  createEngine(): Promise<unknown>;
  createEngineFromYrsState(state: Uint8Array): Promise<unknown>;
  flushUndoCapture(): Promise<unknown>;
  syncApply(u: Uint8Array): Promise<unknown>;
  syncApplyWithMetadata(
    u: Uint8Array,
    syncApplyContext: AdmittedSyncApplyContext,
  ): Promise<{ mutationResult: MutationResult; metadata: SyncApplyMutationMetadataWire }>;
  recordProviderDocApplyUpdateAdmission(metadata: ProviderDocApplyUpdateMetadata): void;
  encodeDiff(stateVector: Uint8Array): Promise<Uint8Array>;
  currentStateVector(): Promise<Uint8Array>;
  flushPendingUpdateV1(): Promise<void>;
  readonly admissions: ProviderDocApplyUpdateMetadata[];
};

const VERSION_DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'pending-remote-sync-capture-doc',
  principalScope: 'principal-1',
};

const VERSION_AUTHOR: VersionAuthor = {
  authorId: 'test-author-1',
  actorKind: 'user',
  displayName: 'Test Author',
};

const STORAGE_SCOPE = {
  kind: 'scoped',
  scope: {
    tenantId: { kind: 'single-tenant' },
    workspaceId: { kind: 'no-workspace' },
    documentId: VERSION_DOCUMENT_SCOPE.documentId,
  },
} as const;

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('RustDocument pending remote sync capture', () => {
  it('captures semantic pending-remote segments and links them from applied identity terminal metadata', async () => {
    const versionProvider = createInMemoryVersionStoreProvider({
      documentScope: VERSION_DOCUMENT_SCOPE,
      backend: new InMemoryVersionDocumentProviderBackend(),
      durability: 'inbound-update-test-double',
    });
    const namespace = await initializeVersionGraph(versionProvider, 'graph-pending-remote-sync');
    const identityStore = await versionProvider.openAppliedSyncUpdateIdentityStore();
    const pendingRemoteSegmentStore =
      await versionProvider.openPendingRemoteSegmentStore(namespace);
    const semanticMutationCapture = createSemanticMutationCapture({
      author: VERSION_AUTHOR,
      now: () => new Date('2026-06-21T00:00:00.000Z'),
    });
    const { doc, bridge } = await makeOrchestrator({ identityStore, semanticMutationCapture });
    await doc.installVersionSyncServices({
      provider: versionProvider,
      semanticMutationCapture,
    });
    await doc.attachProvider(makeProvider('ProviderA'));

    const envelope = makeEnvelope({
      payload: new Uint8Array([0x55, 0x56]),
      updateId: 'pending-remote-capture-1',
    });
    const result = await doc.applyProviderUpdate(envelope);

    expect(result.status).toBe('applied');
    expect(bridge.admissions).toHaveLength(1);
    const identityKey = await appliedIdentityKeyForAdmission(bridge.admissions[0]!);
    const identityRead = await identityStore.readByIdentityKey(identityKey);
    expect(identityRead).toMatchObject({
      status: 'found',
      record: {
        state: 'applied',
        terminal: {
          status: 'applied',
          pendingRemoteSegmentId: expect.stringMatching(
            /^pending-remote-segment:sha256:[0-9a-f]{64}$/,
          ),
          mutationSegmentDigest: {
            algorithm: 'sha256',
            digest: expect.stringMatching(/^[0-9a-f]{64}$/),
          },
        },
      },
    });
    if (identityRead.status !== 'found' || identityRead.record.terminal?.status !== 'applied') {
      throw new Error('expected applied identity terminal');
    }

    const pendingRemoteSegmentId = identityRead.record.terminal.pendingRemoteSegmentId!;
    await expect(
      pendingRemoteSegmentStore.readBySegmentId(pendingRemoteSegmentId as never),
    ).resolves.toMatchObject({
      status: 'found',
      record: {
        pendingRemoteSegmentId,
        state: 'pending',
        mutationSegmentDigest: identityRead.record.terminal.mutationSegmentDigest,
        operationContext: {
          collaboration: {
            commitGrouping: 'pendingRemote',
            updateId: envelope.updateId,
          },
        },
      },
    });

    await doc.destroy();
  });

  it('materializes matching pending-remote records and drains only that sync context', async () => {
    const versionProvider = createInMemoryVersionStoreProvider({
      documentScope: VERSION_DOCUMENT_SCOPE,
      backend: new InMemoryVersionDocumentProviderBackend(),
    });
    const namespace = await initializeVersionGraph(
      versionProvider,
      'graph-pending-remote-direct-capture',
    );
    const { graph, registry, pendingRemoteSegmentStore } =
      await openPendingRemoteCaptureDependencies(versionProvider, namespace);
    const semanticStateReader = sheetRenameSemanticStateReader();
    const semanticMutationCapture = createSemanticMutationCapture({
      author: VERSION_AUTHOR,
      now: () => new Date('2026-06-21T00:00:00.000Z'),
      semanticStateReader,
    });
    const matchingContext = pendingRemoteOperationContext({
      operationId: 'remote-operation-a',
      updateId: 'remote-update-a',
      payloadHash: 'a'.repeat(64),
    });
    const unrelatedContext = pendingRemoteOperationContext({
      operationId: 'remote-operation-b',
      updateId: 'remote-update-b',
      payloadHash: 'b'.repeat(64),
    });

    semanticMutationCapture.mutationCapture.recordMutationResult({
      operation: 'compute_apply_sync_update',
      operationContext: matchingContext,
      result: syncAuthoredCellMutationResult({ cellId: 'remote-cell-a', value: 'Remote A' }),
    });
    semanticMutationCapture.mutationCapture.recordMutationResult({
      operation: 'compute_apply_sync_update',
      operationContext: unrelatedContext,
      result: syncAuthoredCellMutationResult({ cellId: 'remote-cell-b', value: 'Remote B' }),
    });
    await semanticMutationCapture.mutationCapture.recordPreMutation?.({
      operation: 'compute_rename_compute_sheet',
    });
    semanticMutationCapture.mutationCapture.recordMutationResult({
      operation: 'compute_rename_compute_sheet',
      result: sheetRenameMutationResult('sheet-local', 'Sheet1', 'Local Sheet'),
    });

    const captured = expectPendingCaptureSuccess(
      await semanticMutationCapture.capturePendingRemoteSegment({
        provider: versionProvider,
        graph,
        accessContext: versionProvider.accessContext,
        namespace,
        registry,
        pendingRemoteSegmentStore,
        operationContext: matchingContext,
        snapshotRootByteSyncPort: { encodeDiff: async () => new Uint8Array([0x01, 0x02]) },
      }),
    );

    expect(captured.reservationStatus).toBe('created');
    expect(captured.capturedRecordSequences).toEqual([1]);
    expect(captured.objectRecords).toBeDefined();
    expect(captured.objectRecords?.mutationSegmentRecord.preimage).toMatchObject({
      objectType: 'workbook.mutationSegment.v1',
      payload: {
        lane: 'pendingRemote',
        operationContext: {
          kind: 'sync-import',
          collaboration: {
            stableOriginId: 'provider-stable-1',
            updateId: 'remote-update-a',
            payloadHash: 'a'.repeat(64),
          },
        },
        mutations: [expect.objectContaining({ operation: 'compute_apply_sync_update' })],
      },
    });
    const mutationSegmentPayload = captured.objectRecords?.mutationSegmentRecord.preimage
      .payload as {
      readonly operationContext?: {
        readonly collaboration?: Readonly<Record<string, unknown>>;
      };
    };
    expect(mutationSegmentPayload.operationContext?.collaboration).not.toHaveProperty('providerId');
    expect(mutationSegmentPayload.operationContext?.collaboration).not.toHaveProperty(
      'remoteSessionId',
    );
    expect(captured.objectRecords?.semanticChangeSetRecord?.preimage).toMatchObject({
      objectType: 'workbook.semanticChangeSet.v1',
      payload: {
        changes: [
          expect.objectContaining({
            after: expect.objectContaining({ value: 'Remote A' }),
          }),
        ],
      },
    });
    expect(captured.objectRecords?.snapshotRootRecord?.preimage).toMatchObject({
      objectType: 'workbook.snapshotRoot.v1',
    });
    await expectPersistedPendingObjects(graph, captured);
    await expect(
      pendingRemoteSegmentStore.readBySegmentId(captured.record.pendingRemoteSegmentId),
    ).resolves.toMatchObject({
      status: 'found',
      record: {
        pendingRemoteSegmentId: captured.record.pendingRemoteSegmentId,
        state: 'pending',
        mutationSegmentDigest: captured.record.mutationSegmentDigest,
        semanticChangeSetDigest: captured.record.semanticChangeSetDigest,
        snapshotRootDigest: captured.record.snapshotRootDigest,
        operationContext: {
          kind: 'sync-import',
          collaboration: {
            stableOriginId: 'provider-stable-1',
            updateId: 'remote-update-a',
            payloadHash: 'a'.repeat(64),
          },
        },
      },
    });

    expect(pendingRemoteSnapshots(semanticMutationCapture)).toMatchObject([
      { sequence: 2, operationContext: unrelatedContext },
    ]);
    const normalCommitCapture = await semanticMutationCapture.captureNormalCommit({
      namespace,
    } as Parameters<typeof semanticMutationCapture.captureNormalCommit>[0]);
    if (normalCommitCapture.status !== 'success') {
      throw new Error(
        `expected normal commit capture success: ${JSON.stringify(normalCommitCapture)}`,
      );
    }
    expect(semanticStateReader.readCurrentSemanticState).toHaveBeenCalledTimes(2);
    expect(semanticStateReader.diffSemanticStates).toHaveBeenCalledTimes(1);
    expect(normalCommitCapture.input.semanticChangeSetRecord.preimage.payload).toMatchObject({
      schemaVersion: 1,
      source: { kind: 'rustSemanticDiff' },
      changes: [
        expect.objectContaining({
          domainId: 'sheets',
          objectId: 'sheet-local',
          objectKind: 'sheet',
          kind: 'updated',
        }),
      ],
      reviewChanges: [
        expect.objectContaining({
          after: { kind: 'value', value: 'Local Sheet' },
        }),
      ],
    });
  });

  it('ignores non-pending sync contexts without graph writes or pending drains', async () => {
    const versionProvider = createInMemoryVersionStoreProvider({
      documentScope: VERSION_DOCUMENT_SCOPE,
      backend: new InMemoryVersionDocumentProviderBackend(),
    });
    const namespace = await initializeVersionGraph(versionProvider, 'graph-pending-remote-ignore');
    const { graph, registry, pendingRemoteSegmentStore } =
      await openPendingRemoteCaptureDependencies(versionProvider, namespace);
    const tracked = trackPutObjects(graph);
    const semanticMutationCapture = createSemanticMutationCapture({
      author: VERSION_AUTHOR,
      now: () => new Date('2026-06-21T00:00:00.000Z'),
    });
    const pendingContext = pendingRemoteOperationContext({
      operationId: 'remote-operation-ignore-buffered',
      updateId: 'remote-update-ignore-buffered',
      payloadHash: 'c'.repeat(64),
    });

    semanticMutationCapture.mutationCapture.recordMutationResult({
      operation: 'compute_apply_sync_update',
      operationContext: pendingContext,
      result: syncAuthoredCellMutationResult({ cellId: 'remote-cell-ignore' }),
    });

    await expect(
      semanticMutationCapture.capturePendingRemoteSegment({
        provider: versionProvider,
        graph: tracked.graph,
        accessContext: versionProvider.accessContext,
        namespace,
        registry,
        pendingRemoteSegmentStore,
        operationContext: pendingRemoteOperationContext({
          operationId: 'remote-operation-not-pending',
          updateId: 'remote-update-not-pending',
          payloadHash: 'd'.repeat(64),
          commitGrouping: 'none',
        }),
      }),
    ).resolves.toEqual({
      status: 'ignored',
      reason: 'not-pending-remote',
      diagnostics: [],
    });
    expect(tracked.putObjects).not.toHaveBeenCalled();
    expect(pendingRemoteSnapshots(semanticMutationCapture)).toHaveLength(1);
  });

  it('returns an existing segment for equivalent repeats without duplicating graph objects', async () => {
    const versionProvider = createInMemoryVersionStoreProvider({
      documentScope: VERSION_DOCUMENT_SCOPE,
      backend: new InMemoryVersionDocumentProviderBackend(),
    });
    const namespace = await initializeVersionGraph(
      versionProvider,
      'graph-pending-remote-idempotent',
    );
    const { graph, registry, pendingRemoteSegmentStore } =
      await openPendingRemoteCaptureDependencies(versionProvider, namespace);
    const semanticMutationCapture = createSemanticMutationCapture({
      author: VERSION_AUTHOR,
      now: () => new Date('2026-06-21T00:00:00.000Z'),
    });
    const operationContext = pendingRemoteOperationContext({
      operationId: 'remote-operation-idempotent',
      updateId: 'remote-update-idempotent',
      payloadHash: 'e'.repeat(64),
    });

    semanticMutationCapture.mutationCapture.recordMutationResult({
      operation: 'compute_apply_sync_update',
      operationContext,
      result: syncAuthoredCellMutationResult({ cellId: 'remote-cell-idempotent' }),
    });
    const first = expectPendingCaptureSuccess(
      await semanticMutationCapture.capturePendingRemoteSegment({
        provider: versionProvider,
        graph,
        accessContext: versionProvider.accessContext,
        namespace,
        registry,
        pendingRemoteSegmentStore,
        operationContext,
      }),
    );
    expect(first.reservationStatus).toBe('created');
    expect(pendingRemoteSnapshots(semanticMutationCapture)).toEqual([]);

    semanticMutationCapture.mutationCapture.recordMutationResult({
      operation: 'compute_apply_sync_update',
      operationContext,
      result: syncAuthoredCellMutationResult({ cellId: 'remote-cell-idempotent' }),
    });
    const tracked = trackPutObjects(graph);
    const second = expectPendingCaptureSuccess(
      await semanticMutationCapture.capturePendingRemoteSegment({
        provider: versionProvider,
        graph: tracked.graph,
        accessContext: versionProvider.accessContext,
        namespace,
        registry,
        pendingRemoteSegmentStore,
        operationContext,
      }),
    );

    expect(second.reservationStatus).toBe('existing');
    expect(second.record).toEqual(first.record);
    expect(second.objectRecords).toBeUndefined();
    expect(second.capturedRecordSequences).toEqual([2]);
    expect(tracked.putObjects).not.toHaveBeenCalled();
    expect(pendingRemoteSnapshots(semanticMutationCapture)).toEqual([]);
  });
});

async function makeOrchestrator(options: {
  readonly identityStore: AppliedSyncUpdateIdentityStore;
  readonly semanticMutationCapture: ReturnType<typeof createSemanticMutationCapture>;
}): Promise<{ doc: RustDocument; bridge: StubBridge }> {
  const bridge = makeBridge(options.semanticMutationCapture);
  const doc = new RustDocument({
    docId: VERSION_DOCUMENT_SCOPE.documentId,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    computeBridge: bridge as any,
    internal: true,
    skipPersistenceLoad: true,
    appliedSyncUpdateIdentityStore: options.identityStore,
  });
  await doc.ready;
  return { doc, bridge };
}

function makeBridge(
  semanticMutationCapture: ReturnType<typeof createSemanticMutationCapture>,
): StubBridge {
  const subscribers = new Set<(u: Uint8Array) => void>();
  const admissions: ProviderDocApplyUpdateMetadata[] = [];
  return {
    subscribeUpdateV1(cb) {
      subscribers.add(cb);
      return { unsubscribe: () => subscribers.delete(cb) };
    },
    createEngine: async () => ({ recalc: { changedCells: [] } }),
    createEngineFromYrsState: async () => ({ recalc: { changedCells: [] } }),
    flushUndoCapture: async () => ({ recalc: { changedCells: [] } }),
    syncApply: async (update) => {
      for (const subscriber of subscribers) subscriber(update);
      return { recalc: { changedCells: [] } };
    },
    syncApplyWithMetadata: async (update, syncApplyContext) => {
      const mutationResult = syncAuthoredCellMutationResult();
      semanticMutationCapture.mutationCapture.recordMutationResult({
        operation: 'compute_apply_sync_update',
        operationContext: syncApplyContext.operationContext,
        result: mutationResult,
      });
      for (const subscriber of subscribers) subscriber(update);
      return {
        mutationResult,
        metadata: {
          mutationResult,
          provenanceReport: {
            appliedContext: toSyncApplyOperationContextWire(syncApplyContext),
            pendingSegmentStatus: 'notEvaluated',
            pendingSegmentIds: [],
            batchDurabilityStatus: 'notEvaluated',
          },
        } as SyncApplyMutationMetadataWire,
      };
    },
    recordProviderDocApplyUpdateAdmission(metadata) {
      admissions.push(metadata);
    },
    encodeDiff: async () => new Uint8Array(),
    currentStateVector: async () => new Uint8Array(),
    flushPendingUpdateV1: async () => {},
    admissions,
  };
}

function makeProvider(name: string): Provider {
  return {
    name,
    appendUpdate: () => {},
    attach: async () => {},
    flush: async () => {},
    checkpointFullState: async () => {},
    flushSync: () => {},
    detach: async () => {},
    stateVector: async () => new Uint8Array(),
    flushFailed: false,
  };
}

function makeEnvelope(
  overrides: Partial<ProviderInboundUpdateEnvelopeV2> = {},
): ProviderInboundUpdateEnvelopeV2 {
  const {
    provenance: provenanceOverride,
    authorityProof: authorityProofOverride,
    ...baseOverrides
  } = overrides;
  const payload = overrides.payload ?? new Uint8Array([0x10, 0x20]);
  const payloadHash = overrides.payloadHash ?? sha256Hex(payload);
  const base = {
    providerRefId: 'ProviderA',
    authorityRef: 'authority-1',
    storageScope: STORAGE_SCOPE,
    decisionId: 'decision-1',
    sessionId: 'local-session-1',
    payloadKind: 'yrs-update-v1' as const,
    payload,
    payloadHash,
    updateId: 'pending-remote-capture-update-1',
    providerEpoch: '1',
    schemaVersion: 'provider-inbound-update-v2' as const,
    ...baseOverrides,
  };
  const provenance = provenanceOverride ?? liveProvenance(base);
  return {
    ...base,
    provenance,
    authorityProof:
      authorityProofOverride ??
      proof(
        [
          ...PROVIDER_INBOUND_V2_BASE_PROOF_FIELDS,
          ...PROVIDER_INBOUND_V2_SINGLE_AUTHOR_PROOF_FIELDS,
          'providerId',
          'providerKind',
        ],
        provenance.updateIdentity.provenancePayloadHash ?? 'c'.repeat(64),
      ),
  };
}

function liveProvenance(envelope: {
  readonly providerRefId: string;
  readonly authorityRef: string;
  readonly storageScope: typeof STORAGE_SCOPE;
  readonly providerEpoch: string;
  readonly updateId: string;
  readonly payloadHash: string;
}): SyncUpdateProvenance {
  const provenancePayloadHash = 'c'.repeat(64);
  return {
    schemaVersion: 'sync-update-provenance-v1',
    sourceKind: 'providerLiveInbound',
    updateIdentity: {
      originKind: 'provider',
      stableOriginId: 'provider-stable-1',
      providerId: 'provider-stable-1',
      providerKind: 'test-provider',
      providerRefId: envelope.providerRefId,
      storageScope: envelope.storageScope,
      authorityRef: envelope.authorityRef,
      epoch: envelope.providerEpoch,
      updateId: envelope.updateId,
      payloadHash: envelope.payloadHash,
      provenancePayloadHash,
    },
    trust: {
      status: 'verified',
      authorityRef: 'authority-1',
      proofKind: 'signed-provider-message',
      proofCoverage: [
        ...PROVIDER_INBOUND_V2_BASE_PROOF_FIELDS,
        ...PROVIDER_INBOUND_V2_SINGLE_AUTHOR_PROOF_FIELDS,
        'providerId',
        'providerKind',
      ],
      issuer: 'issuer-1',
    },
    author: {
      kind: 'singleRemote',
      remoteAuthorRef: { kind: 'opaque-subject-ref', value: 'subject-ref-1' },
    },
    remoteSessionId: 'remote-session-1',
    replay: false,
    system: false,
    capturePolicy: 'commitEligible',
    redaction: {
      ...DEFAULT_PROVENANCE_REDACTION_POLICY,
      mode: 'opaque-digest-only',
      durableAuthorIdentity: 'opaque-subject-ref',
      durableProviderIdentity: 'opaque-provider-ref',
    },
  };
}

function proof(
  coveredFields: readonly ProviderInboundProofField[],
  canonicalPayloadHash: string,
): ProviderAuthorityProof {
  return {
    kind: 'signed-provider-message',
    issuer: 'issuer-1',
    algorithm: 'ed25519',
    issuedAt: 1,
    coveredFields,
    canonicalPayloadHash,
    proofBytesOrRef: 'proof-ref-1',
  };
}

function syncAuthoredCellMutationResult(
  options: {
    readonly cellId?: string;
    readonly sheetId?: string;
    readonly value?: string;
  } = {},
): MutationResult {
  return {
    recalc: {
      changedCells: [],
      projectionChanges: [],
      errors: [],
      validationAnnotations: [],
      metrics: {},
    },
    authoredCellChanges: [
      {
        cellId: options.cellId ?? 'remote-cell-1',
        sheetId: options.sheetId ?? 'sheet-remote-1',
        position: { row: 0, col: 0 },
        oldValue: null,
        value: options.value ?? 'Remote',
        extraFlags: 0,
      },
    ],
  } as unknown as MutationResult;
}

function sheetRenameMutationResult(sheetId: string, oldName: string, name: string): MutationResult {
  return {
    recalc: {
      changedCells: [],
      projectionChanges: [],
      errors: [],
      validationAnnotations: [],
      metrics: {},
    },
    sheetChanges: [
      {
        sheetId,
        kind: 'Set',
        field: 'name',
        oldName,
        name,
      },
    ],
  } as MutationResult;
}

function sheetRenameSemanticStateReader(): VersionSemanticStateReaderPort {
  const before = semanticStateEnvelope('Sheet1', 'a');
  const after = semanticStateEnvelope('Local Sheet', 'b');
  const semanticDiff: SemanticWorkbookDiff = {
    beforeDigest: digest('a'),
    afterDigest: digest('b'),
    changes: [
      {
        changeId: 'rust-diff:sheet-local:name',
        kind: 'updated',
        domainId: 'sheets',
        objectId: 'sheet-local',
        objectKind: 'sheet',
        beforeDigest: digest('c'),
        afterDigest: digest('d'),
      },
    ],
  };

  return {
    readCurrentSemanticState: jest
      .fn<VersionSemanticStateReaderPort['readCurrentSemanticState']>()
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(after),
    diffSemanticStates: jest
      .fn<VersionSemanticStateReaderPort['diffSemanticStates']>()
      .mockResolvedValue(semanticDiff),
  };
}

function semanticStateEnvelope(sheetName: string, seed: string): SemanticWorkbookStateEnvelope {
  return {
    state: semanticWorkbookState(sheetName),
    stateDigest: digest(seed),
  };
}

function semanticWorkbookState(sheetName: string): SemanticWorkbookState {
  return {
    schemaVersion: 'semantic-workbook-state.v1',
    workbookId: 'workbook-pending-remote-sync-capture',
    domains: {
      sheets: {
        domainId: 'sheets',
        domainClass: 'authored',
        capabilityState: 'supported',
      },
    },
    sheets: {
      'sheet-local': {
        sheetId: 'sheet-local',
        name: sheetName,
        rowCount: 1,
        columnCount: 1,
        rows: {},
        columns: {},
        cells: {},
      },
    },
  };
}

function digest(seed: string): ObjectDigest {
  return {
    algorithm: 'sha256',
    value: seed.repeat(64).slice(0, 64),
    byteLength: 32,
  };
}

async function initializeVersionGraph(
  provider: ReturnType<typeof createInMemoryVersionStoreProvider>,
  graphId: string,
): Promise<VersionGraphNamespace> {
  const namespace = namespaceForDocumentScope(VERSION_DOCUMENT_SCOPE, graphId);
  const initialized = await provider.initializeGraph({
    expectedRegistryRevision: null,
    graphId,
    rootWrite: {
      snapshotRootRecord: await versionObjectRecord(namespace, 'workbook.snapshotRoot.v1', {
        sheets: [],
      }),
      semanticChangeSetRecord: await versionObjectRecord(
        namespace,
        'workbook.semanticChangeSet.v1',
        { changes: [] },
      ),
      author: VERSION_AUTHOR,
      createdAt: '2026-06-21T00:00:00.000Z',
      completenessDiagnostics: [],
    },
  });
  expect(initialized.status).toBe('success');
  return namespace;
}

async function openPendingRemoteCaptureDependencies(
  provider: ReturnType<typeof createInMemoryVersionStoreProvider>,
  namespace: VersionGraphNamespace,
) {
  const registryRead = await provider.readGraphRegistry();
  expect(registryRead.status).toBe('ok');
  if (registryRead.status !== 'ok') {
    throw new Error('expected initialized graph registry');
  }
  return {
    registry: registryRead.registry,
    graph: await provider.openGraph(namespace),
    pendingRemoteSegmentStore: await provider.openPendingRemoteSegmentStore(namespace),
  };
}

function versionObjectRecord(
  namespace: VersionGraphNamespace,
  objectType: VersionObjectType,
  payload: unknown,
) {
  return createVersionObjectRecord(namespace, {
    objectType,
    schemaVersion: VERSION_OBJECT_SCHEMA_VERSION,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [],
    payload,
  });
}

function pendingRemoteOperationContext(options: {
  readonly operationId: string;
  readonly updateId: string;
  readonly payloadHash: string;
  readonly commitGrouping?: NonNullable<VersionOperationContext['collaboration']>['commitGrouping'];
}): VersionOperationContext {
  return {
    operationId: options.operationId,
    kind: 'sync-import',
    author: VERSION_AUTHOR,
    createdAt: '2026-06-21T00:00:00.000Z',
    domainIds: ['sync'],
    capturePolicy: 'commitEligible',
    writeAdmissionMode: 'capture',
    collaboration: {
      sourceKind: 'providerLiveInbound',
      originKind: 'provider',
      stableOriginId: 'provider-stable-1',
      providerId: 'provider-stable-1',
      roomId: 'room-1',
      epoch: 'epoch-1',
      updateId: options.updateId,
      sequence: '1',
      payloadHash: options.payloadHash,
      trustStatus: 'verified',
      authorState: 'singleRemote',
      remoteSessionId: 'remote-session-1',
      replay: false,
      system: false,
      commitGrouping: options.commitGrouping ?? 'pendingRemote',
      validationDiagnosticCount: 0,
    },
  };
}

type PendingRemoteSnapshot = {
  readonly sequence: number;
  readonly operationContext?: VersionOperationContext;
};

function pendingRemoteSnapshots(
  capture: ReturnType<typeof createSemanticMutationCapture>,
): readonly PendingRemoteSnapshot[] {
  const mutationCapture = capture.mutationCapture as unknown as {
    snapshotPendingRemoteMutations(): readonly PendingRemoteSnapshot[];
  };
  return mutationCapture.snapshotPendingRemoteMutations();
}

function expectPendingCaptureSuccess(
  result: VersionPendingRemoteCaptureResult,
): Extract<VersionPendingRemoteCaptureResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error('expected pending remote capture success');
  }
  return result;
}

async function expectPersistedPendingObjects(
  graph: VersionGraphStore,
  result: Extract<VersionPendingRemoteCaptureResult, { status: 'success' }>,
): Promise<void> {
  await expect(
    graph.getObjectRecord({
      kind: 'object',
      objectType: 'workbook.mutationSegment.v1',
      digest: result.record.mutationSegmentDigest,
    }),
  ).resolves.toMatchObject({
    digest: result.record.mutationSegmentDigest,
    preimage: { objectType: 'workbook.mutationSegment.v1' },
  });
  if (result.record.semanticChangeSetDigest !== undefined) {
    await expect(
      graph.getObjectRecord({
        kind: 'object',
        objectType: 'workbook.semanticChangeSet.v1',
        digest: result.record.semanticChangeSetDigest,
      }),
    ).resolves.toMatchObject({
      digest: result.record.semanticChangeSetDigest,
      preimage: { objectType: 'workbook.semanticChangeSet.v1' },
    });
  }
  if (result.record.snapshotRootDigest !== undefined) {
    await expect(
      graph.getObjectRecord({
        kind: 'object',
        objectType: 'workbook.snapshotRoot.v1',
        digest: result.record.snapshotRootDigest,
      }),
    ).resolves.toMatchObject({
      digest: result.record.snapshotRootDigest,
      preimage: { objectType: 'workbook.snapshotRoot.v1' },
    });
  }
}

function trackPutObjects(graph: VersionGraphStore): {
  readonly graph: VersionGraphStore;
  readonly putObjects: jest.MockedFunction<VersionGraphStore['putObjects']>;
} {
  const putObjects = jest.fn((batch: Parameters<VersionGraphStore['putObjects']>[0]) =>
    graph.putObjects(batch),
  ) as jest.MockedFunction<VersionGraphStore['putObjects']>;
  return {
    graph: new Proxy(graph, {
      get(target, property) {
        if (property === 'putObjects') return putObjects;
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as VersionGraphStore,
    putObjects,
  };
}

async function appliedIdentityKeyForAdmission(
  metadata: ProviderDocApplyUpdateMetadata,
): Promise<string> {
  const { identityKey } = await appliedSyncUpdateIdentityKeyMaterialForOperationContext(
    createAdmittedSyncApplyContext(metadata).operationContext,
  );
  return identityKey;
}
