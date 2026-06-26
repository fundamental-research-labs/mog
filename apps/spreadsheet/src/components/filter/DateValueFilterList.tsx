/**
 * DateValueFilterList Component
 *
 * Date Filters with Hierarchical Grouping
 *
 * Displays date values in a hierarchical tree structure:
 * - Year → Month → Day
 * - Expand/collapse functionality
 * - Indeterminate checkbox states for partial selection
 *
 * ARCHITECTURE:
 * - Uses groupDatesByHierarchy from filter-utils to build tree
 * - Supports select all/none at each level
 * - Checkbox states: checked, unchecked, indeterminate
 *
 * Used within filter dropdown content when column type is detected as date.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';

import type { FilterDropdownItem } from '@mog-sdk/contracts/api';
import type { CellValue } from '@mog-sdk/contracts/core';
import { getMonthName, groupDatesByHierarchy, type MonthNode, type YearNode } from './filter-utils';
import type { ValueFilterSelection } from './ValueFilterList';

export interface DateValueFilterListProps {
  items: readonly FilterDropdownItem[];
  hasBlank: boolean;
  blankCount: number;
  blankSelected: boolean;
  /** Called when user applies the filter */
  onApply: (selection: ValueFilterSelection) => void;
  /** Called to cancel without applying */
  onCancel?: () => void;
}

/**
 * Date value filter list with hierarchical tree structure.
 */
export function DateValueFilterList({
  items,
  hasBlank,
  blankCount: _blankCount,
  blankSelected,
  onApply,
  onCancel,
}: DateValueFilterListProps): React.ReactElement {
  const dateValues = useMemo(() => items.map((item) => item.value), [items]);
  // Build date hierarchy from unique values
  const hierarchy = useMemo(() => groupDatesByHierarchy(dateValues), [dateValues]);

  // Track which serial numbers are selected
  const [selectedSerials, setSelectedSerials] = useState<Set<number>>(() => {
    const serials = new Set<number>();
    for (const item of items) {
      if (item.selected && typeof item.value === 'number') serials.add(item.value);
    }
    return serials;
  });
  const [isBlankChecked, setIsBlankChecked] = useState(blankSelected);

  useEffect(() => {
    const serials = new Set<number>();
    for (const item of items) {
      if (item.selected && typeof item.value === 'number') serials.add(item.value);
    }
    setSelectedSerials(serials);
    setIsBlankChecked(blankSelected);
  }, [items, blankSelected]);

  // Track expanded years and months
  const [expandedYears, setExpandedYears] = useState<Set<number>>(new Set());
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());

  // Helper: Toggle year expansion
  const toggleYearExpanded = useCallback((year: number) => {
    setExpandedYears((prev) => {
      const next = new Set(prev);
      if (next.has(year)) {
        next.delete(year);
      } else {
        next.add(year);
      }
      return next;
    });
  }, []);

  // Helper: Toggle month expansion
  const toggleMonthExpanded = useCallback((year: number, month: number) => {
    const key = `${year}-${month}`;
    setExpandedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  // Helper: Get checkbox state for a year
  const getYearCheckboxState = useCallback(
    (yearNode: YearNode): 'checked' | 'unchecked' | 'indeterminate' => {
      let allSelected = true;
      let noneSelected = true;

      for (const monthNode of yearNode.months.values()) {
        for (const serial of monthNode.serials) {
          if (selectedSerials.has(serial)) {
            noneSelected = false;
          } else {
            allSelected = false;
          }
        }
      }

      if (allSelected) return 'checked';
      if (noneSelected) return 'unchecked';
      return 'indeterminate';
    },
    [selectedSerials],
  );

  // Helper: Get checkbox state for a month
  const getMonthCheckboxState = useCallback(
    (monthNode: MonthNode): 'checked' | 'unchecked' | 'indeterminate' => {
      let allSelected = true;
      let noneSelected = true;

      for (const serial of monthNode.serials) {
        if (selectedSerials.has(serial)) {
          noneSelected = false;
        } else {
          allSelected = false;
        }
      }

      if (allSelected) return 'checked';
      if (noneSelected) return 'unchecked';
      return 'indeterminate';
    },
    [selectedSerials],
  );

  // Helper: Toggle year selection
  const toggleYearSelection = useCallback(
    (yearNode: YearNode) => {
      const state = getYearCheckboxState(yearNode);
      const shouldSelect = state !== 'checked';

      setSelectedSerials((prev) => {
        const next = new Set(prev);
        for (const monthNode of yearNode.months.values()) {
          for (const serial of monthNode.serials) {
            if (shouldSelect) {
              next.add(serial);
            } else {
              next.delete(serial);
            }
          }
        }
        return next;
      });
    },
    [getYearCheckboxState],
  );

  // Helper: Toggle month selection
  const toggleMonthSelection = useCallback(
    (monthNode: MonthNode) => {
      const state = getMonthCheckboxState(monthNode);
      const shouldSelect = state !== 'checked';

      setSelectedSerials((prev) => {
        const next = new Set(prev);
        for (const serial of monthNode.serials) {
          if (shouldSelect) {
            next.add(serial);
          } else {
            next.delete(serial);
          }
        }
        return next;
      });
    },
    [getMonthCheckboxState],
  );

  // Select All / Clear All
  const handleSelectAll = useCallback(() => {
    const serials = new Set<number>();
    for (const value of dateValues) {
      if (typeof value === 'number') {
        serials.add(value);
      }
    }
    setSelectedSerials(serials);
    if (hasBlank) setIsBlankChecked(true);
  }, [dateValues, hasBlank]);

  const handleClearAll = useCallback(() => {
    setSelectedSerials(new Set());
    if (hasBlank) setIsBlankChecked(false);
  }, [hasBlank]);

  // Apply filter
  const handleApply = useCallback(() => {
    const selectedVals: CellValue[] = dateValues.filter(
      (v) => typeof v === 'number' && selectedSerials.has(v),
    );
    onApply({ values: selectedVals, includeBlanks: hasBlank && isBlankChecked });
  }, [dateValues, selectedSerials, hasBlank, isBlankChecked, onApply]);

  // Compute states
  const totalDates = useMemo(() => {
    let count = 0;
    for (const value of dateValues) {
      if (typeof value === 'number') count++;
    }
    return count;
  }, [dateValues]);

  const allSelected = selectedSerials.size === totalDates && (!hasBlank || isBlankChecked);
  const noneSelected = selectedSerials.size === 0 && (!hasBlank || !isBlankChecked);
  const hasAnySelected = selectedSerials.size > 0 || (hasBlank && isBlankChecked);

  // Sort years in descending order (most recent first)
  const sortedYears = useMemo(() => {
    return Array.from(hierarchy.years.keys()).sort((a, b) => b - a);
  }, [hierarchy]);

  // Helper: Get checkbox state for a day
  const getDayCheckboxState = useCallback(
    (daySerials: number[]): 'checked' | 'unchecked' | 'indeterminate' => {
      let allSelected = true;
      let noneSelected = true;

      for (const serial of daySerials) {
        if (selectedSerials.has(serial)) {
          noneSelected = false;
        } else {
          allSelected = false;
        }
      }

      if (allSelected) return 'checked';
      if (noneSelected) return 'unchecked';
      return 'indeterminate';
    },
    [selectedSerials],
  );

  // Helper: Toggle day selection
  const toggleDaySelectionMulti = useCallback(
    (daySerials: number[]) => {
      const state = getDayCheckboxState(daySerials);
      const shouldSelect = state !== 'checked';

      setSelectedSerials((prev) => {
        const next = new Set(prev);
        for (const serial of daySerials) {
          if (shouldSelect) {
            next.add(serial);
          } else {
            next.delete(serial);
          }
        }
        return next;
      });
    },
    [getDayCheckboxState],
  );

  // Render a day checkbox
  const renderDay = useCallback(
    (year: number, month: number, day: number, daySerials: number[]) => {
      if (daySerials.length === 0) return null;

      const checkboxState = getDayCheckboxState(daySerials);

      return (
        <label
          key={`${year}-${month}-${day}`}
          className="flex items-center gap-2 px-2 py-1 cursor-pointer hover:bg-ss-surface-hover"
          style={{ paddingLeft: '3rem' }}
        >
          <input
            type="checkbox"
            checked={checkboxState === 'checked'}
            ref={(el) => {
              if (el) {
                el.indeterminate = checkboxState === 'indeterminate';
              }
            }}
            onChange={() => toggleDaySelectionMulti(daySerials)}
            className="w-4 h-4 accent-primary"
          />
          <span className="text-body-sm">{day}</span>
        </label>
      );
    },
    [getDayCheckboxState, toggleDaySelectionMulti],
  );

  // Render a month node
  const renderMonth = useCallback(
    (year: number, month: number, monthNode: MonthNode) => {
      const monthKey = `${year}-${month}`;
      const isExpanded = expandedMonths.has(monthKey);
      const checkboxState = getMonthCheckboxState(monthNode);

      return (
        <div key={monthKey}>
          {/* Month header */}
          <div className="flex items-center gap-1 px-2 py-1 hover:bg-ss-surface-hover">
            <button
              type="button"
              onClick={() => toggleMonthExpanded(year, month)}
              className="w-4 h-4 flex items-center justify-center text-ss-text-secondary hover:text-ss-text"
            >
              {isExpanded ? '▼' : '▶'}
            </button>
            <label className="flex items-center gap-2 cursor-pointer flex-1">
              <input
                type="checkbox"
                checked={checkboxState === 'checked'}
                ref={(el) => {
                  if (el) {
                    el.indeterminate = checkboxState === 'indeterminate';
                  }
                }}
                onChange={() => toggleMonthSelection(monthNode)}
                className="w-4 h-4 accent-primary"
              />
              <span className="text-body-sm font-medium">{getMonthName(month)}</span>
            </label>
          </div>

          {/* Days (if expanded) */}
          {isExpanded && (
            <div>
              {Array.from(monthNode.days.entries())
                .sort(([a], [b]) => a - b)
                .map(([day, daySerials]) => renderDay(year, month, day, daySerials))}
            </div>
          )}
        </div>
      );
    },
    [expandedMonths, getMonthCheckboxState, toggleMonthExpanded, toggleMonthSelection, renderDay],
  );

  // Render a year node
  const renderYear = useCallback(
    (year: number) => {
      const yearNode = hierarchy.years.get(year);
      if (!yearNode) return null;

      const isExpanded = expandedYears.has(year);
      const checkboxState = getYearCheckboxState(yearNode);

      // Sort months
      const sortedMonths = Array.from(yearNode.months.keys()).sort((a, b) => a - b);

      return (
        <div key={year}>
          {/* Year header */}
          <div className="flex items-center gap-1 px-2 py-1 hover:bg-ss-surface-hover bg-ss-surface/50">
            <button
              type="button"
              onClick={() => toggleYearExpanded(year)}
              className="w-4 h-4 flex items-center justify-center text-ss-text-secondary hover:text-ss-text"
            >
              {isExpanded ? '▼' : '▶'}
            </button>
            <label className="flex items-center gap-2 cursor-pointer flex-1">
              <input
                type="checkbox"
                checked={checkboxState === 'checked'}
                ref={(el) => {
                  if (el) {
                    el.indeterminate = checkboxState === 'indeterminate';
                  }
                }}
                onChange={() => toggleYearSelection(yearNode)}
                className="w-4 h-4 accent-primary"
              />
              <span className="text-body-sm font-semibold">{year}</span>
            </label>
          </div>

          {/* Months (if expanded) */}
          {isExpanded && (
            <div style={{ paddingLeft: '1rem' }}>
              {sortedMonths.map((month) => {
                const monthNode = yearNode.months.get(month);
                if (!monthNode) return null;
                return renderMonth(year, month, monthNode);
              })}
            </div>
          )}
        </div>
      );
    },
    [
      hierarchy,
      expandedYears,
      getYearCheckboxState,
      toggleYearExpanded,
      toggleYearSelection,
      renderMonth,
    ],
  );

  return (
    <div className="date-value-filter-list flex h-full min-h-0 flex-col gap-2">
      {/* Select All / Clear buttons */}
      <div className="flex gap-2 text-caption">
        <button
          type="button"
          onClick={handleSelectAll}
          disabled={allSelected}
          className="px-2 py-1 text-ss-primary hover:underline disabled:text-ss-text-secondary disabled:no-underline"
        >
          Select All
        </button>
        <span className="text-ss-text-secondary">|</span>
        <button
          type="button"
          onClick={handleClearAll}
          disabled={noneSelected}
          className="px-2 py-1 text-ss-primary hover:underline disabled:text-ss-text-secondary disabled:no-underline"
        >
          Clear
        </button>
      </div>

      {/* Hierarchical date tree */}
      <div
        data-testid="filter-value-scroll-region"
        className="min-h-[72px] flex-1 border border-ss-border rounded overflow-y-auto bg-ss-surface"
      >
        {!hasBlank && sortedYears.length === 0 ? (
          <div className="p-3 text-center text-ss-text-secondary text-body-sm">No dates found</div>
        ) : (
          <>
            {hasBlank && (
              <label className="flex items-center gap-2 px-2 py-1 cursor-pointer hover:bg-ss-surface-hover">
                <input
                  type="checkbox"
                  data-testid="filter-value-blank"
                  aria-label="(Blank)"
                  checked={isBlankChecked}
                  onChange={() => setIsBlankChecked((checked) => !checked)}
                  className="w-4 h-4 accent-primary"
                />
                <span
                  className="text-body-sm truncate flex-1 text-ss-text-secondary italic"
                  title="(Blank)"
                >
                  (Blank)
                </span>
              </label>
            )}
            {sortedYears.map((year) => renderYear(year))}
          </>
        )}
      </div>

      {/* Summary */}
      <div className="shrink-0 text-caption text-ss-text-secondary">
        {selectedSerials.size + (hasBlank && isBlankChecked ? 1 : 0)} of{' '}
        {totalDates + (hasBlank ? 1 : 0)} dates selected
      </div>

      {/* Action buttons */}
      <div className="flex shrink-0 gap-2 pt-2 border-t border-ss-border">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 px-3 py-1.5 border border-ss-border rounded text-body-sm hover:bg-ss-surface-hover"
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={handleApply}
          disabled={!hasAnySelected}
          className="flex-1 px-3 py-1.5 bg-ss-primary text-ss-text-inverse rounded text-body-sm hover:bg-ss-primary-hover disabled:opacity-50 disabled:cursor-not-allowed"
        >
          OK
        </button>
      </div>
    </div>
  );
}

export default DateValueFilterList;
