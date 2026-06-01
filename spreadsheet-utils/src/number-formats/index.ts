/**
 * Number format utilities
 *
 * Pure functions for format code analysis, building, and date serial conversion.
 * Runtime value formatting is handled by Rust (compute-formats crate) via ComputeBridge.
 *
 * Relocated from @mog/number-formats — only the utility subset, not the formatting engine.
 */

// Types (re-exported from contracts for consumer convenience)
export type { FormatPreset } from '@mog-sdk/contracts/number-formats';

// Constants
export {
  CURRENCY_SYMBOLS,
  DATE_FORMATS,
  DEFAULT_FORMAT_BY_TYPE,
  FRACTION_FORMATS,
  SPECIAL_FORMATS,
  TIME_FORMATS,
} from './constants';

// Format utilities (pure string analysis)
export { buildFormatCode, detectFormatType, getDefaultFormat } from './format-utils';
export {
  formatExcelValue,
  formatExcelValueResult,
  type ExcelNumberFormatColor,
  type ExcelNumberFormatColorName,
  type ExcelNumberFormatResult,
  type ExcelNumberFormatSection,
} from './value-format';
export { classifyDateFormat, type DateFormatClassification } from './date-classification';

// Date serial utilities
export {
  combineDateTimeSerial,
  dateToSerial,
  formatDateSerial,
  formatElapsedTime,
  getDateComponents,
  isDateFormat,
  isLikelyDateSerial,
  isTimeOnlyFormat,
  serialToDate,
  serialToTime,
  timeToSerial,
} from './date-serial';

// Error utilities
export { errorDisplayString } from './error-utils';

// Culture utilities
export { cultureToLocaleOptions } from './culture/utils';
export { isSupportedCultureName } from './culture/types';

// Locale
export { DEFAULT_LOCALE } from './locale';
