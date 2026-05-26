/**
 * Format code utility functions
 *
 * Pure string analysis functions for format code manipulation.
 * These do NOT format values — they analyze and build format code strings.
 */

import type { NumberFormatType } from '@mog-sdk/contracts/core';
import { DEFAULT_FORMAT_BY_TYPE } from './constants';
import { isDateFormat } from './date-serial';
import type { FormatOptions } from '@mog-sdk/contracts/number-formats';

// ============================================================================
// Format Type Detection
// ============================================================================

/**
 * Detect the NumberFormatType from a format code
 *
 * @param formatCode - Excel format code
 * @returns The detected NumberFormatType
 */
export function detectFormatType(formatCode: string): NumberFormatType {
  if (!formatCode || formatCode === 'General') {
    return 'general';
  }

  // Text format
  if (formatCode === '@') {
    return 'text';
  }

  // Clean up for analysis
  const cleaned = formatCode.replace(/\[[^\]]+\]/g, '').replace(/"[^"]*"/g, '');

  // Date/Time
  if (isDateFormat(formatCode)) {
    // Check if it has time components only
    if (/[hHsS]|AM\/PM/i.test(cleaned) && !/[yYdD]/i.test(cleaned)) {
      return 'time';
    }
    return 'date';
  }

  // Percentage
  if (cleaned.includes('%')) {
    return 'percentage';
  }

  // Scientific
  if (/E[+-]?/i.test(cleaned)) {
    return 'scientific';
  }

  // Fraction
  if (/[#?]+\/[#?\d]+/.test(cleaned)) {
    return 'fraction';
  }

  // Accounting (has _( pattern for alignment)
  if (/^_\(/.test(formatCode)) {
    return 'accounting';
  }

  // Currency (has currency symbol)
  if (/[$€£¥₹₩₽₺฿₱]|CHF|CA\$|A\$|HK\$|NT\$|S\$|R\$|Mex\$|AED|SAR/.test(cleaned)) {
    return 'currency';
  }

  // Special formats (ZIP, Phone, SSN)
  // Check for patterns like 00000, 00000-0000, (###) ###-####, 000-00-0000
  if (
    /^0{5}$/.test(formatCode) || // 00000 (ZIP)
    /^0{5}-0{4}$/.test(formatCode) || // 00000-0000 (ZIP+4)
    /^\(#{3}\)\s?#{3}-#{4}$/.test(formatCode) || // (###) ###-#### (Phone)
    /^0{3}-0{2}-0{4}$/.test(formatCode) // 000-00-0000 (SSN)
  ) {
    return 'special';
  }

  // Number (has number placeholders)
  if (/[#0]/.test(cleaned)) {
    return 'number';
  }

  // Default to custom if we can't detect
  return 'custom';
}

// ============================================================================
// Format Code Building
// ============================================================================

/**
 * Build a format code from options
 *
 * @param options - Format options
 * @returns Excel-compatible format code
 */
export function buildFormatCode(options: FormatOptions): string {
  const { type, decimalPlaces = 2, useThousandsSeparator = true, currencySymbol = '$' } = options;

  switch (type) {
    case 'general':
      return 'General';

    case 'number': {
      const intPart = useThousandsSeparator ? '#,##0' : '0';
      if (decimalPlaces > 0) {
        return `${intPart}.${'0'.repeat(decimalPlaces)}`;
      }
      return intPart;
    }

    case 'currency': {
      const intPart = useThousandsSeparator ? '#,##0' : '0';
      const numFormat = decimalPlaces > 0 ? `${intPart}.${'0'.repeat(decimalPlaces)}` : intPart;

      switch (options.negativeFormat) {
        case 'parentheses':
          return `${currencySymbol}${numFormat};(${currencySymbol}${numFormat})`;
        case 'minusRed':
          return `${currencySymbol}${numFormat};[Red]-${currencySymbol}${numFormat}`;
        case 'parenthesesRed':
          return `${currencySymbol}${numFormat};[Red](${currencySymbol}${numFormat})`;
        default:
          return `${currencySymbol}${numFormat}`;
      }
    }

    case 'accounting': {
      const decPart = decimalPlaces > 0 ? '.' + '0'.repeat(decimalPlaces) : '';
      return `_(${currencySymbol}* #,##0${decPart}_);_(${currencySymbol}* (#,##0${decPart});_(${currencySymbol}* "-"??_);_(@_)`;
    }

    case 'percentage': {
      if (decimalPlaces > 0) {
        return `0.${'0'.repeat(decimalPlaces)}%`;
      }
      return '0%';
    }

    case 'scientific': {
      const decPart = decimalPlaces > 0 ? '.' + '0'.repeat(decimalPlaces) : '';
      return `0${decPart}E+00`;
    }

    case 'fraction': {
      switch (options.fractionType) {
        case 'halves':
          return '# ?/2';
        case 'quarters':
          return '# ?/4';
        case 'eighths':
          return '# ?/8';
        case 'tenths':
          return '# ?/10';
        case 'hundredths':
          return '# ??/100';
        case 'custom':
          return options.customDenominator ? `# ?/${options.customDenominator}` : '# ?/?';
        default:
          return '# ?/?';
      }
    }

    case 'date':
      return options.dateFormat || 'M/D/YYYY';

    case 'time':
      return options.timeFormat || 'h:mm AM/PM';

    case 'text':
      return '@';

    case 'custom':
      return options.dateFormat || 'General';

    default:
      return 'General';
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get the default format code for a format type
 */
export function getDefaultFormat(type: NumberFormatType): string {
  return DEFAULT_FORMAT_BY_TYPE[type] || 'General';
}
