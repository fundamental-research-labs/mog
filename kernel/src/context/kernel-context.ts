/**
 * Kernel Context - Consolidated Factory
 *
 * Single factory (`createDocumentContext`) that creates the full DocumentContext.
 * Different consumers see different tiers via TypeScript type narrowing:
 *
 * 1. IDomainContext (domain modules)
 *    - Event bus + undo description only
 *    - NO bridges
 *
 * 2. IKernelContext (shell)
 *    - Includes all bridges + services + destroy()
 *
 * 3. DocumentContext (engine internals)
 *    - Full context: + compute bridge + viewport buffers
 */

// Import context interfaces from contracts - SINGLE SOURCE OF TRUTH
// The canonical definitions are in contracts/src/kernel/kernel-context.ts
import type { IDiagramBridge, ITextEffectRenderingBridge } from '@mog-sdk/contracts/bridges';
import type {
  IDomainContext,
  IKernelContext,
  ISlicerBridge,
  ISpreadsheetKernelContext,
} from '@mog-sdk/contracts/kernel';
import type { MaterializationState } from '@mog-sdk/contracts/api';
import type { SheetId } from '@mog-sdk/contracts/core';
import type { SelectionCheckpoint } from '@mog-sdk/contracts/selection';
import type { IKernelServices } from '@mog-sdk/contracts/services';
import type { DocumentSecurityConfig } from '@mog-sdk/contracts/security';
import type { KernelHostContext } from '@mog-sdk/types-host/kernel';

import type { ICanvasEventBus } from '@mog-sdk/contracts/objects/canvas-object';

import { ChartBridge } from '../domain/charts/chart-bridge';
import { getEquationBridge } from '../domain/equations/equation-bridge';
import { createInkRecognitionBridge } from '../domain/drawing/ink-recognition-bridge';
import { LocaleInputBridge } from '../bridges/locale-bridge';
import { PivotBridge } from '../bridges/pivot-bridge';
import { SchemaValidationBridge } from '../bridges/schema-bridge';
import { createDiagramBridge } from '../domain/diagram/diagram-bridge';
import { KernelError } from '../errors';
import { DocumentNotReadyError } from '../errors/document';

import type { ComputeBridge } from '../bridges/compute/compute-bridge';
import { createTextEffectRenderingBridge } from '../domain/text-effects/text-effects-bridge';
import { createClipboardService } from '../services/clipboard';
import { createNotificationsService } from '../services/notifications';
import { createQueryExecutor } from '../services/query-executor';
import { createSecurityEventRelay } from '../services/security/security-event-relay';
import { createUndoService } from '../services/undo';
import { installExternalFormulaReadbacks } from '../services/external-formulas';
import { createSpreadsheetObjectManager } from '../floating-objects/spreadsheet-object-manager';
import { wrapBridgeForDevTools } from './bridge-devtools-wrapper';
import { createEventBus } from './event-bus';
import { createStateMirror } from '../document/state-mirror';
import { RangeMetadataCache } from '../bridges/wire/range-metadata-cache';
import { disposeWorksheetValidationCache } from '../api/worksheet/validation-cache';

import type { DocumentContext, KernelClock } from './types';
import { WriteGate } from '../document/write-gate';
import {
  NO_HOST_OPERATION_GATE,
  type MaybeHostOperationGate,
} from '../document/host-operation-gate';
import { createWorkbookLinkService } from '../services/workbook-links';
import type { WorkbookLinkResolver, WorkbookLinkStatusScope } from '../services/workbook-links';

// Re-export contract types for local use
export type { IDomainContext, IKernelContext, ISlicerBridge, ISpreadsheetKernelContext };

// Re-export DocumentContext types for convenience
export type { DocumentContext, KernelClock } from './types';

// =============================================================================
// Options
// =============================================================================

/**
 * Options for creating a DocumentContext.
 */
export interface DocumentContextOptions {
  /** 'app' for browser/Tauri, 'headless' for Node.js */
  environment?: 'app' | 'headless';
  /** Optional security configuration for data access control */
  security?: DocumentSecurityConfig;
  /**
   * IANA timezone name representing the user's calendar frame for this session.
   * Required — the embedding host must supply this. See `IKernelContext.userTimezone`
   * for the rationale (host-local is meaningless on a cloud worker).
   */
  userTimezone: string;

  /** Document-scoped time authority. Host-backed documents pass the trusted host clock. */
  clock: KernelClock;

  /**
   * Host contract context (02a foundation). When present, principal setup
   * is awaited (not fire-and-forget) and timezone is taken from the host
   * context's policy rather than the separate `userTimezone` field.
   */
  kernelHostContext?: KernelHostContext;

  /**
   * Host document operation gate (02b). When present, export/share/delete/destroy
   * operations are gated through authorization. Legacy documents get
   * NO_HOST_OPERATION_GATE sentinel.
   */
  operationGate?: MaybeHostOperationGate;
  /** Trusted host/runtime resolver for cross-workbook links. */
  workbookLinkResolver?: WorkbookLinkResolver;
  /** Trusted host/runtime identity for the current open workbook session. */
  workbookLinkScope?: WorkbookLinkStatusScope;
  /** Lifecycle-backed XLSX materialization barrier. Defaults to a resolved noop. */
  awaitMaterialized?: (scope?: SheetId | 'allSheets') => Promise<void>;
  /** Lifecycle-backed XLSX materialization state. Defaults to all-sheets ready. */
  getMaterializationState?: () => MaterializationState;
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a DocumentContext from a ComputeBridge.
 *
 * This is the single consolidated factory for kernel context creation.
 * Event emission is handled by MutationResultHandler — no separate
 * initialization step needed.
 *
 * NOTE: This factory does NOT wire the context back into the bridge.
 * The caller (DocumentLifecycleSystem.executeWireContext) is responsible for:
 *   computeBridge.setContext(ctx);
 *   computeBridge.initMutationHandler();
 *
 * @param computeBridge - The compute bridge (must be in CREATED or later phase)
 * @param options - Optional configuration (environment, etc.)
 */
export function createDocumentContext(
  computeBridge: ComputeBridge,
  options: DocumentContextOptions,
): DocumentContext {
  // Validate session timezone up front. The embedding host must supply this;
  // we never silently fall back to host-local because that's meaningless on a
  // cloud worker whose physical TZ differs from the user's.
  const userTimezone = options.userTimezone;
  if (typeof userTimezone !== 'string' || userTimezone.length === 0) {
    throw new KernelError(
      'CONFIG_MISSING_USER_TIMEZONE',
      'createDocumentContext requires options.userTimezone (an IANA timezone name).',
      {
        suggestion:
          "Pass userTimezone explicitly. Browser hosts: Intl.DateTimeFormat().resolvedOptions().timeZone. Cloud/agent hosts: read the user's timezone from session metadata.",
      },
    );
  }
  // Validate that the timezone resolves under Intl. Throws RangeError on bad zones.
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: userTimezone });
  } catch (cause) {
    throw new KernelError(
      'CONFIG_INVALID_USER_TIMEZONE',
      `userTimezone "${userTimezone}" is not a valid IANA timezone name.`,
      { cause, context: { userTimezone } },
    );
  }

  const eventBus = createEventBus();
  const isHeadless = options.environment === 'headless';

  // Kernel state mirror: single sync read view of bounded direct workbook/sheet
  // state. Constructed empty; populated by
  // `MutationResultHandler.applyAndNotify` (which calls `mirror.apply` BEFORE
  // any event emission) on every MutationResult — including hydration's
  // first MutationResult, so first paint is correct.
  //
  // Exposed on ctx as `MirrorReadView` (typed read-only). The concrete
  // `StateMirror` instance is reachable here for one-time wiring into the
  // MutationResultHandler via `compute-core.initMutationHandler`, and then
  // never again from the public ctx surface.
  const stateMirror = createStateMirror();

  // Range metadata cache: document-scoped cache for first-class
  // range metadata. Unlike CellMetadataCache (viewport-scoped, lazily created
  // from WorksheetImpl), this cache persists for the document lifetime and is
  // populated by MutationResultHandler from RangeChange entries. Wired into
  // the compute bridge via setRangeMetadataCache during init.
  const rangeMetadataCache = new RangeMetadataCache();
  computeBridge.setRangeMetadataCache(rangeMetadataCache);

  // Pending undo description state
  let pendingUndoDescription: string | null = null;

  // Pending selection checkpoint for undo/redo
  let pendingSelectionCheckpoint: SelectionCheckpoint | null = null;

  // ---------------------------------------------------------------------------
  // Deferred Context Initialization
  //
  // Bridges need a reference to ctx in their constructors, but ctx needs the
  // bridges. We solve this with a deferred-reference holder: bridges capture
  // `ctxRef` and access `ctxRef.current` lazily (never at construction time).
  // After all bridges are created, we build the final DocumentContext and set
  // ctxRef.current so bridges see the complete object.
  // ---------------------------------------------------------------------------
  const ctxRef: { current: DocumentContext | null } = { current: null };

  // ---------------------------------------------------------------------------
  // Create bridges. They store a lazy reference via getCtx().
  // We pass a Proxy that delegates to ctxRef.current, so bridges that store
  // the ctx reference at construction time will see the full object when they
  // later access properties on it.
  // ---------------------------------------------------------------------------
  const ctxProxy = new Proxy({} as DocumentContext, {
    get(_target, prop, receiver) {
      const real = ctxRef.current;
      if (real === null) {
        // During construction, only eventBus is accessed (by PivotBridge etc.)
        if (prop === 'eventBus') return eventBus;
        throw new DocumentNotReadyError(
          `[kernel-context] BUG: bridge accessed ctx.${String(prop)} before initialization`,
        );
      }
      return Reflect.get(real, prop, receiver);
    },
    set(_target, prop, value) {
      const real = ctxRef.current;
      if (real === null) {
        throw new DocumentNotReadyError(
          `[kernel-context] BUG: bridge set ctx.${String(prop)} before initialization`,
        );
      }
      return Reflect.set(real, prop, value);
    },
  });

  // Create bridges using the proxy (they store the reference, access lazily)
  const pivot = wrapBridgeForDevTools(new PivotBridge(ctxProxy), 'pivot');

  // Schema bridge: create now, start() deferred until computeBridge is wired (see below)
  const schema = wrapBridgeForDevTools(new SchemaValidationBridge(ctxProxy), 'schema');

  // Locale bridge: create for locale-aware input normalization
  // Locale-aware special input handling.
  //
  // The prior implementation maintained a fire-and-forget side cache populated by
  // `computeBridge.getWorkbookSettings()` on construction, with a default
  // of 'en-US' until that promise resolved. The kernel state
  // mirror is the canonical sync read for workbook settings — it returns
  // the schema default until hydration's first MutationResult lands, then
  // the post-hydration culture. `LocaleInputBridge` calls
  // `getWorkbookCultureName()` lazily at use-time, so reading from the
  // mirror at that moment yields the correct value.
  const locale = new LocaleInputBridge(ctxProxy, {
    getWorkbookCultureName: () => stateMirror.getCulture(),
  });

  // Chart bridge: create for charts library integration
  const charts = wrapBridgeForDevTools(new ChartBridge(ctxProxy), 'chart');
  charts.start(); // Start listening to cell and chart changes

  // TextEffect rendering bridge: create for TextEffect rendering and caching
  let textEffectsRendering: ITextEffectRenderingBridge;
  if (isHeadless) {
    // Headless: no-op stub — TextEffect rendering requires Canvas 2D (browser-only)
    textEffectsRendering = {
      start: () => () => {},
      stop: () => {},
      destroy: () => {},
      invalidateCache: () => {},
      clearCache: () => {},
      computeDrawingObjects: async () => null,
    };
  } else {
    textEffectsRendering = createTextEffectRenderingBridge(ctxProxy);
    textEffectsRendering.start(); // Start listening to TextEffect change events for cache invalidation
  }

  // Equation bridge: singleton for OMML and LaTeX parsing
  // Wave 2: Equation Feature (Excel Parity)
  const equationBridge = getEquationBridge();

  // Diagram bridge: pure model operations and cache management. Headless API
  // evals still need node/style operations even when no browser renderer exists.
  const diagram: IDiagramBridge = createDiagramBridge(ctxProxy);
  diagram.start(); // Start listening to Diagram events for cache invalidation

  // Floating object manager: document-scoped singleton for object CRUD, transforms, ordering.
  // Created here so all consumers (WorkbookImpl, SheetCoordinator, helpers) share one instance.
  // The manager uses ComputeBridge directly for dimension queries.
  const floatingObjectManager = createSpreadsheetObjectManager({
    computeBridge,
    eventBus: eventBus as ICanvasEventBus,
  });

  // ---------------------------------------------------------------------------
  // Security — Rust-native enforcement.
  //
  // When `options.security.resolvePrincipal` is provided, forward the
  // resolved principal to the Rust session at context construction. All
  // policy evaluation, attenuation, and viewport redaction live in Rust
  // (compute-security + compute-core storage); the TS kernel has no
  // policy state.
  //
  // Fire-and-forget: `setActivePrincipal` is a lightweight ArcSwap on
  // the Rust side, and failing to set it (e.g. WASM transport not yet
  // ready) falls back to the default anonymous principal — still safe
  // because `security_active` is false by default until the first
  // policy is added.
  // ---------------------------------------------------------------------------
  // Host contract path: principal setup is handled by executeWireContext
  // with an awaited call. Skip the legacy fire-and-forget path.
  if (!options.kernelHostContext && options.security?.resolvePrincipal) {
    const resolved = options.security.resolvePrincipal();
    void computeBridge.setActivePrincipal({ tags: resolved.tags }).catch(() => {
      // Non-fatal — the session continues without an active principal.
    });
  }

  // Security event relay: polls `wbSecurityDrainEvents` on a cadence
  // and re-emits each raw Rust `SecurityEvent` on the kernel event
  // bus (security event relay). Kept before the final ctx assembly so the
  // relay handle can be wired into `ctx.destroy()` for cleanup —
  // forgetting to stop the interval would leak a timer in headless
  // server environments that spin up many short-lived contexts.
  const securityEventRelay = createSecurityEventRelay(computeBridge, eventBus);

  // ComputeBridge: wrap with devtools tracing (most important bridge for performance diagnosis).
  const wrappedComputeBridge = wrapBridgeForDevTools(computeBridge, 'compute');

  // Kernel services: create cross-app services that survive app switches
  // UndoService requires ComputeBridge, so we create it here after wiring.
  const services: IKernelServices = {
    clipboard: createClipboardService(),
    undo: createUndoService(computeBridge),
    notifications: createNotificationsService(),
    queryExecutor: createQueryExecutor(),
  };

  // ---------------------------------------------------------------------------
  // Assemble the final DocumentContext — all fields are fully initialized
  // ---------------------------------------------------------------------------
  const writeGate = new WriteGate();
  const operationGate: MaybeHostOperationGate = options.operationGate ?? NO_HOST_OPERATION_GATE;
  const workbookLinks = createWorkbookLinkService({ resolver: options.workbookLinkResolver });
  const workbookLinkScope: WorkbookLinkStatusScope = options.workbookLinkScope ?? {
    requestingDocumentId:
      options.kernelHostContext?.storage.resourceContext.documentId ?? 'unknown-document',
    requestingSessionId: options.kernelHostContext?.session.sessionId ?? 'unknown-session',
    actor: options.kernelHostContext?.principal.subjectId ?? 'trusted-host',
    principal: { tags: [...(options.kernelHostContext?.principal.tags ?? ['host:trusted'])] },
  };

  const ctx: DocumentContext = {
    clock: options.clock,
    writeGate,
    operationGate,
    workbookLinks,
    workbookLinkScope: () => workbookLinkScope,
    eventBus,
    userTimezone,
    pivot,
    schema,
    locale,
    charts,
    computeBridge: wrappedComputeBridge,
    awaitMaterialized: options.awaitMaterialized ?? (() => Promise.resolve()),
    getMaterializationState:
      options.getMaterializationState ??
      (() => ({ phase: 'AllSheetsReady', isDeferred: false, isMaterialized: true })),
    inkRecognition: createInkRecognitionBridge(),
    textEffectsRendering,
    equationBridge,
    diagram,
    floatingObjectManager,
    resolvePrincipal: options.security?.resolvePrincipal,
    services,
    // Read view of the kernel state mirror. The actual instance is the
    // writable `StateMirror` created above; the type narrows to read-only
    // here so consumers cannot reach into the apply path. The
    // MutationResultHandler picks up the writable reference via
    // `compute-core.initMutationHandler`, which casts back to StateMirror
    // at the single approved boundary.
    mirror: stateMirror,

    setPendingUndoDescription(description: string): void {
      pendingUndoDescription = description;
    },

    getPendingUndoDescription(): string | null {
      return pendingUndoDescription;
    },

    clearPendingUndoDescription(): void {
      pendingUndoDescription = null;
    },

    // Selection checkpoint methods
    setPendingSelectionCheckpoint(checkpoint: SelectionCheckpoint): void {
      pendingSelectionCheckpoint = checkpoint;
    },

    getPendingSelectionCheckpoint(): SelectionCheckpoint | null {
      return pendingSelectionCheckpoint;
    },

    clearPendingSelectionCheckpoint(): void {
      pendingSelectionCheckpoint = null;
    },

    destroy(): void {
      // Stop the security-event relay first so no more emissions land
      // on the bus during teardown.
      securityEventRelay.stop();
      // Cleanup services first
      ctx.services?.clipboard.dispose();
      ctx.services?.undo.dispose();
      ctx.services?.notifications.dispose();
      ctx.services?.queryExecutor.dispose();
      ctx.workbookLinks.dispose();
      // Cleanup floating object manager
      floatingObjectManager.dispose();
      // Cleanup range metadata cache
      rangeMetadataCache.dispose();
      // Cleanup document-scoped worksheet API caches.
      disposeWorksheetValidationCache(ctx as DocumentContext);
      // Cleanup bridges in reverse order of creation
      ctx.diagram.destroy();
      ctx.textEffectsRendering.destroy();
      ctx.inkRecognition.destroy();
      ctx.charts.destroy();
      ctx.locale.destroy();
      ctx.schema.stop();
      ctx.pivot.destroy();
    },
  };

  // Set the deferred reference so bridges (which captured ctxProxy) now see
  // the fully-initialized context.
  ctxRef.current = ctx;
  installExternalFormulaReadbacks(ctx);

  // Wire floating object manager to the document context (needed for chart integration).
  floatingObjectManager.setDocumentContext(ctx);

  // Start the security event relay — begin polling
  // `wbSecurityDrainEvents` and re-emitting on the kernel bus. Safe to
  // start here even before `bridge.start()` runs because a drain that
  // hits an uninitialised compute transport returns an empty list (the
  // relay logs the warning and retries on the next tick).
  securityEventRelay.start();

  // NOTE: Reverse wiring (setContext + initMutationHandler) is NOT done here.
  // The caller (DocumentLifecycleSystem.executeWireContext) handles that after
  // the factory returns, keeping orchestration logic out of the factory.
  //
  // bridge.start() is also NOT called here — it is managed by the
  // DocumentLifecycleSystem's 'starting' state. This ensures the bridge
  // is fully started (RecalcResult applied, subscriptions wired) before
  // any consumer can request a viewport refresh.
  //
  // Schema bridge: start() is NOT called here — it is called by
  // DocumentLifecycleSystem after executeStartBridge() completes.

  return ctx;
}

/** @deprecated Use createDocumentContext instead */
export const createKernelContext = createDocumentContext;
