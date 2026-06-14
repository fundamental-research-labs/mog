/**
 * HostCallbackProvider tests.
 *
 * Runs the conformance suite via an in-memory HostCallbackRegistry, then
 * adds Provider-specific tests for callback delegation, checkpoint, and
 * the storage provider lifecycle optional methods.
 *
 * @see host-callback-provider.ts
 */

import { runProviderConformance } from './conformance';
import { buildMockProviderDoc, makeUpdate } from './mock-provider-doc';
import {
  HostCallbackProvider,
  createHostCallbackProviderFactory,
  type HostCallbackRegistry,
} from '../host-callback-provider';

// =============================================================================
// In-memory callback registry for tests
// =============================================================================

function createTestRegistry(): {
  registry: HostCallbackRegistry;
  storage: Map<string, Uint8Array[]>;
  checkpoints: Map<string, Uint8Array>;
} {
  const storage = new Map<string, Uint8Array[]>();
  const checkpoints = new Map<string, Uint8Array>();

  const registry: HostCallbackRegistry = {
    async load(docId: string): Promise<Uint8Array[]> {
      return storage.get(docId) ?? [];
    },
    async save(docId: string, updates: Uint8Array[]): Promise<void> {
      const log = storage.get(docId) ?? [];
      log.push(...updates.map((u) => new Uint8Array(u)));
      storage.set(docId, log);
    },
    async checkpoint(docId: string, fullState: Uint8Array): Promise<void> {
      checkpoints.set(docId, new Uint8Array(fullState));
    },
    async clear(docId: string): Promise<void> {
      storage.delete(docId);
      checkpoints.delete(docId);
    },
  };

  return { registry, storage, checkpoints };
}

// =============================================================================
// Conformance suite
// =============================================================================

const PROVIDER_STORAGE_KEY = 'host-callback-conformance';

let testCtx = createTestRegistry();

runProviderConformance({
  name: 'HostCallbackProvider',
  factory: () => new HostCallbackProvider(PROVIDER_STORAGE_KEY, testCtx.registry),
  buildProviderDoc: buildMockProviderDoc,
  resetStorage: () => {
    testCtx = createTestRegistry();
  },
  factoryWithFailingFlushSync: () => {
    const failingRegistry: HostCallbackRegistry = {
      ...testCtx.registry,
      // Synchronous throw — not an async rejection. This simulates a
      // registry whose save callback fails before returning a Promise,
      // exercising the sync catch path in flushSync.
      save(): Promise<void> {
        throw new Error('simulated save failure');
      },
    };
    return new HostCallbackProvider(PROVIDER_STORAGE_KEY, failingRegistry);
  },
});

// =============================================================================
// Provider-specific tests
// =============================================================================

describe('HostCallbackProvider — specific', () => {
  let ctx: ReturnType<typeof createTestRegistry>;

  beforeEach(() => {
    ctx = createTestRegistry();
  });

  it('delegates load to the registry on attach', async () => {
    const docId = 'hcb-load-test';
    const update = makeUpdate(42);
    ctx.storage.set(docId, [update]);

    const provider = new HostCallbackProvider(docId, ctx.registry);
    const doc = buildMockProviderDoc(docId);
    await provider.attach(doc);

    // The doc should have received the update.
    expect(doc.appliedCount()).toBe(1);
    await provider.detach();
  });

  it('delegates save to the registry on flush', async () => {
    const docId = 'hcb-save-test';
    const provider = new HostCallbackProvider(docId, ctx.registry);
    await provider.attach(buildMockProviderDoc(docId));

    provider.appendUpdate(makeUpdate(1));
    provider.appendUpdate(makeUpdate(2));
    await provider.flush();

    const stored = ctx.storage.get(docId) ?? [];
    expect(stored.length).toBe(2);
    await provider.detach();
  });

  it('delegates checkpoint to the registry', async () => {
    const docId = 'hcb-checkpoint-test';
    const provider = new HostCallbackProvider(docId, ctx.registry);
    const doc = buildMockProviderDoc(docId);
    await provider.attach(doc);

    // Apply an update to the doc so encodeDiff returns non-empty bytes.
    const update = makeUpdate(10);
    await doc.applyUpdate(update);
    provider.appendUpdate(update);
    await provider.flush();

    await provider.checkpointFullState(doc);

    expect(ctx.checkpoints.has(docId)).toBe(true);
    const checkpoint = ctx.checkpoints.get(docId)!;
    expect(checkpoint.length).toBeGreaterThan(0);
    await provider.detach();
  });

  it('throws on attach after detach', async () => {
    const provider = new HostCallbackProvider('hcb-detach', ctx.registry);
    await provider.attach(buildMockProviderDoc('hcb-detach'));
    await provider.detach();

    await expect(provider.attach(buildMockProviderDoc('hcb-detach'))).rejects.toThrow(
      'has been detached',
    );
  });

  it('getCapabilities returns correct shape', () => {
    const provider = new HostCallbackProvider('cap-test', ctx.registry);
    const caps = provider.getCapabilities();
    expect(caps.writable).toBe(true);
    expect(caps.durable).toBe(false);
    expect(caps.fullStateCheckpoint).toBe(true);
    expect(caps.incrementalUpdateLog).toBe(true);
  });

  it('getCapabilities.durable reflects the option', () => {
    const provider = new HostCallbackProvider('dur-test', ctx.registry, {
      durable: true,
    });
    expect(provider.getCapabilities().durable).toBe(true);
  });

  it('getIdentity returns StorageProviderIdentity with providerRefId', () => {
    const provider = new HostCallbackProvider('id-test', ctx.registry);
    const id = provider.getIdentity();
    expect(id.providerRefId).toContain('id-test');
    expect(id.storageScope.kind).toBe('explicit-no-scope');
    expect(id.contractVersion).toBe('0.3.0');
  });

  it('storageCursor advances after flush', async () => {
    const docId = 'cursor-test';
    const provider = new HostCallbackProvider(docId, ctx.registry);
    await provider.attach(buildMockProviderDoc(docId));

    const c0 = await provider.storageCursor();
    provider.appendUpdate(makeUpdate(1));
    await provider.flush();
    const c1 = await provider.storageCursor();

    expect(Buffer.from(c0).toString()).not.toBe(Buffer.from(c1).toString());
    await provider.detach();
  });

  it('createHostCallbackProviderFactory closes over the registry', () => {
    const factory = createHostCallbackProviderFactory(ctx.registry, {
      durable: true,
    });
    const p = factory('factory-test');
    expect(p).toBeInstanceOf(HostCallbackProvider);
    expect(p.getCapabilities().durable).toBe(true);
    expect(p.getIdentity().providerRefId).toContain('factory-test');
  });
});
