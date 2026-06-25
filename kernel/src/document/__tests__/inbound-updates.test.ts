/**
 * Inbound Provider Update — inbound provider update tests.
 *
 * Tests for `RustDocument.applyProviderUpdate`, the kernel-owned entry point
 * for remote/replica Providers to deliver inbound updates without echo loops.
 *
 * Uses the same stub-bridge pattern as `rust-document-orchestrator.test.ts`.
 */

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
import { RustDocument } from '../rust-document';
import type { Provider, ProviderDocApplyUpdateMetadata } from '../providers/provider';
import type {
  MutationResult,
  SyncApplyMutationMetadataWire,
} from '../../bridges/compute/compute-types.gen';
import { createAdmittedSyncApplyContext } from '../../bridges/compute/sync-apply-admission';
import {
  appliedSyncUpdateIdentityKeyMaterialForOperationContext,
  type AppliedSyncUpdateIdentityStore,
} from '../version-store/applied-sync-update-identity-store';
import {
  InMemoryVersionDocumentProviderBackend,
  createInMemoryVersionStoreProvider,
  type VersionDocumentScope,
} from '../version-store/provider';
import {
  createVersionProviderWriteActivityTracker,
  type VersionProviderWriteActivityTracker,
} from '../version-store/provider-write-activity';

// ---------------------------------------------------------------------------
// Stub bridge (same pattern as orchestrator tests)
// ---------------------------------------------------------------------------

interface StubBridge {
  subscribeUpdateV1(cb: (u: Uint8Array) => void): { unsubscribe: () => void };
  createEngine(snapshot?: Record<string, unknown>): Promise<unknown>;
  createEngineFromYrsState(state: Uint8Array): Promise<unknown>;
  flushUndoCapture(): Promise<unknown>;
  syncApply(u: Uint8Array): Promise<unknown>;
  syncApplyWithMetadata?(
    u: Uint8Array,
    syncApplyContext: unknown,
  ): Promise<{ mutationResult: MutationResult; metadata: SyncApplyMutationMetadataWire }>;
  recordProviderDocApplyUpdateAdmission(metadata: ProviderDocApplyUpdateMetadata): void;
  encodeDiff(sv: Uint8Array): Promise<Uint8Array>;
  currentStateVector(): Promise<Uint8Array>;
  flushPendingUpdateV1(): Promise<void>;
  emit(update: Uint8Array): void;
  admissions: ProviderDocApplyUpdateMetadata[];
  subscriberCount(): number;
}

function makeStubBridge(): StubBridge {
  const subscribers = new Set<(u: Uint8Array) => void>();
  const admissions: ProviderDocApplyUpdateMetadata[] = [];
  const emit = (update: Uint8Array) => {
    for (const cb of subscribers) cb(update);
  };
  return {
    subscribeUpdateV1(cb) {
      subscribers.add(cb);
      let unsubbed = false;
      return {
        unsubscribe: () => {
          if (unsubbed) return;
          unsubbed = true;
          subscribers.delete(cb);
        },
      };
    },
    createEngine: async () => ({ recalc: { changedCells: [] } }),
    createEngineFromYrsState: async () => ({ recalc: { changedCells: [] } }),
    flushUndoCapture: async () => ({ recalc: { changedCells: [] } }),
    // syncApply emits through the subscriber to simulate the real bridge
    syncApply: async (u: Uint8Array) => {
      emit(u);
      return { recalc: { changedCells: [] } };
    },
    recordProviderDocApplyUpdateAdmission(metadata) {
      admissions.push(metadata);
    },
    encodeDiff: async () => new Uint8Array(),
    currentStateVector: async () => new Uint8Array(),
    flushPendingUpdateV1: async () => {},
    emit,
    admissions,
    subscriberCount() {
      return subscribers.size;
    },
  };
}

async function makeOrchestrator(
  options: {
    readonly appliedSyncUpdateIdentityStore?: AppliedSyncUpdateIdentityStore;
    readonly providerWriteActivityTracker?: VersionProviderWriteActivityTracker;
  } = {},
): Promise<{ doc: RustDocument; bridge: StubBridge }> {
  const bridge = makeStubBridge();
  const doc = new RustDocument({
    docId: 'inbound-test-doc',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    computeBridge: bridge as unknown as any,
    internal: true,
    skipPersistenceLoad: true,
    appliedSyncUpdateIdentityStore: options.appliedSyncUpdateIdentityStore,
    providerWriteActivityTracker: options.providerWriteActivityTracker,
  });
  await doc.ready;
  return { doc, bridge };
}

const storageScope = {
  kind: 'scoped',
  scope: {
    tenantId: { kind: 'single-tenant' },
    workspaceId: { kind: 'no-workspace' },
    documentId: 'inbound-test-doc',
  },
} as const;

const versionDocumentScope: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'inbound-test-doc',
  principalScope: 'principal-1',
};

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

/**
 * Build a simple recording Provider stub.
 */
function makeRecordingProvider(name: string): Provider & { observed: Uint8Array[] } {
  const observed: Uint8Array[] = [];
  return {
    name,
    observed,
    appendUpdate: (u: Uint8Array) => {
      observed.push(new Uint8Array(u));
    },
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
  overrides: Partial<ProviderInboundUpdateEnvelope> = {},
): ProviderInboundUpdateEnvelope {
  const payload = overrides.payload ?? new Uint8Array([0x01, 0x02, 0x03]);
  return {
    providerRefId: 'ProviderA',
    authorityRef: 'authority-1',
    storageScope,
    decisionId: 'decision-1',
    sessionId: 'local-session-1',
    payloadKind: 'yrs-update-v1',
    payload,
    payloadHash: sha256Hex(payload),
    updateId: `update-${Math.random().toString(36).slice(2)}`,
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RustDocument.applyProviderUpdate — inbound update orchestration', () => {
  describe('apply + fan-out', () => {
    it('applies the payload to the engine via ProviderDoc', async () => {
      const { doc, bridge } = await makeOrchestrator();
      const providerA = makeRecordingProvider('ProviderA');
      const providerB = makeRecordingProvider('ProviderB');
      await doc.attachProvider(providerA);
      await doc.attachProvider(providerB);

      // Track what syncApply receives
      const applied: Uint8Array[] = [];
      const originalSyncApply = bridge.syncApply;
      bridge.syncApply = async (u: Uint8Array) => {
        applied.push(new Uint8Array(u));
        return originalSyncApply(u);
      };

      const envelope = makeEnvelope({ payload: new Uint8Array([0xaa, 0xbb]) });
      const result = await doc.applyProviderUpdate(envelope);

      expect(result.status).toBe('applied');
      expect(result.updateId).toBe(envelope.updateId);
      expect(result.provenance?.sourceKind).toBe('providerReplay');
      expect(result.provenance?.capturePolicy).toBe('excluded');
      expect(result.provenance?.author.kind).toBe('unknown');

      // The payload was applied to the engine
      expect(applied).toHaveLength(1);
      expect(Array.from(applied[0]!)).toEqual([0xaa, 0xbb]);
      expect(bridge.admissions).toHaveLength(1);
      expect(bridge.admissions[0]?.provenance.sourceKind).toBe('providerReplay');
      expect(bridge.admissions[0]?.provenance.capturePolicy).toBe('excluded');

      await doc.destroy();
    });

    it('applies valid V2 live single-author provenance and passes admission metadata', async () => {
      const { doc, bridge } = await makeOrchestrator();
      const providerA = makeRecordingProvider('ProviderA');
      const providerB = makeRecordingProvider('ProviderB');
      await doc.attachProvider(providerA);
      await doc.attachProvider(providerB);

      const envelope = makeV2Envelope({
        payload: new Uint8Array([0x10, 0x20]),
        updateId: 'v2-live-1',
      });
      const result = await doc.applyProviderUpdate(envelope);

      expect(result.status).toBe('applied');
      expect(result.provenance).toBe(envelope.provenance);
      expect(bridge.admissions).toHaveLength(1);
      expect(bridge.admissions[0]).toMatchObject({
        source: 'provider-inbound',
        docId: 'inbound-test-doc',
        envelopeVersion: 'provider-inbound-update-v2',
        providerRefId: 'ProviderA',
        providerEpoch: '1',
        updateId: 'v2-live-1',
        payloadHash: envelope.payloadHash,
        validationDiagnostics: [],
      });
      expect(bridge.admissions[0]?.provenance).toBe(envelope.provenance);

      await doc.destroy();
    });

    it('returns sync apply metadata when the bridge-backed ProviderDoc supplies it', async () => {
      const { doc, bridge } = await makeOrchestrator();
      const providerA = makeRecordingProvider('ProviderA');
      await doc.attachProvider(providerA);
      const mutationResult = { recalc: { changedCells: [] } } as unknown as MutationResult;
      const metadata = {
        mutationResult,
        provenanceReport: {
          pendingSegmentIds: ['pending-segment-1'],
        },
      } as SyncApplyMutationMetadataWire;
      bridge.syncApplyWithMetadata = jest.fn(async (u: Uint8Array) => {
        bridge.emit(u);
        return { mutationResult, metadata };
      });

      const envelope = makeV2Envelope({
        payload: new Uint8Array([0x30, 0x31]),
        updateId: 'v2-live-metadata-1',
      });
      const result = await doc.applyProviderUpdate(envelope);

      expect(result.status).toBe('applied');
      expect(result.applyResult).toEqual({ mutationResult, metadata });
      expect(bridge.syncApplyWithMetadata).toHaveBeenCalledWith(
        envelope.payload,
        expect.objectContaining({ operationContext: expect.any(Object) }),
      );

      await doc.destroy();
    });

    it('reports provider write activity while an admitted live sync apply is in flight', async () => {
      const providerWriteActivityTracker = createVersionProviderWriteActivityTracker();
      const { doc, bridge } = await makeOrchestrator({ providerWriteActivityTracker });
      const providerA = makeRecordingProvider('ProviderA');
      await doc.attachProvider(providerA);
      const mutationResult = { recalc: { changedCells: [] } } as unknown as MutationResult;
      const metadata = {
        mutationResult,
        provenanceReport: {
          pendingSegmentIds: [],
        },
      } as SyncApplyMutationMetadataWire;
      let releaseApply!: () => void;
      const applyBlocked = new Promise<void>((resolve) => {
        releaseApply = resolve;
      });
      let observedApplyStart!: () => void;
      const applyStarted = new Promise<void>((resolve) => {
        observedApplyStart = resolve;
      });
      bridge.syncApplyWithMetadata = jest.fn(async (u: Uint8Array) => {
        observedApplyStart();
        await applyBlocked;
        bridge.emit(u);
        return { mutationResult, metadata };
      });

      const applying = doc.applyProviderUpdate(
        makeV2Envelope({
          payload: new Uint8Array([0x44, 0x45]),
          updateId: 'v2-live-activity-1',
        }),
      );
      await applyStarted;

      expect(providerWriteActivityTracker.readActivity()).toMatchObject({
        remoteSyncApplyActiveCount: 1,
        pendingRemotePromotionActiveCount: 0,
      });

      releaseApply();
      await expect(applying).resolves.toMatchObject({ status: 'applied' });
      expect(providerWriteActivityTracker.readActivity()).toMatchObject({
        remoteSyncApplyActiveCount: 0,
        pendingRemotePromotionActiveCount: 0,
      });

      await doc.destroy();
    });

    it('echo suppression: originating Provider does NOT receive its own update back', async () => {
      const { doc } = await makeOrchestrator();
      const providerA = makeRecordingProvider('ProviderA');
      const providerB = makeRecordingProvider('ProviderB');
      await doc.attachProvider(providerA);
      await doc.attachProvider(providerB);

      const envelope = makeEnvelope({
        providerRefId: 'ProviderA',
        payload: new Uint8Array([0x42]),
      });
      await doc.applyProviderUpdate(envelope);
      // Drain the microtask queue
      await Promise.resolve();

      // ProviderA (the originator) must NOT see this update
      expect(providerA.observed).toHaveLength(0);

      // ProviderB (a non-originating Provider) MUST see it
      expect(providerB.observed).toHaveLength(1);
      expect(Array.from(providerB.observed[0]!)).toEqual([0x42]);

      await doc.destroy();
    });

    it('other attached Providers DO receive the update', async () => {
      const { doc } = await makeOrchestrator();
      const providerA = makeRecordingProvider('ProviderA');
      const providerB = makeRecordingProvider('ProviderB');
      const providerC = makeRecordingProvider('ProviderC');
      await doc.attachProvider(providerA);
      await doc.attachProvider(providerB);
      await doc.attachProvider(providerC);

      const envelope = makeEnvelope({
        providerRefId: 'ProviderA',
        payload: new Uint8Array([0x99]),
      });
      await doc.applyProviderUpdate(envelope);
      await Promise.resolve();

      // Only ProviderA is skipped (echo suppression)
      expect(providerA.observed).toHaveLength(0);
      expect(providerB.observed).toHaveLength(1);
      expect(providerC.observed).toHaveLength(1);

      await doc.destroy();
    });

    it('local mutations still fan out to all Providers (no echo suppression)', async () => {
      const { doc, bridge } = await makeOrchestrator();
      const providerA = makeRecordingProvider('ProviderA');
      const providerB = makeRecordingProvider('ProviderB');
      await doc.attachProvider(providerA);
      await doc.attachProvider(providerB);

      // Emit a local update (not through applyProviderUpdate)
      bridge.emit(new Uint8Array([0x77]));
      await Promise.resolve();

      // Both providers receive local updates
      expect(providerA.observed).toHaveLength(1);
      expect(providerB.observed).toHaveLength(1);

      await doc.destroy();
    });
  });

  describe('idempotency — duplicate updateId', () => {
    it('rejects duplicate updateId', async () => {
      const { doc } = await makeOrchestrator();
      const providerA = makeRecordingProvider('ProviderA');
      await doc.attachProvider(providerA);

      const envelope = makeEnvelope({ updateId: 'dup-id-1' });

      const result1 = await doc.applyProviderUpdate(envelope);
      expect(result1.status).toBe('applied');

      const result2 = await doc.applyProviderUpdate(envelope);
      expect(result2.status).toBe('rejected');
      expect(result2).toHaveProperty('reason', 'duplicate-update-id');

      await doc.destroy();
    });
  });

  describe('applied sync update identity', () => {
    it('reserves and completes verified live identities through applyProviderUpdate', async () => {
      const versionProvider = createInMemoryVersionStoreProvider({
        documentScope: versionDocumentScope,
        backend: new InMemoryVersionDocumentProviderBackend(),
        durability: 'inbound-update-test-double',
      });
      const store = await versionProvider.openAppliedSyncUpdateIdentityStore();
      const { doc, bridge } = await makeOrchestrator();
      await doc.installAppliedSyncUpdateIdentityStoreFromProvider(versionProvider);
      const providerA = makeRecordingProvider('ProviderA');
      await doc.attachProvider(providerA);

      const envelope = makeV2Envelope({
        payload: new Uint8Array([0x10, 0x20]),
        updateId: 'applied-identity-live-1',
      });

      const result1 = await doc.applyProviderUpdate(envelope);

      expect(result1.status).toBe('applied');
      expect(bridge.admissions).toHaveLength(1);
      const identityKey = await appliedIdentityKeyForAdmission(bridge.admissions[0]!);
      await expect(store.readByIdentityKey(identityKey)).resolves.toMatchObject({
        status: 'found',
        record: {
          identityKey,
          payloadHash: envelope.payloadHash,
          state: 'applied',
          terminal: { status: 'applied' },
          operationContext: {
            collaboration: {
              sourceKind: 'providerLiveInbound',
              commitGrouping: 'pendingRemote',
              updateId: envelope.updateId,
            },
          },
        },
      });

      const result2 = await doc.applyProviderUpdate(envelope);

      expect(result2.status).toBe('duplicate');
      expect(bridge.admissions).toHaveLength(1);

      await doc.destroy();
    });

    it('rejects identity payload conflicts before syncApply', async () => {
      const store = await createInMemoryVersionStoreProvider({
        documentScope: versionDocumentScope,
        backend: new InMemoryVersionDocumentProviderBackend(),
        durability: 'inbound-update-test-double',
      }).openAppliedSyncUpdateIdentityStore();
      const { doc, bridge } = await makeOrchestrator({ appliedSyncUpdateIdentityStore: store });
      const providerA = makeRecordingProvider('ProviderA');
      await doc.attachProvider(providerA);
      const syncApply = jest.spyOn(bridge, 'syncApply');

      const envelope = makeV2Envelope({
        payload: new Uint8Array([0x21, 0x22]),
        updateId: 'applied-identity-conflict-1',
      });
      const admittedContext = createAdmittedSyncApplyContext({
        source: 'provider-inbound',
        docId: 'inbound-test-doc',
        envelopeVersion: envelope.schemaVersion,
        providerRefId: envelope.providerRefId,
        providerEpoch: envelope.providerEpoch,
        updateId: envelope.updateId,
        payloadHash: envelope.payloadHash,
        provenance: envelope.provenance,
        validationDiagnostics: [],
      });
      const { identityKey } = await appliedSyncUpdateIdentityKeyMaterialForOperationContext(
        admittedContext.operationContext,
      );
      await expect(
        store.reserveIdentity({
          identityKey,
          operationContext: {
            ...admittedContext.operationContext,
            collaboration: {
              ...admittedContext.operationContext.collaboration!,
              payloadHash: '4'.repeat(64),
            },
          },
          createdAt: '2026-06-21T00:00:01.000Z',
        }),
      ).resolves.toMatchObject({ status: 'reserved' });

      const result = await doc.applyProviderUpdate(envelope);

      expect(result.status).toBe('rejected');
      expect(result).toHaveProperty('reason', 'applied-sync-update-identity-conflict');
      expect(syncApply).not.toHaveBeenCalled();
      expect(bridge.admissions).toHaveLength(0);

      await doc.destroy();
    });

    it('marks sync apply failures as failedAfterMutation and blocks reapply', async () => {
      const store = await createInMemoryVersionStoreProvider({
        documentScope: versionDocumentScope,
        backend: new InMemoryVersionDocumentProviderBackend(),
        durability: 'inbound-update-test-double',
      }).openAppliedSyncUpdateIdentityStore();
      const { doc, bridge } = await makeOrchestrator({ appliedSyncUpdateIdentityStore: store });
      const providerA = makeRecordingProvider('ProviderA');
      const providerB = makeRecordingProvider('ProviderB');
      await doc.attachProvider(providerA);
      await doc.attachProvider(providerB);
      const syncApply = jest.spyOn(bridge, 'syncApply').mockImplementation(async () => {
        throw new Error('sync apply failed after reservation');
      });

      const envelope = makeV2Envelope({
        payload: new Uint8Array([0x31, 0x32]),
        updateId: 'applied-identity-failed-after-mutation-1',
      });

      await expect(doc.applyProviderUpdate(envelope)).rejects.toThrow(
        'sync apply failed after reservation',
      );

      expect(syncApply).toHaveBeenCalledTimes(1);
      expect(bridge.admissions).toHaveLength(1);
      const identityKey = await appliedIdentityKeyForAdmission(bridge.admissions[0]!);
      await expect(store.readByIdentityKey(identityKey)).resolves.toMatchObject({
        status: 'found',
        record: {
          identityKey,
          payloadHash: envelope.payloadHash,
          state: 'failedAfterMutation',
          terminal: {
            status: 'failedAfterMutation',
            reason: 'sync-apply-failed-after-identity-reservation',
          },
        },
      });

      const retry = await doc.applyProviderUpdate(envelope);

      expect(retry).toMatchObject({
        status: 'rejected',
        reason: 'applied-sync-update-identity-failed-after-mutation',
      });
      expect(syncApply).toHaveBeenCalledTimes(1);

      bridge.emit(new Uint8Array([0x7e]));
      await Promise.resolve();
      expect(providerA.observed).toHaveLength(1);
      expect(providerB.observed).toHaveLength(1);

      await doc.destroy();
    });

    it('preserves compatibility retry behavior without an identity store on sync apply failure', async () => {
      const { doc, bridge } = await makeOrchestrator();
      const providerA = makeRecordingProvider('ProviderA');
      await doc.attachProvider(providerA);
      const syncApply = jest.spyOn(bridge, 'syncApply').mockImplementation(async () => {
        throw new Error('sync apply failed without identity store');
      });
      const envelope = makeV2Envelope({
        payload: new Uint8Array([0x41, 0x42]),
        updateId: 'applied-identity-no-store-failure-1',
      });

      await expect(doc.applyProviderUpdate(envelope)).rejects.toThrow(
        'sync apply failed without identity store',
      );
      await expect(doc.applyProviderUpdate(envelope)).rejects.toThrow(
        'sync apply failed without identity store',
      );

      expect(syncApply).toHaveBeenCalledTimes(2);

      await doc.destroy();
    });
  });

  describe('stale epoch', () => {
    it('rejects updates with a stale epoch', async () => {
      const { doc } = await makeOrchestrator();
      const providerA = makeRecordingProvider('ProviderA');
      await doc.attachProvider(providerA);

      // First update at epoch "2"
      const env1 = makeEnvelope({ providerEpoch: '2', updateId: 'e2-1' });
      const result1 = await doc.applyProviderUpdate(env1);
      expect(result1.status).toBe('applied');

      // Second update at epoch "1" (stale)
      const env2 = makeEnvelope({ providerEpoch: '1', updateId: 'e1-1' });
      const result2 = await doc.applyProviderUpdate(env2);
      expect(result2.status).toBe('rejected');
      expect(result2).toHaveProperty('reason', expect.stringContaining('stale-epoch'));

      await doc.destroy();
    });

    it('accepts updates with the same epoch', async () => {
      const { doc } = await makeOrchestrator();
      const providerA = makeRecordingProvider('ProviderA');
      await doc.attachProvider(providerA);

      const env1 = makeEnvelope({ providerEpoch: '1', updateId: 'same-1' });
      const env2 = makeEnvelope({ providerEpoch: '1', updateId: 'same-2' });

      expect((await doc.applyProviderUpdate(env1)).status).toBe('applied');
      expect((await doc.applyProviderUpdate(env2)).status).toBe('applied');

      await doc.destroy();
    });

    it('accepts updates with a newer epoch', async () => {
      const { doc } = await makeOrchestrator();
      const providerA = makeRecordingProvider('ProviderA');
      await doc.attachProvider(providerA);

      const env1 = makeEnvelope({ providerEpoch: '1', updateId: 'newer-1' });
      const env2 = makeEnvelope({ providerEpoch: '2', updateId: 'newer-2' });

      expect((await doc.applyProviderUpdate(env1)).status).toBe('applied');
      expect((await doc.applyProviderUpdate(env2)).status).toBe('applied');

      await doc.destroy();
    });
  });

  describe('validation', () => {
    it('rejects unknown providerRefId', async () => {
      const { doc } = await makeOrchestrator();
      const providerA = makeRecordingProvider('ProviderA');
      await doc.attachProvider(providerA);

      const envelope = makeEnvelope({ providerRefId: 'NonExistentProvider' });
      const result = await doc.applyProviderUpdate(envelope);

      expect(result.status).toBe('rejected');
      expect(result).toHaveProperty('reason', expect.stringContaining('unknown-provider'));

      await doc.destroy();
    });

    it('rejects unsupported payloadKind', async () => {
      const { doc } = await makeOrchestrator();
      const providerA = makeRecordingProvider('ProviderA');
      await doc.attachProvider(providerA);

      const envelope = makeEnvelope({
        payloadKind: 'provider-snapshot-fragment',
      });
      const result = await doc.applyProviderUpdate(envelope);

      expect(result.status).toBe('rejected');
      expect(result).toHaveProperty('reason', expect.stringContaining('unsupported-payload-kind'));

      await doc.destroy();
    });

    it('rejects invalid V2 provenance before syncApply', async () => {
      const { doc, bridge } = await makeOrchestrator();
      const providerA = makeRecordingProvider('ProviderA');
      await doc.attachProvider(providerA);
      const syncApply = jest.spyOn(bridge, 'syncApply');

      const valid = makeV2Envelope({
        payload: new Uint8Array([0x31, 0x32]),
        updateId: 'invalid-v2-1',
      });
      const envelope: ProviderInboundUpdateEnvelopeV2 = {
        ...valid,
        payloadHash: 'b'.repeat(64),
        authorityProof: proof(
          [
            ...PROVIDER_INBOUND_V2_BASE_PROOF_FIELDS,
            ...PROVIDER_INBOUND_V2_SINGLE_AUTHOR_PROOF_FIELDS.filter(
              (field) => field !== 'remoteAuthorRef',
            ),
            'providerId',
            'providerKind',
          ],
          valid.provenance.updateIdentity.provenancePayloadHash,
        ),
      };

      const result = await doc.applyProviderUpdate(envelope);

      expect(result.status).toBe('rejected');
      expect(result.reason).toBe('provenance-validation-failed');
      expect(result.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ reason: 'payloadHashMismatch' }),
          expect.objectContaining({ reason: 'partialCoverage', field: 'remoteAuthorRef' }),
        ]),
      );
      expect(syncApply).not.toHaveBeenCalled();
      expect(bridge.admissions).toHaveLength(0);

      await doc.destroy();
    });

    it('rejects commit-eligible V2 unknown authors before syncApply', async () => {
      const { doc, bridge } = await makeOrchestrator();
      const providerA = makeRecordingProvider('ProviderA');
      await doc.attachProvider(providerA);
      const syncApply = jest.spyOn(bridge, 'syncApply');

      const v1 = makeEnvelope({
        payload: new Uint8Array([0x41, 0x42]),
        updateId: 'unknown-author-1',
      });
      const provenance = makeLiveProvenance(v1, {
        author: { kind: 'unknown', reason: 'notProvided' },
      });
      const envelope = makeV2Envelope({ ...v1, provenance });

      const result = await doc.applyProviderUpdate(envelope);

      expect(result.status).toBe('rejected');
      expect(result.reason).toBe('provenance-validation-failed');
      expect(result.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            reason: 'unknownAuthor',
            subreason: 'localAuthorInferenceNotAllowed',
          }),
        ]),
      );
      expect(syncApply).not.toHaveBeenCalled();
      expect(bridge.admissions).toHaveLength(0);

      await doc.destroy();
    });

    it('rejects when document is destroyed', async () => {
      const { doc } = await makeOrchestrator();
      const providerA = makeRecordingProvider('ProviderA');
      await doc.attachProvider(providerA);
      await doc.destroy();

      const envelope = makeEnvelope();
      const result = await doc.applyProviderUpdate(envelope);

      expect(result.status).toBe('rejected');
      expect(result).toHaveProperty('reason', 'document-destroyed');
    });
  });

  describe('origin reset after apply', () => {
    it('origin resets to local after applyProviderUpdate, so subsequent local mutations fan to all', async () => {
      const { doc, bridge } = await makeOrchestrator();
      const providerA = makeRecordingProvider('ProviderA');
      const providerB = makeRecordingProvider('ProviderB');
      await doc.attachProvider(providerA);
      await doc.attachProvider(providerB);

      // Inbound update from ProviderA
      const envelope = makeEnvelope({
        providerRefId: 'ProviderA',
        payload: new Uint8Array([0x01]),
      });
      await doc.applyProviderUpdate(envelope);
      await Promise.resolve();

      // Clear observations
      providerA.observed.length = 0;
      providerB.observed.length = 0;

      // Now emit a local update — should go to BOTH providers
      bridge.emit(new Uint8Array([0x02]));
      await Promise.resolve();

      expect(providerA.observed).toHaveLength(1);
      expect(providerB.observed).toHaveLength(1);

      await doc.destroy();
    });
  });

  describe('inbound update log capacity', () => {
    it('evicts old updateIds when capacity is exceeded', async () => {
      const { doc } = await makeOrchestrator();
      const providerA = makeRecordingProvider('ProviderA');
      await doc.attachProvider(providerA);

      // Apply 1001 updates — the first should be evicted
      const firstId = 'evict-test-first';
      await doc.applyProviderUpdate(makeEnvelope({ updateId: firstId, providerEpoch: '1' }));

      for (let i = 1; i <= 1000; i++) {
        await doc.applyProviderUpdate(
          makeEnvelope({ updateId: `evict-test-${i}`, providerEpoch: '1' }),
        );
      }

      // The first updateId should have been evicted, so re-submitting it
      // should succeed (not be detected as duplicate)
      const result = await doc.applyProviderUpdate(
        makeEnvelope({ updateId: firstId, providerEpoch: '1' }),
      );
      expect(result.status).toBe('applied');

      await doc.destroy();
    });
  });
});

async function appliedIdentityKeyForAdmission(
  metadata: ProviderDocApplyUpdateMetadata,
): Promise<string> {
  const admittedContext = createAdmittedSyncApplyContext(metadata);
  const { identityKey } = await appliedSyncUpdateIdentityKeyMaterialForOperationContext(
    admittedContext.operationContext,
  );
  return identityKey;
}
