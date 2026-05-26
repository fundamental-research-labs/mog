/**
 * Number format types, constants, and utility functions
 *
 * This module provides type definitions for number formatting,
 * format constants/presets, and pure format code analysis utilities.
 *
 * Runtime value formatting is handled by Rust (compute-formats crate)
 * via ComputeBridge.formatValues().
 */

// Types from types.ts (kept in contracts)
export type {
  DateTimeToken,
  FormatCategory,
  FormatCondition,
  FormatOptions,
  FormatPreset,
  FormatResult,
  FormatSection,
  FormatSelection,
  LocaleOptions,
  ParsedFormat,
} from './types';

// Runtime constants from Rust-generated format metadata.
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
} from './constants';
