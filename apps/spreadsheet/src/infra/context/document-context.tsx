/**
 * DocumentProvider - Document Loading Lifecycle Manager
 *
 * Provides React context for Workbook API and UI store.
 * Handles the async loading lifecycle so children only render when ready.
 *
 * Usage:
 * ```tsx
 * function App() {
 * return (
 * <DocumentProvider docId="my-doc">
 * <Spreadsheet />
 * </DocumentProvider>
 * );
 * }
 *
 * // In child components:
 * const wb = useWorkbook();
 * const ws = wb.activeSheet;
 * await ws.setCell('A1', 42);
 * const { activeSheetId } = useUIStore((s) => ({ activeSheetId: s.activeSheetId }));
 * ```
 */

import React, { createContext, useContext, useEffect, useState } from 'react';
import { useStore, type StoreApi } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

import { DocumentFactory, type DocumentHandle } from '@mog-sdk/kernel';
import type { WorkbookInternal, WorksheetWithInternals } from '@mog-sdk/contracts/api';
import type { IEventBus } from '@mog-sdk/contracts/events';
import type { FeatureGates } from '@mog-sdk/contracts/feature-gates';
import { PivotExpansionManager } from '../../pivot/pivot-expansion-manager';
import {
  resolveInitialActiveSheetId,
  subscribeActiveSheetPersistence,
} from '../document-active-sheet';
import { ChartImageExporterImpl } from '../services/chart-image-exporter';

// UIState type and createUIStore factory are injected to avoid infra/ → ui-store/ DAG violation.
// The factory is passed as a prop to DocumentProvider; the type is kept generic here.
// Consumers re-export typed hooks from infra/context/index.ts.

// =============================================================================
// Context Types
// =============================================================================

/**
 * Value provided by DocumentContext.
 * Contains the Workbook API and UI store for a spreadsheet instance.
 *
 * @see Spreadsheet component which creates this context
 */
export interface DocumentContextValue {
  /** The unified Workbook API — THE single interface for all data/compute operations */
  workbook: WorkbookInternal;
  /** The Zustand UI store for selection, viewport, edit mode */
  uiStore: StoreApi<any>;
  /** Per-document event bus for cross-component communication */
  eventBus: IEventBus;
  /** When true, all human UI editing is blocked. Agent mutations via OSExecutionContext are unaffected. */
  readOnly: boolean;
  /** When true, the ribbon/toolbar is hidden. Independent of readOnly. */
  hideRibbon: boolean;
  /** Unified feature visibility config. */
  featureGates: FeatureGates;
}

// =============================================================================
// Context
// =============================================================================

/**
 * React context for document state.
 * Created by Spreadsheet component, consumed by internal hooks.
 *
 * @internal - Use useWorkbook() for data/compute access
 */
export const DocumentContext = createContext<DocumentContextValue | null>(null);

// =============================================================================
// Hooks
// =============================================================================

/**
 * Get the full document context. Throws if used outside DocumentProvider.
 */
export function useDocumentContext(): DocumentContextValue {
  const ctx = useContext(DocumentContext);
  if (!ctx) {
    throw new Error('useDocumentContext must be used within DocumentProvider');
  }
  return ctx;
}

/**
 * Get a value from the UI store with a selector.
 * The generic S parameter defaults to `any` but callers can narrow it
 * by importing UIState from ui-store at the call site.
 */

export function useUIStore<T>(selector: (state: any) => T): T {
  const { uiStore } = useDocumentContext();
  return useStore(uiStore, selector);
}

/**
 * Get the raw UI store API for direct access.
 */

export function useUIStoreApi(): StoreApi<any> {
  return useDocumentContext().uiStore;
}

/**
 * Get the unified Workbook API instance.
 * This is THE primary hook for all data and compute operations.
 *
 * Throws if used outside DocumentProvider.
 *
 * @example
 * ```tsx
 * const wb = useWorkbook();
 * const ws = wb.activeSheet;
 * await ws.setCell('A1', 42);
 * ```
 */
export function useWorkbook(): WorkbookInternal {
  const ctx = useContext(DocumentContext);
  if (!ctx?.workbook) {
    throw new Error('useWorkbook must be used within DocumentProvider');
  }
  return ctx.workbook;
}

/**
 * Returns true when the document is in read-only mode.
 * Read-only mode blocks all human UI editing while allowing agent mutations
 * via OSExecutionContext / direct kernel calls.
 */
export function useReadOnly(): boolean {
  const ctx = useContext(DocumentContext);
  return ctx?.readOnly ?? false;
}

/**
 * Returns true when the ribbon/toolbar should be hidden.
 * This is independent of read-only mode.
 */
export function useHideRibbon(): boolean {
  const ctx = useContext(DocumentContext);
  return ctx?.hideRibbon ?? false;
}

/**
 * Get the per-document event bus instance.
 * Throws if used outside DocumentProvider.
 */
export function useEventBus(): IEventBus {
  const ctx = useContext(DocumentContext);
  if (!ctx?.eventBus) {
    throw new Error('useEventBus must be used within DocumentProvider');
  }
  return ctx.eventBus;
}

/**
 * Convenience hook: get the Worksheet for the currently active sheet.
 * Re-renders when activeSheetId changes (via UIStore subscription).
 *
 * For a specific non-active sheet, call `wb.getSheetById(id)` directly.
 *
 * @example
 * ```tsx
 * const ws = useWorksheet();
 * await ws.setCell(0, 0, 'Hello');
 * ```
 */
export function useWorksheet(): WorksheetWithInternals {
  const wb = useWorkbook();
  const sheetId = useActiveSheetId();
  return wb.getSheetById(sheetId) as WorksheetWithInternals;
}

// Convenience hooks for common selections
export const useActiveSheetId = () => useUIStore((s) => s.activeSheetId);
// NOTE: useSelection removed - use useSelection() from state/hooks/use-selection.ts
// The selection machine is the single source of truth, accessed via coordinator.
// NOTE: useViewport removed - viewport state now lives in coordinator/renderer-execution.ts
// Use coordinator.getRendererExecution().getScrollPosition() for scroll state
// NOTE: useEditing/useIsEditing removed - use useEditor() from state/hooks instead
// NOTE: useClipboard removed - use useClipboard() from state/hooks/use-clipboard.ts
// NOTE: Chart hooks removed - use useChartUI() from state/hooks/use-chart.ts
// Chart UI state is managed by chart-machine.ts (XState)
export const useCFDialog = () =>
  useUIStore(
    useShallow((s) => ({
      isOpen: s.cfDialog.isOpen,
      mode: s.cfDialog.mode,
      editingFormat: s.cfDialog.editingFormat,
      selectedRuleType: s.cfDialog.selectedRuleType,
    })),
  );
export const useIsCFDialogOpen = () => useUIStore((s) => s.cfDialog.isOpen);
export const useQuickRuleDialog = () => useUIStore((s) => s.cfDialog.quickRuleDialog);
export const useIsRulesManagerOpen = () => useUIStore((s) => s.cfDialog.rulesManagerOpen);
export const useDVDialog = () =>
  useUIStore(
    useShallow((s) => ({
      isOpen: s.dvDialog.isOpen,
      mode: s.dvDialog.mode,
      editingSchemaId: s.dvDialog.editingSchemaId,
      selectedValidationType: s.dvDialog.selectedValidationType,
    })),
  );
export const useIsDVDialogOpen = () => useUIStore((s) => s.dvDialog.isOpen);
export const useIsPivotDialogOpen = () => useUIStore((s) => s.pivot.isDialogOpen);
export const useSelectedPivotId = () => useUIStore((s) => s.pivot.selectedPivotId);
export const useEditingPivotId = () => useUIStore((s) => s.pivot.editingPivotId);
export const useIsFormatPainterActive = () => useUIStore((s) => s.formatPainter.isActive);
export const useIsInsertFunctionDialogOpen = () => useUIStore((s) => s.insertFunctionDialogOpen);
export const useZoomLevels = () => useUIStore((s) => s.zoomLevels);

// =============================================================================
// Provider Props
// =============================================================================

/**
 * Factory function type for creating the UI store.
 * Injected to avoid infra/ -> ui-store/ DAG violation.
 */

export type UIStoreFactory = (initialSheetId: string, undoService?: any) => StoreApi<any>;

interface DocumentProviderProps {
  /** Unique document identifier */
  docId: string;
  /** Factory to create the UI store (injected to avoid infra -> ui-store dependency) */
  createUIStore: UIStoreFactory;
  /** Children to render when document is ready */
  children: React.ReactNode;
  /** Loading fallback (default: simple spinner) */
  loadingFallback?: React.ReactNode;
  /** Error fallback */
  errorFallback?: (error: Error, retry: () => void) => React.ReactNode;
  /** When true, all human UI editing is blocked */
  readOnly?: boolean;
  /** When true, the ribbon/toolbar is hidden */
  hideRibbon?: boolean;
  /** Feature gate configuration */
  featureGates?: FeatureGates;
}

// =============================================================================
// Provider State
// =============================================================================

type ProviderState =
  | { status: 'loading' }
  | { status: 'ready'; value: DocumentContextValue }
  | { status: 'error'; error: Error };

// =============================================================================
// Default Fallbacks
// =============================================================================

function DefaultLoadingFallback(): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center w-screen h-screen bg-ss-surface-secondary gap-4">
      <div className="w-10 h-10 border-[3px] border-ss-border-light border-t-ss-primary rounded-full animate-spin" />
      <p className="text-ss-text-secondary text-body-sm font-sans">Loading spreadsheet...</p>
    </div>
  );
}

function DefaultErrorFallback({
  error,
  onRetry,
}: {
  error: Error;
  onRetry: () => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center w-screen h-screen bg-ss-surface-secondary gap-4">
      <div className="w-12 h-12 rounded-full bg-ss-error text-ss-text-inverse flex items-center justify-center text-subtitle font-bold">
        !
      </div>
      <h2 className="m-0 text-section font-semibold text-ss-text font-sans">
        Failed to load document
      </h2>
      <p className="m-0 text-body-sm text-ss-text-secondary font-sans">{error.message}</p>
      <button
        className="px-6 py-2 bg-ss-primary text-ss-text-inverse border-none rounded font-sans text-body-sm font-medium cursor-pointer hover:bg-ss-primary-hover"
        onClick={onRetry}
      >
        Try Again
      </button>
    </div>
  );
}

// =============================================================================
// DocumentProvider Component
// =============================================================================

export function DocumentProvider({
  docId,
  createUIStore,
  children,
  loadingFallback,
  errorFallback,
  readOnly = false,
  hideRibbon = false,
  featureGates = {},
}: DocumentProviderProps): React.JSX.Element {
  const [state, setState] = useState<ProviderState>({ status: 'loading' });
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let handle: DocumentHandle | null = null;
    let pivotExpansion: PivotExpansionManager | null = null;
    let unsubscribeActiveSheetPersistence: (() => void) | null = null;

    async function initialize() {
      try {
        setState({ status: 'loading' });

        // Create document via factory — handles all kernel bootstrap internally
        handle = await DocumentFactory.create({ documentId: docId });

        if (cancelled) {
          handle.dispose();
          return;
        }

        // Inject PivotExpansionManager — app owns expansion state, kernel reads/delegates through it
        pivotExpansion = new PivotExpansionManager(handle.eventBus);
        handle.registerPivotExpansionProvider(pivotExpansion);

        // Inject ChartImageExporter — requires DOM canvas, so lives in the shell
        handle.registerChartImageExporter((charts) => new ChartImageExporterImpl(charts));

        // Create UIStore with valid initial sheet ID
        const uiStore = createUIStore(handle.initialSheetId, handle.undoService);

        // Create unified Workbook instance — THE single API for all data/compute operations.
        // Created after UIStore so getActiveSheetId/setActiveSheetId can wire through.
        const workbook = (await handle.workbook({
          stateProvider: {
            getActiveSheetId: () => uiStore.getState().activeSheetId,
            setActiveSheetId: (id: string) => uiStore.getState().setActiveSheet(id),
            getActiveCell: () => null,
            getSelectedRanges: () => [],
            getActiveObjectId: () => null,
            getActiveObjectType: () => null,
          },
        })) as WorkbookInternal;

        if (cancelled) {
          handle.dispose();
          return;
        }

        const restoredActiveSheetId = await resolveInitialActiveSheetId({
          workbook,
          initialSheetId: handle.initialSheetId,
        });
        if (cancelled) {
          handle.dispose();
          return;
        }
        if (restoredActiveSheetId !== uiStore.getState().activeSheetId) {
          uiStore.getState().setActiveSheet(restoredActiveSheetId);
        }
        unsubscribeActiveSheetPersistence = subscribeActiveSheetPersistence({ workbook, uiStore });

        setState({
          status: 'ready',
          value: {
            workbook,
            uiStore,
            eventBus: handle.eventBus,
            readOnly: false,
            hideRibbon: false,
            featureGates: {},
          },
        });
      } catch (err) {
        if (cancelled) return;
        setState({
          status: 'error',
          error: err instanceof Error ? err : new Error(String(err)),
        });
      }
    }

    initialize();

    // Cleanup on unmount or docId change
    return () => {
      cancelled = true;
      unsubscribeActiveSheetPersistence?.();
      // Destroy app-owned expansion manager
      pivotExpansion?.destroy();
      handle?.dispose();
    };
  }, [docId, retryCount]); // Re-run on docId change or retry

  const handleRetry = () => {
    setRetryCount((c) => c + 1);
  };

  // Render based on state
  switch (state.status) {
    case 'loading':
      return <>{loadingFallback ?? <DefaultLoadingFallback />}</>;

    case 'error':
      if (errorFallback) {
        return <>{errorFallback(state.error, handleRetry)}</>;
      }
      return <DefaultErrorFallback error={state.error} onRetry={handleRetry} />;

    case 'ready':
      return <DocumentContext.Provider value={state.value}>{children}</DocumentContext.Provider>;
  }
}
