/**
 * Inbound Provider Update — inbound provider update tests.
 *
 * Tests for `RustDocument.applyProviderUpdate`, the kernel-owned entry point
 * for remote/replica Providers to deliver inbound updates without echo loops.
 *
 * Uses the same stub-bridge pattern as `rust-document-orchestrator.test.ts`.
 */

import { jest } from '@jest/globals';
import { RustDocument } from '../rust-document';
import type { ProviderInboundUpdateEnvelope } from '../rust-document';
import type { Provider } from '../providers/provider';

// ---------------------------------------------------------------------------
// Stub bridge (same pattern as orchestrator tests)
// ---------------------------------------------------------------------------

interface StubBridge {
  subscribeUpdateV1(cb: (u: Uint8Array) => void): { unsubscribe: () => void };
  createEngine(snapshot?: Record<string, unknown>): Promise<unknown>;
  createEngineFromYrsState(state: Uint8Array): Promise<unknown>;
  flushUndoCapture(): Promise<unknown>;
  syncApply(u: Uint8Array): Promise<unknown>;
  encodeDiff(sv: Uint8Array): Promise<Uint8Array>;
  currentStateVector(): Promise<Uint8Array>;
  flushPendingUpdateV1(): Promise<void>;
  emit(update: Uint8Array): void;
  subscriberCount(): number;
}

function makeStubBridge(): StubBridge {
  const subscribers = new Set<(u: Uint8Array) => void>();
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
    encodeDiff: async () => new Uint8Array(),
    currentStateVector: async () => new Uint8Array(),
    flushPendingUpdateV1: async () => {},
    emit,
    subscriberCount() {
      return subscribers.size;
    },
  };
}

async function makeOrchestrator(): Promise<{ doc: RustDocument; bridge: StubBridge }> {
  const bridge = makeStubBridge();
  const doc = new RustDocument({
    docId: 'inbound-test-doc',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    computeBridge: bridge as unknown as any,
    internal: true,
    skipPersistenceLoad: true,
  });
  await doc.ready;
  return { doc, bridge };
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
  return {
    providerRefId: 'ProviderA',
    payloadKind: 'yrs-update-v1',
    payload: new Uint8Array([0x01, 0x02, 0x03]),
    updateId: `update-${Math.random().toString(36).slice(2)}`,
    providerEpoch: '1',
    ...overrides,
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

      // The payload was applied to the engine
      expect(applied).toHaveLength(1);
      expect(Array.from(applied[0]!)).toEqual([0xaa, 0xbb]);

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
