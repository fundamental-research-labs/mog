/**
 * CalendarViewContainer
 *
 * React component that wraps CalendarView for direct rendering in the React tree.
 * Creates and manages the XState actor (state machine) and handles data mutation
 * callbacks via Kernel API.
 *
 * This container eliminates the need for createRoot() in the adapter pattern,
 * enabling clean React-based rendering of the Calendar view.
 */

import { toColId, toRowId, type ColId } from '@mog-sdk/contracts/cell-identity';
import type { CellValue, SheetId } from '@mog-sdk/contracts/core';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createActor } from 'xstate';
import { useWorkbook } from '../../infra/context';
import type { TableId, ViewId } from '../types';
import { CalendarView } from './CalendarView';
import type { CalendarRuntimeConfig } from './config';
import { useCalendarData } from './hooks/use-calendar-data';
import { calendarMachine } from './machines';
export interface CalendarViewContainerProps {
  viewId: ViewId;
  tableId?: TableId;
  sheetId: SheetId;
  config: Record<string, unknown>;
}

export function CalendarViewContainer({
  viewId,
  tableId,
  sheetId,
  config,
}: CalendarViewContainerProps): React.ReactElement {
  const wb = useWorkbook();

  // Build calendar config from props, using Worksheet API for table column auto-detection
  const baseConfig = config as Partial<CalendarRuntimeConfig>;
  const [calendarConfig, setCalendarConfig] = useState<CalendarRuntimeConfig>({
    viewId,
    tableId,
    sheetId,
    dateColumn: baseConfig.dateColumn || toColId('date'),
    calendarMode: baseConfig.calendarMode || 'month',
    titleColumn: baseConfig.titleColumn,
    endDateColumn: baseConfig.endDateColumn,
    colorByColumn: baseConfig.colorByColumn,
    weekStartsOn: baseConfig.weekStartsOn || 0,
  });

  useEffect(() => {
    const bc = config as Partial<CalendarRuntimeConfig>;
    let dateColumn = bc.dateColumn;
    let titleColumn = bc.titleColumn;

    if (tableId && (!dateColumn || !titleColumn)) {
      // Fetch table via Worksheet API (async)
      void (async () => {
        try {
          const ws = wb.getSheetById(sheetId);
          const tables = await ws.tables.list();
          const table = tables.find((t: any) => t.id === tableId);
          if (table?.columns && table.columns.length > 0) {
            const columns = table.columns;

            if (!dateColumn) {
              const dateCol = columns.find(
                (col: { type?: string; name: string }) => col.type === 'date',
              );
              if (dateCol) {
                dateColumn = toColId(dateCol.name);
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

          if (!dateColumn) dateColumn = toColId('date');

          setCalendarConfig({
            viewId,
            tableId,
            sheetId,
            dateColumn,
            calendarMode: bc.calendarMode || 'month',
            titleColumn,
            endDateColumn: bc.endDateColumn,
            colorByColumn: bc.colorByColumn,
            weekStartsOn: bc.weekStartsOn || 0,
          });
        } catch {
          // Keep default config on error
        }
      })();
    } else {
      if (!dateColumn) dateColumn = toColId('date');

      setCalendarConfig({
        viewId,
        tableId,
        sheetId,
        dateColumn,
        calendarMode: bc.calendarMode || 'month',
        titleColumn,
        endDateColumn: bc.endDateColumn,
        colorByColumn: bc.colorByColumn,
        weekStartsOn: bc.weekStartsOn || 0,
      });
    }
  }, [viewId, sheetId, tableId, config, wb]);

  // Create and manage the XState actor
  const actor = useMemo(() => {
    const a = createActor(calendarMachine);
    a.start();
    return a;
  }, []);

  // Cleanup actor on unmount
  useEffect(() => {
    return () => {
      actor.stop();
    };
  }, [actor]);

  // Fetch calendar data
  const { events, isLoading, error } = useCalendarData({
    workbook: wb,
    tableId: tableId || ('' as TableId),
    config: {
      dateColumn: calendarConfig.dateColumn,
      titleColumn: calendarConfig.titleColumn,
      endDateColumn: calendarConfig.endDateColumn,
      colorByColumn: calendarConfig.colorByColumn,
    },
  });

  // Handle event click
  const handleEventClick = useCallback((rowId: string, shiftKey: boolean, ctrlKey: boolean) => {
    // Selection is managed by the state machine
    console.log('Event clicked:', rowId, { shiftKey, ctrlKey });
  }, []);

  // Handle event double-click (open detail view)
  const handleEventDoubleClick = useCallback((rowId: string) => {
    // TODO: Open record detail sidebar/dialog
    // This would typically be handled via the shell's UI system
    console.log('Open detail for event:', rowId);
  }, []);

  // Handle create event (double-click on date)
  const handleCreateEvent = useCallback(
    (date: Date) => {
      if (!tableId) return;

      const values: Record<ColId, CellValue> = {
        [calendarConfig.dateColumn]: date.toISOString(),
      };

      // Set default title if title column exists
      if (calendarConfig.titleColumn) {
        values[calendarConfig.titleColumn] = 'New Event';
      }

      void wb.records.create(tableId, values);
    },
    [wb, tableId, calendarConfig],
  );

  // Handle event reschedule (drag to new date)
  const handleRescheduleEvent = useCallback(
    (rowId: string, newDate: Date) => {
      if (!tableId) return;

      const values: Partial<Record<ColId, CellValue>> = {
        [calendarConfig.dateColumn]: newDate.toISOString(),
      };

      void wb.records.update(tableId, toRowId(rowId), values);
    },
    [wb, tableId, calendarConfig],
  );

  // If date column is missing and we couldn't auto-detect, show placeholder
  if (!calendarConfig.dateColumn) {
    return (
      <div className="flex items-center justify-center h-full text-ss-text-secondary">
        <div className="text-center">
          <div className="font-medium mb-2">Calendar Configuration Required</div>
          <div className="text-caption">
            Please configure the date column for this calendar view.
          </div>
        </div>
      </div>
    );
  }

  // Show loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-ss-text-secondary">
        Loading calendar...
      </div>
    );
  }

  // Show error state
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-ss-error">
        <div>Failed to load calendar</div>
        <div className="text-caption mt-1">{error.message}</div>
      </div>
    );
  }

  return (
    <CalendarView
      config={calendarConfig}
      events={events}
      onEventClick={handleEventClick}
      onEventDoubleClick={handleEventDoubleClick}
      onCreateEvent={handleCreateEvent}
      onRescheduleEvent={handleRescheduleEvent}
    />
  );
}
