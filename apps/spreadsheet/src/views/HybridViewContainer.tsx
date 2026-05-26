/**
 * HybridViewContainer
 *
 * Dispatches view rendering based on the view type's rendering mode:
 * - Imperative views (Grid): Uses adapter.mount()/unmount() with createRoot()
 * - React views (Kanban, Timeline, etc.): Renders component directly in React tree
 *
 * This solves the nested React root issue where calling createRoot() during
 * React's render cycle causes unmount errors.
 */

import type { SheetId } from '@mog-sdk/contracts/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useUIStoreApi, useWorkbook } from '../infra/context';
import { VIEW_REGISTRY } from './registry';
import type { TableId, ViewAdapter, ViewAdapterConfig, ViewId, ViewType } from './types';
export interface HybridViewContainerProps {
  viewType: ViewType;
  viewId: ViewId;
  tableId?: TableId;
  sheetId: SheetId;
  config?: Record<string, unknown>;
  className?: string;
}

/**
 * Container for imperative views (Grid).
 * Uses the traditional adapter.mount()/unmount() pattern.
 */
function ImperativeViewContainer({
  adapter,
  className,
}: {
  adapter: ViewAdapter;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    adapter.mount(containerRef.current);

    return () => {
      adapter.unmount();
    };
  }, [adapter]);

  return <div ref={containerRef} className={className} />;
}

/**
 * HybridViewContainer - Main entry point for rendering views.
 *
 * Automatically selects the appropriate rendering strategy based on
 * the view definition's renderingMode.
 */
export function HybridViewContainer({
  viewType,
  viewId,
  tableId,
  sheetId,
  config = {},
  className = 'flex-1 w-full h-full',
}: HybridViewContainerProps) {
  const workbook = useWorkbook();
  const uiStore = useUIStoreApi();

  // Get view definition from registry
  const definition = useMemo(() => VIEW_REGISTRY.get(viewType), [viewType]);

  // Create adapter (needed for both modes - provides contracts)
  const adapter = useMemo(() => {
    if (!definition) return null;

    const viewConfig = {
      viewId,
      sheetId,
      tableId,
      ...definition.defaultConfig,
      ...config,
    };

    const adapterConfig: ViewAdapterConfig<typeof viewType> = {
      viewId,
      tableId,
      config: viewConfig,
      workbook,
      uiStore,
    };

    return definition.createAdapter(adapterConfig);
  }, [definition, viewId, tableId, sheetId, config, workbook, uiStore]);

  // Cleanup adapter on unmount
  useEffect(() => {
    return () => {
      adapter?.dispose();
    };
  }, [adapter]);

  if (!definition || !adapter) {
    console.warn(`[HybridViewContainer] View type '${viewType}' not found in registry`);
    return null;
  }

  // Render based on mode
  if (definition.renderingMode === 'imperative') {
    // Imperative mode: use adapter.mount()/unmount()
    return <ImperativeViewContainer adapter={adapter} className={className} />;
  }

  // React mode: render component directly
  if (!definition.component) {
    console.error(`[HybridViewContainer] React view '${viewType}' missing component`);
    return null;
  }

  const Component = definition.component;
  return (
    <Component
      viewId={viewId}
      tableId={tableId}
      sheetId={sheetId}
      config={{
        ...definition.defaultConfig,
        ...config,
      }}
    />
  );
}

/**
 * HybridViewContainerById - Convenience wrapper that resolves view config by ID.
 * For now, viewId is treated as the view type.
 *
 * QUICK FIX: Uses ws.tables.list() to find the first table.
 * TODO: Proper view ↔ table binding based on current selection context.
 */
export function HybridViewContainerById({
  viewId,
  className,
}: {
  viewId: ViewId;
  className?: string;
}) {
  const wb = useWorkbook();

  // For now, viewId is the same as viewType
  const viewType = viewId as ViewType;

  // Get active sheet ID (first sheet as fallback, ASYNC via Workbook API)
  const [sheetId, setSheetId] = useState<SheetId>('sheet-1' as SheetId);

  // Get first table ID for table-bound views via Worksheet API (async)
  // QUICK FIX: Grabs the first table in the active sheet
  // TODO: Detect table at current selection, or show table picker
  const [tableId, setTableId] = useState<TableId | undefined>(undefined);
  const [autoConfig, setAutoConfig] = useState<Record<string, unknown>>({});

  useEffect(() => {
    void (async () => {
      try {
        const sheetNames = wb.sheetNames;
        const resolvedSheetId = (
          sheetNames.length > 0 ? (await wb.getSheet(sheetNames[0])).getSheetId() : 'sheet-1'
        ) as SheetId;
        setSheetId(resolvedSheetId);
        const ws = wb.getSheetById(resolvedSheetId);
        const tables = await ws.tables.list();
        if (tables.length === 0) {
          setTableId(undefined);
          setAutoConfig({});
          return;
        }

        const firstTableId = tables[0].name as TableId;
        setTableId(firstTableId);

        const table = tables[0];
        if (!table?.columns || table.columns.length === 0) {
          setAutoConfig({});
          return;
        }

        // Auto-detect groupBy column (look for "status" or "state", else use second column)
        const columns = table.columns;
        const statusCol = columns.find(
          (c: any) => c.name.toLowerCase() === 'status' || c.name.toLowerCase() === 'state',
        );
        const groupByColumn =
          statusCol?.name ?? (columns.length > 1 ? columns[1].name : columns[0].name);

        // First column is typically the title
        const cardTitleColumn = columns[0].name;

        // Remaining columns as card fields (limit to 4 for readability)
        const cardFields = columns
          .filter((c: any) => c.name !== groupByColumn && c.name !== cardTitleColumn)
          .slice(0, 4)
          .map((c: any) => c.name);

        setAutoConfig({
          groupByColumn,
          cardTitleColumn,
          cardFields,
        });
      } catch {
        setTableId(undefined);
        setAutoConfig({});
      }
    })();
  }, [wb, sheetId]);

  return (
    <HybridViewContainer
      viewType={viewType}
      viewId={viewId}
      tableId={tableId}
      sheetId={sheetId}
      config={autoConfig}
      className={className}
    />
  );
}
