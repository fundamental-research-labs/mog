/**
 * Spreadsheet App
 *
 * The default app that provides the classic Excel-like grid experience.
 * This app owns ALL its chrome including dialogs, overlays, and panels.
 *
 * Architecture:
 * - App owns chrome: Toolbar, FormulaBar, SheetTabs, StatusBar
 * - App owns layers: DialogLayer, OverlayLayer, PanelLayer
 * - App subscribes to DocumentManager for documents
 * - Shell provides reusable view component: GridCanvas
 * - Kernel provides data: cells, formulas, formatting
 *
 * Document Loading (DocumentManager Architecture):
 * - ProjectService reads bytes and calls DocumentManager.loadDocument()
 * - DocumentManager loads, caches, and owns document lifecycle
 * - App subscribes via useDocument hook (no loading logic in component)
 * - Documents survive React component remounts
 *
 * Design principle: "Invisible app" - users shouldn't feel like they're
 * using an app, they should just see their spreadsheet.
 *
 * Layer Architecture:
 * - DialogLayer: All 60+ modal dialogs (portaled, render at root level)
 * - OverlayLayer: Context menus, popovers, floating UI (render in grid container)
 * - PanelLayer: Side panels (render in grid container, overlay grid)
 *
 */

import { getEnvVar } from '@mog/env';
import type { DocumentHandle } from '@mog-sdk/kernel';
import { sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type { WorkbookInternal } from '@mog-sdk/contracts/api';
import type { RibbonVisibilityConfig } from '@mog-sdk/contracts/ribbon';
import { getRibbonVisibilityProfile, mergeRibbonVisibilityConfig } from '@mog-sdk/contracts/ribbon';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  TooltipProvider,
  useDocument,
  useDocumentManagerOptional,
  useShellStore,
  useShellStoreApi,
  getImportedPivotMetadata,
} from '@mog/shell';
import type { AppAppearanceMode, AppProps } from '@mog/shell/apps';
import type { FeatureGates } from '@mog-sdk/contracts/feature-gates';
import { useSheetTabActions } from './hooks';
import { useSpreadsheetDisplayMode } from './hooks/view/use-display-mode';
import type { SpreadsheetDisplayMode } from './ui-store/slices/core/display-mode';
import {
  DocumentContext,
  useActiveSheetId,
  useFeatureGate,
  useFeatureGates,
  useFeatureMode,
  FeatureGatesProvider,
  RibbonGatesBridge,
  useHideRibbon,
  useReadOnly,
  useSpreadsheetEmbedRuntimeOptional,
  useSpreadsheetEmbedSlot,
  useUIStore,
  useUIStoreApi,
  useWorkbook,
  type DocumentContextValue,
} from './infra/context';
import { useCoordinator } from './hooks/shared/use-coordinator';
import { createSpreadsheetEmbedAppBridge } from './infra/embed/create-spreadsheet-embed-app-bridge';
import {
  type ImportDurabilityGate,
  resolveInitialActiveSheetId,
  subscribeActiveSheetPersistence,
} from './infra/document-active-sheet';
import { createShellUIStore, type UIStoreApi } from './ui-store';
// Import SpreadsheetCoordinatorProvider and SpreadsheetGrid from local components
import { SpreadsheetCoordinatorProvider } from './app/CoordinatorProvider';
import { SpreadsheetIndicators } from './app/SpreadsheetIndicators';
import { StatusBar } from './chrome/status-bar/StatusBar';
import { SpreadsheetGrid } from './components/grid/SpreadsheetGrid';

// App-owned chrome components
import { FormulaBarContainer } from './chrome/formula-bar';
import { NLFormulaBarContainer } from './chrome/nl-formula-bar';
import { TabStrip } from './chrome/sheet-tabs';
import { ToolbarContainer } from './chrome/toolbar/primitives/ToolbarContainer';

// App-owned layer components (dialogs, overlays, panels)
import { DialogLayer, OverlayLayer, PanelLayer } from './chrome/layers';

// Read-only mode safety net for dispatcher
import { setDispatcherReadOnly } from './actions/dispatcher';
import { ensureMetricCompatibleFontsLoaded } from './infra/styles/fonts';
import { installChartImageExporter } from './infra/services';
import { installImportedPivotRuntime } from './pivot/imported-pivot-runtime';

type WorkbookFeatureGatesRef = { current: FeatureGates };
type DocumentRuntime = Pick<DocumentContextValue, 'workbook' | 'uiStore' | 'eventBus'> & {
  readonly featureGatesRef: WorkbookFeatureGatesRef;
};
type SpreadsheetAppAppearanceMode = AppAppearanceMode & SpreadsheetDisplayMode;

const RIBBON_VISIBILITY_PROFILE_ENV = 'MOG_RIBBON_VISIBILITY_PROFILE';
const VITE_RIBBON_VISIBILITY_PROFILE_ENV = 'VITE_MOG_RIBBON_VISIBILITY_PROFILE';
const RIBBON_VISIBILITY_CONFIG_JSON_ENV = 'MOG_RIBBON_VISIBILITY_CONFIG_JSON';
const VITE_RIBBON_VISIBILITY_CONFIG_JSON_ENV = 'VITE_MOG_RIBBON_VISIBILITY_CONFIG_JSON';

// DocumentManager owns handles across React remounts. Keep the workbook facade
// and UI store with that handle so transient app remounts do not reset dialogs,
// selection chrome, or other document-scoped UI state.
const documentRuntimeCache = new WeakMap<DocumentHandle, Promise<DocumentRuntime>>();

async function getOrCreateDocumentRuntime(
  handle: DocumentHandle,
  readOnly: boolean,
  featureGates: FeatureGates,
): Promise<DocumentRuntime> {
  const cached = documentRuntimeCache.get(handle);
  if (cached) {
    const runtime = await cached;
    runtime.featureGatesRef.current = effectiveWorkbookFeatureGates(readOnly, featureGates);
    return runtime;
  }

  const runtimePromise = (async () => {
    const uiStore: UIStoreApi = createShellUIStore(handle.initialSheetId, handle.undoService);
    const featureGatesRef: WorkbookFeatureGatesRef = {
      current: effectiveWorkbookFeatureGates(readOnly, featureGates),
    };

    installChartImageExporter(handle);

    performance.mark('spreadsheetApp:createWorkbook:start');
    const workbook = await handle.workbook({
      readOnly,
      stateProvider: {
        getActiveSheetId: () => uiStore.getState().activeSheetId,
        setActiveSheetId: (id: string) => uiStore.getState().setActiveSheet(toSheetId(id)),
        getActiveCell: () => null,
        getSelectedRanges: () => [],
        getActiveObjectId: () => null,
        getActiveObjectType: () => null,
      },
      readFeatureGates: () => featureGatesRef.current,
    });
    installImportedPivotRuntime(workbook as WorkbookInternal, getImportedPivotMetadata(handle));
    try {
      performance.mark('spreadsheetApp:createWorkbook:end');
      performance.measure(
        'spreadsheetApp:createWorkbook',
        'spreadsheetApp:createWorkbook:start',
        'spreadsheetApp:createWorkbook:end',
      );
    } catch {
      /* marks may be cleared by React strict-mode effect cleanup */
    }

    const restoredActiveSheetId = await resolveInitialActiveSheetId({
      workbook: workbook as WorkbookInternal,
      initialSheetId: handle.initialSheetId,
    });
    if (restoredActiveSheetId !== uiStore.getState().activeSheetId) {
      uiStore.getState().setActiveSheet(restoredActiveSheetId);
    }

    return {
      workbook: workbook as WorkbookInternal,
      uiStore,
      eventBus: handle.eventBus,
      featureGatesRef,
    };
  })();

  documentRuntimeCache.set(handle, runtimePromise);
  try {
    return await runtimePromise;
  } catch (error) {
    if (documentRuntimeCache.get(handle) === runtimePromise) {
      documentRuntimeCache.delete(handle);
    }
    throw error;
  }
}

/**
 * Duck-type check for `TrapError` (from `@mog/transport`). The class
 * exposes a `readonly isTrap = true as const` discriminator (per the
 * trap-recovery contract), so any object with that field is a
 * trap regardless of which package boundary it crossed.
 *
 * Used by the document error UI to swap the generic "Failed to load"
 * message for the trap-specific size-limit message. See
 *
 * Duck-typing rather than `instanceof TrapError` because (a) this
 * file would otherwise gain a `@mog/transport` dependency that's
 * cosmetic — only TrapError's discriminator is needed — and (b) the
 * `cause` chain may have crossed an `Error.from`-style serialization
 * boundary that strips the prototype but preserves the field.
 */
function isTrapErrorLike(value: unknown): boolean {
  return Boolean(
    value && typeof value === 'object' && (value as { isTrap?: unknown }).isTrap === true,
  );
}

function SpreadsheetEmbedRuntimeBridge(): null {
  const runtime = useSpreadsheetEmbedRuntimeOptional();
  const workbook = useWorkbook();
  const uiStore = useUIStoreApi();
  const documentId = runtime?.documentId;
  const coordinator = useCoordinator();

  useEffect(() => {
    if (!runtime?.registerAppBridge || !documentId) return;

    const bridge = createSpreadsheetEmbedAppBridge({
      documentId,
      workbook,
      uiStore,
      coordinator,
    });

    return runtime.registerAppBridge(bridge);
  }, [documentId, coordinator, runtime, uiStore, workbook]);

  return null;
}

function ActiveSheetPersistenceBridge({
  importDurability,
}: {
  importDurability?: ImportDurabilityGate;
}): null {
  const workbook = useWorkbook();
  const uiStore = useUIStoreApi();

  useEffect(() => {
    return subscribeActiveSheetPersistence({ workbook, uiStore, importDurability });
  }, [importDurability, workbook, uiStore]);

  return null;
}

/**
 * SpreadsheetApp - The default spreadsheet experience
 *
 * This component composes:
 * 1. Document Loading - useShellDocument bridges shell to document
 * 2. Toolbar (app-owned chrome) - Ribbon with Home, Insert, Data, etc.
 * 3. FormulaBar (app-owned chrome) - Cell address + formula editing
 * 4. GridCanvas (shell component) - The actual grid with full features
 * 5. StatusBar (app-owned chrome) - Selection stats, mode indicator, zoom
 * 6. SheetTabs (app-owned chrome) - Sheet navigation
 * 7. PanelLayer - Side panels (chart editor, pivot field, etc.)
 * 8. OverlayLayer - Context menus, popovers, floating UI
 * 9. DialogLayer - All 60+ modal dialogs
 *
 * Document Loading Flow (DocumentManager Architecture):
 * 1. ProjectService reads file bytes and calls DocumentManager.loadDocument()
 * 2. DocumentManager loads/caches the document (survives React remounts)
 * 3. useDocument hook subscribes to DocumentManager (no loading logic)
 * 4. App creates DocumentContext from the handle
 * 5. Children render inside DocumentContext.Provider
 */
export default function SpreadsheetApp({
  kernel: _kernel,
  manifest: _manifest,
  readOnly: readOnlyProp,
  hideRibbon: hideRibbonProp,
  featureGates: featureGatesProp,
  appearanceMode,
  onAppearanceModeChange,
}: AppProps) {
  // Feature gates: merge prop-level gates with legacy readOnly/hideRibbon props and env vars
  // Memoize to stabilize the reference — `?? {}` creates a new object every render,
  // which would cause the document-init useEffect to re-fire infinitely.
  const featureGates: FeatureGates = useMemo(
    () => resolveFeatureGatesWithRibbonVisibilityProfile(featureGatesProp),
    [featureGatesProp],
  );

  // Read-only mode: featureGates.editing takes precedence, then legacy prop, then env var, then default false
  const readOnly =
    !(featureGates.editing ?? true) ||
    readOnlyProp === true ||
    getEnvVar('MOG_READ_ONLY') === 'true';
  // Hide ribbon: featureGates.ribbon takes precedence, then legacy prop, then env var, then default false
  const hideRibbon =
    !(featureGates.ribbon ?? true) ||
    hideRibbonProp === true ||
    getEnvVar('MOG_HIDE_RIBBON') === 'true';

  // Wire the dispatcher safety net so mutating actions are blocked even if UI gates are bypassed
  setDispatcherReadOnly(readOnly);

  // In the embed path each attachment provides its own documentId via context.
  // Fall back to the shell store for the standalone (desktop/full-app) path.
  const embedRuntime = useSpreadsheetEmbedRuntimeOptional();
  const shellActiveFileId = useShellStore((s) => s.activeFileId);
  const activeFileId = embedRuntime?.documentId ?? shellActiveFileId;

  // Get document from DocumentManager (simple subscription, no loading logic)
  // DocumentManager owns the document lifecycle - safe across React remounts
  const { handle, isLoading, error } = useDocument(activeFileId);

  // Create DocumentContextValue from handle (async because Sheets.getFirstId is CB-backed)
  const [contextValue, setContextValue] = useState<DocumentContextValue | null>(null);
  const contextHandleRef = useRef<DocumentHandle | null>(null);
  const contextValueRef = useRef<DocumentContextValue | null>(contextValue);
  const kernelFeatureGatesRef = useRef<WorkbookFeatureGatesRef | null>(null);
  contextValueRef.current = contextValue;

  // Ref for latest config values — used by init effect to read current values
  // without adding them as deps (which would cause unmount/remount cycle).
  const configRef = useRef({ readOnly, hideRibbon, featureGates });
  configRef.current = { readOnly, hideRibbon, featureGates };

  // Effect 1: Document init — only re-runs when handle changes.
  // This is the ONLY effect that unmounts SpreadsheetContent (via setContextValue(null)).
  // Config changes (readOnly, hideRibbon, featureGates) are handled by Effect 2 below.
  useEffect(() => {
    if (!handle) {
      contextHandleRef.current = null;
      kernelFeatureGatesRef.current = null;
      setContextValue((prev) => (prev === null ? prev : null));
      return;
    }

    if (contextHandleRef.current === handle && contextValueRef.current) {
      return;
    }

    // Clear stale context immediately so SpreadsheetContent unmounts.
    // This forces the SheetCoordinator (and its RenderSystem, viewport pipeline,
    // canvas) to dispose and recreate for the new document. Without this,
    // switching between cached documents leaves the old coordinator's viewport
    // buffer intact — the canvas shows stale data while the formula bar
    // (which reads from React context) already shows the new document.
    setContextValue((prev) => (prev === null ? prev : null));

    let cancelled = false;

    async function init() {
      performance.mark('spreadsheetApp:init:start');
      performance.mark('spreadsheetApp:metricFonts:start');
      const metricFontsReady = ensureMetricCompatibleFontsLoaded();
      const runtime = await getOrCreateDocumentRuntime(
        handle!,
        configRef.current.readOnly,
        configRef.current.featureGates,
      );
      if (cancelled) return;
      kernelFeatureGatesRef.current = runtime.featureGatesRef;
      runtime.featureGatesRef.current = effectiveWorkbookFeatureGates(
        configRef.current.readOnly,
        configRef.current.featureGates,
      );

      await metricFontsReady;
      performance.mark('spreadsheetApp:metricFonts:end');
      if (cancelled) return;

      // Expose the document UI store so the host can subscribe to
      // document-level state (e.g. NL formula requests) without
      // needing to render inside the DocumentContext tree.
      (window as any).__MOG_UI_STORE__ = runtime.uiStore;

      performance.mark('spreadsheetApp:init:end');
      try {
        performance.measure(
          'spreadsheetApp:metricFonts',
          'spreadsheetApp:metricFonts:start',
          'spreadsheetApp:metricFonts:end',
        );
        performance.measure(
          'spreadsheetApp:init',
          'spreadsheetApp:init:start',
          'spreadsheetApp:init:end',
        );
      } catch {
        /* marks may be cleared by React strict-mode effect cleanup */
      }
      const appMeasures = performance
        .getEntriesByType('measure')
        .filter((e) => e.name.startsWith('spreadsheetApp:'));
      console.group('[PERF] SpreadsheetApp init breakdown');
      for (const m of appMeasures) {
        console.log(` ${m.name}: ${m.duration.toFixed(1)}ms`);
      }
      console.groupEnd();
      for (const m of appMeasures) performance.clearMeasures(m.name);

      setContextValue({
        workbook: runtime.workbook,
        uiStore: runtime.uiStore,
        eventBus: runtime.eventBus,
        importDurability: handle!,
        ...configRef.current,
      });
      contextHandleRef.current = handle!;

      // Trigger deferred Yrs hydration after React commits the first paint.
      // This must happen AFTER setContextValue so the grid renders first.
      requestAnimationFrame(() => {
        void handle!.scheduleDeferredHydration().catch((err) => {
          console.warn('[SpreadsheetApp] Deferred hydration durability failed:', err);
        });
      });
    }

    init();

    return () => {
      cancelled = true;
      // Clean up Performance marks so a re-run (e.g. React strict mode)
      // doesn't find stale marks or fail measuring already-cleared ones.
      performance
        .getEntriesByType('mark')
        .filter((e) => e.name.startsWith('spreadsheetApp:'))
        .forEach((m) => performance.clearMarks(m.name));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle]);

  // Effect 2: Config update — updates readOnly/hideRibbon/featureGates in-place
  // WITHOUT unmounting SpreadsheetContent. This prevents the resize oscillation
  // that occurred when config changes triggered full unmount/remount cycles.
  useEffect(() => {
    if (kernelFeatureGatesRef.current) {
      kernelFeatureGatesRef.current.current = effectiveWorkbookFeatureGates(readOnly, featureGates);
    }
    setContextValue((prev) => {
      if (!prev) return prev;
      if (
        prev.readOnly === readOnly &&
        prev.hideRibbon === hideRibbon &&
        prev.featureGates === featureGates
      ) {
        return prev;
      }
      return { ...prev, readOnly, hideRibbon, featureGates };
    });
  }, [readOnly, hideRibbon, featureGates]);

  // Loading state
  if (isLoading) {
    return <LoadingSpinner />;
  }

  // Error state
  if (error) {
    // TrapError-specific branch: a wasm32 trap during compute operations.
    // The trap-recovery coordinator marks this doc as failed (the file's
    // bytes broke the WASM engine — replaying them would just re-trap).
    // Sibling docs in the same tab keep working; only this slot shows
    // §4.3.
    //
    // Detection: TrapError's `isTrap = true as const` discriminator. We
    // check the error itself AND its `cause` chain, because the lifecycle
    // machine wraps the TrapError in a KernelError (from `KernelError.from`
    // in `storeTrap`), and the DocumentManager receives whichever shape
    // the recovery coordinator surfaced via `setError(fileId, trap)`.
    const isTrap = isTrapErrorLike(error) || isTrapErrorLike((error as { cause?: unknown }).cause);
    const heading = isTrap ? 'Couldn’t open this file' : 'Failed to load document';
    const body = isTrap
      ? 'The file exceeds the in-browser size limit. Try the desktop app, or pick a smaller file.'
      : error.message;
    return (
      <div className="flex items-center justify-center w-full h-full bg-ss-surface-secondary">
        <div className="flex flex-col items-center gap-4 p-8 bg-ss-surface rounded-ss-lg shadow-ss-md max-w-[400px] text-center">
          <div className="w-12 h-12 rounded-full bg-ss-error text-ss-text-inverse flex items-center justify-center text-subtitle font-bold">
            !
          </div>
          <h2 className="m-0 text-section font-semibold text-ss-text font-sans">{heading}</h2>
          <p className="m-0 text-body-sm text-ss-text-secondary font-sans">{body}</p>
        </div>
      </div>
    );
  }

  // No document yet (no file selected or waiting for user to open a file)
  if (!handle) {
    return <WelcomeScreen />;
  }

  if (!contextValue) {
    return <LoadingSpinner />;
  }

  // Ready - render spreadsheet with DocumentContext.
  // Key on documentId so React fully unmounts/remounts the tree on document switch.
  // The SheetCoordinator (and its RenderSystem, viewport pipeline) is a session
  // companion — it must be born and die with its Workbook.
  return (
    <DocumentContext.Provider value={contextValue}>
      <FeatureGatesProvider gates={featureGates}>
        {/* visible-tabs ownership: push gates.tabs into the ribbon slice
 so setActiveRibbonTab can validate at write time. The
 bridge is a child of both contexts, which is the only
 place both `featureGates` and `uiStore` are in scope.
 See infra/context/feature-gates-context.tsx for why
 this is a sibling component (test isolation). */}
        <RibbonGatesBridge gates={featureGates} uiStore={contextValue.uiStore} />
        <SpreadsheetAppearanceBridge
          appearanceMode={appearanceMode as SpreadsheetAppAppearanceMode | undefined}
          onAppearanceModeChange={onAppearanceModeChange}
        />
        <ActiveSheetPersistenceBridge importDurability={handle} />
        <SpreadsheetContent key={handle.documentId} />
      </FeatureGatesProvider>
    </DocumentContext.Provider>
  );
}

function effectiveWorkbookFeatureGates(
  readOnly: boolean,
  featureGates: FeatureGates,
): FeatureGates {
  return readOnly ? { ...featureGates, editing: false } : featureGates;
}

function resolveFeatureGatesWithRibbonVisibilityProfile(
  featureGates: FeatureGates | undefined,
): FeatureGates {
  const profileName =
    getEnvVar(VITE_RIBBON_VISIBILITY_PROFILE_ENV) ?? getEnvVar(RIBBON_VISIBILITY_PROFILE_ENV);
  const profile = getRibbonVisibilityProfile(profileName);
  const envConfig = parseRibbonVisibilityConfigEnv(
    getEnvVar(VITE_RIBBON_VISIBILITY_CONFIG_JSON_ENV) ??
      getEnvVar(RIBBON_VISIBILITY_CONFIG_JSON_ENV),
  );
  const ribbonVisibility = mergeRibbonVisibilityConfig(
    mergeRibbonVisibilityConfig(profile, envConfig),
    featureGates?.ribbonVisibility,
  );
  return {
    ...(featureGates ?? {}),
    ribbonVisibility,
  };
}

function parseRibbonVisibilityConfigEnv(
  value: string | undefined | null,
): RibbonVisibilityConfig | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      console.warn(
        `[SpreadsheetApp] ${VITE_RIBBON_VISIBILITY_CONFIG_JSON_ENV} must be a JSON object`,
      );
      return undefined;
    }
    return parsed as RibbonVisibilityConfig;
  } catch (err) {
    console.warn(`[SpreadsheetApp] Failed to parse ${VITE_RIBBON_VISIBILITY_CONFIG_JSON_ENV}`, err);
    return undefined;
  }
}

function SpreadsheetAppearanceBridge({
  appearanceMode,
  onAppearanceModeChange,
}: {
  appearanceMode?: SpreadsheetDisplayMode;
  onAppearanceModeChange?: (mode: AppAppearanceMode) => void;
}): null {
  const mode = useUIStore((s) => s.spreadsheetDisplayMode);
  const setMode = useUIStore((s) => s.setSpreadsheetDisplayMode);
  const lastAppearanceModeRef = useRef<SpreadsheetDisplayMode | undefined>(undefined);
  const suppressNextNotifyRef = useRef(false);

  useEffect(() => {
    if (appearanceMode === lastAppearanceModeRef.current) return;
    lastAppearanceModeRef.current = appearanceMode;
    if (!appearanceMode || appearanceMode === mode) return;
    suppressNextNotifyRef.current = true;
    setMode(appearanceMode);
  }, [appearanceMode, mode, setMode]);

  useEffect(() => {
    if (suppressNextNotifyRef.current) {
      suppressNextNotifyRef.current = false;
      return;
    }
    if (appearanceMode === mode) return;
    onAppearanceModeChange?.(mode);
  }, [appearanceMode, mode, onAppearanceModeChange]);

  return null;
}

// =============================================================================
// Loading Spinner Component
// =============================================================================

function LoadingSpinner(): React.JSX.Element {
  return (
    <div className="flex items-center justify-center w-full h-full bg-ss-surface-secondary">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-[3px] border-ss-border-light border-t-ss-primary rounded-full animate-spin" />
        <p className="text-ss-text-secondary text-body-sm font-sans">Loading spreadsheet...</p>
      </div>
    </div>
  );
}

// =============================================================================
// Welcome Screen Component (no document loaded)
// =============================================================================

function WelcomeScreen(): React.JSX.Element {
  const documentManager = useDocumentManagerOptional();
  const storeApi = useShellStoreApi();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // §6.2 boot-precedence "doc missing/evicted" branch surfaces a one-shot
  // `?missing-doc=<id>` flag (see `dev/app/src/App.tsx`). Read it once on
  // mount, then strip it from the URL so a refresh doesn't re-toast. We
  // intentionally avoid a global zustand slice for this — the flag is
  // boot-only and local to the welcome view.
  const [missingDocId, setMissingDocId] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const id = params.get('missing-doc');
    if (!id) return;
    setMissingDocId(id);
    params.delete('missing-doc');
    const remaining = params.toString();
    window.history.replaceState({}, '', remaining ? `?${remaining}` : window.location.pathname);
  }, []);

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !documentManager) return;

      setLoading(true);
      setError(null);
      try {
        const buffer = await file.arrayBuffer();
        const data = new Uint8Array(buffer);
        const fileId = 'web-upload-' + Date.now();

        // Route by extension. The <input> accept list advertises
        // .xlsx/.csv (.xls/BIFF is not supported by the XLSX parser);
        // without the dispatch every CSV would be fed to the XLSX
        // parser and fail with "not a valid ZIP archive". File names
        // like `data.txt-as-csv` (no recognised extension) fall back
        // to XLSX — that's the right behaviour for ambiguous bytes
        // since the XLSX parser fails loudly with a clear error, while
        // the CSV path is more permissive and could silently accept
        // binary garbage.
        const lower = file.name.toLowerCase();
        const kind: 'csv' | 'xlsx' = lower.endsWith('.csv') ? 'csv' : 'xlsx';
        // Forward the filename stem as the CSV sheet name so a
        // `leading-zeros.csv` import lands in a sheet called
        // "leading-zeros" rather than "Sheet1".
        const stem = file.name.replace(/\.[^.]+$/, '');
        await documentManager.loadDocument(
          fileId,
          { type: 'bytes', data },
          {
            kind,
            csvOptions: kind === 'csv' ? { sheetName: stem } : undefined,
          },
        );
        storeApi.getState().addOpenFileId(fileId);
        storeApi.getState().setActiveFileId(fileId);
      } catch (err: any) {
        setError(err.message ?? String(err));
        console.error('[WelcomeScreen] Failed to load file:', err);
      } finally {
        setLoading(false);
        // Reset input so the same file can be re-selected
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    },
    [documentManager, storeApi],
  );

  return (
    <div className="flex items-center justify-center w-full h-full bg-ss-surface-secondary">
      <div className="flex flex-col items-center gap-3 p-8 bg-ss-surface rounded-ss-lg shadow-ss-md max-w-[400px] text-center">
        {missingDocId && (
          <div
            role="status"
            data-testid="welcome-missing-doc-toast"
            className="w-full rounded-ss bg-amber-50 border border-amber-200 px-3 py-2 text-left"
          >
            <p className="m-0 text-body-sm text-amber-900 font-sans">
              The document you tried to open is no longer available.
            </p>
            <p className="m-0 mt-1 text-[12px] text-amber-700 font-sans break-all">
              Missing id: <code>{missingDocId}</code>
            </p>
          </div>
        )}
        <h2 className="m-0 text-section font-semibold text-ss-text font-sans">
          No spreadsheet open
        </h2>
        <p className="m-0 text-body-sm text-ss-text-secondary font-sans">
          Open a file from the sidebar or create a new spreadsheet.
        </p>
        {documentManager && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.csv"
              className="hidden"
              onChange={handleFileSelect}
            />
            <button
              className="mt-2 px-4 py-2 bg-ss-primary text-white rounded-ss font-sans text-body-sm font-medium cursor-pointer hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
            >
              {loading ? 'Loading...' : 'Open Spreadsheet'}
            </button>
          </>
        )}
        {error && <p className="m-0 text-body-sm text-red-500 font-sans">{error}</p>}
      </div>
    </div>
  );
}

// =============================================================================
// Spreadsheet Content (renders when document is ready)
// =============================================================================

/**
 * Inner component that renders when DocumentContext is available.
 * Separated to allow hooks that depend on DocumentContext.
 */
function SpreadsheetContent(): React.JSX.Element {
  const readOnly = useReadOnly();
  const hideRibbon = useHideRibbon();
  const activeSheetId = useActiveSheetId();
  const showRibbon = useFeatureMode('ribbon');
  const formulaBarGated = useFeatureGate('capabilities', 'formulaBar');
  const showSheetTabs = useFeatureGate('capabilities', 'sheetTabs');
  // Chrome-symmetry: feature gate AND user-toggle must agree before we
  // mount these chrome panels. Hidden state is observable as the panel
  // root (data-testid="panel-<id>") being detached from the DOM.
  const formulaBarUserVisible = useUIStore((s) => s.formulaBarVisible);
  const nlBarVisible = useUIStore((s) => s.nlBarVisible);
  const statusBarUserVisible = useUIStore((s) => s.statusBarVisible);
  const aboveGridSlot = useSpreadsheetEmbedSlot('above-grid');
  const showFormulaBar = formulaBarGated && formulaBarUserVisible;
  const showStatusBar = statusBarUserVisible;
  const { mode: displayMode, effectiveScheme } = useSpreadsheetDisplayMode();

  const workbook = useWorkbook();
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = useCallback(async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const bytes = await workbook.toXlsx();
      const blob = new Blob([bytes as BlobPart], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'Untitled.xlsx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setIsExporting(false);
    }
  }, [workbook, isExporting]);

  // Sheet tab actions hook - handles all sheet operations
  const {
    sheets,
    hiddenSheets,
    handleSelectSheet,
    handleAddSheet,
    handleRenameSheet,
    handleDeleteSheet,
    handleReorderSheets,
    handleCopySheet,
    handleSetTabColor,
    handleHideSheet,
    handleUnhideSheet,
  } = useSheetTabActions();

  return (
    <TooltipProvider>
      <SpreadsheetCoordinatorProvider>
        <SpreadsheetEmbedRuntimeBridge />
        <div
          className="mog-spreadsheet-app-theme-scope flex flex-col flex-1 min-h-0 w-full h-full overflow-hidden"
          data-mog-color-scheme={effectiveScheme}
          data-mog-ui-color-scheme={displayMode}
          data-mog-ui-resolved-color-scheme={effectiveScheme}
          data-mog-canvas-color-scheme={effectiveScheme}
        >
          {/* Toolbar - app-owned chrome. Hidden when:
 - feature gate `ribbon` is off
 - readOnly+hideRibbon legacy
 The `data-testid="panel-ribbon"` lives on TabbedToolbar's
 ribbon-content wrapper (the actual ribbon panel chrome), not
 on this layout container — same convention as every other
 panel-<id> testid (panel-comments, panel-find, etc.). The
 ribbon collapsed state is handled inside TabbedToolbar so the
 tab bar and `ribbon-reopen` chevron remain mounted. */}
          {showRibbon && !readOnly && !hideRibbon && (
            <div className="shrink-0 border-b border-ss-border">
              <ToolbarContainer onExport={handleExport} isExporting={isExporting} />
            </div>
          )}

          {/* Formula Bar — app-owned chrome (gated by capabilities.formulaBar
 and the user's panel-toggle). When the user closes the bar via
 its close button or the View ribbon panel controls, the panel detaches
 from the DOM. The panel root carries
 `data-testid="panel-formula-bar"` for the chrome-symmetry
 contract. */}
          {showFormulaBar && (
            <div data-testid="panel-formula-bar" className="shrink-0 border-b border-ss-border">
              <FormulaBarContainer />
            </div>
          )}

          {/* NL Formula Bar — natural-language formula input, gated by
 formula bar visibility and the NL bar toggle (nlBarVisible). */}
          {showFormulaBar && nlBarVisible && (
            <div data-testid="panel-nl-formula-bar" className="shrink-0 border-b border-ss-border">
              <NLFormulaBarContainer />
            </div>
          )}

          {aboveGridSlot ? (
            <div
              data-mog-spreadsheet-slot="above-grid"
              className="mog-spreadsheet-app-slot mog-spreadsheet-app-slot-above-grid shrink-0"
            >
              {aboveGridSlot}
            </div>
          ) : null}

          {/* Main Grid - uses SpreadsheetGrid which shares coordinator via useCoordinator() */}
          {/* Note: h-full is required because SpreadsheetGrid uses height: 100% internally */}
          <div className="flex-1 min-h-0 h-full overflow-hidden relative">
            <SpreadsheetGrid className="h-full w-full" />

            {/* Status indicators (calculation progress, export notifications) */}
            <SpreadsheetIndicators exportState={{ progress: 0 }} exportNotification={null} />

            {/* Panels render inside grid container (they overlay the grid) */}
            <PanelLayer />

            {/* Overlays render inside grid container (context menus, popovers) */}
            <OverlayLayer />
          </div>

          {/* Status Bar — app-owned chrome. When the user closes the bar via
 its close button or the View ribbon "Show status bar" toggle,
 the panel detaches from the DOM. The panel root carries
 `data-testid="panel-status-bar"` for the chrome-symmetry
 contract. */}
          {/* Sheet Tabs - app-owned chrome (gated by capabilities.sheetTabs) */}
          {showSheetTabs && (
            <div className="shrink-0">
              <TabStrip
                sheets={sheets}
                activeSheetId={activeSheetId}
                onSelectSheet={handleSelectSheet}
                onAddSheet={handleAddSheet}
                onRenameSheet={handleRenameSheet}
                onDeleteSheet={handleDeleteSheet}
                onReorderSheets={handleReorderSheets}
                onCopySheet={handleCopySheet}
                onSetTabColor={handleSetTabColor}
                onHideSheet={handleHideSheet}
                onUnhideSheet={handleUnhideSheet}
                hiddenSheets={hiddenSheets}
                readOnly={readOnly}
              />
            </div>
          )}

          {showStatusBar && (
            <div data-testid="panel-status-bar" className="shrink-0 border-t border-ss-border">
              <StatusBar />
            </div>
          )}
        </div>

        {/* Dialogs render at root level (they portal anyway) */}
        <DialogLayer />
      </SpreadsheetCoordinatorProvider>
    </TooltipProvider>
  );
}

// =============================================================================
// Re-exports for package consumers
// =============================================================================
// External package consumers import the app's public surface from '@mog/spreadsheet'.
// Internal modules must import from './internal-api' instead — see P1 of
export * from './exports';
