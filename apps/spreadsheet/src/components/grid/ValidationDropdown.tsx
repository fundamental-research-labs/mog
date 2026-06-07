/**
 * ValidationDropdown Component
 *
 * Dropdown list for data validation with enum/enumSource constraints.
 * Supports keyboard navigation, filtering, type-ahead search, and Excel-compatible shortcuts.
 *
 * Added type-ahead search functionality - typing while dropdown is open
 * jumps to matching items, with buffer timeout after 1 second of inactivity.
 *
 * Added live search input at top of dropdown for real-time filtering.
 *
 * @module components/ValidationDropdown
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';

// =============================================================================
// Types
// =============================================================================

export interface ValidationDropdownProps {
  /** Dropdown items to display */
  items: unknown[];
  /** Current value in the editor */
  currentValue: string;
  /**
   * Called when an item is selected.
   * `direction` mirrors Excel: mouse-click commits stay on the cell ('none');
   * keyboard commits via Enter/Tab move the selection ('down' / 'right').
   */
  onSelect: (value: unknown, direction: 'none' | 'down' | 'right') => void;
  /** Whether the dropdown is open */
  isOpen: boolean;
  /** Width of the dropdown (matches cell width) */
  width: number;
  /** Maximum height before scrolling */
  maxHeight?: number;
  /** Show live search input at top of dropdown */
  showSearchInput?: boolean;
  /**
   * J.5: Whether to show an empty option at the top of the dropdown.
   * When true, selecting the empty option clears the cell value.
   * Should be true when the validation's allowBlank setting is enabled (required is false).
   */
  allowBlank?: boolean;
}

interface DropdownState {
  highlightedIndex: number;
  /** Live search filter text (from search input) */
  liveSearchText: string;
  /** Type-ahead search buffer for incremental search (without input box) */
  searchBuffer: string;
}

// =============================================================================
// Component
// =============================================================================

/** Timeout for clearing search buffer after inactivity */
const SEARCH_BUFFER_TIMEOUT_MS = 1000;

/** J.5: Display text for the empty option */
const EMPTY_OPTION_DISPLAY = '(Clear)';

export function ValidationDropdown({
  items,
  currentValue,
  onSelect,
  isOpen,
  width,
  maxHeight = 200,
  showSearchInput = true,
  allowBlank = false,
}: ValidationDropdownProps) {
  const listRef = useRef<HTMLUListElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  /** Ref for search buffer timeout */
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [state, setState] = useState<DropdownState>({
    highlightedIndex: -1,
    liveSearchText: '',
    searchBuffer: '',
  });

  // Convert items to strings for display and filtering
  // Deduplicate list values while preserving order (first occurrence wins)
  const stringItems = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const item of items) {
      const str = String(item ?? '');
      if (!seen.has(str)) {
        seen.add(str);
        result.push(str);
      }
    }
    return result;
  }, [items]);

  // Filter only from explicit live-search text. The current cell value should
  // highlight the matching item, not hide the rest of the validation list.
  // J.5: hasEmptyOption determines if we show the empty option (allowBlank and no active search)
  const filteredItems = useMemo(() => {
    const filterLower = state.liveSearchText.toLowerCase();
    if (!filterLower) return stringItems;
    return stringItems.filter((item) => item.toLowerCase().includes(filterLower));
  }, [stringItems, state.liveSearchText]);

  // J.5: Show empty option only when allowBlank is true and no search filter is active
  const hasEmptyOption = allowBlank && !state.liveSearchText;

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen && showSearchInput && searchInputRef.current) {
      // Small delay to ensure DOM is ready
      setTimeout(() => searchInputRef.current?.focus(), 0);
    }
  }, [isOpen, showSearchInput]);

  // Find initial highlighted index (matching current value)
  useEffect(() => {
    const index = filteredItems.findIndex(
      (item) => item.toLowerCase() === currentValue.toLowerCase(),
    );
    setState((s) => ({
      ...s,
      highlightedIndex: index >= 0 ? index : 0,
    }));
  }, [filteredItems, currentValue]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (listRef.current && state.highlightedIndex >= 0) {
      const items = listRef.current.querySelectorAll('li');
      const highlighted = items[state.highlightedIndex];
      if (highlighted) {
        highlighted.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [state.highlightedIndex]);

  // Handle live search input change
  const handleSearchInputChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setState((s) => ({
      ...s,
      liveSearchText: value,
      highlightedIndex: 0, // Reset to first item when filtering
    }));
  }, []);

  // Handle keyboard navigation
  // J.5: totalItemCount includes the empty option when present
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // J.5: Total count includes empty option if present
      const totalItemCount = filteredItems.length + (hasEmptyOption ? 1 : 0);

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          if (totalItemCount > 0) {
            setState((s) => ({
              ...s,
              highlightedIndex: Math.min(s.highlightedIndex + 1, totalItemCount - 1),
            }));
          }
          break;

        case 'ArrowUp':
          e.preventDefault();
          if (totalItemCount > 0) {
            setState((s) => ({
              ...s,
              highlightedIndex: Math.max(s.highlightedIndex - 1, 0),
            }));
          }
          break;

        case 'Enter':
          e.preventDefault();
          if (state.highlightedIndex >= 0 && state.highlightedIndex < totalItemCount) {
            // J.5: Index 0 is empty option when hasEmptyOption is true
            if (hasEmptyOption && state.highlightedIndex === 0) {
              onSelect('', 'down'); // Clear value
            } else {
              const itemIndex = hasEmptyOption
                ? state.highlightedIndex - 1
                : state.highlightedIndex;
              onSelect(filteredItems[itemIndex], 'down');
            }
          }
          break;

        case 'Tab':
          e.preventDefault();
          if (state.highlightedIndex >= 0 && state.highlightedIndex < totalItemCount) {
            // J.5: Index 0 is empty option when hasEmptyOption is true
            if (hasEmptyOption && state.highlightedIndex === 0) {
              onSelect('', 'right'); // Clear value
            } else {
              const itemIndex = hasEmptyOption
                ? state.highlightedIndex - 1
                : state.highlightedIndex;
              onSelect(filteredItems[itemIndex], 'right');
            }
          }
          break;

        case 'Escape':
          // Let Popover handle escape
          break;

        case 'Home':
          // Only handle Home/End for list navigation when not in search input
          // or when Ctrl is pressed (jump to start/end of list)
          if (e.ctrlKey || !showSearchInput) {
            e.preventDefault();
            setState((s) => ({ ...s, highlightedIndex: 0 }));
          }
          break;

        case 'End':
          if (e.ctrlKey || !showSearchInput) {
            e.preventDefault();
            if (totalItemCount > 0) {
              setState((s) => ({ ...s, highlightedIndex: totalItemCount - 1 }));
            }
          }
          break;

        case 'PageUp':
          e.preventDefault();
          setState((s) => ({
            ...s,
            highlightedIndex: Math.max(s.highlightedIndex - 10, 0),
          }));
          break;

        case 'PageDown':
          e.preventDefault();
          if (totalItemCount > 0) {
            setState((s) => ({
              ...s,
              highlightedIndex: Math.min(s.highlightedIndex + 10, totalItemCount - 1),
            }));
          }
          break;

        default:
          // Type-ahead search - only when search input is NOT shown
          // When search input is shown, let it handle text input naturally
          // J.5: Type-ahead skips the empty option and only matches filtered items
          if (!showSearchInput && e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
            e.preventDefault();

            // Append to search buffer
            const newSearchBuffer = state.searchBuffer + e.key.toLowerCase();

            // Find first matching item starting with the search buffer
            const matchIndex = filteredItems.findIndex((item) =>
              item.toLowerCase().startsWith(newSearchBuffer),
            );

            // Update state with new search buffer and highlighted index
            // J.5: Adjust index for empty option offset
            const adjustedMatchIndex =
              matchIndex !== -1 ? matchIndex + (hasEmptyOption ? 1 : 0) : undefined;
            setState((s) => ({
              ...s,
              searchBuffer: newSearchBuffer,
              highlightedIndex: adjustedMatchIndex ?? s.highlightedIndex,
            }));

            // Clear buffer after timeout
            clearTimeout(searchTimeoutRef.current);
            searchTimeoutRef.current = setTimeout(() => {
              setState((s) => ({ ...s, searchBuffer: '' }));
            }, SEARCH_BUFFER_TIMEOUT_MS);
          }
          break;
      }
    },
    [
      filteredItems,
      hasEmptyOption,
      state.highlightedIndex,
      state.searchBuffer,
      onSelect,
      showSearchInput,
    ],
  );

  // Handle item click
  // J.5: handleItemClick accounts for empty option at index 0
  // Mouse-click commits keep the selection on the cell (Excel parity).
  const handleItemClick = useCallback(
    (index: number) => {
      const totalItemCount = filteredItems.length + (hasEmptyOption ? 1 : 0);
      if (index >= 0 && index < totalItemCount) {
        // J.5: Index 0 is empty option when hasEmptyOption is true
        if (hasEmptyOption && index === 0) {
          onSelect('', 'none'); // Clear value
        } else {
          const itemIndex = hasEmptyOption ? index - 1 : index;
          onSelect(filteredItems[itemIndex], 'none');
        }
      }
    },
    [filteredItems, hasEmptyOption, onSelect],
  );

  // Handle mouse enter on item
  const handleItemMouseEnter = useCallback((index: number) => {
    setState((s) => ({ ...s, highlightedIndex: index }));
  }, []);

  // Clean up search buffer timeout on unmount
  useEffect(() => {
    return () => {
      clearTimeout(searchTimeoutRef.current);
    };
  }, []);

  if (!isOpen) return null;

  return (
    <div
      data-validation-dropdown
      className="overflow-hidden"
      style={{
        minWidth: width,
        maxWidth: Math.max(width, 200),
      }}
      onKeyDown={handleKeyDown}
    >
      {/* Live search input at top of dropdown */}
      {showSearchInput && (
        <div className="p-1 border-b border-ss-border">
          <input
            ref={searchInputRef}
            type="text"
            value={state.liveSearchText}
            onChange={handleSearchInputChange}
            placeholder="Search..."
            className="w-full px-2 py-1 text-body-sm border border-ss-border rounded bg-ss-surface focus:outline-none focus:border-ss-primary"
            aria-label="Search validation options"
          />
        </div>
      )}
      <ul
        ref={listRef}
        className="list-none m-0 p-0 overflow-y-auto"
        style={{ maxHeight }}
        role="listbox"
        aria-label="Validation options"
      >
        {/* J.5: Empty option at top when allowBlank is true */}
        {hasEmptyOption && (
          <li
            key="empty-option"
            className={`px-3 py-1.5 cursor-pointer text-dropdown font-ss-sans text-ss-text-tertiary italic whitespace-nowrap overflow-hidden text-ellipsis hover:bg-ss-surface-hover ${
              state.highlightedIndex === 0 ? 'bg-ss-surface-hover' : ''
            } ${currentValue === '' ? 'bg-ss-primary-light' : ''}`}
            role="option"
            aria-selected={currentValue === ''}
            onClick={() => handleItemClick(0)}
            onMouseEnter={() => handleItemMouseEnter(0)}
          >
            {EMPTY_OPTION_DISPLAY}
          </li>
        )}
        {filteredItems.length === 0 && !hasEmptyOption ? (
          <li className="px-3 py-2 text-dropdown text-ss-text-tertiary italic">
            No matching items
          </li>
        ) : (
          filteredItems.map((item, index) => {
            // J.5: Adjust index for empty option offset
            const displayIndex = hasEmptyOption ? index + 1 : index;
            const isHighlighted = displayIndex === state.highlightedIndex;
            const isSelected = item.toLowerCase() === currentValue.toLowerCase();

            return (
              <li
                key={`${item}-${index}`}
                className={`px-3 py-1.5 cursor-pointer text-dropdown font-ss-sans text-text whitespace-nowrap overflow-hidden text-ellipsis hover:bg-ss-surface-hover ${
                  isHighlighted ? 'bg-ss-surface-hover' : ''
                } ${isSelected ? 'bg-ss-primary-light font-medium' : ''}`}
                role="option"
                aria-selected={isSelected}
                onClick={() => handleItemClick(displayIndex)}
                onMouseEnter={() => handleItemMouseEnter(displayIndex)}
              >
                {item}
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}

// =============================================================================
// Hook for Dropdown State Management
// =============================================================================

/**
 * Hook to manage validation dropdown state.
 */
export function useValidationDropdown() {
  const [isOpen, setIsOpen] = useState(false);
  const [items, setItems] = useState<unknown[]>([]);

  const open = useCallback((dropdownItems: unknown[]) => {
    setItems(dropdownItems);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setItems([]);
  }, []);

  const toggle = useCallback(
    (dropdownItems: unknown[]) => {
      if (isOpen) {
        close();
      } else {
        open(dropdownItems);
      }
    },
    [isOpen, open, close],
  );

  return {
    isOpen,
    items,
    open,
    close,
    toggle,
  };
}
