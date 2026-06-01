/**
 * Function Suggestions Component
 *
 * Displays a list of function suggestions during formula autocomplete.
 * Supports keyboard navigation and fuzzy matching.
 *
 * Design principles:
 * - Stateless component - selection state from editor machine
 * - Fuzzy matching for better discoverability
 * - Keyboard navigation (↑↓ Tab Esc)
 *
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';

import type { FunctionInfo } from '../../internal-api';
import type { NameSuggestion } from '../../domain/editor/name-completion';

// =============================================================================
// Types
// =============================================================================

export interface FunctionSuggestionsProps {
  /** Current prefix being typed */
  prefix: string;
  /** All available functions */
  allFunctions: FunctionInfo[];
  /** Named range / table / sheet suggestions to show after functions */
  nameSuggestions?: NameSuggestion[];
  /** Currently selected index (from editor machine) */
  selectedIndex: number;
  /** Callback when a function is selected */
  onSelect: (name: string) => void;
  /** Callback for keyboard navigation */
  onNavigate: (direction: 'up' | 'down') => void;
  /** Callback to dismiss suggestions */
  onDismiss: () => void;
  /** Screen position for the popup */
  position: { x: number; y: number };
  /** Maximum items to show (default 10) */
  maxItems?: number;
}

// =============================================================================
// Fuzzy Match Utility
// =============================================================================

interface FuzzyMatchResult {
  matches: boolean;
  score: number;
  /** Indices of matched characters for highlighting */
  matchedIndices: number[];
}

/**
 * Simple fuzzy match - checks if all characters in pattern appear in text in order.
 * Returns match status, score, and matched character indices.
 */
function fuzzyMatch(pattern: string, text: string): FuzzyMatchResult {
  const patternUpper = pattern.toUpperCase();
  const textUpper = text.toUpperCase();
  const matchedIndices: number[] = [];

  // Exact prefix match gets highest score
  if (textUpper.startsWith(patternUpper)) {
    for (let i = 0; i < pattern.length; i++) {
      matchedIndices.push(i);
    }
    return {
      matches: true,
      score: 1000 - text.length, // Prefer shorter names
      matchedIndices,
    };
  }

  // Fuzzy match - find all pattern chars in order
  let patternIdx = 0;
  let score = 0;
  let lastMatchIdx = -1;

  for (let i = 0; i < textUpper.length && patternIdx < patternUpper.length; i++) {
    if (textUpper[i] === patternUpper[patternIdx]) {
      matchedIndices.push(i);
      // Consecutive matches score higher
      if (lastMatchIdx === i - 1) {
        score += 10;
      } else {
        score += 1;
      }
      lastMatchIdx = i;
      patternIdx++;
    }
  }

  return {
    matches: patternIdx === patternUpper.length,
    score: score - text.length, // Prefer shorter names
    matchedIndices,
  };
}

// =============================================================================
// Highlight Component
// =============================================================================

interface HighlightedTextProps {
  text: string;
  matchedIndices: number[];
}

/**
 * Renders text with matched characters highlighted.
 */
function HighlightedText({ text, matchedIndices }: HighlightedTextProps) {
  const indexSet = new Set(matchedIndices);

  return (
    <>
      {text.split('').map((char, i) => (
        <span key={i} className={indexSet.has(i) ? 'text-ss-primary font-bold' : ''}>
          {char}
        </span>
      ))}
    </>
  );
}

function nameSuggestionTypeLabel(ns: NameSuggestion): string {
  return ns.type === 'definedName' ? 'Name' : ns.type === 'table' ? 'Table' : ns.type;
}

// =============================================================================
// Component
// =============================================================================

export function FunctionSuggestions({
  prefix,
  allFunctions,
  nameSuggestions = [],
  selectedIndex,
  onSelect,
  onNavigate,
  onDismiss,
  position,
  maxItems = 10,
}: FunctionSuggestionsProps) {
  const listRef = useRef<HTMLUListElement>(null);

  // Filter and sort functions by fuzzy match
  const filteredFunctions = useMemo(() => {
    if (!prefix) return [];

    return allFunctions
      .map((fn) => ({
        fn,
        ...fuzzyMatch(prefix, fn.name),
      }))
      .filter((item) => item.matches)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxItems);
  }, [prefix, allFunctions, maxItems]);

  // Clamp selected index to valid range across all suggestions (functions + names)
  const totalCount = filteredFunctions.length + nameSuggestions.length;
  const clampedIndex = Math.min(selectedIndex, totalCount - 1);

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current && clampedIndex >= 0) {
      const items = listRef.current.querySelectorAll('[role="option"]');
      const selectedItem = items[clampedIndex] as HTMLElement | undefined;
      selectedItem?.scrollIntoView({ block: 'nearest' });
    }
  }, [clampedIndex]);

  // Handle keyboard events
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          e.stopPropagation();
          onNavigate('up');
          break;
        case 'ArrowDown':
          e.preventDefault();
          e.stopPropagation();
          onNavigate('down');
          break;
        case 'Tab': {
          // Tab accepts the highlighted suggestion
          // Enter does NOT accept — it commits the cell as-is (Excel parity)
          e.preventDefault();
          e.stopPropagation();
          const fnItem = filteredFunctions[clampedIndex];
          if (fnItem) {
            onSelect(fnItem.fn.name);
          } else {
            const nameItem = nameSuggestions[clampedIndex - filteredFunctions.length];
            if (nameItem) onSelect(nameItem.name);
          }
          break;
        }
        case 'Escape':
          e.preventDefault();
          e.stopPropagation();
          onDismiss();
          break;
      }
    },
    [onNavigate, onSelect, onDismiss, filteredFunctions, clampedIndex],
  );

  // Handle item click
  const handleItemClick = useCallback(
    (name: string) => {
      onSelect(name);
    },
    [onSelect],
  );

  // Don't render if no matches at all
  if (filteredFunctions.length === 0 && nameSuggestions.length === 0) {
    return null;
  }

  return (
    <div
      data-testid="formula-autocomplete"
      className="fixed z-ss-popover pointer-events-auto bg-ss-surface border border-ss-border rounded shadow-ss-lg overflow-hidden min-w-[280px] max-w-[400px]"
      style={{ left: position.x, top: position.y }}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
      data-no-grid-pointer
    >
      <ul
        ref={listRef}
        className="max-h-[300px] overflow-y-auto"
        role="listbox"
        aria-label="Function suggestions"
      >
        {filteredFunctions.map((item, index) => (
          <li
            key={item.fn.name}
            role="option"
            data-suggestion={item.fn.name}
            aria-label={`${item.fn.name} ${item.fn.description} ${item.fn.category}`}
            aria-selected={index === clampedIndex}
            className={`
 px-3 py-2 cursor-pointer flex items-start gap-3
 ${index === clampedIndex ? 'bg-ss-primary-lighter text-ss-primary' : 'hover:bg-ss-surface-hover'}
 `}
            onClick={() => handleItemClick(item.fn.name)}
            onMouseEnter={() => {
              // Could optionally update selection on hover
            }}
          >
            <div className="flex-1 min-w-0">
              <div className="font-ss-mono font-medium text-body">
                <HighlightedText text={item.fn.name} matchedIndices={item.matchedIndices} />
              </div>
              <span className="sr-only"> </span>
              <div className="text-caption text-text-muted truncate mt-0.5">
                {item.fn.description}
              </div>
              <span className="sr-only"> </span>
            </div>
            <div className="text-caption text-text-muted bg-ss-surface-secondary px-1.5 py-0.5 rounded shrink-0">
              {item.fn.category}
            </div>
          </li>
        ))}
        {nameSuggestions.map((ns, i) => {
          const globalIndex = filteredFunctions.length + i;
          return (
            <li
              key={`name:${ns.name}`}
              role="option"
              data-suggestion={ns.name}
              aria-label={`${ns.name} ${ns.refersTo} ${nameSuggestionTypeLabel(ns)}`}
              aria-selected={globalIndex === clampedIndex}
              className={`
 px-3 py-2 cursor-pointer flex items-start gap-3
 ${globalIndex === clampedIndex ? 'bg-ss-primary-lighter text-ss-primary' : 'hover:bg-ss-surface-hover'}
 `}
              onClick={() => handleItemClick(ns.name)}
            >
              <div className="flex-1 min-w-0">
                <div className="font-ss-mono font-medium text-body">{ns.name}</div>
                <span className="sr-only"> </span>
                <div className="text-caption text-text-muted truncate mt-0.5">{ns.refersTo}</div>
                <span className="sr-only"> </span>
              </div>
              <div className="text-caption text-text-muted bg-ss-surface-secondary px-1.5 py-0.5 rounded shrink-0">
                {nameSuggestionTypeLabel(ns)}
              </div>
            </li>
          );
        })}
      </ul>

      {/* Keyboard hints footer */}
      <div className="px-3 py-1.5 text-caption text-text-muted border-t border-ss-border bg-ss-surface-secondary flex gap-3">
        <span>
          <kbd className="px-1 py-0.5 bg-ss-surface rounded border border-ss-border text-ribbon-compact">
            ↑↓
          </kbd>{' '}
          navigate
        </span>
        <span>
          <kbd className="px-1 py-0.5 bg-ss-surface rounded border border-ss-border text-ribbon-compact">
            Tab
          </kbd>{' '}
          accept
        </span>
        <span>
          <kbd className="px-1 py-0.5 bg-ss-surface rounded border border-ss-border text-ribbon-compact">
            Esc
          </kbd>{' '}
          dismiss
        </span>
      </div>
    </div>
  );
}
