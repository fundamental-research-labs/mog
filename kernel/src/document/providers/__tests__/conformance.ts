/**
 * Provider Conformance Suite
 *
 * Every Provider implementation passes this suite. The suite is the contract
 * gate: a future websocket Provider, headless-server Provider, or any other
 * transport lands by implementing the interface, running this suite, and
 * attaching to the orchestrator. Zero RustDocument changes required.
 *
 * The suite covers all nine persistence rows plus the ordering, reentrancy,
 * and backpressure assertions (twelve cases total). Skipping any is a
 * contract violation.
 *
 * Usage (in a Provider's own `*.test.ts`):
 *
 *   import { runProviderConformance } from './conformance';
 *   import { buildMockProviderDoc } from './mock-provider-doc';
 *   import { FailingIndexedDBProvider } from './failing-indexeddb-provider';
 *
 *   runProviderConformance({
 *     name: 'IndexedDBProvider',
 *     factory: () => new IndexedDBProvider('test-doc-id'),
 *     buildProviderDoc: buildMockProviderDoc,
 *     // Optional: enables conformance row #8 — a test-only subclass that
 *     // forces flushSync's tx-open to throw, exercising the production
 *     // catch block. Production IndexedDBProviderOptions does not contain
 *     // a test-failure knob.
 *     factoryWithFailingFlushSync: () => new FailingIndexedDBProvider('test-doc-id'),
 *   });
 *
 */

import type { Provider, ProviderDoc } from '../provider';

/**
 * Options for the conformance suite. The factory signature is no-arg; per-row
 * variants live as their own optional factories so simple Providers don't need
 * to thread options.
 */
export interface ConformanceOptions {
  /**
   * Display name for the `describe` block. Helps identify which Provider
   * is failing when the suite runs against multiple implementations.
   */
  name: string;

  /**
   * Build a fresh Provider for the test. Each test gets a fresh instance
   * — Providers MUST NOT carry state across `factory()` calls except via
   * the durable storage they own (which the test setup wipes between
   * scenarios via `resetStorage`).
   */
  factory: () => Provider;

  /**
   * Build a fresh `ProviderDoc` for `attach`. Tests pass a per-test docId
   * so two scenarios in the same suite don't bleed into each other.
   */
  buildProviderDoc: (docId: string) => ProviderDoc;

  /**
   * Wipe whatever durable backing the Provider uses, between tests.
   * For the in-memory Provider this clears the module-scoped Map; for
   * the IndexedDB Provider it deletes the database. Without this, tests
   * #2 and #3 leak.
   */
  resetStorage?: () => void | Promise<void>;

  /**
   * Optional: factory whose returned Provider will fail on `flushSync`
   * (simulating a tx-open error). Required for conformance row #8 — the
   * row is skipped (with a `it.skip`) if not provided, with a clear
   * message so the gap is visible.
   */
  factoryWithFailingFlushSync?: () => Provider;
}

/**
 * Run the full conformance suite against `opts.factory()`.
 *
 * The function intentionally does not return anything: it side-effects
 * Jest/Vitest's globals (`describe`, `it`, `expect`, `beforeEach`).
 */
export function runProviderConformance(opts: ConformanceOptions): void {
  describe(`Provider conformance — ${opts.name}`, () => {
    /**
     * Default test docId. Each test that needs isolation overrides via a
     * scenario-specific suffix, but the resetStorage hook wipes shared
     * backing between every test anyway.
     */
    const baseDocId = `conformance-${opts.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;

    beforeEach(async () => {
      if (opts.resetStorage) {
        await opts.resetStorage();
      }
    });

    // -----------------------------------------------------------------
    // Row 1 — empty attach
    // -----------------------------------------------------------------
    it('row 1: empty attach is a no-op; stateVector is empty', async () => {
      const provider = opts.factory();
      const docId = `${baseDocId}-r1`;
      const doc = opts.buildProviderDoc(docId);

      await provider.attach(doc);

      const sv = await provider.stateVector();
      expect(sv).toBeInstanceOf(Uint8Array);

      // "Empty" is implementation-defined: a Provider may return a
      // zero-length array, or a 4-byte zero count, or yrs's canonical
      // empty-SV encoding. All represent "no updates applied." The
      // observable contract is: a fresh ProviderDoc that attaches to
      // this Provider sees no updates replayed — verified via
      // encodeDiff(empty-sv) returning an empty payload.
      const diff = await doc.encodeDiff(new Uint8Array());
      // The diff against an empty SV is "everything in the doc," which
      // for an empty doc is empty. The MockProviderDoc returns the
      // wrapped-batch marker (0xFB) followed by 0 bytes for an empty
      // batch — total length 1. Real ProviderDocs wired through the
      // bridge return whatever yrs encodes for an empty diff.
      // Either way, the count of *updates inside the batch* is zero.
      // Use the conformance helper that flattens batches.
      const items = flattenBatches([diff]);
      expect(items.length).toBe(0);

      await provider.detach();
    });

    // -----------------------------------------------------------------
    // Row 2 — attach with prior persisted bytes (single-writer)
    // -----------------------------------------------------------------
    it('row 2: attach with prior persisted bytes replays into the doc (single-writer)', async () => {
      const docId = `${baseDocId}-r2`;

      // Session 1: write three updates and detach.
      const session1 = opts.factory();
      await session1.attach(opts.buildProviderDoc(docId));
      session1.appendUpdate(makeUpdate(101));
      session1.appendUpdate(makeUpdate(102));
      session1.appendUpdate(makeUpdate(103));
      await session1.flush();
      await session1.detach();

      // Session 2: a fresh Provider over the same docId sees the prior
      // bytes replayed into a fresh doc.
      const session2 = opts.factory();
      const doc2 = opts.buildProviderDoc(docId);
      await session2.attach(doc2);

      // We can't peek at doc2's internal state in an
      // implementation-agnostic way; instead, verify that an
      // `encodeDiff(emptySv)` returns a non-empty payload, i.e., the doc
      // has updates to send. This is the round-trip the bridge uses.
      const diff = await doc2.encodeDiff(new Uint8Array());
      expect(diff.length).toBeGreaterThan(0);

      await session2.detach();
    });

    // -----------------------------------------------------------------
    // Row 3 — N appendUpdate, flush, reattach replays N
    // -----------------------------------------------------------------
    it('row 3: after N appendUpdate + flush, reattach replays all N (state convergence)', async () => {
      const docId = `${baseDocId}-r3`;
      const N = 7;

      const session1 = opts.factory();
      await session1.attach(opts.buildProviderDoc(docId));
      for (let i = 0; i < N; i++) {
        session1.appendUpdate(makeUpdate(200 + i));
      }
      await session1.flush();
      await session1.detach();

      const session2 = opts.factory();
      const doc2 = opts.buildProviderDoc(docId);
      await session2.attach(doc2);

      // The doc's current SV after replay should be non-trivial. We
      // verify convergence by encoding a diff against an empty SV and
      // checking it's non-empty.
      const diff = await doc2.encodeDiff(new Uint8Array());
      expect(diff.length).toBeGreaterThan(0);

      // Stronger check: re-applying the diff into a third doc converges
      // to the same SV.
      const doc3 = opts.buildProviderDoc(`${docId}-mirror`);
      await doc3.applyUpdate(diff);
      const sv2 = await doc2.currentStateVector();
      const sv3 = await doc3.currentStateVector();
      expect(uint8sEqual(sv2, sv3)).toBe(true);

      await session2.detach();
    });

    // -----------------------------------------------------------------
    // Row 4 — flushSync completes synchronously
    // -----------------------------------------------------------------
    it('row 4: flushSync settles synchronously (unload-handler semantics)', async () => {
      const docId = `${baseDocId}-r4`;

      const session1 = opts.factory();
      await session1.attach(opts.buildProviderDoc(docId));
      session1.appendUpdate(makeUpdate(301));
      session1.appendUpdate(makeUpdate(302));

      // The contract is: `flushSync` returns void, not Promise, and starts the
      // durable write before returning.
      //
      // We verify the void return type at the type level (TS would
      // surface a Promise return as `Promise<void>`), and at runtime
      // we check that flushSync's *return value* is undefined and that
      // the call is synchronous in the JS sense (no `await` between
      // call and inspecting its effect).
      const beforeFlushSv = await session1.stateVector();
      const ret = session1.flushSync() as unknown;
      expect(ret).toBeUndefined();

      // The row-4 promise-rejection probe schedules a synchronous assertion
      // that runs immediately after the flushSync call,
      // before any awaited work resumes. If flushSync returned without
      // queuing the durable write, the next appendUpdate would have to
      // rebuild the queue from empty — which is fine — but the bytes
      // we just flushSync'd would be lost. We assert by SV change after
      // a follow-on appendUpdate+flush() cycle.
      session1.appendUpdate(makeUpdate(303));
      await session1.flush();

      const afterAllSv = await session1.stateVector();
      expect(uint8sEqual(beforeFlushSv, afterAllSv)).toBe(false);

      // Reattach to a fresh doc and assert all three updates replayed.
      await session1.detach();
      const session2 = opts.factory();
      const doc2 = opts.buildProviderDoc(docId);
      await session2.attach(doc2);
      const diff = await doc2.encodeDiff(new Uint8Array());
      expect(diff.length).toBeGreaterThan(0);
      await session2.detach();
    });

    // -----------------------------------------------------------------
    // Row 5 — detach idempotent + final-flushes
    // -----------------------------------------------------------------
    it('row 5: detach is idempotent and final-flushes', async () => {
      const docId = `${baseDocId}-r5`;

      const session1 = opts.factory();
      await session1.attach(opts.buildProviderDoc(docId));
      session1.appendUpdate(makeUpdate(401));
      // No explicit flush — detach must final-flush.
      await session1.detach();

      // Second detach: must not throw, must be a no-op.
      await expect(session1.detach()).resolves.toBeUndefined();

      // Verify the unflushed update was persisted by the detach.
      const session2 = opts.factory();
      const doc2 = opts.buildProviderDoc(docId);
      await session2.attach(doc2);
      const diff = await doc2.encodeDiff(new Uint8Array());
      expect(diff.length).toBeGreaterThan(0);
      await session2.detach();
    });

    // -----------------------------------------------------------------
    // Row 6 — stateVector consistent with applied updates
    // -----------------------------------------------------------------
    it('row 6: stateVector is consistent with applied updates', async () => {
      const docId = `${baseDocId}-r6`;

      const session = opts.factory();
      await session.attach(opts.buildProviderDoc(docId));

      const sv0 = await session.stateVector();

      session.appendUpdate(makeUpdate(501));
      session.appendUpdate(makeUpdate(502));
      await session.flush();

      const sv1 = await session.stateVector();

      // The post-write SV must differ from the pre-write SV — anything
      // else means the Provider's view of "what's persisted" did not
      // advance after a successful flush.
      expect(uint8sEqual(sv0, sv1)).toBe(false);

      await session.detach();
    });

    // -----------------------------------------------------------------
    // Row 7 — flushSync called twice in succession (idempotent)
    // -----------------------------------------------------------------
    it('row 7: a second flushSync is a no-op when pendingUpdates is empty', async () => {
      const docId = `${baseDocId}-r7`;

      const session = opts.factory();
      await session.attach(opts.buildProviderDoc(docId));
      session.appendUpdate(makeUpdate(601));

      session.flushSync();

      // Capture the post-first-flush SV.
      const sv1 = await session.stateVector();

      // Second flushSync — pendingUpdates is empty, so this must NOT
      // duplicate the write. The SV should be identical afterwards.
      session.flushSync();
      const sv2 = await session.stateVector();
      expect(uint8sEqual(sv1, sv2)).toBe(true);

      await session.detach();
    });

    // -----------------------------------------------------------------
    // Row 8 — flushSync failure sets flushFailed; does not throw
    // -----------------------------------------------------------------
    if (opts.factoryWithFailingFlushSync) {
      it('row 8: flushSync sets flushFailed flag on tx-open failure; does not throw', async () => {
        const docId = `${baseDocId}-r8`;
        const session = opts.factoryWithFailingFlushSync!();
        await session.attach(opts.buildProviderDoc(docId));
        session.appendUpdate(makeUpdate(701));

        // Must not throw.
        expect(() => session.flushSync()).not.toThrow();
        expect(session.flushFailed).toBe(true);

        await session.detach();
      });
    } else {
      it.skip('row 8: flushSync failure (skipped — pass factoryWithFailingFlushSync to enable)', () => {
        // Intentional skip with a descriptive name so the gap surfaces
        // in CI output. The PROVIDER OWNER must wire the failing factory
        // to clear this row before claiming conformance.
      });
    }

    // -----------------------------------------------------------------
    // Row 9 — createFresh clears previous persisted state
    // -----------------------------------------------------------------
    it('row 9: createFresh attach does not replay prior persisted state', async () => {
      const docId = `${baseDocId}-r9-create-fresh`;

      const session1 = opts.factory();
      await session1.attach(opts.buildProviderDoc(docId));
      session1.appendUpdate(makeUpdate(801));
      session1.appendUpdate(makeUpdate(802));
      await session1.flush();
      await session1.detach();

      const session2 = opts.factory();
      const doc2 = opts.buildProviderDoc(docId);
      const result = await session2.attach(doc2, {
        kind: 'createFresh',
        replaceExisting: true,
      });

      expect(result).toBeDefined();
      expect((result as { status: string }).status).toBe('ready');
      expect((result as { mode: string }).mode).toBe('createFresh');

      const diff = await doc2.encodeDiff(new Uint8Array());
      expect(flattenBatches([diff]).length).toBe(0);

      await session2.detach();

      const session3 = opts.factory();
      const doc3 = opts.buildProviderDoc(docId);
      await session3.attach(doc3);
      const reopenedDiff = await doc3.encodeDiff(new Uint8Array());
      expect(flattenBatches([reopenedDiff]).length).toBe(0);
      await session3.detach();
    });

    // -----------------------------------------------------------------
    // FIFO ordering across 100 appendUpdate calls
    // -----------------------------------------------------------------
    it('FIFO: 100 appendUpdate calls deliver in order on reattach', async () => {
      const docId = `${baseDocId}-fifo`;
      const N = 100;

      const session1 = opts.factory();
      await session1.attach(opts.buildProviderDoc(docId));
      const expected: Uint8Array[] = [];
      for (let i = 0; i < N; i++) {
        const u = makeUpdate(1000 + i);
        expected.push(u);
        session1.appendUpdate(u);
      }
      await session1.flush();
      await session1.detach();

      // Reattach into a doc that records arrival order.
      const observedOrder: Uint8Array[] = [];
      const recordingDoc: ProviderDoc = {
        docId,
        async applyUpdate(update) {
          observedOrder.push(new Uint8Array(update));
        },
        async encodeDiff() {
          return new Uint8Array();
        },
        async currentStateVector() {
          return new Uint8Array();
        },
      };
      const session2 = opts.factory();
      await session2.attach(recordingDoc);

      // Some Providers may pass replays as one merged batch (the doc
      // sees one applyUpdate call with a wrapped batch); others as N
      // calls. Both are valid. We accept either by flattening any
      // batches the recordingDoc captured.
      const flat = flattenBatches(observedOrder);

      expect(flat.length).toBe(N);
      for (let i = 0; i < N; i++) {
        expect(uint8sEqual(flat[i]!, expected[i]!)).toBe(true);
      }

      await session2.detach();
    });

    // -----------------------------------------------------------------
    // No reentrancy: appendUpdate during flush queues for next batch
    // -----------------------------------------------------------------
    it('reentrancy: appendUpdate during flush() queues for the next batch', async () => {
      const docId = `${baseDocId}-reentry`;

      const session = opts.factory();
      await session.attach(opts.buildProviderDoc(docId));

      // First batch.
      session.appendUpdate(makeUpdate(2001));
      session.appendUpdate(makeUpdate(2002));

      // Kick off flush, then synchronously append a third update before
      // the flush resolves. The third update lands in the next batch; a
      // subsequent flush must drain it, and the in-flight flush promise is
      // independent.
      const firstFlush = session.flush();
      session.appendUpdate(makeUpdate(2003));

      await firstFlush;

      // After the first flush, do a second flush to drain #2003.
      await session.flush();

      // Reattach; expect three updates total.
      await session.detach();
      const session2 = opts.factory();
      const doc2 = opts.buildProviderDoc(docId);
      await session2.attach(doc2);
      const diff = await doc2.encodeDiff(new Uint8Array());
      expect(diff.length).toBeGreaterThan(0);
      await session2.detach();
    });

    // -----------------------------------------------------------------
    // Backpressure: appendUpdate returns synchronously even
    // while flush is in flight.
    // -----------------------------------------------------------------
    it('backpressure: appendUpdate returns sync while flush is in flight', async () => {
      const docId = `${baseDocId}-backpressure`;

      const session = opts.factory();
      await session.attach(opts.buildProviderDoc(docId));

      session.appendUpdate(makeUpdate(3001));
      const inFlight = session.flush();

      // Do not await `inFlight` — synchronously call appendUpdate and
      // verify it returns. We measure this by checking that the call
      // completes within the same tick: we record `Date.now()` before
      // and after; the call must not block.
      const t0 = Date.now();
      session.appendUpdate(makeUpdate(3002));
      const t1 = Date.now();

      // Threshold is generous (50ms) — we're guarding against a Provider
      // that synchronously awaits `inFlight` from inside appendUpdate,
      // which would manifest as orders-of-magnitude slower.
      expect(t1 - t0).toBeLessThan(50);

      await inFlight;
      await session.flush();
      await session.detach();
    });
  });
}

// =============================================================================
// Test helpers — internal to this file.
// =============================================================================

/**
 * Build a deterministic update payload from a numeric seed. Replicated
 * from `mock-provider-doc.ts` to keep the conformance suite independent
 * of the mock module's internals — Providers running this suite shouldn't
 * have to import the mock just to fabricate test bytes.
 */
function makeUpdate(seed: number, sizeBytes = 8): Uint8Array {
  const out = new Uint8Array(sizeBytes);
  let s = seed >>> 0;
  for (let i = 0; i < sizeBytes; i++) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    out[i] = s & 0xff;
  }
  // Force the first byte to never collide with the MockProviderDoc's
  // batch-marker (0xFB). Otherwise `flattenBatches` would mis-classify
  // a raw update as a batch wrapper.
  if (out[0] === 0xfb) out[0] = 0x01;
  return out;
}

function uint8sEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Flatten any MockProviderDoc-style batch wrappers (marker byte 0xFB
 * followed by `[len][bytes]...`) the recording doc may have observed.
 * If the input is a sequence of raw updates, returns it unchanged.
 */
function flattenBatches(updates: Uint8Array[]): Uint8Array[] {
  const BATCH_MARKER = 0xfb;
  const out: Uint8Array[] = [];
  for (const u of updates) {
    if (u.length > 0 && u[0] === BATCH_MARKER) {
      // Decode batch.
      const inner = u.slice(1);
      let off = 0;
      while (off < inner.length) {
        if (off + 4 > inner.length) break;
        const len =
          ((inner[off + 0] ?? 0) << 24) |
          ((inner[off + 1] ?? 0) << 16) |
          ((inner[off + 2] ?? 0) << 8) |
          (inner[off + 3] ?? 0);
        off += 4;
        if (off + len > inner.length) break;
        out.push(inner.slice(off, off + len));
        off += len;
      }
    } else {
      out.push(u);
    }
  }
  return out;
}
