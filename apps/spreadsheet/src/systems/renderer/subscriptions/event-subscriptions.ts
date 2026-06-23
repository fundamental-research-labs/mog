/**
 * Event Subscriptions Module
 *
 * Consolidates all EventBus subscriptions that keep the RENDERER in sync
 * with store changes. This is a FEATURE extraction - the coordinator calls
 * setupEventSubscriptions() ONCE and this module handles EVERYTHING internally.
 *
 * Events handled:
 * - freeze:changed - Frozen panes sync
 * - view:options-changed - Gridlines, headers visibility
 * - rows:inserted/deleted, columns:inserted/deleted - Structural changes (full invalidation)
 * - rows:hidden/unhidden, columns:hidden/unhidden - Hidden dimension sync
 * - sheet:settings-changed - Gridline color, zero values, RTL
 * - workbook:theme-changed - Theme changes (full invalidation)
 * - workbook:version-checkout-materialized - Context swap after checkout
 * - sparkline:* - Sparkline CRUD and data changes
 * - range:sorted - Sort operations (full invalidation)
 * - filter:created, filter:deleted - AutoFilter CRUD (render filter buttons)
 * - table:created, table:updated, table:deleted - Table CRUD (render table styling)
 *
 * Events NOT handled here (buffer-driven render scheduling via RenderScheduler):
 * - cell:changed, cells:batch-changed - handled by BinaryViewportBuffer writes
 * - cell:format-changed - viewport patched by binary blob in mutateCore(); event is for non-viewport consumers
 * - row:height-changed, column:width-changed - handled by patchRowDimension/patchColDimension
 * - cells:merged, cells:unmerged - handled by binary mutations
 * - merges:changed - handled below (full invalidation for merge geometry)
 *
 * NOTE: Cell property subscriptions (cell:format-changed, cell:metadata-changed)
 * are handled by cell-property-subscriptions.ts because they are DATA events,
 * not renderer events. They work independently of whether a renderer is attached.
 * @see cell-property-subscriptions.ts - Issue B fix
 *
 * @see COORDINATOR-MODULE-EXTRACTION.md
 */

import { getCulture } from '@mog/culture';
import type { ConditionalFormatCache, Workbook } from '@mog-sdk/contracts/api';
import type { CellRange as ContractCellRange } from '@mog-sdk/contracts/core';
import type { FrozenPanes, GridRenderer, RenderContextConfig } from '@mog-sdk/contracts/rendering';
import type { ISparklineManager as SparklineManager } from '@mog-sdk/contracts/sparklines';
import type { PersistedViewportConfig } from '@mog-sdk/contracts/viewport-config';
import { getTheme } from '../../../infra/styles/built-in-themes';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Configuration for setting up event subscriptions.
 */
export interface EventSubscriptionConfig {
  /**
   * Workbook instance for event subscriptions.
   */
  workbook: Workbook;

  /**
   * Get the current renderer instance.
   * @deprecated Retained for callers that still need GridRenderer-specific methods.
   * New subscriptions should use invalidateAll/getCurrentSheetId callbacks.
   */
  getRenderer: () => GridRenderer | null;

  /**
   * Invalidate all rendering (replaces getRenderer().invalidateAll()).
   * When provided, used instead of getRenderer().invalidateAll().
   */
  invalidateAll?: () => void;

  /**
   * Get current sheet ID (replaces getRenderer().getCurrentSheetId()).
   * When provided, used instead of getRenderer().getCurrentSheetId().
   */
  getCurrentSheetId?: () => string | null;

  /**
   * Update renderer context with new values.
   * Used for view options and sheet settings.
   */
  updateRendererContext: (config: Partial<RenderContextConfig>) => void;

  /**
   * Set frozen panes on the renderer.
   */
  setFrozenPanes: (panes: FrozenPanes) => void;

  /**
   * Set the active SheetView viewport topology.
   * Split events are workbook state changes; SheetView owns the computed layout.
   */
  setViewportConfig: (config: PersistedViewportConfig) => void;

  /**
   * Rebind renderer-owned viewport registrations after workbook context swaps.
   */
  rebindWorkbookViewport?: () => void;

  /**
   * Callback when workbook settings change that affect selection machine.
   * Issue 8: Settings Panel - allowDragFill affects selection machine guard.
   * Optional since not all coordinators need this.
   */
  onWorkbookSettingsChanged?: (
    changedKey: keyof import('@mog-sdk/contracts/core').WorkbookSettings,
    newValue: unknown,
  ) => void;
}

/**
 * Configuration for sparkline event handling.
 * Passed separately since SparklineManager is optional and set later.
 */
export interface SparklineEventConfig {
  sparklineManager: SparklineManager;
  getCurrentSheetId: () => string;
  onSparklineTopologyChanged?: (event: SparklineTopologyEvent) => void;
}

export interface SparklineTopologyEvent {
  type: string;
  sheetId: string;
  position?: { row: number; col: number };
}

/**
 * Configuration for conditional formatting event handling.
 * Passed separately since ConditionalFormatCache is optional and set later.
 *
 * @see CF Rendering Integration
 */
export interface CFEventConfig {
  cfManager: ConditionalFormatCache;
  getCurrentSheetId: () => string;
}

/**
 * Configuration for table auto-expansion event handling.
 * Table Auto-Expansion - Wire Coordinator
 *
 * When users type in cells adjacent to a table, the table should
 * automatically expand to include the new data.
 */
export interface TableAutoExpansionConfig {
  /**
   * Check if auto-expansion is needed for a cell edit.
   * Returns the table to expand, or undefined if no expansion needed.
   */
  checkAutoExpansion: (
    sheetId: string,
    row: number,
    col: number,
  ) => Promise<{ id: string; sheetId: string; name: string } | undefined>;

  /**
   * Expand the table to include a new row.
   */
  autoExpandTableRow: (tableId: string) => Promise<boolean>;

  /**
   * Expand the table to include a new column.
   */
  autoExpandTableColumn: (tableId: string, newColumnName?: string) => Promise<boolean>;

  /**
   * Get current sheet ID.
   */
  getCurrentSheetId: () => string;

  /**
   * Tables Apply calculated column formulas to a newly added row.
   * Called after autoExpandTableRow succeeds.
   *
   * @param tableId - The table that was expanded
   * @param rowIndex - The newly added row index (absolute)
   */
  applyCalculatedFormulasToNewRow?: (tableId: string, rowIndex: number) => void;
}

/**
 * Result returned by setupEventSubscriptions.
 *
 * NOTE: Cell property subscriptions are NOT here - they're in a separate module
 * (cell-property-subscriptions.ts) because they're DATA events, not renderer events.
 */
export interface EventSubscriptionResult {
  /**
   * Set up sparkline-specific event handlers.
   * Call this when SparklineManager becomes available.
   * Returns cleanup function for sparkline events only.
   */
  setSparklineConfig: (config: SparklineEventConfig) => () => void;

  /**
   * Set up conditional formatting event handlers.
   * Call this when ConditionalFormatCache becomes available.
   * Returns cleanup function for CF events only.
   *
   * Handles:
   * - Cell value changes → CF cache invalidation (render handled by RenderScheduler)
   * - CF rule changes → renderer invalidation (cache auto-invalidates)
   *
   * @see CF Rendering Integration
   */
  setCFConfig: (config: CFEventConfig) => () => void;

  /**
   * Set up table auto-expansion event handlers.
   * Table Auto-Expansion - Wire Coordinator
   *
   * Handles:
   * - Cell value changes → check if cell is adjacent to table → auto-expand
   *
   */
  setTableAutoExpansionConfig: (config: TableAutoExpansionConfig) => () => void;

  /**
   * Wait for table auto-expansion tasks spawned from synchronous cell-change
   * events. Clipboard paste calls this before closing its undo group so
   * dependent table range mutations remain part of the same user action.
   */
  drainTableAutoExpansion: () => Promise<void>;

  /**
   * Main cleanup function - unsubscribes all events.
   */
  cleanup: () => void;
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

/**
 * Set up all event subscriptions for RENDERER synchronization.
 *
 * This is a FEATURE extraction - the coordinator calls this ONCE
 * and this module handles all EventBus subscriptions internally.
 *
 * NOTE: Cell property subscriptions are handled separately in
 * cell-property-subscriptions.ts because they're DATA events.
 *
 * @param config - Dependencies and callbacks
 * @returns Result with sparkline config API and cleanup
 */
export function setupEventSubscriptions(config: EventSubscriptionConfig): EventSubscriptionResult {
  const { workbook, getRenderer, updateRendererContext, setFrozenPanes, setViewportConfig } =
    config;

  // Cleanup registry (mirrors coordinator pattern)
  const cleanups = new Map<string, () => void>();
  const pendingTableAutoExpansion = new Set<Promise<void>>();

  // NOTE: Cell property subscriptions have been moved to cell-property-subscriptions.ts
  // because they are DATA events, not renderer events. See Issue B fix.

  // ---------------------------------------------------------------------------
  // HELPER: Get current sheet ID — prefers capability-based callback,
  // falls back to GridRenderer for backward compatibility.
  // ---------------------------------------------------------------------------
  const getCurrentSheetId = (): string | null => {
    if (config.getCurrentSheetId) return config.getCurrentSheetId();
    return getRenderer()?.getCurrentSheetId() ?? null;
  };

  // ---------------------------------------------------------------------------
  // HELPER: Invalidate all rendering — prefers capability-based callback.
  // ---------------------------------------------------------------------------
  const doInvalidateAll = (): void => {
    if (config.invalidateAll) {
      config.invalidateAll();
    } else {
      getRenderer()?.invalidateAll();
    }
  };

  // ---------------------------------------------------------------------------
  // FREEZE EVENTS
  // ---------------------------------------------------------------------------
  const freezeUnsub = workbook.on('freeze:changed', (event) => {
    const currentSheetId = getCurrentSheetId();
    if (currentSheetId && event.sheetId === currentSheetId) {
      setFrozenPanes({
        rows: event.newFrozenRows,
        cols: event.newFrozenCols,
      });
    }
  });
  cleanups.set('freeze', freezeUnsub);

  // ---------------------------------------------------------------------------
  // VIEW OPTIONS EVENTS
  // ---------------------------------------------------------------------------
  const viewOptionsUnsub = workbook.on('view:options-changed', (event) => {
    const currentSheetId = getCurrentSheetId();
    if (currentSheetId && event.sheetId === currentSheetId) {
      updateRendererContext({
        showGridlines: event.showGridlines,
        showRowHeaders: event.showRowHeaders,
        showColumnHeaders: event.showColumnHeaders,
      });
    }
  });
  cleanups.set('viewOptions', viewOptionsUnsub);

  // ---------------------------------------------------------------------------
  // SPLIT VIEW EVENTS
  // ---------------------------------------------------------------------------
  const applySplitConfig = (sheetId: string, viewportConfig: PersistedViewportConfig): void => {
    const currentSheetId = getCurrentSheetId();
    if (currentSheetId && sheetId === currentSheetId) {
      setViewportConfig(viewportConfig);
      doInvalidateAll();
    }
  };

  const splitCreatedUnsub = workbook.on('split:created', (event) => {
    applySplitConfig(event.sheetId, {
      type: 'split',
      direction: event.config.direction,
      horizontalPosition: event.config.horizontalPosition,
      verticalPosition: event.config.verticalPosition,
    });
  });
  cleanups.set('splitCreated', splitCreatedUnsub);

  const splitPositionChangedUnsub = workbook.on('split:position-changed', (event) => {
    applySplitConfig(event.sheetId, {
      type: 'split',
      direction: event.config.direction,
      horizontalPosition: event.config.horizontalPosition,
      verticalPosition: event.config.verticalPosition,
    });
  });
  cleanups.set('splitPositionChanged', splitPositionChangedUnsub);

  const splitRemovedUnsub = workbook.on('split:removed', (event) => {
    applySplitConfig(event.sheetId, { type: 'single' });
  });
  cleanups.set('splitRemoved', splitRemovedUnsub);

  // ---------------------------------------------------------------------------
  // HIDDEN ROWS/COLUMNS EVENTS
  // ---------------------------------------------------------------------------
  const handleHiddenChange = (sheetId: string) => {
    const currentSheetId = getCurrentSheetId();
    if (currentSheetId && sheetId === currentSheetId) {
      // VPI/VMI are rebuilt from viewport buffer each frame — no cache to invalidate.
      // Request full re-render since all visible content may shift.
      doInvalidateAll();
    }
  };

  const rowsHiddenUnsub = workbook.on('rows:hidden', (event) => {
    handleHiddenChange(event.sheetId);
  });
  cleanups.set('rowsHidden', rowsHiddenUnsub);

  const rowsUnhiddenUnsub = workbook.on('rows:unhidden', (event) => {
    handleHiddenChange(event.sheetId);
  });
  cleanups.set('rowsUnhidden', rowsUnhiddenUnsub);

  const colsHiddenUnsub = workbook.on('columns:hidden', (event) => {
    handleHiddenChange(event.sheetId);
  });
  cleanups.set('colsHidden', colsHiddenUnsub);

  const colsUnhiddenUnsub = workbook.on('columns:unhidden', (event) => {
    handleHiddenChange(event.sheetId);
  });
  cleanups.set('colsUnhidden', colsUnhiddenUnsub);

  // ---------------------------------------------------------------------------
  // STRUCTURAL CHANGES (INSERT/DELETE ROWS/COLUMNS)
  // ---------------------------------------------------------------------------
  // Structural changes shift all visible content and change grid geometry.
  // The binary viewport patches from Rust may be empty (e.g. on sparse sheets),
  // so we must explicitly invalidate to trigger a full re-render.
  const handleStructureChange = (sheetId: string) => {
    const currentSheetId = getCurrentSheetId();
    if (currentSheetId && sheetId === currentSheetId) {
      doInvalidateAll();
    }
  };

  const rowsInsertedUnsub = workbook.on('rows:inserted', (event) => {
    handleStructureChange(event.sheetId);
  });
  cleanups.set('rowsInserted', rowsInsertedUnsub);

  const rowsDeletedUnsub = workbook.on('rows:deleted', (event) => {
    handleStructureChange(event.sheetId);
  });
  cleanups.set('rowsDeleted', rowsDeletedUnsub);

  const colsInsertedUnsub = workbook.on('columns:inserted', (event) => {
    handleStructureChange(event.sheetId);
  });
  cleanups.set('colsInserted', colsInsertedUnsub);

  const colsDeletedUnsub = workbook.on('columns:deleted', (event) => {
    handleStructureChange(event.sheetId);
  });
  cleanups.set('colsDeleted', colsDeletedUnsub);

  // ---------------------------------------------------------------------------
  // ROW HEIGHT / COLUMN WIDTH EVENTS
  // ---------------------------------------------------------------------------
  // These events NO LONGER trigger renderer invalidation here.
  // Render scheduling is handled atomically by patchRowDimension/patchColDimension
  // → markGeometryDirty via the RenderScheduler.
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // SHEET SETTINGS EVENTS
  // ---------------------------------------------------------------------------
  const sheetSettingsUnsub = workbook.on('sheet:settings-changed', (event) => {
    const currentSheetId = getCurrentSheetId();
    if (currentSheetId && event.sheetId === currentSheetId) {
      // Update renderer context with settings that affect rendering
      // Only update the specific changed setting for efficiency
      switch (event.changedKey) {
        case 'gridlineColor':
          updateRendererContext({
            gridlineColor: event.settings.gridlineColor,
          });
          break;
        case 'showZeroValues':
          updateRendererContext({
            showZeroValues: event.settings.showZeroValues,
          });
          break;
        case 'rightToLeft':
          updateRendererContext({
            rightToLeft: event.settings.rightToLeft,
          });
          break;
        // Note: Other sheet settings (like isProtected, defaultRowHeight, etc.)
        // don't directly affect rendering - they're handled elsewhere
      }
    }
  });
  cleanups.set('sheetSettings', sheetSettingsUnsub);

  // ---------------------------------------------------------------------------
  // WORKBOOK SETTINGS EVENTS (Issue 8: Settings Panel)
  // ---------------------------------------------------------------------------
  const workbookSettingsUnsub = workbook.on('workbook:settings-changed', (event) => {
    // Update renderer context for settings that affect rendering
    switch (event.changedKey) {
      case 'showCutCopyIndicator':
        updateRendererContext({
          showCutCopyIndicator: event.settings.showCutCopyIndicator,
        });
        break;
      case 'allowDragFill':
        updateRendererContext({
          allowDragFill: event.settings.allowDragFill,
        });
        break;
      // Culture & Localization - culture affects ALL number/date formatting
      case 'culture': {
        const newCulture = getCulture(event.settings.culture);
        updateRendererContext({ culture: newCulture });
        // Full invalidation - culture affects all cells with numbers, dates, currencies
        doInvalidateAll();
        break;
      }
      // Note: enterKeyDirection is handled by cross-coordination, not renderer
      // Note: themeId is handled separately by theme event system
    }

    // Notify coordinator for machine updates (e.g., allowDragFill → selection machine)
    if (config.onWorkbookSettingsChanged) {
      config.onWorkbookSettingsChanged(event.changedKey, event.settings[event.changedKey]);
    }
  });
  cleanups.set('workbookSettings', workbookSettingsUnsub);

  // ---------------------------------------------------------------------------
  // VERSION CHECKOUT EVENTS
  // ---------------------------------------------------------------------------
  const versionCheckoutUnsub = workbook.on('workbook:version-checkout-materialized', () => {
    config.rebindWorkbookViewport?.();
    doInvalidateAll();
  });
  cleanups.set('versionCheckout', versionCheckoutUnsub);

  // ---------------------------------------------------------------------------
  // WORKBOOK THEME EVENTS (Issue 4: Page Layout - Themes)
  // ---------------------------------------------------------------------------
  const themeChangedUnsub = workbook.on('workbook:theme-changed', (event) => {
    // Resolve the new theme (built-in or custom)
    const newTheme = getTheme(event.newThemeId, event.customTheme);

    // Update render context with new theme
    updateRendererContext({ theme: newTheme });

    // Full layer invalidation - theme affects ALL cells with theme color references
    // Don't try to track which cells use theme colors; full invalidation is simpler and correct
    doInvalidateAll();
  });
  cleanups.set('themeChanged', themeChangedUnsub);

  // ---------------------------------------------------------------------------
  // MERGE EVENTS
  // ---------------------------------------------------------------------------
  // Individual cell-level merge events (cells:merged, cells:unmerged) are handled
  // by binary viewport patches. However, merges:changed is a summary event that
  // fires AFTER merge/unmerge completes. We subscribe to it to trigger a full
  // invalidation, ensuring the renderer picks up updated merge geometry (e.g.
  // merged cell spanning, border recalculation) that may not be fully covered
  // by the binary patch alone.
  const mergesChangedUnsub = workbook.on('merges:changed', (event) => {
    const currentSheetId = getCurrentSheetId();
    if (currentSheetId && event.sheetId === currentSheetId) {
      doInvalidateAll();
    }
  });
  cleanups.set('mergesChanged', mergesChangedUnsub);

  // ---------------------------------------------------------------------------
  // SORT EVENTS (Cell Identity Model)
  // ---------------------------------------------------------------------------
  const rangeSortedUnsub = workbook.on('range:sorted', (event) => {
    const currentSheetId = getCurrentSheetId();
    if (currentSheetId && event.sheetId === currentSheetId) {
      // Full invalidation since sorting rearranges cell positions
      doInvalidateAll();
    }
  });
  cleanups.set('rangeSorted', rangeSortedUnsub);

  // ---------------------------------------------------------------------------
  // FILTER EVENTS (Filter UI)
  // ---------------------------------------------------------------------------
  // When filters are created or deleted, we need to re-render to show/hide
  // the filter dropdown buttons on header cells.
  const filterCreatedUnsub = workbook.on('filter:created', (event) => {
    const currentSheetId = getCurrentSheetId();
    if (currentSheetId && event.sheetId === currentSheetId) {
      // Full invalidation since filter buttons need to appear on header row
      doInvalidateAll();
    }
  });
  cleanups.set('filterCreated', filterCreatedUnsub);

  const filterDeletedUnsub = workbook.on('filter:deleted', (event) => {
    const currentSheetId = getCurrentSheetId();
    if (currentSheetId && event.sheetId === currentSheetId) {
      // Full invalidation since filter buttons need to be removed from header row
      doInvalidateAll();
    }
  });
  cleanups.set('filterDeleted', filterDeletedUnsub);

  // ---------------------------------------------------------------------------
  // TABLE EVENTS (Tables)
  // ---------------------------------------------------------------------------
  // When tables are created, updated, or deleted, we need to re-render to
  // show/hide table styling (banded rows, header formatting, filter buttons).
  const tableCreatedUnsub = workbook.on('table:created', (event) => {
    const currentSheetId = getCurrentSheetId();
    if (currentSheetId && event.sheetId === currentSheetId) {
      // Full invalidation since table styling needs to be applied to all table cells
      doInvalidateAll();
    }
  });
  cleanups.set('tableCreated', tableCreatedUnsub);

  const tableUpdatedUnsub = workbook.on('table:updated', (event) => {
    const currentSheetId = getCurrentSheetId();
    if (currentSheetId && event.sheetId === currentSheetId) {
      // Full invalidation since table styling may have changed
      doInvalidateAll();
    }
  });
  cleanups.set('tableUpdated', tableUpdatedUnsub);

  const tableDeletedUnsub = workbook.on('table:deleted', (event) => {
    const currentSheetId = getCurrentSheetId();
    if (currentSheetId && event.sheetId === currentSheetId) {
      // Full invalidation since table styling needs to be removed
      doInvalidateAll();
    }
  });
  cleanups.set('tableDeleted', tableDeletedUnsub);

  // ---------------------------------------------------------------------------
  // COMMENT EVENTS
  // ---------------------------------------------------------------------------
  // When comments are cleared, we need to re-render to update the red triangle
  // comment indicators on affected cells.
  const commentsClearedUnsub = workbook.on('comments:cleared', (event) => {
    const currentSheetId = getCurrentSheetId();
    if (currentSheetId && event.sheetId === currentSheetId) {
      doInvalidateAll();
    }
  });
  cleanups.set('commentsCleared', commentsClearedUnsub);

  // ---------------------------------------------------------------------------
  // CELL VALUE / FORMAT / DIMENSION EVENTS
  // ---------------------------------------------------------------------------
  // These events NO LONGER trigger renderer invalidation here.
  // Render scheduling is handled atomically by BinaryViewportBuffer writes
  // via the RenderScheduler.
  // Domain consumers (CF cache, sparkline cache, toolbar) still subscribe
  // to these events separately.
  // Note: merges:changed IS handled above — see MERGE EVENTS section.
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // SPARKLINE EVENTS (set up separately when SparklineManager available)
  // ---------------------------------------------------------------------------
  const setSparklineConfig = (sparklineConfig: SparklineEventConfig): (() => void) => {
    const {
      sparklineManager,
      getCurrentSheetId: getSparklineSheetId,
      onSparklineTopologyChanged,
    } = sparklineConfig;
    cleanups.get('sparklines')?.();
    cleanups.delete('sparklines');

    const sparklineCleanups: (() => void)[] = [];
    let active = true;

    const handleSparklineTopologyEvent = (event: SparklineTopologyEvent): void => {
      const currentSheetId = getSparklineSheetId();
      if (event.sheetId !== currentSheetId) return;
      doInvalidateAll();
      onSparklineTopologyChanged?.(event);
    };

    // Cell changes → sparkline invalidation
    const cellChangedUnsub = workbook.on('cell:changed', (event) => {
      const currentSheetId = getSparklineSheetId();
      if (event.sheetId !== currentSheetId) return;

      const changedRange: ContractCellRange = {
        startRow: event.row,
        startCol: event.col,
        endRow: event.row,
        endCol: event.col,
      };
      sparklineManager.invalidateRenderDataInRange(event.sheetId, changedRange);
    });
    sparklineCleanups.push(cellChangedUnsub);

    // Batch cell changes
    const batchChangedUnsub = workbook.on('cells:batch-changed', (event) => {
      const currentSheetId = getSparklineSheetId();
      if (event.sheetId !== currentSheetId) return;
      if (event.changes.length === 0) return;

      // Calculate bounding box of all changed cells
      let minRow = Infinity;
      let maxRow = -Infinity;
      let minCol = Infinity;
      let maxCol = -Infinity;

      for (const change of event.changes) {
        minRow = Math.min(minRow, change.row);
        maxRow = Math.max(maxRow, change.row);
        minCol = Math.min(minCol, change.col);
        maxCol = Math.max(maxCol, change.col);
      }

      const changedRange: ContractCellRange = {
        startRow: minRow,
        startCol: minCol,
        endRow: maxRow,
        endCol: maxCol,
      };
      sparklineManager.invalidateRenderDataInRange(event.sheetId, changedRange);
    });
    sparklineCleanups.push(batchChangedUnsub);

    // Sparkline CRUD events → render invalidation
    const sparklineChangedUnsub = workbook.on('sparkline:changed', (event) => {
      handleSparklineTopologyEvent(event);
    });
    sparklineCleanups.push(sparklineChangedUnsub);

    const sparklineCreatedUnsub = workbook.on('sparkline:created', (event) => {
      handleSparklineTopologyEvent(event);
    });
    sparklineCleanups.push(sparklineCreatedUnsub);

    const sparklineUpdatedUnsub = workbook.on('sparkline:updated', (event) => {
      handleSparklineTopologyEvent(event);
    });
    sparklineCleanups.push(sparklineUpdatedUnsub);

    const sparklineDeletedUnsub = workbook.on('sparkline:deleted', (event) => {
      handleSparklineTopologyEvent(event);
    });
    sparklineCleanups.push(sparklineDeletedUnsub);

    const sparklineDataChangedUnsub = workbook.on('sparkline:dataChanged', (event) => {
      handleSparklineTopologyEvent(event);
    });
    sparklineCleanups.push(sparklineDataChangedUnsub);

    const sparklineGroupCreatedUnsub = workbook.on('sparklineGroup:created', (event) => {
      handleSparklineTopologyEvent(event);
    });
    sparklineCleanups.push(sparklineGroupCreatedUnsub);

    const sparklineGroupUpdatedUnsub = workbook.on('sparklineGroup:updated', (event) => {
      handleSparklineTopologyEvent(event);
    });
    sparklineCleanups.push(sparklineGroupUpdatedUnsub);

    const sparklineGroupDeletedUnsub = workbook.on('sparklineGroup:deleted', (event) => {
      handleSparklineTopologyEvent(event);
    });
    sparklineCleanups.push(sparklineGroupDeletedUnsub);

    const sparklinesClearedUnsub = workbook.on('sparklines:cleared', (event) => {
      handleSparklineTopologyEvent(event);
    });
    sparklineCleanups.push(sparklinesClearedUnsub);

    // Store combined cleanup
    const sparklineCleanup = () => {
      if (!active) return;
      active = false;
      sparklineCleanups.forEach((fn) => fn());
      if (cleanups.get('sparklines') === sparklineCleanup) {
        cleanups.delete('sparklines');
      }
    };
    cleanups.set('sparklines', sparklineCleanup);

    return sparklineCleanup;
  };

  // ---------------------------------------------------------------------------
  // CONDITIONAL FORMATTING EVENTS
  // ---------------------------------------------------------------------------
  const setCFConfig = (cfConfig: CFEventConfig): (() => void) => {
    const { cfManager, getCurrentSheetId: getCFSheetId } = cfConfig;
    const cfCleanups: (() => void)[] = [];

    // Cell changes → CF cache invalidation
    // When cell values change, CF results may change (e.g., color scales, data bars)
    // NOTE: Render invalidation is no longer triggered here — it's handled atomically
    // by BinaryViewportBuffer writes via the RenderScheduler.
    const cellChangedUnsub = workbook.on('cell:changed', (event) => {
      const currentSheetId = getCFSheetId();
      if (event.sheetId !== currentSheetId) return;

      // Invalidate CF cache for the changed cell
      cfManager.invalidateCells(event.sheetId, [{ row: event.row, col: event.col }]);
    });
    cfCleanups.push(cellChangedUnsub);

    // Batch cell changes
    const batchChangedUnsub = workbook.on('cells:batch-changed', (event) => {
      const currentSheetId = getCFSheetId();
      if (event.sheetId !== currentSheetId) return;
      if (event.changes.length === 0) return;

      // Invalidate CF cache for all changed cells
      cfManager.invalidateCells(
        event.sheetId,
        event.changes.map((c) => ({ row: c.row, col: c.col })),
      );
    });
    cfCleanups.push(batchChangedUnsub);

    // CF rule changes → renderer invalidation
    // ConditionalFormatCache already auto-invalidates its cache when rules change (via EventBus)
    // But we need to trigger a re-render since CF results will be different
    const cfRulesChangedUnsub = cfManager.onRulesChanged(() => {
      // CF rules changed → trigger render invalidation
      // (ConditionalFormatCache cache already cleared internally)
      doInvalidateAll();
    });
    cfCleanups.push(cfRulesChangedUnsub);

    // Store combined cleanup
    const cfCleanup = () => {
      cfCleanups.forEach((fn) => fn());
    };
    cleanups.set('cf', cfCleanup);

    return cfCleanup;
  };

  // ---------------------------------------------------------------------------
  // TABLE AUTO-EXPANSION EVENTS (Table Auto-Expansion - Wire Coordinator)
  // ---------------------------------------------------------------------------
  const setTableAutoExpansionConfig = (tableConfig: TableAutoExpansionConfig): (() => void) => {
    const {
      checkAutoExpansion,
      autoExpandTableRow,
      autoExpandTableColumn,
      getCurrentSheetId: getTableSheetId,
      applyCalculatedFormulasToNewRow,
    } = tableConfig;
    const tableCleanups: (() => void)[] = [];

    // Cell changes → check if expansion needed
    // checkAutoExpansion/autoExpandTableRow/autoExpandTableColumn are now async
    const cellChangedUnsub = workbook.on('cell:changed', (event) => {
      const currentSheetId = getTableSheetId();
      if (event.sheetId !== currentSheetId) return;

      // Skip if old value already existed (not a new cell entry)
      // We only auto-expand when user types into a previously empty cell
      if (event.oldValue !== null && event.oldValue !== undefined && event.oldValue !== '') return;

      // Skip if new value is empty (deletion, not entry)
      if (event.newValue === null || event.newValue === undefined || event.newValue === '') return;

      const task = (async () => {
        const tableToExpand = await checkAutoExpansion(event.sheetId, event.row, event.col);
        if (!tableToExpand) return;

        // Try row expansion first (most common case), then column
        let rowExpanded = false;
        try {
          rowExpanded = await autoExpandTableRow(tableToExpand.id);
        } catch {
          // best-effort
        }
        if (!rowExpanded) {
          try {
            await autoExpandTableColumn(tableToExpand.id);
          } catch {
            // best-effort
          }
        } else if (applyCalculatedFormulasToNewRow) {
          // Tables Apply calculated column formulas to the newly added row
          applyCalculatedFormulasToNewRow(tableToExpand.id, event.row);
        }

        // Trigger render invalidation after expansion
        doInvalidateAll();
      })();
      pendingTableAutoExpansion.add(task);
      void task.then(
        () => pendingTableAutoExpansion.delete(task),
        () => pendingTableAutoExpansion.delete(task),
      );
    });
    tableCleanups.push(cellChangedUnsub);

    // Store combined cleanup
    const tableCleanup = () => {
      tableCleanups.forEach((fn) => fn());
    };
    cleanups.set('tableAutoExpansion', tableCleanup);

    return tableCleanup;
  };

  const drainTableAutoExpansion = async (): Promise<void> => {
    while (pendingTableAutoExpansion.size > 0) {
      await Promise.allSettled([...pendingTableAutoExpansion]);
    }
  };

  // ---------------------------------------------------------------------------
  // CLEANUP
  // ---------------------------------------------------------------------------

  /**
   * Main cleanup - unsubscribe all events.
   */
  const cleanup = () => {
    cleanups.forEach((fn, key) => {
      try {
        fn();
      } catch (error) {
        console.error(`[EventSubscriptions] Error in cleanup '${key}':`, error);
      }
    });
    cleanups.clear();
  };

  return {
    setSparklineConfig,
    setCFConfig,
    setTableAutoExpansionConfig,
    drainTableAutoExpansion,
    cleanup,
  };
}
