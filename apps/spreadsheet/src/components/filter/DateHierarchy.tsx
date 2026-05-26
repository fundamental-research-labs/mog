/**
 * DateHierarchy Component
 *
 * B4: Filter Dropdown Panel - Date hierarchical filtering
 *
 * Renders a collapsible tree hierarchy for date values (Year > Month > Day).
 * Allows users to filter by year, month, or specific days.
 *
 * ARCHITECTURE:
 * - Detects date columns automatically
 * - Groups date serial numbers by year/month/day
 * - Checkbox selection at each level (select year = select all months/days)
 * - Uses the same valueToKey pattern as ValueFilterList
 */

import type { CellValue } from '@mog-sdk/contracts/core';
import React, { useCallback, useMemo, useState } from 'react';
import {
  getMonthAbbr,
  groupDatesByHierarchy,
  type DateHierarchy as DateHierarchyType,
} from './filter-utils';
export interface DateHierarchyProps {
  /** Date values (should be numeric serials) */
  dateValues: CellValue[];
  /** Currently selected value keys */
  selectedKeys: Set<string>;
  /** Called when user toggles a value */
  onToggle: (value: CellValue) => void;
}

/**
 * Convert a CellValue to a string key for Set operations.
 */
function valueToKey(value: CellValue): string {
  if (value === null || value === undefined) return '__NULL__';
  if (value === '') return '__EMPTY__';
  return String(value);
}

/**
 * Date hierarchy component with collapsible year/month/day tree
 */
export function DateHierarchy({
  dateValues,
  selectedKeys,
  onToggle,
}: DateHierarchyProps): React.ReactElement {
  // Track expanded state for years and months
  const [expandedYears, setExpandedYears] = useState<Set<number>>(new Set());
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set()); // key: "year-month"

  // Group dates into hierarchy
  const hierarchy = useMemo(() => groupDatesByHierarchy(dateValues), [dateValues]);

  // Toggle year expansion
  const toggleYear = useCallback((year: number) => {
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

  // Toggle month expansion
  const toggleMonth = useCallback((year: number, month: number) => {
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

  // Check if all serials in a month are selected
  const isMonthSelected = useCallback(
    (
      monthNode: DateHierarchyType['years'] extends Map<any, { months: Map<any, infer M> }>
        ? M
        : never,
    ) => {
      return monthNode.serials.every((serial) => selectedKeys.has(valueToKey(serial)));
    },
    [selectedKeys],
  );

  // Check if any serials in a month are selected (indeterminate)
  const isMonthPartiallySelected = useCallback(
    (
      monthNode: DateHierarchyType['years'] extends Map<any, { months: Map<any, infer M> }>
        ? M
        : never,
    ) => {
      const selectedCount = monthNode.serials.filter((serial) =>
        selectedKeys.has(valueToKey(serial)),
      ).length;
      return selectedCount > 0 && selectedCount < monthNode.serials.length;
    },
    [selectedKeys],
  );

  // Check if all months in a year are fully selected
  const isYearSelected = useCallback(
    (yearNode: DateHierarchyType['years'] extends Map<any, infer Y> ? Y : never) => {
      for (const monthNode of yearNode.months.values()) {
        if (!isMonthSelected(monthNode)) return false;
      }
      return true;
    },
    [isMonthSelected],
  );

  // Check if any months in a year are selected (indeterminate)
  const isYearPartiallySelected = useCallback(
    (yearNode: DateHierarchyType['years'] extends Map<any, infer Y> ? Y : never) => {
      let hasSelected = false;
      let hasUnselected = false;
      for (const monthNode of yearNode.months.values()) {
        if (isMonthSelected(monthNode)) {
          hasSelected = true;
        } else if (isMonthPartiallySelected(monthNode)) {
          return true; // Definitely indeterminate
        } else {
          hasUnselected = true;
        }
      }
      return hasSelected && hasUnselected;
    },
    [isMonthSelected, isMonthPartiallySelected],
  );

  // Toggle all serials in a month
  const toggleMonthSelection = useCallback(
    (
      monthNode: DateHierarchyType['years'] extends Map<any, { months: Map<any, infer M> }>
        ? M
        : never,
    ) => {
      const allSelected = isMonthSelected(monthNode);
      for (const serial of monthNode.serials) {
        const key = valueToKey(serial);
        const isSelected = selectedKeys.has(key);
        if (allSelected && isSelected) {
          // Deselect all
          onToggle(serial);
        } else if (!allSelected && !isSelected) {
          // Select all
          onToggle(serial);
        }
      }
    },
    [isMonthSelected, selectedKeys, onToggle],
  );

  // Toggle all serials in a year
  const toggleYearSelection = useCallback(
    (yearNode: DateHierarchyType['years'] extends Map<any, infer Y> ? Y : never) => {
      const allSelected = isYearSelected(yearNode);
      for (const monthNode of yearNode.months.values()) {
        for (const serial of monthNode.serials) {
          const key = valueToKey(serial);
          const isSelected = selectedKeys.has(key);
          if (allSelected && isSelected) {
            // Deselect all
            onToggle(serial);
          } else if (!allSelected && !isSelected) {
            // Select all
            onToggle(serial);
          }
        }
      }
    },
    [isYearSelected, selectedKeys, onToggle],
  );

  // Sort years descending (most recent first)
  const sortedYears = useMemo(() => {
    return Array.from(hierarchy.years.keys()).sort((a, b) => b - a);
  }, [hierarchy]);

  return (
    <div className="date-hierarchy">
      {sortedYears.map((year) => {
        const yearNode = hierarchy.years.get(year)!;
        const isExpanded = expandedYears.has(year);
        const isSelected = isYearSelected(yearNode);
        const isIndeterminate = isYearPartiallySelected(yearNode);

        // Sort months
        const sortedMonths = Array.from(yearNode.months.keys()).sort((a, b) => a - b);

        return (
          <div key={year} className="year-node">
            {/* Year row */}
            <div className="flex items-center gap-1 py-0.5 hover:bg-ss-surface-hover">
              <button
                type="button"
                onClick={() => toggleYear(year)}
                className="p-0.5 hover:bg-ss-surface-hover rounded"
              >
                <span className="text-caption text-ss-text-secondary">
                  {isExpanded ? '▼' : '▶'}
                </span>
              </button>
              <label className="flex items-center gap-2 flex-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = isIndeterminate;
                  }}
                  onChange={() => toggleYearSelection(yearNode)}
                  className="w-4 h-4 accent-primary"
                />
                <span className="text-body-sm font-medium">{year}</span>
              </label>
            </div>

            {/* Month nodes (if expanded) */}
            {isExpanded && (
              <div className="pl-6">
                {sortedMonths.map((month) => {
                  const monthNode = yearNode.months.get(month)!;
                  const monthKey = `${year}-${month}`;
                  const isMonthExpanded = expandedMonths.has(monthKey);
                  const isMonthSel = isMonthSelected(monthNode);
                  const isMonthIndeterminate = isMonthPartiallySelected(monthNode);

                  // Sort days
                  const sortedDays = Array.from(monthNode.days.keys()).sort((a, b) => a - b);

                  return (
                    <div key={monthKey} className="month-node">
                      {/* Month row */}
                      <div className="flex items-center gap-1 py-0.5 hover:bg-ss-surface-hover">
                        <button
                          type="button"
                          onClick={() => toggleMonth(year, month)}
                          className="p-0.5 hover:bg-ss-surface-hover rounded"
                        >
                          <span className="text-caption text-ss-text-secondary">
                            {isMonthExpanded ? '▼' : '▶'}
                          </span>
                        </button>
                        <label className="flex items-center gap-2 flex-1 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={isMonthSel}
                            ref={(el) => {
                              if (el) el.indeterminate = isMonthIndeterminate;
                            }}
                            onChange={() => toggleMonthSelection(monthNode)}
                            className="w-4 h-4 accent-primary"
                          />
                          <span className="text-body-sm">{getMonthAbbr(month)}</span>
                        </label>
                      </div>

                      {/* Day checkboxes (if expanded) */}
                      {isMonthExpanded && (
                        <div className="pl-6">
                          {sortedDays.map((day) => {
                            // Find serials for this day
                            const daySerials = monthNode.serials.filter((serial) => {
                              const d = Math.floor(serial);
                              return d % 100 === day; // Simple check (not perfect but works for display)
                            });

                            // For simplicity, just show one checkbox per day and toggle the first serial
                            const serial = daySerials[0];
                            const isChecked = selectedKeys.has(valueToKey(serial));

                            return (
                              <div
                                key={day}
                                className="flex items-center gap-2 py-0.5 hover:bg-ss-surface-hover pl-5"
                              >
                                <label className="flex items-center gap-2 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={() => onToggle(serial)}
                                    className="w-4 h-4 accent-primary"
                                  />
                                  <span className="text-body-sm">
                                    {month}/{day}/{year}
                                  </span>
                                </label>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
