/**
 * Culture Utility Functions
 *
 * Extracted from @mog-sdk/contracts/culture/utils.
 */

import type { CultureInfo } from '@mog-sdk/contracts/culture';
import type { LocaleOptions } from '@mog-sdk/contracts/culture';

// Re-export so consumers can import from this module
export type { LocaleOptions } from '@mog-sdk/contracts/culture';

/**
 * Extract date order from a date pattern string.
 */
function getDateOrderFromPattern(pattern: string): 'MDY' | 'DMY' | 'YMD' {
  const monthIdx = pattern.search(/M+/i);
  const dayIdx = pattern.search(/d+/i);
  const yearIdx = pattern.search(/y+/i);

  if (yearIdx < monthIdx && yearIdx < dayIdx) {
    return 'YMD';
  } else if (dayIdx < monthIdx) {
    return 'DMY';
  } else {
    return 'MDY';
  }
}

/**
 * Convert a CultureInfo to LocaleOptions for use with formatValue().
 */
export function cultureToLocaleOptions(culture: CultureInfo): LocaleOptions {
  return {
    decimalSeparator: culture.decimalSeparator,
    thousandsSeparator: culture.thousandsSeparator,
    currencySymbol: culture.currencySymbol,
    dateOrder: getDateOrderFromPattern(culture.shortDatePattern),
    use24Hour: !culture.shortTimePattern.includes('tt') && !culture.shortTimePattern.includes('t'),
    currencyPositivePattern: culture.currencyPositivePattern,
    currencyNegativePattern: culture.currencyNegativePattern,
    culture,
  };
}
