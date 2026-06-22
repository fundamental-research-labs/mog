import { jest } from '@jest/globals';
import { createHash } from 'node:crypto';
import { classifyLegacyRawUpdate } from '@mog-sdk/types-document/storage';
import type { StorageProviderIdentity } from '@mog-sdk/types-document/storage/provider-identity';
import type {
  MutationResult,
  SyncApplyMutationMetadataWire,
} from '../../bridges/compute/compute-types.gen';
import { RustDocument } from '../rust-document';
import { createBridgeBackedProviderDoc } from '../providers/bridge-provider-doc';
import type { Provider, ProviderDocApplyUpdateMetadata } from '../providers/provider';

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
  admissions: ProviderDocApplyUpdateMetadata[];
  events: string[];
  applied: Uint8Array[];
}

const storageScope = {
  kind: 'scoped',
  scope: {
    tenantId: { kind: 'single-tenant' },
    workspaceId: { kind: 'no-workspace' },
    documentId: 'provider-replay-doc',
  },
} as const;

function makeStubBridge(): StubBridge {
  const subscribers = new Set<(u: Uint8Array) => void>();
  const admissions: ProviderDocApplyUpdateMetadata[] = [];
  const events: string[] = [];
  const applied: Uint8Array[] = [];

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
      events.push('syncApply');
      applied.push(new Uint8Array(u));
      for (const cb of subscribers) cb(u);
      return { recalc: { changedCells: [] } };
    }),
    recordProviderDocApplyUpdateAdmission(metadata) {
      events.push(`admission:${metadata.provenance.sourceKind}`);
      admissions.push(metadata);
    },
    encodeDiff: async () => new Uint8Array(),
    currentStateVector: async () => new Uint8Array(),
    flushPendingUpdateV1: async () => {},
    admissions,
    events,
    applied,
  };
}

async function makeOrchestrator(): Promise<{ doc: RustDocument; bridge: StubBridge }> {
  const bridge = makeStubBridge();
  const doc = new RustDocument({
    docId: 'provider-replay-doc',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    computeBridge: bridge as unknown as any,
    internal: true,
    skipPersistenceLoad: true,
  });
  await doc.ready;
  return { doc, bridge };
}

function makeIdentity(overrides: Partial<StorageProviderIdentity> = {}): StorageProviderIdentity {
  return {
    providerRefId: 'provider-ref-1',
    storageScope,
    contractVersion: '0.3.0',
    providerProtocolVersion: '1.0',
    ...overrides,
  };
}

function makeReplayProvider(options: {
  readonly name?: string;
  readonly update: Uint8Array;
  readonly identity?: StorageProviderIdentity;
}): Provider & { readonly attachCalls: number[] } {
  const identity = options.identity;
  const attachCalls: number[] = [];
  const provider: Provider & { readonly attachCalls: number[] } = {
    name: options.name ?? 'ReplayProvider',
    attachCalls,
    attach: async (doc) => {
      attachCalls.push(1);
      await doc.applyUpdate(options.update);
    },
    appendUpdate: () => {},
    flush: async () => {},
    checkpointFullState: async () => {},
    flushSync: () => {},
    detach: async () => {},
    stateVector: async () => new Uint8Array(),
    flushFailed: false,
    ...(identity === undefined ? {} : { getIdentity: () => identity }),
  };
  return provider;
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('provider attach replay provenance classification', () => {
  it('returns bridge sync apply metadata when the bridge exposes the richer path', async () => {
    const update = new Uint8Array([0x44, 0x55]);
    const payloadHash = sha256Hex(update);
    const admissionMetadata = {
      source: 'provider-replay',
      docId: 'provider-replay-doc',
      envelopeVersion: 'provider-replay',
      payloadHash,
      provenance: classifyLegacyRawUpdate({
        payloadHash,
        updateId: `provider-replay-test:${payloadHash}`,
      }),
      validationDiagnostics: [],
    } satisfies ProviderDocApplyUpdateMetadata;
    const mutationResult = { recalc: { changedCells: [] } } as unknown as MutationResult;
    const syncApplyMetadata = {
      mutationResult,
      provenanceReport: {
        pendingSegmentIds: ['pending-segment-1'],
      },
    } as SyncApplyMutationMetadataWire;
    const syncApply = jest.fn(async () => mutationResult);
    const syncApplyWithMetadata = jest.fn(async () => ({
      mutationResult,
      metadata: syncApplyMetadata,
    }));
    const recordProviderDocApplyUpdateAdmission = jest.fn();
    const bridge = {
      syncApply,
      syncApplyWithMetadata,
      recordProviderDocApplyUpdateAdmission,
      encodeDiff: async () => new Uint8Array(),
      currentStateVector: async () => new Uint8Array(),
    } as unknown as Parameters<typeof createBridgeBackedProviderDoc>[0];
    const doc = createBridgeBackedProviderDoc(bridge, 'provider-replay-doc');

    const result = await doc.applyUpdate(update, admissionMetadata);

    expect(syncApplyWithMetadata).toHaveBeenCalledWith(
      update,
      expect.objectContaining({ operationContext: expect.any(Object) }),
    );
    expect(syncApply).not.toHaveBeenCalled();
    expect(recordProviderDocApplyUpdateAdmission).toHaveBeenCalledWith(admissionMetadata);
    expect(result).toEqual({ mutationResult, metadata: syncApplyMetadata });
  });

  it('emits providerReplay admission before syncApply for bare attach replay bytes', async () => {
    const { doc, bridge } = await makeOrchestrator();
    const update = new Uint8Array([0xaa, 0xbb, 0xcc]);
    const provider = makeReplayProvider({
      update,
      identity: makeIdentity({ providerId: 'provider-stable-1', authorityRef: 'authority-1' }),
    });

    await doc.attachProvider(provider, { suppressInitialBaseline: true, suppressTouch: true });

    expect(provider.attachCalls).toHaveLength(1);
    expect(bridge.events).toEqual(['admission:providerReplay', 'syncApply']);
    expect(bridge.applied).toHaveLength(1);
    expect(Array.from(bridge.applied[0]!)).toEqual(Array.from(update));
    expect(bridge.admissions).toHaveLength(1);
    expect(bridge.admissions[0]).toMatchObject({
      source: 'provider-replay',
      docId: 'provider-replay-doc',
      envelopeVersion: 'provider-replay',
      providerRefId: 'provider-ref-1',
      payloadHash: sha256Hex(update),
      validationDiagnostics: [],
    });
    expect(bridge.admissions[0]?.provenance).toMatchObject({
      sourceKind: 'providerReplay',
      replay: true,
      system: true,
      capturePolicy: 'excluded',
      author: { kind: 'unknown', reason: 'providerReplay' },
      updateIdentity: {
        originKind: 'provider',
        stableOriginId: 'provider-stable-1',
        providerId: 'provider-stable-1',
        providerRefId: 'provider-ref-1',
        authorityRef: 'authority-1',
        payloadHash: sha256Hex(update),
      },
    });

    await doc.destroy();
  });

  it('keeps providerRefId-only replay excluded with unknown authorship', async () => {
    const { doc, bridge } = await makeOrchestrator();
    const update = new Uint8Array([0x01, 0x02]);
    const provider = makeReplayProvider({
      update,
      identity: makeIdentity({ providerRefId: 'diagnostic-ref-only' }),
    });

    await doc.attachProvider(provider, { suppressInitialBaseline: true, suppressTouch: true });

    expect(bridge.admissions).toHaveLength(1);
    const provenance = bridge.admissions[0]!.provenance;
    expect(provenance.sourceKind).toBe('providerReplay');
    expect(provenance.capturePolicy).toBe('excluded');
    expect(provenance.capturePolicy).not.toBe('commitEligible');
    expect(provenance.author).toEqual({ kind: 'unknown', reason: 'providerReplay' });
    expect(provenance.updateIdentity.providerRefId).toBe('diagnostic-ref-only');
    expect(provenance.updateIdentity.providerId).toBeUndefined();
    expect(provenance.updateIdentity.stableOriginId).toBeUndefined();

    await doc.destroy();
  });
});
