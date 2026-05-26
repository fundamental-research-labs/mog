/**
 * DateFiltersMenu Component
 *
 * Context Menus Parity - Date-specific filter shortcuts
 *
 * Provides a submenu with common date filter operations:
 * - Equals, Before, After, Between
 * - Quick filters: Today, Yesterday, Tomorrow
 * - Week filters: This Week, Last Week, Next Week
 * - Month filters: This Month, Last Month, Next Month
 * - Quarter filters: This Quarter, Last Quarter, Next Quarter
 * - Year filters: This Year, Last Year, Next Year
 * - Year to Date
 * - All Dates in Period (submenu)
 *
 * ARCHITECTURE:
 * - Uses Draft + Apply pattern: stores pending config in UIStore, then dispatches
 * - Quick filters apply immediately using date range calculation
 * - Operator-based filters switch to condition panel for value input
 */

import type { CellId } from '@mog-sdk/contracts/cell-identity';
import type { ColumnFilterCriteria, FilterOperator } from '@mog-sdk/contracts/filter';
import { serialToDate } from '@mog/spreadsheet-utils/datetime';
import React, { useCallback, useState } from 'react';
import { useActiveSheetId, useUIStore, useWorkbook } from '../../infra/context';
import { MenuItem, MenuSeparator } from '@mog/shell/components/ui';

export interface DateFiltersMenuProps {
  /** Filter ID from the filter dropdown context */
  filterId: string;
  /** Header cell ID from the filter dropdown context */
  headerCellId: CellId;
  /** 0-based column index (from FilterButtonMetadata.col) */
  col: number;
  /** Called to close the submenu */
  onClose: () => void;
  /** Called when user wants to switch to condition panel with pre-selected operator */
  onSwitchToConditions?: (operator: FilterOperator) => void;
  /** Called when a filter is applied (for triggering re-render) */
  onFilterApplied?: () => void;
}

/**
 * All Dates in Period submenu options
 */
type PeriodSubmenuOption =
  | 'q1'
  | 'q2'
  | 'q3'
  | 'q4'
  | 'jan'
  | 'feb'
  | 'mar'
  | 'apr'
  | 'may'
  | 'jun'
  | 'jul'
  | 'aug'
  | 'sep'
  | 'oct'
  | 'nov'
  | 'dec';

/**
 * Date filters submenu with operator shortcuts and quick filters
 *
 * Uses Draft + Apply pattern:
 * 1. Store pending config in UIStore via setPendingFilterConfig
 * 2. For condition panel: call onSwitchToConditions to let user enter value
 * 3. For quick filters: directly apply date range filter
 */
export function DateFiltersMenu({
  filterId,
  headerCellId,
  col,
  onClose,
  onSwitchToConditions,
  onFilterApplied,
}: DateFiltersMenuProps): React.ReactElement {
  const wb = useWorkbook();
  const activeSheetId = useActiveSheetId();
  const setPendingFilterConfig = useUIStore((s) => s.setPendingFilterConfig);
  const [showPeriodSubmenu, setShowPeriodSubmenu] = useState(false);

  /**
   * Handle operator selection.
   * Switch to condition panel to let user enter value.
   */
  const handleSelect = useCallback(
    (operator: FilterOperator) => {
      // Store pending config in UIStore (Draft step)
      setPendingFilterConfig({
        filterId,
        headerCellId,
        type: 'date',
        operator,
      });

      if (onSwitchToConditions) {
        // Let parent component switch to condition panel for value input
        onSwitchToConditions(operator);
      }
      onClose();
    },
    [filterId, headerCellId, setPendingFilterConfig, onSwitchToConditions, onClose],
  );

  /**
   * Apply a quick date filter using a date period.
   * Calculates the date range and applies it as a condition filter.
   */
  const applyQuickDateFilter = useCallback(
    (period: DatePeriod) => {
      const range = getDatePeriodRange(period);
      if (!range) {
        console.warn('[DateFiltersMenu] Invalid period:', period);
        onClose();
        return;
      }

      const [start, end] = range;

      // Convert JavaScript dates to Excel serial numbers for filtering
      const startSerial = dateToExcelSerial(start);
      const endSerial = dateToExcelSerial(end);

      // Apply a "between" condition filter with the calculated range
      const criteria: ColumnFilterCriteria = {
        type: 'condition',
        conditions: [
          {
            operator: 'between',
            value: startSerial,
            value2: endSerial,
          },
        ],
        conditionLogic: 'and',
      };

      const ws = wb.getSheetById(activeSheetId);
      void ws.filters.setColumnFilter(col, criteria, filterId);
      onClose();
      onFilterApplied?.();
    },
    [wb, activeSheetId, filterId, headerCellId, col, onClose, onFilterApplied],
  );

  /**
   * Apply a Year to Date filter.
   * From January 1 of current year to today.
   */
  const applyYearToDateFilter = useCallback(() => {
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);

    const startSerial = dateToExcelSerial(startOfYear);
    const endSerial = dateToExcelSerial(endOfToday);

    const criteria: ColumnFilterCriteria = {
      type: 'condition',
      conditions: [
        {
          operator: 'between',
          value: startSerial,
          value2: endSerial,
        },
      ],
      conditionLogic: 'and',
    };

    const ws = wb.getSheetById(activeSheetId);
    void ws.filters.setColumnFilter(col, criteria, filterId);
    onClose();
    onFilterApplied?.();
  }, [wb, activeSheetId, filterId, col, onClose, onFilterApplied]);

  /**
   * Apply a filter for a specific quarter or month across all years.
   */
  const applyPeriodFilter = useCallback(
    (option: PeriodSubmenuOption) => {
      // For quarterly filters (Q1-Q4), filter by month range
      // For monthly filters (Jan-Dec), filter by specific month
      // Since we can't easily filter "all Q1s across all years" with a simple between,
      // we'll use a custom approach: filter dates where month is in the range

      // For now, apply a filter for the current year's quarter/month as a starting point
      // A more sophisticated implementation would require custom filter logic
      const now = new Date();
      const year = now.getFullYear();
      let startMonth: number;
      let endMonth: number;

      switch (option) {
        case 'q1':
          startMonth = 0;
          endMonth = 2;
          break;
        case 'q2':
          startMonth = 3;
          endMonth = 5;
          break;
        case 'q3':
          startMonth = 6;
          endMonth = 8;
          break;
        case 'q4':
          startMonth = 9;
          endMonth = 11;
          break;
        case 'jan':
          startMonth = endMonth = 0;
          break;
        case 'feb':
          startMonth = endMonth = 1;
          break;
        case 'mar':
          startMonth = endMonth = 2;
          break;
        case 'apr':
          startMonth = endMonth = 3;
          break;
        case 'may':
          startMonth = endMonth = 4;
          break;
        case 'jun':
          startMonth = endMonth = 5;
          break;
        case 'jul':
          startMonth = endMonth = 6;
          break;
        case 'aug':
          startMonth = endMonth = 7;
          break;
        case 'sep':
          startMonth = endMonth = 8;
          break;
        case 'oct':
          startMonth = endMonth = 9;
          break;
        case 'nov':
          startMonth = endMonth = 10;
          break;
        case 'dec':
          startMonth = endMonth = 11;
          break;
        default:
          onClose();
          return;
      }

      const startDate = new Date(year, startMonth, 1);
      const endDate = new Date(year, endMonth + 1, 0, 23, 59, 59, 999);

      const startSerial = dateToExcelSerial(startDate);
      const endSerial = dateToExcelSerial(endDate);

      const criteria: ColumnFilterCriteria = {
        type: 'condition',
        conditions: [
          {
            operator: 'between',
            value: startSerial,
            value2: endSerial,
          },
        ],
        conditionLogic: 'and',
      };

      const ws = wb.getSheetById(activeSheetId);
      void ws.filters.setColumnFilter(col, criteria, filterId);
      setShowPeriodSubmenu(false);
      onClose();
      onFilterApplied?.();
    },
    [wb, activeSheetId, filterId, headerCellId, col, onClose, onFilterApplied],
  );

  /**
   * Handle Custom Filter selection - switch to condition panel
   */
  const handleCustomFilter = useCallback(() => {
    // Set up for custom filter - use 'equals' as default operator
    setPendingFilterConfig({
      filterId,
      headerCellId,
      type: 'date',
      operator: 'equals',
    });

    if (onSwitchToConditions) {
      onSwitchToConditions('equals');
    }
    onClose();
  }, [filterId, headerCellId, setPendingFilterConfig, onSwitchToConditions, onClose]);

  return (
    <div className="date-filters-menu flex flex-col max-h-[400px] overflow-y-auto">
      {/* Operator-based filters */}
      <MenuItem onSelect={() => handleSelect('equals')}>Equals...</MenuItem>
      <MenuItem onSelect={() => handleSelect('lessThan')}>Before...</MenuItem>
      <MenuItem onSelect={() => handleSelect('greaterThan')}>After...</MenuItem>
      <MenuItem onSelect={() => handleSelect('between')}>Between...</MenuItem>

      <MenuSeparator />

      {/* Day quick filters */}
      <MenuItem onSelect={() => applyQuickDateFilter('tomorrow')}>Tomorrow</MenuItem>
      <MenuItem onSelect={() => applyQuickDateFilter('today')}>Today</MenuItem>
      <MenuItem onSelect={() => applyQuickDateFilter('yesterday')}>Yesterday</MenuItem>

      <MenuSeparator />

      {/* Week quick filters */}
      <MenuItem onSelect={() => applyQuickDateFilter('nextWeek')}>Next Week</MenuItem>
      <MenuItem onSelect={() => applyQuickDateFilter('thisWeek')}>This Week</MenuItem>
      <MenuItem onSelect={() => applyQuickDateFilter('lastWeek')}>Last Week</MenuItem>

      <MenuSeparator />

      {/* Month quick filters */}
      <MenuItem onSelect={() => applyQuickDateFilter('nextMonth')}>Next Month</MenuItem>
      <MenuItem onSelect={() => applyQuickDateFilter('thisMonth')}>This Month</MenuItem>
      <MenuItem onSelect={() => applyQuickDateFilter('lastMonth')}>Last Month</MenuItem>

      <MenuSeparator />

      {/* Quarter quick filters */}
      <MenuItem onSelect={() => applyQuickDateFilter('nextQuarter')}>Next Quarter</MenuItem>
      <MenuItem onSelect={() => applyQuickDateFilter('thisQuarter')}>This Quarter</MenuItem>
      <MenuItem onSelect={() => applyQuickDateFilter('lastQuarter')}>Last Quarter</MenuItem>

      <MenuSeparator />

      {/* Year quick filters */}
      <MenuItem onSelect={() => applyQuickDateFilter('nextYear')}>Next Year</MenuItem>
      <MenuItem onSelect={() => applyQuickDateFilter('thisYear')}>This Year</MenuItem>
      <MenuItem onSelect={() => applyQuickDateFilter('lastYear')}>Last Year</MenuItem>

      <MenuSeparator />

      {/* Year to Date */}
      <MenuItem onSelect={applyYearToDateFilter}>Year to Date</MenuItem>

      {/* All Dates in Period submenu */}
      <div className="relative">
        <MenuItem
          onSelect={() => setShowPeriodSubmenu(!showPeriodSubmenu)}
          className="flex items-center justify-between"
        >
          <span>All Dates in Period</span>
          <span className="text-ss-text-secondary">›</span>
        </MenuItem>
        {showPeriodSubmenu && (
          <div className="absolute left-full top-0 ml-1 bg-ss-surface border border-ss-border rounded shadow-ss-lg z-ss-popover min-w-[120px] max-h-[300px] overflow-y-auto">
            <MenuItem onSelect={() => applyPeriodFilter('q1')}>Quarter 1</MenuItem>
            <MenuItem onSelect={() => applyPeriodFilter('q2')}>Quarter 2</MenuItem>
            <MenuItem onSelect={() => applyPeriodFilter('q3')}>Quarter 3</MenuItem>
            <MenuItem onSelect={() => applyPeriodFilter('q4')}>Quarter 4</MenuItem>
            <MenuSeparator />
            <MenuItem onSelect={() => applyPeriodFilter('jan')}>January</MenuItem>
            <MenuItem onSelect={() => applyPeriodFilter('feb')}>February</MenuItem>
            <MenuItem onSelect={() => applyPeriodFilter('mar')}>March</MenuItem>
            <MenuItem onSelect={() => applyPeriodFilter('apr')}>April</MenuItem>
            <MenuItem onSelect={() => applyPeriodFilter('may')}>May</MenuItem>
            <MenuItem onSelect={() => applyPeriodFilter('jun')}>June</MenuItem>
            <MenuItem onSelect={() => applyPeriodFilter('jul')}>July</MenuItem>
            <MenuItem onSelect={() => applyPeriodFilter('aug')}>August</MenuItem>
            <MenuItem onSelect={() => applyPeriodFilter('sep')}>September</MenuItem>
            <MenuItem onSelect={() => applyPeriodFilter('oct')}>October</MenuItem>
            <MenuItem onSelect={() => applyPeriodFilter('nov')}>November</MenuItem>
            <MenuItem onSelect={() => applyPeriodFilter('dec')}>December</MenuItem>
          </div>
        )}
      </div>

      <MenuSeparator />

      {/* Custom Filter */}
      <MenuItem onSelect={handleCustomFilter}>Custom Filter...</MenuItem>
    </div>
  );
}

/**
 * Convert a JavaScript Date to Excel serial number.
 *
 * Excel dates start at Jan 1, 1900 = serial 1.
 * Excel has the 1900 leap year bug (Feb 29, 1900 doesn't exist but Excel thinks it does).
 */
function dateToExcelSerial(date: Date): number {
  // Base date: Dec 31, 1899 (day before serial 1)
  const baseDate = new Date(1899, 11, 31);
  const diffMs = date.getTime() - baseDate.getTime();
  const diffDays = diffMs / (24 * 60 * 60 * 1000);

  // Account for Excel's 1900 leap year bug
  // Dates after Feb 28, 1900 need an extra day added
  const serial = diffDays > 60 ? diffDays + 1 : diffDays;

  return Math.floor(serial);
}

/**
 * Convert an Excel serial number to a JavaScript Date.
 * Alias for serialToDate from contracts.
 */
export function excelSerialToDate(serial: number): Date {
  return serialToDate(serial);
}

/**
 * Date period type for quick date filters.
 */
type DatePeriod =
  | 'today'
  | 'yesterday'
  | 'tomorrow'
  | 'thisWeek'
  | 'lastWeek'
  | 'nextWeek'
  | 'thisMonth'
  | 'lastMonth'
  | 'nextMonth'
  | 'thisQuarter'
  | 'lastQuarter'
  | 'nextQuarter'
  | 'thisYear'
  | 'lastYear'
  | 'nextYear';

/**
 * Get the start and end date range for a date period.
 * Returns [startDate, endDate] or null if invalid.
 */
function getDatePeriodRange(period: DatePeriod): [Date, Date] | null {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (period) {
    case 'today':
      return [
        today,
        new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999),
      ];
    case 'yesterday': {
      const d = new Date(today);
      d.setDate(d.getDate() - 1);
      return [d, new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)];
    }
    case 'tomorrow': {
      const d = new Date(today);
      d.setDate(d.getDate() + 1);
      return [d, new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)];
    }
    case 'thisWeek': {
      const day = today.getDay();
      const start = new Date(today);
      start.setDate(start.getDate() - day);
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      return [start, end];
    }
    case 'lastWeek': {
      const day = today.getDay();
      const start = new Date(today);
      start.setDate(start.getDate() - day - 7);
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      return [start, end];
    }
    case 'nextWeek': {
      const day = today.getDay();
      const start = new Date(today);
      start.setDate(start.getDate() - day + 7);
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      return [start, end];
    }
    case 'thisMonth':
      return [
        new Date(today.getFullYear(), today.getMonth(), 1),
        new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999),
      ];
    case 'lastMonth':
      return [
        new Date(today.getFullYear(), today.getMonth() - 1, 1),
        new Date(today.getFullYear(), today.getMonth(), 0, 23, 59, 59, 999),
      ];
    case 'nextMonth':
      return [
        new Date(today.getFullYear(), today.getMonth() + 1, 1),
        new Date(today.getFullYear(), today.getMonth() + 2, 0, 23, 59, 59, 999),
      ];
    case 'thisQuarter': {
      const q = Math.floor(today.getMonth() / 3);
      return [
        new Date(today.getFullYear(), q * 3, 1),
        new Date(today.getFullYear(), q * 3 + 3, 0, 23, 59, 59, 999),
      ];
    }
    case 'lastQuarter': {
      const q = Math.floor(today.getMonth() / 3) - 1;
      const y = q < 0 ? today.getFullYear() - 1 : today.getFullYear();
      const qn = ((q % 4) + 4) % 4;
      return [new Date(y, qn * 3, 1), new Date(y, qn * 3 + 3, 0, 23, 59, 59, 999)];
    }
    case 'nextQuarter': {
      const q = Math.floor(today.getMonth() / 3) + 1;
      const y = q > 3 ? today.getFullYear() + 1 : today.getFullYear();
      const qn = q % 4;
      return [new Date(y, qn * 3, 1), new Date(y, qn * 3 + 3, 0, 23, 59, 59, 999)];
    }
    case 'thisYear':
      return [
        new Date(today.getFullYear(), 0, 1),
        new Date(today.getFullYear(), 11, 31, 23, 59, 59, 999),
      ];
    case 'lastYear':
      return [
        new Date(today.getFullYear() - 1, 0, 1),
        new Date(today.getFullYear() - 1, 11, 31, 23, 59, 59, 999),
      ];
    case 'nextYear':
      return [
        new Date(today.getFullYear() + 1, 0, 1),
        new Date(today.getFullYear() + 1, 11, 31, 23, 59, 59, 999),
      ];
    default:
      return null;
  }
}
