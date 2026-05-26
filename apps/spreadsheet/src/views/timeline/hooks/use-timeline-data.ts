/**
 * useTimelineData Hook
 *
 * Fetches and transforms records with date columns into timeline bars.
 * Subscribes to data changes for real-time updates.
 */

import type { Workbook } from '@mog-sdk/contracts/api';
import type { ColId, RowId } from '@mog-sdk/contracts/cell-identity';
import type { CellValue } from '@mog-sdk/contracts/core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TimelineViewConfig } from '../config';
import type { BarLayout, BarLayoutOptions, TimelineRecord } from '../utils/bar-positioning';
import { calculateBarLayout } from '../utils/bar-positioning';
import { calculateDateRange, parseDate } from '../utils/date-utils';

/**
 * Options for the useTimelineData hook.
 */
export interface UseTimelineDataOptions {
  /** Workbook API for data access */
  workbook: Workbook;
  /** Timeline view configuration */
  config: TimelineViewConfig;
  /** Collapsed groups (for layout calculation) */
  collapsedGroups: Set<string>;
}

/**
 * Result of the useTimelineData hook.
 */
export interface UseTimelineDataResult {
  /** Calculated bar layout */
  layout: BarLayout | null;
  /** Whether data is loading */
  isLoading: boolean;
  /** Error message if load failed */
  error: string | null;
  /** Refresh data manually */
  refresh: () => void;
  /** All row IDs in the timeline */
  allRowIds: RowId[];
}

/**
 * Default colors for bars when no color column is specified.
 */
// TODO: Extract to design token system (e.g., --color-ss-accent-1 through --color-ss-accent-6)
const DEFAULT_COLORS = [
  '#4A90D9', // Blue
  '#7B68EE', // Purple
  '#2ECC71', // Green
  '#E74C3C', // Red
  '#F39C12', // Orange
  '#1ABC9C', // Teal
  '#9B59B6', // Violet
  '#34495E', // Dark gray
];

/**
 * Hook that fetches and transforms table data into timeline layout.
 */
export function useTimelineData(options: UseTimelineDataOptions): UseTimelineDataResult {
  const { workbook, config, collapsedGroups } = options;

  const [records, setRecords] = useState<TimelineRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch data from table
  const fetchData = useCallback(() => {
    setIsLoading(true);
    setError(null);

    try {
      // Get table data
      // TODO: This is a placeholder - actual implementation would use Kernel API
      // For now, we'll use a mock data structure
      const tableData = getTableData(workbook, config);
      const transformedRecords = transformToTimelineRecords(tableData, config);
      setRecords(transformedRecords);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load data');
    } finally {
      setIsLoading(false);
    }
  }, [workbook, config]);

  // Initial fetch
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Calculate date range from data
  const dateRange = useMemo(() => {
    const dates: Date[] = [];
    for (const record of records) {
      const startDate = parseDate(record.startDate);
      const endDate = parseDate(record.endDate);
      if (startDate) dates.push(startDate);
      if (endDate) dates.push(endDate);
    }
    return calculateDateRange(dates, config.timeScale);
  }, [records, config.timeScale]);

  // Calculate layout
  const layout = useMemo<BarLayout | null>(() => {
    if (records.length === 0) {
      return {
        bars: [],
        groups: [],
        totalHeight: 0,
        minDate: dateRange.start,
        maxDate: dateRange.end,
      };
    }

    const layoutOptions: BarLayoutOptions = {
      timelineStart: config.startDate || dateRange.start,
      scale: config.timeScale,
      rowHeight: config.rowHeight || 40,
      collapsedGroups,
    };

    return calculateBarLayout(records, layoutOptions);
  }, [records, config, dateRange, collapsedGroups]);

  // All row IDs
  const allRowIds = useMemo(() => {
    return records.map((r) => r.rowId);
  }, [records]);

  return {
    layout,
    isLoading,
    error,
    refresh: fetchData,
    allRowIds,
  };
}

/**
 * Get table data from workbook.
 * Uses workbook.records.query() when available.
 */
function getTableData(
  _workbook: Workbook,
  _config: TimelineViewConfig,
): Array<{ rowId: RowId; values: Map<ColId, CellValue> }> {
  // TODO: When records query is fully wired, implement:
  //
  // const tableId = config.tableId;
  // if (!tableId) return [];
  //
  // // Query all records from the table
  // const records = await workbook.records.query(tableId, {
  // // Optional filtering by date range
  // filter: config.startDate && config.endDate ? {
  // type: 'and',
  // conditions: [
  // { column: config.startDateColumn, op: '<=', value: config.endDate },
  // { column: config.endDateColumn || config.startDateColumn, op: '>=', value: config.startDate }
  // ]
  // } : undefined,
  // });
  //
  // return records.map(record => ({
  // rowId: record.id,
  // values: record.values
  // }));

  // Placeholder until records query is wired
  return [];
}

/**
 * Transform raw table data into timeline records.
 */
function transformToTimelineRecords(
  data: Array<{ rowId: RowId; values: Map<ColId, CellValue> }>,
  config: TimelineViewConfig,
): TimelineRecord[] {
  const { startDateColumn, endDateColumn, titleColumn, groupByColumn, colorByColumn } = config;

  const colorMap = new Map<string, string>();
  let colorIndex = 0;

  return data.map((row) => {
    const startDate = row.values.get(startDateColumn);
    const endDate = endDateColumn ? row.values.get(endDateColumn) : startDate;
    const title = String(row.values.get(titleColumn) || '');
    const groupKey = groupByColumn ? String(row.values.get(groupByColumn) || '') : undefined;
    const colorValue = colorByColumn ? String(row.values.get(colorByColumn) || '') : undefined;

    // Determine bar color
    let color: string | undefined;
    if (colorValue) {
      if (!colorMap.has(colorValue)) {
        colorMap.set(colorValue, DEFAULT_COLORS[colorIndex % DEFAULT_COLORS.length]);
        colorIndex++;
      }
      color = colorMap.get(colorValue);
    }

    return {
      rowId: row.rowId,
      startDate,
      endDate,
      title,
      groupKey,
      color,
    };
  });
}

/**
 * Hook for subscribing to data changes.
 * Re-fetches data when table contents change.
 */
export function useTimelineDataSubscription(
  _workbook: Workbook,
  tableId: string,
  onDataChange: () => void,
): void {
  useEffect(() => {
    // TODO: When Workbook EventBus is fully available, subscribe to table changes:
    //
    // const unsubscribes: Array<() => void> = [];
    //
    // // Subscribe to record events
    // unsubscribes.push(
    // workbook.on('record:created', (event) => {
    // if (event.tableId === tableId) onDataChange;
    // })
    // );
    // unsubscribes.push(
    // workbook.on('record:updated', (event) => {
    // if (event.tableId === tableId) onDataChange;
    // })
    // );
    // unsubscribes.push(
    // workbook.on('record:deleted', (event) => {
    // if (event.tableId === tableId) onDataChange;
    // })
    // );
    //
    // return () => {
    // unsubscribes.forEach(unsub => unsub);
    // };
  }, [tableId, onDataChange]);
}
