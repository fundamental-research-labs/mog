/**
 * DocumentLifecycleSystem - Owns the document lifecycle XState actor.
 *
 * This system class:
 * - Creates the XState actor with real actor implementations (via machine.provide())
 * - Exposes imperative methods (create, createFromXlsx, dispose)
 * - Provides waitForReady() / onReady() for consumers to gate on initialization
 * - Implements the fromPromise actors: createEngine, wireContext, startBridge,
 *   hydrateXlsx, disposeBridge
 *
 * ARCHITECTURE:
 * - Constructor-complete: fully configured at construction time
 * - Owns the actor (creates, starts, stops it)
 * - Machine is pure, all side effects live in the actor implementations here
 * - Follows the RenderSystem pattern from renderer/render-system.ts
 *
 * @see document-lifecycle-machine.ts for the pure state machine
 * @see 04-DOCUMENT-LIFECYCLE-STATE-MACHINE.md for design decisions
 */

import { createActor, fromPromise } from 'xstate';

import type {
  CreateDocumentOptions,
  CsvImportOptions,
  DocumentImportOptions,
  DocumentSource,
} from '@mog-sdk/contracts/document';
import type { SheetId } from '@mog-sdk/contracts/core';
import type { DocumentSecurityConfig } from '@mog-sdk/contracts/security';
import type { TrapError } from '@mog/transport';
import type { KernelHostContext } from '@mog-sdk/types-host/kernel';
import type { KernelDocumentLifecycleInput } from '@mog-sdk/types-host/kernel';
import type { ProviderMaterializerHandle } from '@mog-sdk/types-host/bindings';
import type { HostCanonicalFingerprint } from '@mog-sdk/types-host/fingerprints';
import type { StorageProviderKind } from '@mog-sdk/types-document/storage/document-provider';
import type {
  DocumentStoragePhase,
  DocumentStorageState,
  ImportDurabilityResult,
  StorageHighWaterMark,
} from '@mog-sdk/types-document/storage/lifecycle';
import type { MaterializationState } from '@mog-sdk/contracts/api';
import type { ComputeBridge } from '../bridges/compute/compute-bridge';
import type { DocumentContext, KernelClock } from '../context/types';
import type { WorkbookLinkResolver, WorkbookLinkStatusScope } from '../services/workbook-links';
import type { RustDocument } from './rust-document';
import type { WriteGate } from './write-gate';
import type { GateMode } from './write-gate';
import {
  StorageProviderRegistry,
  registerDefaultFactories,
  type ProviderPreflightResult,
} from './providers/registry';
import type { ProviderFactory } from './providers/factory';
import {
  DocumentDisposedError,
  DocumentNotReadyError,
  EngineCreateError,
  HydrationError,
} from '../errors/document';
import { validateHostContext } from './validate-host-context';
import { mapHostRuntimeToTransportConfig } from './host-runtime-transport';
import { slog } from '../lib/slog';

import {
  documentLifecycleMachine,
  documentLifecycleSelectors,
  type AttachProvidersInput,
  type AttachProvidersOutput,
  type CreateEngineInput,
  type CreateEngineOutput,
  type DisposeBridgeInput,
  type DocumentLifecycleActor,
  type DocumentLifecycleState,
  type HydrateCsvInput,
  type HydrateCsvOutput,
  type HydrateXlsxInput,
  type HydrateXlsxOutput,
  type StartBridgeInput,
  type StartBridgeOutput,
  type WireContextInput,
  type WireContextOutput,
} from './document-lifecycle-machine';

// =============================================================================
// Phase → Gate Mode mapping
// =============================================================================

let documentLifecycleEngineInstanceCounter = 0;

const PHASE_TO_GATE_MODE: Partial<Record<DocumentStoragePhase, GateMode>> = {
  readyReadWrite: 'open',
  readyReadOnly: 'open',
  readyEphemeral: 'open',
  checkpointing: 'checkpointing',
  closing: 'closing',
  closed: 'closed',
  destroyed: 'closed',
};

function markPerformance(name: string): void {
  const perf = globalThis.performance;
  if (perf && typeof perf.mark === 'function') {
    perf.mark(name);
  }
}

function measurePerformance(name: string, startMark: string, endMark: string): void {
  const perf = globalThis.performance;
  if (!perf || typeof perf.measure !== 'function') return;
  try {
    perf.measure(name, startMark, endMark);
  } catch {
    // Some runtimes expose User Timing partially or drop marks under pressure.
    // Lifecycle instrumentation must not affect document creation.
  }
}

// =============================================================================
// DeferredContext Proxy
// =============================================================================

/**
 * A Proxy that stands in for DocumentContext before the real one is created.
 * Any property access throws a clear error indicating premature use.
 *
 * The ComputeBridge is created before DocumentContext exists (chicken-and-egg:
 * RustDocument needs ComputeBridge, DocumentContext needs RustDocument).
 * This proxy ensures a descriptive error instead of a null dereference.
 */
const DeferredContext: DocumentContext = new Proxy({} as DocumentContext, {
  get(_, prop) {
    throw new DocumentNotReadyError(
      `[DocumentLifecycleSystem] DocumentContext accessed before initialization (property: ${String(prop)}). ` +
        `The ComputeBridge is in CREATED phase — call setContext() to wire the real DocumentContext.`,
    );
  },
});

function isHostCanonicalFingerprint(value: string): value is HostCanonicalFingerprint {
  return value.startsWith('mog-host-fp:v1:sha256:') || value.startsWith('mog-host-fp:v1:blake3:');
}

function normalizeHostCanonicalFingerprint(
  value: string | undefined,
): HostCanonicalFingerprint | undefined {
  if (value === undefined) return undefined;
  if (isHostCanonicalFingerprint(value)) return value;
  throw new Error(`Invalid host canonical fingerprint: ${value}`);
}

// =============================================================================
// Config — Discriminated union: legacy vs host-backed
// =============================================================================

/**
 * Legacy/cooperative lifecycle config.
 *
 * This is the existing construction path used by the standalone app, tests,
 * and all pre-host-boundary code. It reads `environment`, `napiAddon`,
 * `security`, and runtime globals (window.__TAURI__, indexedDB, etc.).
 *
 * The `kind` field is optional for backward compatibility — omitting it or
 * setting it to `'legacy'` both select this path.
 */
export interface DocumentLifecycleConfigLegacy {
  /**
   * Discriminant. Optional for backward compatibility — existing callers
   * that construct `DocumentLifecycleConfig` without `kind` continue to
   * work on the legacy path.
   */
  readonly kind?: 'legacy';

  /**
   * Runtime environment. Determines which bridges and services are booted.
   * - 'browser': Full environment — IndexedDB persistence, schema bridge, DOM/Canvas stubs available
   * - 'headless': Minimal environment — no persistence, no schema bridge, no-op DOM/Canvas stubs
   * Default: 'browser' (preserves existing behavior)
   */
  environment?: 'browser' | 'headless';

  /**
   * Pre-loaded NAPI addon module. When provided, the transport layer uses this
   * instead of auto-discovering via require('@mog/compute-core-napi').
   * Required for published builds where the workspace package doesn't exist.
   */
  napiAddon?: unknown;

  /**
   * Optional session-level security configuration. When
   * `resolvePrincipal` is provided the kernel forwards the resolved
   * principal into Rust via `setActivePrincipal` at session start; all
   * policy evaluation happens in the Rust compute-security engine.
   */
  security?: DocumentSecurityConfig;

  /**
   * IANA timezone name representing the user's calendar frame for this session.
   * Required — see `IKernelContext.userTimezone`. Forwarded to
   * `createDocumentContext`; missing → `CONFIG_MISSING_USER_TIMEZONE`.
   */
  userTimezone: string;

  /** Document-scoped time authority. Direct factory paths must pass this explicitly. */
  clock: KernelClock;

  /**
   * Host contract context. When provided, the kernel uses the host-supplied
   * principal, storage, timezone, and runtime config instead of the legacy
   * per-field equivalents. The legacy fields above are still required for
   * existing code paths; the host context is additive (02a foundation).
   */
  kernelHostContext?: KernelHostContext;

  /** Trusted host/runtime resolver for cross-workbook links. */
  workbookLinkResolver?: WorkbookLinkResolver;

  /** Trusted host/runtime identity for the current open workbook session. */
  workbookLinkScope?: WorkbookLinkStatusScope;
}

/**
 * Host-compliant lifecycle config.
 *
 * This is a SEPARATE code path from legacy. It receives a validated
 * `KernelDocumentLifecycleInput` (output of
 * `validateKernelHostContextForDocument`) and does NOT read `environment`,
 * `napiAddon`, `security`, `initialSnapshot`, `yrsState`, raw provider
 * arrays, or runtime globals.
 *
 * The `environment` is derived from `lifecycleInput.runtime.config.kind`.
 */
export interface DocumentLifecycleConfigHost {
  /** Discriminant — always `'host-backed'`. */
  readonly kind: 'host-backed';
  /** Validated lifecycle input from the host validation gate. */
  readonly lifecycleInput: KernelDocumentLifecycleInput;
}

/**
 * Discriminated union of lifecycle configs. The `kind` field determines
 * which code path the `DocumentLifecycleSystem` takes. Legacy and host
 * configs cannot share state or accidentally mix fields.
 */
export type DocumentLifecycleConfig = DocumentLifecycleConfigLegacy | DocumentLifecycleConfigHost;

export interface AuthorizedRoomBootstrap {
  readonly source: 'collaboration-room-snapshot';
  readonly authority: {
    readonly kind: 'trusted-standalone-collaboration-room';
    readonly baseUrl: string;
  };
  readonly roomId: string;
  readonly roomUrl: string;
  readonly documentId: string;
  readonly participantId: string;
  readonly fullState: Uint8Array;
  readonly stateVector: Uint8Array;
  readonly roomEpoch: number;
  readonly fullStateHash: string;
  readonly snapshotToken: string;
  readonly snapshotTokenVersion: 'room-snapshot-v1';
  readonly fetchedAt: number;
}

export interface HostAuthorizedRoomCreateOptions {
  readonly skipDefaultSheet: true;
  readonly authorizedRoomBootstrap: AuthorizedRoomBootstrap;
}

// =============================================================================
// DocumentLifecycleSystem
// =============================================================================

export class DocumentLifecycleSystem {
  // ===========================================================================
  // Private State
  // ===========================================================================

  /** The owned XState actor */
  private readonly actor: DocumentLifecycleActor;

  /** Runtime environment */
  private readonly environment: 'browser' | 'headless';

  /** Pre-loaded NAPI addon (skips auto-discovery in transport factory) — legacy path only */
  private readonly napiAddon: unknown | undefined;

  /** Security configuration for data access control — legacy path only */
  private readonly securityConfig: DocumentSecurityConfig | undefined;

  /** IANA timezone name for the user's calendar frame this session */
  private readonly userTimezone: string;

  /** Document-scoped time authority */
  private readonly clock: KernelClock;

  /** Host contract context (02a foundation path) — legacy/cooperative path only */
  private readonly kernelHostContext: KernelHostContext | undefined;

  /** Trusted host/runtime resolver for cross-workbook links — legacy path only */
  private readonly workbookLinkResolver: WorkbookLinkResolver | undefined;

  /** Trusted host/runtime identity for the current open workbook session — legacy path only */
  private readonly workbookLinkScope: WorkbookLinkStatusScope | undefined;

  /**
   * Host-compliant lifecycle input — set only on the host-backed path.
   * When set, all construction reads from this rather than from the
   * individual legacy fields above.
   */
  private readonly hostLifecycleInput: KernelDocumentLifecycleInput | undefined;

  /** Whether the system has been disposed */
  private disposed = false;

  /** Ready callbacks (invoked when machine transitions to ready) */
  private readonly readyCallbacks = new Set<() => void>();

  /** State subscription cleanup */
  private stateSubscription: { unsubscribe(): void } | null = null;

  /** Previous state for transition detection */
  private previousState: string | null = null;

  /** Whether deferred Yrs hydration is pending (XLSX import fast-path) */
  private deferredHydrationPending = false;

  /** Stable import durability barrier for deferred import hydration. */
  private deferredHydrationPromise: Promise<void> | null = null;

  /** Pending delayed import durability timer, promoted by explicit barriers. */
  private deferredHydrationTimer: ReturnType<typeof setTimeout> | null = null;

  /** Starts a scheduled deferred hydration run before its background timer fires. */
  private startDeferredHydrationNow: (() => void) | null = null;

  /** True while imported content has not reached a full durable checkpoint. */
  private importDurabilityPending = false;

  /** Last deferred hydration/materialization failure, if any. */
  private materializationError: MaterializationState['error'] | null = null;

  /** Provider registry for the host-backed path (the storage provider lifecycle). */
  private readonly providerRegistry: StorageProviderRegistry;

  /** Preflight result from the most recent registry preflight (the storage provider lifecycle). */
  private preflightResult: ProviderPreflightResult | null = null;

  /** Host-owned provider materializers attached through adapter bindings. */
  private readonly hostProviderMaterializerHandles: ProviderMaterializerHandle[] = [];

  /** Provider refs staged for import-initialize durability promotion. */
  private readonly importInitializeProviderRefIds: string[] = [];

  /** Write gate instance — stored so lifecycle can transition modes on phase changes. */
  private _writeGate: WriteGate | null = null;

  /** Private host-authorized room state for collaboration first bootstrap. */
  private authorizedRoomBootstrap: AuthorizedRoomBootstrap | null = null;

  /** Timestamp of the last successful full-state checkpoint (the storage state lifecycle). */
  private _lastCheckpointAt: number | null = null;

  /** Current storage state — updated as lifecycle transitions happen (the storage provider lifecycle). */
  private _storageState: DocumentStorageState;

  /** Monotonic per-lifecycle generation for compute/database engine instances. */
  private engineInstanceGeneration = 0;

  // ===========================================================================
  // Constructor
  // ===========================================================================

  constructor(config: DocumentLifecycleConfig) {
    // -----------------------------------------------------------------------
    // Host-compliant path: derive all fields from the validated lifecycle
    // input. Do NOT read environment, napiAddon, security, initialSnapshot,
    // yrsState, raw provider arrays, or runtime globals.
    // -----------------------------------------------------------------------
    if (config.kind === 'host-backed') {
      const input = config.lifecycleInput;
      const transportConfig = mapHostRuntimeToTransportConfig(input.runtime);

      this.environment = transportConfig.environment;
      this.userTimezone = input.timezone.userTimezone;
      this.clock = input.clock;
      this.hostLifecycleInput = input;

      // Host path does NOT use legacy fields — set them to undefined/empty
      // so no actor implementation accidentally reads them.
      this.napiAddon = undefined;
      this.securityConfig = undefined;
      this.kernelHostContext = undefined;
      this.workbookLinkResolver = undefined;
      this.workbookLinkScope = undefined;

      // DO NOT call validateHostContext() — the input was already validated
      // when creating KernelDocumentLifecycleInput.
    } else {
      // -------------------------------------------------------------------
      // Legacy/cooperative path: existing behavior, unchanged.
      // -------------------------------------------------------------------
      this.environment = config.environment ?? 'browser';
      this.napiAddon = config.napiAddon;
      this.securityConfig = config.security;
      this.userTimezone = config.userTimezone;
      this.clock = config.clock;
      this.kernelHostContext = config.kernelHostContext;
      this.workbookLinkResolver = config.workbookLinkResolver;
      this.workbookLinkScope = config.workbookLinkScope;
      this.hostLifecycleInput = undefined;

      if (this.kernelHostContext) {
        validateHostContext(this.kernelHostContext);
      }
    }

    // Initialize provider registry and register all built-in factories.
    // Host-specific factories (hostCallback, readOnlySnapshot,
    // redactedPublishedSnapshot) are registered by the host adapter via
    // registerProviderFactory() before the first CREATE event.
    this.providerRegistry = new StorageProviderRegistry();
    registerDefaultFactories(this.providerRegistry);

    // Initialize storage state with idle defaults (the storage provider lifecycle).
    this._storageState = {
      mode: this.hostLifecycleInput
        ? this.hostLifecycleInput.storage.handoff.storage.durability
        : 'ephemeral',
      phase: 'idle',
      readOnly: false,
      durability: this.hostLifecycleInput
        ? this.hostLifecycleInput.storage.handoff.storage.durability
        : 'ephemeral',
      pendingUpdatesCount: 0,
      lastCheckpointAt: null,
      lastSyncAt: null,
      degradedProviders: [],
      errors: [],
    };

    // Provide real actor implementations to the machine
    const machineWithActors = documentLifecycleMachine.provide({
      actors: {
        createEngine: fromPromise<CreateEngineOutput, CreateEngineInput>(async ({ input }) =>
          this.executeCreateEngine(input),
        ),
        wireContext: fromPromise<WireContextOutput, WireContextInput>(async ({ input }) =>
          this.executeWireContext(input),
        ),
        startBridge: fromPromise<StartBridgeOutput, StartBridgeInput>(async ({ input }) =>
          this.executeStartBridge(input),
        ),
        hydrateXlsx: fromPromise<HydrateXlsxOutput, HydrateXlsxInput>(async ({ input }) =>
          this.executeHydrateXlsx(input),
        ),
        attachProviders: fromPromise<AttachProvidersOutput, AttachProvidersInput>(
          async ({ input }) =>
            this.executeAttachProviders({
              ...input,
              // Override the machine's "always-undefined" environment placeholder
              // with this DLS's owned environment value (machine context can't
              // hold ambient kernel config — the DLS is the source of truth).
              environment: this.environment,
            }),
        ),
        hydrateCsv: fromPromise<HydrateCsvOutput, HydrateCsvInput>(async ({ input }) =>
          this.executeHydrateCsv(input),
        ),
        disposeBridge: fromPromise<void, DisposeBridgeInput>(async ({ input }) =>
          this.executeDisposeBridge(input),
        ),
      },
    });

    // Create and start the actor.
    //
    // Host-compliant path: devtools inspection is driven by explicit
    // diagnostics/runtime config, not ambient `window.__OS_DEVTOOLS__`.
    // The inspect callback only fires on the legacy path.
    const isHostBacked = this.hostLifecycleInput !== undefined;
    this.actor = createActor(machineWithActors, {
      inspect: isHostBacked
        ? undefined
        : (evt) => {
            if (typeof window !== 'undefined')
              window.__OS_DEVTOOLS__?.reportActor?.('documentLifecycle', evt);
          },
    });

    // Subscribe to state transitions for ready callbacks
    this.stateSubscription = this.actor.subscribe((state) => {
      const currentState = state.value as string;

      // Detect transition to 'ready' state
      if (currentState === 'ready' && this.previousState !== 'ready') {
        for (const callback of this.readyCallbacks) {
          try {
            callback();
          } catch (err) {
            slog('documentLifecycle.readyCallbackFailed', { error: err });
          }
        }

        // Deferred hydration is triggered externally via scheduleDeferredHydration()
        // after the factory returns and the first viewport paint completes.
      }

      // Update storage state phase on every transition (the storage provider lifecycle).
      this.updateStoragePhase(currentState);

      this.previousState = currentState;
    });

    this.actor.start();
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  /**
   * Start creating a new document.
   * Sends CREATE event to the lifecycle machine.
   */
  create(docId: string, options: CreateDocumentOptions = {}): void {
    if (this.disposed) {
      throw new DocumentDisposedError(
        '[DocumentLifecycleSystem] Cannot create — system is disposed',
      );
    }
    this.actor.send({ type: 'CREATE', docId, options });
  }

  createHostBackedFromAuthorizedRoom(
    docId: string,
    options: HostAuthorizedRoomCreateOptions,
  ): void {
    if (this.disposed) {
      throw new DocumentDisposedError(
        '[DocumentLifecycleSystem] Cannot create — system is disposed',
      );
    }
    if (!this.hostLifecycleInput) {
      throw new Error(
        '[DocumentLifecycleSystem] authorized room bootstrap requires host-backed lifecycle input',
      );
    }
    if (
      this.hostLifecycleInput.documentId !== docId ||
      options.authorizedRoomBootstrap.documentId !== docId
    ) {
      throw new Error(
        `[DocumentLifecycleSystem] authorized room documentId mismatch: host=${this.hostLifecycleInput.documentId}, docId=${docId}, room=${options.authorizedRoomBootstrap.documentId}`,
      );
    }
    this.authorizedRoomBootstrap = options.authorizedRoomBootstrap;
    this.actor.send({ type: 'CREATE', docId, options: { skipDefaultSheet: true } });
  }

  /**
   * Start creating a document from an XLSX file.
   * Sends CREATE_FROM_XLSX event to the lifecycle machine.
   */
  createFromXlsx(
    docId: string,
    options: CreateDocumentOptions,
    xlsxSource: DocumentSource,
    importOptions?: DocumentImportOptions,
  ): void {
    if (this.disposed) {
      throw new DocumentDisposedError(
        '[DocumentLifecycleSystem] Cannot create — system is disposed',
      );
    }
    this.actor.send({
      type: 'CREATE_FROM_XLSX',
      docId,
      options,
      xlsxSource,
      importOptions,
    });
  }

  /**
   * Start creating a document from a CSV file.
   * Sends CREATE_FROM_CSV event to the lifecycle machine.
   */
  createFromCsv(
    docId: string,
    options: CreateDocumentOptions,
    csvSource: DocumentSource,
    csvImportOptions: CsvImportOptions | null,
  ): void {
    if (this.disposed) {
      throw new DocumentDisposedError(
        '[DocumentLifecycleSystem] Cannot create — system is disposed',
      );
    }
    this.actor.send({
      type: 'CREATE_FROM_CSV',
      docId,
      options,
      csvSource,
      csvImportOptions,
    });
  }

  /**
   * Returns a promise that resolves when the machine reaches 'ready' state.
   * Rejects if the machine reaches 'error' state.
   */
  waitForReady(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      // Check if already in a terminal state
      const currentSnapshot = this.actor.getSnapshot();
      if (documentLifecycleSelectors.isReady(currentSnapshot)) {
        resolve();
        return;
      }
      if (documentLifecycleSelectors.isError(currentSnapshot)) {
        reject(
          documentLifecycleSelectors.error(currentSnapshot) ??
            new Error('[DocumentLifecycleSystem] Machine is in error state'),
        );
        return;
      }

      // Subscribe and wait for ready or error
      const subscription = this.actor.subscribe((state) => {
        if (documentLifecycleSelectors.isReady(state)) {
          subscription.unsubscribe();
          resolve();
        } else if (documentLifecycleSelectors.isError(state)) {
          subscription.unsubscribe();
          reject(
            documentLifecycleSelectors.error(state) ??
              new Error('[DocumentLifecycleSystem] Machine reached error state'),
          );
        }
      });
    });
  }

  /**
   * Send a `TRAP` event to the machine — the underlying WASM module
   * observed a trap on this doc (or a sibling whose shared WASM died).
   * Transitions the machine to `error` with the trap as the context
   * error so the shell renders a per-doc TrapError UI.
   *
   * Idempotent: a second TRAP keeps the first one in context. TRAP from
   * `disposed` / `disposing` is a no-op. Safe to call from the recovery
   * coordinator across all live docs.
   *
   */
  sendTrap(trap: TrapError): void {
    if (this.disposed) return;
    this.actor.send({ type: 'TRAP', trap });
  }

  /**
   * Send a `RECOVER` event to the machine — the trap-recovery coordinator
   * has already (a) marked this doc failed via {@link sendTrap}, (b)
   * called `resetWasmModule()` so a fresh `WebAssembly.Instance` is
   * available, and now wants this DocumentLifecycleSystem to re-run the
   * `creating → ready` chain on the fresh instance.
   *
   * The OLD ComputeBridge / RustDocument refs in machine context are
   * dropped synchronously by the `storeRecoveryState` action — they
   * point into the dead WASM instance. The coordinator MUST have called
   * `bridge.destroy()` / `rustDocument.destroy()` on those refs before
   * dispatching RECOVER (otherwise their cleanup never runs).
   *
   * Optional `yrsState` bypasses IDB replay for this recovery — useful
   * for future R2 collaboration recovery flows where the coordinator
   * holds an authoritative state vector. v1 leaves this undefined and
   * lets `attachProviders` replay from this doc's IndexedDB on the
   * fresh WASM instance.
   *
   * Resolves once the machine reaches `ready` (or rejects if the
   * recovery itself errors out — e.g. the fresh WASM also traps on
   * this doc's persisted state, which means the doc is unrecoverable
   * and stays in `error`).
   */
  async recover(yrsState?: Uint8Array): Promise<void> {
    if (this.disposed) {
      throw new DocumentDisposedError(
        '[DocumentLifecycleSystem] Cannot recover — system is disposed',
      );
    }

    // Host-compliant path: recover(yrsState) is forbidden on host-backed
    // handles. Raw Yrs byte recovery requires an authorized raw-byte
    // recovery handoff that does not exist yet.
    if (this.hostLifecycleInput) {
      throw new EngineCreateError(
        '[DocumentLifecycleSystem] recover(yrsState) is forbidden on host-backed handles. ' +
          'Raw Yrs byte recovery requires an authorized raw-byte recovery handoff.',
      );
    }

    this.actor.send({ type: 'RECOVER', yrsState });
    return this.waitForReady();
  }

  /**
   * Send DISPOSE event and wait for the machine to reach 'disposed' state.
   */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;

    return new Promise<void>((resolve) => {
      const currentSnapshot = this.actor.getSnapshot();
      if ((currentSnapshot.value as string) === 'disposed') {
        this.cleanup();
        resolve();
        return;
      }

      const subscription = this.actor.subscribe((state) => {
        if ((state.value as string) === 'disposed') {
          subscription.unsubscribe();
          this.cleanup();
          resolve();
        }
      });

      this.actor.send({ type: 'DISPOSE' });
    });
  }

  /**
   * Current actor snapshot.
   */
  get snapshot(): DocumentLifecycleState {
    return this.actor.getSnapshot();
  }

  /**
   * Returns the DocumentContext from the machine context.
   * Throws if the machine is not in 'ready' state.
   */
  get documentContext(): DocumentContext {
    const snap = this.actor.getSnapshot();
    if (!documentLifecycleSelectors.isReady(snap)) {
      throw new DocumentNotReadyError(
        `[DocumentLifecycleSystem] documentContext accessed before ready (current phase: ${documentLifecycleSelectors.phase(snap)})`,
      );
    }
    const ctx = snap.context.documentContext;
    if (!ctx) {
      throw new DocumentNotReadyError(
        '[DocumentLifecycleSystem] documentContext is null despite ready state — this is a bug',
      );
    }
    return ctx;
  }

  /**
   * Returns the orchestrator (RustDocument) from the machine context.
   * Returns `null` if the machine has not yet created the engine
   * (still in `creating-engine` or earlier). Does **not** throw — the
   * shell's lifecycle hooks read this to fan `flushSync()` /
   * `pendingUpdatesCount` / `hasFlushFailed` calls across active docs,
   * and a partially-initialized doc should be silently ignored, not
   * crash the unload handler.
   */
  get rustDocument(): RustDocument | null {
    const snap = this.actor.getSnapshot();
    return snap.context.rustDocument ?? null;
  }

  /**
   * Returns the ComputeBridge from the machine context.
   * Throws if the machine is not in 'ready' state.
   */
  get computeBridge(): ComputeBridge {
    const snap = this.actor.getSnapshot();
    if (!documentLifecycleSelectors.isReady(snap)) {
      throw new DocumentNotReadyError(
        `[DocumentLifecycleSystem] computeBridge accessed before ready (current phase: ${documentLifecycleSelectors.phase(snap)})`,
      );
    }
    const bridge = snap.context.computeBridge;
    if (!bridge) {
      throw new DocumentNotReadyError(
        '[DocumentLifecycleSystem] computeBridge is null despite ready state — this is a bug',
      );
    }
    return bridge;
  }

  /**
   * Returns the first sheet ID from the machine context.
   * Throws if the machine is not in 'ready' state.
   */
  get initialSheetId(): SheetId {
    const snap = this.actor.getSnapshot();
    if (!documentLifecycleSelectors.isReady(snap)) {
      throw new DocumentNotReadyError(
        `[DocumentLifecycleSystem] initialSheetId accessed before ready (current phase: ${documentLifecycleSelectors.phase(snap)})`,
      );
    }
    const ids = snap.context.initialSheetIds;
    if (!ids || ids.length === 0) {
      throw new DocumentNotReadyError(
        '[DocumentLifecycleSystem] initialSheetIds is empty despite ready state — this is a bug',
      );
    }
    return ids[0];
  }

  /**
   * Whether this lifecycle has pending deferred Yrs hydration.
   */
  get hasDeferredHydration(): boolean {
    return this.deferredHydrationPending;
  }

  get isImportDurabilityPending(): boolean {
    return this.importDurabilityPending;
  }

  /**
   * Current storage state (the storage provider lifecycle). Reactive — updated on every lifecycle
   * transition. Exposed through DocumentHandle for UI status indicators.
   */
  get storageState(): DocumentStorageState {
    return this._storageState;
  }

  /** Timestamp of the last successful full-state checkpoint (the storage state lifecycle). */
  get lastCheckpointAt(): number | null {
    return this._lastCheckpointAt;
  }

  /** Map the current XState machine state to a public storage phase (the storage state lifecycle). */
  get currentPhase(): 'initializing' | 'attaching' | 'ready' | 'disposing' | 'disposed' | 'error' {
    if (!this.actor) return 'initializing';
    const snap = this.actor.getSnapshot();
    const value = snap.value;
    if (typeof value === 'string') {
      switch (value) {
        case 'idle':
        case 'creating':
        case 'wiring':
        case 'starting':
        case 'hydrating':
        case 'hydrating_csv':
          return 'initializing';
        case 'attaching':
          return 'attaching';
        case 'ready':
          return 'ready';
        case 'disposing':
          return 'disposing';
        case 'disposed':
          return 'disposed';
        case 'error':
          return 'error';
        default:
          return 'initializing';
      }
    }
    return 'initializing';
  }

  /** Whether this lifecycle is running in headless (non-browser) mode (the storage state lifecycle). */
  get isHeadless(): boolean {
    return this.environment === 'headless';
  }

  /**
   * The provider registry for this lifecycle (the storage provider lifecycle). Host adapters
   * register factories before the first CREATE event.
   */
  get registry(): StorageProviderRegistry {
    return this.providerRegistry;
  }

  /**
   * Register a provider factory on this lifecycle's registry.
   * Convenience method — delegates to the registry.
   */
  registerProviderFactory(kind: StorageProviderKind, factory: ProviderFactory): void {
    this.providerRegistry.registerFactory(kind, factory);
  }

  async awaitImportDurability(): Promise<void> {
    await this.ensureDeferredHydration();
  }

  ensureDeferredHydration(): Promise<void> {
    return this.scheduleDeferredHydration({ immediate: true });
  }

  async awaitMaterialized(scope: SheetId | 'allSheets' = 'allSheets'): Promise<void> {
    const initialActiveSheetId = this.getInitialActiveSheetId();

    if (scope !== 'allSheets' && initialActiveSheetId === scope) {
      return;
    }

    if (scope !== 'allSheets' && !this.isKnownSheetId(scope)) {
      throw this.materializationFailure({
        code: 'sheet_not_found',
        scope,
        message: `Sheet ${scope} is not part of this document.`,
      });
    }

    if (this.materializationError) {
      throw this.materializationFailure(this.materializationError);
    }

    await this.ensureDeferredHydration();
  }

  getMaterializationState(): MaterializationState {
    const snap = this.actor.getSnapshot();
    const initialActiveSheetId = this.getInitialActiveSheetId();

    if (this.materializationError) {
      return {
        phase: 'MaterializationFailed',
        isDeferred: true,
        isMaterialized: false,
        pendingScope: 'allSheets',
        initialActiveSheetId,
        error: this.materializationError,
      };
    }

    if (
      this.deferredHydrationPromise ||
      this.deferredHydrationTimer ||
      this.startDeferredHydrationNow
    ) {
      return {
        phase: 'AllSheetsHydrating',
        isDeferred: true,
        isMaterialized: false,
        pendingScope: 'allSheets',
        initialActiveSheetId,
      };
    }

    if (this.deferredHydrationPending || this.importDurabilityPending) {
      return {
        phase: 'CriticalSheetReady',
        isDeferred: true,
        isMaterialized: false,
        pendingScope: 'allSheets',
        initialActiveSheetId,
      };
    }

    return {
      phase: 'AllSheetsReady',
      isDeferred: false,
      isMaterialized: true,
      initialActiveSheetId,
    };
  }

  private getInitialActiveSheetId(): SheetId | undefined {
    const snap = this.actor.getSnapshot();
    if (!documentLifecycleSelectors.isReady(snap)) return undefined;
    return snap.context.initialSheetIds?.[0];
  }

  private isKnownSheetId(sheetId: SheetId): boolean {
    const snap = this.actor.getSnapshot();
    if (!documentLifecycleSelectors.isReady(snap)) return true;
    const ids = snap.context.initialSheetIds ?? [];
    return ids.includes(sheetId);
  }

  private materializationFailure(details: MaterializationState['error']): Error {
    const err = new Error(details?.message ?? 'XLSX materialization failed') as Error & {
      code?: string;
      scope?: SheetId | 'allSheets';
    };
    err.code = details?.code ?? 'materialization_failed';
    err.scope = details?.scope;
    return err;
  }

  /**
   * Schedule the deferred Yrs CRDT hydration.
   * Call AFTER the first viewport paint to avoid blocking the UI.
   * The heavy Yrs write (~2s) runs asynchronously.
   */
  scheduleDeferredHydration(options?: { immediate?: boolean }): Promise<void> {
    if (this.deferredHydrationPromise) {
      if (options?.immediate) {
        this.startDeferredHydrationNow?.();
      }
      return this.deferredHydrationPromise;
    }
    if (!this.deferredHydrationPending) return Promise.resolve();
    const snap = this.actor.getSnapshot();
    const bridge = snap.context.computeBridge;
    if (!bridge) {
      this.deferredHydrationPending = false;
      this.importDurabilityPending = false;
      return Promise.resolve();
    }

    const run = async () => {
      this.materializationError = null;
      markPerformance('dls:deferredHydration:start');
      if (snap.context.rustDocument) {
        await this.completeImportDurability(bridge, snap.context.rustDocument, true);
      } else {
        await bridge.completeDeferredHydration();
      }
      markPerformance('dls:deferredHydration:end');
      measurePerformance(
        'dls:deferredHydration',
        'dls:deferredHydration:start',
        'dls:deferredHydration:end',
      );
      const m = performance.getEntriesByName('dls:deferredHydration', 'measure')[0];
      if (m) {
        slog('documentLifecycle.deferredHydrationMeasure', { durationMs: m.duration });
      }

      // Deferred hydration just populated engine state that the first-paint
      // viewport buffers never saw — most notably the CF render cache
      // (`init_cf_caches`), which carries data-bar fill ratios and icon-set
      // buckets. Those render extras live only in the viewport binary buffer
      // (unlike color-scale/style fills, which read through the live
      // displayed-format cascade), so a coordinator whose buffer was committed
      // before completion keeps showing no bars/icons until some unrelated
      // scroll/resize forces a refetch. Mirror the post-Provider-replay path
      // (see `forceRefreshAllViewports` in attachProviders) and refresh every
      // registered coordinator from Rust now that the cache is complete. No-op
      // when no coordinator is registered yet.
      try {
        await bridge.forceRefreshAllViewports();
      } catch (err) {
        slog('documentLifecycle.deferredHydrationForceRefreshAllViewportsFailed', { error: err });
      }

      this.deferredHydrationPending = false;
    };

    // Use a macrotask after the app's first paint. Host-backed browser imports
    // get a grace period so the user-visible open path can finish first-contact
    // interactions before the heavy durability barrier runs. Explicit
    // durability/materialization barriers promote the scheduled run immediately,
    // so close/dispose never waits out the background grace period.
    this.importDurabilityPending = true;
    const delayMs =
      !options?.immediate && this.hostLifecycleInput !== undefined && this.environment === 'browser'
        ? 60_000
        : 0;
    const scheduled = new Promise<void>((resolve, reject) => {
      const start = () => {
        if (this.startDeferredHydrationNow !== start) return;
        if (this.deferredHydrationTimer !== null) {
          clearTimeout(this.deferredHydrationTimer);
        }
        this.deferredHydrationTimer = null;
        this.startDeferredHydrationNow = null;
        void run().then(resolve, reject);
      };
      this.startDeferredHydrationNow = start;
      if (delayMs > 0) {
        this.deferredHydrationTimer = setTimeout(start, delayMs);
      } else {
        start();
      }
    });
    this.deferredHydrationPromise = scheduled
      .catch((err) => {
        this.deferredHydrationTimer = null;
        this.startDeferredHydrationNow = null;
        this.deferredHydrationPromise = null;
        this.deferredHydrationPending = true;
        this.materializationError = {
          code: 'materialization_failed',
          message: err instanceof Error ? err.message : String(err),
          scope: 'allSheets',
        };
        throw err;
      })
      .finally(() => {
        this.deferredHydrationTimer = null;
        this.startDeferredHydrationNow = null;
        this.importDurabilityPending = this.deferredHydrationPending;
      });
    void this.deferredHydrationPromise.catch((err) => {
      slog('documentLifecycle.deferredHydrationDurabilityBarrierFailed', { error: err });
    });
    return this.deferredHydrationPromise;
  }

  /**
   * Register a callback for when the machine reaches 'ready' state.
   * If already ready, the callback is invoked immediately.
   * Returns an unsubscribe function.
   */
  onReady(callback: () => void): () => void {
    // If already ready, invoke immediately
    const snapshot = this.actor.getSnapshot();
    if (documentLifecycleSelectors.isReady(snapshot)) {
      callback();
    }

    // Also register for future ready transitions
    this.readyCallbacks.add(callback);
    return () => {
      this.readyCallbacks.delete(callback);
    };
  }

  // ===========================================================================
  // Actor Implementations (Side Effects)
  // ===========================================================================

  /**
   * createEngine actor implementation.
   *
   * Two code paths:
   *
   * **Host-compliant path** (`this.hostLifecycleInput` set):
   *   - Document ID comes from `lifecycleInput.documentId`, not caller options
   *   - Transport config from explicit runtime mapping, no auto-detection
   *   - Does NOT read window.__OS_DEVTOOLS__, window.__TAURI__, indexedDB,
   *     document, navigator, or process timezone
   *   - Does NOT accept initialSnapshot or yrsState
   *
   * **Legacy/cooperative path** (existing behavior):
   *   1. Dynamic import createComputeBridge
   *   2. Create bridge with DeferredContext
   *   3. Create RustDocument (the orchestrator)
   *   4. await rustDocument.ready (engine init + update_v1 subscription wired)
   *   5. Instantiate the right Provider for the runtime (browser → IndexedDB,
   *      Tauri → TauriFileProvider, headless → none) and attach.
   *
   * Headless mode attaches no Providers. The orchestrator's empty-list path is
   * the no-persistence branch.
   */
  private async executeCreateEngine(input: CreateEngineInput): Promise<CreateEngineOutput> {
    try {
      const engineInstanceId = this.allocateEngineInstanceId(input.docId);
      markPerformance('dls:createEngine:start');
      markPerformance('dls:createEngine:imports:start');
      // Dynamic import to avoid circular dependencies and enable code splitting
      const { createComputeBridge } = await import('../bridges/compute/compute-bridge');
      const { initTableWasm } = await import('@mog/table-engine');
      const { initChartWasm } = await import('../domain/charts/chart-bridge');
      const { RustDocument: RustDocumentClass } = await import('./rust-document');
      markPerformance('dls:createEngine:imports:end');
      measurePerformance(
        'dls:createEngine:imports',
        'dls:createEngine:imports:start',
        'dls:createEngine:imports:end',
      );

      // =====================================================================
      // Host-compliant path: explicit transport config, no global sniffing
      // =====================================================================
      if (this.hostLifecycleInput) {
        const lifecycleInput = this.hostLifecycleInput;
        const transportConfig = mapHostRuntimeToTransportConfig(lifecycleInput.runtime);
        const hostTransportConfig = lifecycleInput.runtime.transportConfig;
        const userTimezone = lifecycleInput.timezone.userTimezone;

        // Document ID is derived from the authorized handoff, not caller options.
        const docId = lifecycleInput.documentId;
        const authorizedRoomBootstrap = this.authorizedRoomBootstrap;
        if (authorizedRoomBootstrap && authorizedRoomBootstrap.documentId !== docId) {
          throw new Error(
            `[DocumentLifecycleSystem] authorized room bootstrap documentId mismatch: ${authorizedRoomBootstrap.documentId} !== ${docId}`,
          );
        }

        markPerformance('dls:createEngine:bridge:start');
        const computeBridge = await createComputeBridge(DeferredContext, engineInstanceId, {
          ...(typeof hostTransportConfig === 'object' && hostTransportConfig !== null
            ? (hostTransportConfig as Record<string, unknown>)
            : {}),
          wasmInitFns: [initTableWasm, initChartWasm],
          explicitRuntime: transportConfig.explicitRuntime,
          forbidAutoDetect: true,
          getUserTimezone: () => userTimezone,
          // Host path uses explicit transport config — napiAddon only from
          // the transport config, never from legacy this.napiAddon.
          ...(transportConfig.napiAddon
            ? {
                napiAddon: transportConfig.napiAddon as Record<
                  string,
                  (...args: unknown[]) => unknown
                >,
              }
            : {}),
        });
        markPerformance('dls:createEngine:bridge:end');
        measurePerformance(
          'dls:createEngine:bridge',
          'dls:createEngine:bridge:start',
          'dls:createEngine:bridge:end',
        );

        // Host path: normal creation does not accept initialSnapshot or yrsState.
        // Collaboration bootstrap is the only named private handoff that may
        // carry room-owned Yrs bytes into the host-backed lifecycle.
        markPerformance('dls:createEngine:rustDoc:start');
        const rustDocument = new RustDocumentClass({
          docId,
          computeBridge,
          skipDefaultSheet: true, // host path defers sheet creation to attachProviders
          skipPersistenceLoad: transportConfig.environment === 'headless',
          yrsState: authorizedRoomBootstrap?.fullState,
          internal: false,
        });

        await rustDocument.ready;
        markPerformance('dls:createEngine:rustDoc:end');
        measurePerformance(
          'dls:createEngine:rustDoc',
          'dls:createEngine:rustDoc:start',
          'dls:createEngine:rustDoc:end',
        );

        markPerformance('dls:createEngine:end');
        measurePerformance('dls:createEngine', 'dls:createEngine:start', 'dls:createEngine:end');
        return { computeBridge, rustDocument };
      }

      // =====================================================================
      // Legacy/cooperative path: existing behavior
      // =====================================================================

      // Create ComputeBridge with DeferredContext — bridge starts in CREATED phase.
      // The real DocumentContext will be wired in the 'wiring' state via setContext().
      // WASM init callbacks wire table-engine and chart WASM backends on first load.
      //
      // userTimezone is supplied directly from this DLS instance (which owns the
      // session value) rather than read from `ctx.userTimezone` — the ctx here is
      // DeferredContext, which throws on any property access. Without this
      // override, the time-injection transport's getUserTimezone callback would
      // hit DeferredContext on the first recalc command and crash setup.
      //
      const userTimezone = this.userTimezone;
      markPerformance('dls:createEngine:bridge:start');
      const computeBridge = await createComputeBridge(DeferredContext, engineInstanceId, {
        wasmInitFns: [initTableWasm, initChartWasm],
        getUserTimezone: () => userTimezone,
        ...(this.napiAddon
          ? {
              explicitRuntime: 'napi',
              napiAddon: this.napiAddon as Record<string, (...args: unknown[]) => unknown>,
            }
          : {}),
      });

      markPerformance('dls:createEngine:bridge:end');
      measurePerformance(
        'dls:createEngine:bridge',
        'dls:createEngine:bridge:start',
        'dls:createEngine:bridge:end',
      );

      // Create RustDocument (the Provider Protocol orchestrator).
      //
      // - Headless mode: no Providers attached; the orchestrator's empty
      //   `providers[]` path is the headless branch.
      // - `internal: true` is forwarded from CreateDocumentOptions so the
      //   shell's fallback doc opts out of `touchDoc`.
      markPerformance('dls:createEngine:rustDoc:start');
      const rustDocument = new RustDocumentClass({
        docId: input.docId,
        computeBridge,
        skipDefaultSheet: input.options.skipDefaultSheet,
        skipPersistenceLoad: this.environment === 'headless',
        initialSnapshot: input.options.initialSnapshot,
        yrsState: input.options.yrsState,
        internal: input.options.internal,
      });

      // Wait for the orchestrator to finish engine init + wire its single
      // `subscribeUpdateV1` subscription. After this, Providers can attach.
      await rustDocument.ready;
      markPerformance('dls:createEngine:rustDoc:end');
      measurePerformance(
        'dls:createEngine:rustDoc',
        'dls:createEngine:rustDoc:start',
        'dls:createEngine:rustDoc:end',
      );

      // Attach the runtime-appropriate Provider. Selection precedence:
      //   1. Headless / Node.js: no Provider attached. The orchestrator's
      //      empty `providers[]` path is the headless branch.
      //   2. Tauri runtime (window.__TAURI__): no Provider attached yet.
      //      Tauri keeps its existing native XLSX I/O for save; the
      //      TauriFileProvider import keeps the interface live but the IPC is
      //      not wired yet.
      //      Wiring lands in future native sidecar; until then, attaching a provider
      //      whose `attach()` throws would block doc open on every
      //      Tauri launch. The orchestrator + bridge are still subscribed
      //      to update_v1 — the queue drains to zero providers, which is
      //      the same behavior as headless.
      //   3. Browser (default, no Tauri runtime): IndexedDBProvider —
      //      wires the compaction ProviderDoc factory so transient docs
      //      build via the real bridge, not the test mock.
      // Provider attach was historically here, but it must run AFTER
      // wireContext + startBridge: `Provider.attach()` replays bytes into
      // the doc via `bridge-provider-doc.applyUpdate`, which goes through
      // `ComputeBridge.syncApply → mutate`, which requires the bridge to
      // be in STARTED phase with a real DocumentContext (services, undo,
      // etc.) wired. Running attach here against a CREATED-phase bridge
      // throws DocumentNotReadyError on the first persisted snapshot.
      //
      // Provider attach now runs in a dedicated `attachProviders` actor
      // after `startBridge`. See {@link executeAttachProviders}.

      markPerformance('dls:createEngine:end');
      measurePerformance('dls:createEngine', 'dls:createEngine:start', 'dls:createEngine:end');
      return { computeBridge, rustDocument };
    } catch (error) {
      throw new EngineCreateError(`Engine creation failed for doc ${input.docId}`, {
        cause: error,
      });
    }
  }

  /**
   * attachProviders actor implementation.
   *
   * Provider attach was previously inside `executeCreateEngine` but had to
   * move out: `Provider.attach()` replays persisted bytes via
   * `bridge-provider-doc.applyUpdate → ComputeBridge.syncApply → mutate`,
   * which requires the bridge to be in STARTED phase with a real
   * DocumentContext (services/undo/etc.) wired. The CREATING actor's
   * bridge is in CREATED phase with `DeferredContext` — accessing
   * `services` throws `DocumentNotReadyError` synchronously on the first
   * persisted snapshot.
   *
   * This actor runs AFTER `startBridge` (and after `hydrateXlsx` for the
   * XLSX-import path), so attach is safe.
   *
   * Provider selection precedence:
   *   1. `internal: true` (per-app placeholder, `os-fallback-doc`) — no
   *      Provider attached. Same orchestrator behavior
   *      as headless: empty `providers[]`, the update_v1 queue drains
   *      to no sinks.
   *   2. Headless / Node — no Provider attached.
   *   3. Tauri runtime (`window.__TAURI__`) — no Provider attached yet;
   *      Tauri keeps native XLSX I/O for save.
   *   4. Browser (default, no Tauri) — IndexedDBProvider attached, with
   *      the compaction ProviderDoc factory wired.
   */
  private async executeAttachProviders(
    input: AttachProvidersInput,
  ): Promise<AttachProvidersOutput> {
    markPerformance('dls:attachProviders:start');

    // =====================================================================
    // Host-compliant path: provider selection is driven by the authorized
    // storage handoff, not by runtime sniffing. For 02a foundation, only
    // ephemeral storage is wired — durable providers land in the storage provider lifecycle.
    // =====================================================================
    if (this.hostLifecycleInput) {
      const lifecycleInput = this.hostLifecycleInput;
      const storageConfig = lifecycleInput.storage.handoff.storage;
      const durability = storageConfig.durability;
      const requiresProviderAttach =
        durability !== 'ephemeral' || storageConfig.providers.some((p) => p.required);
      const { preflightAuthorizedStorage } = await import('./host-storage-preflight');
      const preflightDurability = durability === 'ephemeral' ? 'ephemeral' : 'durableLocal';
      const storageProvidersForPreflight = storageConfig.providers.map((providerConfig) => ({
        providerRefId: providerConfig.providerRefId,
        kind: providerConfig.kind,
        role: providerConfig.role,
        authorityRef: providerConfig.authorityRef,
        storageScope: providerConfig.storageScope,
        redactedConfigFingerprint: normalizeHostCanonicalFingerprint(
          providerConfig.redactedConfigFingerprint,
        ),
      }));
      preflightAuthorizedStorage({
        authorizedProviders: [...(lifecycleInput.storage.handoff.authorizedProviders ?? [])],
        storageProviders: storageProvidersForPreflight,
        durability: preflightDurability,
        storageConstraint: lifecycleInput.storage.handoff.storageConstraint,
        diagnostics: lifecycleInput.diagnostics,
      });

      if (requiresProviderAttach && storageConfig.providers.length === 0) {
        lifecycleInput.diagnostics.emit({
          kind: 'storage.failure',
          code: 'PROVIDER_ATTACH_NO_PROVIDERS',
          correlationId: lifecycleInput.session.correlationRootId,
          providerRefId: 'host-storage',
          phase: 'attach',
          timestamp: lifecycleInput.clock.now(),
        });
        throw new Error(
          `Host-backed storage requires provider attachment for durability '${durability}', but storage config contains no providers`,
        );
      }

      if (storageConfig.providers.length > 0) {
        this.updateStoragePhase('attachingProviders');
        const authorizedByRef = new Map(
          (lifecycleInput.storage.handoff.authorizedProviders ?? []).map((p) => [
            p.providerRefId,
            p,
          ]),
        );
        const roleOrder: Record<string, number> = {
          authority: 0,
          cache: 1,
          replica: 2,
          snapshot: 3,
          exportSink: 4,
        };
        const sorted = [...storageConfig.providers].sort((a, b) => {
          const ra = roleOrder[a.role] ?? 99;
          const rb = roleOrder[b.role] ?? 99;
          return ra - rb;
        });

        for (const providerConfig of sorted) {
          const authorized = authorizedByRef.get(providerConfig.providerRefId);
          if (!authorized) {
            throw new Error(
              `Host-backed provider '${providerConfig.providerRefId}' is missing authorized provider metadata`,
            );
          }
          if (
            !lifecycleInput.bindings.bindings.providerMaterializers.has(
              providerConfig.providerRefId,
            )
          ) {
            lifecycleInput.diagnostics.emit({
              kind: 'storage.failure',
              code: 'PROVIDER_MATERIALIZER_MISSING_AT_ATTACH',
              correlationId: lifecycleInput.session.correlationRootId,
              providerRefId: providerConfig.providerRefId,
              phase: 'attach',
              timestamp: lifecycleInput.clock.now(),
            });
            throw new Error(
              `Host-backed provider '${providerConfig.providerRefId}' has no bound materializer`,
            );
          }
          const handle = await lifecycleInput.bindings.bindings.providerMaterializers.resolve({
            providerRefId: providerConfig.providerRefId,
            decisionId: lifecycleInput.storage.handoff.decisionId,
            nonce: lifecycleInput.storage.handoff.nonce,
            expiresAt: lifecycleInput.storage.handoff.expiresAt,
            principalFingerprint: lifecycleInput.operationAuthorization.principalFingerprint,
            resourceContextFingerprint:
              lifecycleInput.operationAuthorization.resourceContextFingerprint,
            storageScope: authorized.storageScope,
            authorityRef: authorized.authorityRef,
            redactedConfigFingerprint: authorized.redactedConfigFingerprint,
            rawBytesPolicy: lifecycleInput.storage.handoff.rawBytesPolicy,
            kind: providerConfig.kind,
            role: providerConfig.role,
          });
          if (
            !handle ||
            handle.providerRefId !== providerConfig.providerRefId ||
            handle.materialized !== true
          ) {
            lifecycleInput.diagnostics.emit({
              kind: 'storage.failure',
              code: 'PROVIDER_MATERIALIZER_RESULT_MISMATCH',
              correlationId: lifecycleInput.session.correlationRootId,
              providerRefId: providerConfig.providerRefId,
              phase: 'attach',
              timestamp: lifecycleInput.clock.now(),
            });
            throw new Error(
              `Host-backed provider materializer returned an invalid handle for '${providerConfig.providerRefId}'`,
            );
          }
          await handle.attach(
            input.rustDocument,
            input.importInitialize
              ? {
                  mode: { kind: 'importInitialize', replaceExisting: true },
                  suppressInitialBaseline: true,
                  suppressQueuedUpdates: true,
                  suppressTouch: true,
                }
              : undefined,
          );
          this.hostProviderMaterializerHandles.push(handle);
          if (input.importInitialize) {
            this.recordImportInitializeProviderRefId(handle.providerRefId);
          }
        }
        this.updateStoragePhase(
          lifecycleInput.storage.handoff.storageConstraint === 'read-only'
            ? 'readyReadOnly'
            : durability === 'ephemeral'
              ? 'readyEphemeral'
              : 'readyReadWrite',
        );
      } else {
        // -----------------------------------------------------------------------
        // the storage provider lifecycle: Registry-based provider preflight on the host-backed path.
        // If factories have been registered, use the registry to validate the
        // composition and instantiate providers. Durable/required storage with no
        // usable factory fails closed instead of degrading to zero-provider mode.
        // -----------------------------------------------------------------------
        const hasRegisteredFactories = storageConfig.providers.some((p) =>
          this.providerRegistry.hasFactory(p.kind),
        );

        if (hasRegisteredFactories) {
          this.updateStoragePhase('preflightingProviders');

          const preflightResult = await this.providerRegistry.preflight(storageConfig);
          this.preflightResult = preflightResult;

          const requiredProviderRefIds = new Set(
            storageConfig.providers.filter((p) => p.required).map((p) => p.providerRefId),
          );
          const hasRequiredProviderViolation = preflightResult.compositionResult.violations.some(
            (v) =>
              (v.involvedProviderRefIds ?? []).some((providerRefId) =>
                requiredProviderRefIds.has(providerRefId),
              ),
          );
          const mustFailClosed =
            !preflightResult.compositionResult.valid &&
            (!storageConfig.allowReadOnlyFallback ||
              durability !== 'ephemeral' ||
              hasRequiredProviderViolation);

          if (mustFailClosed) {
            lifecycleInput.diagnostics.emit({
              kind: 'storage.failure',
              code: 'COMPOSITION_INVALID',
              correlationId: lifecycleInput.session.correlationRootId,
              providerRefId: 'registry',
              phase: 'preflight',
              timestamp: lifecycleInput.clock.now(),
            });

            this._storageState = {
              ...this._storageState,
              phase: 'error',
              errors: preflightResult.compositionResult.violations.map((v) => ({
                code: v.code,
                phase: 'preflightingProviders' as DocumentStoragePhase,
                message: v.message,
                retryable: false,
                timestamp: Date.now(),
              })),
            };

            throw new Error(
              `Provider composition invalid: ${preflightResult.compositionResult.violations.map((v) => v.message).join('; ')}`,
            );
          }

          if (requiresProviderAttach && preflightResult.providers.length === 0) {
            lifecycleInput.diagnostics.emit({
              kind: 'storage.failure',
              code: 'PROVIDER_ATTACH_NO_MATERIALIZED_PROVIDERS',
              correlationId: lifecycleInput.session.correlationRootId,
              providerRefId: 'host-storage',
              phase: 'attach',
              timestamp: lifecycleInput.clock.now(),
            });
            throw new Error(
              `Host-backed storage requires provider attachment for durability '${durability}', but no providers were materialized`,
            );
          }

          // Update storage state with effective durability and ready mode
          this._storageState = {
            ...this._storageState,
            durability: preflightResult.compositionResult.effectiveDurability,
            readOnly: preflightResult.selectedReadyMode === 'readyReadOnly',
          };

          // Attach preflighted providers in deterministic order:
          // authority first (replay must happen before cache sees state),
          // then cache, then all other roles.
          this.updateStoragePhase('attachingProviders');
          const roleOrder: Record<string, number> = {
            authority: 0,
            cache: 1,
            replica: 2,
            snapshot: 3,
            exportSink: 4,
          };
          const sorted = [...preflightResult.providers].sort((a, b) => {
            const ra = roleOrder[a.config.role] ?? 99;
            const rb = roleOrder[b.config.role] ?? 99;
            return ra - rb;
          });

          for (const instance of sorted) {
            if (input.importInitialize) {
              await input.rustDocument.attachProvider(instance.provider, {
                mode: { kind: 'importInitialize', replaceExisting: true },
                suppressInitialBaseline: true,
                suppressQueuedUpdates: true,
                suppressTouch: true,
              });
              this.recordImportInitializeProviderRefId(instance.config.providerRefId);
            } else {
              await input.rustDocument.attachProvider(instance.provider);
            }
          }

          // Transition storage phase to the selected ready mode
          this.updateStoragePhase(preflightResult.selectedReadyMode);
        } else if (requiresProviderAttach) {
          lifecycleInput.diagnostics.emit({
            kind: 'storage.failure',
            code: 'PROVIDER_ATTACH_UNSUPPORTED',
            correlationId: lifecycleInput.session.correlationRootId,
            providerRefId: 'host-storage',
            phase: 'attach',
            timestamp: lifecycleInput.clock.now(),
          });
          throw new Error(
            `Host-backed storage requires provider attachment for durability '${durability}', but no registered provider factory matched the authorized storage config`,
          );
        }
      }

      const skipDefaultSheet = input.skipDefaultSheet ?? false;
      if (!skipDefaultSheet) {
        const existingSheets = await input.computeBridge.getAllSheetIds();
        if (existingSheets.length === 0) {
          await input.computeBridge.createDefaultSheet('Sheet1');
        }
      }
      const sheetIds = await input.computeBridge.getAllSheetIds();

      markPerformance('dls:attachProviders:end');
      measurePerformance(
        'dls:attachProviders',
        'dls:attachProviders:start',
        'dls:attachProviders:end',
      );
      return { sheetIds };
    }

    // Provider selection precedence:
    //   - internal/fallback docs (per-app placeholder, os-fallback) opt out;
    //   - headless mode has no Provider;
    //   - Tauri keeps native XLSX I/O for save;
    //   - jsdom-style envs without `indexedDB` skip silently;
    //   - browser default attaches IndexedDBProvider.
    let providerAttached = false;
    if (
      !input.internal &&
      input.environment !== 'headless' &&
      typeof (globalThis as { window?: { __TAURI__?: unknown } }).window?.__TAURI__ ===
        'undefined' &&
      typeof indexedDB !== 'undefined'
    ) {
      const { IndexedDBProvider } = await import('./providers/indexeddb-provider');
      const { createBridgeBackedProviderDoc } = await import('./providers/bridge-provider-doc');
      const provider = new IndexedDBProvider(input.docId);
      provider.setProviderDocFactory((docId) =>
        createBridgeBackedProviderDoc(input.computeBridge, docId),
      );
      if (input.importInitialize) {
        await input.rustDocument.attachProvider(provider, {
          mode: { kind: 'importInitialize', replaceExisting: true },
          suppressInitialBaseline: true,
          suppressQueuedUpdates: true,
          suppressTouch: true,
        });
        this.recordImportInitializeProviderRefId(provider.getIdentity().providerRefId);
      } else {
        await input.rustDocument.captureInitialProviderBaseline();
        await input.rustDocument.attachProvider(provider);
      }
      providerAttached = true;
    }

    // Sheet truth lands post-attach.
    //
    // `executeStartBridge` deferred default-sheet creation: this is where
    // we settle the sheet set. Two cases:
    //
    //   1. Provider attach replayed bytes that contain ≥1 sheet — use
    //      those as `initialSheetIds`. The replayed sheets ARE the user's
    //      doc; no synthetic blank sheet should appear alongside them.
    //
    //   2. No replay produced any sheet (genuine fresh blank doc, or
    //      headless / internal opt-out) — create the default "Sheet1"
    //      now via `createDefaultSheet`. Same `ORIGIN_BOOTSTRAP` route as
    //      pre-Current so the implicit sheet doesn't land on the undo
    //      stack (api-eval `history/undo-redo-state`,
    //      `history/undo-state-tracking`).
    //
    // The XLSX-import path runs `hydrateXlsx` BEFORE `attaching`; by the
    // time we get here the imported sheets already exist, so case (1)
    // applies and we don't double-create. The pre-fix duplicate-sheet
    // bug (refresh after edit shows blank because workbook mounts on the
    // empty `S_new` while data lives on the replayed `S_orig`) is now
    // structurally impossible — there IS no `S_new`.
    const skipDefaultSheet = input.skipDefaultSheet ?? false;
    if (!skipDefaultSheet) {
      const existingSheets = await input.computeBridge.getAllSheetIds();
      if (existingSheets.length === 0) {
        // Bootstrap path: `compute_create_default_sheet` returns a
        // hydration-shape MutationResult (per
        // `mutation_create_default_sheet` in compute/core), so the kernel
        // state mirror sees a full SheetSettingsChange + WorkbookSettingsChange
        // on first paint — same shape as XLSX/CSV import.
        await input.computeBridge.createDefaultSheet('Sheet1');
      } else if (providerAttached && !this.deferredHydrationPending) {
        // Pure-replay path: Provider attach replayed Yrs updates via
        // `syncApply`, populating the engine without ever flowing a
        // `MutationResult` through the kernel mirror. Emit a
        // hydration-shape result now so the mirror sees the post-replay
        // snapshot for every sheet (workbook settings, frozen panes,
        // print state, sheet metadata, ...). Idempotent for snapshot
        // variants, so safe even on the rare double-call edge cases.
        // See the kernel state mirror follow-up
        // blank-workbook-mirror-seeding.md §"Provider-replay completion".
        try {
          await input.computeBridge.settleForMirror();
        } catch (err) {
          slog('documentLifecycle.attachProvidersSettleForMirrorFailed', { error: err });
        }
      }
    }
    const sheetIds = await input.computeBridge.getAllSheetIds();

    // After Provider replay (or default-sheet creation), force-refresh
    // viewport buffers so the renderer sees the post-attach cell state.
    // The replay's `syncApply` calls populate the engine but do NOT
    // propagate to viewport buffers when no coordinator is registered yet
    // (initial mount happens AFTER attach). The
    // `ViewportCoordinatorRegistry` arms a hydration-deficit flag on every
    // dropped patch (added in this round); the renderer's first
    // coordinator-mount fires the bridge-wired handler that re-fetches
    // every coordinator. This `forceRefreshAllViewports` here is the
    // belt-and-suspenders path for cases where coordinators ARE already
    // registered before attach (warm-reset, sheet-switch into a hydrated
    // doc) — it's a no-op when the registry is empty, which is the
    // cold-boot case the deficit flag handles.
    if (providerAttached) {
      try {
        await input.computeBridge.core.forceRefreshAllViewports();
      } catch (err) {
        slog('documentLifecycle.attachProvidersForceRefreshAllViewportsFailed', { error: err });
      }
    }

    // Surface the post-attach sheet set so the machine context's
    // `initialSheetIds` (consumed by `lifecycle.initialSheetId` and
    // therefore the workbook's active-sheet bootstrap) is the
    // authoritative replay-resolved set. Pre-fix the workbook mounted on
    // `[S_new]` (created by startBridge) and never saw the replayed
    // `S_orig` cells. See {@link AttachProvidersOutput}.
    markPerformance('dls:attachProviders:end');
    measurePerformance(
      'dls:attachProviders',
      'dls:attachProviders:start',
      'dls:attachProviders:end',
    );
    return { sheetIds };
  }

  private async settleDeferredImportMirror(computeBridge: ComputeBridge): Promise<void> {
    try {
      await computeBridge.settleForMirror();
    } catch (err) {
      slog('documentLifecycle.deferredImportSettleForMirrorFailed', { error: err });
    }
  }

  private async completeImportDurability(
    bridge: ComputeBridge,
    rustDocument: RustDocument,
    publishAfterCommit: boolean,
  ): Promise<ImportDurabilityResult> {
    const previousPhase = this._storageState.phase;
    this.updateStoragePhase('establishingDurability');

    if (rustDocument.hasImportStagedProviders) {
      await rustDocument.runImportInitializeHydration(() => bridge.completeDeferredHydration());

      const hwm = this.captureStorageHighWaterMark();

      try {
        await rustDocument.fullStateCheckpoint({
          mode: { kind: 'importInitialize' },
          publishAfterCommit,
          absorbStagedLiveUpdates: true,
        });
      } catch (err) {
        this.deferredHydrationPending = false;
        this.importDurabilityPending = false;
        this.updateStoragePhase(previousPhase);
        if (this.hostLifecycleInput) {
          const failureReason = err instanceof Error ? err.message : String(err);
          this.hostLifecycleInput.diagnostics.emit({
            kind: 'storage.failure',
            code: 'IMPORT_DURABILITY_CHECKPOINT_FAILED',
            correlationId: this.hostLifecycleInput.session.correlationRootId,
            providerRefId: 'host-storage',
            phase: 'establishingDurability',
            timestamp: this.hostLifecycleInput.clock.now(),
          });
          throw new EngineCreateError(
            `[DocumentLifecycleSystem] Host-backed import failed durability checkpoint: ${failureReason}`,
            { cause: err },
          );
        }
        return {
          status: 'failed',
          checkpointedProviderRefIds: [],
          highWaterMark: hwm,
          failureReason: err instanceof Error ? err.message : String(err),
        };
      }

      const providerRefIds = [...this.importInitializeProviderRefIds];

      this.deferredHydrationPending = false;
      this.importDurabilityPending = false;
      this.updateStoragePhase(previousPhase);
      return {
        status: 'durable',
        checkpointedProviderRefIds: providerRefIds,
        highWaterMark: hwm,
      };
    }

    await bridge.completeDeferredHydration();
    this.deferredHydrationPending = false;
    this.importDurabilityPending = false;
    this.updateStoragePhase(previousPhase);
    return {
      status: 'skipped',
      checkpointedProviderRefIds: [],
    };
  }

  private captureStorageHighWaterMark(): StorageHighWaterMark | undefined {
    if (!this._writeGate) return undefined;
    const capturedAt = Date.now();
    const snapshot = this._writeGate.captureHighWaterMark();
    return {
      mark: `hwm-${snapshot.mutationWatermark}`,
      capturedAt,
      pendingMutationCount: snapshot.pendingAssetCount,
    };
  }

  private recordImportInitializeProviderRefId(providerRefId: string): void {
    if (!this.importInitializeProviderRefIds.includes(providerRefId)) {
      this.importInitializeProviderRefIds.push(providerRefId);
    }
  }

  /**
   * wireContext actor implementation.
   *
   * Two code paths:
   *
   * **Host-compliant path** (`this.hostLifecycleInput` set):
   *   - Security config comes from the principal projection, not from
   *     `this.securityConfig`
   *   - Principal projection is awaited and construction-blocking
   *   - The legacy `kernelHostContext` field is NOT passed to
   *     `createDocumentContext` — the host lifecycle input is the
   *     single source of truth
   *
   * **Legacy/cooperative path** (existing behavior):
   *   1. createDocumentContext(computeBridge) — creates bridges, services, event bus
   *   2. computeBridge.setContext(ctx) — transitions bridge to CONTEXT_SET phase
   *   3. computeBridge.initMutationHandler() — initializes mutation result processing
   */
  private async executeWireContext(input: WireContextInput): Promise<WireContextOutput> {
    markPerformance('dls:wireContext:start');
    // Import createDocumentContext — it handles:
    // - UndoService creation and wiring
    // - All service construction (clipboard, selection, etc.)
    const { createDocumentContext } = await import('../context/kernel-context');

    // =====================================================================
    // Host-compliant path
    // =====================================================================
    if (this.hostLifecycleInput) {
      const lifecycleInput = this.hostLifecycleInput;

      // Create the host document operation gate BEFORE context creation
      // so it's installed before the DocumentHandle/Workbook is returned.
      const { createHostDocumentOperationGate } = await import('./host-operation-gate');
      const opAuth = lifecycleInput.operationAuthorization;
      const operationGate = createHostDocumentOperationGate({
        sessionId: opAuth.sessionId,
        sourceHostId: opAuth.sourceHostId,
        principalFingerprint: opAuth.principalFingerprint,
        resourceContextFingerprint: opAuth.resourceContextFingerprint,
        principal: lifecycleInput.principal,
        resourceContext: lifecycleInput.resourceContext,
        documentAuthorization: opAuth.documentAuthorization,
        replayRegistry: opAuth.replayRegistry,
        diagnostics: opAuth.diagnostics,
        clock: lifecycleInput.clock,
      });

      const documentContext = createDocumentContext(input.computeBridge, {
        environment: this.environment === 'headless' ? 'headless' : 'app',
        security: undefined,
        userTimezone: lifecycleInput.timezone.userTimezone,
        clock: lifecycleInput.clock,
        kernelHostContext: undefined,
        workbookLinkResolver: lifecycleInput.workbookLinkResolver as
          | WorkbookLinkResolver
          | undefined,
        workbookLinkScope: this.hostWorkbookLinkScope(lifecycleInput),
        operationGate,
        awaitMaterialized: (scope) => this.awaitMaterialized(scope),
        getMaterializationState: () => this.getMaterializationState(),
      });

      // Host-compliant path: awaited principal projection
      // (construction-blocking, not fire-and-forget).
      const { projectPrincipal } = await import('../context/principal-projection');
      const handoff = projectPrincipal(lifecycleInput.principal);
      if (handoff.accessPrincipal) {
        await input.computeBridge.setActivePrincipal(handoff.accessPrincipal);
      }

      // Reverse wiring: push the newly-created context back into the bridge.
      input.computeBridge.setContext(documentContext);
      input.computeBridge.initMutationHandler();

      markPerformance('dls:wireContext:end');
      measurePerformance('dls:wireContext', 'dls:wireContext:start', 'dls:wireContext:end');
      return { documentContext };
    }

    // =====================================================================
    // Legacy/cooperative path
    // =====================================================================
    const documentContext = createDocumentContext(input.computeBridge, {
      environment: this.environment === 'headless' ? 'headless' : 'app',
      security: this.securityConfig,
      userTimezone: this.userTimezone,
      clock: this.clock,
      kernelHostContext: this.kernelHostContext,
      workbookLinkResolver: this.workbookLinkResolver,
      workbookLinkScope: this.workbookLinkScope,
      awaitMaterialized: (scope) => this.awaitMaterialized(scope),
      getMaterializationState: () => this.getMaterializationState(),
    });

    // Host contract path: awaited principal projection (not fire-and-forget).
    if (this.kernelHostContext) {
      const { projectPrincipal } = await import('../context/principal-projection');
      const handoff = projectPrincipal(this.kernelHostContext.principal);
      if (handoff.accessPrincipal) {
        await input.computeBridge.setActivePrincipal(handoff.accessPrincipal);
      }
    }

    // Reverse wiring: push the newly-created context back into the bridge.
    // This was previously done inside createDocumentContext but belongs here
    // as orchestration logic (breaks context/ → document/ dependency cycle).
    input.computeBridge.setContext(documentContext);
    input.computeBridge.initMutationHandler();

    markPerformance('dls:wireContext:end');
    measurePerformance('dls:wireContext', 'dls:wireContext:start', 'dls:wireContext:end');
    return { documentContext };
  }

  private hostWorkbookLinkScope(input: KernelDocumentLifecycleInput): WorkbookLinkStatusScope {
    return {
      requestingDocumentId: input.documentId,
      requestingSessionId: input.session.sessionId,
      actor: input.principal.subjectId,
      principal: { tags: [...input.principal.tags] },
    };
  }

  /**
   * startBridge actor implementation.
   *
   * Calls computeBridge.start() which:
   * - Transitions bridge to STARTED phase
   * - Applies initial RecalcResult for UI reactivity
   * - Pushes schema map to Rust
   * - Sets up event subscriptions
   * - Resolves bridge.ready
   */
  private async executeStartBridge(input: StartBridgeInput): Promise<StartBridgeOutput> {
    markPerformance('dls:startBridge:start');
    await input.computeBridge.start();

    // Install the write gate on the bridge. The gate starts in `open`
    // mode so user mutations are allowed immediately. The lifecycle
    // system transitions the gate to other modes (read-only, closing,
    // closed) when the document phase changes.
    const { WriteGate: WriteGateClass } = await import('./write-gate');
    const writeGate = new WriteGateClass();
    // WriteGate starts in 'open' mode by default.
    input.computeBridge.setWriteGate(writeGate);
    this._writeGate = writeGate;

    // Schema bridge: start() deferred from createDocumentContext.
    // In headless mode, schema bridge is not started (no schema validation needed).
    if (this.environment !== 'headless' && input.documentContext) {
      input.documentContext.schema.start();
    }

    // NOTE on default-sheet creation:
    //
    // Previously, this actor unconditionally created "Sheet1" if no sheets
    // existed (gated on `!skipDefaultSheet`). That conflicted with Provider
    // replay: the `attaching` actor replays Provider bytes via `syncApply`
    // AFTER `startBridge`. If the persisted bytes carry their own original Sheet1
    // (id `S_orig`), the engine ends up with TWO sheets: the freshly-created
    // empty Sheet1 (`S_new`) and the replayed `S_orig`. The workbook's
    // `initialSheetId` is captured here as `[S_new, …]`, so the renderer
    // mounts on the empty `S_new` and the user's actual data on `S_orig` is
    // invisible.
    //
    // The fix: defer default-sheet creation to after `attaching`. If the
    // Provider replay yielded a non-empty sheet set, we use those ids. If
    // the replay was a no-op (or no Provider attached), the `attaching`
    // actor is responsible for creating "Sheet1" so a blank doc still has
    // a starting sheet. See {@link executeAttachProviders}.
    //
    // The XLSX-import path passes `skipDefaultSheet: true` already (the
    // imported sheets are authoritative); that contract is unchanged.
    //
    // The returned `sheetIds` here is whatever exists after `start()` —
    // typically empty for a fresh-create with a Provider attaching, and
    // pre-populated only if a callsite already pushed sheets between
    // `wireContext` and here (no in-tree caller does). The downstream
    // `attaching` actor re-reads sheet ids and rewrites
    // `initialSheetIds` via `storeSheetIdsAfterAttach`, so this initial
    // capture is just a placeholder — sheet truth lands post-attach.
    const sheetIds = await input.computeBridge.getAllSheetIds();
    markPerformance('dls:startBridge:end');
    measurePerformance('dls:startBridge', 'dls:startBridge:start', 'dls:startBridge:end');
    return { sheetIds };
  }

  /**
   * hydrateXlsx actor implementation.
   *
   * Runs AFTER bridge is STARTED — toIdentityFormula() requires ensurePhase('STARTED').
   *
   * Uses computeBridge.importFromXlsxBytes for all import paths.
   *
   * The entire pipeline runs in Rust: cell/style/format/merge/chart/named-range
   * hydration AND identity formula conversion (done during init_from_snapshot's
   * bulk_parse_and_register pass, which has access to the live CellMirror).
   */
  private async executeHydrateXlsx(input: HydrateXlsxInput): Promise<HydrateXlsxOutput> {
    try {
      markPerformance('dls:hydrateXlsx:start');
      const computeBridge = input.documentContext.computeBridge;

      // Resolve XLSX bytes from the source (path or inline bytes).
      let xlsxBytes: Uint8Array;
      if (input.xlsxSource.type === 'path') {
        // Path-based import (Tauri desktop only): read file bytes via
        // the transport, then import via the bytes path like all platforms.
        const transport = computeBridge.core.transport;
        // With tauri::ipc::Response, Tauri sends raw bytes as ArrayBuffer.
        xlsxBytes = await transport.call<Uint8Array>('read_file', {
          path: input.xlsxSource.path,
        });
      } else {
        xlsxBytes = new Uint8Array(
          input.xlsxSource.data.buffer.slice(
            input.xlsxSource.data.byteOffset,
            input.xlsxSource.data.byteOffset + input.xlsxSource.data.byteLength,
          ),
        );
      }

      // Single bridge call that parses XLSX bytes and imports directly
      // in Rust — no JSON round-trip. After hydration of the floating-objects
      // render-decoupling plan, this call returns a MutationResult that
      // the bridge automatically threads through MutationResultHandler.
      // applyAndNotify, populating every TS-side per-domain projection
      // (drawings, tables, comments, filters, sparklines, named ranges,
      // conditional formats, pivots, grouping) before this `await`
      // resolves. The result itself is discarded here — projections are
      // the consumer.
      markPerformance('dls:hydrateXlsx:import:start');
      await computeBridge.importFromXlsxBytesDeferred(xlsxBytes);
      markPerformance('dls:hydrateXlsx:import:end');
      measurePerformance(
        'dls:hydrateXlsx:import',
        'dls:hydrateXlsx:import:start',
        'dls:hydrateXlsx:import:end',
      );

      // Mark deferred hydration as pending — it will be scheduled after the
      // lifecycle reaches 'ready' and the first paint completes.
      this.deferredHydrationPending = true;
      this.importDurabilityPending = true;

      // Get sheet IDs from the engine (populated by Rust import)
      await this.settleDeferredImportMirror(computeBridge);
      const sheetIds = await computeBridge.getAllSheetIds();

      // Identity formula conversion is already done in Rust during
      // init_from_snapshot() → bulk_parse_and_register(). No TypeScript pass needed.

      markPerformance('dls:hydrateXlsx:end');
      measurePerformance('dls:hydrateXlsx', 'dls:hydrateXlsx:start', 'dls:hydrateXlsx:end');
      return {
        cellCount: 0, // cell count not available from single-call path
        sheetIds,
        warnings: [],
      };
    } catch (error) {
      throw new HydrationError('XLSX hydration failed', { cause: error });
    }
  }

  /**
   * hydrateCsv actor implementation. Mirror of `executeHydrateXlsx`.
   *
   * Resolves CSV bytes from the source (path or inline), then calls
   * `computeBridge.importFromCsvBytes(bytes, options)` — Rust handles
   * encoding sniff, dialect detection, type inference, hydration, and
   * recalc. Warnings flow through `tracing::warn!` on the Rust side,
   * not through this return value.
   */
  private async executeHydrateCsv(input: HydrateCsvInput): Promise<HydrateCsvOutput> {
    try {
      const computeBridge = input.documentContext.computeBridge;

      let csvBytes: Uint8Array;
      if (input.csvSource.type === 'path') {
        const transport = computeBridge.core.transport;
        csvBytes = await transport.call<Uint8Array>('read_file', {
          path: input.csvSource.path,
        });
      } else {
        csvBytes = new Uint8Array(
          input.csvSource.data.buffer.slice(
            input.csvSource.data.byteOffset,
            input.csvSource.data.byteOffset + input.csvSource.data.byteLength,
          ),
        );
      }

      // Defaults match `csv_parser::CsvImportOptions::default()` field-for-field.
      // The wire interface uses snake_case Rust naming but bridge codegen
      // applies camelCase serde renames, so the TS shape uses camelCase.
      // Optional fields normalize undefined -> null because the auto-generated
      // wire shape (regen'd in kernel-state-mirror direct state coverage) requires
      // explicit nulls for `Option<T>` fields with `#[serde(default)]`; the
      // hand-edited stub previously emitted optional `?:` markers that
      // tolerated undefined.
      const options: CsvImportOptions = input.csvImportOptions ?? {};

      await computeBridge.importFromCsvBytes(csvBytes, {
        delimiter: options.delimiter ?? null,
        encoding: options.encoding ?? null,
        hasHeaderRow: options.hasHeaderRow ?? null,
        evaluateFormulas: options.evaluateFormulas ?? false,
        sheetName: options.sheetName ?? null,
        maxRows: options.maxRows ?? 1_048_576,
        maxCols: options.maxCols ?? 16_384,
        locale: options.locale ?? null,
      });

      this.deferredHydrationPending = true;
      this.importDurabilityPending = true;

      await this.settleDeferredImportMirror(computeBridge);
      const sheetIds = await computeBridge.getAllSheetIds();

      return {
        cellCount: 0, // cell count not available from single-call path
        sheetIds,
        warnings: [],
      };
    } catch (error) {
      throw new HydrationError('CSV hydration failed', { cause: error });
    }
  }

  /**
   * disposeBridge actor implementation.
   *
   * Handles partially-initialized state (any field may be null if error
   * occurred mid-initialization).
   *
   * 1. If rustDocument exists: await rustDocument.destroy() (final persist + cleanup)
   * 2. If computeBridge exists: await computeBridge.destroy()
   */
  private async executeDisposeBridge(input: DisposeBridgeInput): Promise<void> {
    try {
      await this.awaitImportDurability();
    } catch (err) {
      slog('documentLifecycle.disposeImportDurabilityBarrierFailed', { error: err });
    }

    // 1. Destroy document context — unsubscribes all domain bridge event handlers
    if (input.documentContext) {
      try {
        input.documentContext.destroy();
      } catch (err) {
        slog('documentLifecycle.documentContextDestroyFailed', { error: err });
      }
      try {
        input.documentContext.eventBus.clear();
      } catch {
        /* best-effort */
      }
    }

    // 2. Persist and destroy RustDocument
    if (input.rustDocument) {
      try {
        await input.rustDocument.destroy();
      } catch (err) {
        slog('documentLifecycle.rustDocumentDestroyFailed', { error: err });
      }
    }

    for (const handle of this.hostProviderMaterializerHandles.splice(0)) {
      try {
        handle.dispose();
      } catch (err) {
        slog('documentLifecycle.hostProviderMaterializerDisposeFailed', { error: err });
      }
    }

    // 3. Destroy compute bridge — kills transport (safe now that listeners are gone)
    if (input.computeBridge) {
      try {
        await input.computeBridge.destroy();
      } catch (err) {
        slog('documentLifecycle.computeBridgeDestroyFailed', { error: err });
      }
    }
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Map XState machine state names to DocumentStoragePhase values and
   * update the storage state (the storage provider lifecycle).
   */
  private updateStoragePhase(stateOrPhase: string): void {
    const phaseMap: Record<string, DocumentStoragePhase> = {
      idle: 'idle',
      creating: 'creatingEngine',
      wiring: 'wiringContext',
      starting: 'startingBridge',
      hydrating: 'hydratingImport',
      hydrating_csv: 'hydratingImport',
      attaching: 'attachingProviders',
      ready: 'readyReadWrite',
      error: 'error',
      disposing: 'closing',
      disposed: 'closed',
      // the storage provider lifecycle phases passed directly
      validatingStorageHandoff: 'validatingStorageHandoff',
      selectingProviders: 'selectingProviders',
      preflightingProviders: 'preflightingProviders',
      installingWriteGate: 'installingWriteGate',
      establishingDurability: 'establishingDurability',
      attachingProviders: 'attachingProviders',
      readyReadWrite: 'readyReadWrite',
      readyReadOnly: 'readyReadOnly',
      readyEphemeral: 'readyEphemeral',
    };

    const phase = phaseMap[stateOrPhase] ?? 'idle';

    // Refine ready phase based on preflight result or durability config
    let resolvedPhase = phase;
    if (phase === 'readyReadWrite' && this.preflightResult) {
      resolvedPhase = this.preflightResult.selectedReadyMode;
    } else if (phase === 'readyReadWrite' && this._storageState.durability === 'readOnly') {
      resolvedPhase = 'readyReadOnly';
    } else if (phase === 'readyReadWrite' && this._storageState.durability === 'ephemeral') {
      resolvedPhase = 'readyEphemeral';
    }

    this._storageState = {
      ...this._storageState,
      phase: resolvedPhase,
    };

    if (this._writeGate) {
      const gateMode = PHASE_TO_GATE_MODE[resolvedPhase];
      if (gateMode && gateMode !== this._writeGate.mode) {
        this._writeGate.setMode(gateMode);
      }
    }
  }

  private allocateEngineInstanceId(publicDocId: string): string {
    this.engineInstanceGeneration += 1;
    documentLifecycleEngineInstanceCounter += 1;
    const processGeneration = documentLifecycleEngineInstanceCounter.toString(36);
    const lifecycleGeneration = this.engineInstanceGeneration.toString(36);
    return `${publicDocId}::compute-${Date.now().toString(36)}-${processGeneration}-${lifecycleGeneration}`;
  }

  /**
   * Clean up subscriptions and callbacks after disposal.
   */
  private cleanup(): void {
    if (this.stateSubscription) {
      this.stateSubscription.unsubscribe();
      this.stateSubscription = null;
    }
    this.readyCallbacks.clear();
    this.actor.stop();
  }
}
