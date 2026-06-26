/**
 * ValueFilterList Component
 *
 *
 * Checkbox list of unique values with select all/none and search functionality.
 * Used within the filter dropdown content for value-based filtering.
 *
 * ARCHITECTURE (Cell Identity Model):
 * This component receives dropdown metadata from the worksheet filter engine.
 * Blank state is first-class metadata, not inferred from display strings.
 *
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';

import type { FilterDropdownItem } from '@mog-sdk/contracts/api';
import type { CellValue } from '@mog-sdk/contracts/core';
// =============================================================================
// Wildcard Pattern Matching (Excel Wildcard Support)
// =============================================================================

/**
 * Convert an Excel wildcard pattern to a RegExp.
 *
 * Excel wildcard support:
 * - `*` matches any sequence of characters (including empty)
 * - `?` matches any single character
 * - `~*` matches a literal asterisk
 * - `~?` matches a literal question mark
 * - `~~` matches a literal tilde
 *
 * @param pattern - The wildcard pattern from user input
 * @returns RegExp that matches the pattern, or null if pattern is plain text
 */
function wildcardToRegex(pattern: string): RegExp | null {
  // Check if pattern contains wildcards (not escaped)
  const hasWildcard = /(?<!~)[*?]/.test(pattern);
  if (!hasWildcard) {
    return null; // No wildcards, use simple contains matching
  }

  // Escape regex special characters except * and ?
  // Then convert * and ? to regex equivalents
  let regexStr = '';
  let i = 0;

  while (i < pattern.length) {
    const char = pattern[i];
    const nextChar = pattern[i + 1];

    if (char === '~' && nextChar) {
      // Escape sequence: ~* ~? ~~
      if (nextChar === '*' || nextChar === '?' || nextChar === '~') {
        // Escape the next character literally
        regexStr += escapeRegexChar(nextChar);
        i += 2;
        continue;
      }
    }

    if (char === '*') {
      // * matches any sequence of characters
      regexStr += '.*';
    } else if (char === '?') {
      // ? matches any single character
      regexStr += '.';
    } else {
      // Escape other regex special characters
      regexStr += escapeRegexChar(char);
    }
    i++;
  }

  // Create case-insensitive regex that matches anywhere in the string
  return new RegExp(regexStr, 'i');
}

/**
 * Escape a single character for use in a regex.
 */
function escapeRegexChar(char: string): string {
  // Characters that have special meaning in regex
  const specialChars = /[.+^${}()|[\]\\]/;
  if (specialChars.test(char)) {
    return '\\' + char;
  }
  return char;
}

/**
 * Check if a display value matches the search term.
 * Supports Excel-style wildcards (* and ?).
 *
 * @param display - The formatted display value
 * @param searchTerm - The search term (may contain wildcards)
 * @returns true if the value matches the search
 */
function matchesSearch(display: string, searchTerm: string): boolean {
  const lower = searchTerm.toLowerCase();
  const displayLower = display.toLowerCase();

  // Try wildcard matching first
  const wildcardRegex = wildcardToRegex(lower);
  if (wildcardRegex) {
    return wildcardRegex.test(displayLower);
  }

  // Fall back to simple contains matching
  return displayLower.includes(lower);
}

export interface ValueFilterListProps {
  items: readonly FilterDropdownItem[];
  hasBlank: boolean;
  blankCount: number;
  blankSelected: boolean;
  /**
   * When true, search-scoped Select All/Clear preserve checked values hidden by
   * the search. This is needed when editing an existing partial value filter.
   */
  preserveHiddenSearchSelections?: boolean;
  /** Called when user applies the filter */
  onApply: (selection: ValueFilterSelection) => void;
  /** Called to cancel without applying */
  onCancel?: () => void;
}

export interface ValueFilterSelection {
  values: CellValue[];
  includeBlanks: boolean;
}

/**
 * Convert a CellValue to a string key for Set operations.
 * Handles nulls, errors, and all value types.
 */
function valueToKey(value: CellValue): string {
  if (value === null || value === undefined) return '__NULL__';
  if (value === '') return '__EMPTY__';
  if (typeof value === 'boolean') return value ? '__TRUE__' : '__FALSE__';
  if (typeof value === 'object' && value !== null && 'type' in value && value.type === 'error') {
    return `__ERROR__${value.value}`;
  }
  return String(value);
}

/**
 * Format a CellValue for display.
 */
function formatValue(value: CellValue): string {
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'object' && value !== null && 'type' in value && value.type === 'error') {
    return `#${value.value}`;
  }
  return String(value);
}

/**
 * Value filter list with checkboxes, search, and select all/none.
 */
export function ValueFilterList({
  items,
  hasBlank,
  blankCount: _blankCount,
  blankSelected,
  preserveHiddenSearchSelections = false,
  onApply,
  onCancel,
}: ValueFilterListProps): React.ReactElement {
  // Initialize checked state from engine-provided selected metadata.
  const [checkedKeys, setCheckedKeys] = useState<Set<string>>(() => {
    return new Set(items.filter((item) => item.selected).map((item) => valueToKey(item.value)));
  });
  const [isBlankChecked, setIsBlankChecked] = useState(blankSelected);

  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    setCheckedKeys(
      new Set(items.filter((item) => item.selected).map((item) => valueToKey(item.value))),
    );
    setIsBlankChecked(blankSelected);
  }, [items, blankSelected]);

  // Filter values by search term (supports Excel wildcards: * and ?)
  const filteredItems = useMemo(() => {
    if (!searchTerm.trim()) return items;
    return items.filter((item) => {
      const display = item.displayText || formatValue(item.value);
      return matchesSearch(display, searchTerm);
    });
  }, [items, searchTerm]);

  const blankVisible = useMemo(() => {
    if (!hasBlank) return false;
    if (!searchTerm.trim()) return true;
    return matchesSearch('(Blank)', searchTerm);
  }, [hasBlank, searchTerm]);

  const searchScopedToVisibleValues = searchTerm.trim() !== '' && !preserveHiddenSearchSelections;

  // Computed states
  const allSelected = useMemo(() => {
    return (
      filteredItems.every((item) => checkedKeys.has(valueToKey(item.value))) &&
      (!blankVisible || isBlankChecked)
    );
  }, [filteredItems, checkedKeys, blankVisible, isBlankChecked]);

  const hasAnySelected = useMemo(() => {
    if (!searchScopedToVisibleValues) {
      return checkedKeys.size > 0 || (hasBlank && isBlankChecked);
    }
    return (
      filteredItems.some((item) => checkedKeys.has(valueToKey(item.value))) ||
      (blankVisible && isBlankChecked)
    );
  }, [
    searchScopedToVisibleValues,
    checkedKeys,
    hasBlank,
    isBlankChecked,
    filteredItems,
    blankVisible,
  ]);

  // Handlers
  const handleToggle = useCallback((value: CellValue) => {
    const key = valueToKey(value);
    setCheckedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    setCheckedKeys((prev) => {
      const next = searchScopedToVisibleValues ? new Set<string>() : new Set(prev);
      for (const item of filteredItems) {
        next.add(valueToKey(item.value));
      }
      return next;
    });
    if (searchScopedToVisibleValues) {
      setIsBlankChecked(blankVisible);
    } else if (blankVisible) {
      setIsBlankChecked(true);
    }
  }, [filteredItems, blankVisible, searchScopedToVisibleValues]);

  const handleSelectNone = useCallback(() => {
    setCheckedKeys((prev) => {
      const next = searchScopedToVisibleValues ? new Set<string>() : new Set(prev);
      for (const item of filteredItems) {
        next.delete(valueToKey(item.value));
      }
      return next;
    });
    if (searchScopedToVisibleValues || blankVisible) setIsBlankChecked(false);
  }, [filteredItems, blankVisible, searchScopedToVisibleValues]);

  const handleApply = useCallback(() => {
    // Convert checked keys back to values
    const candidateItems = searchScopedToVisibleValues ? filteredItems : items;
    const selectedVals = candidateItems
      .filter((item) => checkedKeys.has(valueToKey(item.value)))
      .map((item) => item.value);
    onApply({
      values: selectedVals,
      includeBlanks: searchScopedToVisibleValues
        ? blankVisible && isBlankChecked
        : hasBlank && isBlankChecked,
    });
  }, [
    searchScopedToVisibleValues,
    filteredItems,
    items,
    checkedKeys,
    blankVisible,
    isBlankChecked,
    hasBlank,
    onApply,
  ]);

  const selectedCount = searchScopedToVisibleValues
    ? filteredItems.filter((item) => checkedKeys.has(valueToKey(item.value))).length +
      (blankVisible && isBlankChecked ? 1 : 0)
    : checkedKeys.size + (hasBlank && isBlankChecked ? 1 : 0);
  const totalSelectable = searchScopedToVisibleValues
    ? filteredItems.length + (blankVisible ? 1 : 0)
    : items.length + (hasBlank ? 1 : 0);

  return (
    <div
      className="value-filter-list flex h-full min-h-0 flex-col gap-2"
      data-testid="filter-value-list"
    >
      {/* Search input - supports Excel wildcards (* and ?) */}
      <input
        type="text"
        data-testid="filter-value-search"
        placeholder="Search (* and ? wildcards)"
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.currentTarget.value)}
        onKeyDown={(event) => {
          if (!(searchTerm === '' && (event.key === 'Home' || event.key === 'End'))) {
            event.stopPropagation();
          }
          if (event.key === 'Enter') {
            handleApply();
          }
          if (event.key === 'Escape') {
            onCancel?.();
          }
        }}
        onKeyUp={(event) => event.stopPropagation()}
        className="w-full px-2 py-1 border border-ss-border rounded text-body-sm focus:outline-none focus:ring-1 focus:ring-ss-primary"
        autoFocus
        title="Use * to match any characters, ? to match a single character"
      />

      {/* Select All / Select None buttons */}
      <div className="flex gap-2 text-caption">
        <button
          type="button"
          data-testid="filter-value-select-all"
          onClick={handleSelectAll}
          disabled={allSelected}
          className="px-2 py-1 text-ss-primary hover:underline disabled:text-ss-text-secondary disabled:no-underline"
        >
          Select All
        </button>
        <span className="text-ss-text-secondary">|</span>
        <button
          type="button"
          data-testid="filter-value-clear"
          onClick={handleSelectNone}
          disabled={!hasAnySelected}
          className="px-2 py-1 text-ss-primary hover:underline disabled:text-ss-text-secondary disabled:no-underline"
        >
          Clear
        </button>
      </div>

      {/* Value list with checkboxes */}
      <div
        data-testid="filter-value-scroll-region"
        className="min-h-[72px] flex-1 border border-ss-border rounded overflow-y-auto bg-ss-surface"
      >
        {!blankVisible && filteredItems.length === 0 ? (
          <div className="p-3 text-center text-ss-text-secondary text-body-sm">No values found</div>
        ) : (
          <>
            {blankVisible && (
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
            {filteredItems.map((item) => {
              const value = item.value;
              const key = valueToKey(value);
              const display = item.displayText || formatValue(value);
              const isChecked = checkedKeys.has(key);

              return (
                <label
                  key={key}
                  className="flex items-center gap-2 px-2 py-1 cursor-pointer hover:bg-ss-surface-hover"
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => handleToggle(value)}
                    className="w-4 h-4 accent-primary"
                  />
                  <span className="text-body-sm truncate flex-1" title={display}>
                    {display}
                  </span>
                </label>
              );
            })}
          </>
        )}
      </div>

      {/* Summary */}
      <div className="shrink-0 text-caption text-ss-text-secondary">
        {selectedCount} of {totalSelectable} selected
      </div>

      {/* Action buttons */}
      <div className="z-10 flex shrink-0 gap-2 border-t border-ss-border bg-ss-surface pt-2 pb-1">
        {onCancel && (
          <button
            type="button"
            data-testid="filter-value-cancel"
            onClick={onCancel}
            className="flex-1 px-3 py-1.5 border border-ss-border rounded text-body-sm hover:bg-ss-surface-hover"
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          data-testid="filter-value-apply"
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

export default ValueFilterList;
