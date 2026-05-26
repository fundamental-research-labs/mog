/**
 * Default locale settings for number formatting.
 *
 * These defaults provide US-style formatting as the baseline.
 */

import type { LocaleOptions } from '@mog-sdk/contracts/culture';

/**
 * Default locale options for number formatting.
 *
 * Stream G: Currency patterns are NOT set by default.
 * Culture-aware currency positioning only applies when the caller explicitly
 * passes a locale with currencyPositivePattern/currencyNegativePattern.
 * This preserves backward compatibility: format codes are interpreted literally
 * unless culture formatting is explicitly requested.
 */
export const DEFAULT_LOCALE: LocaleOptions = {
  decimalSeparator: '.',
  thousandsSeparator: ',',
  currencySymbol: '$',
  dateOrder: 'MDY',
  use24Hour: false,
  // Stream G: Currency patterns are NOT set by default.
  // Culture-aware currency positioning only applies when the caller explicitly
  // passes a locale with currencyPositivePattern/currencyNegativePattern.
  // This preserves backward compatibility: format codes are interpreted literally
  // unless culture formatting is explicitly requested.
};
