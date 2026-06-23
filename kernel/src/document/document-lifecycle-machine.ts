/**
 * Document Lifecycle State Machine (PURE)
 *
 * Manages the lifecycle of a spreadsheet document from creation through
 * initialization to ready state. Coordinates ComputeBridge, RustDocument,
 * and DocumentContext in the correct sequence.
 *
 * States:
 * - idle: Initial state, waiting for CREATE or CREATE_FROM_XLSX event
 * - creating: Creating ComputeBridge + RustDocument, loading from IndexedDB
 * - wiring: Synchronous — setContext(), wire UndoService, initMutationHandler()
 * - starting: bridge.start() — applies RecalcResult, sets up subscriptions
 * - hydrating: XLSX import — parse and hydrate document (only for XLSX path)
 * - ready: All systems initialized, safe for viewport refresh
 * - error: Terminal error state (can still DISPOSE)
 * - disposing: Destroying bridge and document
 * - disposed: Final state
 *
 * Key behaviors:
 * - Machine owns STATE only, system class owns EXECUTION (via fromPromise actors)
 * - Pure state transitions, fully testable
 * - DISPOSE can be sent from any state
 * - Conditional routing: starting -> hydrating (XLSX) or starting -> ready (new doc)
 *
 * @see 04-DOCUMENT-LIFECYCLE-STATE-MACHINE.md for design decisions
 */

import { assign, fromPromise, setup, type ActorRefFrom, type SnapshotFrom } from 'xstate';

import type {
  CreateDocumentOptions,
  CsvImportOptions,
  DocumentImportOptions,
  DocumentSource,
} from '@mog-sdk/contracts/document';
import type { SheetId } from '@mog-sdk/contracts/core';
import type { TrapError } from '@mog/transport';
import type { ComputeBridge } from '../bridges/compute/compute-bridge';
import type { DocumentContext } from '../context/types';
import { KernelError } from '../errors';
import type { RustDocument } from './rust-document';

// =============================================================================
// CONTEXT
// =============================================================================

/**
 * Machine context for the document lifecycle.
 * Tracks all subsystem references created during initialization.
 */
export interface DocumentLifecycleContext {
  /** Document identifier */
  docId: string;
  /** Creation options */
  options: CreateDocumentOptions | null;
  /** XLSX source data (null for new documents) */
  xlsxSource: DocumentSource | null;
  /** XLSX import options (null for new documents) */
  xlsxImportOptions: DocumentImportOptions | null;
  /** CSV source data (null for non-CSV imports) */
  csvSource: DocumentSource | null;
  /** CSV import options (null for non-CSV imports) */
  csvImportOptions: CsvImportOptions | null;
  /** Rust compute engine bridge */
  computeBridge: ComputeBridge | null;
  /** Rust-backed document (owns persistence) */
  rustDocument: RustDocument | null;
  /** Fully wired document context (services, bridges, event bus) */
  documentContext: DocumentContext | null;
  /** Sheet IDs discovered after bridge start (ordered) */
  initialSheetIds: SheetId[];
  /** True when provider attach should replace any prior state for this doc id. */
  createFresh: boolean;
  /** Last error (set on error transitions) */
  error: KernelError | null;
  /**
   * Optional Yrs-state payload to use the next time `executeCreateEngine`
   * runs. Set by the RECOVER event when the shell-level recovery
   * coordinator has pre-snapshotted bytes; cleared after the next
   * `creating → wiring` transition. When null, `executeCreateEngine`
   * runs normally — with `attachProviders` replaying from IDB on the
   * fresh WASM instance.
   *
   * Only consumed by the recovery path. The normal CREATE/CREATE_FROM_XLSX
   * flows leave this null.
   *
   */
  recoveryYrsState: Uint8Array | null;
}

const initialContext: DocumentLifecycleContext = {
  docId: '',
  options: null,
  xlsxSource: null,
  xlsxImportOptions: null,
  csvSource: null,
  csvImportOptions: null,
  computeBridge: null,
  rustDocument: null,
  documentContext: null,
  initialSheetIds: [],
  createFresh: false,
  error: null,
  recoveryYrsState: null,
};

// =============================================================================
// EVENTS
// =============================================================================

/**
 * Events for the document lifecycle state machine.
 * Only three user-facing events — the machine drives itself through invoke actors.
 */
export type DocumentLifecycleEvent =
  | {
      type: 'CREATE';
      docId: string;
      options: CreateDocumentOptions;
    }
  | {
      type: 'CREATE_FROM_XLSX';
      docId: string;
      options: CreateDocumentOptions;
      xlsxSource: DocumentSource;
      importOptions?: DocumentImportOptions;
    }
  | {
      type: 'CREATE_FROM_CSV';
      docId: string;
      options: CreateDocumentOptions;
      csvSource: DocumentSource;
      csvImportOptions: CsvImportOptions | null;
    }
  | { type: 'DISPOSE' }
  | {
      /**
       * The document's WASM-backed compute call surface observed a wasm32
       * trap. The instance is permanently dead; this transitions the
       * machine into `error` with the trap as the context error so the
       * shell renders a per-doc failure surface and the recovery
       * coordinator can decide what to do next.
       *
       * Idempotent: TRAP from `error` keeps the first trap (the
       * originating one is the most actionable). TRAP from `disposing`
       * or `disposed` is a no-op (the doc is already going away).
       *
       */
      type: 'TRAP';
      trap: TrapError;
    }
  | {
      /**
       * Re-run the `creating → ready` chain on a fresh WASM instance.
       * Sent by the shell-level recovery coordinator AFTER it has
       * (a) marked the trapping doc failed via TRAP, and (b) called
       * `resetWasmModule()` so the next compute-bridge created here
       * picks up the fresh `WebAssembly.Instance`.
       *
       * Optional `yrsState` payload bypasses IDB replay — useful when
       * the coordinator pre-snapshotted bytes before the trap (not
       * supported in v1; included for API symmetry with future R2
       * websocket-collab recovery flows). When omitted, the normal
       * `attachProviders` step replays from this doc's IndexedDB.
       *
       * Only valid from `error` state (i.e. after a TRAP). RECOVER from
       * any other state is a no-op — recovery races between the
       * coordinator and a manual user action shouldn't double-rebuild.
       */
      type: 'RECOVER';
      yrsState?: Uint8Array;
    };

// =============================================================================
// EVENT FACTORIES
// =============================================================================

/**
 * Type-safe event factories for the document lifecycle machine.
 * Use these instead of inline object literals to prevent magic string drift.
 */
export const DocumentLifecycleEvents = {
  create: (docId: string, options: CreateDocumentOptions): DocumentLifecycleEvent => ({
    type: 'CREATE',
    docId,
    options,
  }),

  createFromXlsx: (
    docId: string,
    options: CreateDocumentOptions,
    xlsxSource: DocumentSource,
    importOptions?: DocumentImportOptions,
  ): DocumentLifecycleEvent => ({
    type: 'CREATE_FROM_XLSX',
    docId,
    options,
    xlsxSource,
    importOptions,
  }),

  createFromCsv: (
    docId: string,
    options: CreateDocumentOptions,
    csvSource: DocumentSource,
    csvImportOptions: CsvImportOptions | null,
  ): DocumentLifecycleEvent => ({
    type: 'CREATE_FROM_CSV',
    docId,
    options,
    csvSource,
    csvImportOptions,
  }),

  dispose: (): DocumentLifecycleEvent => ({
    type: 'DISPOSE',
  }),

  trap: (trap: TrapError): DocumentLifecycleEvent => ({
    type: 'TRAP',
    trap,
  }),

  recover: (yrsState?: Uint8Array): DocumentLifecycleEvent => ({
    type: 'RECOVER',
    yrsState,
  }),
} as const;

// =============================================================================
// ACTOR INPUT/OUTPUT TYPES
// =============================================================================

/** Input for the createEngine actor */
export interface CreateEngineInput {
  docId: string;
  options: CreateDocumentOptions;
}

/** Output from the createEngine actor */
export interface CreateEngineOutput {
  computeBridge: ComputeBridge;
  rustDocument: RustDocument;
}

/** Input for the wireContext actor */
export interface WireContextInput {
  computeBridge: ComputeBridge;
}

/** Output from the wireContext actor */
export interface WireContextOutput {
  documentContext: DocumentContext;
}

/** Input for the startBridge actor */
export interface StartBridgeInput {
  computeBridge: ComputeBridge;
  documentContext: DocumentContext | null;
  skipDefaultSheet: boolean;
}

/** Output from the startBridge actor */
export interface StartBridgeOutput {
  sheetIds: SheetId[];
}

/** Input for the hydrateXlsx actor */
export interface HydrateXlsxInput {
  documentContext: DocumentContext;
  xlsxSource: DocumentSource;
  xlsxImportOptions: DocumentImportOptions | null;
}

/** Output from the hydrateXlsx actor */
export interface HydrateXlsxOutput {
  cellCount: number;
  sheetIds: SheetId[];
  warnings: Array<{ type: string; message: string }>;
}

/**
 * Input for the attachProviders actor (orchestrator-Provider
 * attach moved out of executeCreateEngine because Provider.attach()
 * replays bytes via ComputeBridge.syncApply, which requires the bridge
 * to be in STARTED phase with a real DocumentContext wired).
 */
export interface AttachProvidersInput {
  docId: string;
  computeBridge: ComputeBridge;
  rustDocument: RustDocument;
  /** True for the per-app placeholder kernel — skip Provider attach entirely. */
  internal: boolean;
  /** True when local browser persistence should be skipped entirely. */
  skipLocalPersistence: boolean;
  /** 'browser' / 'app' attaches IndexedDB; 'headless' attaches none. */
  environment: 'browser' | 'headless' | undefined;
  /**
   * Whether to skip creating "Sheet1" if no sheets exist post-attach.
   * Defaults to false. The XLSX-import path sets this to true because
   * `hydrateXlsx` already populated the sheet set with the imported
   * sheets, and a synthetic "Sheet1" alongside them would be wrong.
   *
   * Default-sheet creation is post-attach
   * (was inside `startBridge`). The `attaching` actor:
   *   - runs Provider.attach which replays persisted bytes,
   *   - then if no sheets exist AND `!skipDefaultSheet`, creates
   *     "Sheet1" via `ORIGIN_BOOTSTRAP` (no undo entry).
   *
   * This avoids the pre-fix duplicate-sheet bug where `startBridge`
   * created an empty `S_new` and the replay added the user's `S_orig`,
   * leaving the workbook mounting on `S_new` (empty) and ignoring the
   * data on `S_orig`.
   */
  skipDefaultSheet: boolean;
  /** XLSX imported base state: attach providers in snapshot-only import mode. */
  importInitialize: boolean;
  /** True when a create session must replace any prior state for this doc id. */
  createFresh: boolean;
}

/**
 * Output from the attachProviders actor — the post-attach sheet ID set.
 *
 * The machine's `initialSheetIds` is rewritten from this value via the
 * `storeAttachSheetIds` action so `lifecycle.initialSheetId` (and the
 * workbook's active-sheet bootstrap) reflect the replay-resolved sheets,
 * not the pre-replay snapshot taken inside `startBridge`. See
 * {@link AttachProvidersInput.skipDefaultSheet} for the rationale.
 */
export interface AttachProvidersOutput {
  sheetIds: SheetId[];
}

/** Input for the hydrateCsv actor */
export interface HydrateCsvInput {
  documentContext: DocumentContext;
  csvSource: DocumentSource;
  csvImportOptions: CsvImportOptions | null;
}

/** Output from the hydrateCsv actor (parallel shape to HydrateXlsxOutput) */
export interface HydrateCsvOutput {
  cellCount: number;
  sheetIds: SheetId[];
  warnings: Array<{ type: string; message: string }>;
}

/** Input for the disposeBridge actor */
export interface DisposeBridgeInput {
  documentContext: DocumentContext | null;
  computeBridge: ComputeBridge | null;
  rustDocument: RustDocument | null;
}

// =============================================================================
// MACHINE DEFINITION
// =============================================================================

export const documentLifecycleMachine = setup({
  types: {
    context: {} as DocumentLifecycleContext,
    events: {} as DocumentLifecycleEvent,
  },
  actors: {
    createEngine: fromPromise<CreateEngineOutput, CreateEngineInput>(async ({ input }) => {
      // Stub — real implementation provided by DocumentLifecycleSystem via provide()
      throw new KernelError(
        'DOC_LIFECYCLE_ERROR',
        `[documentLifecycleMachine] createEngine actor not implemented (docId: ${input.docId})`,
      );
    }),
    wireContext: fromPromise<WireContextOutput, WireContextInput>(async () => {
      // Stub — real implementation provided by DocumentLifecycleSystem via provide()
      // This is effectively synchronous (resolves immediately) but uses fromPromise
      // for consistency with XState's invoke pattern.
      throw new KernelError(
        'DOC_LIFECYCLE_ERROR',
        '[documentLifecycleMachine] wireContext actor not implemented',
      );
    }),
    startBridge: fromPromise<StartBridgeOutput, StartBridgeInput>(async () => {
      // Stub — real implementation provided by DocumentLifecycleSystem via provide()
      throw new KernelError(
        'DOC_LIFECYCLE_ERROR',
        '[documentLifecycleMachine] startBridge actor not implemented',
      );
    }),
    hydrateXlsx: fromPromise<HydrateXlsxOutput, HydrateXlsxInput>(async () => {
      // Stub — real implementation provided by DocumentLifecycleSystem via provide()
      throw new KernelError(
        'DOC_LIFECYCLE_ERROR',
        '[documentLifecycleMachine] hydrateXlsx actor not implemented',
      );
    }),
    attachProviders: fromPromise<AttachProvidersOutput, AttachProvidersInput>(async () => {
      // Stub — real implementation provided by DocumentLifecycleSystem via provide()
      throw new KernelError(
        'DOC_LIFECYCLE_ERROR',
        '[documentLifecycleMachine] attachProviders actor not implemented',
      );
    }),
    hydrateCsv: fromPromise<HydrateCsvOutput, HydrateCsvInput>(async () => {
      // Stub — real implementation provided by DocumentLifecycleSystem via provide()
      throw new KernelError(
        'DOC_LIFECYCLE_ERROR',
        '[documentLifecycleMachine] hydrateCsv actor not implemented',
      );
    }),
    disposeBridge: fromPromise<void, DisposeBridgeInput>(async () => {
      // Stub — real implementation provided by DocumentLifecycleSystem via provide()
      throw new KernelError(
        'DOC_LIFECYCLE_ERROR',
        '[documentLifecycleMachine] disposeBridge actor not implemented',
      );
    }),
  },
  actions: {
    // Store CREATE event data into context
    storeCreateParams: assign(({ event }) => {
      if (event.type !== 'CREATE') return {};
      return {
        docId: event.docId,
        options: event.options,
        xlsxSource: null,
        xlsxImportOptions: null,
        csvSource: null,
        csvImportOptions: null,
        createFresh: true,
      };
    }),

    // Store CREATE_FROM_XLSX event data into context
    storeCreateFromXlsxParams: assign(({ event }) => {
      if (event.type !== 'CREATE_FROM_XLSX') return {};
      return {
        docId: event.docId,
        options: event.options,
        xlsxSource: event.xlsxSource,
        xlsxImportOptions: event.importOptions ?? null,
        csvSource: null,
        csvImportOptions: null,
        createFresh: false,
      };
    }),

    // Store CREATE_FROM_CSV event data into context
    storeCreateFromCsvParams: assign(({ event }) => {
      if (event.type !== 'CREATE_FROM_CSV') return {};
      return {
        docId: event.docId,
        options: event.options,
        xlsxSource: null,
        xlsxImportOptions: null,
        csvSource: event.csvSource,
        csvImportOptions: event.csvImportOptions,
        createFresh: false,
      };
    }),

    // Store engine creation results (computeBridge + rustDocument)
    // These actions are only called from onDone/onError handlers inside invoke,
    // so the event has an 'output' or 'error' property at runtime. We use 'in'
    // checks to narrow the type safely since XState's action type system only
    // sees the machine-level event union.
    storeEngineResult: assign(({ event }) => {
      const output = 'output' in event ? (event.output as CreateEngineOutput) : undefined;
      return {
        computeBridge: output?.computeBridge ?? null,
        rustDocument: output?.rustDocument ?? null,
      };
    }),

    // Store wiring result (documentContext)
    storeWiringResult: assign(({ event }) => {
      const output = 'output' in event ? (event.output as WireContextOutput) : undefined;
      return {
        documentContext: output?.documentContext ?? null,
      };
    }),

    // Store sheet IDs from startBridge result
    storeSheetIds: assign(({ event }) => {
      const output = 'output' in event ? (event.output as StartBridgeOutput) : undefined;
      return {
        initialSheetIds: output?.sheetIds ?? [],
      };
    }),

    // Store sheet IDs from hydrateXlsx result (replaces empty IDs from startBridge)
    storeHydrationSheetIds: assign(({ event }) => {
      const output = 'output' in event ? (event.output as HydrateXlsxOutput) : undefined;
      return {
        initialSheetIds: output?.sheetIds ?? [],
      };
    }),

    // Store post-attach sheet IDs.
    //
    // `attachProviders` replays Provider bytes (which may add sheets) and
    // creates a default "Sheet1" if no sheets exist. The post-attach set
    // is the authoritative one for the workbook's active-sheet bootstrap;
    // the pre-attach `initialSheetIds` (from `storeSheetIds` at the end of
    // `starting`) is just a transient placeholder. Replacing it here
    // ensures `lifecycle.initialSheetId` returns the correct id even
    // when Provider replay added a sheet that differs from any earlier
    // synthetic.
    storeAttachSheetIds: assign(({ event }) => {
      const output = 'output' in event ? (event.output as AttachProvidersOutput) : undefined;
      const ids = output?.sheetIds;
      // Defensive: if attach is a no-op (internal/headless/etc.) the
      // returned ids may be empty. Keep the pre-attach ids in that case.
      if (!ids || ids.length === 0) return {};
      return { initialSheetIds: ids };
    }),

    // Store error into context
    storeError: assign(({ event }) => {
      const error = 'error' in event ? event.error : event;
      return {
        error: KernelError.from(error, 'DOC_LIFECYCLE_ERROR'),
      };
    }),

    // Clear all references on dispose
    clearResources: assign(() => ({
      computeBridge: null,
      rustDocument: null,
      documentContext: null,
      initialSheetIds: [],
      createFresh: false,
      error: null,
      recoveryYrsState: null,
    })),

    // Store TRAP event payload — wraps the TrapError in a KernelError so
    // existing `error: KernelError | null` typing is preserved (the
    // `cause` chain keeps the original TrapError reachable for the shell
    // UI's TrapError-specific branch).
    storeTrap: assign(({ event }) => {
      if (event.type !== 'TRAP') return {};
      return {
        error: KernelError.from(event.trap, 'DOC_LIFECYCLE_ERROR'),
      };
    }),

    // Store RECOVER event payload. The optional `yrsState` is moved into
    // context so that when the machine re-enters `creating`, the
    // `executeCreateEngine` actor can hand it to `RustDocument` (which
    // routes to `bridge.createEngineFromYrsState` instead of an empty
    // engine + IDB replay).
    //
    // Also clears `error` and disposes-from-prior-run references so the
    // re-entrant `creating` actor builds against a clean slate. The OLD
    // computeBridge/rustDocument refs MUST have been disposed by the
    // shell-level coordinator BEFORE dispatching RECOVER (this action
    // doesn't await disposal — the machine just drops the references).
    storeRecoveryState: assign(({ event, context }) => {
      if (event.type !== 'RECOVER') return {};
      const yrsState = event.yrsState ?? null;
      return {
        // Merge yrsState into options so executeCreateEngine's existing
        // yrsState plumbing (RustDocument constructor → bridge call route)
        // picks it up without needing a separate code path.
        options: yrsState ? { ...(context.options ?? {}), yrsState } : (context.options ?? {}),
        recoveryYrsState: yrsState,
        createFresh: false,
        error: null,
        // Drop dead references — the OLD bridge is bound to the dead
        // WASM instance. The coordinator has already called destroy()
        // on it; we just need to forget the pointer so the next
        // `creating` cycle creates fresh ones.
        computeBridge: null,
        rustDocument: null,
        documentContext: null,
        initialSheetIds: [],
      };
    }),
  },
  guards: {
    /** True when XLSX data is present — routes starting -> hydrating */
    hasXlsxData: ({ context }) => context.xlsxSource !== null,

    /** True when CSV data is present — routes starting -> hydrating_csv */
    hasCsvData: ({ context }) => context.csvSource !== null,

    /** True when compute bridge exists in context */
    hasComputeBridge: ({ context }) => context.computeBridge !== null,

    /** True when document context exists in context */
    hasDocumentContext: ({ context }) => context.documentContext !== null,
  },
}).createMachine({
  id: 'documentLifecycle',
  initial: 'idle',
  context: initialContext,

  states: {
    // =========================================================================
    // IDLE — Waiting for CREATE or CREATE_FROM_XLSX event
    // =========================================================================
    idle: {
      on: {
        CREATE: {
          target: 'creating',
          actions: 'storeCreateParams',
        },
        CREATE_FROM_XLSX: {
          target: 'creating',
          actions: 'storeCreateFromXlsxParams',
        },
        CREATE_FROM_CSV: {
          target: 'creating',
          actions: 'storeCreateFromCsvParams',
        },
        TRAP: {
          target: 'error',
          actions: 'storeTrap',
        },
      },
    },

    // =========================================================================
    // CREATING — Create ComputeBridge + RustDocument, load from IndexedDB
    // =========================================================================
    creating: {
      invoke: {
        src: 'createEngine',
        input: ({ context }) => ({
          docId: context.docId,
          options: context.options!,
        }),
        onDone: {
          target: 'wiring',
          actions: 'storeEngineResult',
        },
        onError: {
          target: 'error',
          actions: 'storeError',
        },
      },
      on: {
        DISPOSE: {
          target: 'disposing',
        },
        TRAP: {
          target: 'error',
          actions: 'storeTrap',
        },
      },
    },

    // =========================================================================
    // WIRING — Effectively synchronous: creates DocumentContext, calls
    // setContext(), wires UndoService, calls initMutationHandler().
    //
    // Uses a fromPromise actor that resolves immediately (sync work wrapped
    // in a microtask). The wireContext actor returns { documentContext }
    // which is stored into context via storeWiringResult.
    // =========================================================================
    wiring: {
      invoke: {
        src: 'wireContext',
        input: ({ context }) => ({
          computeBridge: context.computeBridge!,
        }),
        onDone: {
          target: 'starting',
          actions: 'storeWiringResult',
        },
        onError: {
          target: 'error',
          actions: 'storeError',
        },
      },
      on: {
        DISPOSE: {
          target: 'disposing',
        },
        TRAP: {
          target: 'error',
          actions: 'storeTrap',
        },
      },
    },

    // =========================================================================
    // STARTING — bridge.start() applies RecalcResult, pushes schema,
    // sets up subscriptions, resolves bridge.ready
    // =========================================================================
    starting: {
      invoke: {
        src: 'startBridge',
        input: ({ context }) => ({
          computeBridge: context.computeBridge!,
          documentContext: context.documentContext ?? null,
          skipDefaultSheet: context.options?.skipDefaultSheet ?? false,
        }),
        onDone: [
          {
            guard: 'hasXlsxData',
            target: 'hydrating',
            actions: 'storeSheetIds',
          },
          {
            guard: 'hasCsvData',
            target: 'hydrating_csv',
            actions: 'storeSheetIds',
          },
          {
            // Provider attach now runs AFTER startBridge. The
            // attach actor's `Provider.attach()` replays bytes via
            // `ComputeBridge.syncApply`, which requires STARTED phase +
            // wired DocumentContext. attachProviders is a no-op for
            // headless / internal docs; the orchestrator's empty-
            // `providers[]` branch keeps everything else live.
            target: 'attaching',
            actions: 'storeSheetIds',
          },
        ],
        onError: {
          target: 'error',
          actions: 'storeError',
        },
      },
      on: {
        DISPOSE: {
          target: 'disposing',
        },
        TRAP: {
          target: 'error',
          actions: 'storeTrap',
        },
      },
    },

    // =========================================================================
    // HYDRATING — XLSX import: parse, create sheets, import cells/styles/formulas
    // Only reached when hasXlsxData guard is true.
    // Runs AFTER bridge is STARTED — toIdentityFormula() requires ensurePhase('STARTED').
    // =========================================================================
    hydrating: {
      invoke: {
        src: 'hydrateXlsx',
        input: ({ context }) => ({
          documentContext: context.documentContext!,
          xlsxSource: context.xlsxSource!,
          xlsxImportOptions: context.xlsxImportOptions,
        }),
        onDone: {
          // After XLSX hydration the bridge is fully populated; THEN
          // attach Providers. For an `import + immediate refresh` flow,
          // the IndexedDB Provider's first `attach()` finds no persisted
          // state for this docId and replay is a no-op; future opens
          // will replay both the imported snapshot and any subsequent
          // edits. Provider-owned hydration may replay default-sheet edits.
          target: 'attaching',
          actions: 'storeHydrationSheetIds',
        },
        onError: {
          target: 'error',
          actions: 'storeError',
        },
      },
      on: {
        DISPOSE: {
          target: 'disposing',
        },
        TRAP: {
          target: 'error',
          actions: 'storeTrap',
        },
      },
    },

    // =========================================================================
    // ATTACHING — orchestrator-Provider attach. Runs AFTER
    // startBridge / hydrateXlsx so `Provider.attach()`'s replay path
    // (`bridge-provider-doc.applyUpdate` → `ComputeBridge.syncApply`)
    // hits a STARTED bridge with a real DocumentContext wired. The
    // attach is a no-op for headless / internal docs — the orchestrator's
    // empty `providers[]` branch is the right path there.
    // =========================================================================
    attaching: {
      invoke: {
        src: 'attachProviders',
        input: ({ context }) => ({
          docId: context.docId,
          computeBridge: context.computeBridge!,
          rustDocument: context.rustDocument!,
          internal: context.options?.internal ?? false,
          skipLocalPersistence: context.options?.skipLocalPersistence === true,
          environment: undefined as 'browser' | 'headless' | undefined,
          // XLSX-import already populated the sheet set in
          // `hydrateXlsx`; skip default-sheet creation. All other paths
          // let `attaching` decide based on post-replay sheet count.
          skipDefaultSheet: context.options?.skipDefaultSheet ?? false,
          importInitialize: context.xlsxSource !== null || context.csvSource !== null,
          createFresh: context.createFresh,
        }),
        onDone: {
          target: 'ready',
          // Replace the pre-attach `initialSheetIds` placeholder with the
          // post-attach truth. See `storeAttachSheetIds` for rationale.
          actions: 'storeAttachSheetIds',
        },
        onError: {
          target: 'error',
          actions: 'storeError',
        },
      },
      on: {
        DISPOSE: {
          target: 'disposing',
        },
        TRAP: {
          target: 'error',
          actions: 'storeTrap',
        },
      },
    },

    // =========================================================================
    // HYDRATING_CSV — CSV import: parse bytes in Rust, populate sheet
    // Only reached when hasCsvData guard is true. Mirror of `hydrating`.
    // =========================================================================
    hydrating_csv: {
      invoke: {
        src: 'hydrateCsv',
        input: ({ context }) => ({
          documentContext: context.documentContext!,
          csvSource: context.csvSource!,
          csvImportOptions: context.csvImportOptions,
        }),
        onDone: {
          target: 'attaching',
          actions: 'storeHydrationSheetIds',
        },
        onError: {
          target: 'error',
          actions: 'storeError',
        },
      },
      on: {
        DISPOSE: {
          target: 'disposing',
        },
        TRAP: {
          target: 'error',
          actions: 'storeTrap',
        },
      },
    },

    // =========================================================================
    // READY — All systems initialized, safe for viewport refresh
    // =========================================================================
    ready: {
      on: {
        DISPOSE: {
          target: 'disposing',
        },
        // Once the doc has reached `ready`, runtime traps (security-event
        // drain, viewport pull, mutations after hydration) flow through
        // here. The trap-recovery coordinator sends TRAP from any
        // ComputeCore that observes a wasm32 trap on this doc's calls,
        // OR when a sibling doc trapped the shared WASM and this doc's
        // bridge is collateral damage.
        TRAP: {
          target: 'error',
          actions: 'storeTrap',
        },
      },
    },

    // =========================================================================
    // ERROR — Terminal error state (can still DISPOSE)
    //
    // Trap recovery: the shell-level recovery coordinator
    // can re-run the `creating → ready` chain on a fresh WASM instance
    // by dispatching RECOVER. Idempotent — RECOVER from any other state
    // is unhandled and silently dropped, so a coordinator race against
    // concurrent user actions doesn't double-rebuild.
    //
    // TRAP from `error` is also explicitly handled (idempotent — the
    // first trap stays in context). Without an explicit handler XState
    // would log a warning every time a sibling-doc TRAP arrives at an
    // already-trapped doc, which is noisy in normal recovery flows.
    // =========================================================================
    error: {
      on: {
        DISPOSE: {
          target: 'disposing',
        },
        TRAP: {
          // Idempotent — keep the first trap in context. Stay in `error`.
          target: 'error',
        },
        RECOVER: {
          target: 'creating',
          actions: 'storeRecoveryState',
        },
      },
    },

    // =========================================================================
    // DISPOSING — Destroy bridge and document
    // Handles partially-initialized state (any field may be null)
    // =========================================================================
    disposing: {
      invoke: {
        src: 'disposeBridge',
        input: ({ context }) => ({
          documentContext: context.documentContext,
          computeBridge: context.computeBridge,
          rustDocument: context.rustDocument,
        }),
        onDone: {
          target: 'disposed',
          actions: 'clearResources',
        },
        onError: {
          // Even if dispose fails, move to disposed — we can't retry
          target: 'disposed',
          actions: 'clearResources',
        },
      },
    },

    // =========================================================================
    // DISPOSED — Final state
    // =========================================================================
    disposed: {
      type: 'final',
    },
  },
});

// =============================================================================
// SELECTORS
// =============================================================================

type MachineSnapshot = SnapshotFrom<typeof documentLifecycleMachine>;

/**
 * Selectors for reading document lifecycle state.
 * Use these for point-in-time reads from the machine snapshot.
 */
export const documentLifecycleSelectors = {
  /** True when machine is in the 'ready' state */
  isReady: (snapshot: MachineSnapshot): boolean => snapshot.matches('ready'),

  /** True when machine is in the 'error' state */
  isError: (snapshot: MachineSnapshot): boolean => snapshot.matches('error'),

  /** Returns the error from context, or null */
  error: (snapshot: MachineSnapshot): KernelError | null => snapshot.context.error,

  /** Returns the DocumentContext from context, or null */
  documentContext: (snapshot: MachineSnapshot): DocumentContext | null =>
    snapshot.context.documentContext,

  /** Returns the current state name as a string */
  phase: (snapshot: MachineSnapshot): string => snapshot.value as string,

  /**
   * True when the machine's `error` state was reached via a TRAP event
   * (i.e. the underlying WASM module trapped). Used by the shell error
   * UI to swap the generic "Failed to load document" message for the
   * size-limit message.
   *
   * Implementation: the `storeTrap` action wraps the TrapError in a
   * KernelError whose `cause` is the original TrapError; we check for
   * `cause.isTrap === true` (the TrapError discriminator from
   * `infra/transport/src/errors.ts`).
   */
  isTrapped: (snapshot: MachineSnapshot): boolean => {
    if (!snapshot.matches('error')) return false;
    const err = snapshot.context.error;
    if (!err) return false;
    const cause = (err as { cause?: unknown }).cause;
    return Boolean(cause && (cause as { isTrap?: boolean }).isTrap === true);
  },
} as const;

// =============================================================================
// ACTOR TYPES
// =============================================================================

export type DocumentLifecycleMachine = typeof documentLifecycleMachine;
export type DocumentLifecycleActor = ActorRefFrom<DocumentLifecycleMachine>;
export type DocumentLifecycleState = SnapshotFrom<DocumentLifecycleMachine>;
