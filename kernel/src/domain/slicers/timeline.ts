/**
 * Timeline Slicer Module
 *
 * Delegates slicer data access to ComputeBridge (Rust compute-core).
 * Pure computation functions (date utilities, period generation) remain unchanged.
 *
 * Architecture:
 * - Write operations: fire-and-forget via ctx.computeBridge
 * - Read operations: async via ctx.computeBridge
 * - Date utilities: pure functions, no CRDT dependency
 * - Period generation: pure functions, no CRDT dependency
 *
 * @see compute-core/src/storage/slicers.rs - Rust implementation
 */

import { toCellId, type CellId } from '@mog-sdk/contracts/cell-identity';
import { type SheetId, sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type { StructureChangeSource } from '@mog-sdk/contracts/event-base';
import type {
  CreateSlicerOptions,
  TimelineLevel,
  TimelinePeriod,
} from '@mog-sdk/contracts/slicers';
import { DEFAULT_TIMELINE_STYLE, getQuarterFromMonth, getQuarterLabel } from './slicer-utils';
import type { WorkflowCellValue } from '@mog-sdk/contracts/workflows';

import type { Slicer } from '../../bridges/compute/compute-types.gen';
import type { DocumentContext } from '../../context/types';
import * as Filters from '../sorting/filters';
import { getDataRange, getTable } from '../tables/core';
import { createTableSlicer, getSlicer } from './crud';
import { storedSlicerToComputeSlicer } from './table-binding';
import { resolveSlicerColumn } from './table-binding';

// =============================================================================
// Date Utilities
// =============================================================================

/**
 * Check if a value is a date serial number.
 *
 * Excel date serials are positive numbers where:
 * - 1 = January 1, 1900
 * - 44561 = December 31, 2021
 *
 * Reasonable range for dates: 1 to 110000 (1900 to ~2200)
 *
 * @param value - Cell value to check
 * @returns True if the value is likely a date serial
 */
export function isDateValue(value: WorkflowCellValue): boolean {
  if (typeof value !== 'number' || !isFinite(value)) {
    return false;
  }
  return value >= 1 && value <= 110000;
}

/**
 * Detect if a column contains primarily date values.
 *
 * Heuristic: If > 70% of non-empty values are date serials, it's a date column.
 *
 * @param values - Array of cell values from the column
 * @returns True if the column appears to be date-typed
 */
export function isDateColumn(values: WorkflowCellValue[]): boolean {
  if (values.length === 0) return false;

  let dateCount = 0;
  let totalCount = 0;

  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;

    totalCount++;
    if (isDateValue(value)) {
      dateCount++;
    }
  }

  if (totalCount < 3) return false;
  return dateCount / totalCount >= 0.7;
}

/**
 * Get the date range from an array of date values.
 *
 * @param values - Array of cell values (date serials)
 * @returns Object with min and max date serials, or null if no valid dates
 */
export function getDateRange(
  values: WorkflowCellValue[],
): { minDate: number; maxDate: number } | null {
  let minDate = Infinity;
  let maxDate = -Infinity;
  let hasValidDates = false;

  for (const value of values) {
    if (isDateValue(value)) {
      const serial = value as number;
      minDate = Math.min(minDate, serial);
      maxDate = Math.max(maxDate, serial);
      hasValidDates = true;
    }
  }

  if (!hasValidDates) return null;
  return { minDate, maxDate };
}

// =============================================================================
// Date Serial Conversion Utilities (Module-Private)
// =============================================================================

/**
 * Convert date serial to year.
 * Excel serial 1 = Jan 1, 1900
 */
function serialToYear(serial: number): number {
  const yearsSince1900 = Math.floor((serial - 1) / 365.25);
  return 1900 + yearsSince1900;
}

/**
 * Convert date serial to month (1-12).
 */
function serialToMonth(serial: number): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  const excelEpoch = Date.UTC(1899, 11, 31);

  let adjustedSerial = serial;
  if (serial > 60) {
    adjustedSerial = serial - 1;
  }

  const ms = excelEpoch + adjustedSerial * msPerDay;
  const date = new Date(ms);
  return date.getUTCMonth() + 1;
}

/**
 * Convert date serial to day of month (1-31).
 */
function serialToDay(serial: number): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  const excelEpoch = Date.UTC(1899, 11, 31);

  let adjustedSerial = serial;
  if (serial > 60) {
    adjustedSerial = serial - 1;
  }

  const ms = excelEpoch + adjustedSerial * msPerDay;
  const date = new Date(ms);
  return date.getUTCDate();
}

/**
 * Get the start date serial for a period at a given level.
 */
function getPeriodStartSerial(
  year: number,
  month: number,
  day: number,
  level: TimelineLevel,
): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  const excelEpoch = Date.UTC(1899, 11, 31);

  let periodStart: Date;

  switch (level) {
    case 'years':
      periodStart = new Date(Date.UTC(year, 0, 1));
      break;
    case 'quarters': {
      const quarterStartMonth = (getQuarterFromMonth(month) - 1) * 3;
      periodStart = new Date(Date.UTC(year, quarterStartMonth, 1));
      break;
    }
    case 'months':
      periodStart = new Date(Date.UTC(year, month - 1, 1));
      break;
    case 'days':
      periodStart = new Date(Date.UTC(year, month - 1, day));
      break;
  }

  let serial = Math.round((periodStart.getTime() - excelEpoch) / msPerDay);
  if (serial > 59) {
    serial = serial + 1;
  }
  return serial;
}

/**
 * Get the end date serial for a period at a given level.
 */
function getPeriodEndSerial(
  year: number,
  month: number,
  day: number,
  level: TimelineLevel,
): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  const excelEpoch = Date.UTC(1899, 11, 31);

  let periodEnd: Date;

  switch (level) {
    case 'years':
      periodEnd = new Date(Date.UTC(year, 11, 31));
      break;
    case 'quarters': {
      const quarterEndMonth = getQuarterFromMonth(month) * 3 - 1;
      periodEnd = new Date(Date.UTC(year, quarterEndMonth + 1, 0));
      break;
    }
    case 'months':
      periodEnd = new Date(Date.UTC(year, month, 0));
      break;
    case 'days':
      periodEnd = new Date(Date.UTC(year, month - 1, day));
      break;
  }

  let serial = Math.round((periodEnd.getTime() - excelEpoch) / msPerDay);
  if (serial > 59) {
    serial = serial + 1;
  }
  return serial;
}

/**
 * Get a period key for a date value at a given level.
 * Used for counting items per period.
 */
function getPeriodKey(serial: number, level: TimelineLevel): string {
  const year = serialToYear(serial);
  const month = serialToMonth(serial);
  const day = serialToDay(serial);

  switch (level) {
    case 'years':
      return `${year}`;
    case 'quarters':
      return `${year}-Q${getQuarterFromMonth(month)}`;
    case 'months':
      return `${year}-${month}`;
    case 'days':
      return `${year}-${month}-${day}`;
  }
}

// =============================================================================
// Period Generation
// =============================================================================

/**
 * Generate timeline periods for a date range at a specified aggregation level.
 *
 * @param minDate - Start date serial (inclusive)
 * @param maxDate - End date serial (inclusive)
 * @param level - Aggregation level (years, quarters, months, days)
 * @param dateValues - Array of all date values for counting
 * @param selectedStartDate - Optional selected range start
 * @param selectedEndDate - Optional selected range end
 * @returns Array of timeline periods
 */
export function generateTimelinePeriods(
  minDate: number,
  maxDate: number,
  level: TimelineLevel,
  dateValues: number[],
  selectedStartDate?: number,
  selectedEndDate?: number,
): TimelinePeriod[] {
  const periods: TimelinePeriod[] = [];

  const dateCounts = new Map<string, number>();
  for (const value of dateValues) {
    if (isDateValue(value)) {
      const key = getPeriodKey(value, level);
      dateCounts.set(key, (dateCounts.get(key) ?? 0) + 1);
    }
  }

  const startYear = serialToYear(minDate);
  const endYear = serialToYear(maxDate);

  switch (level) {
    case 'years':
      for (let year = startYear; year <= endYear; year++) {
        const periodStart = getPeriodStartSerial(year, 1, 1, 'years');
        const periodEnd = getPeriodEndSerial(year, 1, 1, 'years');
        const key = `${year}`;
        const count = dateCounts.get(key) ?? 0;
        const isSelected =
          selectedStartDate !== undefined &&
          selectedEndDate !== undefined &&
          periodStart <= selectedEndDate &&
          periodEnd >= selectedStartDate;

        periods.push({
          startDate: periodStart,
          endDate: periodEnd,
          label: year.toString(),
          shortLabel: year.toString(),
          isSelected,
          hasData: count > 0,
          count,
        });
      }
      break;

    case 'quarters':
      for (let year = startYear; year <= endYear; year++) {
        for (let quarter = 1; quarter <= 4; quarter++) {
          const month = (quarter - 1) * 3 + 1;
          const periodStart = getPeriodStartSerial(year, month, 1, 'quarters');
          const periodEnd = getPeriodEndSerial(year, month, 1, 'quarters');

          if (periodEnd < minDate) continue;
          if (periodStart > maxDate) continue;

          const key = `${year}-Q${quarter}`;
          const count = dateCounts.get(key) ?? 0;
          const isSelected =
            selectedStartDate !== undefined &&
            selectedEndDate !== undefined &&
            periodStart <= selectedEndDate &&
            periodEnd >= selectedStartDate;

          periods.push({
            startDate: periodStart,
            endDate: periodEnd,
            label: getQuarterLabel(quarter),
            shortLabel: getQuarterLabel(quarter),
            isSelected,
            hasData: count > 0,
            count,
          });
        }
      }
      break;

    case 'months':
      for (let year = startYear; year <= endYear; year++) {
        for (let month = 1; month <= 12; month++) {
          const periodStart = getPeriodStartSerial(year, month, 1, 'months');
          const periodEnd = getPeriodEndSerial(year, month, 1, 'months');

          if (periodEnd < minDate) continue;
          if (periodStart > maxDate) continue;

          const key = `${year}-${month}`;
          const count = dateCounts.get(key) ?? 0;
          const isSelected =
            selectedStartDate !== undefined &&
            selectedEndDate !== undefined &&
            periodStart <= selectedEndDate &&
            periodEnd >= selectedStartDate;

          const monthNames = [
            'Jan',
            'Feb',
            'Mar',
            'Apr',
            'May',
            'Jun',
            'Jul',
            'Aug',
            'Sep',
            'Oct',
            'Nov',
            'Dec',
          ];

          periods.push({
            startDate: periodStart,
            endDate: periodEnd,
            label: monthNames[month - 1],
            shortLabel: monthNames[month - 1].charAt(0),
            isSelected,
            hasData: count > 0,
            count,
          });
        }
      }
      break;

    case 'days':
      for (let serial = Math.floor(minDate); serial <= Math.ceil(maxDate); serial++) {
        const year = serialToYear(serial);
        const month = serialToMonth(serial);
        const day = serialToDay(serial);
        const key = `${year}-${month}-${day}`;
        const count = dateCounts.get(key) ?? 0;
        const isSelected =
          selectedStartDate !== undefined &&
          selectedEndDate !== undefined &&
          serial >= selectedStartDate &&
          serial <= selectedEndDate;

        periods.push({
          startDate: serial,
          endDate: serial,
          label: day.toString(),
          shortLabel: day.toString(),
          isSelected,
          hasData: count > 0,
          count,
        });
      }
      break;
  }

  return periods;
}

// =============================================================================
// Timeline Slicer Operations
// =============================================================================

/**
 * Create a timeline slicer for a table column.
 *
 * Delegates to ComputeBridge via createTableSlicer, then updates with timeline config.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet to create slicer in
 * @param tableId - Table to connect to
 * @param columnCellId - CellId of the date column header
 * @param options - Optional configuration
 * @param origin - Origin of the change
 */
export function createTimelineSlicer(
  ctx: DocumentContext,
  sheetId: SheetId,
  tableId: string,
  columnCellId: CellId,
  options?: CreateSlicerOptions,
  origin: StructureChangeSource = 'user',
): void {
  // Create base slicer with timeline style via CB
  createTableSlicer(
    ctx,
    sheetId,
    tableId,
    columnCellId,
    {
      ...options,
      style: { ...DEFAULT_TIMELINE_STYLE, ...options?.style },
    },
    origin,
  );
  // Timeline-specific properties (sourceType, timelineLevel, etc.) are stored
  // in the slicer config by Rust compute-core when it processes the create request.
}

/**
 * Get timeline slicer periods for rendering.
 *
 * @param ctx - Store context
 * @param slicer - Timeline slicer config
 * @param getCellValue - Callback to get cell values
 * @returns Array of timeline periods
 */
export async function getTimelinePeriods(
  ctx: DocumentContext,
  slicer: Slicer,
  timelineConfig: {
    timelineLevel: TimelineLevel;
    dataStartDate?: number;
    dataEndDate?: number;
    selectedStartDate?: number;
    selectedEndDate?: number;
  },
  getCellValue: (sheetId: SheetId, row: number, col: number) => WorkflowCellValue | undefined,
): Promise<TimelinePeriod[]> {
  if (slicer.sourceType === 'pivot') {
    return [];
  }

  const table = await getTable(ctx, slicer.sourceId);
  if (!table) return [];

  const colPosition = await resolveSlicerColumn(ctx, slicer);
  if (!colPosition) return [];

  const { sheetId, col } = colPosition;
  const dataRange = await getDataRange(ctx, table.id);

  const dateValues: number[] = [];
  for (let row = dataRange.startRow; row <= dataRange.endRow; row++) {
    const value = getCellValue(sheetId, row, col);
    if (value !== undefined && isDateValue(value)) {
      dateValues.push(value as number);
    }
  }

  if (dateValues.length === 0) return [];

  const dateRange = getDateRange(dateValues);
  if (!dateRange) return [];

  const minDate = timelineConfig.dataStartDate ?? dateRange.minDate;
  const maxDate = timelineConfig.dataEndDate ?? dateRange.maxDate;

  return generateTimelinePeriods(
    minDate,
    maxDate,
    timelineConfig.timelineLevel,
    dateValues,
    timelineConfig.selectedStartDate,
    timelineConfig.selectedEndDate,
  );
}

/**
 * Set timeline slicer date range selection.
 *
 * Delegates to ComputeBridge.updateSlicerConfig. Events emitted via MutationResultHandler.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet containing the slicer
 * @param slicerId - Slicer ID
 * @param startDate - Start date serial (inclusive)
 * @param endDate - End date serial (inclusive)
 * @param _origin - Origin of the change (handled by Rust)
 */
export function setTimelineSelection(
  ctx: DocumentContext,
  sheetId: SheetId,
  slicerId: string,
  startDate: number | undefined,
  endDate: number | undefined,
  _origin: StructureChangeSource = 'user',
): void {
  // Update slicer config with timeline selection via CB
  // Timeline-specific fields — not yet in StoredSlicerUpdate typed schema.
  void ctx.computeBridge.updateSlicerConfig(sheetId, slicerId, {
    selectedStartDate: startDate,
    selectedEndDate: endDate,
  } as any);

  // Apply filter to underlying data
  void (async () => {
    const storedSlicer = await getSlicer(ctx, sheetId, slicerId);
    if (!storedSlicer || storedSlicer.source.type !== 'table') return;

    const table = await getTable(ctx, storedSlicer.source.tableId);
    if (!table) return;

    const columnCellId = toCellId(storedSlicer.source.columnCellId);

    let filter = await Filters.getTableFilter(ctx, toSheetId(table.sheetId), table.id);
    if (!filter) {
      filter = await Filters.createFilter(
        ctx,
        toSheetId(table.sheetId),
        table.range,
        'tableFilter',
        _origin,
        table.id,
      );
    }

    if (startDate === undefined || endDate === undefined) {
      await Filters.clearColumnFilter(
        ctx,
        toSheetId(table.sheetId),
        filter.id,
        columnCellId,
        _origin,
      );
    } else {
      await Filters.setColumnFilter(
        ctx,
        toSheetId(table.sheetId),
        filter.id,
        columnCellId,
        {
          type: 'condition',
          conditions: [
            {
              operator: 'between',
              value: startDate,
              value2: endDate,
            },
          ],
        },
        _origin,
      );
    }
  })();
}

/**
 * Set the aggregation level for a timeline slicer.
 *
 * Delegates to ComputeBridge.updateSlicerConfig. Events emitted via MutationResultHandler.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet containing the slicer
 * @param slicerId - Slicer ID
 * @param level - New aggregation level
 * @param _origin - Origin of the change (handled by Rust)
 */
export function setTimelineLevel(
  ctx: DocumentContext,
  sheetId: SheetId,
  slicerId: string,
  level: TimelineLevel,
  _origin: StructureChangeSource = 'user',
): void {
  // Timeline-specific field — not yet in StoredSlicerUpdate typed schema.
  void ctx.computeBridge.updateSlicerConfig(sheetId, slicerId, {
    timelineLevel: level,
  } as any);
}

/**
 * Clear timeline slicer selection.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet containing the slicer
 * @param slicerId - Slicer ID
 * @param origin - Origin of the change
 */
export function clearTimelineSelection(
  ctx: DocumentContext,
  sheetId: SheetId,
  slicerId: string,
  origin: StructureChangeSource = 'user',
): void {
  setTimelineSelection(ctx, sheetId, slicerId, undefined, undefined, origin);
}
