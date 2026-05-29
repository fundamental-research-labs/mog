/**
 * usePivotTables Hook
 *
 * Manages pivot table state for the spreadsheet.
 *
 * State architecture:
 * - ws.pivots.*: Unified API for all pivot CRUD and computation (routes through bridge -> Rust)
 * - PivotBridge.subscribe: Result notification callbacks (ephemeral computation cache)
 * - EventBus: Config change notifications (pivot:created, pivot:updated, pivot:deleted)
 * - Local state: Computed results (derived from bridge)
 *
 * @module hooks/use-pivot-tables
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { type CellRange, type SheetId, sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type {
  AggregateFunction,
  PivotField,
  PivotFieldArea,
  PivotFieldPlacementFlat as PivotFieldPlacement,
  PivotFilter,
  PivotTableConfig,
  PivotTableLayout,
  PivotTableResult,
  PivotTableStyle,
  PivotTableWithResult,
  SortOrder,
} from '@mog-sdk/contracts/pivot';
import type {
  PivotCreatedEvent,
  PivotDeletedEvent,
  PivotUpdatedEvent,
} from '@mog-sdk/contracts/events';
import {
  useEditingPivotId,
  useEventBus,
  useSelectedPivotId,
  useUIStore,
  useWorkbook,
} from '../../infra/context';
import { getUniqueSheetName } from '../../infra/utils/naming';
import type { WorkbookWithImportedPivots } from '../../pivot/imported-pivot-runtime';

// =============================================================================
// Types for Location Selection
// =============================================================================

/**
 * Output location specification for pivot table creation.
 * Determines where the pivot table will be placed.
 */
export interface PivotOutputLocation {
  /**
   * Location mode:
   * - 'newWorksheet': Create a new sheet dedicated to this pivot table
   * - 'existingWorksheet': Place on an existing sheet at a specific cell
   */
  mode: 'newWorksheet' | 'existingWorksheet';

  /**
   * For 'existingWorksheet' mode: the target sheet ID.
   * For 'newWorksheet' mode: ignored (new sheet will be created).
   */
  sheetId?: SheetId;

  /**
   * For 'existingWorksheet' mode: the anchor cell (top-left corner).
   * For 'newWorksheet' mode: defaults to { row: 0, col: 0 } (A1).
   */
  cell?: { row: number; col: number };
}

// =============================================================================
// Types
// =============================================================================

export interface UsePivotTablesOptions {
  /**
   * Current sheet ID (the active sheet being viewed).
   *
   * This is the OUTPUT sheet ID where pivots are displayed.
   * The hook will return pivots that are rendered on this sheet,
   * regardless of where their source data comes from.
   *
   * Pivots are stored by outputSheetId (where displayed)
   */
  sheetId: SheetId;
}

export interface UsePivotTablesReturn {
  /** All pivot tables in the current sheet with their computed results */
  pivotTables: PivotTableWithResult[];

  /** Currently selected pivot table ID */
  selectedPivotId: string | null;

  /** Currently editing pivot table ID */
  editingPivotId: string | null;

  /**
   * Create a new pivot table with location selection support.
   *
   * @param name - Pivot table name
   * @param sourceRange - Source data range
   * @param sourceSheetId - Sheet containing the source data (defaults to active sheet)
   * @param outputLocation - Where to place the pivot table (defaults to new worksheet)
   * @returns Object containing the created pivot config and the output sheet ID
   *
   * For "New Worksheet" mode:
   * - Creates a new sheet named after the pivot (with conflict resolution)
   * - Sheet creation and pivot creation are in a SINGLE transaction for atomic undo
   * - Returns the new sheet ID so caller can navigate to it
   *
   * For "Existing Worksheet" mode:
   * - Places pivot at the specified cell on the specified sheet
   * - Returns the target sheet ID so caller can navigate to it
   */
  createPivotTable: (
    name: string,
    sourceRange: CellRange,
    sourceSheetId?: SheetId,
    outputLocation?: PivotOutputLocation,
  ) => Promise<{ config: PivotTableConfig; outputSheetId: SheetId }>;

  /** Detect fields from a source range */
  detectFields: (sourceRange: CellRange, sourceSheetId?: SheetId) => Promise<PivotField[]>;

  /** Update pivot table configuration */
  updatePivotTable: (
    pivotId: string,
    updates: Partial<Omit<PivotTableConfig, 'id' | 'createdAt'>>,
  ) => void;

  /** Delete a pivot table */
  deletePivotTable: (pivotId: string) => void;

  /** Add a field to an area */
  addFieldToArea: (
    pivotId: string,
    fieldId: string,
    area: PivotFieldArea,
    options?: {
      position?: number;
      aggregateFunction?: AggregateFunction;
      sortOrder?: SortOrder;
      displayName?: string;
    },
  ) => void;

  /** Remove a field from an area */
  removeFieldFromArea: (pivotId: string, fieldId: string, area: PivotFieldArea) => void;

  /** Move a field to a different area or position */
  moveField: (
    pivotId: string,
    fieldId: string,
    fromArea: PivotFieldArea,
    toArea: PivotFieldArea,
    toPosition: number,
  ) => void;

  /** Set aggregation function for a value field */
  setAggregateFunction: (
    pivotId: string,
    fieldId: string,
    aggregateFunction: AggregateFunction,
  ) => void;

  /** Set sort order for a row/column field */
  setSortOrder: (pivotId: string, fieldId: string, sortOrder: SortOrder) => void;

  /** Set filter for a field */
  setFilter: (pivotId: string, fieldId: string, filter: Omit<PivotFilter, 'fieldId'>) => void;

  /** Remove filter from a field */
  removeFilter: (pivotId: string, fieldId: string) => void;

  /** Update layout options */
  setLayout: (pivotId: string, layout: Partial<PivotTableLayout>) => void;

  /** Update style options */
  setStyle: (pivotId: string, style: Partial<PivotTableStyle>) => void;

  /** Toggle row expansion */
  toggleRowExpanded: (pivotId: string, headerKey: string) => boolean;

  /** Toggle column expansion */
  toggleColumnExpanded: (pivotId: string, headerKey: string) => boolean;

  /** Expand or collapse all headers */
  setAllExpanded: (pivotId: string, expanded: boolean) => void;

  /** Refresh a pivot table (recompute) */
  refreshPivotTable: (pivotId: string) => void;

  /** Get drill-down data for a cell */
  getDrillDownData: (
    pivotId: string,
    rowKey: string,
    columnKey: string,
  ) => Promise<import('@mog-sdk/contracts').CellValue[][]>;

  /** Select a pivot table */
  selectPivot: (pivotId: string | null) => void;

  /** Start editing a pivot table */
  startEditingPivot: (pivotId: string) => void;

  /** Stop editing pivot table */
  stopEditingPivot: () => void;
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook for managing pivot tables in the spreadsheet.
 *
 * Routes all operations through the unified ws.pivots.* API.
 * Config change notifications come from EventBus pivot events.
 * Result computation notifications use pivotBridge.subscribe (ephemeral).
 */
export function usePivotTables({ sheetId }: UsePivotTablesOptions): UsePivotTablesReturn {
  const wb = useWorkbook();
  const eventBus = useEventBus();

  // Get the worksheet for the current sheet to access ws.pivots.*
  const ws = useMemo(() => wb.getSheetById(sheetId), [wb, sheetId]);

  // PivotBridge is still needed for result subscription (subscribe callback pattern)
  // which has no equivalent in the ws.pivots API.
  const pivotBridge = wb.pivot;

  // Get selection/editing state from UI store (shared across components)
  const selectedPivotId = useSelectedPivotId();
  const editingPivotId = useEditingPivotId();
  const selectPivotAction = useUIStore((s) => s.selectPivot);
  const startEditingPivotAction = useUIStore((s) => s.startEditingPivot);
  const stopEditingPivotAction = useUIStore((s) => s.stopEditingPivot);

  // Local state for pivot configs and results
  const [configs, setConfigs] = useState<PivotTableConfig[]>([]);

  /** Resolve a pivot ID to its name (for the name-based public API). */
  const pivotNameFromId = useCallback(
    (pivotId: string): string => {
      const cfg = configs.find((c) => c.id === pivotId);
      return cfg?.name ?? pivotId;
    },
    [configs],
  );
  const [results, setResults] = useState<
    Map<string, { result: PivotTableResult | null; error?: string }>
  >(new Map());

  // Load configs via ws.pivots and subscribe to EventBus pivot events
  useEffect(() => {
    let cancelled = false;

    // Async initial load via unified API
    const loadConfigs = async () => {
      try {
        await ws.pivots.list();
        if (cancelled) return;
        // list() returns PivotTableInfo[], but we need full configs.
        // Use getAllPivots via the bridge for the full configs.
        const allConfigs = await pivotBridge.getAllPivots(sheetId);
        const importedPivotRuntime = (wb as WorkbookWithImportedPivots).importedPivots;
        const importedConfigs = importedPivotRuntime
          ? await Promise.all(
              (await importedPivotRuntime.getRenderedImportedPivots(sheetId)).map((pivot) =>
                importedPivotRuntime.getRenderedImportedPivotConfig(sheetId, pivot.id),
              ),
            )
          : [];
        if (cancelled) return;
        setConfigs([
          ...allConfigs,
          ...importedConfigs.filter((config): config is PivotTableConfig => config != null),
        ]);
      } catch {
        if (!cancelled) setConfigs([]);
      }
    };

    void loadConfigs();

    // Subscribe to pivot lifecycle events to refresh configs
    const refreshConfigs = () => {
      void loadConfigs();
    };

    const unsubCreated = eventBus.on<PivotCreatedEvent>('pivot:created', (event) => {
      if (event.outputSheetId === sheetId || event.sheetId === sheetId) {
        refreshConfigs();
      }
    });
    const unsubUpdated = eventBus.on<PivotUpdatedEvent>('pivot:updated', (event) => {
      if (event.outputSheetId === sheetId || event.sheetId === sheetId) {
        refreshConfigs();
      }
    });
    const unsubDeleted = eventBus.on<PivotDeletedEvent>('pivot:deleted', (event) => {
      if (event.outputSheetId === sheetId || event.sheetId === sheetId) {
        refreshConfigs();
      }
    });

    return () => {
      cancelled = true;
      unsubCreated();
      unsubUpdated();
      unsubDeleted();
    };
  }, [sheetId, ws, pivotBridge, eventBus, wb]);

  // Compute results when configs change
  useEffect(() => {
    const unsubscribes: Array<() => void> = [];
    let cancelled = false;

    // Subscribe to result updates and compute initial results
    const initResults = async () => {
      const newResults = new Map<string, { result: PivotTableResult | null; error?: string }>();

      for (const config of configs) {
        if (config.id.startsWith('imported:')) {
          const imported = await (
            wb as WorkbookWithImportedPivots
          ).importedPivots?.getRenderedImportedPivotWithResult(sheetId, config.id);
          if (cancelled) return;
          newResults.set(config.id, { result: imported?.result ?? null });
          continue;
        }

        // Subscribe to result updates for each pivot (ephemeral computation cache)
        const unsubscribe = pivotBridge.subscribe(config.id, (pivotId, result, error) => {
          setResults((prev) => {
            const next = new Map(prev);
            next.set(pivotId, { result, error });
            return next;
          });
        });
        unsubscribes.push(unsubscribe);

        // Compute initial result via ws.pivots
        const result = await ws.pivots.compute(config.name);
        if (cancelled) return;
        newResults.set(config.id, { result });
      }

      if (!cancelled) {
        setResults(newResults);
      }
    };

    void initResults();

    // Cleanup subscriptions
    return () => {
      cancelled = true;
      unsubscribes.forEach((unsub) => unsub());
    };
  }, [configs, ws, pivotBridge, wb, sheetId]);

  // Combine configs with results
  const pivotTables = useMemo<PivotTableWithResult[]>(() => {
    return configs.map((config) => {
      const resultEntry = results.get(config.id);
      return {
        config,
        result: resultEntry?.result ?? null,
        error: resultEntry?.error,
      };
    });
  }, [configs, results]);

  /**
   * Create pivot table with location selection support.
   *
   * Implements atomic undo for "New Worksheet" mode via ws.pivots.addWithSheet().
   */
  const createPivotTable = useCallback(
    async (
      name: string,
      sourceRange: CellRange,
      sourceSheetId: SheetId = sheetId,
      outputLocation?: PivotOutputLocation,
    ): Promise<{ config: PivotTableConfig; outputSheetId: SheetId }> => {
      // Detect fields from source data via ws.pivots
      const fields = await ws.pivots.detectFields(sourceSheetId, sourceRange);
      const sourceSheetName = await wb.getSheetById(sourceSheetId).getName();
      const placements: PivotFieldPlacement[] = [];
      const filters: PivotFilter[] = [];

      // Default to new worksheet if no location specified
      const location = outputLocation ?? { mode: 'newWorksheet' };

      // Common config without output location (will be set based on mode)
      const baseConfig = {
        name,
        sourceSheetId,
        sourceSheetName,
        sourceRange,
        fields,
        placements,
        filters,
        layout: {
          showRowGrandTotals: true,
          showColumnGrandTotals: true,
          layoutForm: 'compact' as const,
        },
      };

      if (location.mode === 'newWorksheet') {
        // =====================================================================
        // NEW WORKSHEET MODE — Atomic sheet + pivot creation
        // =====================================================================
        const existingNames = new Set<string>(wb.sheetNames);
        const sheetName = getUniqueSheetName(name, existingNames);

        // Use the atomic addWithSheet method for undo atomicity
        const result = await ws.pivots.addWithSheet(sheetName, {
          ...baseConfig,
          outputSheetName: sheetName,
          outputLocation: { row: 0, col: 0 },
        });
        const outputSheetId = toSheetId(result.sheetId);
        await wb.getSheetById(outputSheetId).pivots.refresh(result.config.name);

        return {
          config: result.config,
          outputSheetId,
        };
      } else {
        // =====================================================================
        // EXISTING WORKSHEET MODE
        // =====================================================================
        const targetSheetId = location.sheetId ?? sheetId;
        const targetCell = location.cell ?? { row: 0, col: 0 };

        // Validate that target sheet exists via Workbook API. `sheetNames` are
        // display names, not ids; use the ordered sheet handles for identity.
        const allSheets = await wb.getSheets();
        const allSheetIds = allSheets.map((sheet) => sheet.getSheetId());
        if (!allSheetIds.includes(targetSheetId)) {
          throw new Error(`Target sheet "${targetSheetId}" does not exist`);
        }

        // Create pivot on the target sheet via ws.pivots
        const targetWs = wb.getSheetById(targetSheetId);
        const targetSheetName = await targetWs.getName();
        const config = await targetWs.pivots.add({
          ...baseConfig,
          outputSheetName: targetSheetName,
          outputLocation: targetCell,
        });
        await targetWs.pivots.refresh(config.name);

        return {
          config,
          outputSheetId: targetSheetId,
        };
      }
    },
    [wb, ws, sheetId],
  );

  // Detect fields via ws.pivots
  const detectFields = useCallback(
    async (sourceRange: CellRange, sourceSheetId: SheetId = sheetId): Promise<PivotField[]> => {
      return ws.pivots.detectFields(sourceSheetId, sourceRange);
    },
    [sheetId, ws],
  );

  // Update pivot table via ws.pivots (fire-and-forget async)
  const updatePivotTable = useCallback(
    (pivotId: string, updates: Partial<Omit<PivotTableConfig, 'id' | 'createdAt'>>) => {
      // Find the pivot name to get a handle, or use the bridge directly
      // Since ws.pivots operations are by pivotId for field operations,
      // we use the bridge's updatePivot which operates by ID
      void pivotBridge.updatePivot(sheetId, pivotId, updates, {
        reason: 'uiConfigChanged',
        refreshPolicy: 'refreshAndMaterialize',
      });
    },
    [sheetId, pivotBridge],
  );

  // Delete pivot table via ws.pivots (fire-and-forget async)
  const deletePivotTable = useCallback(
    (pivotId: string) => {
      void pivotBridge.deletePivot(sheetId, pivotId);

      // Clear selection if deleted pivot was selected
      if (selectedPivotId === pivotId) {
        selectPivotAction(null);
      }
      if (editingPivotId === pivotId) {
        stopEditingPivotAction();
      }
    },
    [
      sheetId,
      pivotBridge,
      selectedPivotId,
      editingPivotId,
      selectPivotAction,
      stopEditingPivotAction,
    ],
  );

  // Add field to area via ws.pivots (fire-and-forget async)
  const addFieldToArea = useCallback(
    (
      pivotId: string,
      fieldId: string,
      area: PivotFieldArea,
      options?: {
        position?: number;
        aggregateFunction?: AggregateFunction;
        sortOrder?: SortOrder;
        displayName?: string;
      },
    ) => {
      void ws.pivots.addField(pivotNameFromId(pivotId), fieldId, area, options);
    },
    [ws, pivotNameFromId],
  );

  // Remove field from area via ws.pivots (fire-and-forget async)
  const removeFieldFromArea = useCallback(
    (pivotId: string, fieldId: string, area: PivotFieldArea) => {
      void ws.pivots.removeField(pivotNameFromId(pivotId), fieldId, area);
    },
    [ws, pivotNameFromId],
  );

  // Move field via ws.pivots (fire-and-forget async)
  const moveField = useCallback(
    (
      pivotId: string,
      fieldId: string,
      fromArea: PivotFieldArea,
      toArea: PivotFieldArea,
      toPosition: number,
    ) => {
      void ws.pivots.moveField(pivotNameFromId(pivotId), fieldId, fromArea, toArea, toPosition);
    },
    [ws, pivotNameFromId],
  );

  // Set aggregate function via ws.pivots (fire-and-forget async)
  const setAggregateFunction = useCallback(
    (pivotId: string, fieldId: string, aggregateFunction: AggregateFunction) => {
      void ws.pivots.setAggregateFunction(pivotNameFromId(pivotId), fieldId, aggregateFunction);
    },
    [ws, pivotNameFromId],
  );

  // Set sort order via ws.pivots (fire-and-forget async)
  const setSortOrder = useCallback(
    (pivotId: string, fieldId: string, sortOrder: SortOrder) => {
      void ws.pivots.setSortOrder(pivotNameFromId(pivotId), fieldId, sortOrder);
    },
    [ws, pivotNameFromId],
  );

  // Set filter via ws.pivots (fire-and-forget async)
  const setFilter = useCallback(
    (pivotId: string, fieldId: string, filter: Omit<PivotFilter, 'fieldId'>) => {
      void ws.pivots.setFilter(pivotNameFromId(pivotId), fieldId, filter);
    },
    [ws, pivotNameFromId],
  );

  // Remove filter via ws.pivots (fire-and-forget async)
  const removeFilter = useCallback(
    (pivotId: string, fieldId: string) => {
      void ws.pivots.removeFilter(pivotNameFromId(pivotId), fieldId);
    },
    [ws, pivotNameFromId],
  );

  // Set layout via ws.pivots (fire-and-forget async)
  const setLayout = useCallback(
    (pivotId: string, layout: Partial<PivotTableLayout>) => {
      void ws.pivots.setLayout(pivotNameFromId(pivotId), layout);
    },
    [ws, pivotNameFromId],
  );

  // Set style via ws.pivots (fire-and-forget async)
  const setStyle = useCallback(
    (pivotId: string, style: Partial<PivotTableStyle>) => {
      void ws.pivots.setStyle(pivotNameFromId(pivotId), style);
    },
    [ws, pivotNameFromId],
  );

  // Toggle row expanded via ws.pivots (fire-and-forget async, return true as default)
  const toggleRowExpanded = useCallback(
    (pivotId: string, headerKey: string): boolean => {
      // ws.pivots.toggleExpanded is async; fire-and-forget, return optimistic default
      void ws.pivots.toggleExpanded(pivotNameFromId(pivotId), headerKey, true);
      return true;
    },
    [ws, pivotNameFromId],
  );

  // Toggle column expanded via ws.pivots (fire-and-forget async, return true as default)
  const toggleColumnExpanded = useCallback(
    (pivotId: string, headerKey: string): boolean => {
      void ws.pivots.toggleExpanded(pivotNameFromId(pivotId), headerKey, false);
      return true;
    },
    [ws, pivotNameFromId],
  );

  // Set all expanded via ws.pivots (fire-and-forget async)
  const setAllExpanded = useCallback(
    (pivotId: string, expanded: boolean) => {
      void ws.pivots.setAllExpanded(pivotNameFromId(pivotId), expanded);
    },
    [ws, pivotNameFromId],
  );

  // Refresh pivot table via ws.pivots (fire-and-forget async)
  const refreshPivotTable = useCallback(
    (pivotId: string) => {
      void ws.pivots.refresh(pivotNameFromId(pivotId));
    },
    [ws, pivotNameFromId],
  );

  // Get drill-down data via ws.pivots
  const getDrillDownData = useCallback(
    (
      pivotId: string,
      rowKey: string,
      columnKey: string,
    ): Promise<import('@mog-sdk/contracts').CellValue[][]> => {
      return ws.pivots.getDrillDownData(pivotNameFromId(pivotId), rowKey, columnKey);
    },
    [ws, pivotNameFromId],
  );

  // Select pivot - delegates to UI store
  const selectPivot = useCallback(
    (pivotId: string | null) => {
      selectPivotAction(pivotId);
    },
    [selectPivotAction],
  );

  // Start editing pivot - delegates to UI store
  const startEditingPivot = useCallback(
    (pivotId: string) => {
      startEditingPivotAction(pivotId);
    },
    [startEditingPivotAction],
  );

  // Stop editing pivot - delegates to UI store
  const stopEditingPivot = useCallback(() => {
    stopEditingPivotAction();
  }, [stopEditingPivotAction]);

  return {
    pivotTables,
    selectedPivotId,
    editingPivotId,
    createPivotTable,
    detectFields,
    updatePivotTable,
    deletePivotTable,
    addFieldToArea,
    removeFieldFromArea,
    moveField,
    setAggregateFunction,
    setSortOrder,
    setFilter,
    removeFilter,
    setLayout,
    setStyle,
    toggleRowExpanded,
    toggleColumnExpanded,
    setAllExpanded,
    refreshPivotTable,
    getDrillDownData,
    selectPivot,
    startEditingPivot,
    stopEditingPivot,
  };
}

// Re-export types for convenience
export type { PivotField, PivotFieldArea, PivotTableConfig, PivotTableResult };
