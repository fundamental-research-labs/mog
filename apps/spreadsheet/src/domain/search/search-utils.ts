/**
 * Search Utility Functions
 *
 * Pure helper functions for matching cell values against search queries.
 * Used by the search executor.
 *
 */

import type { CellValue, ErrorVariant } from '@mog-sdk/contracts/core';
import { errorDisplayString } from '@mog/spreadsheet-utils/errors';
import type { SearchMatchInfo, SearchOptions } from '@mog-sdk/contracts/search';

// =============================================================================
// Display Value Formatting
// =============================================================================

/**
 * Convert a cell value to its display string representation.
 * Used for searching in displayed values (not formulas).
 *
 * @param value - Cell value (can be primitive, error object, or null)
 * @returns Display string for the value
 */
export function formatDisplayValue(value: CellValue | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }

  // Handle error objects
  if (typeof value === 'object' && 'type' in value && value.type === 'error') {
    return errorDisplayString(value.value as ErrorVariant); // e.g., "#DIV/0!"
  }

  // Handle primitive values
  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE';
  }

  if (typeof value === 'number') {
    // Basic number formatting - actual formatted value would need format string
    // For search purposes, we just convert to string
    return String(value);
  }

  return String(value);
}

// =============================================================================
// Pattern Matching
// =============================================================================

/**
 * Create a matching function based on search options.
 * Returns a function that takes a string and returns match info or null.
 *
 * @param query - Search query string
 * @param options - Search options
 * @returns Matcher function
 */
export function createMatcher(
  query: string,
  options: SearchOptions,
): (text: string) => SearchMatchInfo | null {
  if (query === '') {
    return () => null;
  }

  // Build regex pattern
  let pattern: RegExp;

  if (options.useRegex) {
    // User-provided regex
    try {
      const flags = options.caseSensitive ? 'g' : 'gi';
      pattern = new RegExp(query, flags);
    } catch {
      // Invalid regex - return no matches
      return () => null;
    }
  } else {
    // Escape special regex characters for literal matching
    const escaped = escapeRegExp(query);

    if (options.matchEntireCell) {
      // Match entire cell - anchor to start/end
      pattern = new RegExp(`^${escaped}$`, options.caseSensitive ? '' : 'i');
    } else {
      // Partial match
      pattern = new RegExp(escaped, options.caseSensitive ? 'g' : 'gi');
    }
  }

  return (text: string): SearchMatchInfo | null => {
    // Reset lastIndex for global regex
    pattern.lastIndex = 0;

    const match = pattern.exec(text);
    if (!match) {
      return null;
    }

    return {
      text: match[0],
      start: match.index,
      length: match[0].length,
      isInFormula: false, // Caller sets this based on context
    };
  };
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// =============================================================================
// Cell Matching
// =============================================================================

/**
 * Check if a cell matches the search query.
 * Returns match info if found, null otherwise.
 *
 * @param displayValue - Displayed/computed cell value
 * @param formulaText - Formula text (if cell has a formula)
 * @param options - Search options
 * @param matcher - Pre-built matcher function from createMatcher
 * @returns SearchMatchInfo if match found, null otherwise
 */
export function cellMatchesQuery(
  displayValue: string,
  formulaText: string | undefined,
  options: SearchOptions,
  matcher: (text: string) => SearchMatchInfo | null,
): SearchMatchInfo | null {
  // Search in values (displayed/computed value)
  if (options.searchIn === 'values' || options.searchIn === 'both') {
    const match = matcher(displayValue);
    if (match) {
      return { ...match, isInFormula: false };
    }
  }

  // Search in formulas
  if ((options.searchIn === 'formulas' || options.searchIn === 'both') && formulaText) {
    // formulaText is FormulaA1 — already has "=" prefix
    const match = matcher(formulaText);
    if (match) {
      return { ...match, isInFormula: true };
    }
  }

  return null;
}

// =============================================================================
// Find All Matches
// =============================================================================

/**
 * Find all matches in a text string.
 * Used for "Replace All" to count matches before replacing.
 *
 * @param text - Text to search in
 * @param query - Search query
 * @param options - Search options
 * @returns Array of match infos
 */
export function findAllMatches(
  text: string,
  query: string,
  options: SearchOptions,
): SearchMatchInfo[] {
  if (query === '' || text === '') {
    return [];
  }

  const matches: SearchMatchInfo[] = [];

  // Build regex
  let pattern: RegExp;

  if (options.useRegex) {
    try {
      const flags = options.caseSensitive ? 'g' : 'gi';
      pattern = new RegExp(query, flags);
    } catch {
      return [];
    }
  } else {
    const escaped = escapeRegExp(query);
    if (options.matchEntireCell) {
      // For match entire cell, there's at most one match
      pattern = new RegExp(`^${escaped}$`, options.caseSensitive ? '' : 'i');
    } else {
      pattern = new RegExp(escaped, options.caseSensitive ? 'g' : 'gi');
    }
  }

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    matches.push({
      text: match[0],
      start: match.index,
      length: match[0].length,
      isInFormula: false,
    });

    // For non-global regex, break after first match
    if (!pattern.global) {
      break;
    }

    // Prevent infinite loop for zero-length matches
    if (match[0].length === 0) {
      pattern.lastIndex++;
    }
  }

  return matches;
}

// =============================================================================
// Replace Text
// =============================================================================

/**
 * Replace matches in text with replacement string.
 * Used for Replace and Replace All operations.
 *
 * @param text - Original text
 * @param query - Search query
 * @param replacement - Replacement text
 * @param options - Search options (for regex mode and case sensitivity)
 * @param replaceAll - Whether to replace all occurrences or just first
 * @returns New text with replacements applied
 */
export function replaceText(
  text: string,
  query: string,
  replacement: string,
  options: SearchOptions,
  replaceAll: boolean,
): string {
  if (query === '') {
    return text;
  }

  let pattern: RegExp;

  if (options.useRegex) {
    try {
      const flags = options.caseSensitive ? (replaceAll ? 'g' : '') : replaceAll ? 'gi' : 'i';
      pattern = new RegExp(query, flags);
    } catch {
      return text;
    }
  } else {
    const escaped = escapeRegExp(query);
    if (options.matchEntireCell) {
      pattern = new RegExp(`^${escaped}$`, options.caseSensitive ? '' : 'i');
    } else {
      const flags = options.caseSensitive ? (replaceAll ? 'g' : '') : replaceAll ? 'gi' : 'i';
      pattern = new RegExp(escaped, flags);
    }
  }

  return text.replace(pattern, replacement);
}
