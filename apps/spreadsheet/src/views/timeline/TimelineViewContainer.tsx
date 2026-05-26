/**
 * TimelineViewContainer
 *
 * React component that wraps TimelineView for direct rendering in the React tree.
 * Creates and manages the XState actor (state machine) and handles data mutation
 * callbacks via Kernel API.
 *
 * This container eliminates the need for createRoot() in the adapter pattern,
 * enabling clean React-based rendering of the Timeline view.
 */

import { toColId, type ColId, type RowId } from '@mog-sdk/contracts/cell-identity';
import type { CellValue, SheetId } from '@mog-sdk/contracts/core';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createActor } from 'xstate';
import { useWorkbook } from '../../infra/context';
import type { TableId, TimelineViewConfig, ViewId } from '../types';
import { timelineMachine } from './machines';
import { TimelineView } from './TimelineView';
export interface TimelineViewContainerProps {
  viewId: ViewId;
  tableId?: TableId;
  sheetId: SheetId;
  config: Record<string, unknown>;
}

export function TimelineViewContainer({
  viewId,
  tableId,
  sheetId,
  config,
}: TimelineViewContainerProps): React.ReactElement {
  const wb = useWorkbook();

  // Build timeline config from props, using Worksheet API for table column auto-detection
  const baseConfig = config as Partial<TimelineViewConfig>;
  const [timelineConfig, setTimelineConfig] = useState<TimelineViewConfig>({
    viewId,
    tableId,
    sheetId,
    startDateColumn: baseConfig.startDateColumn || toColId('date'),
    endDateColumn: baseConfig.endDateColumn,
    titleColumn: baseConfig.titleColumn || toColId('title'),
    groupByColumn: baseConfig.groupByColumn,
    colorByColumn: baseConfig.colorByColumn,
    timeScale: baseConfig.timeScale || 'day',
    startDate: baseConfig.startDate,
    endDate: baseConfig.endDate,
    rowHeight: baseConfig.rowHeight || 40,
    labelColumnWidth: baseConfig.labelColumnWidth || 200,
    showTodayMarker: baseConfig.showTodayMarker ?? true,
    showWeekends: baseConfig.showWeekends ?? true,
  });

  useEffect(() => {
    const bc = config as Partial<TimelineViewConfig>;
    let startDateColumn = bc.startDateColumn;
    let titleColumn = bc.titleColumn;
    const endDateColumn = bc.endDateColumn;

    if (tableId && (!startDateColumn || !titleColumn)) {
      // Fetch table via Worksheet API (async)
      void (async () => {
        try {
          const ws = wb.getSheetById(sheetId);
          const tables = await ws.tables.list();
          const table = tables.find((t: any) => t.id === tableId);
          if (table?.columns && table.columns.length > 0) {
            const columns = table.columns;

            if (!startDateColumn) {
              const dateCol = columns.find(
                (col: { type?: string; name: string }) => col.type === 'date',
              );
              if (dateCol) {
                startDateColumn = toColId(dateCol.name);
              }
            }

            if (!titleColumn) {
              const textCol = columns.find(
                (col: { type?: string; name: string }) => col.type === 'text' || !col.type,
              );
              if (textCol) {
                titleColumn = toColId(textCol.name);
              }
            }
          }

          if (!startDateColumn) startDateColumn = toColId('date');
          if (!titleColumn) titleColumn = toColId('title');

          setTimelineConfig({
            viewId,
            tableId,
            sheetId,
            startDateColumn,
            endDateColumn,
            titleColumn,
            groupByColumn: bc.groupByColumn,
            colorByColumn: bc.colorByColumn,
            timeScale: bc.timeScale || 'day',
            startDate: bc.startDate,
            endDate: bc.endDate,
            rowHeight: bc.rowHeight || 40,
            labelColumnWidth: bc.labelColumnWidth || 200,
            showTodayMarker: bc.showTodayMarker ?? true,
            showWeekends: bc.showWeekends ?? true,
          });
        } catch {
          // Keep default config on error
        }
      })();
    } else {
      if (!startDateColumn) startDateColumn = toColId('date');
      if (!titleColumn) titleColumn = toColId('title');

      setTimelineConfig({
        viewId,
        tableId,
        sheetId,
        startDateColumn,
        endDateColumn,
        titleColumn,
        groupByColumn: bc.groupByColumn,
        colorByColumn: bc.colorByColumn,
        timeScale: bc.timeScale || 'day',
        startDate: bc.startDate,
        endDate: bc.endDate,
        rowHeight: bc.rowHeight || 40,
        labelColumnWidth: bc.labelColumnWidth || 200,
        showTodayMarker: bc.showTodayMarker ?? true,
        showWeekends: bc.showWeekends ?? true,
      });
    }
  }, [viewId, sheetId, tableId, config, wb]);

  // Create and manage the XState actor
  const actor = useMemo(() => {
    const a = createActor(timelineMachine);
    a.start();
    return a;
  }, []);

  // Cleanup actor on unmount
  useEffect(() => {
    return () => {
      actor.stop();
    };
  }, [actor]);

  // Handle bar double-click (open detail view)
  const handleBarDoubleClick = useCallback((rowId: RowId) => {
    // TODO: Open record detail sidebar/dialog
    // This would typically be handled via the shell's UI system
    console.log('Open detail for row:', rowId);
  }, []);

  // Handle date changes from drag/resize operations
  const handleDatesChange = useCallback(
    (rowId: RowId, startDate: Date, endDate: Date) => {
      if (!tableId) return;

      const values: Record<ColId, CellValue> = {
        [timelineConfig.startDateColumn]: startDate.toISOString(),
      };

      if (timelineConfig.endDateColumn) {
        values[timelineConfig.endDateColumn] = endDate.toISOString();
      }

      void wb.records.update(tableId, rowId, values);
    },
    [wb, tableId, timelineConfig],
  );

  // If required columns are missing and we couldn't auto-detect, show placeholder
  if (!timelineConfig.startDateColumn || !timelineConfig.titleColumn) {
    return (
      <div className="flex items-center justify-center h-full text-ss-text-secondary">
        <div className="text-center">
          <div className="font-medium mb-2">Timeline Configuration Required</div>
          <div className="text-caption">
            Please configure the date and title columns for this timeline view.
          </div>
        </div>
      </div>
    );
  }

  return (
    <TimelineView
      actor={actor}
      workbook={wb}
      config={timelineConfig}
      onBarDoubleClick={handleBarDoubleClick}
      onDatesChange={handleDatesChange}
    />
  );
}
