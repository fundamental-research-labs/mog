/**
 * FilterDropdown Component
 *
 * Complete (A2.4 + A1 Integration)
 *
 * The main dropdown component for AutoFilter header cells.
 * Includes:
 * - Sort A-Z / Z-A buttons (integrated with sort system)
 * - Tabs for Values and Conditions filter modes
 * - Value filter list (checkbox list of unique values)
 * - Condition filter panel (operator + value inputs)
 * - Clear filter button
 *
 * ARCHITECTURE (Cell Identity Model):
 * This component receives headerCellId (not column index) from the UI store.
 * All filter operations use CellId to ensure criteria follows columns on insert/delete.
 * Layer 0's domain functions handle all position resolution internally.
 *
 * ARCHITECTURE (Radix Popover):
 * Uses Radix Popover (not DropdownMenu) because this is a complex interactive panel
 * with tabs, inputs, and checkboxes - not a simple action menu.
 *
 * Sort integration:
 * - Sort buttons call Mutations.sortRangeByColumn from
 * - Filter range resolved via Filters.resolveFilterRange (Cell Identity pattern)
 * - Header CellId resolved to column position at sort time
 * - hasHeaders=true to exclude filter header row from sort
 *
 * @see layer-0-filter-state-foundation.md for Cell Identity Model
 */

import React, { useCallback, useEffect, useState } from 'react';

import type { FilterDropdownData } from '@mog-sdk/contracts/api';
import type { ColumnFilterCriteria, FilterOperator } from '@mog-sdk/contracts/filter';
import { cellRangeToA1 } from '@mog/spreadsheet-utils/a1';
import { useActiveSheetId, useUIStore, useUIStoreApi, useWorkbook } from '../../infra/context';

import {
  MenuItem,
  Popover,
  PopoverAnchor,
  PopoverContent,
  useVirtualRef,
} from '@mog/shell/components/ui';
import { ColorFiltersMenu } from './ColorFiltersMenu';
import { ConditionFilterPanel } from './ConditionFilterPanel';
import { DateFiltersMenu } from './DateFiltersMenu';
import { DateValueFilterList } from './DateValueFilterList';
import { detectColumnType, getUniqueColors } from './filter-utils';
import { NumberFiltersMenu } from './NumberFiltersMenu';
import { SortByColorMenu } from './SortByColorMenu';
import { TextFiltersMenu } from './TextFiltersMenu';
import { ValueFilterList, type ValueFilterSelection } from './ValueFilterList';

export interface FilterDropdownProps {
  /** Called when a filter action is performed (for triggering re-render) */
  onFilterApplied?: () => void;
}

type FilterTab = 'values' | 'conditions';
type ActiveSubmenu = 'number' | 'text' | 'date' | 'color' | 'sortByColor' | null;

/**
 * Filter dropdown menu for AutoFilter header cells.
 *
 * Full implementation with value list, conditions, and sort.
 * B4: Excel-parity quickwins - Added Number Filters, Text Filters, Color Filters submenus
 */
export function FilterDropdown({
  onFilterApplied,
}: FilterDropdownProps): React.ReactElement | null {
  const activeSheetId = useActiveSheetId();
  const wb = useWorkbook();

  // Get UI store API for imperative actions
  const uiStoreApi = useUIStoreApi();

  // Subscribe to filter dropdown state changes using atomic selectors
  // Each selector returns a primitive or stable reference to prevent unnecessary re-renders
  const isOpen = useUIStore((s) => s.filterDropdown.isOpen);
  const filterId = useUIStore((s) => s.filterDropdown.filterId);
  const headerCellId = useUIStore((s) => s.filterDropdown.headerCellId);
  const position = useUIStore((s) => s.filterDropdown.position);
  const [headerCol, setHeaderCol] = useState<number | null>(null);

  // Virtual reference for Radix Popover positioning
  const { virtualRef, setPosition: setVirtualPosition } = useVirtualRef();

  // Sync UIStore position to virtualRef for Radix Popover
  useEffect(() => {
    if (position) {
      setVirtualPosition(position.x, position.y);
    }
  }, [position, setVirtualPosition]);

  // Active tab state
  const [activeTab, setActiveTab] = useState<FilterTab>('values');

  // Submenu state (B4: Excel-parity quickwins)
  const [activeSubmenu, setActiveSubmenu] = useState<ActiveSubmenu>(null);

  // Pending operator for condition panel (when switching from submenu)
  const [pendingOperator, setPendingOperator] = useState<FilterOperator | null>(null);

  // Get filter state via Worksheet API (async)
  // Only store the fields we actually use (id + columnFilters)
  const [filter, setFilter] = useState<{
    id: string;
    columnFilters: Record<string, ColumnFilterCriteria>;
  } | null>(null);
  useEffect(() => {
    if (!filterId || !isOpen) {
      setFilter(null);
      return;
    }
    let stale = false;
    const ws = wb.getSheetById(activeSheetId);
    void ws.filters.getInfo(filterId).then((info) => {
      if (!stale) setFilter(info ? { id: info.id, columnFilters: info.columnFilters } : null);
    });
    return () => {
      stale = true;
    };
  }, [wb, activeSheetId, filterId, isOpen]);

  useEffect(() => {
    if (!headerCellId || !isOpen) {
      setHeaderCol(null);
      return;
    }
    let stale = false;
    const ws = wb.getSheetById(activeSheetId);
    void ws._internal.batchGetCellPositions([headerCellId]).then((positions) => {
      if (!stale) setHeaderCol(positions.get(headerCellId)?.col ?? null);
    });
    return () => {
      stale = true;
    };
  }, [wb, activeSheetId, headerCellId, isOpen]);

  const [dropdownData, setDropdownData] = useState<FilterDropdownData | null>(null);
  useEffect(() => {
    if (!filterId || headerCol === null || !isOpen) {
      setDropdownData(null);
      return;
    }
    let stale = false;
    const ws = wb.getSheetById(activeSheetId);
    void ws.filters.getFilterDropdownData(headerCol, filterId).then((data) => {
      if (!stale) setDropdownData(data);
    });
    return () => {
      stale = true;
    };
  }, [wb, activeSheetId, filterId, headerCol, isOpen]);

  // Detect column type for showing appropriate filter submenu (B4: Excel-parity)
  const columnType =
    dropdownData?.columnType ??
    detectColumnType((dropdownData?.items ?? []).map((item) => item.value));

  // Check if column has colors (for showing Color Filters submenu)
  const [hasColors, setHasColors] = useState(false);
  useEffect(() => {
    if (!filter || headerCol === null || !isOpen || !filterId) {
      setHasColors(false);
      return;
    }
    let stale = false;
    void (async () => {
      const ws = wb.getSheetById(activeSheetId);

      const filterInfo = await ws.filters.getInfo(filterId);
      if (!filterInfo || stale) return;
      const range = filterInfo.range;

      const rows: number[] = [];
      for (let row = range.startRow + 1; row <= range.endRow; row++) {
        rows.push(row);
      }

      const bgColors = await getUniqueColors(ws, rows, headerCol, 'fill');
      const fontColors = await getUniqueColors(ws, rows, headerCol, 'font');
      if (!stale) setHasColors(bgColors.length > 0 || fontColors.length > 0);
    })();
    return () => {
      stale = true;
    };
  }, [wb, activeSheetId, filter, headerCol, isOpen, filterId]);

  // Get current criteria for this column (keyed by CellId in Layer 0)
  const currentCriteria =
    filter && headerCellId ? (filter.columnFilters[headerCellId] ?? null) : null;

  // Determine initial tab based on existing criteria
  useEffect(() => {
    if (currentCriteria) {
      setActiveTab(currentCriteria.type === 'condition' ? 'conditions' : 'values');
    } else {
      setActiveTab('values');
    }
    // Reset submenu and pending operator when dropdown reopens
    setActiveSubmenu(null);
    setPendingOperator(null);
  }, [currentCriteria, isOpen]);

  // Close dropdown helper
  const handleClose = useCallback(() => {
    uiStoreApi.getState().closeFilterDropdown();
  }, [uiStoreApi]);

  // Handle Radix Popover open change
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        handleClose();
      }
    },
    [handleClose],
  );

  // Apply value filter (using CellId - Worksheet API)
  const handleApplyValueFilter = useCallback(
    (selection: ValueFilterSelection) => {
      if (!filterId || !headerCellId || headerCol === null) return;

      const criteria: ColumnFilterCriteria = {
        type: 'value',
        values: selection.values,
        includeBlanks: selection.includeBlanks,
      };

      const ws = wb.getSheetById(activeSheetId);
      void ws.filters.setColumnFilter(headerCol, criteria, filterId);
      handleClose();
      onFilterApplied?.();
    },
    [wb, activeSheetId, filterId, headerCellId, headerCol, handleClose, onFilterApplied],
  );

  // Apply condition filter (using CellId - Worksheet API)
  const handleApplyConditionFilter = useCallback(
    (criteria: ColumnFilterCriteria) => {
      if (!filterId || !headerCellId || headerCol === null) return;

      const ws = wb.getSheetById(activeSheetId);
      void ws.filters.setColumnFilter(headerCol, criteria, filterId);
      handleClose();
      onFilterApplied?.();
    },
    [wb, activeSheetId, filterId, headerCellId, headerCol, handleClose, onFilterApplied],
  );

  // Clear filter (using CellId - Worksheet API)
  const handleClearFilter = useCallback(() => {
    if (!filterId || !headerCellId || headerCol === null) return;

    const ws = wb.getSheetById(activeSheetId);
    void ws.filters.clearColumnFilter(headerCol, filterId);
    handleClose();
    onFilterApplied?.();
  }, [wb, activeSheetId, filterId, headerCellId, headerCol, handleClose, onFilterApplied]);

  // Sort handlers - integrated with sort system
  const handleSortAsc = useCallback(async () => {
    if (!filterId || !headerCellId || headerCol === null) return;

    const ws = wb.getSheetById(activeSheetId);

    // Get filter info (includes resolved range)
    const filterInfo = await ws.filters.getInfo(filterId);
    if (!filterInfo) {
      console.warn('[FilterDropdown] Cannot sort: filter range invalid (corner cell deleted)');
      handleClose();
      return;
    }
    const range = filterInfo.range;

    // Sort using Worksheet API
    // hasHeaders=true because filter header row should not be sorted
    void ws.sortRange(cellRangeToA1(range), {
      columns: [{ column: headerCol - range.startCol, direction: 'asc' }],
      hasHeaders: true,
      visibleRowsOnly: true,
    });
    handleClose();
    onFilterApplied?.();
  }, [wb, activeSheetId, filterId, headerCellId, headerCol, handleClose, onFilterApplied]);

  const handleSortDesc = useCallback(async () => {
    if (!filterId || !headerCellId || headerCol === null) return;

    const ws = wb.getSheetById(activeSheetId);

    const filterInfo = await ws.filters.getInfo(filterId);
    if (!filterInfo) {
      console.warn('[FilterDropdown] Cannot sort: filter range invalid (corner cell deleted)');
      handleClose();
      return;
    }
    const range = filterInfo.range;

    // Sort using Worksheet API
    // hasHeaders=true because filter header row should not be sorted
    void ws.sortRange(cellRangeToA1(range), {
      columns: [{ column: headerCol - range.startCol, direction: 'desc' }],
      hasHeaders: true,
      visibleRowsOnly: true,
    });
    handleClose();
    onFilterApplied?.();
  }, [wb, activeSheetId, filterId, headerCellId, headerCol, handleClose, onFilterApplied]);

  // Handler for switching to condition panel from submenu with pre-selected operator
  const handleSwitchToConditions = useCallback((operator: FilterOperator) => {
    setPendingOperator(operator);
    setActiveTab('conditions');
    setActiveSubmenu(null);
  }, []);

  // Don't render if missing required data (isOpen is handled by Popover)
  if (!filterId || !headerCellId || headerCol === null) {
    return null;
  }

  // Use already-loaded filter state (from useEffect above)
  if (!filter) {
    return null;
  }

  // Get condition criteria for ConditionFilterPanel
  const conditionCriteria =
    currentCriteria?.type === 'condition'
      ? { conditions: currentCriteria.conditions, conditionLogic: currentCriteria.conditionLogic }
      : undefined;

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      {position && <PopoverAnchor virtualRef={virtualRef} />}
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={0}
        className="p-0 overflow-hidden"
        style={{ width: '280px', maxHeight: '450px' }}
      >
        {/* Sort buttons section */}
        <div className="border-b border-ss-border py-1">
          <MenuItem onSelect={handleSortAsc}>
            <span className="text-ss-text-secondary mr-2">↑</span>
            Sort A to Z
          </MenuItem>
          <MenuItem onSelect={handleSortDesc}>
            <span className="text-ss-text-secondary mr-2">↓</span>
            Sort Z to A
          </MenuItem>

          {/* Sort by Color - shown when column has colored cells */}
          {hasColors && (
            <div className="relative">
              <MenuItem
                onSelect={() =>
                  setActiveSubmenu(activeSubmenu === 'sortByColor' ? null : 'sortByColor')
                }
                className="justify-between"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="text-ss-text-secondary mr-2"
                >
                  <rect x="4" y="4" width="6" height="6" rx="1" fill="var(--color-ss-success)" />
                  <rect x="4" y="14" width="6" height="6" rx="1" fill="var(--color-ss-primary)" />
                  <path d="M14 7h6M14 17h6M16 4l-2 3h4l-2 3M16 14l2 3h-4l2 3" />
                </svg>
                <span className="flex-1">Sort by Color</span>
                <span className="text-ss-text-secondary">›</span>
              </MenuItem>
              {activeSubmenu === 'sortByColor' && (
                <div className="absolute left-full top-0 ml-1 bg-ss-surface border border-ss-border rounded shadow-ss-lg z-ss-popover min-w-[180px]">
                  <SortByColorMenu
                    sheetId={activeSheetId}
                    filterId={filterId}
                    headerCellId={headerCellId}
                    col={headerCol}
                    onClose={() => {
                      setActiveSubmenu(null);
                      handleClose();
                    }}
                    onSortApplied={onFilterApplied}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Filter Type Submenus - B4: Excel-parity quickwins */}
        <div className="border-b border-ss-border py-1">
          {/* Number Filters - shown for number columns only */}
          {columnType === 'number' && (
            <div className="relative">
              <MenuItem
                onSelect={() => setActiveSubmenu(activeSubmenu === 'number' ? null : 'number')}
                className="justify-between"
              >
                <span className="flex-1">Number Filters</span>
                <span className="text-ss-text-secondary">›</span>
              </MenuItem>
              {activeSubmenu === 'number' && (
                <div className="absolute left-full top-0 ml-1 bg-ss-surface border border-ss-border rounded shadow-ss-lg z-ss-popover min-w-[180px]">
                  <NumberFiltersMenu
                    filterId={filterId}
                    headerCellId={headerCellId}
                    onClose={() => setActiveSubmenu(null)}
                    onSwitchToConditions={handleSwitchToConditions}
                  />
                </div>
              )}
            </div>
          )}

          {/* Date Filters - shown for date columns */}
          {columnType === 'date' && (
            <div className="relative">
              <MenuItem
                onSelect={() => setActiveSubmenu(activeSubmenu === 'date' ? null : 'date')}
                className="justify-between"
              >
                <span className="flex-1">Date Filters</span>
                <span className="text-ss-text-secondary">›</span>
              </MenuItem>
              {activeSubmenu === 'date' && (
                <div className="absolute left-full top-0 ml-1 bg-ss-surface border border-ss-border rounded shadow-ss-lg z-ss-popover min-w-[180px]">
                  <DateFiltersMenu
                    filterId={filterId}
                    headerCellId={headerCellId}
                    col={headerCol}
                    onClose={() => setActiveSubmenu(null)}
                    onSwitchToConditions={handleSwitchToConditions}
                    onFilterApplied={onFilterApplied}
                  />
                </div>
              )}
            </div>
          )}

          {/* Text Filters - shown for text and mixed columns */}
          {(columnType === 'text' || columnType === 'mixed') && (
            <div className="relative">
              <MenuItem
                onSelect={() => setActiveSubmenu(activeSubmenu === 'text' ? null : 'text')}
                className="justify-between"
              >
                <span className="flex-1">Text Filters</span>
                <span className="text-ss-text-secondary">›</span>
              </MenuItem>
              {activeSubmenu === 'text' && (
                <div className="absolute left-full top-0 ml-1 bg-ss-surface border border-ss-border rounded shadow-ss-lg z-ss-popover min-w-[180px]">
                  <TextFiltersMenu
                    filterId={filterId}
                    headerCellId={headerCellId}
                    onClose={() => setActiveSubmenu(null)}
                    onSwitchToConditions={handleSwitchToConditions}
                  />
                </div>
              )}
            </div>
          )}

          {/* Color Filters - shown when column has colored cells */}
          {hasColors && (
            <div className="relative">
              <MenuItem
                onSelect={() => setActiveSubmenu(activeSubmenu === 'color' ? null : 'color')}
                className="justify-between"
              >
                <span className="flex-1">Filter by Color</span>
                <span className="text-ss-text-secondary">›</span>
              </MenuItem>
              {activeSubmenu === 'color' && (
                <div className="absolute left-full top-0 ml-1 bg-ss-surface border border-ss-border rounded shadow-ss-lg z-ss-popover min-w-[180px]">
                  <ColorFiltersMenu
                    sheetId={activeSheetId}
                    filterId={filterId}
                    headerCellId={headerCellId}
                    col={headerCol}
                    onClose={() => {
                      setActiveSubmenu(null);
                      handleClose();
                      onFilterApplied?.();
                    }}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-ss-border">
          <button
            type="button"
            onClick={() => setActiveTab('values')}
            className={`flex-1 px-3 py-2 text-body-sm font-medium transition-colors ${
              activeTab === 'values'
                ? 'text-ss-primary border-b-2 border-ss-primary bg-ss-surface'
                : 'text-ss-text-secondary hover:text-ss-text hover:bg-ss-surface-hover'
            }`}
          >
            Filter by Value
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('conditions')}
            className={`flex-1 px-3 py-2 text-body-sm font-medium transition-colors ${
              activeTab === 'conditions'
                ? 'text-ss-primary border-b-2 border-ss-primary bg-ss-surface'
                : 'text-ss-text-secondary hover:text-ss-text hover:bg-ss-surface-hover'
            }`}
          >
            Filter by Condition
          </button>
        </div>

        {/* Filter content */}
        <div className="p-3" style={{ maxHeight: '300px', overflowY: 'auto' }}>
          {activeTab === 'values' ? (
            columnType === 'date' ? (
              dropdownData && (
                <DateValueFilterList
                  items={dropdownData.items}
                  hasBlank={dropdownData.hasBlank}
                  blankCount={dropdownData.blankCount}
                  blankSelected={dropdownData.blankSelected}
                  onApply={handleApplyValueFilter}
                  onCancel={handleClose}
                />
              )
            ) : (
              dropdownData && (
                <ValueFilterList
                  items={dropdownData.items}
                  hasBlank={dropdownData.hasBlank}
                  blankCount={dropdownData.blankCount}
                  blankSelected={dropdownData.blankSelected}
                  onApply={handleApplyValueFilter}
                  onCancel={handleClose}
                />
              )
            )
          ) : (
            <ConditionFilterPanel
              currentCriteria={conditionCriteria}
              initialOperator={pendingOperator}
              onApply={handleApplyConditionFilter}
              onCancel={handleClose}
            />
          )}
        </div>

        {/* Footer with Clear Filter button */}
        {currentCriteria && (
          <div className="p-2 border-t border-ss-border bg-ss-surface">
            <button
              type="button"
              onClick={handleClearFilter}
              className="w-full px-3 py-1.5 text-body-sm text-ss-error hover:bg-ss-error/10 rounded border border-ss-error/30"
            >
              Clear Filter from Column
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export default FilterDropdown;
