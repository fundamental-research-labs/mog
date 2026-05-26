/**
 * Locale Bridge Interface
 *
 * Defines the contract for locale-aware input normalization.
 * This interface handles locale-specific number parsing, transforming
 * locale-specific formats into normalized format for the schema engine.
 *
 * Features:
 * - Locale-aware decimal separator (1,5 -> 1.5 in European locales)
 * - Locale-aware thousands separator (1.000,50 -> 1000.50)
 * - Locale-aware negative format ((123) -> -123)
 * - Fraction input recognition (1/2 -> 0.5, 3 1/4 -> 3.25)
 * - Format auto-detection from input ($100 -> currency format)
 *
 * @see engine/src/state/bridges/locale-bridge.ts - Implementation
 * @see contracts/src/culture.ts - CultureInfo type
 */

import type { SheetId } from '@mog/types-core';
import type { CultureInfo } from '@mog/types-culture/types';

// =============================================================================
// Types
// =============================================================================

/**
 * Result of normalizing user input.
 */
export interface LocaleNormalizationResult {
  /** The normalized value (locale-agnostic) */
  normalizedValue: string;
  /** Whether normalization was applied */
  wasNormalized: boolean;
  /** Detected input type for format auto-detection */
  detectedType?: 'number' | 'currency' | 'percentage' | 'fraction' | 'date' | 'time';
  /** Suggested format code based on input */
  suggestedFormat?: string;
  /** Detected currency symbol if any */
  currencySymbol?: string;
}

/**
 * Partial cell format for format suggestions.
 */
export interface PartialCellFormat {
  /** Suggested number format code */
  numberFormat?: string;
}

// =============================================================================
// Locale Bridge Interface
// =============================================================================

/**
 * Bridge interface for locale-aware input handling.
 *
 * This interface provides methods for normalizing user input according to
 * locale settings and suggesting appropriate cell formats.
 */
export interface ILocaleBridge {
  // ===========================================================================
  // Input Normalization
  // ===========================================================================

  /**
   * Normalize user input according to locale settings.
   * Call this before passing input to coercion.
   *
   * @param input - Raw user input string
   * @param sheetId - Sheet for locale lookup (optional)
   * @returns Normalization result with locale-agnostic value
   */
  normalizeInput(input: string, sheetId?: SheetId): LocaleNormalizationResult;

  // ===========================================================================
  // Locale Information
  // ===========================================================================

  /**
   * Get the decimal separator for the current locale.
   * Used for numpad decimal key handling.
   *
   * @param sheetId - Sheet for locale lookup (optional)
   * @returns Decimal separator character ('.' or ',')
   */
  getDecimalSeparator(sheetId?: SheetId): string;

  /**
   * Get the thousands separator for the current locale.
   *
   * @param sheetId - Sheet for locale lookup (optional)
   * @returns Thousands separator character (',', '.', or ' ')
   */
  getThousandsSeparator(sheetId?: SheetId): string;

  /**
   * Get the current culture info.
   *
   * @param sheetId - Sheet for locale lookup (optional)
   * @returns Full CultureInfo object
   */
  getCulture(sheetId?: SheetId): CultureInfo;

  // ===========================================================================
  // Format Suggestion
  // ===========================================================================

  /**
   * Suggest a cell format based on input pattern.
   *
   * @param input - Raw user input string
   * @param sheetId - Sheet for locale lookup (optional)
   * @returns Suggested format or undefined
   */
  suggestFormat(input: string, sheetId?: SheetId): PartialCellFormat | undefined;

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Cleanup resources.
   */
  destroy(): void;
}
