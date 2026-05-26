/**
 * KanbanViewContainer
 *
 * React component that wraps KanbanView for direct rendering in the React tree.
 * Replaces the createRoot() pattern in KanbanViewAdapter.
 *
 * Responsibilities:
 * - Create and manage the XState actor lifecycle
 * - Provide data mutation handlers via Workbook Records API
 * - Connect to workbook for data access
 */

import { toColId, type ColId, type RowId } from '@mog-sdk/contracts/cell-identity';
import type { CellValue, SheetId } from '@mog-sdk/contracts/core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createActor } from 'xstate';
import { useWorkbook } from '../../infra/context';
import type { KanbanViewConfig, TableId, ViewId } from '../types';
import { KanbanView } from './KanbanView';
import { kanbanMachine, type KanbanActor } from './machines';
export interface KanbanViewContainerProps {
  viewId: ViewId;
  tableId?: TableId;
  sheetId: SheetId;
  config: Record<string, unknown>;
}

function configColId(value: unknown, fallback = ''): ColId {
  return toColId(typeof value === 'string' ? value : fallback);
}

function optionalConfigColId(value: unknown): ColId | undefined {
  return typeof value === 'string' ? toColId(value) : undefined;
}

function configColIds(value: unknown): ColId[] {
  return Array.isArray(value)
    ? value.filter((id): id is string => typeof id === 'string').map(toColId)
    : [];
}

/**
 * KanbanViewContainer renders KanbanView directly in the React tree.
 */
export function KanbanViewContainer({
  viewId,
  tableId,
  sheetId,
  config,
}: KanbanViewContainerProps) {
  const wb = useWorkbook();

  // Build Kanban config from props, using Worksheet API for table column auto-detection
  const [kanbanConfig, setKanbanConfig] = useState<KanbanViewConfig>({
    viewId,
    sheetId,
    tableId,
    groupByColumn: configColId(config.groupByColumn),
    cardTitleColumn: configColId(config.cardTitleColumn),
    cardFields: configColIds(config.cardFields),
    showEmptyGroups: (config.showEmptyGroups as boolean) ?? true,
    cardColorColumn: optionalConfigColId(config.cardColorColumn),
    columnOrder: config.columnOrder as string[] | undefined,
    wipLimits: config.wipLimits as Record<string, number> | undefined,
    collapsedColumns: config.collapsedColumns as string[] | undefined,
  });

  useEffect(() => {
    let groupByColumn = optionalConfigColId(config.groupByColumn);
    let cardTitleColumn = optionalConfigColId(config.cardTitleColumn);
    let cardFields = configColIds(config.cardFields);

    if (tableId && (!groupByColumn || !cardTitleColumn)) {
      // Fetch table via Worksheet API (async)
      void (async () => {
        try {
          const ws = wb.getSheetById(sheetId);
          const tables = await ws.tables.list();
          const table = tables.find((t: any) => t.id === tableId);
          if (table?.columns && table.columns.length > 0) {
            const columns = table.columns;

            if (!groupByColumn) {
              const statusCol = columns.find(
                (c: any) => c.name.toLowerCase() === 'status' || c.name.toLowerCase() === 'state',
              );
              groupByColumn = statusCol
                ? toColId(statusCol.name)
                : columns.length > 1
                  ? toColId(columns[1].name)
                  : toColId(columns[0].name);
            }

            if (!cardTitleColumn) {
              cardTitleColumn = toColId(columns[0].name);
            }

            if (cardFields.length === 0) {
              cardFields = columns
                .filter((c: any) => c.name !== groupByColumn && c.name !== cardTitleColumn)
                .map((c: any) => toColId(c.name));
            }
          }

          setKanbanConfig({
            viewId,
            sheetId,
            tableId,
            groupByColumn: groupByColumn ?? toColId(''),
            cardTitleColumn: cardTitleColumn ?? toColId(''),
            cardFields,
            showEmptyGroups: (config.showEmptyGroups as boolean) ?? true,
            cardColorColumn: optionalConfigColId(config.cardColorColumn),
            columnOrder: config.columnOrder as string[] | undefined,
            wipLimits: config.wipLimits as Record<string, number> | undefined,
            collapsedColumns: config.collapsedColumns as string[] | undefined,
          });
        } catch {
          // Keep default config on error
        }
      })();
    } else {
      setKanbanConfig({
        viewId,
        sheetId,
        tableId,
        groupByColumn: groupByColumn ?? toColId(''),
        cardTitleColumn: cardTitleColumn ?? toColId(''),
        cardFields,
        showEmptyGroups: (config.showEmptyGroups as boolean) ?? true,
        cardColorColumn: optionalConfigColId(config.cardColorColumn),
        columnOrder: config.columnOrder as string[] | undefined,
        wipLimits: config.wipLimits as Record<string, number> | undefined,
        collapsedColumns: config.collapsedColumns as string[] | undefined,
      });
    }
  }, [viewId, sheetId, tableId, config, wb]);

  // Create and manage actor lifecycle
  const actor = useMemo<KanbanActor>(() => {
    const a = createActor(kanbanMachine);
    a.start();
    return a;
  }, []);

  // Cleanup actor on unmount
  useEffect(() => {
    return () => {
      actor.stop();
    };
  }, [actor]);

  // Data mutation handlers using Workbook Records API
  const handleCardMove = useCallback(
    (cardId: RowId, newGroupValue: string, _index: number) => {
      if (!tableId) return;
      void wb.records.update(tableId, cardId, {
        [kanbanConfig.groupByColumn]: newGroupValue,
      });
    },
    [wb, tableId, kanbanConfig.groupByColumn],
  );

  const handleCardEdit = useCallback(
    (cardId: RowId, fieldId: ColId | null, value: CellValue) => {
      if (!tableId || !fieldId) return;
      void wb.records.update(tableId, cardId, { [fieldId]: value });
    },
    [wb, tableId],
  );

  const handleCardCreate = useCallback(
    (groupValue: string, title: string) => {
      if (!tableId) return;
      void wb.records.create(tableId, {
        [kanbanConfig.groupByColumn]: groupValue,
        [kanbanConfig.cardTitleColumn]: title,
      });
    },
    [wb, tableId, kanbanConfig.groupByColumn, kanbanConfig.cardTitleColumn],
  );

  const handleCardsDelete = useCallback(
    (cardIds: RowId[]) => {
      if (!tableId) return;
      for (const cardId of cardIds) {
        void wb.records.remove(tableId, cardId);
      }
    },
    [wb, tableId],
  );

  // Get column schemas for field rendering via Worksheet API (async)
  const [columnSchemas, setColumnSchemas] = useState<
    Map<ColId, { name: string; type: string }> | undefined
  >(undefined);
  useEffect(() => {
    if (!tableId) {
      setColumnSchemas(undefined);
      return;
    }
    void (async () => {
      try {
        const ws = wb.getSheetById(sheetId);
        const tables = await ws.tables.list();
        const table = tables.find((t: any) => t.id === tableId);
        if (!table?.columns) {
          setColumnSchemas(undefined);
          return;
        }
        const schemas = new Map<ColId, { name: string; type: string }>();
        for (const col of table.columns) {
          schemas.set(toColId(col.name), {
            name: col.name,
            type: 'text',
          });
        }
        setColumnSchemas(schemas);
      } catch {
        setColumnSchemas(undefined);
      }
    })();
  }, [wb, tableId, sheetId]);

  // Don't render if missing required config
  if (!kanbanConfig.groupByColumn || !kanbanConfig.cardTitleColumn) {
    return (
      <div className="flex items-center justify-center h-full text-ss-text-secondary">
        <p>Configure Kanban view: select grouping and title columns</p>
      </div>
    );
  }

  return (
    <KanbanView
      actor={actor}
      workbook={wb}
      config={kanbanConfig}
      onCardMove={handleCardMove}
      onCardEdit={handleCardEdit}
      onCardCreate={handleCardCreate}
      onCardsDelete={handleCardsDelete}
      columnSchemas={columnSchemas}
    />
  );
}
