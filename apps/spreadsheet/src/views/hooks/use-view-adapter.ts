/**
 * useViewAdapter Hook
 *
 * Creates and manages view adapters based on view type and configuration.
 * Handles adapter lifecycle, caching, and cleanup.
 *
 * Architecture:
 * - Adapters are created by the ViewRegistry using ViewDefinition.createAdapter()
 * - Adapters are cached for fast view switching (unmount preserves state)
 * - Adapters are disposed when the component unmounts
 *
 * Context usage:
 * - workbook (Workbook) comes from DocumentContext - for document data access
 * - uiStore comes from DocumentContext - for document-specific UI state
 * - Shell-level state (activeViewId) comes from ShellContext (used by SpreadsheetLayout)
 */

import { toColId } from '@mog-sdk/contracts/cell-identity';
import type { SheetId } from '@mog-sdk/contracts/core';
import { useEffect, useMemo, useRef, useState } from 'react';
// Document context provides Workbook and document UIStore
import { useUIStoreApi, useWorkbook } from '../../infra/context';
import { VIEW_REGISTRY } from '../registry';
import type { TableId, ViewAdapter, ViewAdapterConfig, ViewId, ViewType } from '../types';

/**
 * Configuration for creating a view adapter.
 */
export interface UseViewAdapterOptions {
  /** View type (grid, kanban, timeline, etc.) */
  viewType: ViewType;
  /** View instance ID */
  viewId: ViewId;
  /** Table ID (required for table-bound views like Kanban) */
  tableId?: TableId;
  /** Sheet ID */
  sheetId: SheetId;
  /** Additional view-specific config (merged with defaults) */
  config?: Record<string, unknown>;
}

/**
 * Hook to create and manage a view adapter.
 *
 * @param options - Configuration for the adapter
 * @returns The view adapter instance, or null if view type not found
 *
 * @example
 * ```tsx
 * const adapter = useViewAdapter({
 * viewType: 'kanban',
 * viewId: 'kanban-1' as ViewId,
 * tableId: 'table-1',
 * sheetId: 'sheet-1' as SheetId,
 * config: {
 * groupByColumn: 'Status',
 * cardTitleColumn: 'Title'
 * }
 * });
 *
 * return <ViewContainer adapter={adapter} />;
 * ```
 */
export function useViewAdapter(options: UseViewAdapterOptions): ViewAdapter | null {
  // Get document context (data access and document-specific UI state)
  const workbook = useWorkbook();
  const uiStore = useUIStoreApi();

  // Track the adapter for cleanup
  const adapterRef = useRef<ViewAdapter | null>(null);

  // Create adapter (memoized to avoid recreation on every render)
  const adapter = useMemo(() => {
    const definition = VIEW_REGISTRY.get(options.viewType);
    if (!definition) {
      console.warn(`[useViewAdapter] View type '${options.viewType}' not found in registry`);
      return null;
    }

    // Merge default config with provided config
    const viewConfig = {
      viewId: options.viewId,
      sheetId: options.sheetId,
      tableId: options.tableId,
      ...definition.defaultConfig,
      ...options.config,
    };

    // Create the adapter config
    const adapterConfig: ViewAdapterConfig<typeof options.viewType> = {
      viewId: options.viewId,
      tableId: options.tableId,
      config: viewConfig, // Type narrowing handled by ViewDefinition
      workbook,
      uiStore,
    };

    // Create the adapter
    const newAdapter = definition.createAdapter(adapterConfig);
    return newAdapter;
  }, [
    options.viewType,
    options.viewId,
    options.tableId,
    options.sheetId,
    // Don't include options.config in deps - use stable reference patterns
    workbook,
    uiStore,
  ]);

  // Track adapter for cleanup
  useEffect(() => {
    adapterRef.current = adapter;
  }, [adapter]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (adapterRef.current) {
        adapterRef.current.dispose();
        adapterRef.current = null;
      }
    };
  }, []);

  return adapter;
}

/**
 * Hook to create a view adapter by view ID.
 *
 * This is a convenience wrapper that looks up view configuration by ID
 * from the stored view configs.
 *
 * For now, this creates a default config based on the view type.
 * In the future, this will look up the persisted config from Yjs.
 *
 * @param viewId - View identifier (also used to determine view type for now)
 * @returns The view adapter instance, or null if not found
 */
export function useViewAdapterById(viewId: ViewId | string): ViewAdapter | null {
  const wb = useWorkbook();

  // For now, viewId is the same as viewType (e.g., 'grid', 'kanban')
  // In the future, this will look up the persisted view config
  const viewType = viewId as ViewType;

  // Get first sheet ID for the view (ASYNC via Workbook API)
  // TODO: Get from view config when persisted configs are implemented
  const [sheetId, setSheetId] = useState<SheetId>('sheet-1' as SheetId);

  useEffect(() => {
    void (async () => {
      const sheetNames = await wb.getSheetNames();
      if (sheetNames.length > 0) {
        const ws = await wb.getSheet(sheetNames[0]);
        setSheetId(ws.getSheetId() as SheetId);
      }
    })();
  }, [wb]);

  // Get first table ID for table-bound views via Worksheet API (async)
  // TODO: Get from view config when persisted configs are implemented
  const [tableId, setTableId] = useState<TableId | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const names = await wb.getSheetNames();
        for (const name of names) {
          const ws = await wb.getSheet(name);
          const tables = await ws.tables.list();
          if (tables && tables.length > 0 && !cancelled) {
            setTableId((tables[0].id ?? tables[0].name) as TableId);
            return;
          }
        }
      } catch {
        /* graceful fallback — no tables found */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wb]);

  // Auto-detect config for table-bound views via Worksheet API (async)
  // Uses first table's columns as defaults until proper view config UI is built
  const [autoConfig, setAutoConfig] = useState<Record<string, unknown>>({});
  useEffect(() => {
    if (!tableId) {
      setAutoConfig({});
      return;
    }

    void (async () => {
      try {
        // Find the table by searching all sheets via Worksheet API
        const names = await wb.getSheetNames();
        let table: any = null;
        for (const name of names) {
          const ws = await wb.getSheet(name);
          const tables = await ws.tables.list();
          table = tables.find((t: any) => t.id === tableId);
          if (table) break;
        }

        if (!table || !table.columns || table.columns.length === 0) {
          setAutoConfig({});
          return;
        }

        const columns = table.columns;

        // For Kanban: need groupByColumn (typically 'Status') and cardTitleColumn (typically first column)
        if (viewType === 'kanban') {
          const statusCol = columns.find(
            (c: any) => c.name.toLowerCase() === 'status' || c.name.toLowerCase() === 'state',
          );
          const groupByColumn = statusCol
            ? toColId(statusCol.name)
            : columns.length > 1
              ? toColId(columns[1].name)
              : toColId(columns[0].name);

          const cardTitleColumn = toColId(columns[0].name);

          const cardFields = columns
            .filter((c: any) => c.name !== groupByColumn && c.name !== cardTitleColumn)
            .map((c: any) => toColId(c.name));

          setAutoConfig({
            groupByColumn,
            cardTitleColumn,
            cardFields,
          });
          return;
        }

        // For Timeline: need startDateColumn, titleColumn
        if (viewType === 'timeline') {
          const dateCol = columns.find(
            (c: any) =>
              c.name.toLowerCase().includes('date') ||
              c.name.toLowerCase().includes('start') ||
              c.name.toLowerCase().includes('due'),
          );
          const startDateColumn = dateCol ? toColId(dateCol.name) : toColId(columns[0].name);
          const titleColumn = toColId(columns[0].name);

          setAutoConfig({
            startDateColumn,
            titleColumn,
            timeScale: 'week' as const,
          });
          return;
        }

        setAutoConfig({});
      } catch {
        setAutoConfig({});
      }
    })();
  }, [wb, tableId, viewType]);

  const adapter = useViewAdapter({
    viewType,
    viewId: viewId as ViewId,
    tableId,
    sheetId,
    config: autoConfig,
  });

  return adapter;
}
