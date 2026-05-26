/**
 * Provider Conformance Suite — the storage provider lifecycle, provider conformance
 *
 * Generic conformance suite that runs against ANY Provider implementation.
 * Exercises all 14 conformance rows from the the storage provider lifecycle Verification section
 * against every registered provider factory.
 *
 * Conformance rows:
 *   1.  Empty attach — status ready, no state replayed
 *   2.  Attach with prior state — replays into doc
 *   3.  Append N updates, flush, reattach convergence
 *   4.  FIFO ordering
 *   5.  No reentrancy — appendUpdate during flush queues for next batch
 *   6.  Backpressure during flush — appendUpdate returns sync
 *   7.  flushSync idempotency
 *   8.  flushSync failure sets flushFailed
 *   9.  Full-state checkpoint
 *   10. Read-only attach and mutation rejection (post-detach no-op)
 *   11. Detach final-flush and idempotency
 *   12. the storage provider lifecycle getCapabilities
 *   13. the storage provider lifecycle getIdentity
 *   14. Import-initialize mode
 *
 * Providers tested:
 *   - MemoryProvider (non-durable, plan03-aligned)
 *   - TestProvider   (non-durable, plan03-aligned)
 *
 * NOTE: IndexedDB, filesystem, Tauri, and other runtime-specific providers
 * require browser/Node/Tauri runtimes and are NOT included here. They need
 * their own runtime-specific conformance harnesses.
 *
 * @see provider.ts — the Provider contract
 * @see memory-provider.ts — MemoryProvider implementation
 * @see test-provider.ts — TestProvider (failure injection subclass)
 */

import { runProviderConformance } from './conformance';
import { buildMockProviderDoc, MockProviderDoc, makeUpdate } from './mock-provider-doc';
import { MemoryProvider, type MemoryProviderStorage } from '../memory-provider';
import { TestProvider } from '../test-provider';
import type { Provider, ProviderDoc } from '../provider';

// =============================================================================
// Shared conformance (rows 1-8, FIFO, reentrancy, backpressure) via the
// existing runProviderConformance helper
// =============================================================================

const MEMORY_STORAGE_KEY = 'memory-provider-conformance';
let memoryStorage: MemoryProviderStorage = new Map();

runProviderConformance({
  name: 'MemoryProvider',
  factory: () => new MemoryProvider(MEMORY_STORAGE_KEY, { storage: memoryStorage }),
  buildProviderDoc: buildMockProviderDoc,
  resetStorage: () => {
    memoryStorage = new Map();
  },
  factoryWithFailingFlushSync: () =>
    new MemoryProvider(MEMORY_STORAGE_KEY, {
      storage: memoryStorage,
      failFlushSync: () => true,
    }),
});

const TEST_STORAGE_KEY = 'test-provider-conformance';
let testStorage: MemoryProviderStorage = new Map();

runProviderConformance({
  name: 'TestProvider',
  factory: () => new TestProvider(TEST_STORAGE_KEY, { storage: testStorage }),
  buildProviderDoc: buildMockProviderDoc,
  resetStorage: () => {
    testStorage = new Map();
  },
  factoryWithFailingFlushSync: () => {
    const p = new TestProvider(TEST_STORAGE_KEY, { storage: testStorage });
    p.setFailure('flushSync', true);
    return p;
  },
});

// =============================================================================
// Factory interface for the the storage provider lifecycle extended rows (9-14)
// =============================================================================

interface ConformanceProviderFactory {
  name: string;
  create: (docId: string) => Provider;
  durable: boolean;
  plan03Aligned: boolean;
  resetStorage: () => void;
}

// =============================================================================
// the storage provider lifecycle conformance rows — run against every provider
// =============================================================================

describe('Provider Conformance Suite — the storage provider lifecycle extended rows', () => {
  const factories: ConformanceProviderFactory[] = [];

  // --- MemoryProvider ---
  {
    let storage: MemoryProviderStorage = new Map();
    factories.push({
      name: 'MemoryProvider',
      create: (docId: string) => new MemoryProvider(docId, { storage }),
      durable: false,
      plan03Aligned: true,
      resetStorage: () => {
        storage = new Map();
      },
    });
  }

  // --- TestProvider ---
  {
    let storage: MemoryProviderStorage = new Map();
    factories.push({
      name: 'TestProvider',
      create: (docId: string) => new TestProvider(docId, { storage }),
      durable: false,
      plan03Aligned: true,
      resetStorage: () => {
        storage = new Map();
      },
    });
  }

  for (const factory of factories) {
    describe(`${factory.name} — the storage provider lifecycle rows`, () => {
      const baseDocId = `plan03-${factory.name.toLowerCase()}`;

      beforeEach(() => {
        factory.resetStorage();
      });

      // -------------------------------------------------------------------
      // Row 9: Full-state checkpoint
      // -------------------------------------------------------------------
      it('row 9: full-state checkpoint — committed, reattach replays checkpoint state', async () => {
        const docId = `${baseDocId}-r9`;

        const session1 = factory.create(docId);
        const doc1 = buildMockProviderDoc(docId);
        await session1.attach(doc1);

        // Append updates and flush them to storage
        session1.appendUpdate(makeUpdate(801));
        session1.appendUpdate(makeUpdate(802));
        session1.appendUpdate(makeUpdate(803));
        await session1.flush();

        // Apply the same updates to the doc so it has state to encode
        await doc1.applyUpdate(makeUpdate(801));
        await doc1.applyUpdate(makeUpdate(802));
        await doc1.applyUpdate(makeUpdate(803));

        // Checkpoint: full-state snapshot
        const result = await session1.checkpointFullState(doc1);
        expect(result).toBeDefined();
        expect((result as { status: string }).status).toBe('committed');

        await session1.detach();

        // Reattach: should see the checkpoint state
        const session2 = factory.create(docId);
        const doc2 = buildMockProviderDoc(docId);
        await session2.attach(doc2);

        const diff = await doc2.encodeDiff(new Uint8Array());
        expect(diff.length).toBeGreaterThan(0);

        await session2.detach();
      });

      // -------------------------------------------------------------------
      // Row 10: Read-only / post-detach mutation rejection
      // -------------------------------------------------------------------
      it('row 10: appendUpdate after detach is a silent no-op', async () => {
        const docId = `${baseDocId}-r10`;

        const session = factory.create(docId);
        await session.attach(buildMockProviderDoc(docId));
        session.appendUpdate(makeUpdate(901));
        await session.flush();
        await session.detach();

        // Post-detach appendUpdate must be silently dropped
        session.appendUpdate(makeUpdate(902));

        // Reattach and verify only the pre-detach update persisted
        const session2 = factory.create(docId);
        const doc2 = buildMockProviderDoc(docId);
        await session2.attach(doc2);
        expect(doc2.appliedCount()).toBe(1);
        await session2.detach();
      });

      // -------------------------------------------------------------------
      // Row 11: Detach final-flush and idempotency
      // -------------------------------------------------------------------
      it('row 11: detach drains pending updates; second detach is no-op', async () => {
        const docId = `${baseDocId}-r11`;

        const session = factory.create(docId);
        await session.attach(buildMockProviderDoc(docId));
        session.appendUpdate(makeUpdate(1101));
        // No explicit flush — detach must final-flush
        await session.detach();

        // Second detach: must not throw
        await expect(session.detach()).resolves.toBeUndefined();

        // Verify the unflushed update was persisted by detach
        const session2 = factory.create(docId);
        const doc2 = buildMockProviderDoc(docId);
        await session2.attach(doc2);
        const diff = await doc2.encodeDiff(new Uint8Array());
        expect(diff.length).toBeGreaterThan(0);
        await session2.detach();
      });

      // -------------------------------------------------------------------
      // Row 12: the storage provider lifecycle getCapabilities
      // -------------------------------------------------------------------
      if (factory.plan03Aligned) {
        it('row 12: getCapabilities returns valid StorageProviderCapabilities with all boolean fields', () => {
          const provider = factory.create(`${baseDocId}-r12`);

          expect(provider.getCapabilities).toBeDefined();
          const caps = provider.getCapabilities!();

          const requiredBooleanFields = [
            'writable',
            'durable',
            'synchronousFlushStart',
            'fullStateCheckpoint',
            'incrementalUpdateLog',
            'yrsStateVectorDiff',
            'storageCursor',
            'subscriptions',
            'exclusiveWriteLock',
            'readOnlyFallback',
            'offlineOpen',
            'reconnect',
            'inboundUpdates',
            'idempotentRemoteUpdates',
            'binaryAssets',
            'assetContentAddressing',
            'assetGarbageCollection',
            'assetAtomicCommit',
            'atomicBatch',
          ] as const;

          for (const field of requiredBooleanFields) {
            expect(typeof caps[field]).toBe('boolean');
          }

          // Non-durable providers must report durable: false
          if (!factory.durable) {
            expect(caps.durable).toBe(false);
          }
        });
      }

      // -------------------------------------------------------------------
      // Row 13: the storage provider lifecycle getIdentity
      // -------------------------------------------------------------------
      if (factory.plan03Aligned) {
        it('row 13: getIdentity returns valid StorageProviderIdentity with required fields', () => {
          const provider = factory.create(`${baseDocId}-r13`);

          expect(provider.getIdentity).toBeDefined();
          const identity = provider.getIdentity!();

          // providerRefId: required, non-empty string
          expect(typeof identity.providerRefId).toBe('string');
          expect(identity.providerRefId.length).toBeGreaterThan(0);

          // storageScope: required, valid discriminated union
          expect(identity.storageScope).toBeDefined();
          expect(['scoped', 'explicit-no-scope']).toContain(identity.storageScope.kind);

          if (identity.storageScope.kind === 'explicit-no-scope') {
            expect(['ephemeral-memory', 'deterministic-test-fixture']).toContain(
              identity.storageScope.reason,
            );
          }

          if (identity.storageScope.kind === 'scoped') {
            expect(identity.storageScope.scope).toBeDefined();
            expect(identity.storageScope.scope.tenantId).toBeDefined();
            expect(identity.storageScope.scope.workspaceId).toBeDefined();
          }

          // contractVersion: required, non-empty string
          expect(typeof identity.contractVersion).toBe('string');
          expect(identity.contractVersion.length).toBeGreaterThan(0);

          // providerProtocolVersion: required, non-empty string
          expect(typeof identity.providerProtocolVersion).toBe('string');
          expect(identity.providerProtocolVersion.length).toBeGreaterThan(0);

          // Optional fields: if present, must be strings
          if (identity.providerId !== undefined) {
            expect(typeof identity.providerId).toBe('string');
          }
          if (identity.authorityRef !== undefined) {
            expect(typeof identity.authorityRef).toBe('string');
          }
          if (identity.redactedConfigFingerprint !== undefined) {
            expect(typeof identity.redactedConfigFingerprint).toBe('string');
          }
          if (identity.storageSchemaVersion !== undefined) {
            expect(typeof identity.storageSchemaVersion).toBe('string');
          }
        });
      }

      // -------------------------------------------------------------------
      // Row 14: Import-initialize mode
      // -------------------------------------------------------------------
      it('row 14: import-initialize attach does NOT replay existing state', async () => {
        const docId = `${baseDocId}-r14`;

        // Session 1: seed some state
        const session1 = factory.create(docId);
        await session1.attach(buildMockProviderDoc(docId));
        session1.appendUpdate(makeUpdate(1401));
        session1.appendUpdate(makeUpdate(1402));
        await session1.flush();
        await session1.detach();

        // Session 2: attach with importInitialize — must NOT replay
        const session2 = factory.create(docId);
        const doc2 = buildMockProviderDoc(docId);
        const result = await session2.attach(doc2, {
          kind: 'importInitialize',
          replaceExisting: true,
        });

        expect(result).toBeDefined();
        expect((result as { status: string }).status).toBe('ready');
        expect((result as { mode: string }).mode).toBe('importInitialize');

        // Doc must have zero updates replayed
        expect(doc2.appliedCount()).toBe(0);

        await session2.detach();
      });
    });
  }
});

// =============================================================================
// Provider-specific tests
// =============================================================================

describe('MemoryProvider — specific', () => {
  let storage: MemoryProviderStorage;

  beforeEach(() => {
    storage = new Map();
  });

  it('seeds initial state from options', async () => {
    const initialState = makeUpdate(42);
    const provider = new MemoryProvider('seed-test', {
      storage,
      initialState,
    });
    const doc = buildMockProviderDoc('seed-test');
    await provider.attach(doc);

    const diff = await doc.encodeDiff(new Uint8Array());
    expect(diff.length).toBeGreaterThan(0);

    await provider.detach();
  });

  it('does not overwrite existing storage with initial state', async () => {
    const existingUpdate = makeUpdate(99);
    storage.set('pre-pop', {
      snapshot: null,
      updates: [existingUpdate],
    });

    const provider = new MemoryProvider('pre-pop', {
      storage,
      initialState: makeUpdate(42),
    });
    const doc = buildMockProviderDoc('pre-pop');
    await provider.attach(doc);

    const applied = doc.appliedInOrder();
    expect(applied.length).toBe(1);
    expect(uint8sEqual(applied[0]!, existingUpdate)).toBe(true);

    await provider.detach();
  });

  it('checkpointFullState compacts snapshot + clears log', async () => {
    const provider = new MemoryProvider('checkpoint-test', { storage });
    const doc = buildMockProviderDoc('checkpoint-test');
    await provider.attach(doc);

    for (let i = 0; i < 5; i++) {
      provider.appendUpdate(makeUpdate(100 + i));
    }
    await provider.flush();

    expect(provider.getStoredUpdates().length).toBe(5);

    const result = await provider.checkpointFullState(doc);
    expect(result).toEqual({ status: 'committed', mode: 'normal' });

    expect(provider.getStoredSnapshot()).not.toBeNull();
    expect(provider.getStoredUpdates().length).toBe(0);

    await provider.detach();
  });

  it('attach returns blocked when already attached', async () => {
    const provider = new MemoryProvider('double-attach', { storage });
    const doc = buildMockProviderDoc('double-attach');
    await provider.attach(doc);

    const result = await provider.attach(doc);
    expect(result).toMatchObject({
      status: 'blocked',
      reason: 'alreadyAttached',
    });

    await provider.detach();
  });

  it('attach returns blocked when detached', async () => {
    const provider = new MemoryProvider('detach-reattach', { storage });
    const doc = buildMockProviderDoc('detach-reattach');
    await provider.attach(doc);
    await provider.detach();

    const result = await provider.attach(doc);
    expect(result).toMatchObject({
      status: 'blocked',
      reason: 'detached',
    });
  });

  it('getIdentity includes docId in providerRefId', () => {
    const provider = new MemoryProvider('identity-test', { storage });
    const identity = provider.getIdentity();
    expect(identity.providerRefId).toContain('identity-test');
  });
});

describe('TestProvider — failure injection', () => {
  let storage: MemoryProviderStorage;

  beforeEach(() => {
    storage = new Map();
  });

  it('simulated attach failure', async () => {
    const provider = new TestProvider('fail-attach', { storage });
    provider.setFailure('attach', true);
    const doc = buildMockProviderDoc('fail-attach');

    await expect(provider.attach(doc)).rejects.toThrow('simulated attach failure');
    expect(provider.getAttachCount()).toBe(1);
  });

  it('simulated appendUpdate failure (silent drop)', async () => {
    const provider = new TestProvider('fail-append', { storage });
    const doc = buildMockProviderDoc('fail-append');
    await provider.attach(doc);

    provider.setFailure('appendUpdate', true);
    provider.appendUpdate(makeUpdate(1));
    provider.appendUpdate(makeUpdate(2));

    expect(provider.getAppendCount()).toBe(2);
    expect(provider.getPendingCount()).toBe(0);
    expect(provider.getRecordedUpdates().length).toBe(2);

    await provider.detach();
  });

  it('simulated flush failure', async () => {
    const provider = new TestProvider('fail-flush', { storage });
    const doc = buildMockProviderDoc('fail-flush');
    await provider.attach(doc);

    provider.appendUpdate(makeUpdate(1));
    provider.setFailure('flush', true);

    await expect(provider.flush()).rejects.toThrow('simulated flush failure');
    expect(provider.getFlushCount()).toBe(1);

    await provider.detach();
  });

  it('simulated checkpoint failure', async () => {
    const provider = new TestProvider('fail-ckpt', { storage });
    const doc = buildMockProviderDoc('fail-ckpt');
    await provider.attach(doc);

    provider.setFailure('checkpoint', true);

    await expect(provider.checkpointFullState(doc)).rejects.toThrow('simulated checkpoint failure');
    expect(provider.getCheckpointCount()).toBe(1);

    await provider.detach();
  });

  it('simulated detach failure', async () => {
    const provider = new TestProvider('fail-detach', { storage });
    const doc = buildMockProviderDoc('fail-detach');
    await provider.attach(doc);

    provider.setFailure('detach', true);

    await expect(provider.detach()).rejects.toThrow('simulated detach failure');
    expect(provider.getDetachCount()).toBe(1);
  });

  it('clearInjections resets all failures and latencies', async () => {
    const provider = new TestProvider('clear-inject', { storage });
    provider.setFailure('attach', true);
    provider.setFailure('flush', true);
    provider.setLatency('attach', 100);

    provider.clearInjections();

    const doc = buildMockProviderDoc('clear-inject');
    const t0 = Date.now();
    await provider.attach(doc);
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(50);

    await provider.detach();
  });

  it('failure can be toggled mid-session', async () => {
    const provider = new TestProvider('toggle', { storage });
    const doc = buildMockProviderDoc('toggle');
    await provider.attach(doc);

    provider.appendUpdate(makeUpdate(1));
    expect(provider.getPendingCount()).toBe(1);

    provider.setFailure('appendUpdate', true);
    provider.appendUpdate(makeUpdate(2));
    expect(provider.getPendingCount()).toBe(1);

    provider.setFailure('appendUpdate', false);
    provider.appendUpdate(makeUpdate(3));
    expect(provider.getPendingCount()).toBe(2);

    await provider.detach();
  });

  it('getIdentity inherits from MemoryProvider', () => {
    const provider = new TestProvider('identity-test', { storage });
    const identity = provider.getIdentity();
    expect(identity.providerRefId).toContain('identity-test');
    expect(identity.storageScope.kind).toBe('explicit-no-scope');
  });
});

// =============================================================================
// Helpers
// =============================================================================

function uint8sEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
