/**
 * RustDocument orchestrator contract enforcement tests.
 *
 * The orchestrator's microtask FIFO queue is the spine of the Provider
 * The provider protocol gives every Provider FIFO ordering,
 * no batch interleaving (no reentrancy), and synchronous backpressure
 * absorption regardless of any Provider's `flush()` latency.
 *
 * These contracts are testable directly without a real ComputeBridge:
 * we inject a stub bridge that:
 *   - records the `subscribeUpdateV1` callback so tests can drive
 *     synthetic update_v1 emissions deterministically (no real engine,
 *     no microtask polling loop in compute-bridge.ts).
 *   - no-ops `createEngine`, `flushUndoCapture`, etc. — those round-trip
 *     to the real engine but their behavior is not under test here.
 *
 * Provider implementations each pass the conformance suite that asserts these
 * same guarantees from the *Provider* side. This suite is the
 * orchestrator-side mirror.
 *
 * Real ProviderDoc / Provider attaches are exercised end-to-end via the
 * `InMemoryProvider`'s conformance suite and the kernel-engine integration
 * tests; this file's job is the orchestrator-side contract.
 *
 * @see kernel/src/document/providers/__tests__/conformance.ts — Provider mirror
 */

import { jest } from '@jest/globals';
import { RustDocument } from '../rust-document';
import { InMemoryProvider } from '../providers/__tests__/in-memory-provider';
import type { Provider } from '../providers/provider';
import { WriteGate } from '../write-gate';

// ---------------------------------------------------------------------------
// Stub bridge — the minimal surface RustDocument calls during init + drain
// ---------------------------------------------------------------------------

/**
 * Captured callback from `subscribeUpdateV1`. Tests drive synthetic
 * update_v1 emissions through this — bypassing the real compute-bridge
 * polling loop, since the orchestrator's contract is what's under test
 * (compute-bridge's own dispatcher has its own tests).
 */
interface StubBridge {
  subscribeUpdateV1(cb: (u: Uint8Array) => void): { unsubscribe: () => void };
  createEngine(snapshot?: Record<string, unknown>): Promise<unknown>;
  createEngineFromYrsState(state: Uint8Array): Promise<unknown>;
  flushUndoCapture(): Promise<unknown>;
  syncApply(u: Uint8Array): Promise<unknown>;
  encodeDiff(sv: Uint8Array): Promise<Uint8Array>;
  currentStateVector(): Promise<Uint8Array>;
  flushPendingUpdateV1(): Promise<void>;
  /** test handle: emit one update_v1 synthetically through the captured cb */
  emit(update: Uint8Array): void;
  /** test handle: queue an update below RustDocument, like ComputeBridge's Rust buffer */
  queueBridgeUpdate(update: Uint8Array): void;
  /** test handle: how many subscribers are currently registered */
  subscriberCount(): number;
}

function makeStubBridge(opts?: { baselineUpdate?: Uint8Array }): StubBridge {
  const subscribers = new Set<(u: Uint8Array) => void>();
  const bridgePending: Uint8Array[] = [];
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
    syncApply: async () => ({ recalc: { changedCells: [] } }),
    encodeDiff: async () => opts?.baselineUpdate ?? new Uint8Array(),
    currentStateVector: async () => new Uint8Array(),
    flushPendingUpdateV1: async () => {
      const batch = bridgePending.splice(0);
      for (const update of batch) emit(update);
    },
    emit(update) {
      emit(update);
    },
    queueBridgeUpdate(update) {
      bridgePending.push(update);
    },
    subscriberCount() {
      return subscribers.size;
    },
  };
}

/**
 * Construct a RustDocument with a stub bridge. We cast through `unknown`
 * because the real `ComputeBridge` type carries a hundred unrelated
 * methods this suite doesn't exercise — a structurally-typed stub plus a
 * cast preserves type safety on the methods we actually call without
 * dragging in the whole type's surface.
 */
async function makeOrchestrator(opts?: {
  internal?: boolean;
  baselineUpdate?: Uint8Array;
  yrsState?: Uint8Array;
}): Promise<{ doc: RustDocument; bridge: StubBridge }> {
  const bridge = makeStubBridge({ baselineUpdate: opts?.baselineUpdate });
  const doc = new RustDocument({
    docId: 'rust-doc-orch-test',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    computeBridge: bridge as unknown as any,
    internal: opts?.internal ?? true, // skip touchDoc by default — IndexedDB isn't available in node
    skipPersistenceLoad: true,
    yrsState: opts?.yrsState,
  });
  await doc.ready;
  return { doc, bridge };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RustDocument orchestrator contract', () => {
  describe('lifecycle', () => {
    it('subscribes exactly once on init and unsubscribes on destroy', async () => {
      const { doc, bridge } = await makeOrchestrator();
      expect(bridge.subscriberCount()).toBe(1);
      await doc.destroy();
      expect(bridge.subscriberCount()).toBe(0);
    });

    it('exposes pendingUpdatesCount = 0 when idle', async () => {
      const { doc } = await makeOrchestrator();
      expect(doc.pendingUpdatesCount).toBe(0);
      await doc.destroy();
    });
  });

  describe('FIFO ordering', () => {
    it('two attached Providers see exactly the same sequence in the same order across 100 rapid-fire updates', async () => {
      const { doc, bridge } = await makeOrchestrator();

      // Two InMemoryProviders with isolated storage so neither bleeds
      // into the other (the conformance suite uses module-shared
      // storage; here we explicitly want side-by-side observation).
      const storageA = new Map<string, Uint8Array[]>();
      const storageB = new Map<string, Uint8Array[]>();
      const providerA = new InMemoryProvider('fifo-doc-a', { storage: storageA });
      const providerB = new InMemoryProvider('fifo-doc-b', { storage: storageB });

      await doc.attachProvider(providerA);
      await doc.attachProvider(providerB);

      // Seed 100 updates rapid-fire — all in the same tick. The
      // orchestrator's microtask coalescer must batch them into ONE
      // fan-out cycle that preserves insertion order.
      const N = 100;
      const expected: Uint8Array[] = [];
      for (let i = 0; i < N; i++) {
        const update = new Uint8Array([
          (i >>> 24) & 0xff,
          (i >>> 16) & 0xff,
          (i >>> 8) & 0xff,
          i & 0xff,
          // Make each update distinct beyond the seq prefix so the
          // InMemoryProvider doesn't accidentally dedupe by content.
          (i * 37) & 0xff,
        ]);
        expected.push(update);
        bridge.emit(update);
      }

      // After emit (sync), the queue is staged for a microtask drain.
      expect(doc.pendingUpdatesCount).toBe(N);

      // Yield so the microtask drains and Providers receive their
      // fan-outs. Then await each Provider's flush() so the in-memory
      // log is committed.
      await Promise.resolve();
      expect(doc.pendingUpdatesCount).toBe(0);

      await providerA.flush();
      await providerB.flush();

      const logA = storageA.get('fifo-doc-a') ?? [];
      const logB = storageB.get('fifo-doc-b') ?? [];

      expect(logA.length).toBe(N);
      expect(logB.length).toBe(N);

      // FIFO: each Provider's stored sequence must match `expected`
      // byte-for-byte, in the same order.
      for (let i = 0; i < N; i++) {
        expect(Array.from(logA[i]!)).toEqual(Array.from(expected[i]!));
        expect(Array.from(logB[i]!)).toEqual(Array.from(expected[i]!));
      }

      await doc.destroy();
    });

    it('advances the write-gate watermark once per fanned-out update', async () => {
      const { doc, bridge } = await makeOrchestrator();
      const writeGate = new WriteGate();
      (bridge as StubBridge & { writeGate: WriteGate }).writeGate = writeGate;
      const storageA = new Map<string, Uint8Array[]>();
      const storageB = new Map<string, Uint8Array[]>();
      const providerA = new InMemoryProvider('watermark-doc-a', { storage: storageA });
      const providerB = new InMemoryProvider('watermark-doc-b', { storage: storageB });
      await doc.attachProvider(providerA);
      await doc.attachProvider(providerB);

      bridge.emit(new Uint8Array([0x01]));
      bridge.emit(new Uint8Array([0x02]));
      await Promise.resolve();
      await providerA.flush();
      await providerB.flush();

      expect(writeGate.watermark).toBe(2);
      expect(storageA.get('watermark-doc-a')).toHaveLength(2);
      expect(storageB.get('watermark-doc-b')).toHaveLength(2);

      await doc.destroy();
    });

    it('preserves order across two separate microtask batches', async () => {
      const { doc, bridge } = await makeOrchestrator();
      const storage = new Map<string, Uint8Array[]>();
      const provider = new InMemoryProvider('fifo-batches', { storage });
      await doc.attachProvider(provider);

      // Batch 1: emit three updates synchronously (one microtask drain).
      bridge.emit(new Uint8Array([1]));
      bridge.emit(new Uint8Array([2]));
      bridge.emit(new Uint8Array([3]));
      await Promise.resolve();

      // Batch 2: emit three more after the first batch drained.
      bridge.emit(new Uint8Array([4]));
      bridge.emit(new Uint8Array([5]));
      bridge.emit(new Uint8Array([6]));
      await Promise.resolve();

      await provider.flush();

      const log = storage.get('fifo-batches') ?? [];
      expect(log.length).toBe(6);
      expect(log.map((u) => u[0])).toEqual([1, 2, 3, 4, 5, 6]);

      await doc.destroy();
    });
  });

  describe('No reentrancy', () => {
    it('a Provider whose appendUpdate triggers another emit lands the new update in the next batch', async () => {
      const { doc, bridge } = await makeOrchestrator();

      // Trace what each Provider observes per fan-out cycle. Cycle
      // boundaries are detected by the recipient: when its
      // appendUpdate fires, we tag the update with the *current*
      // batch counter the orchestrator is draining.
      const observedBatchTags: Array<{ tag: number; payload: number }> = [];
      let currentBatch = 0;

      // Reentrant Provider: when it sees update == 0xAA, it
      // synchronously emits a follow-on update through the bridge.
      // If the orchestrator's queue is correct, that follow-on lands
      // in batch N+1, NOT inside batch N's iteration.
      const reentrant: Provider = {
        name: 'ReentrantProvider',
        appendUpdate: (update) => {
          observedBatchTags.push({ tag: currentBatch, payload: update[0] ?? 0 });
          if (update[0] === 0xaa) {
            // Synchronously emit a new update during fan-out.
            bridge.emit(new Uint8Array([0xbb]));
          }
        },
        attach: async () => {},
        flush: async () => {},
        checkpointFullState: async () => {},
        flushSync: () => {},
        detach: async () => {},
        stateVector: async () => new Uint8Array(),
        flushFailed: false,
      };

      await doc.attachProvider(reentrant);

      // Emit two updates in the first tick: 0xAA (which reenters) + 0xCC.
      bridge.emit(new Uint8Array([0xaa]));
      bridge.emit(new Uint8Array([0xcc]));

      // Drain batch 1.
      currentBatch = 1;
      await Promise.resolve();

      // Drain batch 2 (the reentrant 0xBB landed here).
      currentBatch = 2;
      await Promise.resolve();

      // Three updates total observed; the reentrant 0xBB MUST be
      // tagged batch=2, not batch=1.
      expect(observedBatchTags.length).toBe(3);
      expect(observedBatchTags[0]).toEqual({ tag: 1, payload: 0xaa });
      expect(observedBatchTags[1]).toEqual({ tag: 1, payload: 0xcc });
      expect(observedBatchTags[2]).toEqual({ tag: 2, payload: 0xbb });

      await doc.destroy();
    });
  });

  describe('Backpressure', () => {
    it('appendUpdate returns synchronously and accumulates updates while a slow flush() is in flight', async () => {
      const { doc, bridge } = await makeOrchestrator();

      // Slow Provider: `flush()` takes a manually-controlled microtask
      // chain to settle. `appendUpdate` is sync (the contract); we
      // verify the orchestrator does not block on the in-flight flush.
      let releaseFlush: (() => void) | null = null;
      const flushBlocker = new Promise<void>((resolve) => {
        releaseFlush = resolve;
      });

      const observed: number[] = [];
      const slow: Provider = {
        name: 'SlowProvider',
        appendUpdate: (update) => {
          observed.push(update[0] ?? 0);
        },
        attach: async () => {},
        flush: async () => {
          await flushBlocker;
        },
        checkpointFullState: async () => {},
        flushSync: () => {},
        detach: async () => {},
        stateVector: async () => new Uint8Array(),
        flushFailed: false,
      };

      await doc.attachProvider(slow);

      // Start a flush() — we don't await it yet. While it's in
      // flight, emit more updates. The orchestrator's enqueue path
      // must be unaffected.
      const flushPromise = slow.flush();

      // Emit five more updates. Each `bridge.emit` call is sync; each
      // `enqueueUpdate` inside the orchestrator is sync. We measure
      // total wall-time around the emits to confirm no flush-await.
      const t0 = Date.now();
      for (let i = 1; i <= 5; i++) {
        bridge.emit(new Uint8Array([i]));
      }
      const t1 = Date.now();

      // 5 sync emits + sync enqueueUpdate must complete in < a few ms.
      // (Generous bound — CI noise tolerated; the contract is "no
      // await on flush"; if we were awaiting flushBlocker we'd hang.)
      expect(t1 - t0).toBeLessThan(50);

      // The fan-out happens on the next microtask; after that, all
      // five updates must have reached the slow Provider despite
      // flush() still being in flight.
      await Promise.resolve();
      expect(observed).toEqual([1, 2, 3, 4, 5]);

      // Now release the flush; flushPromise should settle.
      releaseFlush!();
      await flushPromise;

      await doc.destroy();
    });
  });

  describe('flushSync orchestration', () => {
    it('calls each Provider flushSync in registration order', async () => {
      const { doc } = await makeOrchestrator();
      const callOrder: string[] = [];

      const make = (name: string): Provider => ({
        name,
        appendUpdate: () => {},
        attach: async () => {},
        flush: async () => {},
        checkpointFullState: async () => {},
        flushSync: () => {
          callOrder.push(name);
        },
        detach: async () => {},
        stateVector: async () => new Uint8Array(),
        flushFailed: false,
      });

      const a = make('A');
      const b = make('B');
      const c = make('C');
      await doc.attachProvider(a);
      await doc.attachProvider(b);
      await doc.attachProvider(c);

      doc.flushSync();
      expect(callOrder).toEqual(['A', 'B', 'C']);

      await doc.destroy();
    });

    it('hasAppendActive latches on successful Provider attach', async () => {
      // Flush-failure handling means "the per-mutation incremental
      // write path is live for this doc." Originally the orchestrator
      // latched only on the FIRST `enqueueUpdate` fan-out, but that
      // misses the post-reload+hydrate case: hydration replays bytes
      // via `applyUpdate` (read-only — no `update_v1` callback fires),
      // so a doc reopened from IDB without a new mutation would report
      // `hasAppendActive=false` and `__dt.persistenceEnabled` would
      // stay false despite the path being fully wired.
      //
      // The right semantics — "writes WILL persist for this doc" — is
      // proven by a successful Provider attach: every subsequent
      // mutation fans through this Provider's `appendUpdate`. The flag
      // must be true immediately after attach, not gated on a live
      // mutation.
      const { doc, bridge } = await makeOrchestrator();
      const observed: Uint8Array[] = [];
      const provider: Provider = {
        name: 'Recorder',
        appendUpdate: (u) => {
          observed.push(u);
        },
        attach: async () => {},
        flush: async () => {},
        checkpointFullState: async () => {},
        flushSync: () => {},
        detach: async () => {},
        stateVector: async () => new Uint8Array(),
        flushFailed: false,
      };

      // Pre-attach: no Providers wired, the path isn't live yet.
      expect(doc.hasAppendActive).toBe(false);

      await doc.attachProvider(provider);
      // Post-attach: latched, even though no live update has fanned out.
      // This supports post-reload hydration: a hydrated doc with a Provider
      // attached IS able to accept future mutations.
      expect(doc.hasAppendActive).toBe(true);

      bridge.emit(new Uint8Array([1, 2, 3]));
      // Still true, of course. The microtask drain hasn't fired but
      // the flag was latched at attach time.
      expect(doc.hasAppendActive).toBe(true);

      // The drain itself still happens on the microtask — verify the
      // fan-out semantics (the flag's *latch* moved to attach, but the
      // drain timing is unchanged).
      await Promise.resolve();
      expect(observed).toHaveLength(1);
      expect(doc.hasAppendActive).toBe(true);

      // Latches: subsequent inactivity does NOT reset.
      expect(doc.hasAppendActive).toBe(true);

      await doc.destroy();
    });

    it('hasAppendActive stays false when the queue drains with no Providers attached', async () => {
      // The readiness condition is "a Provider observed a fanned-out update."
      // A drain with zero Providers retains the update for a future
      // Provider, but remains a no-op for the flag — otherwise headless
      // mode would falsely flip the harness gate before persistence is live.
      const { doc, bridge } = await makeOrchestrator();

      bridge.emit(new Uint8Array([7, 7]));
      await Promise.resolve();

      expect(doc.hasAppendActive).toBe(false);
      expect(doc.pendingUpdatesCount).toBe(1);

      await doc.destroy();
    });

    it('retains pre-provider updates and fans them out when a Provider attaches', async () => {
      const { doc, bridge } = await makeOrchestrator();
      const observed: number[] = [];
      const provider: Provider = {
        name: 'LateProvider',
        appendUpdate: (update) => {
          observed.push(update[0] ?? 0);
        },
        attach: async () => {},
        flush: async () => {},
        checkpointFullState: async () => {},
        flushSync: () => {},
        detach: async () => {},
        stateVector: async () => new Uint8Array(),
        flushFailed: false,
      };

      bridge.emit(new Uint8Array([11]));
      await Promise.resolve();
      expect(doc.pendingUpdatesCount).toBe(1);

      await doc.attachProvider(provider);

      expect(observed).toEqual([11]);
      expect(doc.pendingUpdatesCount).toBe(0);
      await doc.destroy();
    });

    it('persists the initial local Yrs baseline to a Provider before live updates', async () => {
      const { doc, bridge } = await makeOrchestrator({
        baselineUpdate: new Uint8Array([0xf0]),
      });
      const observed: number[] = [];
      const provider: Provider = {
        name: 'BaselineProvider',
        appendUpdate: (update) => {
          observed.push(update[0] ?? 0);
        },
        attach: async () => {},
        flush: async () => {},
        checkpointFullState: async () => {},
        flushSync: () => {},
        detach: async () => {},
        stateVector: async () => new Uint8Array(),
        flushFailed: false,
      };

      await doc.attachProvider(provider);
      bridge.emit(new Uint8Array([0x01]));
      await Promise.resolve();

      expect(observed).toEqual([0xf0, 0x01]);
      await doc.destroy();
    });

    it('import-initialize attach stages provider until snapshot checkpoint commits', async () => {
      const { doc, bridge } = await makeOrchestrator({
        baselineUpdate: new Uint8Array([0xf0]),
      });
      const observed: number[] = [];
      const attachModes: string[] = [];
      const checkpointModes: string[] = [];
      const provider: Provider = {
        name: 'ImportInitializeProvider',
        appendUpdate: (update) => {
          observed.push(update[0] ?? 0);
        },
        attach: async (_doc, mode) => {
          attachModes.push(mode?.kind ?? 'normal');
          return {
            status: 'ready',
            mode: mode?.kind ?? 'normal',
          };
        },
        flush: async () => {},
        checkpointFullState: async (_doc, mode) => {
          checkpointModes.push(mode?.kind ?? 'normal');
          return {
            status: 'committed',
            mode: mode?.kind ?? 'normal',
          };
        },
        flushSync: () => {},
        detach: async () => {},
        stateVector: async () => new Uint8Array(),
        flushFailed: false,
      };

      bridge.emit(new Uint8Array([0xee]));
      await Promise.resolve();
      expect(doc.pendingUpdatesCount).toBe(1);

      await doc.attachProvider(provider, {
        mode: { kind: 'importInitialize', replaceExisting: true },
        suppressInitialBaseline: true,
        suppressQueuedUpdates: true,
        suppressTouch: true,
      });

      expect(attachModes).toEqual(['importInitialize']);
      expect(doc.hasAppendActive).toBe(false);
      expect(observed).toEqual([]);
      expect(doc.pendingUpdatesCount).toBe(0);

      await doc.fullStateCheckpoint({ mode: { kind: 'importInitialize' } });
      expect(checkpointModes).toEqual(['importInitialize']);
      expect(doc.hasAppendActive).toBe(true);

      bridge.emit(new Uint8Array([0x01]));
      await Promise.resolve();
      expect(observed).toEqual([0x01]);
      await doc.destroy();
    });

    it('import full-state checkpoint uses snapshot-only provider mode', async () => {
      const { doc } = await makeOrchestrator();
      const checkpointModes: string[] = [];
      const provider: Provider = {
        name: 'ImportCheckpointProvider',
        appendUpdate: jest.fn(),
        attach: async (_doc, mode) => ({
          status: 'ready',
          mode: mode?.kind ?? 'normal',
        }),
        flush: async () => {},
        checkpointFullState: async (_doc, mode) => {
          checkpointModes.push(mode?.kind ?? 'normal');
          return {
            status: 'committed',
            mode: mode?.kind ?? 'normal',
          };
        },
        flushSync: () => {},
        detach: async () => {},
        stateVector: async () => new Uint8Array(),
        flushFailed: false,
      };

      await doc.attachProvider(provider, {
        mode: { kind: 'importInitialize', replaceExisting: true },
        suppressInitialBaseline: true,
        suppressQueuedUpdates: true,
        suppressTouch: true,
      });
      await doc.fullStateCheckpoint({ mode: { kind: 'importInitialize' } });

      expect(checkpointModes).toEqual(['importInitialize']);
      expect(provider.appendUpdate).not.toHaveBeenCalled();
      await doc.destroy();
    });

    it('import-initialize attach drains pre-staging bridge updates before promotion guard', async () => {
      const { doc, bridge } = await makeOrchestrator();
      const checkpointModes: string[] = [];
      const provider: Provider = {
        name: 'ImportPreStagingBridgeDrainProvider',
        appendUpdate: jest.fn(),
        attach: async (_doc, mode) => ({
          status: 'ready',
          mode: mode?.kind ?? 'normal',
        }),
        flush: async () => {},
        checkpointFullState: async (_doc, mode) => {
          checkpointModes.push(mode?.kind ?? 'normal');
          return {
            status: 'committed',
            mode: mode?.kind ?? 'normal',
          };
        },
        flushSync: () => {},
        detach: async () => {},
        stateVector: async () => new Uint8Array(),
        flushFailed: false,
      };

      bridge.queueBridgeUpdate(new Uint8Array([0xee]));

      await doc.attachProvider(provider, {
        mode: { kind: 'importInitialize', replaceExisting: true },
        suppressInitialBaseline: true,
        suppressQueuedUpdates: true,
        suppressTouch: true,
      });

      expect(doc.pendingUpdatesCount).toBe(0);
      await doc.fullStateCheckpoint({ mode: { kind: 'importInitialize' } });

      expect(checkpointModes).toEqual(['importInitialize']);
      expect(provider.appendUpdate).not.toHaveBeenCalled();
      await doc.destroy();
    });

    it('import-initialize hydration suppresses snapshot updates before provider promotion', async () => {
      const { doc, bridge } = await makeOrchestrator();
      const observed: number[] = [];
      const checkpointModes: string[] = [];
      const provider: Provider = {
        name: 'ImportHydrationProvider',
        appendUpdate: (update) => {
          observed.push(update[0] ?? 0);
        },
        attach: async (_doc, mode) => ({
          status: 'ready',
          mode: mode?.kind ?? 'normal',
        }),
        flush: async () => {},
        checkpointFullState: async (_doc, mode) => {
          checkpointModes.push(mode?.kind ?? 'normal');
          return {
            status: 'committed',
            mode: mode?.kind ?? 'normal',
          };
        },
        flushSync: () => {},
        detach: async () => {},
        stateVector: async () => new Uint8Array(),
        flushFailed: false,
      };

      await doc.attachProvider(provider, {
        mode: { kind: 'importInitialize', replaceExisting: true },
        suppressInitialBaseline: true,
        suppressQueuedUpdates: true,
        suppressTouch: true,
      });

      await doc.runImportInitializeHydration(async () => {
        bridge.queueBridgeUpdate(new Uint8Array([0xa1]));
      });

      expect(doc.pendingUpdatesCount).toBe(0);
      await doc.fullStateCheckpoint({ mode: { kind: 'importInitialize' } });

      expect(checkpointModes).toEqual(['importInitialize']);
      expect(observed).toEqual([]);
      expect(doc.hasAppendActive).toBe(true);

      bridge.emit(new Uint8Array([0x01]));
      await Promise.resolve();
      expect(observed).toEqual([0x01]);
      await doc.destroy();
    });

    it('import promotion absorbs first-contact live updates into the full-state snapshot', async () => {
      const { doc, bridge } = await makeOrchestrator();
      const writeGate = new WriteGate();
      (bridge as StubBridge & { writeGate: WriteGate }).writeGate = writeGate;
      const observed: number[] = [];
      const checkpointModes: string[] = [];
      const checkpointGateModes: string[] = [];
      const provider: Provider = {
        name: 'ImportPromotionProvider',
        appendUpdate: (update) => {
          observed.push(update[0] ?? 0);
        },
        attach: async (_doc, mode) => ({
          status: 'ready',
          mode: mode?.kind ?? 'normal',
        }),
        flush: async () => {},
        checkpointFullState: async (_doc, mode) => {
          checkpointGateModes.push(writeGate.mode);
          checkpointModes.push(mode?.kind ?? 'normal');
          return {
            status: 'committed',
            mode: mode?.kind ?? 'normal',
          };
        },
        flushSync: () => {},
        detach: async () => {},
        stateVector: async () => new Uint8Array(),
        flushFailed: false,
      };

      await doc.attachProvider(provider, {
        mode: { kind: 'importInitialize', replaceExisting: true },
        suppressInitialBaseline: true,
        suppressQueuedUpdates: true,
        suppressTouch: true,
      });
      bridge.emit(new Uint8Array([0x88]));
      await Promise.resolve();
      expect(doc.pendingUpdatesCount).toBe(1);

      await doc.fullStateCheckpoint({
        mode: { kind: 'importInitialize' },
        absorbStagedLiveUpdates: true,
      });

      expect(checkpointModes).toEqual(['importInitialize']);
      expect(checkpointGateModes).toEqual(['checkpointing']);
      expect(writeGate.mode).toBe('open');
      expect(doc.pendingUpdatesCount).toBe(0);
      expect(observed).toEqual([]);
      expect(doc.hasAppendActive).toBe(true);

      bridge.emit(new Uint8Array([0x01]));
      await Promise.resolve();
      expect(observed).toEqual([0x01]);
      await doc.destroy();
    });

    it('import-initialize hydration requires a staged provider', async () => {
      const { doc } = await makeOrchestrator();

      await expect(doc.runImportInitializeHydration(async () => {})).rejects.toThrow(
        /requires a staged import Provider/,
      );
      await doc.destroy();
    });

    it('import-initialize attach rejects read-only providers instead of promoting durability', async () => {
      const { doc } = await makeOrchestrator();
      let detached = false;
      const provider: Provider = {
        name: 'ReadOnlyImportProvider',
        appendUpdate: jest.fn(),
        attach: async (_doc, mode) => ({
          status: 'ready',
          mode: mode?.kind ?? 'normal',
          readOnly: true,
        }),
        flush: async () => {},
        checkpointFullState: async () => {
          throw new Error('checkpoint should not run');
        },
        flushSync: () => {},
        detach: async () => {
          detached = true;
        },
        stateVector: async () => new Uint8Array(),
        flushFailed: false,
        readOnly: true,
      };

      await expect(
        doc.attachProvider(provider, {
          mode: { kind: 'importInitialize', replaceExisting: true },
          suppressInitialBaseline: true,
          suppressQueuedUpdates: true,
          suppressTouch: true,
        }),
      ).rejects.toThrow(/read-only/);

      expect(detached).toBe(true);
      expect(doc.hasAppendActive).toBe(false);
      expect(doc._devtoolsProviders()).toHaveLength(0);
      await doc.destroy();
    });

    it('import checkpoint refuses to promote when live updates leaked during staging', async () => {
      const { doc, bridge } = await makeOrchestrator();
      const provider: Provider = {
        name: 'LeakedImportUpdateProvider',
        appendUpdate: jest.fn(),
        attach: async (_doc, mode) => ({
          status: 'ready',
          mode: mode?.kind ?? 'normal',
        }),
        flush: async () => {},
        checkpointFullState: async (_doc, mode) => ({
          status: 'committed',
          mode: mode?.kind ?? 'normal',
        }),
        flushSync: () => {},
        detach: async () => {},
        stateVector: async () => new Uint8Array(),
        flushFailed: false,
      };

      await doc.attachProvider(provider, {
        mode: { kind: 'importInitialize', replaceExisting: true },
        suppressInitialBaseline: true,
        suppressQueuedUpdates: true,
        suppressTouch: true,
      });
      bridge.emit(new Uint8Array([0x88]));
      await Promise.resolve();

      await expect(doc.fullStateCheckpoint({ mode: { kind: 'importInitialize' } })).rejects.toThrow(
        /live update queue is not empty/,
      );
      expect(doc.hasAppendActive).toBe(false);
      expect(doc._devtoolsProviders()).toHaveLength(0);
      await doc.destroy();
    });

    it('does not synthesize an initial baseline for createEngineFromYrsState', async () => {
      const { doc } = await makeOrchestrator({
        baselineUpdate: new Uint8Array([0xf0]),
        yrsState: new Uint8Array([1, 2, 3]),
      });
      const observed: number[] = [];
      const provider: Provider = {
        name: 'YrsStateProvider',
        appendUpdate: (update) => {
          observed.push(update[0] ?? 0);
        },
        attach: async () => {},
        flush: async () => {},
        checkpointFullState: async () => {},
        flushSync: () => {},
        detach: async () => {},
        stateVector: async () => new Uint8Array(),
        flushFailed: false,
      };

      await doc.attachProvider(provider);

      expect(observed).toEqual([]);
      await doc.destroy();
    });

    it('hasFlushFailed reflects any Provider flushFailed flag', async () => {
      const { doc } = await makeOrchestrator();

      let failingFlag = false;
      const failing: Provider = {
        name: 'Failing',
        appendUpdate: () => {},
        attach: async () => {},
        flush: async () => {},
        checkpointFullState: async () => {},
        flushSync: () => {
          failingFlag = true;
        },
        detach: async () => {},
        stateVector: async () => new Uint8Array(),
        get flushFailed() {
          return failingFlag;
        },
      };
      const ok: Provider = {
        name: 'Ok',
        appendUpdate: () => {},
        attach: async () => {},
        flush: async () => {},
        checkpointFullState: async () => {},
        flushSync: () => {},
        detach: async () => {},
        stateVector: async () => new Uint8Array(),
        flushFailed: false,
      };

      await doc.attachProvider(ok);
      await doc.attachProvider(failing);

      expect(doc.hasFlushFailed).toBe(false);
      doc.flushSync();
      expect(doc.hasFlushFailed).toBe(true);

      await doc.destroy();
    });

    it('continues fanning-out when one Provider flushSync throws (contract violation)', async () => {
      const { doc } = await makeOrchestrator();
      const calls: string[] = [];

      const throwing: Provider = {
        name: 'Throwing',
        appendUpdate: () => {},
        attach: async () => {},
        flush: async () => {},
        checkpointFullState: async () => {},
        flushSync: () => {
          calls.push('throwing');
          throw new Error('contract violation');
        },
        detach: async () => {},
        stateVector: async () => new Uint8Array(),
        flushFailed: false,
      };
      const after: Provider = {
        name: 'After',
        appendUpdate: () => {},
        attach: async () => {},
        flush: async () => {},
        checkpointFullState: async () => {},
        flushSync: () => {
          calls.push('after');
        },
        detach: async () => {},
        stateVector: async () => new Uint8Array(),
        flushFailed: false,
      };

      await doc.attachProvider(throwing);
      await doc.attachProvider(after);

      // Suppress console.error noise from the contract-violation log.
      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      try {
        doc.flushSync();
      } finally {
        errSpy.mockRestore();
      }

      expect(calls).toEqual(['throwing', 'after']);
      await doc.destroy();
    });

    it('drains queued orchestrator updates before Provider flushSync', async () => {
      const { doc, bridge } = await makeOrchestrator();
      const events: string[] = [];
      const provider: Provider = {
        name: 'FlushSyncDrainProbe',
        appendUpdate: (update) => {
          events.push(`append:${update[0] ?? 0}`);
        },
        attach: async () => {},
        flush: async () => {},
        checkpointFullState: async () => {},
        flushSync: () => {
          events.push('flushSync');
        },
        detach: async () => {},
        stateVector: async () => new Uint8Array(),
        flushFailed: false,
      };

      await doc.attachProvider(provider);
      bridge.emit(new Uint8Array([42]));

      doc.flushSync();

      expect(events).toEqual(['append:42', 'flushSync']);
      await doc.destroy();
    });
  });

  describe('checkpoint', () => {
    it('awaits flushUndoCapture and every Provider flush in parallel', async () => {
      const { doc, bridge } = await makeOrchestrator();
      const order: string[] = [];

      let undoResolve: (v: unknown) => void = () => {};
      bridge.flushUndoCapture = () => {
        order.push('undo:start');
        return new Promise((res) => {
          undoResolve = (v) => {
            order.push('undo:end');
            res(v);
          };
        });
      };

      const makeFlushTracking = (name: string): Provider => ({
        name,
        appendUpdate: () => {},
        attach: async () => {},
        flush: async () => {
          order.push(`${name}:flush:start`);
          await Promise.resolve();
          order.push(`${name}:flush:end`);
        },
        checkpointFullState: async () => {},
        flushSync: () => {},
        detach: async () => {},
        stateVector: async () => new Uint8Array(),
        flushFailed: false,
      });

      await doc.attachProvider(makeFlushTracking('A'));
      await doc.attachProvider(makeFlushTracking('B'));

      const checkpointPromise = doc.checkpoint();

      // checkpoint() awaits flushUndoCapture FIRST, before kicking off
      // Provider flushes. So at this point only undo:start is emitted.
      await Promise.resolve();
      await Promise.resolve();
      expect(order).toEqual(['undo:start']);

      // Release undo; both Provider flushes should now run in parallel.
      undoResolve(undefined);
      await checkpointPromise;

      // Order: undo:start, undo:end, A:flush:start, B:flush:start,
      // then both ends in parallel-resolution order. The exact
      // interleave between A and B is unspecified by the checkpoint contract; both
      // start before either ends, both end before checkpoint resolves.
      expect(order[0]).toBe('undo:start');
      expect(order[1]).toBe('undo:end');
      expect(order.slice(2).sort()).toEqual(
        ['A:flush:end', 'A:flush:start', 'B:flush:end', 'B:flush:start'].sort(),
      );

      await doc.destroy();
    });

    it('drains queued orchestrator updates before Provider flush', async () => {
      const { doc, bridge } = await makeOrchestrator();
      const events: string[] = [];
      const provider: Provider = {
        name: 'CheckpointDrainProbe',
        appendUpdate: (update) => {
          events.push(`append:${update[0] ?? 0}`);
        },
        attach: async () => {},
        flush: async () => {
          events.push('flush');
        },
        checkpointFullState: async () => {},
        flushSync: () => {},
        detach: async () => {},
        stateVector: async () => new Uint8Array(),
        flushFailed: false,
      };

      await doc.attachProvider(provider);
      bridge.emit(new Uint8Array([7]));

      await doc.checkpoint();

      expect(events).toEqual(['append:7', 'flush']);
      await doc.destroy();
    });

    it('drains bridge-level and queued orchestrator updates before full-state checkpoint', async () => {
      const { doc, bridge } = await makeOrchestrator();
      const events: string[] = [];
      const provider: Provider = {
        name: 'FullCheckpointDrainProbe',
        appendUpdate: (update) => {
          events.push(`append:${update[0] ?? 0}`);
        },
        attach: async () => {},
        flush: async () => {},
        checkpointFullState: async () => {
          events.push('checkpointFullState');
        },
        flushSync: () => {},
        detach: async () => {},
        stateVector: async () => new Uint8Array(),
        flushFailed: false,
      };

      await doc.attachProvider(provider);
      bridge.queueBridgeUpdate(new Uint8Array([9]));

      await doc.fullStateCheckpoint();

      expect(events).toEqual(['append:9', 'checkpointFullState']);
      await doc.destroy();
    });

    it('checkpoints attached Providers from an alternate materialized bridge state', async () => {
      const { doc, bridge } = await makeOrchestrator();
      const sourceBridge = makeStubBridge({ baselineUpdate: new Uint8Array([42]) });
      const storage = new Map<string, Uint8Array[]>();
      const provider = new InMemoryProvider('rust-doc-orch-test', { storage });

      await doc.attachProvider(provider);
      bridge.queueBridgeUpdate(new Uint8Array([9]));

      await doc.fullStateCheckpointFromBridge(
        sourceBridge as Parameters<RustDocument['fullStateCheckpointFromBridge']>[0],
      );

      const persisted = storage.get('rust-doc-orch-test') ?? [];
      expect(persisted).toHaveLength(1);
      expect([...persisted[0]!]).toEqual([42]);
      await doc.destroy();
    });

    it('does not fan Provider replay updates back out as live appends during attach', async () => {
      const { doc, bridge } = await makeOrchestrator();
      const events: string[] = [];
      const provider: Provider = {
        name: 'ReplaySuppressionProbe',
        appendUpdate: (update) => {
          events.push(`append:${update[0] ?? 0}`);
        },
        attach: async () => {
          bridge.queueBridgeUpdate(new Uint8Array([7]));
          await bridge.flushPendingUpdateV1();
        },
        flush: async () => {},
        checkpointFullState: async () => {},
        flushSync: () => {},
        detach: async () => {},
        stateVector: async () => new Uint8Array(),
        flushFailed: false,
      };

      await doc.attachProvider(provider);
      await Promise.resolve();

      expect(events).toEqual([]);
      await doc.destroy();
    });
  });

  describe('destroy', () => {
    it('detaches all attached Providers in parallel', async () => {
      const { doc } = await makeOrchestrator();
      const detachOrder: string[] = [];

      const make = (name: string): Provider => ({
        name,
        appendUpdate: () => {},
        attach: async () => {},
        flush: async () => {},
        checkpointFullState: async () => {},
        flushSync: () => {},
        detach: async () => {
          detachOrder.push(name);
        },
        stateVector: async () => new Uint8Array(),
        flushFailed: false,
      });

      const a = make('A');
      const b = make('B');
      await doc.attachProvider(a);
      await doc.attachProvider(b);
      await doc.destroy();

      // Both detached.
      expect(detachOrder.length).toBe(2);
      expect(detachOrder.sort()).toEqual(['A', 'B']);
    });

    it('is idempotent', async () => {
      const { doc } = await makeOrchestrator();
      await doc.destroy();
      await doc.destroy(); // must not throw
    });

    it('clears the pending update queue', async () => {
      const { doc, bridge } = await makeOrchestrator();
      // Emit without attaching any Provider so updates accumulate in
      // the orchestrator queue (well — actually they drain into an
      // empty providers array on the next microtask; after the
      // microtask the queue is empty regardless).
      bridge.emit(new Uint8Array([1]));
      bridge.emit(new Uint8Array([2]));
      expect(doc.pendingUpdatesCount).toBe(2);
      await doc.destroy();
      expect(doc.pendingUpdatesCount).toBe(0);
    });

    it('drains queued orchestrator updates before Provider detach', async () => {
      const { doc, bridge } = await makeOrchestrator();
      const events: string[] = [];
      const provider: Provider = {
        name: 'DestroyDrainProbe',
        appendUpdate: (update) => {
          events.push(`append:${update[0] ?? 0}`);
        },
        attach: async () => {},
        flush: async () => {},
        checkpointFullState: async () => {},
        flushSync: () => {},
        detach: async () => {
          events.push('detach');
        },
        stateVector: async () => new Uint8Array(),
        flushFailed: false,
      };

      await doc.attachProvider(provider);
      bridge.emit(new Uint8Array([3]));
      await doc.destroy();

      expect(events).toEqual(['append:3', 'detach']);
    });
  });

  describe('detachProvider', () => {
    it('removes the Provider from the fan-out set and final-flushes via detach', async () => {
      const { doc, bridge } = await makeOrchestrator();
      const storage = new Map<string, Uint8Array[]>();
      const provider = new InMemoryProvider('detach-doc', { storage });

      await doc.attachProvider(provider);

      bridge.emit(new Uint8Array([1]));
      await Promise.resolve();
      await doc.detachProvider(provider);

      // After detach, further emits do NOT reach this Provider.
      bridge.emit(new Uint8Array([2]));
      await Promise.resolve();

      const log = storage.get('detach-doc') ?? [];
      expect(log.length).toBe(1);
      expect(log[0]![0]).toBe(1);

      await doc.destroy();
    });

    it('is a no-op for a Provider that was never attached', async () => {
      const { doc } = await makeOrchestrator();
      const provider = new InMemoryProvider('not-attached', {
        storage: new Map(),
      });
      // Should resolve without error.
      await doc.detachProvider(provider);
      await doc.destroy();
    });
  });
});
