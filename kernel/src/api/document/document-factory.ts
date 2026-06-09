/**
 * DocumentFactory - Stateless Document Creation API
 *
 * Creates DocumentHandles for new or imported documents.
 * This is a stateless factory - it creates handles but doesn't track them.
 * Callers are responsible for calling handle.dispose() when done.
 *
 * Architecture:
 * - Stateless: No global registry, each handle is independent
 * - React remount pattern: When switching documents, dispose old handle and create new
 * - Clean separation: Engine owns content, app owns metadata
 *
 * Migrated from SpreadsheetStore to DocumentContext + domain modules.
 * All data access now goes through:
 * - Reads: Domain modules (Cells, Sheets, Properties, etc.)
 * - Writes: Mutations layer (Mutations.setCellValue, etc.)
 *
 */

import type { ChartImageExporter, Workbook } from '@mog-sdk/contracts/api';
import type { IChartBridge } from '@mog-sdk/contracts/bridges';
import type {
  CreateDocumentOptions,
  CsvImportOptions,
  DocumentImportOptions,
  DocumentImportResult,
  DocumentImportWarning,
  DocumentSource,
} from '@mog-sdk/contracts/document';
import type { CheckpointResult, CloseResult } from '@mog-sdk/types-document/storage/lifecycle';
import type { DocumentByteSyncPort, Provider } from '../../document/providers/provider';
import type { DocumentContext, KernelClock } from '../../context';

import type { ISpreadsheetKernelContext } from '@mog-sdk/contracts/kernel';
import type { KernelHostContext } from '@mog-sdk/types-host/kernel';
import {
  CollaborationFirstJoinRequiresHostBootstrapError,
  HostContextValidationError,
  LegacyOptionRejectedError,
} from '../../errors/document';
import { KernelError } from '../../errors';
import type { PivotExpansionStateProvider } from '@mog-sdk/contracts/pivot';
import type { DocumentSecurityConfig } from '@mog-sdk/contracts/security';
import type { TrapError } from '@mog/transport';
import { DocumentLifecycleSystem } from '../../document';
import { slog } from '../../lib/slog';
import type { RoomSnapshot as CollaborationRoomSnapshot } from '../../document/collab/ws-sidecar';
import { resolveUserTimezone } from './resolve-user-timezone';
import type {
  CollaborationDocumentCreateOptions,
  CollaborationSidecar,
  CollaborationSidecarConfig,
  DocumentHandle,
  DocumentHandleInternal,
  DocumentHandleWorkbookConfig,
} from './document-handle-types';
import {
  assertInteractiveDeferredImportToken,
  createFromXlsxDocument,
  type InteractiveDeferredImportToken,
  type XlsxDocumentImportOptions,
} from './xlsx-document-import';
import { createHandleLiveness, type HandleLiveness } from '../lifecycle/handle-liveness';

export { INTERNAL_INTERACTIVE_DEFERRED_IMPORT } from './xlsx-document-import';
export type {
  CollaborationDocumentCreateOptions,
  CollaborationPresenceState,
  CollaborationSidecar,
  CollaborationSidecarConfig,
  CollaborationSidecarStatus,
  DocumentHandle,
  DocumentHandleInternal,
  DocumentHandleWorkbookConfig,
  DocumentHandleTrapRecovery,
} from './document-handle-types';

// =============================================================================
// Legacy Option Guards
// =============================================================================

/**
 * Reject legacy `CreateDocumentOptions` fields that bypass the provider
 * lifecycle when called from a production facade (browser environment).
 *
 * - `providers`: never consumed by the lifecycle system — always rejected.
 * - `yrsState` / `initialSnapshot`: legitimate for headless collab paths
 *   but must not appear in browser facades (the provider lifecycle owns
 *   state hydration in browser).
 *
 * Headless callers (SDK, tests) are exempt: they explicitly opt in via
 * `environment: 'headless'` and own their own state pipeline.
 */
function rejectLegacyOptions(
  options: CreateDocumentOptions | undefined,
  environment: 'browser' | 'headless',
): void {
  if (!options) return;

  if (options.providers && options.providers.length > 0) {
    throw new LegacyOptionRejectedError(
      'CreateDocumentOptions.providers is no longer consumed. ' +
        'Provider selection is determined by the runtime environment. ' +
        'Remove the `providers` field from your options.',
    );
  }

  if (environment === 'browser') {
    if (options.yrsState) {
      throw new LegacyOptionRejectedError(
        'CreateDocumentOptions.yrsState is not allowed in browser environment. ' +
          'Use the provider lifecycle (IndexedDB) for state hydration, or pass ' +
          '`environment: "headless"` for collaboration / test paths.',
      );
    }
    if (options.initialSnapshot) {
      throw new LegacyOptionRejectedError(
        'CreateDocumentOptions.initialSnapshot is not allowed in browser environment. ' +
          'Use the provider lifecycle (IndexedDB) for state hydration, or pass ' +
          '`environment: "headless"` for collaboration / test paths.',
      );
    }
  }
}

function assertSupportedImportSource(
  source: DocumentSource,
  environment: 'browser' | 'headless',
): void {
  if (!source || (source.type !== 'bytes' && source.type !== 'path')) {
    throw new LegacyOptionRejectedError(
      `Unsupported DocumentSource kind '${String((source as { type?: unknown } | undefined)?.type)}'. ` +
        'Import sources must be resolved through bytes or a host-backed source resolver.',
    );
  }

  if (source.type === 'path' && environment === 'headless') {
    throw new LegacyOptionRejectedError(
      'DocumentSource.path is not accepted in headless/public Node imports. ' +
        'Resolve paths through host-backed source resolvers/materializers or pass bytes.',
    );
  }
}

export async function createInteractiveDeferredDocumentFromXlsx(
  source: DocumentSource,
  options: XlsxDocumentImportOptions,
  token: InteractiveDeferredImportToken,
): Promise<DocumentImportResult & { handle?: DocumentHandle }> {
  assertInteractiveDeferredImportToken(token);
  return createFromXlsxDocument(source, options, 'interactiveDeferred', {
    generateDocumentId,
    clock: DOCUMENT_FACTORY_CLOCK,
    createDocumentHandle,
  });
}

// =============================================================================
// ID Generation
// =============================================================================

/**
 * Generate a unique document ID using UUID v7 format.
 * Time-sortable and collision-resistant.
 */
function currentEpochMillis(): number {
  return Date.now();
}

const DOCUMENT_FACTORY_CLOCK: KernelClock = {
  now: currentEpochMillis,
  dateNow: currentEpochMillis,
};

function generateDocumentId(): string {
  // UUID v7 implementation (matches generateCellId in cell-identity.ts)
  const timestamp = currentEpochMillis();

  // Convert timestamp to hex (48 bits = 12 hex chars)
  const timestampHex = timestamp.toString(16).padStart(12, '0');

  // Generate random bytes for the rest
  const randomBytes = new Uint8Array(10);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(randomBytes);
  } else {
    // Fallback for environments without crypto (tests, SSR)
    for (let i = 0; i < 10; i++) {
      randomBytes[i] = Math.floor(Math.random() * 256);
    }
  }

  // Build UUID v7 string
  // Format: xxxxxxxx-xxxx-7xxx-yxxx-xxxxxxxxxxxx
  const hex = Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const uuid = [
    timestampHex.slice(0, 8),
    timestampHex.slice(8, 12),
    '7' + hex.slice(0, 3), // Version 7
    ((parseInt(hex.slice(3, 4), 16) & 0x3) | 0x8).toString(16) + hex.slice(4, 7), // Variant
    hex.slice(7, 19),
  ].join('-');

  return `doc-${uuid}`;
}

// =============================================================================
// DocumentFactory
// =============================================================================

/**
 * Stateless factory for creating document handles.
 * Does not track open documents - caller manages lifecycle.
 *
 * Returns DocumentContext instead of SpreadsheetStore.
 *
 * @example
 * ```typescript
 * import { Cells, Sheets, Mutations } from '@mog/spreadsheet-engine';
 *
 * // Create a blank document
 * const handle = await DocumentFactory.create();
 * const ctx = handle.context;
 *
 * // Create from XLSX
 * const result = await DocumentFactory.createFromXlsx(file);
 * if (result.success && result.handle) {
 *   const ctx = result.handle.context;
 *   const sheetId = SheetMeta.getOrder(ctx)[0];
 * }
 *
 * // Always dispose when done
 * handle.dispose();
 * ```
 */
export const DocumentFactory = {
  /**
   * Create a new blank document.
   *
   * @param options - Optional configuration
   * @returns Promise resolving to a DocumentHandle
   *
   * @example
   * ```typescript
   * import { Sheets, Mutations } from '@mog/spreadsheet-engine';
   *
   * // Create with defaults (IndexedDB persistence)
   * const handle = await DocumentFactory.create();
   * const ctx = handle.context;
   * const sheetId = SheetMeta.getOrder(ctx)[0];
   * Mutations.setCellValue(ctx, sheetId, 0, 0, 'Hello');
   *
   * // Create with custom ID
   * const handle = await DocumentFactory.create({ documentId: 'my-doc-123' });
   *
   * // Create with WebSocket collaboration
   * const handle = await DocumentFactory.create({
   *   providers: [
   *     { type: 'indexeddb' },
   *     { type: 'websocket', url: 'wss://collab.example.com' }
   *   ]
   * });
   * ```
   */
  async create(
    options?: CreateDocumentOptions & {
      environment?: 'browser' | 'headless';
      napiAddon?: unknown;
      security?: DocumentSecurityConfig;
      /**
       * IANA timezone name for the user's calendar frame. See `IKernelContext.userTimezone`.
       * In a real browser environment this is auto-resolved from `Intl.DateTimeFormat()`
       * if omitted; in headless / cloud-worker environments the caller MUST provide it,
       * else `CONFIG_MISSING_USER_TIMEZONE` is thrown — host TZ is meaningless when the
       * host is not the user's device.
       */
      userTimezone?: string;
    },
  ): Promise<DocumentHandle> {
    const environment = options?.environment ?? 'browser';
    rejectLegacyOptions(options, environment);

    const documentId = options?.documentId ?? generateDocumentId();

    const userTimezone = resolveUserTimezone(
      options?.userTimezone,
      environment === 'headless' ? 'headless' : 'browser',
    );

    const lifecycle = new DocumentLifecycleSystem({
      environment: options?.environment,
      napiAddon: options?.napiAddon,
      security: options?.security,
      userTimezone,
      clock: DOCUMENT_FACTORY_CLOCK,
    });
    lifecycle.create(documentId, options ?? {});
    await lifecycle.waitForReady();

    const context = lifecycle.documentContext as ISpreadsheetKernelContext;

    return createDocumentHandle(documentId, lifecycle, context);
  },

  /**
   * Create a WebSocket collaboration document from room-owned Yrs bytes.
   *
   * Normal browser creation still rejects caller-supplied `yrsState`. This
   * path obtains the authoritative room snapshot first, constructs the engine
   * from that state, and suppresses lifecycle default-sheet synthesis.
   */
  async createForCollaboration(
    options: CollaborationDocumentCreateOptions,
  ): Promise<DocumentHandle> {
    throw new CollaborationFirstJoinRequiresHostBootstrapError(
      'Use the host-backed collaboration creation API for first joins',
    );
  },

  /**
   * Create a new document from an XLSX file.
   * Uses Cell Identity Model for formula storage.
   *
   * @param source - File, ArrayBuffer, or Uint8Array containing XLSX data
   * @param options - Optional import configuration
   * @returns Promise resolving to import result with DocumentHandle
   *
   * @example
   * ```typescript
   * import { Sheets } from '@mog/spreadsheet-engine';
   *
   * // Import from file input
   * const file = fileInput.files[0];
   * const result = await DocumentFactory.createFromXlsx(file);
   *
   * if (result.success && result.handle) {
   *   // Use the document
   *   const ctx = result.handle.context;
   *   const sheetId = SheetMeta.getOrder(ctx)[0];
   *   console.log('Imported sheet:', sheetId);
   *
   *   // Don't forget to dispose when done
   *   result.handle.dispose();
   * } else {
   *   console.error('Import failed:', result.error);
   * }
   *
   * // Import with progress
   * const result = await DocumentFactory.createFromXlsx(file, {
   *   onProgress: (p) => console.log(`${p.percentage}%`)
   * });
   * ```
   */
  async createFromXlsx(
    source: DocumentSource,
    options?: DocumentImportOptions & {
      environment?: 'browser' | 'headless';
      napiAddon?: unknown;
      security?: DocumentSecurityConfig;
      /**
       * IANA timezone name for the user's calendar frame. See `IKernelContext.userTimezone`.
       * Auto-resolved from `Intl` in a real browser; required in headless environments.
       */
      userTimezone?: string;
    },
  ): Promise<DocumentImportResult & { handle?: DocumentHandle }> {
    return createFromXlsxDocument(source, options, 'durable', {
      generateDocumentId,
      clock: DOCUMENT_FACTORY_CLOCK,
      createDocumentHandle,
    });
  },

  /**
   * Create a new document from a CSV file.
   *
   * Mirror of `createFromXlsx`. Resolves CSV bytes from the source
   * (path or inline), spins up a `DocumentLifecycleSystem`, dispatches
   * the `CREATE_FROM_CSV` event, and waits for the machine to reach
   * `ready`. The Rust `csv_parser` crate handles encoding sniff,
   * dialect detection, type inference, hydration, and recalc.
   */
  async createFromCsv(
    source: DocumentSource,
    options?: DocumentImportOptions & {
      environment?: 'browser' | 'headless';
      napiAddon?: unknown;
      security?: DocumentSecurityConfig;
      /**
       * IANA timezone name for the user's calendar frame. See `IKernelContext.userTimezone`.
       * Auto-resolved from `Intl` in a real browser; required in headless environments.
       */
      userTimezone?: string;
      csvOptions?: CsvImportOptions;
    },
  ): Promise<DocumentImportResult & { handle?: DocumentHandle }> {
    let lifecycle: DocumentLifecycleSystem | undefined;

    try {
      const environment = options?.environment ?? 'browser';
      rejectLegacyOptions(options, environment);
      assertSupportedImportSource(source, environment);

      const userTimezone = resolveUserTimezone(
        options?.userTimezone,
        environment === 'headless' ? 'headless' : 'browser',
      );

      lifecycle = new DocumentLifecycleSystem({
        environment: options?.environment,
        napiAddon: options?.napiAddon,
        security: options?.security,
        userTimezone,
        clock: DOCUMENT_FACTORY_CLOCK,
      });
      lifecycle.createFromCsv(
        options?.documentId ?? generateDocumentId(),
        { skipDefaultSheet: true },
        source,
        options?.csvOptions ?? null,
      );
      await lifecycle.waitForReady();

      const snap = lifecycle.snapshot;
      const documentId = snap.context.docId;
      const sheetIds = snap.context.initialSheetIds ?? [];

      const context = lifecycle.documentContext as ISpreadsheetKernelContext;

      const handle = createDocumentHandle(documentId, lifecycle, context);

      return {
        success: true,
        sheetIds,
        handle,
        warnings: [],
      };
    } catch (error) {
      if (lifecycle) {
        lifecycle.dispose().catch(() => {});
      }

      return {
        success: false,
        sheetIds: [],
        error: error instanceof Error ? error : new Error(String(error)),
        warnings: [
          {
            type: 'import_error',
            message: `CSV import failed: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  },

  /**
   * Create a new document using a host contract context.
   *
   * **LEGACY / COOPERATIVE — NOT HOST-BOUNDARY-COMPLIANT.**
   *
   * This method is a transitional path from before the host boundary
   * contract was formalized. It is NOT compliant with the host boundary
   * because:
   *
   * 1. It still accepts a caller-supplied `documentId` — host-compliant
   *    paths derive document identity exclusively from the authorized
   *    storage handoff (`host.storage.resourceContext.documentId`).
   * 2. It does not validate the `AuthorizedDocumentStorageHandoff` replay
   *    registry, nonce, expiry, principal consistency, tenant/workspace
   *    marker cross-checks, or storage config safety.
   * 3. It maps `KernelRuntimeConfig.kind` to legacy `environment` rather
   *    than using explicit transport bindings.
   * 4. It does not consume `HostKernelAdapterBindings` for provider
   *    materializers, source handle resolvers, or transport bindings.
   *
   * The host-boundary-compliant path is through the private
   * `@mog/kernel-host-internal` package, which calls
   * `validateKernelHostContextForDocument()` and produces a
   * `KernelDocumentLifecycleInput` before any engine construction.
   *
   * Do NOT remove this method yet — existing callers depend on it.
   * New host-backed construction must use `@mog/kernel-host-internal`.
   *
   * @deprecated Use `@mog/kernel-host-internal` for host-boundary-compliant construction.
   */
  async createFromHostContext(
    hostContext: KernelHostContext,
    options?: {
      documentId?: string;
      skipDefaultSheet?: boolean;
      providers?: never;
      initialSnapshot?: never;
      yrsState?: never;
    },
  ): Promise<DocumentHandle> {
    if ((options as any)?.providers) {
      throw new HostContextValidationError(
        'providers is not accepted on the host context path; use AuthorizedDocumentStorageHandoff',
      );
    }
    if ((options as any)?.initialSnapshot) {
      throw new HostContextValidationError(
        'initialSnapshot is not accepted on the host context path; raw materialization requires authorized handoff',
      );
    }
    if ((options as any)?.yrsState) {
      throw new HostContextValidationError(
        'yrsState is not accepted on the host context path; raw materialization requires authorized handoff',
      );
    }

    const documentId = options?.documentId ?? generateDocumentId();

    const runtimeKind = hostContext.runtime.kind;
    const environment: 'browser' | 'headless' =
      runtimeKind === 'browser-wasm-worker' || runtimeKind === 'tauri-native'
        ? 'browser'
        : 'headless';

    const userTimezone = hostContext.timezone.userTimezone;

    const lifecycle = new DocumentLifecycleSystem({
      environment,
      security: undefined,
      userTimezone,
      kernelHostContext: hostContext,
      clock: hostContext.clock,
    });
    lifecycle.create(documentId, {
      skipDefaultSheet: options?.skipDefaultSheet,
    });
    await lifecycle.waitForReady();

    const context = lifecycle.documentContext as ISpreadsheetKernelContext;

    return createDocumentHandle(documentId, lifecycle, context);
  },
};

// =============================================================================
// Handle Constructor (shared between create and createFromXlsx)
// =============================================================================

// Module-level cache for lazy imports (Issue 9: avoid dynamic import on every call)
//
// We import `createWorkbookFromConfig` directly from `../workbook/workbook-impl`
// rather than the public overloaded `createWorkbook()` dispatcher. The dispatcher
// lives in `../workbook/create-workbook.ts`, which itself imports `DocumentFactory`
// from this file — importing it here would reintroduce an `impl ↔ factory` cycle.
// The handle-workbook path only ever uses the `WorkbookConfig` overload anyway.
let _createWorkbookFromConfig:
  | (typeof import('../workbook/workbook-impl'))['createWorkbookFromConfig']
  | undefined;

async function loadWorkbookModule() {
  if (!_createWorkbookFromConfig) {
    const mod = await import('../workbook/workbook-impl');
    _createWorkbookFromConfig = mod.createWorkbookFromConfig;
  }
  return {
    createWorkbookFromConfig: _createWorkbookFromConfig,
  };
}

function createDocumentHandle(
  documentId: string,
  lifecycle: DocumentLifecycleSystem,
  context: ISpreadsheetKernelContext,
  collaborationBootstrap?: CollaborationRoomSnapshot,
  importWarnings: readonly DocumentImportWarning[] = [],
): DocumentHandleInternal {
  let disposed = false;
  let cachedWorkbook: Workbook | undefined;
  let cachedSyncPort: DocumentByteSyncPort | undefined;
  const workbookTokens = new Set<HandleLiveness>();

  let disposePromise: Promise<void> | null = null;

  const assertNotDisposed = (operation: string) => {
    if (disposed) {
      throw new KernelError('DOC_DISPOSED', `DocumentHandle.${operation}: handle is disposed`, {
        context: { operation, documentId },
      });
    }
  };

  const createWorkbookLiveness = (operation: string): HandleLiveness => {
    const documentContext = context as unknown as DocumentContext;
    const token = createHandleLiveness({
      label: 'Workbook',
      code: 'BRIDGE_DISPOSED',
      metadata: {
        label: 'Workbook',
        documentId,
        sessionId: documentContext.workbookLinkScope().requestingSessionId,
        createdBy: operation,
      },
    });
    workbookTokens.add(token);
    token.onInvalidate(() => {
      workbookTokens.delete(token);
    });
    return token;
  };

  const invalidateWorkbooks = (operation: string): void => {
    for (const token of [...workbookTokens]) {
      token.invalidate({
        operation,
        message: 'Workbook handle is closed, disposed, or invalidated.',
        metadata: { documentId },
      });
    }
  };

  const beginDocumentDisposal = (operation: string): void => {
    if (!disposed) {
      disposed = true;
    }
    invalidateWorkbooks(operation);
  };

  const disposeAsync = async () => {
    if (disposePromise) return disposePromise;
    beginDocumentDisposal('document.disposeAsync');
    disposePromise = Promise.resolve().then(async () => {
      // Dispose cached workbook first (it may flush state)
      if (cachedWorkbook) {
        const workbook = cachedWorkbook;
        cachedWorkbook = undefined;
        workbook.dispose();
      }
      await lifecycle.dispose();
    });
    return disposePromise;
  };

  const handle: DocumentHandleInternal = {
    documentId,
    context,
    initialSheetId: lifecycle.initialSheetId,
    importWarnings,
    get isDisposed() {
      return disposed;
    },

    // --- Public accessors (new, replace direct context access) ---
    eventBus: context.eventBus,
    get undoService() {
      return context.services?.undo;
    },

    registerPivotExpansionProvider(provider: PivotExpansionStateProvider): void {
      (context as { pivotExpansionProvider?: PivotExpansionStateProvider }).pivotExpansionProvider =
        provider;
    },

    registerChartImageExporter(factory: (chartBridge: IChartBridge) => ChartImageExporter): void {
      (context as { chartImageExporter?: ChartImageExporter }).chartImageExporter = factory(
        context.charts,
      );
    },

    async attachCollaborationSidecar(
      config: CollaborationSidecarConfig,
    ): Promise<CollaborationSidecar> {
      assertNotDisposed('attachCollaborationSidecar');
      throw new CollaborationFirstJoinRequiresHostBootstrapError(
        'Public sidecar attach cannot perform a first join',
      );
    },

    createSyncPort(): DocumentByteSyncPort {
      assertNotDisposed('createSyncPort');
      if (cachedSyncPort) return cachedSyncPort;

      cachedSyncPort = {
        docId: documentId,
        async applyUpdate(update: Uint8Array): Promise<void> {
          assertNotDisposed('syncPort.applyUpdate');
          await lifecycle.computeBridge.syncApply(update);
        },
        encodeDiff(remoteStateVector: Uint8Array): Promise<Uint8Array> {
          assertNotDisposed('syncPort.encodeDiff');
          return lifecycle.computeBridge.encodeDiff(remoteStateVector);
        },
        currentStateVector(): Promise<Uint8Array> {
          assertNotDisposed('syncPort.currentStateVector');
          return lifecycle.computeBridge.currentStateVector();
        },
      };

      return cachedSyncPort;
    },

    // Lifecycle hooks — proxy to the orchestrator. The
    // RustDocument may be `null` very early (pre-engine-init); treat that
    // as "no-op for flushSync, zero for pending, false for failure flags"
    // so the shell's lifecycle handlers can iterate handles uniformly
    // without per-doc null guards.
    flushSync: () => {
      lifecycle.rustDocument?.flushSync();
    },
    get pendingUpdatesCount() {
      return lifecycle.rustDocument?.pendingUpdatesCount ?? 0;
    },
    get hasFlushFailed() {
      return lifecycle.rustDocument?.hasFlushFailed ?? false;
    },
    get hasAppendActive() {
      return lifecycle.rustDocument?.hasAppendActive ?? false;
    },
    get isReadOnly() {
      return lifecycle.rustDocument?.isReadOnly ?? false;
    },

    dispose: disposeAsync,
    disposeAsync,

    // `__dt`-only enumeration surface — see the corresponding interface
    // field's JSDoc. Returns a defensive copy of the orchestrator's
    // Provider list (already a copy at the RustDocument layer).
    _devtoolsProviders: () => lifecycle.rustDocument?._devtoolsProviders() ?? [],

    scheduleDeferredHydration: () => lifecycle.scheduleDeferredHydration(),
    ensureDeferredHydration: () => lifecycle.ensureDeferredHydration(),
    awaitMaterialized: (scope) => lifecycle.awaitMaterialized(scope),
    get isImportDurabilityPending() {
      return lifecycle.isImportDurabilityPending;
    },
    awaitImportDurability: () => lifecycle.awaitImportDurability(),
    get storageState() {
      return lifecycle.storageState;
    },

    async attachStorageProvider(provider: Provider): Promise<void> {
      assertNotDisposed('attachStorageProvider');
      const rustDoc = lifecycle.rustDocument;
      if (!rustDoc) {
        throw new Error(
          'DocumentHandle.attachStorageProvider: engine not ready — rustDocument is null',
        );
      }
      await rustDoc.attachProvider(provider);
    },

    async checkpoint(): Promise<CheckpointResult> {
      const rustDoc = lifecycle.rustDocument;
      if (!rustDoc) {
        return {
          status: 'failed',
          highWaterMark: { mark: 'hwm-no-doc', capturedAt: Date.now(), pendingMutationCount: 0 },
          providerResults: [],
          timestamp: Date.now(),
        };
      }
      return rustDoc.checkpointStructured();
    },

    async close(): Promise<CloseResult> {
      const rustDoc = lifecycle.rustDocument;
      if (!rustDoc) {
        await disposeAsync();
        return {
          status: 'closed',
          detachedProviders: [],
          errors: [],
          timestamp: Date.now(),
        };
      }
      beginDocumentDisposal('document.close');
      const result = await rustDoc.close();
      await disposeAsync();
      return result;
    },

    // Trap-recovery surface — see DocumentHandleTrapRecovery for contract.
    // Reads `lifecycle.computeBridge` lazily inside `onTrap` because the
    // bridge isn't available until the machine reaches `ready`. The
    // recovery coordinator polls handles via DocumentManager.subscribe()
    // and only calls `onTrap` after the doc is ready, so the lazy read
    // is safe; the synchronous `lifecycle.computeBridge` getter throws
    // if accessed pre-ready, which surfaces a programmer error fast.
    _trapRecovery: {
      onTrap: (listener: (trap: TrapError) => void): (() => void) => {
        // If the bridge has been swapped out by a recovery cycle, the
        // listener subscribes to whichever bridge is current at call
        // time. The coordinator typically (re-)subscribes after each
        // recovery, so this matches the expected lifecycle.
        return lifecycle.computeBridge.onTrap(listener);
      },
      sendTrap: (trap: TrapError): void => {
        // Mark the bridge first (idempotent — auto-marker may already
        // have done it on the originating doc). Then send TRAP to the
        // machine so the UI surfaces the error state. Order matters
        // only weakly: a sibling-doc TRAP arriving before the bridge
        // observes a trap is fine — we're proactively marking the
        // bridge dead because we KNOW the shared WASM is gone.
        try {
          // Bridge may not be ready yet (machine in `creating` etc.) —
          // accessing the getter throws, which is fine, just send TRAP.
          lifecycle.computeBridge.core.markModuleTrapped(trap);
        } catch {
          // Pre-ready trap: no bridge to mark, but the machine still
          // needs to know. Fall through to actor.send.
        }
        lifecycle.sendTrap(trap);
      },
      recover: (yrsState?: Uint8Array): Promise<void> => {
        return lifecycle.recover(yrsState);
      },
    },

    async [Symbol.asyncDispose]() {
      await disposeAsync();
    },

    workbook: async function (this: DocumentHandleInternal, config?: DocumentHandleWorkbookConfig) {
      assertNotDisposed('workbook');
      const ownerHandle = (this as DocumentHandleInternal | undefined) ?? handle;
      // Config-accepting path: fresh workbook each call (not cached).
      if (config) {
        const { createWorkbookFromConfig } = await loadWorkbookModule();
        return createWorkbookFromConfig({
          ctx: context,
          eventBus: context.eventBus,
          stateProvider: config.stateProvider,
          previouslySaved: config.previouslySaved,
          name: config.name,
          readOnly: config.readOnly,
          onSave: config.onSave,
          writeFile: config.writeFile,
          importWarnings: config.importWarnings ?? importWarnings,
          liveness: createWorkbookLiveness('document.workbook(config)'),
        });
      }

      // Zero-arg path: cached workbook with disposal chain.
      if (cachedWorkbook) return cachedWorkbook;

      const { createWorkbookFromConfig } = await loadWorkbookModule();
      const wb = await createWorkbookFromConfig({
        ctx: context,
        eventBus: context.eventBus,
        importWarnings,
        liveness: createWorkbookLiveness('document.workbook'),
      });

      // Chain disposal: production close/async-dispose awaits the handle;
      // sync dispose remains local-start cleanup for IDisposable callers.
      const originalWbDispose = wb.dispose.bind(wb);
      const originalWbSave = wb.save.bind(wb);
      wb.dispose = () => {
        originalWbDispose();
        void ownerHandle.dispose().catch((err) => {
          slog('documentHandle.workbookDisposeFailed', { error: err });
        });
      };
      wb.close = async (closeBehavior?: 'save' | 'skipSave') => {
        if (closeBehavior === 'save') {
          await originalWbSave();
        }
        originalWbDispose();
        await ownerHandle.dispose();
      };
      wb[Symbol.asyncDispose] = async () => {
        originalWbDispose();
        await ownerHandle.dispose();
      };

      cachedWorkbook = wb;
      return wb;
    },
  };

  return handle;
}

/**
 * Internal-only named export for workspace-private consumers
 * (e.g. `@mog/kernel-host-internal`). NOT part of the public SDK surface.
 */
export { createDocumentHandle as _createDocumentHandleInternal };
