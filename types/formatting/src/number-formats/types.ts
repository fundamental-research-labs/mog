/**
 * Number format types and interfaces
 */

import type { NumberFormatType } from '@mog/types-core';

/**
 * A format preset with code and example display.
 * Defined in Rust, generated into constants.gen.ts.
 */
export type { FormatPreset } from '@mog/types-culture/number-formats/constants.gen';

/**
 * Parsed format code structure.
 * Excel format codes can have up to 4 sections: positive;negative;zero;text
 */
export interface ParsedFormat {
  positive: FormatSection;
  negative?: FormatSection;
  zero?: FormatSection;
  text?: FormatSection;
}

/**
 * A single section of a format code
 */
export interface FormatSection {
  /** Raw format string for this section */
  raw: string;
  /** Text prefix before the number */
  prefix?: string;
  /** Text suffix after the number */
  suffix?: string;
  /** Color directive: [Red], [Blue], [Green], etc. */
  color?: string;
  /** Conditional directive: [>100], [<=0], etc. */
  condition?: FormatCondition;
  /** Minimum integer digits (0 = none required) */
  integerDigits: number;
  /** Decimal places (undefined = none) */
  decimalDigits?: number;
  /** Whether to use thousands separator */
  useThousands: boolean;
  /** Whether this is a percentage format */
  isPercent: boolean;
  /** Whether this is scientific notation */
  isScientific: boolean;
  /** Currency symbol if present */
  currencySymbol?: string;
  /** Date/time tokens if this is a date format */
  dateTimeTokens?: DateTimeToken[];
  /** Whether this section forces text */
  isText: boolean;
  /** Fraction format denominator (if fraction) */
  fractionDenominator?: number;
  /** Fraction format max denominator digits (e.g., ?/? = 1, ??/?? = 2) */
  fractionDigits?: number;
  /** Scale factor for thousands scaling (1000 per trailing comma) */
  scaleFactor?: number;
  /** Number of ? placeholders in integer part (for space padding) */
  integerSpacePlaceholders?: number;
  /** Number of ? placeholders in decimal part (for space padding) */
  decimalSpacePlaceholders?: number;
}

/**
 * Conditional format directive
 */
export interface FormatCondition {
  operator: '>' | '>=' | '<' | '<=' | '=' | '<>';
  value: number;
}

/**
 * Date/time token in a format string
 */
export interface DateTimeToken {
  type:
    | 'year' // y, yy, yyyy
    | 'month' // m, mm, mmm, mmmm
    | 'day' // d, dd, ddd, dddd
    | 'hour' // h, hh (12-hour) or H, HH (24-hour)
    | 'minute' // m, mm (in time context)
    | 'second' // s, ss
    | 'ampm' // AM/PM, am/pm, A/P
    | 'literal'; // literal text
  format: string; // Original token string
  value?: string; // For literals, the text value
}

/**
 * Options for building a format code
 */
export interface FormatOptions {
  type: NumberFormatType;
  decimalPlaces?: number;
  useThousandsSeparator?: boolean;
  currencySymbol?: string;
  negativeFormat?: 'minus' | 'parentheses' | 'minusRed' | 'parenthesesRed';
  dateFormat?: string;
  timeFormat?: string;
  fractionType?: 'halves' | 'quarters' | 'eighths' | 'tenths' | 'hundredths' | 'custom';
  customDenominator?: number;
}

/**
 * Result of formatting a value
 */
export interface FormatResult {
  /** Formatted display string */
  text: string;
  /** Color to apply (from format directives like [Red]) */
  color?: string;
  /** Whether this is an error value */
  isError?: boolean;
}

/**
 * Format selection for UI
 */
export interface FormatSelection {
  /** The format code string to store */
  formatCode: string;
  /** Category type for the numberFormatType field */
  formatType: NumberFormatType;
}

/**
 * Category definition for UI.
 * Defined in Rust, generated into constants.gen.ts.
 */
export type { FormatCategory } from '@mog/types-culture/number-formats/constants.gen';

/**
 * Re-export LocaleOptions from culture utils.
 *
 * This interface provides the subset of CultureInfo properties needed for formatting.
 * Use getCulture() from the culture registry to get a full CultureInfo, then pass
 * relevant fields as LocaleOptions.
 *
 * Stream G: Currency position/spacing patterns added.
 */
export type { LocaleOptions } from '@mog/types-culture/types';
