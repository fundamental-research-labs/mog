/**
 * FilterDropdownContent Component
 *
 * Filter dropdown content used with real DOM triggers from FilterButtonOverlay.
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
 * @see FilterButtonOverlay.tsx - Uses this content with real DOM triggers
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';

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
import { FilterSubmenu } from './FilterSubmenu';
import { NumberFiltersMenu } from './NumberFiltersMenu';
import { SortByColorMenu } from './SortByColorMenu';
import { TextFiltersMenu } from './TextFiltersMenu';
import { Top10FilterDialog, type Top10FilterConfig } from './Top10FilterDialog';
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
type FilterOperationReceipt = {
  readonly status: string;
  readonly effects: readonly unknown[];
  readonly diagnostics: readonly { severity?: string; message?: string }[];
};

type PendingFilterActionGlobal = typeof globalThis & {
  __MOG_PENDING_FILTER_ACTION__?: Promise<void>;
};

const FILTER_ACTION_APPLY_DELAY_MS = 100;

function trackPendingFilterAction(action: () => Promise<void>): void {
  const global = globalThis as PendingFilterActionGlobal;
  const pending = new Promise<void>((resolve, reject) => {
    globalThis.setTimeout(() => {
      Promise.resolve()
        .then(action)
        .then(() => resolve(), reject);
    }, FILTER_ACTION_APPLY_DELAY_MS);
  });
  const tracked = pending.then(
    () => {
      if (global.__MOG_PENDING_FILTER_ACTION__ === tracked) {
        delete global.__MOG_PENDING_FILTER_ACTION__;
      }
    },
    (error) => {
      if (global.__MOG_PENDING_FILTER_ACTION__ === tracked) {
        delete global.__MOG_PENDING_FILTER_ACTION__;
      }
      throw error;
    },
  );
  global.__MOG_PENDING_FILTER_ACTION__ = tracked;
  void tracked.catch(() => undefined);
}

function filterReceiptError(receipt: unknown, fallback: string): string | null {
  if (typeof receipt !== 'object' || receipt === null) return null;
  const maybe = receipt as Partial<FilterOperationReceipt>;
  if (
    typeof maybe.status !== 'string' ||
    !Array.isArray(maybe.effects) ||
    !Array.isArray(maybe.diagnostics)
  ) {
    return null;
  }
  if (maybe.status !== 'failed' && maybe.status !== 'unsupported' && maybe.status !== 'noOp') {
    return null;
  }
  return (
    maybe.diagnostics.find((diagnostic) => diagnostic.severity === 'error')?.message ??
    maybe.diagnostics[0]?.message ??
    fallback
  );
}

async function runFilterMutation(
  mutation: () => Promise<unknown>,
  onApplied: () => void,
  fallback: string,
): Promise<void> {
  try {
    const receipt = await mutation();
    const error = filterReceiptError(receipt, fallback);
    if (error) {
      console.warn(error, receipt);
      return;
    }
    onApplied();
  } catch (error) {
    console.warn(fallback, error);
  }
}

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
 * Filter dropdown content for AutoFilter header cells.
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
  const contentRef = useRef<HTMLDivElement>(null);

  // Active tab state
  const [activeTab, setActiveTab] = useState<FilterTab>('values');

  // Submenu state (B4: Excel-parity quickwins)
  const [activeSubmenu, setActiveSubmenu] = useState<ActiveSubmenu>(null);

  // Pending operator for condition panel (when switching from submenu)
  const [pendingOperator, setPendingOperator] = useState<FilterOperator | null>(null);

  const [top10DialogOpen, setTop10DialogOpen] = useState(false);

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
    const ws = wb.getSheetById(activeSheetId) as unknown as Worksheet;
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
  const columnType =
    dropdownData?.columnType ??
    detectColumnType((dropdownData?.items ?? []).map((item) => item.value));

  // Check if column has colors (for showing Color Filters submenu)
  const [hasColors, setHasColors] = useState(false);
  useEffect(() => {
    if (!filter || !headerCellId || !filterId || col === undefined) {
      setHasColors(false);
      return;
    }
    let stale = false;
    void (async () => {
      const ws = wb.getSheetById(activeSheetId) as unknown as Worksheet;

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
      void runFilterMutation(
        () => ws.filters.setColumnFilter(col, criteria, filterId),
        () => {
          onClose();
          onFilterApplied?.();
        },
        'Value filter did not apply.',
      );
    },
    [wb, activeSheetId, filterId, headerCellId, col, onClose, onFilterApplied],
  );

  // Apply condition filter (using column-index-based Worksheet API)
  const handleApplyConditionFilter = useCallback(
    (criteria: ColumnFilterCriteria) => {
      if (!filterId || !headerCellId || col === undefined) return;

      const ws = wb.getSheetById(activeSheetId);
      void runFilterMutation(
        () => ws.filters.setColumnFilter(col, criteria, filterId),
        () => {
          onClose();
          onFilterApplied?.();
        },
        'Condition filter did not apply.',
      );
    },
    [wb, activeSheetId, filterId, headerCellId, col, onClose, onFilterApplied],
  );

  // Clear filter (using column-index-based Worksheet API)
  const handleClearFilter = useCallback(() => {
    if (!filterId || !headerCellId || col === undefined) return;

    const ws = wb.getSheetById(activeSheetId) as unknown as Worksheet;
    void runFilterMutation(
      () => ws.filters.clearColumnFilter(col, filterId),
      () => {
        onClose();
        onFilterApplied?.();
      },
      'Column filter did not clear.',
    );
  }, [wb, activeSheetId, filterId, headerCellId, col, onClose, onFilterApplied]);

  const handleApplyTop10Filter = useCallback(
    (config: Top10FilterConfig) => {
      if (!filterId || !headerCellId || col === undefined) return;

      const ws = wb.getSheetById(activeSheetId) as unknown as Worksheet;
      void runFilterMutation(
        () =>
          ws.filters.setColumnFilter(
            col,
            {
              type: 'top10',
              topBottom: config,
            },
            filterId,
          ),
        () => {
          setTop10DialogOpen(false);
          onClose();
          onFilterApplied?.();
        },
        'Top 10 filter did not apply.',
      );
    },
    [wb, activeSheetId, filterId, headerCellId, col, onClose, onFilterApplied],
  );

  // Sort handlers - integrated with sort system
  const handleSortAsc = useCallback(() => {
    if (!filterId || !headerCellId || col === undefined) return;

    const ws = wb.getSheetById(activeSheetId) as unknown as Worksheet;
    onClose();
    trackPendingFilterAction(async () => {
      await sortFilterRange(ws, filterId, col, 'asc');
      onFilterApplied?.();
    });
  }, [wb, activeSheetId, filterId, headerCellId, col, onClose, onFilterApplied]);

  const handleSortDesc = useCallback(() => {
    if (!filterId || !headerCellId || col === undefined) return;

    const ws = wb.getSheetById(activeSheetId) as unknown as Worksheet;
    onClose();
    trackPendingFilterAction(async () => {
      await sortFilterRange(ws, filterId, col, 'desc');
      onFilterApplied?.();
    });
  }, [wb, activeSheetId, filterId, headerCellId, col, onClose, onFilterApplied]);

  // Handler for switching to condition panel from submenu with pre-selected operator
  const handleSwitchToConditions = useCallback((operator: FilterOperator) => {
    setPendingOperator(operator);
    setActiveTab('conditions');
    setActiveSubmenu(null);
  }, []);

  const openSubmenu = useCallback((submenu: NonNullable<ActiveSubmenu>) => {
    setActiveSubmenu(submenu);
  }, []);

  const setSubmenuOpen = useCallback((submenu: NonNullable<ActiveSubmenu>, open: boolean) => {
    setActiveSubmenu((current) => {
      if (open) return submenu;
      return current === submenu ? null : current;
    });
  }, []);

  const handleSubmenuTriggerKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, submenu: NonNullable<ActiveSubmenu>) => {
      if (event.key === 'ArrowRight' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        openSubmenu(submenu);
      }
      if (event.key === 'ArrowLeft' || event.key === 'Escape') {
        setActiveSubmenu(null);
      }
    },
    [openSubmenu],
  );

  const focusMenuCommand = useCallback((position: 'first' | 'last') => {
    const commands = Array.from(
      contentRef.current?.querySelectorAll<HTMLButtonElement>(
        'button[data-filter-menu-command="true"]:not(:disabled)',
      ) ?? [],
    ).filter((button) => button.offsetParent !== null);
    const target = position === 'first' ? commands[0] : commands.at(-1);
    target?.focus();
  }, []);

  const handleContentKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Home') {
        event.preventDefault();
        event.stopPropagation();
        focusMenuCommand('first');
      } else if (event.key === 'End') {
        event.preventDefault();
        event.stopPropagation();
        focusMenuCommand('last');
      }
    },
    [focusMenuCommand],
  );

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
      ref={contentRef}
      className="flex min-h-0 w-full flex-1 flex-col overflow-visible"
      data-testid="filter-dropdown-content"
      onKeyDown={handleContentKeyDown}
    >
      {/* Sort buttons section */}
      <div className="shrink-0 border-b border-ss-border py-1">
        <MenuItem data-filter-menu-command="true" onSelect={handleSortAsc}>
          <span className="text-ss-text-secondary mr-2">↑</span>
          Sort A to Z
        </MenuItem>
        <MenuItem data-filter-menu-command="true" onSelect={handleSortDesc}>
          <span className="text-ss-text-secondary mr-2">↓</span>
          Sort Z to A
        </MenuItem>

        {/* Sort by Color - shown when column has colored cells */}
        {hasColors && (
          <FilterSubmenu
            open={activeSubmenu === 'sortByColor'}
            onOpenChange={(open) => setSubmenuOpen('sortByColor', open)}
            trigger={
              <MenuItem
                data-filter-menu-command="true"
                data-filter-submenu-trigger="sortByColor"
                aria-haspopup="menu"
                aria-expanded={activeSubmenu === 'sortByColor'}
                onSelect={() => openSubmenu('sortByColor')}
                onMouseEnter={() => openSubmenu('sortByColor')}
                onKeyDown={(event) => handleSubmenuTriggerKeyDown(event, 'sortByColor')}
                className="justify-between"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  className="text-ss-text-secondary mr-2"
                >
                  <rect x="4" y="4" width="6" height="6" rx="1" fill="#4CAF50" />
                  <rect x="4" y="14" width="6" height="6" rx="1" fill="#2196F3" />
                  <path
                    d="M14 7h6M14 17h6M16 4l-2 3h4l-2 3M16 14l2 3h-4l2 3"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span className="flex-1">Sort by Color</span>
                <span className="text-ss-text-secondary">›</span>
              </MenuItem>
            }
          >
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
          </FilterSubmenu>
        )}
      </div>

      {/* Filter Type Submenus - B4: Excel-parity quickwins */}
      <div className="shrink-0 border-b border-ss-border py-1">
        {/* Number Filters - shown for number columns only */}
        {columnType === 'number' && (
          <FilterSubmenu
            open={activeSubmenu === 'number'}
            onOpenChange={(open) => setSubmenuOpen('number', open)}
            trigger={
              <MenuItem
                data-filter-menu-command="true"
                data-filter-submenu-trigger="number"
                aria-haspopup="menu"
                aria-expanded={activeSubmenu === 'number'}
                onSelect={() => openSubmenu('number')}
                onMouseEnter={() => openSubmenu('number')}
                onKeyDown={(event) => handleSubmenuTriggerKeyDown(event, 'number')}
                className="justify-between"
              >
                <span className="flex-1">Number Filters</span>
                <span className="text-ss-text-secondary">›</span>
              </MenuItem>
            }
          >
            <NumberFiltersMenu
              onClose={() => setActiveSubmenu(null)}
              onSwitchToConditions={handleSwitchToConditions}
              onOpenTop10={() => setTop10DialogOpen(true)}
            />
          </FilterSubmenu>
        )}

        {/* Date Filters - shown for date columns */}
        {columnType === 'date' && (
          <FilterSubmenu
            open={activeSubmenu === 'date'}
            onOpenChange={(open) => setSubmenuOpen('date', open)}
            trigger={
              <MenuItem
                data-filter-menu-command="true"
                data-filter-submenu-trigger="date"
                aria-haspopup="menu"
                aria-expanded={activeSubmenu === 'date'}
                onSelect={() => openSubmenu('date')}
                onMouseEnter={() => openSubmenu('date')}
                onKeyDown={(event) => handleSubmenuTriggerKeyDown(event, 'date')}
                className="justify-between"
              >
                <span className="flex-1">Date Filters</span>
                <span className="text-ss-text-secondary">›</span>
              </MenuItem>
            }
          >
            <DateFiltersMenu
              filterId={filterId}
              col={col}
              onClose={() => setActiveSubmenu(null)}
              onSwitchToConditions={handleSwitchToConditions}
              onFilterApplied={onFilterApplied}
            />
          </FilterSubmenu>
        )}

        {/* Text Filters - shown for text and mixed columns */}
        {(columnType === 'text' || columnType === 'mixed') && (
          <FilterSubmenu
            open={activeSubmenu === 'text'}
            onOpenChange={(open) => setSubmenuOpen('text', open)}
            trigger={
              <MenuItem
                data-filter-menu-command="true"
                data-filter-submenu-trigger="text"
                aria-haspopup="menu"
                aria-expanded={activeSubmenu === 'text'}
                onSelect={() => openSubmenu('text')}
                onMouseEnter={() => openSubmenu('text')}
                onKeyDown={(event) => handleSubmenuTriggerKeyDown(event, 'text')}
                className="justify-between"
              >
                <span className="flex-1">Text Filters</span>
                <span className="text-ss-text-secondary">›</span>
              </MenuItem>
            }
          >
            <TextFiltersMenu
              onClose={() => setActiveSubmenu(null)}
              onSwitchToConditions={handleSwitchToConditions}
            />
          </FilterSubmenu>
        )}

        {/* Color Filters - shown when column has colored cells */}
        {hasColors && (
          <FilterSubmenu
            open={activeSubmenu === 'color'}
            onOpenChange={(open) => setSubmenuOpen('color', open)}
            trigger={
              <MenuItem
                data-filter-menu-command="true"
                data-filter-submenu-trigger="color"
                aria-haspopup="menu"
                aria-expanded={activeSubmenu === 'color'}
                onSelect={() => openSubmenu('color')}
                onMouseEnter={() => openSubmenu('color')}
                onKeyDown={(event) => handleSubmenuTriggerKeyDown(event, 'color')}
                className="justify-between"
              >
                <span className="flex-1">Filter by Color</span>
                <span className="text-ss-text-secondary">›</span>
              </MenuItem>
            }
          >
            <ColorFiltersMenu
              sheetId={activeSheetId}
              filterId={filterId}
              col={col}
              onClose={() => {
                setActiveSubmenu(null);
                onClose();
                onFilterApplied?.();
              }}
            />
          </FilterSubmenu>
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
      <div className="min-h-0 flex-1 overflow-hidden p-3" data-testid="filter-values-panel">
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
                preserveHiddenSearchSelections={currentCriteria?.type === 'value'}
                onApply={handleApplyValueFilter}
                onCancel={onClose}
              />
            )
          )
        ) : (
          <ConditionFilterPanel
            currentCriteria={conditionCriteria}
            initialOperator={pendingOperator}
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
      <Top10FilterDialog
        isOpen={top10DialogOpen}
        onApply={handleApplyTop10Filter}
        onCancel={() => setTop10DialogOpen(false)}
      />
    </div>
  );
}

export default FilterDropdownContent;
