/**
 * Find & Replace Dialog
 *
 * A compact, floating dialog for finding and replacing cell content.
 * Matches Excel's Find & Replace dialog behavior.
 *
 * Features:
 * - Find-only mode (Ctrl+F)
 * - Find & Replace mode (Ctrl+H)
 * - Search options: case sensitive, match entire cell, regex
 * - Result navigation with keyboard shortcuts
 * - Replace single or all matches
 *
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFindReplace } from '../../internal-api';

import {
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  Input,
  Select,
} from '@mog/shell';
import type { SearchOptions } from '@mog-sdk/contracts/search';
// =============================================================================
// Constants
// =============================================================================

/** Options for the 'Within' dropdown (search scope) */
const WITHIN_OPTIONS = [
  { value: 'sheet', label: 'Sheet' },
  { value: 'workbook', label: 'Workbook' },
] as const;

/** Options for the 'Search' dropdown (search direction) */
const SEARCH_OPTIONS = [
  { value: 'byRow', label: 'By Rows' },
  { value: 'byColumn', label: 'By Columns' },
] as const;

/** Options for the 'Look in' dropdown (search target) */
const LOOK_IN_OPTIONS = [
  { value: 'values', label: 'Values' },
  { value: 'formulas', label: 'Formulas' },
  { value: 'both', label: 'Both' },
] as const;

// =============================================================================
// Component
// =============================================================================

export function FindReplaceDialog() {
  const {
    isOpen,
    showReplace,
    query,
    replacement,
    currentResultNumber,
    resultCount,
    hasResults,
    isSearching,
    errorMessage,
    options,
    setQuery,
    setReplacement,
    setOptions,
    search,
    findNext,
    findPrevious,
    replace,
    replaceAll,
    close,
  } = useFindReplace();

  const searchInputRef = useRef<HTMLInputElement>(null);

  // Track expanded options state - persists during dialog session
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);

  // Focus is handled by onOpenAutoFocus on the Dialog (see below).
  // Using useEffect races with Radix's FocusScope requestAnimationFrame.

  // Trigger search when query changes (debounced by machine/coordinator)
  useEffect(() => {
    if (isOpen && query.length > 0) {
      search();
    }
  }, [isOpen, query, search]);

  // Handle Enter key for find next
  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
          findPrevious();
        } else {
          findNext();
        }
      } else if (e.key === 'Escape') {
        close();
      }
    },
    [findNext, findPrevious, close],
  );

  // Handle keyboard shortcuts for replace input
  const handleReplaceKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
          replaceAll();
        } else {
          replace();
        }
      } else if (e.key === 'Escape') {
        close();
      }
    },
    [replace, replaceAll, close],
  );

  // Toggle option helpers - toggle the current option value
  const toggleCaseSensitive = useCallback(() => {
    setOptions({ caseSensitive: !options.caseSensitive });
  }, [setOptions, options.caseSensitive]);

  const toggleMatchEntireCell = useCallback(() => {
    setOptions({ matchEntireCell: !options.matchEntireCell });
  }, [setOptions, options.matchEntireCell]);

  const toggleRegex = useCallback(() => {
    setOptions({ useRegex: !options.useRegex });
  }, [setOptions, options.useRegex]);

  // Dropdown option handlers
  const handleScopeChange = useCallback(
    (value: string) => {
      setOptions({ scope: value as SearchOptions['scope'] });
      // Return focus to search input so typing after changing scope goes to the search box
      searchInputRef.current?.focus();
    },
    [setOptions],
  );

  const handleDirectionChange = useCallback(
    (value: string) => {
      setOptions({ direction: value as SearchOptions['direction'] });
      searchInputRef.current?.focus();
    },
    [setOptions],
  );

  const handleSearchInChange = useCallback(
    (value: string) => {
      setOptions({ searchIn: value as SearchOptions['searchIn'] });
      searchInputRef.current?.focus();
    },
    [setOptions],
  );

  const toggleAdvancedOptions = useCallback(() => {
    setShowAdvancedOptions((prev) => !prev);
  }, []);

  if (!isOpen) return null;

  // Result count display
  const resultText =
    query.length === 0
      ? ''
      : isSearching
        ? 'Searching...'
        : resultCount === 0
          ? 'No results'
          : `${currentResultNumber} of ${resultCount}`;

  const dialogTitle = showReplace ? 'Find & Replace' : 'Find';

  // Use semantic 'sm' width (360px) for both modes
  // This keeps the dialog compact and consistent with the design system
  // The slight width difference (40px) for replace mode was not significant enough
  // to warrant a custom pixel value
  return (
    <Dialog
      open={isOpen}
      onClose={close}
      dialogId="find-replace-dialog"
      width="sm"
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }}
      // Chrome-symmetry: panel root testid. The dialog body is the panel.
      // Close affordance: header X (panel-find-close). Reopen affordance:
      // View ribbon "Find" + Ctrl+F (data-action="open-panel-find").
      dataAttributes={{ 'data-testid': 'panel-find' }}
    >
      <DialogHeader onClose={close} closeTestId="panel-find-close">
        {dialogTitle}
      </DialogHeader>

      <DialogBody>
        <div className="flex flex-col gap-3">
          {/* Search Input */}
          <div className="flex flex-col gap-1">
            <label htmlFor="find-input" className="text-body-sm text-ss-text-secondary">
              Find what:
            </label>
            <div className="flex gap-2 items-center">
              <Input
                ref={searchInputRef}
                id="find-input"
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder="Enter search term..."
                size="sm"
                autoComplete="off"
                spellCheck={false}
              />
              <span className="text-body-sm text-ss-text-tertiary whitespace-nowrap min-w-[70px]">
                {resultText}
              </span>
            </div>
          </div>

          {/* Replace Input (only in replace mode) */}
          {showReplace && (
            <div className="flex flex-col gap-1">
              <label htmlFor="replace-input" className="text-body-sm text-ss-text-secondary">
                Replace with:
              </label>
              <Input
                id="replace-input"
                type="text"
                value={replacement}
                onChange={(e) => setReplacement(e.target.value)}
                onKeyDown={handleReplaceKeyDown}
                placeholder="Enter replacement text..."
                size="sm"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          )}

          {/* Basic Search Options */}
          <div className="flex flex-wrap gap-4 pt-1">
            <Checkbox
              checked={options.caseSensitive}
              onChange={toggleCaseSensitive}
              label="Match case"
            />
            <Checkbox
              checked={options.matchEntireCell}
              onChange={toggleMatchEntireCell}
              label="Entire cell"
            />
            <Checkbox checked={options.useRegex} onChange={toggleRegex} label="Regex" />
          </div>

          {/* Options Toggle Button */}
          <button
            type="button"
            onClick={toggleAdvancedOptions}
            className="flex items-center gap-1 text-body-sm text-ss-text-secondary hover:text-text transition-colors self-start"
            aria-expanded={showAdvancedOptions}
          >
            <span
              className={`transition-transform ${showAdvancedOptions ? 'rotate-90' : ''}`}
              aria-hidden="true"
            >
              {'\u25B6'}
            </span>
            Options
          </button>

          {/* Advanced Search Options (collapsible) */}
          {showAdvancedOptions && (
            <div className="flex flex-col gap-3 pl-4 border-l-2 border-ss-border">
              {/* Within (Scope) */}
              <div className="flex items-center gap-2">
                <label
                  htmlFor="find-within"
                  className="text-body-sm text-ss-text-secondary w-16 shrink-0"
                >
                  Within:
                </label>
                <Select
                  id="find-within"
                  options={[...WITHIN_OPTIONS]}
                  value={options.scope}
                  onChange={handleScopeChange}
                  size="sm"
                  className="flex-1"
                />
              </div>

              {/* Search (Direction) */}
              <div className="flex items-center gap-2">
                <label
                  htmlFor="find-search"
                  className="text-body-sm text-ss-text-secondary w-16 shrink-0"
                >
                  Search:
                </label>
                <Select
                  id="find-search"
                  options={[...SEARCH_OPTIONS]}
                  value={options.direction}
                  onChange={handleDirectionChange}
                  size="sm"
                  className="flex-1"
                />
              </div>

              {/* Look in (SearchIn) */}
              <div className="flex items-center gap-2">
                <label
                  htmlFor="find-lookin"
                  className="text-body-sm text-ss-text-secondary w-16 shrink-0"
                >
                  Look in:
                </label>
                <Select
                  id="find-lookin"
                  options={[...LOOK_IN_OPTIONS]}
                  value={options.searchIn}
                  onChange={handleSearchInChange}
                  size="sm"
                  className="flex-1"
                />
              </div>
            </div>
          )}

          {/* Error Message */}
          {errorMessage && (
            <div className="text-body-sm text-ss-error bg-ss-error/10 px-2 py-1 rounded">
              {errorMessage}
            </div>
          )}
        </div>
      </DialogBody>

      <DialogFooter>
        {/* Find-only mode buttons */}
        {!showReplace && (
          <>
            <Button variant="secondary" onClick={findPrevious} disabled={!hasResults}>
              Previous
            </Button>
            <Button variant="primary" onClick={findNext} disabled={!hasResults}>
              Next
            </Button>
          </>
        )}

        {/* Replace mode buttons */}
        {showReplace && (
          <>
            <Button variant="secondary" onClick={findNext} disabled={!hasResults}>
              Find Next
            </Button>
            <Button variant="secondary" onClick={replace} disabled={!hasResults}>
              Replace
            </Button>
            <Button
              variant="primary"
              onClick={replaceAll}
              disabled={resultCount === 0 || query.length === 0}
            >
              Replace All
            </Button>
          </>
        )}
      </DialogFooter>
    </Dialog>
  );
}
