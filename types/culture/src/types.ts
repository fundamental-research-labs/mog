/**
 * Culture/Locale types for internationalized number, date, and currency formatting.
 *
 * Stream G: Culture & Localization
 *
 * Design principles:
 * 1. CultureInfo is immutable and complete - no partial definitions
 * 2. Culture is workbook-level state (persisted in WorkbookSettings.culture)
 * 3. Format codes are culture-agnostic; culture applies at render time
 * 4. Uses IETF language tags (en-US, de-DE) not Windows locale IDs
 */

// ============================================================================
// Enums
// ============================================================================

/**
 * Day of week for firstDayOfWeek setting.
 * 0 = Sunday (US, Japan), 1 = Monday (most of Europe)
 */
export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Currency positive pattern (matches .NET NumberFormatInfo).
 * Determines where the currency symbol appears relative to the number.
 *
 * 0 = $n    (symbol before, no space) - en-US
 * 1 = n$    (symbol after, no space)
 * 2 = $ n   (symbol before, space)
 * 3 = n $   (symbol after, space) - de-DE, fr-FR
 */
export type CurrencyPositivePattern = 0 | 1 | 2 | 3;

/**
 * Currency negative pattern (matches .NET NumberFormatInfo).
 * Determines how negative currency values are displayed.
 *
 * 0  = ($n)     - en-US accounting
 * 1  = -$n      - en-US standard
 * 2  = $-n
 * 3  = $n-
 * 4  = (n$)
 * 5  = -n$
 * 6  = n-$
 * 7  = n$-
 * 8  = -n $     - de-DE
 * 9  = -$ n
 * 10 = n $-
 * 11 = $ n-
 * 12 = $ -n
 * 13 = n- $
 * 14 = ($ n)
 * 15 = (n $)
 */
export type CurrencyNegativePattern =
  | 0
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10
  | 11
  | 12
  | 13
  | 14
  | 15;

/**
 * Negative number pattern.
 * Determines how negative numbers are displayed (outside of currency context).
 *
 * 0 = (n)      - parentheses
 * 1 = -n       - leading minus (most common)
 * 2 = - n      - leading minus with space
 * 3 = n-       - trailing minus
 * 4 = n -      - trailing minus with space
 */
export type NegativeNumberPattern = 0 | 1 | 2 | 3 | 4;

/**
 * Percent positive pattern.
 *
 * 0 = n %      - number, space, percent
 * 1 = n%       - number, percent (most common)
 * 2 = %n       - percent, number
 * 3 = % n      - percent, space, number
 */
export type PercentPositivePattern = 0 | 1 | 2 | 3;

/**
 * Percent negative pattern.
 *
 * 0 = -n %
 * 1 = -n%
 * 2 = -%n
 * 3 = %-n
 * 4 = %n-
 * 5 = n-%
 * 6 = n%-
 * 7 = -% n
 * 8 = n %-
 * 9 = % n-
 * 10 = % -n
 * 11 = n- %
 */
export type PercentNegativePattern = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;

// ============================================================================
// Main Interface
// ============================================================================

/**
 * Complete culture information for formatting numbers, dates, and currencies.
 *
 * All properties are required - no partial cultures allowed.
 * Use the culture registry to get complete CultureInfo objects.
 *
 * @example
 * ```typescript
 * const culture = getCulture('de-DE');
 * // culture.decimalSeparator === ','
 * // culture.thousandsSeparator === '.'
 * // culture.monthNames[0] === 'Januar'
 * ```
 */
export interface CultureInfo {
  // ===========================================================================
  // Identification
  // ===========================================================================

  /**
   * IETF language tag (e.g., 'en-US', 'de-DE', 'ja-JP').
   * This is the key used to look up the culture in the registry.
   */
  name: string;

  /**
   * Human-readable display name (e.g., 'English (United States)').
   * Used in UI dropdowns.
   */
  displayName: string;

  /**
   * Native name in the culture's own language (e.g., 'Deutsch (Deutschland)').
   */
  nativeName: string;

  /**
   * ISO 639-1 two-letter language code (e.g., 'en', 'de', 'ja').
   */
  twoLetterLanguageCode: string;

  // ===========================================================================
  // Number Formatting
  // ===========================================================================

  /**
   * Decimal separator character (e.g., '.' for en-US, ',' for de-DE).
   */
  decimalSeparator: string;

  /**
   * Thousands/grouping separator (e.g., ',' for en-US, '.' for de-DE, ' ' for fr-FR).
   */
  thousandsSeparator: string;

  /**
   * Negative sign (usually '-').
   */
  negativeSign: string;

  /**
   * Positive sign (usually '+' or '').
   */
  positiveSign: string;

  /**
   * Pattern for negative numbers.
   */
  negativeNumberPattern: NegativeNumberPattern;

  /**
   * Number of digits per group (usually 3).
   * Some cultures use variable grouping (e.g., Indian: 3, then 2, 2, 2...).
   * For simplicity, we use a single value in v1.
   */
  numberGroupSize: number;

  // ===========================================================================
  // Percent Formatting
  // ===========================================================================

  /**
   * Percent symbol (usually '%').
   */
  percentSymbol: string;

  /**
   * Per mille symbol (‰).
   */
  perMilleSymbol: string;

  /**
   * Pattern for positive percentages.
   */
  percentPositivePattern: PercentPositivePattern;

  /**
   * Pattern for negative percentages.
   */
  percentNegativePattern: PercentNegativePattern;

  // ===========================================================================
  // Currency Formatting
  // ===========================================================================

  /**
   * Default currency symbol for this culture (e.g., '$', '€', '¥').
   */
  currencySymbol: string;

  /**
   * ISO 4217 currency code (e.g., 'USD', 'EUR', 'JPY').
   */
  currencyCode: string;

  /**
   * Pattern for positive currency values.
   */
  currencyPositivePattern: CurrencyPositivePattern;

  /**
   * Pattern for negative currency values.
   */
  currencyNegativePattern: CurrencyNegativePattern;

  /**
   * Number of decimal digits for currency (e.g., 2 for USD, 0 for JPY).
   */
  currencyDecimalDigits: number;

  // ===========================================================================
  // Date/Time Separators
  // ===========================================================================

  /**
   * Date separator (e.g., '/' for en-US, '.' for de-DE).
   */
  dateSeparator: string;

  /**
   * Time separator (e.g., ':').
   */
  timeSeparator: string;

  // ===========================================================================
  // Date/Time Patterns
  // ===========================================================================

  /**
   * Short date pattern (e.g., 'M/d/yyyy' for en-US, 'dd.MM.yyyy' for de-DE).
   * Used for format code interpretation.
   */
  shortDatePattern: string;

  /**
   * Long date pattern (e.g., 'dddd, MMMM d, yyyy').
   */
  longDatePattern: string;

  /**
   * Short time pattern (e.g., 'h:mm tt' for en-US, 'HH:mm' for de-DE).
   */
  shortTimePattern: string;

  /**
   * Long time pattern (e.g., 'h:mm:ss tt' for en-US, 'HH:mm:ss' for de-DE).
   */
  longTimePattern: string;

  /**
   * AM designator (e.g., 'AM' for en-US, '' for 24-hour cultures).
   */
  amDesignator: string;

  /**
   * PM designator (e.g., 'PM' for en-US, '' for 24-hour cultures).
   */
  pmDesignator: string;

  /**
   * First day of the week (0 = Sunday, 1 = Monday).
   */
  firstDayOfWeek: DayOfWeek;

  // ===========================================================================
  // Month Names
  // ===========================================================================

  /**
   * Full month names (12 entries, January = index 0).
   */
  monthNames: readonly [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];

  /**
   * Abbreviated month names (12 entries, Jan = index 0).
   */
  abbreviatedMonthNames: readonly [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];

  // ===========================================================================
  // Day Names
  // ===========================================================================

  /**
   * Full day names (7 entries, Sunday = index 0).
   */
  dayNames: readonly [string, string, string, string, string, string, string];

  /**
   * Abbreviated day names (7 entries, Sun = index 0).
   */
  abbreviatedDayNames: readonly [string, string, string, string, string, string, string];

  /**
   * Shortest day names (7 entries, typically 1-2 letters).
   * Used in narrow calendar UIs.
   */
  shortestDayNames: readonly [string, string, string, string, string, string, string];

  // ===========================================================================
  // Boolean Display
  // ===========================================================================

  /**
   * String for TRUE value (e.g., 'TRUE', 'WAHR', 'VRAI').
   */
  trueString: string;

  /**
   * String for FALSE value (e.g., 'FALSE', 'FALSCH', 'FAUX').
   */
  falseString: string;

  // ===========================================================================
  // List Formatting
  // ===========================================================================

  /**
   * List separator (e.g., ',' for en-US, ';' for de-DE).
   * This affects function argument separators in formulas.
   */
  listSeparator: string;
}

// ============================================================================
// Type Guards and Utilities
// ============================================================================

/**
 * Type for the 12-element tuple of month names.
 */
export type MonthNamesTuple = readonly [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];

/**
 * Type for the 7-element tuple of day names.
 */
export type DayNamesTuple = readonly [string, string, string, string, string, string, string];

/**
 * Supported culture name literals (for strict typing in some contexts).
 */
export type SupportedCultureName =
  | 'en-US'
  | 'en-GB'
  | 'de-DE'
  | 'fr-FR'
  | 'es-ES'
  | 'it-IT'
  | 'pt-BR'
  | 'ja-JP'
  | 'zh-CN'
  | 'ko-KR';

/**
 * Locale-specific formatting options.
 *
 * A lightweight subset of CultureInfo properties needed by the format engine.
 * Use cultureToLocaleOptions() to derive from a full CultureInfo.
 */
export interface LocaleOptions {
  decimalSeparator?: string;
  thousandsSeparator?: string;
  currencySymbol?: string;
  dateOrder?: 'MDY' | 'DMY' | 'YMD';
  use24Hour?: boolean;
  currencyPositivePattern?: 0 | 1 | 2 | 3;
  currencyNegativePattern?: number;
  culture?: CultureInfo;
}
