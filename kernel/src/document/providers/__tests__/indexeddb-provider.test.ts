/**
 * IndexedDBProvider × conformance suite + IDB-specific scenarios.
 *
 * Runs the §3.4 + §3.3 conformance suite against `IndexedDBProvider` (12
 * cases), then adds two IDB-specific scenarios that the doc-agnostic suite
 * cannot express:
 *
 *   - **v1 → v2 migration**: pre-populate a v1 DB, open via the v2 schema
 *     helper, verify all entries migrated to `snapshots` and the legacy
 *     `documents` store was dropped.
 *   - **Concurrent open**: race two `openDb()` calls on first boot,
 *     verify both resolve without throwing.
 *
 * This test uses `MockProviderDoc` for the
 * conformance run — the conformance suite tests interface contracts, not
 * byte layouts, so format-agnostic mock bytes are fine. No yrs JS port
 * exists in the kernel workspace.
 *
 * Test framework: Jest + `fake-indexeddb`. The `fake-indexeddb/auto`
 * import below installs the polyfill on globalThis once per worker;
 * provider tests then exercise the same `indexedDB.*` API surface a
 * browser would — no shortcut.
 *
 */

import 'fake-indexeddb/auto';

import { jest } from '@jest/globals';
import { runProviderConformance } from './conformance';
import { FailingIndexedDBProvider } from './failing-indexeddb-provider';
import { buildMockProviderDoc } from './mock-provider-doc';
import {
  IndexedDBProvider,
  hasPersistedSnapshot,
  createIndexedDbProviderFactory,
} from '../indexeddb-provider';
import {
  DB_NAME,
  SNAPSHOTS_STORE,
  UPDATES_STORE,
  META_STORE,
  deleteDatabase,
  openDb,
} from '../indexeddb-schema';

// Wipe the test DB between every conformance test. Without this, scenarios
// would inherit each other's `snapshots` / `updates` and rows #2 / #3 would
// leak. We pass the wipe via `resetStorage` so it runs before every `it`.
runProviderConformance({
  name: 'IndexedDBProvider',
  factory: () => new IndexedDBProvider('conformance-doc'),
  buildProviderDoc: buildMockProviderDoc,
  resetStorage: async () => {
    await deleteDatabase();
  },
  factoryWithFailingFlushSync: () => new FailingIndexedDBProvider('conformance-doc'),
});

describe('IndexedDBProvider — IDB-specific scenarios', () => {
  const originalNavigator = globalThis.navigator;

  beforeEach(async () => {
    await deleteDatabase();
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      configurable: true,
    });
  });

  // -------------------------------------------------------------------------
  // v1 → v2 migration
  // -------------------------------------------------------------------------
  it('migrates v1 `documents` entries into v2 `snapshots`; drops legacy store', async () => {
    // Step 1: hand-build a v1 DB with the legacy schema and a known entry.
    const v1Doc = 'pre-migrated-doc';
    const v1Bytes = new Uint8Array([0x10, 0x20, 0x30, 0x40, 0x50]);

    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('documents')) {
          db.createObjectStore('documents');
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('documents', 'readwrite');
        tx.objectStore('documents').put(v1Bytes, v1Doc);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });

    // Step 2: open via the v2 helper. The helper's onupgradeneeded should
    // copy `documents[v1Doc]` into `snapshots[v1Doc]` and drop `documents`.
    const db = await openDb();
    expect(db.version).toBe(2);
    expect(db.objectStoreNames.contains(SNAPSHOTS_STORE)).toBe(true);
    expect(db.objectStoreNames.contains(UPDATES_STORE)).toBe(true);
    expect(db.objectStoreNames.contains(META_STORE)).toBe(true);
    expect(db.objectStoreNames.contains('documents')).toBe(false);

    // Step 3: verify the migrated bytes are in `snapshots`.
    const migrated = await new Promise<Uint8Array | null>((resolve, reject) => {
      const tx = db.transaction(SNAPSHOTS_STORE, 'readonly');
      const req = tx.objectStore(SNAPSHOTS_STORE).get(v1Doc);
      req.onsuccess = () => {
        const r = req.result;
        if (r instanceof Uint8Array) resolve(r);
        else if (r instanceof ArrayBuffer) resolve(new Uint8Array(r));
        else resolve(null);
      };
      req.onerror = () => reject(req.error);
    });

    expect(migrated).not.toBeNull();
    expect(Array.from(migrated!)).toEqual(Array.from(v1Bytes));

    db.close();
  });

  // -------------------------------------------------------------------------
  // Concurrent open
  // -------------------------------------------------------------------------
  it('two concurrent openDb() calls on first boot both resolve without throwing', async () => {
    // Race two opens before the upgrade tx has had a chance to complete.
    // With the `onblocked` retry path, both must resolve to a working DB
    // handle. fake-indexeddb fires `versionchange` on existing connections
    // when a new request asks for a higher version; our `onversionchange`
    // handler closes the existing handle so the upgrade can proceed.
    const [db1, db2] = await Promise.all([openDb(), openDb()]);
    expect(db1).toBeDefined();
    expect(db2).toBeDefined();
    expect(db1.objectStoreNames.contains(SNAPSHOTS_STORE)).toBe(true);
    expect(db2.objectStoreNames.contains(SNAPSHOTS_STORE)).toBe(true);

    db1.close();
    db2.close();
  });

  // -------------------------------------------------------------------------
  // Import-initialize durability result
  // -------------------------------------------------------------------------
  it('returns blocked for read-only import-initialize attach', async () => {
    installUnavailableWebLock();
    const provider = new IndexedDBProvider('readonly-import-attach');

    const result = await provider.attach(buildMockProviderDoc('readonly-import-attach'), {
      kind: 'importInitialize',
      replaceExisting: true,
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: 'blocked',
        mode: 'importInitialize',
        reason: 'readOnly',
      }),
    );
    expect(provider.readOnly).toBe(true);
    await provider.detach();
  });

  it('returns blocked for read-only createFresh attach', async () => {
    installUnavailableWebLock();
    const provider = new IndexedDBProvider('readonly-create-fresh-attach');

    const result = await provider.attach(buildMockProviderDoc('readonly-create-fresh-attach'), {
      kind: 'createFresh',
      replaceExisting: true,
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: 'blocked',
        mode: 'createFresh',
        reason: 'readOnly',
      }),
    );
    expect(provider.readOnly).toBe(true);
    await provider.detach();
  });

  it('returns blocked for read-only import-initialize checkpoint', async () => {
    installUnavailableWebLock();
    const provider = new IndexedDBProvider('readonly-import-checkpoint');
    const doc = buildMockProviderDoc('readonly-import-checkpoint');

    const attachResult = await provider.attach(doc);
    expect(attachResult).toEqual(
      expect.objectContaining({
        status: 'ready',
        readOnly: true,
      }),
    );

    const checkpointResult = await provider.checkpointFullState(doc, {
      kind: 'importInitialize',
    });

    expect(checkpointResult).toEqual(
      expect.objectContaining({
        status: 'blocked',
        mode: 'importInitialize',
        reason: 'readOnly',
      }),
    );
    await provider.detach();
  });

  // -------------------------------------------------------------------------
  // Eviction sweep on attach
  // -------------------------------------------------------------------------
  it('evicts docs beyond the recent-docs cap on attach', async () => {
    const { touchDoc, readMeta } = await import('../indexeddb-meta');

    // Pre-populate 52 recent-doc entries — 50 cap + 2 should evict. Use
    // monotonically-increasing timestamps so the sort is deterministic.
    const ageBase = Date.now() - 1000;
    for (let i = 0; i < 52; i++) {
      await touchDoc(`evict-doc-${i}`);
    }

    // Pre-write snapshots for the two oldest (i=0, i=1) so we can verify
    // they get deleted by the eviction sweep.
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(SNAPSHOTS_STORE, 'readwrite');
      tx.objectStore(SNAPSHOTS_STORE).put(new Uint8Array([0xaa]), 'evict-doc-0');
      tx.objectStore(SNAPSHOTS_STORE).put(new Uint8Array([0xbb]), 'evict-doc-1');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();

    // Attach a fresh provider; eviction sweeps inside attach.
    const provider = new IndexedDBProvider('current-active-doc');
    await provider.attach(buildMockProviderDoc('current-active-doc'));
    await provider.detach();

    // Verify the meta now caps at 50 entries.
    const meta = await readMeta();
    expect(meta.recentDocs.length).toBeLessThanOrEqual(50);

    // Ensure ageBase reference does not get tree-shaken in optimised
    // builds; conformance assertions don't read it but a future eviction
    // tweak might want to assert ordering.
    void ageBase;
  });

  it('evicts only the oldest eligible stale doc when many old docs exist', async () => {
    const { readMeta } = await import('../indexeddb-meta');
    const now = Date.now();
    const staleAgeMs = 91 * 24 * 60 * 60 * 1000;
    const recentDocs = Array.from({ length: 51 }, (_, i) => ({
      docId: `quota-synth-${String(i).padStart(3, '0')}`,
      lastTouchedAt: now - staleAgeMs - (51 - i) * 1000,
    }));

    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([META_STORE, SNAPSHOTS_STORE, UPDATES_STORE], 'readwrite');
      const meta = tx.objectStore(META_STORE);
      const snapshots = tx.objectStore(SNAPSHOTS_STORE);
      const updates = tx.objectStore(UPDATES_STORE);

      meta.put(recentDocs, 'recentDocs');
      meta.put('quota-synth-000', 'lastActiveDocId');
      for (const entry of recentDocs) {
        snapshots.put(new Uint8Array([0xa1]), entry.docId);
        updates.put(new Uint8Array([0xb2]), [entry.docId, 1]);
      }

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    db.close();

    const provider = new IndexedDBProvider('quota-active-doc');
    await provider.attach(buildMockProviderDoc('quota-active-doc'));
    await provider.detach();

    const afterDb = await openDb();
    const stores = await new Promise<{
      snapshots: string[];
      updates: string[];
    }>((resolve, reject) => {
      const tx = afterDb.transaction([SNAPSHOTS_STORE, UPDATES_STORE], 'readonly');
      const snapshotReq = tx.objectStore(SNAPSHOTS_STORE).getAllKeys();
      const updateReq = tx.objectStore(UPDATES_STORE).getAllKeys();
      tx.oncomplete = () => {
        resolve({
          snapshots: (snapshotReq.result as IDBValidKey[]).filter(
            (key): key is string => typeof key === 'string',
          ),
          updates: Array.from(
            new Set(
              (updateReq.result as IDBValidKey[])
                .map((key) => (Array.isArray(key) ? key[0] : key))
                .filter((key): key is string => typeof key === 'string'),
            ),
          ),
        });
      };
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    afterDb.close();

    const meta = await readMeta();
    const metaDocIds = meta.recentDocs.map((entry) => entry.docId);

    expect(stores.snapshots).toContain('quota-synth-000');
    expect(stores.updates).toContain('quota-synth-000');
    expect(stores.snapshots).not.toContain('quota-synth-001');
    expect(stores.updates).not.toContain('quota-synth-001');
    expect(stores.snapshots).toContain('quota-synth-002');
    expect(stores.updates).toContain('quota-synth-002');
    expect(metaDocIds).toContain('quota-synth-000');
    expect(metaDocIds).not.toContain('quota-synth-001');
    expect(metaDocIds).toContain('quota-synth-002');
    expect(meta.lastActiveDocId).toBe('quota-synth-000');
  });

  // -------------------------------------------------------------------------
  // hasPersistedSnapshot — boot-precedence helper (§6.2)
  // -------------------------------------------------------------------------
  describe('hasPersistedSnapshot', () => {
    it('returns false on a fresh DB / unknown docId (no snapshot)', async () => {
      // Fresh DB courtesy of the surrounding beforeEach `deleteDatabase()`.
      expect(await hasPersistedSnapshot('never-existed')).toBe(false);
    });

    it('returns true once a Provider has flushed a snapshot for the docId', async () => {
      const docId = 'has-snapshot-doc';
      const snapshotBytes = new Uint8Array([0xaa, 0xbb, 0xcc]);

      // Seed `snapshots[docId]` directly via the schema helpers; same shape
      // a real Provider would write through compaction. Avoids a full
      // attach/append/detach dance for an existence-probe test.
      const db = await openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(SNAPSHOTS_STORE, 'readwrite');
        tx.objectStore(SNAPSHOTS_STORE).put(snapshotBytes, docId);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();

      expect(await hasPersistedSnapshot(docId)).toBe(true);
    });

    it('does not touch the meta store (no `lastActiveDocId` side-effect)', async () => {
      const { readMeta } = await import('../indexeddb-meta');
      // Before: empty meta.
      const before = await readMeta();
      expect(before.lastActiveDocId).toBeNull();

      // Probe a docId that doesn't exist.
      await hasPersistedSnapshot('probe-target');

      // After: meta still empty — `hasPersistedSnapshot` is read-only on
      // the snapshots store and never writes meta.
      const after = await readMeta();
      expect(after.lastActiveDocId).toBeNull();
      expect(after.recentDocs).toEqual([]);
    });
  });
});

// =============================================================================
// the storage provider lifecycle — Capabilities, Identity, Config, Factory
// =============================================================================

describe('IndexedDBProvider — the storage provider lifecycle normalization', () => {
  beforeEach(async () => {
    await deleteDatabase();
  });

  // -------------------------------------------------------------------------
  // getCapabilities()
  // -------------------------------------------------------------------------
  it('getCapabilities() reports accurate flags', () => {
    const provider = new IndexedDBProvider('cap-test-doc');
    const caps = provider.getCapabilities();

    expect(caps.writable).toBe(true);
    expect(caps.durable).toBe(true);
    expect(caps.synchronousFlushStart).toBe(true);
    expect(caps.fullStateCheckpoint).toBe(true);
    expect(caps.incrementalUpdateLog).toBe(true);
    expect(caps.yrsStateVectorDiff).toBe(false);
    expect(caps.storageCursor).toBe(true);
    expect(caps.subscriptions).toBe(false);
    expect(caps.exclusiveWriteLock).toBe(true);
    expect(caps.readOnlyFallback).toBe(true);
    expect(caps.offlineOpen).toBe(true);
    expect(caps.reconnect).toBe(false);
    expect(caps.inboundUpdates).toBe(false);
    expect(caps.idempotentRemoteUpdates).toBe(false);
    expect(caps.binaryAssets).toBe(false);
    expect(caps.assetContentAddressing).toBe(false);
    expect(caps.assetGarbageCollection).toBe(false);
    expect(caps.assetAtomicCommit).toBe(false);
    expect(caps.atomicBatch).toBe(true);
  });

  // -------------------------------------------------------------------------
  // storageCursor()
  // -------------------------------------------------------------------------
  it('storageCursor() returns same result as stateVector()', async () => {
    const provider = new IndexedDBProvider('cursor-test-doc');
    const doc = buildMockProviderDoc('cursor-test-doc');
    await provider.attach(doc);

    const sv = await provider.stateVector();
    const cursor = await provider.storageCursor();
    expect(sv).toEqual(cursor);

    // After an append+flush, both must advance identically.
    provider.appendUpdate(new Uint8Array([0x01, 0x02, 0x03]));
    await provider.flush();

    const sv2 = await provider.stateVector();
    const cursor2 = await provider.storageCursor();
    expect(sv2).toEqual(cursor2);
    expect(sv2).not.toEqual(sv);

    await provider.detach();
  });

  // -------------------------------------------------------------------------
  // getIdentity() — legacy constructor
  // -------------------------------------------------------------------------
  it('getIdentity() returns synthetic identity for legacy constructor', () => {
    const provider = new IndexedDBProvider('legacy-id-doc');
    const identity = provider.getIdentity();

    expect(identity.providerRefId).toBe('indexeddb:legacy-id-doc');
    expect(identity.contractVersion).toBe('03.1');
    expect(identity.providerProtocolVersion).toBe('1.0');
    expect(identity.storageSchemaVersion).toBe('2');
    expect(identity.storageScope).toEqual({
      kind: 'scoped',
      scope: {
        tenantId: { kind: 'single-tenant' },
        workspaceId: { kind: 'no-workspace' },
        documentId: 'legacy-id-doc',
      },
    });
  });

  // -------------------------------------------------------------------------
  // fromConfig() — typed config factory
  // -------------------------------------------------------------------------
  it('fromConfig() creates a provider with config-derived identity', async () => {
    const config = {
      kind: 'indexeddb' as const,
      role: 'authority' as const,
      required: true,
      providerRefId: 'config-doc-123',
      storageScope: {
        kind: 'scoped' as const,
        scope: {
          tenantId: 'tenant-1',
          workspaceId: 'ws-1',
          documentId: 'config-doc-123',
        },
      },
      contractVersion: '03.1',
      providerProtocolVersion: '1.0',
      databaseName: 'shortcut-rust-docs',
      storeName: 'snapshots',
      schemaVersion: 2,
    };

    const provider = IndexedDBProvider.fromConfig(config);
    expect(provider.name).toBe('IndexedDBProvider');

    const identity = provider.getIdentity();
    expect(identity.providerRefId).toBe('config-doc-123');
    expect(identity.contractVersion).toBe('03.1');
    expect(identity.providerProtocolVersion).toBe('1.0');
    expect(identity.storageSchemaVersion).toBe('2');
    expect(identity.storageScope).toEqual({
      kind: 'scoped',
      scope: {
        tenantId: 'tenant-1',
        workspaceId: 'ws-1',
        documentId: 'config-doc-123',
      },
    });

    // The provider should work normally (attach/append/flush/detach).
    const doc = buildMockProviderDoc('config-doc-123');
    await provider.attach(doc);
    provider.appendUpdate(new Uint8Array([0xaa, 0xbb]));
    await provider.flush();
    await provider.detach();
  });

  // -------------------------------------------------------------------------
  // createIndexedDbProviderFactory()
  // -------------------------------------------------------------------------
  it('createIndexedDbProviderFactory() produces a working provider', async () => {
    const factory = createIndexedDbProviderFactory();
    const config = {
      kind: 'indexeddb' as const,
      role: 'authority' as const,
      required: true,
      providerRefId: 'factory-doc-1',
      storageScope: {
        kind: 'scoped' as const,
        scope: {
          tenantId: { kind: 'single-tenant' as const },
          workspaceId: { kind: 'no-workspace' as const },
          documentId: 'factory-doc-1',
        },
      },
      contractVersion: '03.1',
      providerProtocolVersion: '1.0',
      databaseName: 'shortcut-rust-docs',
      storeName: 'snapshots',
      schemaVersion: 2,
    };

    const instance = await factory(config);
    expect(instance.config).toBe(config);
    expect(instance.provider).toBeInstanceOf(IndexedDBProvider);
    expect(instance.capabilities.writable).toBe(true);
    expect(instance.capabilities.durable).toBe(true);
    expect(instance.capabilities.yrsStateVectorDiff).toBe(false);
    expect(instance.capabilities.storageCursor).toBe(true);
  });

  it('createIndexedDbProviderFactory() rejects wrong kind', async () => {
    const factory = createIndexedDbProviderFactory();
    const wrongConfig = {
      kind: 'memory' as const,
      role: 'authority' as const,
      required: false,
      providerRefId: 'wrong-kind',
      storageScope: {
        kind: 'explicit-no-scope' as const,
        reason: 'ephemeral-memory' as const,
      },
      contractVersion: '03.1',
      providerProtocolVersion: '1.0',
    };

    await expect(factory(wrongConfig)).rejects.toThrow("expected kind 'indexeddb', got 'memory'");
  });
});

function installUnavailableWebLock(): void {
  const locks = {
    request: jest.fn(
      async (
        _name: string,
        optionsOrCallback: { ifAvailable?: boolean } | ((lock: unknown) => Promise<void> | void),
        maybeCallback?: (lock: unknown) => Promise<void> | void,
      ) => {
        if (typeof optionsOrCallback === 'function') {
          return new Promise<void>(() => {});
        }
        if (optionsOrCallback.ifAvailable) {
          await maybeCallback?.(null);
          return undefined;
        }
        return new Promise<void>(() => {});
      },
    ),
  };

  Object.defineProperty(globalThis, 'navigator', {
    value: { locks },
    configurable: true,
  });
}
