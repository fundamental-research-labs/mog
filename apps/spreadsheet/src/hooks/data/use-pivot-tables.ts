/**
 * usePivotTables Hook
 *
 * Manages pivot table state for the spreadsheet.
 *
 * State architecture:
 * - ws.pivots.*: Unified API for all pivot CRUD and computation
 * - PivotTableHandle.subscribeResult: Result notification callbacks (ephemeral computation cache)
 * - EventBus: Config change notifications (pivot:created, pivot:updated, pivot:deleted)
 * - Local state: Computed results (derived from worksheet API)
 *
 * @module hooks/use-pivot-tables
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { PivotHandlePlacementSpec, PivotValueSortConfig } from '@mog-sdk/contracts/api';
import { type CellRange, type SheetId, sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type {
  AggregateFunction,
  PlacementId,
  PivotField,
  PivotFieldArea,
  PivotFieldPlacementFlat as PivotFieldPlacement,
  PivotFilter,
  PivotTableConfig,
  PivotTableLayout,
  PivotTableResult,
  PivotTableStyle,
  ShowValuesAsConfig,
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
import type { PivotViewModel } from '../../pivot/pivot-capabilities';
import { loadPivotConfigEntries, type PivotConfigEntry } from '../../pivot/pivot-view-records';

interface WorkbookWithPivotMaterialization {
  readonly ctx?: {
    awaitMaterialized?: (scope?: SheetId | 'allSheets') => Promise<void>;
  };
}

function pivotEntryMatchesId(entry: PivotConfigEntry, pivotId: string): boolean {
  return entry.config.id === pivotId || entry.alternateIds?.includes(pivotId) === true;
}

async function awaitPivotMaterialization(workbook: unknown): Promise<void> {
  const awaitMaterialized = (workbook as WorkbookWithPivotMaterialization).ctx?.awaitMaterialized;
  if (typeof awaitMaterialized !== 'function') return;
  await awaitMaterialized('allSheets');
}

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
  pivotTables: PivotViewModel[];

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

  /** Add a source field as a placement at a specific position */
  addPlacement: (pivotId: string, spec: PivotHandlePlacementSpec) => void;

  /** Remove a field from an area */
  removeFieldFromArea: (pivotId: string, fieldId: string, area: PivotFieldArea) => void;

  /** Remove a specific placement */
  removePlacement: (pivotId: string, placementId: PlacementId) => void;

  /** Move a field to a different area or position */
  moveField: (
    pivotId: string,
    fieldId: string,
    fromArea: PivotFieldArea,
    toArea: PivotFieldArea,
    toPosition: number,
  ) => void;

  /** Move a specific placement to a different area or position */
  movePlacement: (
    pivotId: string,
    placementId: PlacementId,
    toArea: PivotFieldArea,
    toPosition: number,
  ) => void;

  /** Set aggregation function for a value field */
  setAggregateFunction: (
    pivotId: string,
    fieldId: string,
    aggregateFunction: AggregateFunction,
  ) => void;

  /** Set aggregation function for a specific value placement */
  setPlacementAggregateFunction: (
    pivotId: string,
    placementId: PlacementId,
    aggregateFunction: AggregateFunction,
  ) => void;

  /** Set show-values-as calculation for a value placement */
  setShowValuesAs: (
    pivotId: string,
    fieldId: string,
    showValuesAs: ShowValuesAsConfig | null,
  ) => void;

  /** Set sort order for a row/column field */
  setSortOrder: (pivotId: string, fieldId: string, sortOrder: SortOrder) => void;

  /** Set sort order for a specific row/column placement */
  setPlacementSortOrder: (
    pivotId: string,
    placementId: PlacementId,
    sortOrder: SortOrder | null,
  ) => void;

  /** Set value sorting on a specific row/column axis placement */
  setSortByValue: (
    pivotId: string,
    axisPlacementId: PlacementId,
    valuePlacementId: PlacementId,
    config: PivotValueSortConfig | null,
  ) => void;

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
 * Result computation notifications use ws.pivots.subscribeResult (ephemeral).
 */
export function usePivotTables({ sheetId }: UsePivotTablesOptions): UsePivotTablesReturn {
  const wb = useWorkbook();
  const eventBus = useEventBus();

  // Get the worksheet for the current sheet to access ws.pivots.*
  const ws = useMemo(() => wb.getSheetById(sheetId), [wb, sheetId]);

  // Get selection/editing state from UI store (shared across components)
  const selectedPivotId = useSelectedPivotId();
  const editingPivotId = useEditingPivotId();
  const selectPivotAction = useUIStore((s) => s.selectPivot);
  const startEditingPivotAction = useUIStore((s) => s.startEditingPivot);
  const stopEditingPivotAction = useUIStore((s) => s.stopEditingPivot);

  // Local state for pivot configs and results
  const [pivotEntries, setPivotEntries] = useState<PivotConfigEntry[]>([]);
  const editingMissReloadKeyRef = useRef<string | null>(null);
  const loadPivotEntries = useCallback(() => loadPivotConfigEntries(wb, sheetId), [wb, sheetId]);

  const pivotConfigFromId = useCallback(
    (pivotId: string): PivotTableConfig | null =>
      pivotEntries.find((entry) => entry.config.id === pivotId)?.config ?? null,
    [pivotEntries],
  );
  const pivotHandleFromId = useCallback(
    (pivotId: string) => pivotEntries.find((entry) => entry.config.id === pivotId)?.handle ?? null,
    [pivotEntries],
  );
  const placementForField = useCallback(
    (
      pivotId: string,
      fieldOrPlacementId: string,
      area?: PivotFieldArea,
    ): PivotFieldPlacement | null => {
      const config = pivotConfigFromId(pivotId);
      if (!config) return null;
      return (
        config.placements.find((placement) => placement.placementId === fieldOrPlacementId) ??
        config.placements.find(
          (placement) =>
            placement.fieldId === fieldOrPlacementId && (area == null || placement.area === area),
        ) ??
        null
      );
    },
    [pivotConfigFromId],
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
        if (cancelled) return;
        const entries = await loadPivotEntries();
        if (cancelled) return;
        setPivotEntries(entries);
      } catch {
        if (!cancelled) setPivotEntries([]);
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
  }, [sheetId, ws, eventBus, loadPivotEntries]);

  // Imported PivotTables can be materialized by the active selection path without
  // emitting a native pivot lifecycle event, so refresh once when the editor is
  // targeting an id that the current local config list does not yet contain.
  useEffect(() => {
    if (!editingPivotId) {
      editingMissReloadKeyRef.current = null;
      return;
    }

    if (pivotEntries.some((entry) => pivotEntryMatchesId(entry, editingPivotId))) {
      editingMissReloadKeyRef.current = null;
      return;
    }

    const reloadKey = `${sheetId}:${editingPivotId}`;
    if (editingMissReloadKeyRef.current === reloadKey) return;
    editingMissReloadKeyRef.current = reloadKey;

    let cancelled = false;
    const refreshMaterializedConfigs = async () => {
      try {
        const entries = await loadPivotEntries();
        if (cancelled) return;
        setPivotEntries(entries);
        if (entries.some((entry) => pivotEntryMatchesId(entry, editingPivotId))) {
          return;
        }
      } catch {
        // Fall through to the materialization-backed retry below.
      }

      try {
        await awaitPivotMaterialization(wb);
      } catch {
        // Materialization failures should not hide any already-available sidecar
        // or persisted imported pivot records.
      }

      try {
        const entries = await loadPivotEntries();
        if (!cancelled) setPivotEntries(entries);
      } catch {
        if (!cancelled) setPivotEntries([]);
      }
    };

    void refreshMaterializedConfigs();

    return () => {
      cancelled = true;
    };
  }, [editingPivotId, loadPivotEntries, pivotEntries, sheetId, wb]);

  // Compute results when configs change
  useEffect(() => {
    const unsubscribes: Array<() => void> = [];
    let cancelled = false;

    // Subscribe to result updates and compute initial results
    const initResults = async () => {
      const newResults = new Map<string, { result: PivotTableResult | null; error?: string }>();

      for (const entry of pivotEntries) {
        const { config } = entry;
        if (entry.sourceKind === 'unsupportedImport') {
          if (entry.result !== undefined) {
            newResults.set(config.id, { result: entry.result });
            continue;
          }
          const imported = await (
            wb as WorkbookWithImportedPivots
          ).importedPivots?.getRenderedImportedPivotWithResult(sheetId, config.id);
          if (cancelled) return;
          newResults.set(config.id, { result: imported?.result ?? null });
          continue;
        }

        if (!entry.handle) continue;
        const unsubscribe = entry.handle.subscribeResult((result, error) => {
          setResults((prev) => {
            const next = new Map(prev);
            next.set(config.id, { result, error });
            return next;
          });
        });
        unsubscribes.push(unsubscribe);

        const result = await entry.handle.compute();
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
  }, [pivotEntries, ws, wb, sheetId]);

  // Combine configs with results
  const pivotTables = useMemo<PivotViewModel[]>(() => {
    return pivotEntries.map((entry) => {
      const { config } = entry;
      const resultEntry = results.get(config.id);
      return {
        config,
        result: resultEntry?.result ?? null,
        error: resultEntry?.error,
        sourceKind: entry.sourceKind,
        importIdentity: entry.importIdentity,
        alternateIds: entry.alternateIds,
        capabilities: entry.capabilities,
        handle: entry.handle,
      };
    });
  }, [pivotEntries, results]);

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
        const handle = await wb.getSheetById(outputSheetId).pivots.get(result.config);
        await handle?.refresh();

        return {
          config: { ...result.config, outputSheetId },
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
          outputSheetId: targetSheetId,
          outputSheetName: targetSheetName,
          outputLocation: targetCell,
        });
        const handle = await targetWs.pivots.get(config);
        await handle?.refresh();

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
      void pivotHandleFromId(pivotId)?.update(updates);
    },
    [pivotHandleFromId],
  );

  // Delete pivot table via ws.pivots (fire-and-forget async)
  const deletePivotTable = useCallback(
    (pivotId: string) => {
      void pivotHandleFromId(pivotId)?.delete();

      // Clear selection if deleted pivot was selected
      if (selectedPivotId === pivotId) {
        selectPivotAction(null);
      }
      if (editingPivotId === pivotId) {
        stopEditingPivotAction();
      }
    },
    [pivotHandleFromId, selectedPivotId, editingPivotId, selectPivotAction, stopEditingPivotAction],
  );

  // Add field to area via the pivot handle.
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
      const handle = pivotHandleFromId(pivotId);
      if (!handle) return;
      if (area === 'value') {
        void handle.addValueField(
          fieldId,
          (options?.aggregateFunction ?? 'sum') as 'sum' | 'count' | 'average' | 'max' | 'min',
          options?.displayName,
        );
      } else {
        void handle.addField(fieldId, area, options?.position);
      }
    },
    [pivotHandleFromId],
  );

  // Add a field as a placement at a specific position.
  const addPlacement = useCallback(
    (pivotId: string, spec: PivotHandlePlacementSpec) => {
      void pivotHandleFromId(pivotId)?.addPlacement(spec);
    },
    [pivotHandleFromId],
  );

  // Remove field from area via the pivot handle.
  const removeFieldFromArea = useCallback(
    (pivotId: string, fieldId: string, area: PivotFieldArea) => {
      const placement = placementForField(pivotId, fieldId, area);
      if (!placement) return;
      void pivotHandleFromId(pivotId)?.removeField(fieldId, area);
    },
    [pivotHandleFromId, placementForField],
  );

  // Remove a specific placement by placementId.
  const removePlacement = useCallback(
    (pivotId: string, placementId: PlacementId) => {
      void pivotHandleFromId(pivotId)?.removePlacement(placementId);
    },
    [pivotHandleFromId],
  );

  // Move field via the pivot handle.
  const moveField = useCallback(
    (
      pivotId: string,
      fieldId: string,
      fromArea: PivotFieldArea,
      toArea: PivotFieldArea,
      toPosition: number,
    ) => {
      const placement = placementForField(pivotId, fieldId, fromArea);
      if (!placement) return;
      void pivotHandleFromId(pivotId)?.moveField(fieldId, fromArea, toArea, toPosition);
    },
    [pivotHandleFromId, placementForField],
  );

  // Move a specific placement by placementId.
  const movePlacement = useCallback(
    (pivotId: string, placementId: PlacementId, toArea: PivotFieldArea, toPosition: number) => {
      void pivotHandleFromId(pivotId)?.movePlacement(placementId, toArea, toPosition);
    },
    [pivotHandleFromId],
  );

  // Set aggregate function via the pivot handle.
  const setAggregateFunction = useCallback(
    (pivotId: string, fieldOrPlacementId: string, aggregateFunction: AggregateFunction) => {
      void pivotHandleFromId(pivotId)?.changeAggregation(
        fieldOrPlacementId,
        aggregateFunction as 'sum' | 'count' | 'average' | 'max' | 'min',
      );
    },
    [pivotHandleFromId],
  );

  // Set aggregate function for a specific value placement.
  const setPlacementAggregateFunction = useCallback(
    (pivotId: string, placementId: PlacementId, aggregateFunction: AggregateFunction) => {
      void pivotHandleFromId(pivotId)?.setPlacementAggregateFunction(
        placementId,
        aggregateFunction,
      );
    },
    [pivotHandleFromId],
  );

  // Set show-values-as via the pivot handle.
  const setShowValuesAs = useCallback(
    (pivotId: string, fieldOrPlacementId: string, showValuesAs: ShowValuesAsConfig | null) => {
      void pivotHandleFromId(pivotId)?.setShowValuesAs(fieldOrPlacementId, showValuesAs);
    },
    [pivotHandleFromId],
  );

  // Set sort order via the pivot handle.
  const setSortOrder = useCallback(
    (pivotId: string, fieldId: string, sortOrder: SortOrder) => {
      void pivotHandleFromId(pivotId)?.setSortOrder(fieldId, sortOrder);
    },
    [pivotHandleFromId],
  );

  // Set row/column label sort for a specific placement.
  const setPlacementSortOrder = useCallback(
    (pivotId: string, placementId: PlacementId, sortOrder: SortOrder | null) => {
      void pivotHandleFromId(pivotId)?.setPlacementSortOrder(placementId, sortOrder);
    },
    [pivotHandleFromId],
  );

  // Set value sorting on a specific axis placement.
  const setSortByValue = useCallback(
    (
      pivotId: string,
      axisPlacementId: PlacementId,
      valuePlacementId: PlacementId,
      valueSortConfig: PivotValueSortConfig | null,
    ) => {
      void pivotHandleFromId(pivotId)?.setSortByValue(
        axisPlacementId,
        valuePlacementId,
        valueSortConfig,
      );
    },
    [pivotHandleFromId],
  );

  // Set filter via the pivot handle.
  const setFilter = useCallback(
    (pivotId: string, fieldId: string, filter: Omit<PivotFilter, 'fieldId'>) => {
      const config = pivotConfigFromId(pivotId);
      if (!config) return;
      void pivotHandleFromId(pivotId)?.setFilter(fieldId, filter);
    },
    [pivotHandleFromId, pivotConfigFromId],
  );

  // Remove filter via the pivot handle.
  const removeFilter = useCallback(
    (pivotId: string, fieldId: string) => {
      const config = pivotConfigFromId(pivotId);
      if (!config) return;
      void pivotHandleFromId(pivotId)?.removeFilter(fieldId);
    },
    [pivotHandleFromId, pivotConfigFromId],
  );

  // Set layout via the pivot handle.
  const setLayout = useCallback(
    (pivotId: string, layout: Partial<PivotTableLayout>) => {
      const config = pivotConfigFromId(pivotId);
      if (!config) return;
      void pivotHandleFromId(pivotId)?.setLayout(layout);
    },
    [pivotHandleFromId, pivotConfigFromId],
  );

  // Set style via the pivot handle.
  const setStyle = useCallback(
    (pivotId: string, style: Partial<PivotTableStyle>) => {
      const config = pivotConfigFromId(pivotId);
      if (!config) return;
      void pivotHandleFromId(pivotId)?.setStyle(style);
    },
    [pivotHandleFromId, pivotConfigFromId],
  );

  // Toggle row expanded via ws.pivots (fire-and-forget async, return true as default)
  const toggleRowExpanded = useCallback(
    (pivotId: string, headerKey: string): boolean => {
      void pivotHandleFromId(pivotId)?.toggleExpanded(headerKey, true);
      return true;
    },
    [pivotHandleFromId],
  );

  // Toggle column expanded via ws.pivots (fire-and-forget async, return true as default)
  const toggleColumnExpanded = useCallback(
    (pivotId: string, headerKey: string): boolean => {
      void pivotHandleFromId(pivotId)?.toggleExpanded(headerKey, false);
      return true;
    },
    [pivotHandleFromId],
  );

  // Set all expanded via ws.pivots (fire-and-forget async)
  const setAllExpanded = useCallback(
    (pivotId: string, expanded: boolean) => {
      void pivotHandleFromId(pivotId)?.setAllExpanded(expanded);
    },
    [pivotHandleFromId],
  );

  // Refresh pivot table via ws.pivots (fire-and-forget async)
  const refreshPivotTable = useCallback(
    (pivotId: string) => {
      void pivotHandleFromId(pivotId)?.refresh();
    },
    [pivotHandleFromId],
  );

  // Get drill-down data via ws.pivots
  const getDrillDownData = useCallback(
    (
      pivotId: string,
      rowKey: string,
      columnKey: string,
    ): Promise<import('@mog-sdk/contracts').CellValue[][]> => {
      return pivotHandleFromId(pivotId)?.getDrillDownData(rowKey, columnKey) ?? Promise.resolve([]);
    },
    [pivotHandleFromId],
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
    addPlacement,
    removeFieldFromArea,
    removePlacement,
    moveField,
    movePlacement,
    setAggregateFunction,
    setPlacementAggregateFunction,
    setShowValuesAs,
    setSortOrder,
    setPlacementSortOrder,
    setSortByValue,
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
