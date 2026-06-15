/**
 * ComputeCore — Hand-written infrastructure for the compute bridge.
 *
 * Contains all real logic that generated passthrough methods call into:
 * - Lifecycle management (create/start/destroy, phase guards)
 * - Mutation pipeline (mutate/query)
 * - Viewport management (binary viewport buffer, prefetch, per-viewport state)
 * - Event subscriptions and handlers
 * - Schema sync to Rust
 * - Undo/redo
 * - Sync protocol (state vector, diff, apply)
 * - Error recovery (fullRecalc)
 *
 * ComputeCore owns generated bridge delegation.
 * ComputeBridge delegates generated methods to this class.
 */

import type { BridgeTransport } from '@rust-bridge/client';
import { TrapError, resetWasmModule } from '@mog/transport';
import { asFormulaA1 } from '@mog/spreadsheet-utils/cells/formula-string';
import type { SchemaChangedEvent } from '@mog-sdk/contracts/events';
import type { IKernelContext, ISpreadsheetKernelContext } from '@mog-sdk/contracts/kernel';
import type { ColumnSchema } from '@mog-sdk/contracts/schema';
import { type SheetId, sheetId as toSheetId } from '@mog-sdk/contracts/core';
import * as Schemas from '../../domain/schemas/schemas';

import { BridgeError } from '../../errors/bridge';
import type { WriteGate } from '../../document/write-gate';
import { ModuleTrappedError } from './errors';
import { MutationResultHandler } from '../mutation-result-handler';
import type { CellAccessor } from '../wire/binary-viewport-buffer';
import type { ReadonlyBinaryViewportBuffer } from '../wire/viewport-coordinator';
import type { CellMetadataCache } from '../wire/cell-metadata-cache';
import type { RangeMetadataCache } from '../wire/range-metadata-cache';
import { ViewportCoordinatorRegistry } from '../wire/viewport-coordinator-registry';
import {
  normalizeViewportBounds,
  type ViewportPrefetchState,
  type ViewportScrollBehavior,
} from '../wire/viewport-prefetch';

import { ViewportFetchManager } from './viewport-fetch-manager';
import { refreshViewportForCfSiblings } from './cf-sibling-refresh';
import {
  admitPublicMutation as admitPublicMutationForCore,
  type DirectEditPosition,
  type MutationTuple,
  runSystemMutation,
} from './mutation-admission';

import type {
  ColumnSchemaWire,
  SchemaConstraintsWire,
  SchemaMapEntryWire,
  StructureChange,
  TypedActiveCellData,
  WorkbookSnapshot,
} from './compute-wire-types';

import type {
  CellChange,
  CfChange,
  MutationResult,
  RecalcResult,
  RecalcValidationAnnotation,
  RecalcValidationError,
  SheetSettingsChange,
  UndoState,
} from './compute-types.gen';

// ---------------------------------------------------------------------------
// MutationResult data extraction helper
// ---------------------------------------------------------------------------

/**
 * Extract typed data from a MutationResult's `data` field.
 *
 * Rust mutation methods now return domain objects (e.g. Comment, FilterState,
 * PivotTableConfig) serialized into `MutationResult.data` via `with_data()`.
 * This helper provides typed extraction for callers that need the domain object.
 *
 * @returns The data cast to T, or undefined if data is null/undefined.
 */
export function extractMutationData<T>(result: MutationResult): T | undefined {
  if (result.data === undefined || result.data === null) return undefined;
  return result.data as T;
}

function isShowFormulasChange(change: SheetSettingsChange): boolean {
  return change.changedKey === 'showFormulas';
}

function historyReplayNeedsFullViewportRefresh(result: MutationResult): boolean {
  return Boolean(
    result.dimensionChanges?.length ||
    result.mergeChanges?.length ||
    result.visibilityChanges?.length ||
    result.commentChanges?.length ||
    result.filterChanges?.length ||
    result.tableChanges?.length ||
    result.slicerChanges?.length ||
    result.sheetChanges?.length ||
    result.settingsChanges?.length ||
    result.pageBreakChanges?.length ||
    result.printAreaChanges?.length ||
    result.printTitlesChanges?.length ||
    result.printSettingsChanges?.length ||
    result.splitConfigChanges?.length ||
    result.scrollPositionChanges?.length ||
    result.viewSelectionChanges?.length ||
    result.workbookSettingsChanges?.length ||
    result.cfChanges?.length ||
    result.namedRangeChanges?.length ||
    result.groupingChanges?.length ||
    result.sparklineChanges?.length ||
    result.sortingChanges?.length ||
    result.structureChanges?.length ||
    result.floatingObjectChanges?.length ||
    result.floatingObjectGroupChanges?.length ||
    result.pivotChanges?.length ||
    result.rangeChanges?.length,
  );
}

// ---------------------------------------------------------------------------
// Active instance registry — prevents stale compute_destroy from killing
// a newer instance that was initialized with the same docId.
//
// The WASM registry keys instances by docId. When two ComputeCore instances
// share a docId (e.g., duplicate mounts, rapid remount before async dispose
// completes), the second compute_init silently replaces the first in the
// registry. If the first instance's destroy then runs, it removes the
// *second* instance, causing "instance not found" errors.
//
// This map tracks the latest ComputeCore per docId. destroy() skips the
// Rust compute_destroy call when it detects it has been superseded.
// ---------------------------------------------------------------------------
const activeInstancePerDocId = new Map<string, ComputeCore>();

// ---------------------------------------------------------------------------
// InitPhase type
// ---------------------------------------------------------------------------

export type InitPhase =
  | 'CREATED'
  | 'HYDRATED'
  | 'CONTEXT_SET'
  | 'STARTED'
  | 'DESTROYING'
  | 'DISPOSED';

// ---------------------------------------------------------------------------
// ComputeCore class
// ---------------------------------------------------------------------------

/**
 * ComputeCore contains all real logic for the compute bridge.
 *
 * Public members are accessed by generated passthrough methods:
 * - `docId` — document identifier for Rust IPC calls
 * - `transport` — the BridgeTransport for Rust IPC calls
 * - `mutatePublic()` — public write admission + unified mutation pipeline
 * - `mutateSystem()` — lifecycle/system write admission + unified mutation pipeline
 * - `mutate()` — low-level unified mutation pipeline once admission has run
 * - `query()` — query pipeline (read methods)
 * - `ensureInitialized()` — phase guard for STARTED phase
 * - `invalidateAllViewportPrefetch()` — invalidate all per-viewport prefetch
 */
export class ComputeCore {
  /** Document ID for Rust engine instance. PUBLIC — generated methods need it. */
  readonly docId: string;

  /** Kernel context — provides eventBus and domain services. */
  private ctx: IKernelContext;

  /** Bridge transport for direct RPC calls. PUBLIC — generated bridge methods use this. */
  private readonly _transport: BridgeTransport;

  /**
   * Guarded transport accessor. Every call through the generated bridge methods
   * (`this.core.transport.call(...)`) goes through this getter, which checks
   * whether the bridge has been disposed or the underlying WASM module has
   * trapped. Without these guards, post-disposal calls hit the raw (now-
   * invalid) transport and crash the process with an uncaught `_TransportError`
   * instead of a catchable `BRIDGE_DISPOSED`; post-trap calls re-fire the
   * original trap and drown the recovery flow in noise from the security-
   * event drain (1Hz polling), the viewport-pull manager, and queued
   * mutations. Trap recovery must avoid repeatedly executing against a trapped WASM instance.
   *
   * DESTROYING/DISPOSED takes precedence over MODULE_TRAPPED. Disposal is the
   * more-fundamental terminal state; a disposed core that's also trapped
   * should still report itself as disposed, because no recovery can resurrect
   * it.
   */
  get transport(): BridgeTransport {
    if (this.isDestroyingOrDisposed()) {
      // Return a transport stub that throws synchronously on `.call()`
      // so that every generated bridge method gets a clean, catchable error.
      return {
        call: (command: string) => {
          throw new BridgeError(
            'BRIDGE_DISPOSED',
            command,
            `[ComputeCore] Bridge is disposed. Cannot call '${command}'.`,
          );
        },
      };
    }
    if (this._moduleTrapped !== null) {
      const trap = this._moduleTrapped;
      // Short-circuit subsequent calls so the security-event drain,
      // viewport-pull manager, and queued mutations fast-fail with a
      // clear "module trapped" signal rather than re-firing the original
      // trap. The recovery coordinator tears this ComputeCore down and replays
      // from yrs state on a fresh WASM instance.
      return {
        call: (command: string) => {
          throw new ModuleTrappedError(command, trap);
        },
      };
    }
    return this._transport;
  }

  private _phase: InitPhase = 'CREATED';
  /**
   * Set non-null when this ComputeCore observes a WASM trap. The trap
   * value is the originating `TrapError` from the transport boundary.
   * Set by `markModuleTrapped()` (called either by the auto-marking
   * transport wrapper installed in the constructor, or by the shell-level
   * recovery coordinator marking sibling docs whose shared WASM died).
   */
  private _moduleTrapped: TrapError | null = null;
  /**
   * Listeners registered via `onTrap()`. Drained (and cleared) the first
   * time `markModuleTrapped()` fires so a listener that calls `onTrap()`
   * during dispatch doesn't re-observe the same event.
   *
   * Late-registered listeners (registered after the trap already fired)
   * fire synchronously inside `onTrap()` itself — they never land in this
   * array.
   */
  private _trapListeners: Array<(trap: TrapError) => void> = [];
  private cleanups: Array<() => void> = [];
  private schemaVersion = 0;

  /**
   * Per-document write gate. When installed by the lifecycle system,
   * `mutateCore()` checks this gate before executing every mutation.
   * System operations use `writeGate.runBypassScope()` to bypass the
   * gate during provider replay, import hydration, etc.
   *
   * Null until the lifecycle system installs it via `setWriteGate()`.
   * When null, all mutations are allowed (pre-lifecycle compatibility).
   */
  private _writeGate: WriteGate | null = null;

  /** Whether createEngine() has been called (Rust engine exists). */
  private engineCreated = false;
  /** The most recent RecalcResult from init or hydration, applied during start(). */
  private initResult: RecalcResult | null = null;

  /**
   * Resolves when the bridge reaches STARTED phase.
   * @see DocumentLifecycleSystem.waitForReady() for application-level ready signal
   */
  readonly ready: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (err: Error) => void;

  /** MutationResultHandler for processing Rust IPC mutation results. */
  private mutationHandler: MutationResultHandler | null = null;

  /**
   * Hook installed by `ComputeBridge` so the Provider Protocol can
   * drain Rust's update_v1 buffer immediately after every mutation.
   * Called at the end of `mutateCore()` — every mutation path (forward,
   * undo, redo, syncApply) triggers a drain, eliminating the need for
   * a polling loop.
   */
  private afterMutationHook: (() => Promise<void>) | null = null;

  /** Coordinator registry — single owner of per-viewport state. */
  private coordinatorRegistry: ViewportCoordinatorRegistry;

  /** Cached render scheduler — injected into newly registered coordinator buffers. */
  private _renderScheduler: import('@mog/canvas-engine').RenderScheduler | null = null;

  // ---------------------------------------------------------------------------
  // Per-Viewport Data Fetch — delegated to ViewportFetchManager
  // ---------------------------------------------------------------------------

  /** Owns the viewport movement pipeline (scroll, resize, sheet switch). */
  private fetchManager: ViewportFetchManager | null = null;
  private destroyPromise: Promise<void> | null = null;

  // ---------------------------------------------------------------------------
  // Active Cell Cache
  // ---------------------------------------------------------------------------

  private _activeCellData: TypedActiveCellData | null = null;
  private cellMetadataCache: CellMetadataCache | null = null;
  private rangeMetadataCache: RangeMetadataCache | null = null;

  // ---------------------------------------------------------------------------
  // CF Sibling Refresh Cache
  // ---------------------------------------------------------------------------

  /**
   * Tracks which sheets have CF rules defined.
   * Reserved for future optimization — currently unused because the
   * refreshViewportForCfSiblings method unconditionally refreshes.
   * Keyed by sheetId string (UUID). Value: true = sheet has ≥1 CF rule.
   */
  private readonly sheetsWithCfRules = new Map<string, boolean>();

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  /**
   * @param ctx - Initial context. In document-factory, this is a DeferredContext proxy
   *   that throws if accessed before setContext() wires the real DocumentContext.
   *   createEngine() and syncApply() do not access ctx, so DeferredContext is safe
   *   for the CREATED and HYDRATED phases.
   * @param docId - The document ID for the Rust engine instance.
   * @param transport - The bridge transport for direct RPC calls.
   */
  constructor(ctx: IKernelContext, docId: string, transport: BridgeTransport) {
    this.ctx = ctx;
    this.docId = docId;

    // Wrap the supplied transport so any TrapError surfaced by the WASM
    // boundary (`infra/transport/src/wasm-transport.ts`) auto-marks this
    // ComputeCore as trapped before propagating. The `transport` getter
    // then short-circuits subsequent calls via `ModuleTrappedError` so
    // the security-event drain, viewport-pull manager, and queued
    // mutations don't re-fire the original trap. Single integration
    // point — every `_transport.call(...)` in this class (and in
    // ViewportFetchManager, which receives the same wrapped instance
    // below) goes through this wrapper.
    //
    // We deliberately wrap inline rather than introducing a transport
    // middleware (recon report §H): the trap-aware behavior couples to
    // ComputeCore state (`markModuleTrapped`), and a middleware would
    // either leak that state outward or duplicate it.
    const wrappedTransport: BridgeTransport = {
      call: async <T = unknown>(command: string, args: Record<string, unknown>): Promise<T> => {
        try {
          return await transport.call<T>(command, args);
        } catch (err) {
          if (err instanceof TrapError) {
            this.markModuleTrapped(err);
          }
          throw err;
        }
      },
    };

    this._transport = wrappedTransport;
    this.coordinatorRegistry = new ViewportCoordinatorRegistry();
    this.fetchManager = new ViewportFetchManager(
      wrappedTransport,
      docId,
      this.coordinatorRegistry,
      (sheetId) =>
        (this.ctx as ISpreadsheetKernelContext).mirror.getViewOptions(toSheetId(sheetId))
          .showFormulas,
    );

    // Hydration backfill.
    //
    // When `Provider.attach()` replays persisted bytes via
    // `bridge-provider-doc.applyUpdate → syncApply → mutate → mutateCore →
    // applyMultiViewportPatches`, the patches arrive BEFORE the renderer
    // has mounted any coordinators. The registry drops them on the floor
    // (no coordinator registered) but flags `_hydrationDeficit`. When the
    // renderer eventually mounts and a coordinator registers, the registry
    // fires this handler — which forces a full Rust-side viewport re-read
    // for every (now-registered) coordinator. The new coordinators land
    // with engine state, not stale empty buffers.
    //
    // The same hydration-deficit shape covers IndexedDB Provider replay,
    // websocket Provider replay, headless-server seeded boot, and XLSX import
    // before renderer mount. All paths advance the engine before the renderer
    // holds a coordinator; this handler is the shared recovery.
    this.coordinatorRegistry.setOnHydrationDeficit(() => {
      // forceRefreshAllViewports iterates currently-registered coordinators
      // and re-fetches via `compute_get_viewport_binary`. If the renderer
      // hasn't mounted yet (no coordinators registered), the fetchManager's
      // `forceRefreshAllViewports` is a no-op — but in that case the
      // deficit flag is still armed, so the NEXT register call will retry.
      void this.fetchManager?.forceRefreshAllViewports().catch((err) => {
        console.warn('[ComputeCore] hydration-deficit force-refresh failed (non-fatal):', err);
      });
    });
    this.ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    // Defensive no-op .catch: if `markModuleTrapped()` (or `start()`'s
    // catch) rejects `ready` before any caller has awaited it, Node logs
    // an "unhandled rejection" warning. That's noise — ready's rejection
    // is the documented signal that the bridge failed to come up. The
    // real awaiter (DocumentLifecycleSystem.waitForReady, etc.) will
    // attach its own catch and surface the error properly. This catch
    // just acknowledges the rejection so the runtime doesn't whine.
    this.ready.catch(() => {});
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Current initialization phase.
   * @see InitPhase for phase descriptions and allowed operations.
   */
  get phase(): InitPhase {
    return this._phase;
  }

  setAfterMutationHook(hook: (() => Promise<void>) | null): void {
    this.afterMutationHook = hook;
  }

  /**
   * Install a write gate on this ComputeCore.
   * Called by the lifecycle system during the `installingWriteGate` phase.
   * Once installed, every `mutateCore()` call checks the gate before
   * proceeding with the mutation.
   */
  setWriteGate(gate: WriteGate): void {
    this._writeGate = gate;
  }

  /**
   * The installed write gate, or null if not yet installed.
   * Exposed so the lifecycle system / RustDocument can access it for
   * bypass scopes during provider replay and import hydration.
   */
  get writeGate(): WriteGate | null {
    return this._writeGate;
  }

  /**
   * Public-write admission. This is the only place public Rust mutations may
   * wait for deferred XLSX hydration. The post-barrier writable check matters:
   * closing/checkpointing/read-only state can arrive while hydration is running.
   */
  async admitPublicMutation(operation: string): Promise<void> {
    await admitPublicMutationForCore(
      this.ctx,
      this._writeGate,
      () => this.ensureInitialized(),
      operation,
    );
  }

  // ===========================================================================
  // Module-Trap Observability
  // ===========================================================================

  /**
   * `true` once this ComputeCore has observed a WASM trap (either via
   * its own transport wrapper auto-marking on `TrapError`, or via the
   * shell-level recovery coordinator marking it because a sibling doc
   * trapped the shared WASM instance).
   *
   * The shell-level recovery coordinator polls trapped ComputeCores, tears them
   * down, resets the WASM module, and replays each healthy doc from its yrs
   * state on the fresh instance.
   *
   */
  get isModuleTrapped(): boolean {
    return this._moduleTrapped !== null;
  }

  /**
   * The originating `TrapError` if this ComputeCore is trapped, else `null`.
   * The trap carries the failing command name and the V8 / SpiderMonkey
   * trap-message string for diagnostics.
   */
  get trapError(): TrapError | null {
    return this._moduleTrapped;
  }

  /**
   * Mark this ComputeCore as observing a WASM trap.
   *
   * Called automatically by the transport wrapper (constructor) when a
   * `TrapError` propagates out of `_transport.call(...)`. Also callable
   * directly by the shell-level recovery coordinator when a sibling doc
   * trapped the shared WASM instance (every per-doc ComputeCore on that
   * shared instance is dead — they need to know).
   *
   * Idempotent — calling twice with the same trap is a no-op. Calling
   * with a different trap retains the first one (the originating trap
   * is the most actionable; a stray sibling trap that arrives later
   * just confirms the module is still dead).
   *
   * After this call:
   * - `isModuleTrapped` returns `true`.
   * - The `transport` getter returns a stub that throws
   *   `ModuleTrappedError` on every `.call(...)`.
   * - The `ready` promise (if still pending) rejects with the trap so
   *   awaiters fail fast instead of hanging until disposal.
   * - The recovery coordinator at the shell level observes the trap and
   *   begins the rebuild flow.
   *
   * Does NOT transition `_phase` to DISPOSED — disposal is a separate
   * lifecycle event that the recovery coordinator triggers explicitly
   * after deciding what to do with this doc (replay vs. mark failed).
   */
  markModuleTrapped(trap: TrapError): void {
    if (this._moduleTrapped !== null) {
      // Idempotent: first trap wins. Don't replace; don't re-reject the
      // ready promise (it was already settled on the first call).
      return;
    }
    this._moduleTrapped = trap;
    // Reject ready if still pending so callers awaiting startup don't hang.
    // start() also catches and rejects from its own try/catch — if start()
    // already resolved or rejected, the second settle is a no-op (Promise
    // semantics). If we trap before start() ever runs, this reject is the
    // only one the awaiter sees.
    this.rejectReady(trap);

    // Reset the global WASM-loader singleton so any subsequent
    // `createComputeBridge()` (e.g. the next doc the user loads, or the
    // coordinator's per-doc replay flow) instantiates a *fresh*
    // WebAssembly.Instance instead of getting handed back the dead one
    // from this trapped session.
    //
    // **Why this layer.** The wasm is global state. ComputeCore is the
    // first layer that observes the trap (via the auto-marking transport
    // wrapper installed in the constructor). Bouncing the reset up to
    // the shell-level recovery coordinator and back down crosses two
    // layers without adding correctness — and ALSO leaves a window where
    // a sibling doc might attempt a call against the dead wasm before
    // the coordinator's async recovery kicks in. The reset is idempotent
    // and cheap; calling it here keeps it co-located with the detection
    // and avoids that window.
    //
    // **Why not in the auto-marking transport wrapper.** The wrapper
    // calls `markModuleTrapped(trap)`, so doing the reset here covers
    // both auto-mark and coordinator-driven `markModuleTrapped(trap)`
    // paths from a single place.
    //
    // Per-doc lifecycle handling (mark trapping doc failed, replay
    // healthy siblings) still belongs to the shell-level
    // TrapRecoveryCoordinator — its `onTrap` listeners fire below.
    resetWasmModule();

    // Fire trap listeners. Drain the array first so a listener that calls
    // `onTrap()` during dispatch doesn't see itself fire twice (and to
    // make this method idempotent — the second `markModuleTrapped` would
    // re-fire an empty list anyway, but that's belt-and-suspenders).
    const listeners = this._trapListeners.slice();
    this._trapListeners.length = 0;
    for (const listener of listeners) {
      try {
        listener(trap);
      } catch (err) {
        // A throwing listener must not break siblings or back-propagate
        // into the transport wrapper (which already auto-marked us).
        // The recovery coordinator is the consumer here — its own logging
        // surfaces the failure if needed.
        console.error('[ComputeCore] onTrap listener threw:', err);
      }
    }
  }

  /**
   * Register a callback fired exactly once when this ComputeCore observes
   * a WASM trap. The shell-level recovery coordinator uses this to react: mark
   * the trapping doc failed, reset the WASM module, and replay sibling docs.
   *
   * If the core is already trapped at registration time, the callback is
   * called synchronously with the existing trap so late-registered
   * listeners don't deadlock waiting for an event that already happened.
   *
   * Returns an unsubscribe function. Calling unsubscribe BEFORE the trap
   * fires removes the listener. After the trap fires the listener array
   * has already been drained, so the unsubscribe function is a no-op.
   *
   * A listener that throws is logged and swallowed — the trap state in
   * this ComputeCore is the source of truth, and a buggy coordinator
   * shouldn't poison sibling listeners.
   */
  onTrap(listener: (trap: TrapError) => void): () => void {
    if (this._moduleTrapped !== null) {
      // Already trapped — fire synchronously so the recovery coordinator
      // doesn't deadlock waiting for an event that has already happened.
      // Return a no-op unsubscribe: the listener has already fired and
      // there's nothing to remove.
      try {
        listener(this._moduleTrapped);
      } catch (err) {
        console.error('[ComputeCore] late onTrap listener threw:', err);
      }
      return () => {};
    }
    this._trapListeners.push(listener);
    return () => {
      const idx = this._trapListeners.indexOf(listener);
      if (idx >= 0) this._trapListeners.splice(idx, 1);
    };
  }

  /**
   * Update the store context reference and transition to CONTEXT_SET phase.
   *
   * Transitions: CREATED|HYDRATED → CONTEXT_SET
   */
  setContext(ctx: IKernelContext): void {
    this.ctx = ctx;
    if (this._phase === 'CREATED' || this._phase === 'HYDRATED') {
      this._phase = 'CONTEXT_SET';
    }
  }

  /**
   * Create the Rust compute engine.
   *
   * Must be called before syncApply() or start(). Can be called in CREATED phase
   * (before context exists) since it does not require DocumentContext.
   *
   * @param snapshot - Optional WorkbookSnapshot to initialize from. If omitted,
   *   creates an empty engine. For collaboration, pass the snapshot derived from
   *   the coordinator's Yrs state (via `yrs_state_to_snapshot_json` NAPI function)
   *   so the engine shares the same CellIds as the authoritative document.
   * @returns The initial RecalcResult
   */
  async createEngine(snapshot?: Record<string, unknown>): Promise<RecalcResult> {
    if (this.engineCreated) {
      throw new BridgeError(
        'BRIDGE_ALREADY_STARTED',
        'createEngine',
        '[ComputeCore] Engine already created',
      );
    }
    const initSnapshot = snapshot ?? { sheets: [], named_ranges: [], tables: [] };
    this.initResult = await this.transport.call<RecalcResult>('compute_init', {
      docId: this.docId,
      snapshot: initSnapshot,
    });
    this.engineCreated = true;
    activeInstancePerDocId.set(this.docId, this);
    return this.initResult;
  }

  /**
   * Create the Rust compute engine from raw Yrs state bytes.
   *
   * Used for collaboration: subsequent participants fork from the coordinator's
   * authoritative Yrs state to share CellIds and history.
   *
   * Must be called before syncApply() or start(). Can be called in CREATED phase
   * (before context exists) since it does not require DocumentContext.
   *
   * @param yrsState - Raw Yrs document state bytes from the authoritative source.
   * @returns The initial RecalcResult
   */
  async createEngineFromYrsState(yrsState: Uint8Array): Promise<RecalcResult> {
    if (this.engineCreated) {
      throw new BridgeError(
        'BRIDGE_ALREADY_STARTED',
        'createEngineFromYrsState',
        '[ComputeCore] Engine already created',
      );
    }
    this.initResult = await this.transport.call<RecalcResult>('compute_init_from_yrs_state', {
      docId: this.docId,
      state: yrsState,
    });
    this.engineCreated = true;
    activeInstancePerDocId.set(this.docId, this);
    return this.initResult;
  }

  /**
   * Start the bridge: apply initial/hydration results and subscribe to events.
   *
   * Transitions: CONTEXT_SET → STARTED
   *
   * Prerequisites: createEngine() must have been called (engine exists).
   */
  async start(): Promise<RecalcResult> {
    if (this._phase === 'STARTED') {
      throw new BridgeError(
        'BRIDGE_ALREADY_STARTED',
        'start',
        '[ComputeCore] Already started (phase: STARTED)',
      );
    }
    if (this._phase === 'DISPOSED') {
      throw new BridgeError(
        'BRIDGE_DISPOSED',
        'start',
        '[ComputeCore] Cannot start a disposed bridge',
      );
    }
    if (!this.engineCreated) {
      throw new BridgeError(
        'BRIDGE_NOT_STARTED',
        'start',
        '[ComputeCore] Cannot start before createEngine()',
      );
    }

    try {
      this._phase = 'STARTED';

      // Apply the hydration result (or empty init result) for UI reactivity
      const result = this.initResult!;
      this.mutationHandler?.applyAndNotify({ recalc: result } as MutationResult);
      this.applyValidationAnnotations(result);

      // Push initial schema map to Rust
      await this.pushSchemaMapToRust();

      // Subscribe to events for incremental sync
      this.setupSubscriptions();

      // Resolve the ready promise so consumers know the engine is live
      this.resolveReady();

      return result;
    } catch (err) {
      this.rejectReady(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }

  /**
   * Destroy the bridge: unsubscribe from events and destroy the Rust compute core.
   *
   * Transitions: any → DESTROYING → DISPOSED
   */
  async destroy(): Promise<void> {
    if (this._phase === 'DISPOSED') return;
    if (this.destroyPromise) return this.destroyPromise;

    this._phase = 'DESTROYING';
    this.destroyPromise = Promise.resolve().then(async () => {
      // Unsubscribe from events
      this.cleanups.forEach((fn) => fn());
      this.cleanups = [];

      if (this.engineCreated) {
        // Check if a newer ComputeCore has already replaced us in the WASM
        // registry for this docId. The WASM registry keys by docId, so a
        // second compute_init with the same docId silently overwrites the
        // first. If we proceed with compute_destroy here, we'd remove the
        // *newer* instance and cause "instance not found" errors on it.
        const currentActive = activeInstancePerDocId.get(this.docId);
        const isSuperseded = currentActive !== undefined && currentActive !== this;
        if (isSuperseded) {
          console.warn(
            '[ComputeCore] Skipping compute_destroy — instance superseded for docId:',
            this.docId,
          );
        } else {
          activeInstancePerDocId.delete(this.docId);
          try {
            await this._transport.call<void>('compute_destroy', { docId: this.docId });
          } catch (err) {
            console.warn('[ComputeCore] Error during destroy:', err);
          }
        }
      }

      this.fetchManager?.dispose();
      this.coordinatorRegistry.clear();
      this._phase = 'DISPOSED';
    });
    return this.destroyPromise;
  }

  /**
   * Check if the bridge is initialized and connected to Rust.
   * Returns true only when the bridge is in the STARTED phase.
   */
  get isInitialized(): boolean {
    return this._phase === 'STARTED';
  }

  /**
   * True once parent document teardown has begun.
   *
   * Normal operations must fail loudly in this state. Release operations for
   * subordinate resources owned by compute_destroy may resolve as successful
   * no-ops because the parent destroy is already authoritative cleanup.
   */
  isDestroyingOrDisposed(): boolean {
    return this._phase === 'DESTROYING' || this._phase === 'DISPOSED';
  }

  // ===========================================================================
  // Lifecycle Guards (PUBLIC — called by generated methods)
  // ===========================================================================

  /**
   * Ensure the bridge has reached at least the given phase.
   * Throws a descriptive error if the current phase is insufficient.
   *
   * Phase ordering: CREATED < HYDRATED < CONTEXT_SET < STARTED.
   * DESTROYING and DISPOSED are terminal states and invalid for normal
   * operations.
   */
  ensurePhase(minimumPhase: InitPhase, operation?: string): void {
    const phaseOrder: Record<InitPhase, number> = {
      CREATED: 0,
      HYDRATED: 1,
      CONTEXT_SET: 2,
      STARTED: 3,
      DESTROYING: -1,
      DISPOSED: -1, // DISPOSED is always invalid for operations
    };

    if (this.isDestroyingOrDisposed()) {
      throw new BridgeError(
        'BRIDGE_DISPOSED',
        operation ?? 'operation',
        `[ComputeCore] Bridge is disposed. Cannot perform ${operation ?? 'operation'}.`,
      );
    }

    const currentOrd = phaseOrder[this._phase];
    const requiredOrd = phaseOrder[minimumPhase];

    if (currentOrd < requiredOrd) {
      throw new BridgeError(
        'BRIDGE_PHASE_INSUFFICIENT',
        operation ?? 'this operation',
        `[ComputeCore] Phase ${this._phase} is insufficient for ${operation ?? 'this operation'}. Required: ${minimumPhase}. Call start() to advance the bridge lifecycle.`,
      );
    }
  }

  /**
   * Guard for mutation and read methods: requires STARTED phase.
   * PUBLIC — generated methods call this before delegating to backend.
   */
  ensureInitialized(): void {
    this.ensurePhase('STARTED');
  }

  // ===========================================================================
  // Unified Mutation Pipeline (PUBLIC — called by generated methods)
  // ===========================================================================

  /**
   * Unified mutation pipeline — ALL write methods MUST go through this.
   *
   * 1. Awaits the backend call (which returns [viewportPatchesBinary, MutationResult])
   * 2. Applies multi-viewport binary patches directly (zero conversion)
   * 3. Increments viewport generation counter
   * 4. Delegates domain event emission to MutationResultHandler
   *
   * @param promise - Backend call returning [Uint8Array, MutationResult]
   * @returns The MutationResult for the caller
   */

  /**
   * Core mutation pipeline shared by forward mutations and undo/redo.
   * Applies viewport patches, increments generation counter, delegates to
   * MutationResultHandler, and handles validation annotations.
   *
   * Does NOT call notifyForwardMutation() — callers decide whether to notify.
   */
  async mutateCore(
    promise: Promise<MutationTuple>,
    directEdits?: DirectEditPosition[],
    operation = 'mutateCore',
  ): Promise<MutationResult> {
    // Write gate check: if a gate is installed, verify the mutation is
    // allowed before executing. The gate throws WriteGateRejectionError
    // if the document is in a read-only, closing, or closed mode.
    // System operations running inside a bypass scope pass through.
    this._writeGate?.assertWritable(operation);

    const [viewportPatchesBinary, result] = await promise;

    // Guard for early calls: if not initialized, skip all post-processing.
    // Remote/provider sync can still advance the Rust engine before any
    // viewport coordinator exists. Arm the existing hydration-deficit
    // backfill so the first renderer mount re-fetches the viewport from Rust
    // instead of painting a stale empty buffer until the next live mutation.
    if (!this.isInitialized) {
      if (viewportPatchesBinary.byteLength > 2) {
        this.coordinatorRegistry.markHydrationDeficit();
      }
      return result;
    }

    // Apply viewport patches (zero conversion — Rust-produced binary applied directly)
    // Format preservation is handled in the Rust layer: produce_viewport_patches
    // now enriches format_idx from the effective format for value-only mutations.
    if (viewportPatchesBinary.byteLength > 2) {
      this.coordinatorRegistry.applyMultiViewportPatches(viewportPatchesBinary);
    }

    // Table styles are resolved into viewport cell formats. Table mutations
    // can affect every cell in the table even when Rust does not emit per-cell
    // viewport patches (notably undo/redo of table creation), so refresh the
    // affected sheet buffers before table events make the renderer repaint.
    if (result.tableChanges?.length && this.fetchManager) {
      const sheetIds = new Set(result.tableChanges.map((change) => change.sheetId));
      await Promise.all(
        Array.from(sheetIds).map((sheetId) =>
          this.fetchManager!.forceRefreshSheetViewports(sheetId),
        ),
      );
    }

    // Pivot deletion clears the materialized output cells in Rust, but that
    // clear is not represented as binary mutation patches. Re-read affected
    // sheet buffers before pivot:deleted subscribers repaint from stale cells.
    if (result.pivotChanges?.some((change) => change.kind === 'Removed') && this.fetchManager) {
      const sheetIds = new Set(
        result.pivotChanges
          .filter((change) => change.kind === 'Removed')
          .map((change) => change.sheetId),
      );
      await Promise.all(
        Array.from(sheetIds).map((sheetId) =>
          this.fetchManager!.forceRefreshSheetViewports(sheetId),
        ),
      );
    }

    // Delegate state updates + event emission to handler
    this.mutationHandler?.applyAndNotify(result, 'user', directEdits);

    // Handle validation annotations from recalc (not covered by MutationResultHandler)
    if (result.recalc) {
      this.applyValidationAnnotations(result.recalc);
    }

    // CF sibling refresh: binary patches only cover changedCells, but CF rules
    // like Duplicate-Values or Top-N can change the visual CF state of peer
    // cells that weren't recalculated. Rust refreshes its CF cache during
    // produce_viewport_patches — we just need to re-read the viewport to pick
    // up those corrected colors for the sibling cells.
    if (result.recalc?.changedCells?.length) {
      await this.refreshViewportForCfSiblings(result.recalc.changedCells, result.cfChanges);
    }

    // Geometry refresh: when row heights, column widths, or row/column
    // visibility change, the wire-format position arrays in each viewport
    // buffer become stale (their values were computed at the last fetch from
    // Rust's LayoutIndex). The `dimensions-patched` event updates the
    // in-buffer dimension index for explicit size changes, but positions
    // remain frozen until a fresh fetch. Visibility changes have the same
    // geometry effect (hidden rows/cols collapse to 0) and do not carry
    // dimensionChanges, so they need the same full-buffer refresh. Force-refresh
    // all viewports so coordinators commit fresh buffers — fetch-committed then
    // drives a VPI rebuild with up-to-date positions and hidden-state flags.
    //
    // Architecturally this keeps Rust as the single source of truth for
    // positions: the renderer never recomputes them from per-row dimension
    // queries (the old quadratic pre-roll loop in viewport-wiring.ts).
    if (
      (result.dimensionChanges?.length || result.visibilityChanges?.length) &&
      this.fetchManager
    ) {
      await this.fetchManager.forceRefreshAllViewports();
    }

    const showFormulaChanges = result.settingsChanges?.filter(isShowFormulasChange) ?? [];
    if (showFormulaChanges.length && this.fetchManager) {
      await Promise.all(
        showFormulaChanges.map((change) =>
          this.fetchManager!.forceRefreshSheetViewports(change.sheetId),
        ),
      );
    }

    // No spill-teardown force-refresh trigger.
    //
    // Earlier the scheduler pre-set the spill anchor to #SPILL! before recalc
    // and the value-equality check then suppressed the anchor's CellChange,
    // leaving the anchor invisible to the wire patches. TS compensated by
    // detecting `value === undefined` teardown projection cells and force-
    // refreshing the viewport — a workaround that wiped the overlay and
    // required re-applying the mutation.
    //
    // The Rust scheduler now lets recalc compute the anchor's transition
    // naturally (see `compute/core/src/scheduler/spill.rs::invalidate_projection_at`),
    // so the anchor's CellChange always lands in the binary mutation patches
    // and no client-side force-refresh is needed.

    // Drain Yrs update buffer immediately — every mutation (forward, undo,
    // redo, syncApply) can produce Yrs updates.  Draining here eliminates
    // the need for a polling loop and ensures subscribers see updates
    // synchronously with the mutation that caused them.
    if (this.afterMutationHook) {
      await this.afterMutationHook();
    }

    return result;
  }

  /**
   * Mutation pipeline for forward (non-undo/redo) mutations.
   * Calls mutateCore() then notifies the undo service so cached state is refreshed.
   */
  async mutate(
    promise: Promise<MutationTuple>,
    directEdits?: DirectEditPosition[],
    operation = 'mutate',
  ): Promise<MutationResult> {
    const result = await this.mutateCore(promise, directEdits, operation);
    await this.ctx.services?.undo.notifyForwardMutation();
    return result;
  }

  /**
   * Public mutation entrypoint. The call thunk is intentionally invoked only
   * after deferred hydration has completed and writability has been rechecked.
   */
  async mutatePublic(
    operation: string,
    call: () => Promise<MutationTuple>,
    directEdits?: DirectEditPosition[],
  ): Promise<MutationResult> {
    await this.admitPublicMutation(operation);
    return this.mutate(call(), directEdits, operation);
  }

  /**
   * Public UI-state mutation entrypoint.
   *
   * UI-only workbook settings are independent of deferred sheet data
   * materialization, but still need the normal write-gate and mutation-result
   * pipeline so mirrors, events, undo-state observers, and provider drains stay
   * consistent.
   */
  async mutatePublicUiState(
    operation: string,
    call: () => Promise<MutationTuple>,
    directEdits?: DirectEditPosition[],
  ): Promise<MutationResult> {
    this.ensureInitialized();
    this._writeGate?.assertWritable(operation);
    return this.mutate(call(), directEdits, operation);
  }

  /**
   * Public mutation entrypoint for backend calls whose raw return includes
   * caller-visible data next to the MutationResult.
   */
  async mutatePublicResult<T>(
    operation: string,
    call: () => Promise<T>,
    toMutationTuple: (result: T) => MutationTuple,
    directEdits?: DirectEditPosition[],
  ): Promise<{ raw: T; mutation: MutationResult }> {
    await this.admitPublicMutation(operation);
    const raw = await call();
    const mutation = await this.mutate(
      Promise.resolve(toMutationTuple(raw)),
      directEdits,
      operation,
    );
    return { raw, mutation };
  }

  /**
   * System mutation entrypoint. Lifecycle/provider/import work must not wait
   * on the public materialization barrier, but it still flows through the same
   * projection/event/undo-state refresh pipeline under the write-gate bypass.
   */
  async mutateSystem(
    operation: string,
    call: () => Promise<MutationTuple>,
    directEdits?: DirectEditPosition[],
  ): Promise<MutationResult> {
    const run = () => this.mutate(call(), directEdits, operation);
    return runSystemMutation(this._writeGate, run);
  }

  /**
   * System mutation entrypoint for backend calls with caller-visible raw data.
   */
  async mutateSystemResult<T>(
    operation: string,
    call: () => Promise<T>,
    toMutationTuple: (result: T) => MutationTuple,
    directEdits?: DirectEditPosition[],
  ): Promise<{ raw: T; mutation: MutationResult }> {
    const run = async () => {
      const raw = await call();
      const mutation = await this.mutate(
        Promise.resolve(toMutationTuple(raw)),
        directEdits,
        operation,
      );
      return { raw, mutation };
    };
    return runSystemMutation(this._writeGate, run);
  }

  /**
   * Query pipeline — simple wrapper for read-only backend calls.
   * Ensures the bridge is initialized before delegating.
   */
  async query<T>(promise: Promise<T>): Promise<T> {
    this.ensureInitialized();
    return promise;
  }

  // ===========================================================================
  // Validation Annotations (PRIVATE)
  // ===========================================================================

  /**
   * Emit validation annotation events from a RecalcResult.
   * Validation annotations are produced by Rust's recalc pass and must be
   * forwarded to the UI via EventBus.
   */
  private applyValidationAnnotations(recalc: RecalcResult): void {
    if (!recalc) return;
    const annotations = recalc.validationAnnotations;
    if (!annotations || annotations.length === 0) return;

    const annotationData = annotations.map((annotation: RecalcValidationAnnotation) => ({
      cellId: annotation.cellId,
      sheetId: annotation.sheetId,
      row: annotation.row,
      column: annotation.column,
      errors: annotation.errors.map((e: RecalcValidationError) => ({
        rule: e.code,
        message: e.message,
        severity: (e.severity === 'error' ? 'error' : 'warning') as 'error' | 'warning',
      })),
    }));

    this.ctx.eventBus.emit({
      type: 'validation:recalc-annotations',
      annotations: annotationData,
      timestamp: Date.now(),
    });
  }

  // ===========================================================================
  // Force Refresh All Viewports
  // ===========================================================================

  /**
   * Force-refresh all registered viewport buffers from Rust.
   *
   * Used after mutations that recalculate cells but do not produce binary
   * viewport patches (e.g. sheet deletion — dependent cells on other sheets
   * are recalculated but the viewport buffer remains stale without this call).
   */
  async forceRefreshAllViewports(): Promise<void> {
    await this.fetchManager?.forceRefreshAllViewports();
  }

  /**
   * After a cell mutation, re-read the viewport for any sheet that has CF rules
   * so that CF "sibling" cells — cells whose CF display changed because a peer
   * cell's value changed (e.g. Duplicate-Values partner, displaced Top-N entry)
   * — pick up the correct colors from Rust's already-refreshed CF cache.
   *
   * The binary mutation patches only cover `changedCells`; sibling cells are
   * not patched. Rust's CF cache IS correct at this point (refreshed inside
   * `produce_viewport_patches_for_recalc`), so a full viewport re-read yields
   * the right colors for all cells.
   *
   * Performance: we check per-sheet whether CF rules exist (cached lazily,
   * invalidated on CF rule changes) so that the extra force-refresh is skipped
   * for the common case of sheets without conditional formatting.
   */
  private async refreshViewportForCfSiblings(
    changedCells: CellChange[],
    cfChanges: CfChange[] | undefined,
  ): Promise<void> {
    await refreshViewportForCfSiblings({
      transport: this.transport,
      docId: this.docId,
      fetchManager: this.fetchManager,
      sheetsWithCfRules: this.sheetsWithCfRules,
      changedCells,
      cfChanges,
    });
  }

  // ===========================================================================
  // Structural Change Helper
  // ===========================================================================

  /**
   * Handle a structural change with prefetch invalidation.
   * Called by the structureChange passthrough method.
   *
   * Structural changes invalidate old per-viewport prefetch state before the
   * Rust mutation runs. After Rust confirms the mutation, forced refresh
   * commits fresh buffers and re-synchronizes per-viewport bounds before this
   * method returns, so registered viewports remain renderable and observable.
   */
  async structureChangeWithInvalidation(
    sheetId: SheetId,
    change: StructureChange,
  ): Promise<MutationResult> {
    let result: MutationResult;
    try {
      result = await this.mutatePublic('compute_structure_change', () => {
        // Mark old prefetch state stale after admission but before Rust shifts
        // row/column structure. The awaited forced refresh below restores fresh
        // buffers and bounds.
        this.invalidateAllViewportPrefetch();
        return this.transport.call<MutationTuple>('compute_structure_change', {
          docId: this.docId,
          sheetId,
          change,
        });
      });
    } catch (error) {
      // Bridge call failed — Rust is truth. Re-read from engine to recover
      // correct VPI and viewport state (async bridge rule #4).
      await this.fetchManager!.forceRefreshAllViewports();
      throw error;
    }

    // Rust confirmed the structural mutation. Force-refresh all viewports so
    // coordinators commit fresh buffers and emit 'fetch-committed', which
    // triggers VPI rebuilds in the renderer. Without this, the VPI has stale
    // dimension data after row/column inserts/deletes (Bug #29).
    await this.fetchManager!.forceRefreshAllViewports();
    return result;
  }

  // ===========================================================================
  // Viewport Lifecycle
  // ===========================================================================

  /** Set the CellMetadataCache for sync render loop patching via MutationResultHandler. */
  setCellMetadataCache(cache: CellMetadataCache | null): void {
    this.cellMetadataCache = cache;
    if (this.mutationHandler) {
      this.mutationHandler.setCellMetadataCache(cache);
    }
  }

  /** Set the RangeMetadataCache for first-class range lifecycle tracking via MutationResultHandler. */
  setRangeMetadataCache(cache: RangeMetadataCache | null): void {
    this.rangeMetadataCache = cache;
    if (this.mutationHandler) {
      this.mutationHandler.setRangeMetadataCache(cache);
    }
  }

  /**
   * Get the MutationResultHandler for this bridge.
   * Returns null if no BinaryViewportBuffer has been set.
   */
  getMutationHandler(): MutationResultHandler | null {
    return this.mutationHandler;
  }

  /**
   * Inject (or clear) the render scheduler into viewport buffers.
   * This wires up "Write = Invalidate" so mutation patches and fetch commits
   * automatically trigger a render frame via the scheduler.
   *
   * Injects into the coordinator registry (which caches it for newly registered
   * coordinators).
   */
  setRenderScheduler(scheduler: import('@mog/canvas-engine').RenderScheduler | null): void {
    this._renderScheduler = scheduler;
    // Inject into coordinator registry — handles current + future coordinators
    this.coordinatorRegistry.setRenderScheduler(scheduler);
  }

  /** Initialize the MutationResultHandler for processing Rust IPC mutation results. */
  initMutationHandler(): void {
    // Create mutation handler with eventBus and undo description callback
    this.mutationHandler = new MutationResultHandler(this.ctx.eventBus, (description) =>
      this.ctx.services?.undo.setNextDescription(description),
    );
    // Wire coordinator registry for dimension patching
    this.mutationHandler.setCoordinatorRegistry(this.coordinatorRegistry);

    // Carry over CellMetadataCache to the new handler
    if (this.cellMetadataCache) {
      this.mutationHandler.setCellMetadataCache(this.cellMetadataCache);
    }

    // Carry over RangeMetadataCache to the new handler
    if (this.rangeMetadataCache) {
      this.mutationHandler.setRangeMetadataCache(this.rangeMetadataCache);
    }

    // Wire the kernel state mirror (state mirror wiring). ONE cast remains:
    // `MirrorReadView` → `StateMirror`, the single approved boundary for
    // `.apply()`. The `as DocumentContext` cast is gone since `ctx.mirror`
    // is now on the public `ISpreadsheetKernelContext` surface. mirror coverage
    // Guard 3 (ESLint `no-mirror-apply-outside-handler`) flags any other
    // site that calls `.apply()` on a value typed as the mirror.
    //
    // `this.ctx` is typed as `IKernelContext` (general-purpose) but the
    // spreadsheet compute core always runs against an `ISpreadsheetKernelContext`
    // — narrow back to the spreadsheet contract to reach `mirror`.
    const sheetCtx = this.ctx as ISpreadsheetKernelContext;
    const writableMirror =
      sheetCtx.mirror as unknown as import('../../document/state-mirror').StateMirror;
    this.mutationHandler.setStateMirror(writableMirror);
  }

  // ===========================================================================
  // Per-Viewport Data Fetch — delegated to ViewportFetchManager
  // ===========================================================================

  /**
   * Refresh data for a single viewport region.
   * Delegates to ViewportFetchManager (viewport movement pipeline).
   */
  async refreshViewportForRegion(
    viewportId: string,
    sheetId: SheetId,
    bounds: { startRow: number; startCol: number; endRow: number; endCol: number },
    scrollBehavior: ViewportScrollBehavior = 'free',
  ): Promise<void> {
    this.ensureInitialized();
    return this.fetchManager!.refresh(
      viewportId,
      sheetId,
      normalizeViewportBounds(bounds),
      scrollBehavior,
    );
  }

  /**
   * Mirror the latest TS-visible viewport bounds into the buffer gate.
   * This is synchronous and intentionally does not touch Rust registration.
   */
  updateViewportVisibleWindow(
    viewportId: string,
    sheetId: SheetId,
    bounds: { startRow: number; startCol: number; endRow: number; endCol: number },
  ): void {
    if (!this.isInitialized) return;
    this.fetchManager?.updateVisibleWindow(viewportId, sheetId, normalizeViewportBounds(bounds));
  }

  /**
   * Get the per-viewport binary buffer for a specific viewport region.
   * Returns null if the viewport hasn't been registered or fetched yet.
   */
  getViewportBuffer(viewportId: string): ReadonlyBinaryViewportBuffer | null {
    return this.fetchManager?.getBuffer(viewportId) ?? null;
  }

  /**
   * Get or create a CellAccessor for a specific viewport region.
   * The accessor is a flyweight bound to the viewport's BinaryViewportBuffer.
   * Returns undefined if the viewport hasn't been created yet.
   */
  getAccessorForViewport(viewportId: string): CellAccessor | undefined {
    return this.fetchManager?.getAccessor(viewportId);
  }

  /**
   * Get all per-viewport states. Used for debugging and testing.
   */
  getPerViewportStates(): ReadonlyMap<string, ViewportPrefetchState> {
    return this.fetchManager?.getPerViewportStates() ?? new Map();
  }

  /**
   * Invalidate all per-viewport prefetch bounds.
   * PUBLIC — called on structural changes (insert/delete rows/cols).
   * Marks prefetch cache as stale so the next scroll fetches fresh data.
   * Does NOT trigger a fetch — that's the fetch manager's job on scroll.
   */
  invalidateAllViewportPrefetch(): void {
    this.fetchManager?.invalidateAllPrefetch();
  }

  /**
   * Clear all per-viewport state for a sheet switch.
   * Removes all viewport buffers, prefetch bounds, and accessor caches.
   */
  clearPerViewportState(): void {
    this.fetchManager?.clear();
  }

  setShowFormulas(value: boolean): void {
    void value;
  }

  /** Get the coordinator registry for external wiring (e.g., renderer). */
  getCoordinatorRegistry(): ViewportCoordinatorRegistry {
    return this.coordinatorRegistry;
  }

  /** Subscribe to viewport change events from all coordinators. */
  subscribeToViewportEvents(
    cb: (event: import('@mog-sdk/contracts/api').ViewportChangeEvent) => void,
  ): () => void {
    return this.coordinatorRegistry.subscribe(cb);
  }

  // ===========================================================================
  // Viewport Registration Lifecycle
  // ===========================================================================

  /**
   * Register a viewport region with the Rust engine.
   */
  async registerViewportRegion(
    viewportId: string,
    sheetId: SheetId,
    bounds: { startRow: number; startCol: number; endRow: number; endCol: number },
  ): Promise<void> {
    this.ensureInitialized();
    const normalizedBounds = normalizeViewportBounds(bounds);
    await this.transport.call<void>('compute_register_viewport', {
      docId: this.docId,
      viewportId,
      sheetId,
      startRow: normalizedBounds.startRow,
      startCol: normalizedBounds.startCol,
      endRow: normalizedBounds.endRow,
      endCol: normalizedBounds.endCol,
    });
  }

  /**
   * Update viewport bounds in the Rust engine.
   */
  async updateViewportRegionBounds(
    viewportId: string,
    bounds: { startRow: number; startCol: number; endRow: number; endCol: number },
  ): Promise<void> {
    this.ensureInitialized();
    const normalizedBounds = normalizeViewportBounds(bounds);
    await this.transport.call<void>('compute_update_viewport_bounds', {
      docId: this.docId,
      viewportId,
      startRow: normalizedBounds.startRow,
      startCol: normalizedBounds.startCol,
      endRow: normalizedBounds.endRow,
      endCol: normalizedBounds.endCol,
    });
  }

  /**
   * Unregister a viewport region from the Rust engine.
   *
   * Release operation: if parent destroy has started, compute_destroy owns the
   * Rust-side document state, so this resolves as an idempotent no-op. Normal
   * operations continue to fail in DESTROYING/DISPOSED via ensureInitialized().
   */
  async unregisterViewportRegion(viewportId: string): Promise<void> {
    if (this.isDestroyingOrDisposed()) {
      this.fetchManager?.removeViewport(viewportId);
      this.coordinatorRegistry.unregister(viewportId);
      return;
    }

    if (!this.isInitialized) {
      this.fetchManager?.removeViewport(viewportId);
      this.coordinatorRegistry.unregister(viewportId);
      return;
    }

    try {
      await this.transport.call<void>('compute_unregister_viewport', {
        docId: this.docId,
        viewportId,
      });
    } catch (err) {
      if (this.isDestroyingOrDisposed()) return;
      throw err;
    } finally {
      this.fetchManager?.removeViewport(viewportId);
      this.coordinatorRegistry.unregister(viewportId);
    }
  }

  /**
   * Reset all viewports for a sheet in the Rust engine.
   *
   * With sheet-scoped composed viewport IDs ("main:sheet-abc"), per-viewport
   * state is already namespaced per sheet. Individual region.dispose() calls
   * handle TS-side cleanup via unregisterViewportRegion(). The Rust-side
   * reset batch-removes registrations for the departing sheet.
   *
   * Release operation: parent compute_destroy covers all remaining sheet
   * viewport registrations once DESTROYING begins.
   */
  async resetSheetViewportRegions(sheetId: SheetId): Promise<void> {
    if (this.isDestroyingOrDisposed()) return;
    if (!this.isInitialized) return;

    try {
      await this.transport.call<void>('compute_reset_sheet_viewports', {
        docId: this.docId,
        sheetId,
      });
    } catch (err) {
      if (this.isDestroyingOrDisposed()) return;
      throw err;
    }
  }

  // ===========================================================================
  // Active Cell Cache
  // ===========================================================================

  /**
   * Refresh the active cell data.
   * Call this when the active cell changes.
   */
  async refreshActiveCell(sheetId: SheetId, cellId: string): Promise<void> {
    this.ensureInitialized();
    const data = await this.transport.call<TypedActiveCellData>('compute_get_active_cell', {
      docId: this.docId,
      sheetId,
      cellId,
    });
    // Cast at the Rust-TS boundary: Rust's formula field always has `=` prefix
    if (data.formula != null) {
      (data as TypedActiveCellData).formula = asFormulaA1(data.formula);
    }
    this._activeCellData = data as TypedActiveCellData;
  }

  /** Get the cached active cell data (formula branded as FormulaA1). */
  getActiveCellData(): TypedActiveCellData | null {
    return this._activeCellData;
  }

  // ===========================================================================
  // Error Recovery
  // ===========================================================================

  // NOTE: `importFromXlsxBytes` and `importFromCsvBytes` are now provided by
  // the generated bridge base (`GeneratedBridgeBase`). The hand-written
  // duplicates that previously lived here pre-Phase-5 are removed because
  // their `Promise<RecalcResult>` shape silently bypassed
  // `MutationResultHandler.applyAndNotify` (the bug that left every TS-side
  // domain projection empty after hydration). The generated bindings now
  // funnel hydration through `core.mutate(...)` so per-domain projections
  // (drawings, tables, comments, filters, sparklines, named ranges,
  // conditional formats, pivots, grouping) populate on the same code path
  // as live mutations.
  //
  // `importSheetsFromXlsx` is intentionally kept hand-written below because
  // `ComputeBridge` (the public class) overrides it to delegate here.

  /**
   * Import sheets from XLSX bytes into the current workbook.
   * Returns the names of the inserted sheets (possibly deduped).
   */
  async importSheetsFromXlsx(
    xlsxData: Uint8Array,
    sheetNames: string[],
    insertPosition: number | null,
  ): Promise<string[]> {
    this.ensureInitialized();
    return this.transport.call<string[]>('compute_import_sheets_from_xlsx', {
      docId: this.docId,
      xlsxData,
      sheetNames,
      insertPosition,
    });
  }

  /**
   * Export the current workbook to XLSX bytes (single bridge call).
   */
  async exportToXlsxBytes(): Promise<Uint8Array> {
    this.ensureInitialized();
    return this.transport.call<Uint8Array>('compute_export_to_xlsx_bytes', {
      docId: this.docId,
    });
  }

  /**
   * Export the current workbook to XLSX bytes without imported RoundTripContext.
   *
   * This is an evaluation-only anti-cheat path: modeled facts should match
   * normal export while registered opaque subgraphs may differ.
   */
  async exportToXlsxBytesContextStripped(): Promise<Uint8Array> {
    this.ensureInitialized();
    return this.transport.call<Uint8Array>('compute_export_to_xlsx_bytes_context_stripped', {
      docId: this.docId,
    });
  }

  /**
   * Capture a PNG screenshot of a cell range.
   */
  async captureScreenshot(
    sheetId: string,
    startRow: number,
    startCol: number,
    endRow: number,
    endCol: number,
    dpr: number,
    showHeaders: boolean,
    showGridlines: boolean,
    maxWidth: number | null,
    maxHeight: number | null,
  ): Promise<Uint8Array> {
    this.ensureInitialized();
    return this.transport.call<Uint8Array>('compute_capture_screenshot', {
      docId: this.docId,
      sheetId,
      startRow,
      startCol,
      endRow,
      endCol,
      dpr,
      showHeaders,
      showGridlines,
      maxWidth,
      maxHeight,
    });
  }

  /**
   * Full recalc: destroys the existing engine and reinitializes from a fresh snapshot.
   *
   * Requires at least CONTEXT_SET phase (the engine may or may not have been started yet).
   * After fullRecalc completes, the bridge transitions to STARTED phase.
   */
  async fullRecalc(options?: Record<string, unknown>): Promise<RecalcResult> {
    this.ensurePhase('CONTEXT_SET', 'fullRecalc');
    const result = await this.transport.call<RecalcResult>('compute_full_recalc', {
      docId: this.docId,
      options: options ?? {},
    });
    this._phase = 'STARTED';
    // Full recalc returns a bare RecalcResult (not a mutation tuple). The
    // normal mutation path applies Rust-produced binary viewport patches before
    // emitting events; compute_full_recalc only returns cell changes, so refresh
    // registered viewport buffers first to preserve the same state-before-events
    // contract.
    if (result.changedCells.length > 0 || result.projectionChanges.length > 0) {
      await this.forceRefreshAllViewports();
    }
    this.mutationHandler?.applyAndNotify({ recalc: result } as MutationResult);
    this.applyValidationAnnotations(result);
    // Re-push schema map after re-init
    await this.pushSchemaMapToRust();
    return result;
  }

  // ===========================================================================
  // Undo / Redo
  // ===========================================================================

  async undo(): Promise<MutationResult> {
    await this.admitPublicMutation('compute_undo');
    const result = await this.mutateCore(
      this.transport.call<MutationTuple>('compute_undo', { docId: this.docId }),
      undefined,
      'compute_undo',
    );
    if (historyReplayNeedsFullViewportRefresh(result)) {
      await this.forceRefreshAllViewports();
    }
    return result;
  }

  async redo(): Promise<MutationResult> {
    await this.admitPublicMutation('compute_redo');
    const result = await this.mutateCore(
      this.transport.call<MutationTuple>('compute_redo', { docId: this.docId }),
      undefined,
      'compute_redo',
    );
    if (historyReplayNeedsFullViewportRefresh(result)) {
      await this.forceRefreshAllViewports();
    }
    return result;
  }

  async canUndo(): Promise<boolean> {
    this.ensureInitialized();
    return this.transport.call<boolean>('compute_can_undo', { docId: this.docId });
  }

  async canRedo(): Promise<boolean> {
    this.ensureInitialized();
    return this.transport.call<boolean>('compute_can_redo', { docId: this.docId });
  }

  async getUndoState(): Promise<UndoState> {
    this.ensureInitialized();
    return this.transport.call<UndoState>('compute_get_undo_state', { docId: this.docId });
  }

  async beginUndoGroup(): Promise<void> {
    this.ensureInitialized();
    await this.transport.call<void>('compute_begin_undo_group', { docId: this.docId });
  }

  async endUndoGroup(): Promise<void> {
    this.ensureInitialized();
    await this.transport.call<void>('compute_end_undo_group', { docId: this.docId });
  }

  // ===========================================================================
  // Sync Protocol (Used by RustDocument for persistence)
  // ===========================================================================

  async syncStateVector(): Promise<Uint8Array> {
    return this.transport.call<Uint8Array>('compute_encode_state_vector', {
      docId: this.docId,
    });
  }

  async syncDiff(remoteSv: Uint8Array): Promise<Uint8Array> {
    return this.transport.call<Uint8Array>('compute_encode_diff', {
      docId: this.docId,
      remoteSv,
    });
  }

  /**
   * Apply an update (from persistence or remote) to the Rust engine.
   *
   * **Pre-init protocol**: This is the ONLY mutation method allowed before the
   * STARTED phase. It can be called in CREATED (after createEngine) or later
   * phases to hydrate the Rust engine with persisted state.
   */
  async syncApply(update: Uint8Array): Promise<MutationResult> {
    if (!this.engineCreated) {
      throw new BridgeError(
        'BRIDGE_NOT_STARTED',
        'syncApply',
        '[ComputeCore] Cannot syncApply before createEngine()',
      );
    }
    if (this._phase === 'DISPOSED') {
      throw new BridgeError(
        'BRIDGE_DISPOSED',
        'syncApply',
        '[ComputeCore] Cannot syncApply on disposed bridge',
      );
    }
    // Allowed in CREATED (pre-context hydration), CONTEXT_SET, HYDRATED, or STARTED phases
    // Note: mutate() has early-return guard for non-STARTED phases
    if (!this.isInitialized && update.length > 0) {
      this.coordinatorRegistry.markHydrationDeficit();
    }
    const result = await this.mutateSystem('compute_apply_sync_update', () =>
      this.transport.call<MutationTuple>('compute_apply_sync_update', {
        docId: this.docId,
        update,
      }),
    );
    // Store the hydration result (overrides the empty init result)
    this.initResult = result.recalc;
    // Transition to HYDRATED if we were in CREATED or CONTEXT_SET
    if (this._phase === 'CREATED' || this._phase === 'CONTEXT_SET') {
      this._phase = 'HYDRATED';
    }

    // Collab live-sync viewport refresh: compute_apply_sync_update does not
    // produce viewport patches (the Rust CRDT path updates the document model
    // but doesn't know the viewport region). When the bridge is STARTED
    // (renderer is mounted with active coordinators), force a full viewport
    // refresh so the canvas picks up the new cell values from the CRDT update.
    // Without this, the viewport buffer remains stale until the next local
    // edit or scroll triggers a refresh.
    if (this.isInitialized && this.fetchManager) {
      await this.fetchManager.forceRefreshAllViewports();
    }

    return result;
  }

  async syncFullState(): Promise<Uint8Array> {
    return this.transport.call<Uint8Array>('compute_sync_full_state', {
      docId: this.docId,
    });
  }

  // ===========================================================================
  // Private — Event Subscriptions
  // ===========================================================================

  private setupSubscriptions(): void {
    const unsubSchemaChanged = this.ctx.eventBus.on<SchemaChangedEvent>(
      'schema:changed',
      (event) => {
        void this.handleSchemaChanged(event);
      },
    );
    this.cleanups.push(unsubSchemaChanged);
  }

  // ===========================================================================
  // Private — Schema Sync
  // ===========================================================================

  /**
   * Push the full schema map to the Rust compute core.
   * Called during start() and fullRecalc() to ensure Rust has all column schemas.
   */
  private async pushSchemaMapToRust(): Promise<void> {
    try {
      const entries: SchemaMapEntryWire[] = [];

      // Get all sheet IDs from Rust (the source of truth)
      const sheetIds = await this.transport.call<string[]>('compute_get_all_sheet_ids', {
        docId: this.docId,
      });

      for (const rawId of sheetIds) {
        const columnSchemas = Schemas.getAllColumnSchemas(toSheetId(rawId));
        for (const [colIndex, schema] of columnSchemas) {
          entries.push({
            sheetId: rawId,
            column: colIndex,
            schema: this.columnSchemaToWire(schema),
          });
        }
      }

      // Reset version counter on full push
      this.schemaVersion = 1;

      if (entries.length > 0) {
        await this.transport.call<void>('compute_set_schema_map', {
          docId: this.docId,
          entries,
          version: this.schemaVersion,
        });
      }
    } catch (err) {
      console.error('[ComputeCore] Error pushing schema map to Rust:', err);
    }
  }

  /**
   * Convert a contract ColumnSchema to the wire format for Rust IPC.
   */
  private columnSchemaToWire(schema: ColumnSchema): ColumnSchemaWire {
    return {
      id: schema.id,
      name: schema.name,
      type: schema.type,
      constraints: schema.constraints as SchemaConstraintsWire | undefined,
      distribution: schema.distribution,
      description: schema.description,
    };
  }

  /**
   * Handle a schema change event by forwarding the update to Rust.
   */
  private async handleSchemaChanged(event: SchemaChangedEvent): Promise<void> {
    try {
      this.schemaVersion++;
      if (event.newSchema) {
        // Schema added or updated
        await this.transport.call<void>('compute_update_schema', {
          docId: this.docId,
          sheetId: event.sheetId,
          column: event.colIndex,
          schema: this.columnSchemaToWire(event.newSchema),
          version: this.schemaVersion,
        });
      } else {
        // Schema removed
        await this.transport.call<void>('compute_remove_schema', {
          docId: this.docId,
          sheetId: event.sheetId,
          column: event.colIndex,
          version: this.schemaVersion,
        });
      }
    } catch (err) {
      console.error('[ComputeCore] Error syncing schema change to Rust:', err);
    }
  }
}
