/**
 * Shell Coordinator
 *
 * Central coordination layer for the Shell that manages:
 * - View lifecycle (mount/unmount/dispose)
 * - Adapter caching (CRITICAL for fast view switching)
 * - Cross-view coordination (clipboard, focus)
 * - Shell-level machines (focus, clipboard)
 *
 * Design principles:
 * 1. Owns the adapter cache - views preserve state when switched away
 * 2. Owns shell-level machines (focus, clipboard) - NOT grid-specific
 * 3. Provides view-agnostic commands (copy, paste)
 * 4. Never touches view internals - only through ViewAdapter contract
 *
 * Grid-specific machines (selection, editor, renderer, input) are owned by
 * GridCoordinator (different file), not here.
 */

import { createActor, type ActorRefFrom } from 'xstate';

import { focusMachine } from '@mog/shell';
import type { ColId, RowId } from '@mog-sdk/contracts/cell-identity';
import { ensureFormulaA1 } from '@mog/spreadsheet-utils/cells/formula-string';
import type { CellValue, SheetId } from '@mog-sdk/contracts/core';
import type { FocusLayerType } from '@mog-sdk/contracts/machines';
import type { IViewRegistry, ViewId, ViewType } from '@mog-sdk/contracts/views';
import type { ClipboardPayload } from '../domain/clipboard/types';
import { clipboardMachine } from '../systems/grid-editing/machines/clipboard-machine';
import type {
  CoordinatorViewAdapter,
  ShellCoordinatorConfig,
  ShellCoordinatorState,
} from './types';
import type { ViewClipboardData } from './view-clipboard-data';

/**
 * ShellCoordinator - Manages view lifecycle and cross-view coordination.
 *
 * Key responsibilities:
 * - View switching with adapter caching (CRITICAL for performance)
 * - Cross-view clipboard operations (Grid → Kanban paste)
 * - Focus management (dialog stack, keyboard delegation)
 *
 * Usage:
 * ```typescript
 * const coordinator = new ShellCoordinator({ container, viewRegistry });
 * coordinator.switchView(viewId, 'grid', gridConfig);
 * coordinator.copy; // Delegates to active view adapter
 * coordinator.paste(); // Delegates to active view adapter
 * ```
 */
export class ShellCoordinator {
  private container: HTMLElement;
  private viewRegistry: IViewRegistry;
  private activeViewId: string | null = null;
  private activeAdapter: CoordinatorViewAdapter | null = null;

  // ═══════════════════════════════════════════════════════════════════════════
  // CRITICAL: Adapter caching for fast view switching
  // Views preserve state (scroll, selection, expanded rows) when switched away
  // ═══════════════════════════════════════════════════════════════════════════
  private readonly isMac: boolean;
  private adapterCache = new Map<string, CoordinatorViewAdapter>();

  // ═══════════════════════════════════════════════════════════════════════════
  // Shell-level actors (focus and clipboard are NOT grid-specific)
  // Grid-specific machines (selection, editor, renderer, input) live in GridCoordinator
  // ═══════════════════════════════════════════════════════════════════════════
  private focusActor: ActorRefFrom<typeof focusMachine>;
  private clipboardActor: ActorRefFrom<typeof clipboardMachine>;

  // ═══════════════════════════════════════════════════════════════════════════
  // Toolbar context subscription (updates UIStore when selection changes)
  // ═══════════════════════════════════════════════════════════════════════════
  private toolbarContextUnsubscribe: (() => void) | null = null;

  constructor(config: ShellCoordinatorConfig) {
    this.container = config.container;
    this.viewRegistry = config.viewRegistry;
    this.isMac = config.isMac ?? false;

    // Initialize shell-level actors
    // The clipboard machine accepts optional input for kernel service delegation
    this.focusActor = createActor(focusMachine);
    this.clipboardActor = createActor(clipboardMachine, {
      input: { kernelClipboardService: config.kernelClipboardService },
    });
    this.focusActor.start();
    this.clipboardActor.start();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // View Lifecycle (CRITICAL - Adapter Caching)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Switch to a different view.
   *
   * CRITICAL: This uses adapter caching for fast switching:
   * - unmount() detaches from DOM but KEEPS state (scroll, selection)
   * - Adapter is cached for later resume
   * - mount() may be resuming a cached adapter
   *
   * @param viewId - Unique identifier for this view instance
   * @param viewType - Type of view (grid, kanban, etc.)
   * @param config - View-specific configuration
   */
  switchView<T extends ViewType>(
    viewId: string,
    viewType: T,
    config: Record<string, unknown>,
  ): void {
    // 1. Unsubscribe from old adapter's toolbar context changes
    this.toolbarContextUnsubscribe?.();
    this.toolbarContextUnsubscribe = null;

    // 2. Unmount current adapter (but keep in cache for fast resume)
    this.activeAdapter?.unmount();

    // 3. Get or create adapter
    let adapter = this.adapterCache.get(viewId);
    if (!adapter) {
      // Create new adapter (first time viewing this instance)
      // IViewRegistry.createAdapter accepts unknown config, returns IViewAdapter.
      // We cast to CoordinatorViewAdapter since registered adapters implement clipboard methods.
      adapter = this.viewRegistry.createAdapter(viewType, {
        viewId: viewId as ViewId,
        config,
        uiStore: undefined, // TODO: Add uiStore to ShellCoordinatorConfig
      }) as CoordinatorViewAdapter;
      this.adapterCache.set(viewId, adapter);
    }

    // 4. Mount adapter (may be resuming cached adapter)
    adapter.mount(this.container);
    this.activeViewId = viewId;
    this.activeAdapter = adapter;

    // 5. Subscribe to toolbar context changes
    this.toolbarContextUnsubscribe = adapter.onToolbarContextChange((_ctx) => {
      // TODO: Update UIStore toolbar context
      // this.uiStore.getState().setToolbarContext(ctx);
    });

    // 6. Set initial toolbar context
    // TODO: Update UIStore with initial toolbar context
    // const initialContext = adapter.getToolbarContext();
    // this.uiStore.getState().setToolbarContext(initialContext);

    // 7. Reset focus to base view layer
    this.focusActor.send({ type: 'FOCUS_GRID' }); // TODO: Rename to FOCUS_BASE_VIEW in focus-machine
  }

  /**
   * Delete a view permanently (not just switching away).
   * This calls dispose() for full cleanup, unlike unmount() which preserves state.
   *
   * @param viewId - View instance to delete
   */
  deleteView(viewId: string): void {
    const adapter = this.adapterCache.get(viewId);
    if (adapter) {
      // Unmount if currently active
      if (this.activeAdapter === adapter) {
        this.toolbarContextUnsubscribe?.();
        this.toolbarContextUnsubscribe = null;
        adapter.unmount();
        this.activeAdapter = null;
        this.activeViewId = null;
      }
      // Full cleanup (dispose vs unmount - important distinction!)
      adapter.dispose();
      this.adapterCache.delete(viewId);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Adapter Access (for action handlers)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get the currently active view adapter.
   * Used by action handlers to delegate view-specific operations.
   *
   * @returns Current adapter or null if no view is active
   */
  getActiveAdapter(): CoordinatorViewAdapter | null {
    return this.activeAdapter;
  }

  /**
   * Get current coordinator state snapshot.
   * Used for debugging and testing.
   */
  getState(): ShellCoordinatorState {
    return {
      activeViewId: this.activeViewId,
      activeAdapter: this.activeAdapter,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Clipboard Operations (delegate to active adapter)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Copy current selection to clipboard.
   * Delegates to active view adapter to get multi-format clipboard data.
   */
  copy(): void {
    const payload = this.activeAdapter?.getClipboardPayload();
    if (payload) {
      // Convert ClipboardPayload to ViewClipboardData for compatibility with clipboard machine
      // The clipboard machine uses ViewClipboardData internally
      const viewData = this.convertPayloadToViewData(payload);
      this.clipboardActor.send({ type: 'COPY_VIEW', viewData });
    }
  }

  /**
   * Cut current selection to clipboard.
   * Delegates to active view adapter to get multi-format clipboard data.
   */
  cut(): void {
    const payload = this.activeAdapter?.getClipboardPayload();
    if (payload) {
      // Convert ClipboardPayload to ViewClipboardData for compatibility with clipboard machine
      const viewData = this.convertPayloadToViewData(payload);
      this.clipboardActor.send({ type: 'CUT_VIEW', viewData });
    }
  }

  /**
   * Paste clipboard data to active view.
   * Checks if active view can paste the data format, then delegates.
   */
  paste(): void {
    const snapshot = this.clipboardActor.getSnapshot();
    const viewData = snapshot.context.viewData;
    if (viewData) {
      // Convert ViewClipboardData back to ClipboardPayload for view adapters
      const payload = this.convertViewDataToPayload(viewData);
      if (this.activeAdapter?.canPaste(payload)) {
        this.activeAdapter.paste(payload);
      }
    }
  }

  /**
   * Convert ClipboardPayload (new format) to ViewClipboardData (clipboard machine format).
   * This bridges the new view adapter interface with the existing clipboard machine.
   */
  private convertPayloadToViewData(payload: ClipboardPayload): ViewClipboardData {
    return {
      source: {
        viewType: payload.source.viewType,
        viewId: payload.source.viewId ?? ('' as ViewId),
      },
      cells: payload.cells
        ? {
            sheetId: payload.source.sheetId ?? ('' as SheetId),
            origin: { row: 0, col: 0 },
            // CellData from contracts has: value, formula?, format?, borders?, comment?, hyperlink?
            // Preserve formulas during conversion - if a formula exists for a cell, include it
            data: payload.cells.values.map((row, rowIndex) =>
              row.map((value, colIndex) => {
                const formula = payload.cells?.formulas?.[rowIndex]?.[colIndex];
                return {
                  value,
                  // Include formula if present (preserves formulas during Grid -> Grid paste)
                  ...(formula ? { formula: ensureFormulaA1(formula) } : {}),
                };
              }),
            ),
          }
        : undefined,
      records: payload.tableContext
        ? {
            tableId: payload.tableContext.tableId,
            rowIds: payload.tableContext.rowIds,
            columns: payload.tableContext.colIds,
            values: this.buildRecordValues(payload),
          }
        : undefined,
      text: payload.text,
    };
  }

  /**
   * Convert ViewClipboardData (clipboard machine format) to ClipboardPayload (new format).
   */
  private convertViewDataToPayload(viewData: ViewClipboardData): ClipboardPayload {
    // Extract cell values from ViewClipboardData
    // CellData from contracts has `value` as the display value and optional `formula`
    const cellValues: CellValue[][] =
      viewData.cells?.data.map((row) => row.map((cell) => cell.value)) ?? [];

    // Extract formulas from ViewClipboardData
    // Preserve formulas during conversion for Grid -> Grid paste
    const cellFormulas: (string | null)[][] | undefined = viewData.cells?.data.map((row) =>
      row.map((cell) => cell.formula ?? null),
    );

    // Check if there are any actual formulas (not all null)
    const hasFormulas = cellFormulas?.some((row) => row.some((formula) => formula !== null));

    return {
      cells: {
        values: cellValues,
        // Only include formulas array if there are actual formulas
        formulas: hasFormulas ? cellFormulas : undefined,
        rowCount: cellValues.length,
        colCount: cellValues.length > 0 ? cellValues[0].length : 0,
      },
      tableContext: viewData.records
        ? {
            tableId: viewData.records.tableId,
            rowIds: viewData.records.rowIds,
            colIds: viewData.records.columns,
            columnSchemas: [], // Schema info not preserved in old format
          }
        : undefined,
      source: {
        viewType: viewData.source.viewType,
        viewId: viewData.source.viewId,
        sheetId: viewData.cells?.sheetId ?? null,
      },
      text: viewData.text,
    };
  }

  /**
   * Build record values map from ClipboardPayload for ViewClipboardData.
   */
  private buildRecordValues(payload: ClipboardPayload): Map<RowId, Map<ColId, CellValue>> {
    const result = new Map<RowId, Map<ColId, CellValue>>();
    if (!payload.tableContext || !payload.cells) return result;

    const { rowIds, colIds } = payload.tableContext;
    const { values } = payload.cells;

    for (let r = 0; r < values.length && r < rowIds.length; r++) {
      const rowMap = new Map<ColId, CellValue>();
      for (let c = 0; c < values[r].length && c < colIds.length; c++) {
        rowMap.set(colIds[c], values[r][c]);
      }
      result.set(rowIds[r], rowMap);
    }

    return result;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Focus Management
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get the current focus layer.
   * Used to determine which component should handle keyboard events.
   */
  getFocusLayer(): string {
    return this.focusActor.getSnapshot().context.stack[
      this.focusActor.getSnapshot().context.stack.length - 1
    ].type;
  }

  /**
   * Push a new focus layer onto the stack (e.g., dialog opens).
   *
   * @param layer - Layer type to push
   * @param id - Optional unique identifier for the layer (defaults to layer type)
   */
  pushFocusLayer(layer: FocusLayerType, id?: string): void {
    this.focusActor.send({
      type: 'PUSH_LAYER',
      layerType: layer,
      id: id ?? layer,
      returnFocusTarget: null,
    });
  }

  /**
   * Pop the current focus layer from the stack (e.g., dialog closes).
   */
  popFocusLayer(): void {
    this.focusActor.send({ type: 'POP_LAYER' });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Keyboard Routing (delegates to active view adapter)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Handle keyboard event.
   *
   * Routing: delegates to active view adapter. Shell-level shortcuts
   * (e.g., Cmd+K, Ctrl+Shift+P) are handled by the unified keyboard registry
   * in KeyboardCoordinator, not here.
   *
   * @param event - Keyboard event to handle
   * @returns true if handled, false if not
   */
  handleKeyboard(event: KeyboardEvent): boolean {
    // Delegate to active view adapter
    return this.activeAdapter?.handleKeyboard(event) ?? false;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Cleanup
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Clean up all resources.
   * Called when shell is unmounting (e.g., workbook closing).
   */
  dispose(): void {
    // Unsubscribe from toolbar context changes
    this.toolbarContextUnsubscribe?.();
    this.toolbarContextUnsubscribe = null;

    // Unmount active adapter
    this.activeAdapter?.unmount();
    this.activeAdapter = null;
    this.activeViewId = null;

    // Dispose all cached adapters
    for (const adapter of this.adapterCache.values()) {
      adapter.dispose();
    }
    this.adapterCache.clear();

    // Stop shell-level actors
    this.focusActor.stop();
    this.clipboardActor.stop();
  }
}
