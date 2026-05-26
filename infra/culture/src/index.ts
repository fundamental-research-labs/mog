/**
 * @mog/culture
 *
 * OS-level culture/locale package. Leaf dependency — any app can import this
 * without pulling in kernel or spreadsheet concepts.
 */

// Registry
export {
  getAllCultures,
  getCulture,
  getDefaultCulture,
  getSupportedCultures,
  isCultureSupported,
} from './registry';

// Individual culture definitions
export {
  DE_DE,
  EN_GB,
  EN_US,
  ES_ES,
  FR_FR,
  IT_IT,
  JA_JP,
  KO_KR,
  PT_BR,
  ZH_CN,
} from './cultures.gen';

// Input normalization
export { normalizeNegative, normalizeNumber } from './normalize';

// Input detection
export {
  detectCurrency,
  detectPercentage,
  parseFraction,
  stripCurrency,
  stripPercentage,
} from './detect';

// Re-export types from contracts so consumers can do single imports
export type {
  CultureInfo,
  CurrencyNegativePattern,
  CurrencyPositivePattern,
  DayNamesTuple,
  DayOfWeek,
  MonthNamesTuple,
  NegativeNumberPattern,
  PercentNegativePattern,
  PercentPositivePattern,
  SupportedCultureName,
} from '@mog-sdk/contracts/culture';
