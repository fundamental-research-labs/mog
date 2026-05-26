/**
 * @mog/types-culture — Locale primitives and Rust-generated number-format constants.
 *
 * Tier 0 foundation package. No intra-contracts dependencies.
 *
 * Contains:
 * - CultureInfo and related locale types (culture/types.ts)
 * - Number format type/preset/category declarations and codegen'd constants
 *   (number-formats/constants.ts + constants.gen.ts)
 */

export type { LocaleOptions } from './types';

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
} from './types';

// Number format constants and types (moved from contracts/src/number-formats/)
export {
  ACCOUNTING_FORMATS,
  CURRENCY_FORMATS,
  CURRENCY_SYMBOLS,
  DATE_FORMATS,
  DEFAULT_FORMAT_BY_TYPE,
  EXCEL_BUILTIN_FORMATS,
  FORMAT_CATEGORIES,
  FORMAT_PRESETS,
  FRACTION_FORMATS,
  GENERAL_FORMATS,
  NEGATIVE_FORMATS,
  NUMBER_FORMATS,
  PERCENTAGE_FORMATS,
  SCIENTIFIC_FORMATS,
  SPECIAL_FORMATS,
  TEXT_FORMATS,
  TIME_FORMATS,
} from './number-formats/constants.gen';

export type {
  FormatCategory,
  FormatPreset,
  NumberFormatType,
} from './number-formats/constants.gen';
