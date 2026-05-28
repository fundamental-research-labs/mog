/**
 * FilterDropdownContent Component
 *
 * The content portion of the filter dropdown, extracted from FilterDropdown.tsx
 * for use with real DOM triggers (FilterButtonOverlay) instead of virtual anchors.
 *
 * This component contains all the filter UI:
 * - Sort A-Z / Z-A buttons
 * - Sort by Color submenu
 * - Number/Text/Date/Color filter submenus
 * - Value filter tab (checkboxes)
 * - Condition filter tab
 * - Clear filter button
 *
 * ARCHITECTURE (Cell Identity Model):
 * All filter operations use CellId (not column index) to ensure criteria
 * follows columns on insert/delete. Layer 0's domain functions handle
 * all position resolution internally.
 *
 * @see FilterDropdown.tsx - Original component (still used for legacy virtual anchor path)
 * @see FilterButtonOverlay.tsx - Uses this content with real DOM triggers
 */

import React, { useCallback, useEffect, useState } from 'react';

import type { FilterDropdownData, Worksheet } from '@mog-sdk/contracts/api';
import { toCellId } from '@mog-sdk/contracts/cell-identity';
import type { ColumnFilterCriteria, FilterOperator } from '@mog-sdk/contracts/filter';
import { cellRangeToA1 } from '@mog/spreadsheet-utils/a1';
import { useActiveSheetId, useWorkbook } from '../../infra/context';

import { MenuItem } from '@mog/shell/components/ui';
import { ColorFiltersMenu } from './ColorFiltersMenu';
import { ConditionFilterPanel } from './ConditionFilterPanel';
import { DateFiltersMenu } from './DateFiltersMenu';
import { DateValueFilterList } from './DateValueFilterList';
import { detectColumnType, getUniqueColors } from './filter-utils';
import { NumberFiltersMenu } from './NumberFiltersMenu';
import { SortByColorMenu } from './SortByColorMenu';
import { TextFiltersMenu } from './TextFiltersMenu';
import { ValueFilterList, type ValueFilterSelection } from './ValueFilterList';

export interface FilterDropdownContentProps {
  /** The filter ID from the table/filter definition */
  filterId: string;
  /** The CellId of the header cell (not column index) */
  headerCellId: string;
  /** 0-based column index of this filter button (from FilterButtonMetadata.col) */
  col?: number;
  /** Whether this column has an active filter */
  hasActiveFilter: boolean;
  /** Callback to close the popover (from Radix context or parent) */
  onClose: () => void;
  /** Optional callback when a filter action is performed */
  onFilterApplied?: () => void;
}

type FilterTab = 'values' | 'conditions';
type ActiveSubmenu = 'number' | 'text' | 'date' | 'color' | 'sortByColor' | null;

function tableRangeMatchesFilter(
  tableRange: string,
  range: { startRow: number; startCol: number; endRow: number; endCol: number },
): boolean {
  const a1 = cellRangeToA1(range);
  return tableRange.toUpperCase() === a1.toUpperCase();
}

async function sortFilterRange(
  ws: Worksheet,
  filterId: string,
  col: number,
  direction: 'asc' | 'desc',
): Promise<void> {
  const filterInfo = await ws.filters.getInfo(filterId);
  if (!filterInfo) {
    console.warn('[FilterDropdownContent] Cannot sort: filter range invalid');
    return;
  }
  const range = filterInfo.range;
  const tables = await ws.tables.list();
  const filterTableId = (filterInfo as { tableId?: string }).tableId;
  const table =
    (filterTableId ? tables.find((candidate) => candidate.id === filterTableId) : undefined) ??
    tables.find((candidate) => tableRangeMatchesFilter(candidate.range, range));

  if (table) {
    await ws.tables.sort.apply(table.name, [
      { columnIndex: col - range.startCol, ascending: direction === 'asc' },
    ]);
    return;
  }

  await ws.sortRange(cellRangeToA1(range), {
    columns: [{ column: col - range.startCol, direction }],
    hasHeaders: true,
    visibleRowsOnly: true,
  });
}

/**
 * Filter dropdown content for AutoFilter header cells.
 *
 * This is the extracted content from FilterDropdown that can be used
 * with any Popover (virtual anchor or real DOM trigger).
 */
export function FilterDropdownContent({
  filterId,
  headerCellId,
  col,
  hasActiveFilter: _hasActiveFilter,
  onClose,
  onFilterApplied,
}: FilterDropdownContentProps): React.ReactElement | null {
  const activeSheetId = useActiveSheetId();
  const wb = useWorkbook();

  // Active tab state
  const [activeTab, setActiveTab] = useState<FilterTab>('values');

  // Submenu state (B4: Excel-parity quickwins)
  const [activeSubmenu, setActiveSubmenu] = useState<ActiveSubmenu>(null);

  // Pending operator for condition panel (when switching from submenu)
  const [, setPendingOperator] = useState<FilterOperator | null>(null);

  // Get filter state via Worksheet API (async)
  // Only store the fields we actually use (id + columnFilters)
  const [filter, setFilter] = useState<{
    id: string;
    columnFilters: Record<string, ColumnFilterCriteria>;
  } | null>(null);
  useEffect(() => {
    if (!filterId) {
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
  }, [wb, activeSheetId, filterId]);

  const [dropdownData, setDropdownData] = useState<FilterDropdownData | null>(null);
  useEffect(() => {
    if (!filterId || !headerCellId) {
      setDropdownData(null);
      return;
    }
    if (col === undefined) {
      setDropdownData(null);
      return;
    }
    let stale = false;
    const ws = wb.getSheetById(activeSheetId);
    void ws.filters.getFilterDropdownData(col, filterId).then((data) => {
      if (!stale) setDropdownData(data);
    });
    return () => {
      stale = true;
    };
  }, [wb, activeSheetId, filterId, headerCellId, col]);

  // Detect column type for showing appropriate filter submenu (B4: Excel-parity)
  const columnType = detectColumnType((dropdownData?.items ?? []).map((item) => item.value));

  // Check if column has colors (for showing Color Filters submenu)
  const [hasColors, setHasColors] = useState(false);
  useEffect(() => {
    if (!filter || !headerCellId || !filterId || col === undefined) {
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

      const bgColors = await getUniqueColors(ws, rows, col, 'fill');
      const fontColors = await getUniqueColors(ws, rows, col, 'font');
      if (!stale) setHasColors(bgColors.length > 0 || fontColors.length > 0);
    })();
    return () => {
      stale = true;
    };
  }, [wb, activeSheetId, filter, headerCellId, filterId, col]);

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
    // Reset submenu and pending operator when content mounts
    setActiveSubmenu(null);
    setPendingOperator(null);
  }, [currentCriteria]);

  // Apply value filter (using column-index-based Worksheet API)
  const handleApplyValueFilter = useCallback(
    (selection: ValueFilterSelection) => {
      if (!filterId || !headerCellId || col === undefined) return;

      const criteria: ColumnFilterCriteria = {
        type: 'value',
        values: selection.values,
        includeBlanks: selection.includeBlanks,
      };

      const ws = wb.getSheetById(activeSheetId);
      void ws.filters.setColumnFilter(col, criteria, filterId);
      onClose();
      onFilterApplied?.();
    },
    [wb, activeSheetId, filterId, headerCellId, col, onClose, onFilterApplied],
  );

  // Apply condition filter (using column-index-based Worksheet API)
  const handleApplyConditionFilter = useCallback(
    (criteria: ColumnFilterCriteria) => {
      if (!filterId || !headerCellId || col === undefined) return;

      const ws = wb.getSheetById(activeSheetId);
      void ws.filters.setColumnFilter(col, criteria, filterId);
      onClose();
      onFilterApplied?.();
    },
    [wb, activeSheetId, filterId, headerCellId, col, onClose, onFilterApplied],
  );

  // Clear filter (using column-index-based Worksheet API)
  const handleClearFilter = useCallback(() => {
    if (!filterId || !headerCellId || col === undefined) return;

    const ws = wb.getSheetById(activeSheetId);
    void ws.filters.clearColumnFilter(col, filterId);
    onClose();
    onFilterApplied?.();
  }, [wb, activeSheetId, filterId, headerCellId, col, onClose, onFilterApplied]);

  // Sort handlers - integrated with sort system
  const handleSortAsc = useCallback(async () => {
    if (!filterId || !headerCellId || col === undefined) return;

    const ws = wb.getSheetById(activeSheetId);
    await sortFilterRange(ws, filterId, col, 'asc');
    onClose();
    onFilterApplied?.();
  }, [wb, activeSheetId, filterId, headerCellId, col, onClose, onFilterApplied]);

  const handleSortDesc = useCallback(async () => {
    if (!filterId || !headerCellId || col === undefined) return;

    const ws = wb.getSheetById(activeSheetId);
    await sortFilterRange(ws, filterId, col, 'desc');
    onClose();
    onFilterApplied?.();
  }, [wb, activeSheetId, filterId, headerCellId, col, onClose, onFilterApplied]);

  // Handler for switching to condition panel from submenu with pre-selected operator
  const handleSwitchToConditions = useCallback((operator: FilterOperator) => {
    setPendingOperator(operator);
    setActiveTab('conditions');
    setActiveSubmenu(null);
  }, []);

  // Don't render if missing required data (col is now required for correct API calls)
  if (!filterId || !headerCellId || col === undefined) {
    return null;
  }

  const brandedHeaderCellId = toCellId(headerCellId);

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
    <div
      className="flex min-h-0 w-full flex-col overflow-hidden"
      data-testid="filter-dropdown-content"
    >
      {/* Sort buttons section */}
      <div className="shrink-0 border-b border-ss-border py-1">
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
                <rect x="4" y="4" width="6" height="6" rx="1" fill="#4CAF50" />
                <rect x="4" y="14" width="6" height="6" rx="1" fill="#2196F3" />
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
                  headerCellId={brandedHeaderCellId}
                  col={col}
                  onClose={() => {
                    setActiveSubmenu(null);
                    onClose();
                  }}
                  onSortApplied={onFilterApplied}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Filter Type Submenus - B4: Excel-parity quickwins */}
      <div className="shrink-0 border-b border-ss-border py-1">
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
                  headerCellId={brandedHeaderCellId}
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
                  headerCellId={brandedHeaderCellId}
                  col={col}
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
                  headerCellId={brandedHeaderCellId}
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
                  headerCellId={brandedHeaderCellId}
                  col={col}
                  onClose={() => {
                    setActiveSubmenu(null);
                    onClose();
                    onFilterApplied?.();
                  }}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex shrink-0 border-b border-ss-border">
        <button
          type="button"
          data-testid="filter-tab-values"
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
          data-testid="filter-tab-conditions"
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
      <div
        className="min-h-0 overflow-y-auto p-3"
        data-testid="filter-values-panel"
        style={{
          maxHeight:
            'min(300px, max(160px, calc(var(--radix-popper-available-height, 450px) - 150px)))',
        }}
      >
        {activeTab === 'values' ? (
          columnType === 'date' ? (
            dropdownData && (
              <DateValueFilterList
                items={dropdownData.items}
                hasBlank={dropdownData.hasBlank}
                blankCount={dropdownData.blankCount}
                blankSelected={dropdownData.blankSelected}
                onApply={handleApplyValueFilter}
                onCancel={onClose}
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
                onCancel={onClose}
              />
            )
          )
        ) : (
          <ConditionFilterPanel
            currentCriteria={conditionCriteria}
            onApply={handleApplyConditionFilter}
            onCancel={onClose}
          />
        )}
      </div>

      {/* Footer with Clear Filter button */}
      {currentCriteria && (
        <div className="shrink-0 p-2 border-t border-ss-border bg-ss-surface">
          <button
            type="button"
            data-testid="filter-clear-column"
            onClick={handleClearFilter}
            className="w-full px-3 py-1.5 text-body-sm text-ss-error hover:bg-ss-error/10 rounded border border-ss-error/30"
          >
            Clear Filter from Column
          </button>
        </div>
      )}
    </div>
  );
}

export default FilterDropdownContent;
