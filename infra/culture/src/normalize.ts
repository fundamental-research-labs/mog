/**
 * Input Normalization
 *
 * Pure functions for normalizing locale-specific number input
 * into standard format for parsing.
 */

import type { CultureInfo } from '@mog-sdk/contracts/culture';

/**
 * Normalize a number string from locale format to standard format.
 * Handles decimal and thousands separators.
 *
 * Examples:
 * - de-DE: "1.000,50" → "1000.50"
 * - fr-FR: "1 000,50" → "1000.50"
 * - en-US: "1,000.50" → "1,000.50" (unchanged)
 */
export function normalizeNumber(input: string, culture: CultureInfo): string {
  const { decimalSeparator, thousandsSeparator } = culture;

  if (decimalSeparator === '.' && thousandsSeparator === ',') {
    return input;
  }

  let result = input;

  if (decimalSeparator === ',' && thousandsSeparator === '.') {
    // European: dots are thousands, comma is decimal
    result = result.replace(/\.(?=\d{3}(?:\D|$))/g, '');
    result = result.replace(/,(\d{1,2})$/, '.$1');
    if (result.includes(',')) {
      result = result.replace(/,/g, '.');
    }
  } else if (thousandsSeparator === ' ' || thousandsSeparator === '\u00A0') {
    // French: space/NBSP as thousands separator
    result = result.replace(/[\s\u00A0](?=\d)/g, '');
    if (decimalSeparator === ',') {
      result = result.replace(/,/g, '.');
    }
  } else {
    // Generic case
    if (thousandsSeparator) {
      const escapedThousands = thousandsSeparator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      result = result.replace(new RegExp(escapedThousands, 'g'), '');
    }
    if (decimalSeparator && decimalSeparator !== '.') {
      result = result.replace(decimalSeparator, '.');
    }
  }

  return result;
}

/**
 * Normalize negative number format.
 *
 * Examples:
 * - "(123)" → "-123" (accounting format)
 * - "123-" → "-123" (trailing minus)
 * - "−123" → "-123" (unicode minus)
 */
export function normalizeNegative(input: string): string {
  const trimmed = input.trim();

  if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
    return '-' + trimmed.slice(1, -1);
  }

  if (trimmed.endsWith('-') && !trimmed.startsWith('-')) {
    return '-' + trimmed.slice(0, -1);
  }

  if (trimmed.startsWith('\u2212')) {
    return '-' + trimmed.slice(1);
  }

  return input;
}
