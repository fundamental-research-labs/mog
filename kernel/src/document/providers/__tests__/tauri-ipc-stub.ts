/**
 * TauriIpcStub — in-memory emulation of the Tauri-side update sidecar.
 *
 * Used by `tauri-file-provider.test.ts` to run the §3.4 conformance
 * suite without spinning up a Tauri runtime. The stub mirrors the
 * shape of the five `tauri_*` IPC commands a future native sidecar implementation
 * will register on the Rust side:
 *
 *   loadUpdates(docId)        → tauri_load_updates
 *   appendUpdate(docId, u)    → tauri_append_update
 *   clearDocumentState(docId) → tauri_clear_document_state
 *   stateVector(docId)        → tauri_state_vector
 *   flushSync(docId, pending) → tauri_flush_sync
 *
 * Storage is a Map keyed by docId; entries persist across `Provider`
 * instances built from the same stub (so conformance row 2 and row 3
 * — "session 1 writes, session 2 reattaches and sees the bytes" —
 * exercise the same persistence model that real Tauri-fs would).
 *
 * @see ../tauri-file-provider.ts — the Provider that consumes this
 */

import type { TauriIpc } from '../tauri-file-provider';

/**
 * Hook surface for the conformance row 8 ("flushSync failure") variant.
 * Tests construct a stub with `failFlushSync: () => true` to simulate
 * a tx-open error; the stub's `flushSync` returns `{ failed: true }`
 * and leaves the persisted log untouched.
 */
export interface TauriIpcStubOptions {
  /**
   * If returns `true` on a `flushSync` call, the stub does not write
   * the pending batch and returns `{ failed: true }`. Mirrors the
   * `InMemoryProvider`'s `failFlushSync` knob — same conformance row.
   */
  failFlushSync?: () => boolean;
}

/**
 * Build a stub backed by a fresh in-memory store. Tests that want to
 * exercise cross-instance persistence (rows 2 and 3) construct one
 * stub and pass it to two `TauriFileProvider` instances; tests that
 * want isolation between rows pass `resetStorage` to the conformance
 * suite, which in turn rebuilds the stub between cases.
 */
export class TauriIpcStub implements TauriIpc {
  /** Per-docId append-only log of yrs `update_v1` byte streams. */
  private readonly storage: Map<string, Uint8Array[]> = new Map();

  private readonly failFlushSync: () => boolean;

  constructor(options: TauriIpcStubOptions = {}) {
    this.failFlushSync = options.failFlushSync ?? (() => false);
  }

  /**
   * Tauri-async semantics: returning a resolved Promise (instead of
   * a sync value) keeps the stub honest about the IPC's transport
   * model — real Tauri commands are always async. The Provider awaits;
   * tests don't see synchronous resolution leak through.
   */
  async loadUpdates(docId: string): Promise<Uint8Array[]> {
    const log = this.storage.get(docId) ?? [];
    // Defensive copies: the Provider may treat the returned bytes as
    // immutable. Real Tauri commands deserialize from JSON so this
    // copy is a no-op vs. wire transport — explicit here for clarity.
    return log.map((u) => new Uint8Array(u));
  }

  async appendUpdate(docId: string, update: Uint8Array): Promise<void> {
    const log = this.storage.get(docId) ?? [];
    log.push(new Uint8Array(update));
    this.storage.set(docId, log);
  }

  async clearDocumentState(docId: string): Promise<void> {
    this.storage.delete(docId);
  }

  /**
   * Current stub state vector: 4-byte big-endian count of stored
   * updates. Same encoding as `InMemoryProvider.stateVector` for
   * symmetry with the conformance suite's row-6 assertion ("post-
   * write SV differs from pre-write SV"). A real Tauri command
   * would compute via the engine's `encode_state_vector` (§3.1).
   */
  async stateVector(docId: string): Promise<Uint8Array> {
    const log = this.storage.get(docId) ?? [];
    const out = new Uint8Array(4);
    out[0] = (log.length >>> 24) & 0xff;
    out[1] = (log.length >>> 16) & 0xff;
    out[2] = (log.length >>> 8) & 0xff;
    out[3] = log.length & 0xff;
    return out;
  }

  /**
   * Sync-dispatch durable write. The contract is "queue the write
   * before returning"; for an in-memory Map "queue" == "write" so
   * we just push synchronously. `failFlushSync` short-circuits to
   * the `failed` path so conformance row 8 has a way to simulate
   * tx-open failure without touching the storage.
   */
  flushSync(docId: string, pending: Uint8Array[]): { failed: boolean } {
    if (this.failFlushSync()) {
      // Do not mutate storage — the caller's `pendingUpdates` is
      // restored by the Provider, matching the IDB tx-open-fail
      // semantics from §6.1.
      return { failed: true };
    }
    const log = this.storage.get(docId) ?? [];
    for (const u of pending) {
      log.push(new Uint8Array(u));
    }
    this.storage.set(docId, log);
    return { failed: false };
  }

  /**
   * Test helper: wipe all entries. Conformance harness calls this in
   * its `resetStorage` hook between rows so cross-row state doesn't
   * leak.
   */
  reset(): void {
    this.storage.clear();
  }
}
