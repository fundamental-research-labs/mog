/**
 * TauriFileProvider × conformance suite + runtime-guard tests.
 *
 * The conformance run uses `TauriIpcStub` so the suite executes under
 * jest without a Tauri runtime. The runtime-guard tests exercise the
 * `window.__TAURI__`-detection branch in the constructor — production
 * misuse (instantiating on the web path) must fail loud.
 *
 * The kernel jest preset runs in node, not jsdom, so `window` is
 * undefined unless we set it. Each runtime-guard test installs the
 * minimum window shape the Provider probes for, and removes it on
 * teardown so cross-suite tests don't see a stray fake.
 *
 * @see ../tauri-file-provider.ts
 * @see ./tauri-ipc-stub.ts
 */

import { runProviderConformance } from './conformance';
import { buildMockProviderDoc } from './mock-provider-doc';
import { TauriIpcStub } from './tauri-ipc-stub';
import { TauriFileProvider } from '../tauri-file-provider';

// =============================================================================
// Conformance suite — all 12 rows green via the in-memory IPC stub.
// =============================================================================

// Suite-scoped IPC stub. Two sessions in the same conformance row share
// it (rows 2 / 3 / 5 require "session1 writes, session2 reattaches and
// sees the bytes"); `resetStorage` swaps in a fresh stub between rows
// so no rows leak.
let ipc: TauriIpcStub = new TauriIpcStub();
let failingIpc: TauriIpcStub = new TauriIpcStub({ failFlushSync: () => true });

runProviderConformance({
  name: 'TauriFileProvider',
  factory: () => new TauriFileProvider('tauri-file-provider-conformance', { ipc }),
  buildProviderDoc: buildMockProviderDoc,
  resetStorage: () => {
    ipc = new TauriIpcStub();
    failingIpc = new TauriIpcStub({ failFlushSync: () => true });
  },
  factoryWithFailingFlushSync: () =>
    new TauriFileProvider('tauri-file-provider-conformance', { ipc: failingIpc }),
});

// =============================================================================
// the storage provider lifecycle — getCapabilities / getIdentity
// =============================================================================

describe('TauriFileProvider — the storage provider lifecycle methods', () => {
  it('getCapabilities returns correct flags', () => {
    const provider = new TauriFileProvider('caps-test', { ipc: new TauriIpcStub() });
    const caps = provider.getCapabilities();
    expect(caps.writable).toBe(true);
    expect(caps.durable).toBe(true);
    expect(caps.synchronousFlushStart).toBe(false);
    expect(caps.fullStateCheckpoint).toBe(true);
    expect(caps.incrementalUpdateLog).toBe(false);
    expect(caps.yrsStateVectorDiff).toBe(false);
    expect(caps.storageCursor).toBe(false);
    expect(caps.subscriptions).toBe(false);
    expect(caps.exclusiveWriteLock).toBe(false);
    expect(caps.readOnlyFallback).toBe(false);
    expect(caps.offlineOpen).toBe(true);
    expect(caps.reconnect).toBe(false);
    expect(caps.inboundUpdates).toBe(false);
    expect(caps.idempotentRemoteUpdates).toBe(false);
    expect(caps.binaryAssets).toBe(false);
    expect(caps.assetContentAddressing).toBe(false);
    expect(caps.assetGarbageCollection).toBe(false);
    expect(caps.assetAtomicCommit).toBe(false);
    expect(caps.atomicBatch).toBe(false);
  });

  it('getIdentity returns StorageProviderIdentity with correct fields', () => {
    const provider = new TauriFileProvider('id-test', { ipc: new TauriIpcStub() });
    const id = provider.getIdentity();
    expect(id.providerRefId).toBe('tauri:id-test');
    expect(id.storageScope).toEqual({
      kind: 'scoped',
      scope: {
        tenantId: { kind: 'single-tenant' },
        workspaceId: { kind: 'no-workspace' },
        documentId: 'id-test',
      },
    });
    expect(id.contractVersion).toBe('0.3.0');
    expect(id.providerProtocolVersion).toBe('0.1.0');
  });
});

// =============================================================================
// Runtime-guard tests — constructor must fail loud when used on web.
// =============================================================================

/**
 * Shape of the partial globalThis used by the runtime-guard tests. We
 * install / remove a fake `window.__TAURI__` to drive the constructor's
 * detection branch under the node-mode jest preset.
 */
type GlobalWithWindow = {
  window?: { __TAURI__?: { invoke: (...args: unknown[]) => Promise<unknown> } };
};

describe('TauriFileProvider — runtime guard', () => {
  const g = globalThis as GlobalWithWindow;
  // Capture whatever's on `globalThis.window` (likely undefined under node)
  // so we restore it after each test rather than leaving a fake fixture
  // that would confuse other suites.
  const originalWindow = g.window;

  afterEach(() => {
    if (originalWindow === undefined) {
      delete g.window;
    } else {
      g.window = originalWindow;
    }
  });

  it('throws on construction when no ipc is injected and __TAURI__ is undefined (web misuse)', () => {
    delete g.window;

    expect(() => new TauriFileProvider('any-doc')).toThrow(/not running in Tauri/i);
  });

  it('also throws when window exists but __TAURI__ is undefined (true web path)', () => {
    g.window = {}; // window without __TAURI__ — vanilla browser
    expect(() => new TauriFileProvider('any-doc')).toThrow(/not running in Tauri/i);
  });

  it('does NOT throw at construction when ipc is injected (test path)', () => {
    delete g.window;
    expect(() => new TauriFileProvider('any-doc', { ipc: new TauriIpcStub() })).not.toThrow();
  });

  it('does NOT throw at construction when __TAURI__ is present but no ipc — defers to attach()', () => {
    g.window = { __TAURI__: { invoke: () => Promise.resolve(undefined) } };
    expect(() => new TauriFileProvider('any-doc')).not.toThrow();
  });

  it('attach() throws "NOT YET WIRED" when constructed under Tauri without an injected ipc', async () => {
    g.window = { __TAURI__: { invoke: () => Promise.resolve(undefined) } };

    const provider = new TauriFileProvider('any-doc');
    const doc = buildMockProviderDoc('any-doc');
    await expect(provider.attach(doc)).rejects.toThrow(/NOT YET WIRED/i);
  });

  it('flushSync() in the not-yet-wired path sets flushFailed and does not throw', () => {
    g.window = { __TAURI__: { invoke: () => Promise.resolve(undefined) } };

    const provider = new TauriFileProvider('any-doc');
    // Push pending updates directly via the public surface — appendUpdate
    // never throws per contract, even on a not-yet-wired provider.
    provider.appendUpdate(new Uint8Array([1, 2, 3]));
    expect(() => provider.flushSync()).not.toThrow();
    expect(provider.flushFailed).toBe(true);
  });
});
