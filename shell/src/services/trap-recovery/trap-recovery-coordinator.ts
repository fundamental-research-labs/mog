/**
 * TrapRecoveryCoordinator
 *
 * Coordinates recovery from a wasm32 trap across the document set.
 *
 * Lives at the shell layer above {@link DocumentManager} (the only layer
 * that owns the SET of open documents). On the first trap observed in
 * any document's ComputeCore:
 *
 *   1. Mark the trapping doc failed via TRAP → its lifecycle machine
 *      transitions to `error` with the TrapError as context error. The
 *      shell error UI surfaces a per-doc TrapError-specific message.
 *   2. Mark every other open doc failed too (collateral damage — they
 *      share the dead WASM instance). Same TRAP path; same error UI
 *      branch (the recovery flow brings them back to `ready` shortly).
 *   3. Tear down the dead WASM module via `resetWasmModule()`. The
 *      next `loadWasmModule()` call instantiates a fresh
 *      `WebAssembly.Instance` with fresh linear memory.
 *   4. For every doc OTHER than the trapping one, dispatch RECOVER.
 *      The lifecycle machine re-runs `creating → ready` against the
 *      fresh WASM instance; `attachProviders` replays the doc's
 *      IndexedDB-persisted state automatically.
 *   5. The trapping doc stays in `error` — we don't try to bring it
 *      back. Its bytes broke the engine; replaying them on the fresh
 *      WASM would just re-trap. The user sees a TrapError-specific
 *      message (size limit) and can pick a different file.
 *
 * One trap → one recovery per page lifecycle. If a SECOND trap fires
 * while or after recovery, the coordinator fails closed: every doc
 * stays in `error`, no further recovery attempt is made. The user
 * needs to reload. This is the §4 plan's "don't loop" constraint —
 * a document set that keeps trapping isn't recoverable in this tab.
 *
 */

import type { TrapError } from '@mog/transport';
import { resetWasmModule } from '@mog/transport';

import type { DocumentManager } from '../document/document-manager';

/**
 * Shell-private host contract attached by kernel-created document handles.
 *
 * Kept local to the coordinator so the shell does not import the broad kernel
 * friend barrel. The runtime type guard below keeps test doubles and future
 * non-WASM handles from being forced into this contract.
 */
interface HostDocumentTrapRecovery {
  onTrap(listener: (trap: TrapError) => void): () => void;
  sendTrap(trap: TrapError): void;
  recover(yrsState?: Uint8Array): Promise<void>;
}

function isHostDocumentTrapRecovery(
  value: Partial<HostDocumentTrapRecovery> | undefined,
): value is HostDocumentTrapRecovery {
  return (
    typeof value?.onTrap === 'function' &&
    typeof value.sendTrap === 'function' &&
    typeof value.recover === 'function'
  );
}

function getDocumentTrapRecovery(handle: object): HostDocumentTrapRecovery | null {
  const candidate = (handle as { readonly _trapRecovery?: Partial<HostDocumentTrapRecovery> })
    ._trapRecovery;
  return isHostDocumentTrapRecovery(candidate) ? candidate : null;
}

/**
 * Test seam. The default implementation imports `resetWasmModule` from
 * `@mog/transport` directly; tests override it to assert the call
 * happened without monkey-patching the global module loader.
 */
export interface TrapRecoveryCoordinatorOptions {
  /** Override `resetWasmModule()` for unit tests. */
  resetWasmModule?: () => void;
}

export class TrapRecoveryCoordinator {
  /**
   * Promise of the in-flight recovery, if one is currently running.
   * Used to coalesce concurrent recovery attempts: every ComputeCore on
   * the dead WASM may observe the trap on its own (e.g. each one's
   * security-event drain fires at the same tick), and each fires its
   * `onTrap` listener. We MUST NOT run the recovery flow twice.
   */
  private inFlight: Promise<void> | null = null;

  /**
   * `true` once a recovery has run. After this, further trap
   * notifications are logged-and-dropped. The user must reload the
   * tab to recover further. See class doc for rationale.
   */
  private exhausted = false;

  /**
   * Set of fileIds we've already attached an `onTrap` listener to.
   * Prevents re-attaching when the DocumentManager fires `subscribe`
   * for unrelated state changes (e.g. another doc finishes loading).
   *
   * Recovery itself swaps doc lifecycles in place (RECOVER reuses the
   * same DocumentLifecycleSystem instance — and hence same fileId);
   * we re-attach in {@link attachToReadyDocs} after recovery so the
   * fresh ComputeCore on the recovered bridge gets a listener too.
   */
  private attachedFileIds = new Set<string>();

  /**
   * Unsubscribe callbacks per attached doc, keyed by fileId. Called when
   * (a) the doc is disposed, (b) recovery resets per-bridge listeners,
   * or (c) the coordinator itself is disposed.
   */
  private unsubscribers = new Map<string, () => void>();

  private readonly _resetWasmModule: () => void;

  /** Cleanup for the DocumentManager subscription. */
  private readonly disposeSub: () => void;

  constructor(
    private readonly docMgr: DocumentManager,
    options: TrapRecoveryCoordinatorOptions = {},
  ) {
    this._resetWasmModule = options.resetWasmModule ?? resetWasmModule;
    // Sync with whatever docs already exist at construction time.
    this.attachToReadyDocs();
    // Future loads: the manager fires `subscribe` on every state
    // change. Re-scan to pick up newly loaded docs (cheap — just
    // iterates the currently-open file ids and skips already-attached).
    this.disposeSub = this.docMgr.subscribe(() => this.attachToReadyDocs());
  }

  /**
   * Stop listening to the DocumentManager and detach all `onTrap`
   * listeners. Idempotent. Called when the shell tears down (rare —
   * usually only on full reload).
   */
  dispose(): void {
    this.disposeSub();
    for (const unsub of this.unsubscribers.values()) {
      try {
        unsub();
      } catch {
        // Listener may already have fired; unsubscribe is a no-op.
      }
    }
    this.unsubscribers.clear();
    this.attachedFileIds.clear();
  }

  /**
   * Iterate every fileId in the manager and ensure we have an `onTrap`
   * listener wired to its handle. Idempotent across docs we've already
   * attached. Safe to call from a DocumentManager subscribe callback —
   * the inner loop is O(open-docs) and just skips known fileIds.
   */
  private attachToReadyDocs(): void {
    for (const fileId of this.docMgr.getOpenFileIds()) {
      if (this.attachedFileIds.has(fileId)) continue;
      const handle = this.docMgr.getDocument(fileId);
      if (!handle) continue;
      const trapRecovery = getDocumentTrapRecovery(handle);
      if (!trapRecovery) continue;
      this.attachOne(fileId, trapRecovery);
    }
  }

  private attachOne(fileId: string, trapRecovery: HostDocumentTrapRecovery): void {
    this.attachedFileIds.add(fileId);
    // `onTrap` fires synchronously if the bridge is already trapped
    // (e.g. the trap happened during create, before this listener was
    // attached). The recover() call below tolerates that — it coalesces
    // via `inFlight`.
    const unsub = trapRecovery.onTrap((trap) => {
      // Best-effort fire-and-forget; promise is awaited by `inFlight`
      // for siblings that observe the same trap on the next tick.
      void this.recover(fileId, trap).catch((err) => {
        console.error('[trap-recovery] unhandled error during recovery:', err);
      });
    });
    this.unsubscribers.set(fileId, unsub);
  }

  /**
   * Public entry point. The first call drives the full recovery flow;
   * concurrent calls await the same in-flight promise; calls after
   * exhaustion log and drop.
   */
  async recover(originatingFileId: string, trap: TrapError): Promise<void> {
    if (this.exhausted) {
      console.error(
        '[trap-recovery] additional trap observed after recovery already ran — ' +
          'refusing to loop. The user must reload the tab.',
        { originatingFileId, trap: trap.message },
      );
      return;
    }
    if (this.inFlight) {
      // Coalesce: every ComputeCore on the dead module may observe the
      // trap on its own tick (security-event drain, viewport pull,
      // queued mutations). They all funnel here and join the in-flight
      // promise instead of redoing the work.
      await this.inFlight;
      return;
    }

    // Race-guard: assign `this.inFlight` to a controlled Promise
    // synchronously, BEFORE `_recoverImpl` begins running. The naive
    // `this.inFlight = this._recoverImpl(...)` shape has a subtle bug —
    // `_recoverImpl` is `async`, so its body runs synchronously up to
    // the first `await` BEFORE the function returns the Promise that
    // gets assigned to `this.inFlight`. Inside that synchronous body
    // the loop calls `handle._trapRecovery.sendTrap(trap)` which fires
    // `core.markModuleTrapped` which drains every doc's onTrap
    // listeners — including this coordinator's. Re-entrant
    // `recover(...)` calls during that drain see `this.inFlight === null`
    // and start a second `_recoverImpl` cycle. The integration test
    // (which uses real ComputeCores wired through the production
    // listener machinery) caught this; the unit test missed it
    // because its fake `sendTrap` doesn't fan listeners.
    let resolveInFlight!: () => void;
    let rejectInFlight!: (err: unknown) => void;
    this.inFlight = new Promise<void>((resolve, reject) => {
      resolveInFlight = resolve;
      rejectInFlight = reject;
    });
    try {
      await this._recoverImpl(originatingFileId, trap);
      resolveInFlight();
    } catch (err) {
      rejectInFlight(err);
      throw err;
    } finally {
      this.inFlight = null;
    }
  }

  private async _recoverImpl(originatingFileId: string, trap: TrapError): Promise<void> {
    // Snapshot the doc set BEFORE we tear anything down. If the
    // DocumentManager is racing with this (e.g. user closes a tab
    // while we're recovering), we want to operate on the set as it
    // was at trap time.
    const fileIds = this.docMgr.getOpenFileIds();

    // Step 1 — mark every doc trapped. The originating one, AND every
    // sibling on the shared WASM (they're collateral damage). Their
    // ComputeCores already fail every call with ModuleTrappedError
    // because the auto-marker fired on the originating call — but the
    // lifecycle machines haven't transitioned yet. TRAP takes them to
    // `error` with the trap as context payload, AND we surface the
    // trap to DocumentManager.errors so `useDocument` re-renders the
    // failure UI (the lifecycle's internal error context isn't
    // visible to React without this bridge).
    for (const fileId of fileIds) {
      const handle = this.docMgr.getDocument(fileId);
      if (!handle) continue;
      const trapRecovery = getDocumentTrapRecovery(handle);
      try {
        trapRecovery?.sendTrap(trap);
      } catch (err) {
        console.error(`[trap-recovery] sendTrap(${fileId}) failed:`, err);
      }
      try {
        this.docMgr.setError(fileId, trap);
      } catch (err) {
        console.error(`[trap-recovery] setError(${fileId}) failed:`, err);
      }
    }

    // Step 2 — tear down the dead WASM singleton. The next
    // `loadWasmModule()` call (driven by `executeCreateEngine` during
    // the RECOVER replay below) instantiates fresh.
    try {
      this._resetWasmModule();
    } catch (err) {
      // resetWasmModule is just nulling two refs — should never throw.
      // Log and continue; the recover() calls below would only fail
      // anyway, and we've already marked every doc trapped so the user
      // sees a coherent error state.
      console.error('[trap-recovery] resetWasmModule failed:', err);
    }

    // Step 3 — replay every doc EXCEPT the originating one. The
    // originating doc's bytes broke the engine; replaying them would
    // just re-trap on the fresh instance. The user sees a TrapError-
    // specific UI for that file slot ("size limit"); other docs come
    // back online through the normal create chain on the fresh WASM.
    //
    // Per-sibling recovery failures don't take down others — each
    // sibling is awaited in parallel, and a rejection just leaves
    // that sibling in `error`. This is the right semantics for
    // "deloitte trapped, sales-margin shouldn't be punished for it,
    // and a third doc that ALSO can't replay shouldn't punish anyone".
    const recoveryTargets = fileIds.flatMap((fileId) => {
      if (fileId === originatingFileId) return [];
      const handle = this.docMgr.getDocument(fileId);
      if (!handle) return [];
      const trapRecovery = getDocumentTrapRecovery(handle);
      return trapRecovery ? [{ fileId, trapRecovery }] : [];
    });
    const settled = await Promise.allSettled(
      recoveryTargets.map(async ({ trapRecovery }) => {
        await trapRecovery.recover();
      }),
    );

    // Log per-sibling failures explicitly. Promise.allSettled hides
    // them otherwise, and "your second tab silently failed" is exactly
    // the failure mode we're trying to avoid. Successful siblings get
    // their DocumentManager error cleared so `useDocument` re-renders
    // with the (newly-recovered) handle.
    settled.forEach((result, idx) => {
      const fileId = recoveryTargets[idx]!.fileId;
      if (result.status === 'rejected') {
        console.error(`[trap-recovery] sibling ${fileId} failed to recover:`, result.reason);
      } else {
        try {
          this.docMgr.clearError(fileId);
        } catch (err) {
          console.error(`[trap-recovery] clearError(${fileId}) failed:`, err);
        }
      }
    });

    // Re-attach onTrap listeners for every doc whose bridge got
    // swapped. A new ComputeCore was constructed inside
    // `executeCreateEngine` on the fresh WASM; the listener wired in
    // `attachOne` was registered against the OLD core (which is now
    // GC-eligible). The unsubscribe map's `unsub()` from before is a
    // no-op (the OLD core's _trapListeners was drained on trap), so
    // we just re-attach.
    //
    // Note: the originating doc is NOT recovered, so its bridge is
    // still bound to nothing useful. We skip re-attaching it — the
    // doc is dead from the user's perspective.
    for (const { fileId } of recoveryTargets) {
      const handle = this.docMgr.getDocument(fileId);
      if (!handle) continue;
      const trapRecovery = getDocumentTrapRecovery(handle);
      if (!trapRecovery) continue;
      // Detach old listener (no-op if it already fired) and attach a
      // fresh one to the new core. The fileId stays the same, so we
      // need to bypass the `attachedFileIds` dedup check.
      const oldUnsub = this.unsubscribers.get(fileId);
      if (oldUnsub) {
        try {
          oldUnsub();
        } catch {
          /* already-fired listener */
        }
      }
      this.attachedFileIds.delete(fileId);
      this.attachOne(fileId, trapRecovery);
    }

    this.exhausted = true;
  }
}

/**
 * Factory that mirrors the create-* convention used by the rest of the
 * shell services layer (createDocumentManager, createProjectService,
 * etc.). Returns the coordinator instance directly — callers hold onto
 * it for the lifetime of the shell and call `dispose()` at shutdown.
 */
export function createTrapRecoveryCoordinator(
  documentManager: DocumentManager,
  options?: TrapRecoveryCoordinatorOptions,
): TrapRecoveryCoordinator {
  return new TrapRecoveryCoordinator(documentManager, options);
}
