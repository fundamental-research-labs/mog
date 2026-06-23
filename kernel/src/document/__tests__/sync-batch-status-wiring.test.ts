import { jest } from '@jest/globals';
import { createHash } from 'node:crypto';
import {
  DEFAULT_PROVENANCE_REDACTION_POLICY,
  PROVIDER_INBOUND_V2_BASE_PROOF_FIELDS,
  PROVIDER_INBOUND_V2_SINGLE_AUTHOR_PROOF_FIELDS,
  type ProviderAuthorityProof,
  type ProviderInboundProofField,
  type ProviderInboundUpdateEnvelope,
  type ProviderInboundUpdateEnvelopeV2,
  type SyncUpdateProvenance,
} from '@mog-sdk/types-document/storage';

import { createAdmittedSyncApplyContext } from '../../bridges/compute/sync-apply-admission';
import { RustDocument } from '../rust-document';
import type { Provider, ProviderDocApplyUpdateMetadata } from '../providers/provider';
import {
  InMemoryVersionDocumentProviderBackend,
  createInMemoryVersionStoreProvider,
  type VersionDocumentScope,
} from '../version-store/provider';
import type { AppliedSyncUpdateIdentityStore } from '../version-store/applied-sync-update-identity-store';
import {
  syncBatchStatusKeyMaterialForOperationContext,
  type SyncBatchStatusId,
  type SyncBatchStatusOperationContext,
  type SyncBatchStatusStore,
} from '../version-store/sync-batch-status-store';

interface StubBridge {
  subscribeUpdateV1(cb: (u: Uint8Array) => void): { unsubscribe: () => void };
  createEngine(snapshot?: Record<string, unknown>): Promise<unknown>;
  createEngineFromYrsState(state: Uint8Array): Promise<unknown>;
  flushUndoCapture(): Promise<unknown>;
  syncApply(u: Uint8Array): Promise<unknown>;
  recordProviderDocApplyUpdateAdmission(metadata: ProviderDocApplyUpdateMetadata): void;
  encodeDiff(sv: Uint8Array): Promise<Uint8Array>;
  currentStateVector(): Promise<Uint8Array>;
  flushPendingUpdateV1(): Promise<void>;
  emit(update: Uint8Array): void;
  admissions: ProviderDocApplyUpdateMetadata[];
}

const VERSION_DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'sync-batch-status-wiring-doc',
  principalScope: 'principal-1',
};

const STORAGE_SCOPE = {
  kind: 'scoped',
  scope: {
    tenantId: { kind: 'single-tenant' },
    workspaceId: { kind: 'no-workspace' },
    documentId: VERSION_DOCUMENT_SCOPE.documentId,
  },
} as const;

function makeStubBridge(): StubBridge {
  const subscribers = new Set<(u: Uint8Array) => void>();
  const admissions: ProviderDocApplyUpdateMetadata[] = [];
  const emit = (update: Uint8Array) => {
    for (const cb of subscribers) cb(update);
  };
  return {
    subscribeUpdateV1(cb) {
      subscribers.add(cb);
      return {
        unsubscribe: () => {
          subscribers.delete(cb);
        },
      };
    },
    createEngine: async () => ({ recalc: { changedCells: [] } }),
    createEngineFromYrsState: async () => ({ recalc: { changedCells: [] } }),
    flushUndoCapture: async () => ({ recalc: { changedCells: [] } }),
    syncApply: jest.fn(async (u: Uint8Array) => {
      emit(u);
      return { recalc: { changedCells: [] } };
    }),
    recordProviderDocApplyUpdateAdmission(metadata) {
      admissions.push(metadata);
    },
    encodeDiff: async () => new Uint8Array(),
    currentStateVector: async () => new Uint8Array(),
    flushPendingUpdateV1: async () => {},
    emit,
    admissions,
  };
}

async function makeDocument(): Promise<{ doc: RustDocument; bridge: StubBridge }> {
  const bridge = makeStubBridge();
  const doc = new RustDocument({
    docId: VERSION_DOCUMENT_SCOPE.documentId,
    computeBridge: bridge as never,
    internal: true,
    skipPersistenceLoad: true,
  });
  await doc.ready;
  return { doc, bridge };
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

async function createSyncBatchStatusStore(): Promise<SyncBatchStatusStore> {
  const provider = createInMemoryVersionStoreProvider({
    documentScope: VERSION_DOCUMENT_SCOPE,
    backend: new InMemoryVersionDocumentProviderBackend(),
    durability: 'snapshot-test-double',
  });
  return provider.openSyncBatchStatusStore();
}

async function installSyncBatchStatusStore(
  doc: RustDocument,
  store: SyncBatchStatusStore,
): Promise<void> {
  await doc.installVersionSyncServicesFromProvider({
    openSyncBatchStatusStore: async () => store,
  });
}

type VersionMarkerStores = {
  readonly syncBatchStatusStore: SyncBatchStatusStore;
  readonly appliedSyncUpdateIdentityStore: AppliedSyncUpdateIdentityStore;
};

async function createTracedVersionMarkerStores(events: string[]): Promise<VersionMarkerStores> {
  const provider = createInMemoryVersionStoreProvider({
    documentScope: VERSION_DOCUMENT_SCOPE,
    backend: new InMemoryVersionDocumentProviderBackend(),
    durability: 'snapshot-test-double',
  });
  return {
    syncBatchStatusStore: traceSyncBatchStatusStore(
      await provider.openSyncBatchStatusStore(),
      events,
    ),
    appliedSyncUpdateIdentityStore: traceAppliedSyncUpdateIdentityStore(
      await provider.openAppliedSyncUpdateIdentityStore(),
      events,
    ),
  };
}

function traceSyncBatchStatusStore(
  store: SyncBatchStatusStore,
  events: string[],
): SyncBatchStatusStore {
  return {
    documentScope: store.documentScope,
    reserveBatchStatus: jest.fn(async (input) => {
      events.push('syncBatchStatus:reserve');
      return store.reserveBatchStatus(input);
    }),
    readByBatchStatusId: (batchStatusId) => store.readByBatchStatusId(batchStatusId),
    completeBatchStatus: jest.fn(async (input) => {
      events.push(`syncBatchStatus:complete:${input.terminal.status}`);
      return store.completeBatchStatus(input);
    }),
  };
}

function traceAppliedSyncUpdateIdentityStore(
  store: AppliedSyncUpdateIdentityStore,
  events: string[],
): AppliedSyncUpdateIdentityStore {
  return {
    documentScope: store.documentScope,
    reserveIdentity: jest.fn(async (input) => {
      events.push('appliedSyncIdentity:reserve');
      return store.reserveIdentity(input);
    }),
    readByIdentityKey: (identityKey) => store.readByIdentityKey(identityKey),
    completeIdentity: jest.fn(async (input) => {
      events.push(`appliedSyncIdentity:complete:${input.terminal.status}`);
      return store.completeIdentity(input);
    }),
  };
}

async function installVersionMarkerStores(
  doc: RustDocument,
  stores: VersionMarkerStores,
): Promise<void> {
  await doc.installVersionSyncServicesFromProvider({
    openSyncBatchStatusStore: async () => stores.syncBatchStatusStore,
    openAppliedSyncUpdateIdentityStore: async () => stores.appliedSyncUpdateIdentityStore,
  });
}

function installBridgeOrderingTrace(
  bridge: StubBridge,
  events: string[],
): jest.SpiedFunction<StubBridge['syncApply']> {
  const originalAdmission = bridge.recordProviderDocApplyUpdateAdmission.bind(bridge);
  bridge.recordProviderDocApplyUpdateAdmission = (metadata) => {
    events.push(`admission:${metadata.provenance.sourceKind}`);
    originalAdmission(metadata);
  };

  return jest.spyOn(bridge, 'syncApply').mockImplementation(async (update: Uint8Array) => {
    events.push('syncApply');
    bridge.emit(update);
    return { recalc: { changedCells: [] } };
  });
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function proof(
  coveredFields: readonly ProviderInboundProofField[],
  canonicalPayloadHash = 'c'.repeat(64),
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

function makeEnvelope(
  overrides: Partial<ProviderInboundUpdateEnvelope> = {},
): ProviderInboundUpdateEnvelope {
  const payload = overrides.payload ?? new Uint8Array([0x01, 0x02, 0x03]);
  return {
    providerRefId: 'ProviderA',
    authorityRef: 'authority-1',
    storageScope: STORAGE_SCOPE,
    decisionId: 'decision-1',
    sessionId: 'local-session-1',
    payloadKind: 'yrs-update-v1',
    payload,
    payloadHash: sha256Hex(payload),
    updateId: 'sync-batch-update-1',
    providerEpoch: '1',
    authorityProof: proof(['payloadHash', 'updateId']),
    ...overrides,
  };
}

function makeLiveProvenance(
  envelope: ProviderInboundUpdateEnvelope,
  overrides: Partial<SyncUpdateProvenance> = {},
): SyncUpdateProvenance {
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
      remoteAuthorRef: {
        kind: 'opaque-subject-ref',
        value: 'subject-ref-1',
      },
    },
    remoteSessionId: 'remote-session-1',
    correlationId: 'correlation-1',
    causationIds: ['cause-1'],
    replay: false,
    system: false,
    capturePolicy: 'commitEligible',
    redaction: {
      ...DEFAULT_PROVENANCE_REDACTION_POLICY,
      mode: 'opaque-digest-only',
      durableAuthorIdentity: 'opaque-subject-ref',
      durableProviderIdentity: 'opaque-provider-ref',
    },
    ...overrides,
  };
}

function makeV2EnvelopeWithProvenance(
  envelopeOverrides: Partial<ProviderInboundUpdateEnvelope> = {},
  provenanceOverrides: Partial<SyncUpdateProvenance> = {},
): ProviderInboundUpdateEnvelopeV2 {
  const envelope = makeEnvelope(envelopeOverrides);
  return makeV2Envelope({
    providerRefId: envelope.providerRefId,
    authorityRef: envelope.authorityRef,
    storageScope: envelope.storageScope,
    decisionId: envelope.decisionId,
    sessionId: envelope.sessionId,
    providerEpoch: envelope.providerEpoch,
    updateId: envelope.updateId,
    sequence: envelope.sequence,
    payloadKind: envelope.payloadKind,
    payloadHash: envelope.payloadHash,
    payload: envelope.payload,
    assetDependencies: envelope.assetDependencies,
    provenance: makeLiveProvenance(envelope, provenanceOverrides),
  });
}

function makeV2Envelope(
  overrides: Partial<ProviderInboundUpdateEnvelopeV2> = {},
): ProviderInboundUpdateEnvelopeV2 {
  const v1 = makeEnvelope(overrides);
  const provenance = overrides.provenance ?? makeLiveProvenance(v1);
  const provenancePayloadHash = provenance.updateIdentity.provenancePayloadHash ?? 'c'.repeat(64);
  return {
    ...v1,
    schemaVersion: 'provider-inbound-update-v2',
    provenance,
    authorityProof:
      overrides.authorityProof ??
      proof(
        [
          ...PROVIDER_INBOUND_V2_BASE_PROOF_FIELDS,
          ...PROVIDER_INBOUND_V2_SINGLE_AUTHOR_PROOF_FIELDS,
          'providerId',
          'providerKind',
        ],
        provenancePayloadHash,
      ),
  };
}

function providerInboundMetadataForEnvelope(
  envelope: ProviderInboundUpdateEnvelopeV2,
): ProviderDocApplyUpdateMetadata {
  return {
    source: 'provider-inbound',
    docId: VERSION_DOCUMENT_SCOPE.documentId,
    envelopeVersion: envelope.schemaVersion,
    providerRefId: envelope.providerRefId,
    providerEpoch: envelope.providerEpoch,
    updateId: envelope.updateId,
    payloadHash: envelope.payloadHash,
    provenance: envelope.provenance,
    validationDiagnostics: [],
  };
}

async function syncBatchStatusIdForAdmission(
  metadata: ProviderDocApplyUpdateMetadata,
): Promise<SyncBatchStatusId> {
  if (!metadata.updateId) throw new Error('Expected provider update id.');
  const admittedContext = createAdmittedSyncApplyContext(metadata);
  const { batchStatusId } = await syncBatchStatusKeyMaterialForOperationContext(
    admittedContext.operationContext,
    {
      batchId: metadata.updateId,
      orderedSubUpdatePayloadHashes: [metadata.payloadHash],
      subUpdateCount: 1,
    },
  );
  return batchStatusId;
}

describe('RustDocument sync batch status wiring', () => {
  async function expectModernMarkersBeforeUpdate(options: {
    readonly envelope: ProviderInboundUpdateEnvelopeV2;
    readonly prime?: (fixture: {
      readonly doc: RustDocument;
      readonly bridge: StubBridge;
      readonly events: string[];
      readonly syncApply: jest.SpiedFunction<StubBridge['syncApply']>;
    }) => Promise<void>;
  }): Promise<void> {
    const events: string[] = [];
    const stores = await createTracedVersionMarkerStores(events);
    const { doc, bridge } = await makeDocument();
    await installVersionMarkerStores(doc, stores);
    await doc.attachProvider(makeProvider('ProviderA'));
    const syncApply = installBridgeOrderingTrace(bridge, events);

    try {
      await options.prime?.({ doc, bridge, events, syncApply });
      events.length = 0;
      bridge.admissions.length = 0;
      syncApply.mockClear();

      const result = await doc.applyProviderUpdate(options.envelope);

      expect(result.status).toBe('applied');
      expect(syncApply).toHaveBeenCalledTimes(1);
      expect(bridge.admissions).toHaveLength(1);
      expect(bridge.admissions[0]).toMatchObject({
        envelopeVersion: 'provider-inbound-update-v2',
        providerRefId: options.envelope.providerRefId,
        providerEpoch: options.envelope.providerEpoch,
        updateId: options.envelope.updateId,
        payloadHash: options.envelope.payloadHash,
      });
      expect(events).toEqual([
        'syncBatchStatus:reserve',
        'appliedSyncIdentity:reserve',
        'admission:providerLiveInbound',
        'syncApply',
        'syncBatchStatus:complete:complete',
        'appliedSyncIdentity:complete:applied',
      ]);
    } finally {
      await doc.destroy();
    }
  }

  it('writes connected collaboration markers before applying the provider update', async () => {
    await expectModernMarkersBeforeUpdate({
      envelope: makeV2EnvelopeWithProvenance({
        payload: new Uint8Array([0x11, 0x12]),
        updateId: 'sync-batch-connected-1',
        providerEpoch: '1',
      }),
    });
  });

  it('writes offline-queued collaboration markers before applying the provider update', async () => {
    await expectModernMarkersBeforeUpdate({
      envelope: makeV2EnvelopeWithProvenance(
        {
          payload: new Uint8Array([0x21, 0x22]),
          updateId: 'sync-batch-offline-queued-1',
          providerEpoch: 'offline-epoch-1',
        },
        {
          replay: true,
          system: false,
          remoteSessionId: 'remote-session-offline-1',
          correlationId: 'correlation-offline-1',
        },
      ),
    });
  });

  it('writes reconnecting collaboration markers before applying the newer provider epoch update', async () => {
    const firstEpochEnvelope = makeV2EnvelopeWithProvenance({
      payload: new Uint8Array([0x31, 0x32]),
      updateId: 'sync-batch-reconnecting-prime-1',
      providerEpoch: '1',
    });

    await expectModernMarkersBeforeUpdate({
      envelope: makeV2EnvelopeWithProvenance(
        {
          payload: new Uint8Array([0x33, 0x34]),
          updateId: 'sync-batch-reconnecting-2',
          providerEpoch: '2',
        },
        {
          remoteSessionId: 'remote-session-reconnected-1',
          correlationId: 'correlation-reconnected-1',
          causationIds: ['sync-batch-reconnecting-prime-1'],
        },
      ),
      prime: async ({ doc }) => {
        await expect(doc.applyProviderUpdate(firstEpochEnvelope)).resolves.toMatchObject({
          status: 'applied',
        });
      },
    });
  });

  it('keeps old-client provider envelopes excluded without writing version sync markers', async () => {
    const events: string[] = [];
    const stores = await createTracedVersionMarkerStores(events);
    const { doc, bridge } = await makeDocument();
    await installVersionMarkerStores(doc, stores);
    await doc.attachProvider(makeProvider('ProviderA'));
    const syncApply = installBridgeOrderingTrace(bridge, events);

    try {
      const envelope = makeEnvelope({
        payload: new Uint8Array([0x41, 0x42]),
        updateId: 'sync-batch-old-client-v1-1',
        providerEpoch: '1',
      });

      const result = await doc.applyProviderUpdate(envelope);

      expect(result).toMatchObject({
        status: 'applied',
        provenance: {
          sourceKind: 'providerReplay',
          capturePolicy: 'excluded',
          replay: true,
          system: true,
        },
      });
      expect(syncApply).toHaveBeenCalledTimes(1);
      expect(bridge.admissions).toHaveLength(1);
      expect(bridge.admissions[0]).toMatchObject({
        envelopeVersion: 'provider-inbound-update-v1',
        updateId: envelope.updateId,
        payloadHash: envelope.payloadHash,
        provenance: {
          sourceKind: 'providerReplay',
          capturePolicy: 'excluded',
        },
      });
      expect(events).toEqual(['admission:providerReplay', 'syncApply']);
    } finally {
      await doc.destroy();
    }
  });

  it('reserves, completes, and duplicates verified live provider batches', async () => {
    const store = await createSyncBatchStatusStore();
    const { doc, bridge } = await makeDocument();
    await installSyncBatchStatusStore(doc, store);
    await doc.attachProvider(makeProvider('ProviderA'));
    const syncApply = jest.spyOn(bridge, 'syncApply');

    const envelope = makeV2Envelope({
      payload: new Uint8Array([0x51, 0x52]),
      updateId: 'sync-batch-live-1',
    });

    const applied = await doc.applyProviderUpdate(envelope);

    expect(applied.status).toBe('applied');
    expect(syncApply).toHaveBeenCalledTimes(1);
    expect(bridge.admissions).toHaveLength(1);
    const batchStatusId = await syncBatchStatusIdForAdmission(bridge.admissions[0]!);
    await expect(store.readByBatchStatusId(batchStatusId)).resolves.toMatchObject({
      status: 'found',
      record: {
        batchStatusId,
        state: 'complete',
        terminal: { status: 'complete' },
        identity: {
          batchId: envelope.updateId,
          orderedSubUpdatePayloadHashes: [envelope.payloadHash],
          subUpdateCount: 1,
        },
      },
    });

    const duplicate = await doc.applyProviderUpdate(envelope);

    expect(duplicate).toMatchObject({ status: 'duplicate', updateId: envelope.updateId });
    expect(syncApply).toHaveBeenCalledTimes(1);
    expect(bridge.admissions).toHaveLength(1);

    await doc.destroy();
  });

  it('rejects sync batch status conflicts before syncApply', async () => {
    const store = await createSyncBatchStatusStore();
    const { doc, bridge } = await makeDocument();
    await installSyncBatchStatusStore(doc, store);
    await doc.attachProvider(makeProvider('ProviderA'));
    const syncApply = jest.spyOn(bridge, 'syncApply');

    const envelope = makeV2Envelope({
      payload: new Uint8Array([0x61, 0x62]),
      updateId: 'sync-batch-conflict-1',
    });
    const metadata = providerInboundMetadataForEnvelope(envelope);
    const admittedContext = createAdmittedSyncApplyContext(metadata);
    const batchStatusId = await syncBatchStatusIdForAdmission(metadata);
    await expect(
      store.reserveBatchStatus({
        batchStatusId,
        operationContext: {
          ...admittedContext.operationContext,
          collaboration: {
            ...admittedContext.operationContext.collaboration!,
            payloadHash: '4'.repeat(64),
          },
        } as SyncBatchStatusOperationContext,
        batchId: envelope.updateId,
        orderedSubUpdatePayloadHashes: [envelope.payloadHash],
        subUpdateCount: 1,
        createdAt: '2026-06-22T00:00:01.000Z',
      }),
    ).resolves.toMatchObject({ status: 'reserved' });

    const result = await doc.applyProviderUpdate(envelope);

    expect(result).toMatchObject({
      status: 'rejected',
      reason: 'sync-batch-status-conflict',
    });
    expect(syncApply).not.toHaveBeenCalled();
    expect(bridge.admissions).toHaveLength(0);

    await doc.destroy();
  });

  it('marks sync apply failures as failedAfterMutation without masking the apply error', async () => {
    const store = await createSyncBatchStatusStore();
    const { doc, bridge } = await makeDocument();
    await installSyncBatchStatusStore(doc, store);
    await doc.attachProvider(makeProvider('ProviderA'));
    const syncApply = jest.spyOn(bridge, 'syncApply').mockImplementation(async () => {
      throw new Error('sync batch apply failed after reservation');
    });

    const envelope = makeV2Envelope({
      payload: new Uint8Array([0x71, 0x72]),
      updateId: 'sync-batch-failed-after-mutation-1',
    });

    await expect(doc.applyProviderUpdate(envelope)).rejects.toThrow(
      'sync batch apply failed after reservation',
    );

    expect(syncApply).toHaveBeenCalledTimes(1);
    expect(bridge.admissions).toHaveLength(1);
    const batchStatusId = await syncBatchStatusIdForAdmission(bridge.admissions[0]!);
    await expect(store.readByBatchStatusId(batchStatusId)).resolves.toMatchObject({
      status: 'found',
      record: {
        state: 'failedAfterMutation',
        terminal: {
          status: 'failedAfterMutation',
          reason: 'sync-apply-failed',
        },
      },
    });

    const retry = await doc.applyProviderUpdate(envelope);

    expect(retry).toMatchObject({
      status: 'rejected',
      reason: 'sync-batch-status-failed-after-mutation',
    });
    expect(syncApply).toHaveBeenCalledTimes(1);

    await doc.destroy();
  });
});
