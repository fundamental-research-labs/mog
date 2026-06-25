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

import { useCallback, useEffect, useMemo, useState } from 'react';

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
import { type PivotMutationOperation, usePivotMutationQueue } from './pivot-mutation-queue';
import {
  assertPivotMaterialized,
  inspectPivotMutationReceipt,
  pivotReceiptMessage,
  warnPivotRefresh,
} from './pivot-receipt-utils';
import { usePivotInteractionLifecycle } from './use-pivot-interaction-lifecycle';

function pivotEntryMatchesId(entry: PivotConfigEntry, pivotId: string): boolean {
  return entry.config.id === pivotId || entry.alternateIds?.includes(pivotId) === true;
}

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
  const [loadedPivotEntriesSheetId, setLoadedPivotEntriesSheetId] = useState<string | null>(null);
  const loadPivotEntries = useCallback(() => loadPivotConfigEntries(wb, sheetId), [wb, sheetId]);
  const enqueuePivotMutation = usePivotMutationQueue();
  const hasLoadedPivotEntries = loadedPivotEntriesSheetId === sheetId;

  const pivotConfigFromId = useCallback(
    (pivotId: string): PivotTableConfig | null =>
      pivotEntries.find((entry) => pivotEntryMatchesId(entry, pivotId))?.config ?? null,
    [pivotEntries],
  );
  const pivotHandleFromId = useCallback(
    (pivotId: string) =>
      pivotEntries.find((entry) => pivotEntryMatchesId(entry, pivotId))?.handle ?? null,
    [pivotEntries],
  );
  const canonicalPivotIdFromId = useCallback(
    (pivotId: string): string => pivotConfigFromId(pivotId)?.id ?? pivotId,
    [pivotConfigFromId],
  );
  const enqueueCanonicalPivotMutation = useCallback(
    (pivotId: string, operationName: string, operation: PivotMutationOperation): Promise<void> =>
      enqueuePivotMutation(canonicalPivotIdFromId(pivotId), operationName, operation),
    [canonicalPivotIdFromId, enqueuePivotMutation],
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
    setPivotEntries([]);
    setResults(new Map());
    setLoadedPivotEntriesSheetId(null);

    // Async initial load via unified API
    const loadConfigs = async () => {
      try {
        if (cancelled) return;
        const entries = await loadPivotEntries();
        if (cancelled) return;
        setPivotEntries(entries);
        setLoadedPivotEntriesSheetId(sheetId);
      } catch {
        if (!cancelled) {
          setPivotEntries([]);
          setLoadedPivotEntriesSheetId(sheetId);
        }
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
  }, [sheetId, eventBus, loadPivotEntries]);

  usePivotInteractionLifecycle({
    sheetId,
    wb,
    selectedPivotId,
    editingPivotId,
    pivotEntries,
    hasLoadedPivotEntries,
    loadPivotEntries,
    setPivotEntries,
    selectPivot: selectPivotAction,
    startEditingPivot: startEditingPivotAction,
    stopEditingPivot: stopEditingPivotAction,
  });

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
          layoutForm: 'outline' as const,
        },
      };

      if (location.mode === 'newWorksheet') {
        // =====================================================================
        // NEW WORKSHEET MODE — Atomic sheet + pivot creation
        // =====================================================================
        const existingNames = new Set<string>(wb.sheetNames);
        const sheetName = getUniqueSheetName(name, existingNames);

        // Use the atomic addWithSheet method for undo atomicity
        const receipt = await ws.pivots.addWithSheet(
          sheetName,
          {
            ...baseConfig,
            outputSheetName: sheetName,
            outputLocation: { row: 0, col: 0 },
          },
          { lifecycle: 'materialize', insertBeforeSheetId: sourceSheetId },
        );
        assertPivotMaterialized(receipt);
        const outputSheetId = toSheetId(receipt.sheetId);

        return {
          config: { ...receipt.config, outputSheetId },
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

        // Create pivot on the target sheet via ws.pivots.
        const targetWs = wb.getSheetById(targetSheetId);
        const targetSheetName = await targetWs.getName();
        const receipt = await targetWs.pivots.add(
          {
            ...baseConfig,
            outputSheetId: targetSheetId,
            outputSheetName: targetSheetName,
            outputLocation: targetCell,
          },
          { lifecycle: 'materialize' },
        );
        assertPivotMaterialized(receipt);
        const config = receipt.config;

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
      void enqueueCanonicalPivotMutation(pivotId, 'update', () =>
        pivotHandleFromId(pivotId)?.update(updates),
      );
    },
    [enqueueCanonicalPivotMutation, pivotHandleFromId],
  );

  // Delete pivot table via ws.pivots (fire-and-forget async)
  const deletePivotTable = useCallback(
    (pivotId: string) => {
      const deletedPivotId = canonicalPivotIdFromId(pivotId);
      const deleteMutation = pivotHandleFromId(pivotId)?.delete();
      if (!deleteMutation) return;
      void deleteMutation
        .then((receipt) => {
          if (receipt.status !== 'applied' || receipt.deleted === false) {
            console.warn(pivotReceiptMessage(receipt), receipt);
            return;
          }

          // Clear selection if deleted pivot was selected
          if (
            selectedPivotId != null &&
            pivotConfigFromId(selectedPivotId)?.id === deletedPivotId
          ) {
            selectPivotAction(null);
          }
          if (editingPivotId != null && pivotConfigFromId(editingPivotId)?.id === deletedPivotId) {
            stopEditingPivotAction();
          }
        })
        .catch((error) =>
          console.warn(
            `Pivot delete failed: ${error instanceof Error ? error.message : String(error)}`,
            error,
          ),
        );
    },
    [
      canonicalPivotIdFromId,
      pivotConfigFromId,
      pivotHandleFromId,
      selectedPivotId,
      editingPivotId,
      selectPivotAction,
      stopEditingPivotAction,
    ],
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
      void enqueueCanonicalPivotMutation(pivotId, 'add field', () => {
        const handle = pivotHandleFromId(pivotId);
        if (!handle) return null;
        if (area === 'value') {
          return handle.addValueField(
            fieldId,
            (options?.aggregateFunction ?? 'sum') as 'sum' | 'count' | 'average' | 'max' | 'min',
            options?.displayName,
          );
        }
        return handle.addField(fieldId, area, options?.position);
      });
    },
    [enqueueCanonicalPivotMutation, pivotHandleFromId],
  );

  // Add a field as a placement at a specific position.
  const addPlacement = useCallback(
    (pivotId: string, spec: PivotHandlePlacementSpec) => {
      void enqueueCanonicalPivotMutation(pivotId, 'add placement', () =>
        inspectPivotMutationReceipt(
          'add placement',
          pivotHandleFromId(pivotId)?.addPlacement(spec),
        ),
      );
    },
    [enqueueCanonicalPivotMutation, pivotHandleFromId],
  );

  // Remove field from area via the pivot handle.
  const removeFieldFromArea = useCallback(
    (pivotId: string, fieldId: string, area: PivotFieldArea) => {
      void enqueueCanonicalPivotMutation(pivotId, 'remove field', () => {
        const placement = placementForField(pivotId, fieldId, area);
        if (!placement) return null;
        return pivotHandleFromId(pivotId)?.removeField(fieldId, area);
      });
    },
    [enqueueCanonicalPivotMutation, pivotHandleFromId, placementForField],
  );

  // Remove a specific placement by placementId.
  const removePlacement = useCallback(
    (pivotId: string, placementId: PlacementId) => {
      void enqueueCanonicalPivotMutation(pivotId, 'remove placement', () =>
        inspectPivotMutationReceipt(
          'remove placement',
          pivotHandleFromId(pivotId)?.removePlacement(placementId),
        ),
      );
    },
    [enqueueCanonicalPivotMutation, pivotHandleFromId],
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
      void enqueueCanonicalPivotMutation(pivotId, 'move field', () => {
        const placement = placementForField(pivotId, fieldId, fromArea);
        if (!placement) return null;
        return pivotHandleFromId(pivotId)?.moveField(fieldId, fromArea, toArea, toPosition);
      });
    },
    [enqueueCanonicalPivotMutation, pivotHandleFromId, placementForField],
  );

  // Move a specific placement by placementId.
  const movePlacement = useCallback(
    (pivotId: string, placementId: PlacementId, toArea: PivotFieldArea, toPosition: number) => {
      void enqueueCanonicalPivotMutation(pivotId, 'move placement', () =>
        inspectPivotMutationReceipt(
          'move placement',
          pivotHandleFromId(pivotId)?.movePlacement(placementId, toArea, toPosition),
        ),
      );
    },
    [enqueueCanonicalPivotMutation, pivotHandleFromId],
  );

  // Set aggregate function via the pivot handle.
  const setAggregateFunction = useCallback(
    (pivotId: string, fieldOrPlacementId: string, aggregateFunction: AggregateFunction) => {
      void enqueueCanonicalPivotMutation(pivotId, 'set aggregate function', () =>
        pivotHandleFromId(pivotId)?.changeAggregation(
          fieldOrPlacementId,
          aggregateFunction as 'sum' | 'count' | 'average' | 'max' | 'min',
        ),
      );
    },
    [enqueueCanonicalPivotMutation, pivotHandleFromId],
  );

  // Set aggregate function for a specific value placement.
  const setPlacementAggregateFunction = useCallback(
    (pivotId: string, placementId: PlacementId, aggregateFunction: AggregateFunction) => {
      void enqueueCanonicalPivotMutation(pivotId, 'set placement aggregate function', () =>
        inspectPivotMutationReceipt(
          'set placement aggregate function',
          pivotHandleFromId(pivotId)?.setPlacementAggregateFunction(placementId, aggregateFunction),
        ),
      );
    },
    [enqueueCanonicalPivotMutation, pivotHandleFromId],
  );

  // Set show-values-as via the pivot handle.
  const setShowValuesAs = useCallback(
    (pivotId: string, fieldOrPlacementId: string, showValuesAs: ShowValuesAsConfig | null) => {
      void enqueueCanonicalPivotMutation(pivotId, 'set show values as', () =>
        pivotHandleFromId(pivotId)?.setShowValuesAs(fieldOrPlacementId, showValuesAs),
      );
    },
    [enqueueCanonicalPivotMutation, pivotHandleFromId],
  );

  // Set sort order via the pivot handle.
  const setSortOrder = useCallback(
    (pivotId: string, fieldId: string, sortOrder: SortOrder) => {
      void enqueueCanonicalPivotMutation(pivotId, 'set sort order', () =>
        pivotHandleFromId(pivotId)?.setSortOrder(fieldId, sortOrder),
      );
    },
    [enqueueCanonicalPivotMutation, pivotHandleFromId],
  );

  // Set row/column label sort for a specific placement.
  const setPlacementSortOrder = useCallback(
    (pivotId: string, placementId: PlacementId, sortOrder: SortOrder | null) => {
      void enqueueCanonicalPivotMutation(pivotId, 'set placement sort order', () =>
        inspectPivotMutationReceipt(
          'set placement sort order',
          pivotHandleFromId(pivotId)?.setPlacementSortOrder(placementId, sortOrder),
        ),
      );
    },
    [enqueueCanonicalPivotMutation, pivotHandleFromId],
  );

  // Set value sorting on a specific axis placement.
  const setSortByValue = useCallback(
    (
      pivotId: string,
      axisPlacementId: PlacementId,
      valuePlacementId: PlacementId,
      valueSortConfig: PivotValueSortConfig | null,
    ) => {
      void enqueueCanonicalPivotMutation(pivotId, 'set value sort', () =>
        inspectPivotMutationReceipt(
          'set value sort',
          pivotHandleFromId(pivotId)?.setSortByValue(
            axisPlacementId,
            valuePlacementId,
            valueSortConfig,
          ),
        ),
      );
    },
    [enqueueCanonicalPivotMutation, pivotHandleFromId],
  );

  // Set filter via the pivot handle.
  const setFilter = useCallback(
    (pivotId: string, fieldId: string, filter: Omit<PivotFilter, 'fieldId'>) => {
      void enqueueCanonicalPivotMutation(pivotId, 'set filter', () => {
        const config = pivotConfigFromId(pivotId);
        if (!config) return null;
        return pivotHandleFromId(pivotId)?.setFilter(fieldId, filter);
      });
    },
    [enqueueCanonicalPivotMutation, pivotHandleFromId, pivotConfigFromId],
  );

  // Remove filter via the pivot handle.
  const removeFilter = useCallback(
    (pivotId: string, fieldId: string) => {
      void enqueueCanonicalPivotMutation(pivotId, 'remove filter', () => {
        const config = pivotConfigFromId(pivotId);
        if (!config) return null;
        return pivotHandleFromId(pivotId)?.removeFilter(fieldId);
      });
    },
    [enqueueCanonicalPivotMutation, pivotHandleFromId, pivotConfigFromId],
  );

  // Set layout via the pivot handle.
  const setLayout = useCallback(
    (pivotId: string, layout: Partial<PivotTableLayout>) => {
      void enqueueCanonicalPivotMutation(pivotId, 'set layout', () => {
        const config = pivotConfigFromId(pivotId);
        if (!config) return null;
        return pivotHandleFromId(pivotId)?.setLayout(layout);
      });
    },
    [enqueueCanonicalPivotMutation, pivotHandleFromId, pivotConfigFromId],
  );

  // Set style via the pivot handle.
  const setStyle = useCallback(
    (pivotId: string, style: Partial<PivotTableStyle>) => {
      void enqueueCanonicalPivotMutation(pivotId, 'set style', () => {
        const config = pivotConfigFromId(pivotId);
        if (!config) return null;
        return pivotHandleFromId(pivotId)?.setStyle(style);
      });
    },
    [enqueueCanonicalPivotMutation, pivotHandleFromId, pivotConfigFromId],
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
      void (async () => {
        const receipt = await pivotHandleFromId(pivotId)?.refresh();
        warnPivotRefresh(receipt);
        if (!receipt) return;
        if (receipt.config) {
          setPivotEntries((prev) =>
            prev.map((entry) =>
              pivotEntryMatchesId(entry, receipt.pivotId)
                ? { ...entry, config: receipt.config ?? entry.config }
                : entry,
            ),
          );
        }
        setResults((prev) =>
          new Map(prev).set(receipt.pivotId, {
            result: receipt.result ?? null,
            error: receipt.status === 'applied' ? undefined : pivotReceiptMessage(receipt),
          }),
        );
      })();
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
      selectPivotAction(pivotId == null ? null : canonicalPivotIdFromId(pivotId));
    },
    [canonicalPivotIdFromId, selectPivotAction],
  );

  // Start editing pivot - delegates to UI store
  const startEditingPivot = useCallback(
    (pivotId: string) => {
      startEditingPivotAction(canonicalPivotIdFromId(pivotId));
    },
    [canonicalPivotIdFromId, startEditingPivotAction],
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
