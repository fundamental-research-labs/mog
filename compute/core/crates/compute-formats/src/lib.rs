#![warn(clippy::all, clippy::pedantic)]
#![warn(missing_docs)]
#![allow(clippy::module_name_repetitions)] // FormatResult in format_result.rs is fine
#![allow(clippy::must_use_candidate)]
// addressed separately
// Cast lints: numeric formatting inherently casts between f64, u64, i64, i32, usize.
// Values are bounds-checked or known-safe at each site (e.g., month 1..=12).
#![allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    clippy::cast_precision_loss,
    clippy::cast_possible_wrap,
    clippy::cast_lossless
)]

//! Excel-compatible number format engine with locale, color, and currency support.
//!
//! This crate parses and applies Excel number format codes to produce formatted
//! strings. It powers `TEXT()`, `DOLLAR()`, `FIXED()`, and cell display formatting
//! with full support for locale-aware separators, date/time formatting, conditional
//! color directives, fractions, scientific notation, and currency patterns.
//!
//! # Quick Start
//!
//! ## Basic number formatting
//!
//! ```
//! use compute_formats::format_number;
//!
//! assert_eq!(format_number(1234.5, "#,##0.00"), "1,234.50");
//! assert_eq!(format_number(0.5, "0%"), "50%");
//! assert_eq!(format_number(1234567.0, "0.00E+00"), "1.23E+06");
//! ```
//!
//! ## Date formatting
//!
//! Date values are Excel serial numbers (days since 1899-12-30). Serial 45000
//! corresponds to 2023-03-15.
//!
//! ```
//! use compute_formats::format_number;
//!
//! assert_eq!(format_number(45000.0, "yyyy-mm-dd"), "2023-03-15");
//! assert_eq!(format_number(45000.0, "mmmm d, yyyy"), "March 15, 2023");
//! ```
//!
//! ## Locale-aware formatting
//!
//! ```
//! use compute_formats::{format_number_with_locale, CultureInfo};
//!
//! let german = CultureInfo {
//!     decimal_separator: ",".into(),
//!     thousands_separator: ".".into(),
//!     ..CultureInfo::default()
//! };
//! assert_eq!(format_number_with_locale(1234.5, "#,##0.00", &german), "1.234,50");
//! ```
//!
//! ## Color extraction with `FormatResult`
//!
//! ```
//! use compute_formats::{format_number_result, FormatResult, FormatColor, CultureInfo};
//!
//! let result = format_number_result(-1234.0, "#,##0;[Red](#,##0)", &CultureInfo::default());
//! assert_eq!(result.text, "(1,234)");
//! assert_eq!(result.color, Some(FormatColor::Red));
//! ```
//!
//! # Format Code Syntax
//!
//! Excel format codes have up to 4 semicolon-separated sections:
//!
//! ```text
//! positive ; negative ; zero ; text
//! ```
//!
//! Section count determines which section applies:
//! - **1 section** -- applies to all numbers
//! - **2 sections** -- first for positive/zero, second for negative
//! - **3 sections** -- positive; negative; zero
//! - **4 sections** -- positive; negative; zero; text
//!
//! Each section can contain digit placeholders (`0`, `#`, `?`), literal text
//! (in quotes or escaped with `\`), color directives (`[Red]`, `[Blue]`),
//! and date/time tokens (`yyyy`, `mm`, `dd`, `h`, `ss`, `AM/PM`).
//!
//! # Modules
//!
//! - [`builder`] -- Build format codes from high-level options (type, decimals, currency)
//! - [`color`] -- Excel color palette and format color types
//! - [`constants`] -- Built-in format codes, presets, and category metadata
//! - [`currency`] -- Culture-aware currency symbol positioning
//! - [`detection`] -- Format type classification and date/time detection
//! - [`format_result`] -- The [`FormatResult`] type returned by formatting functions
//! - [`input`] -- Date input parsing and serial number computation
//! - [`locale`] -- Culture information for locale-aware formatting
//! - [`normalize`] -- Format code normalization and preview generation

mod api;
mod convenience;
mod datetime;
mod fraction;
mod general;
mod number;
mod parser;
mod types;

pub mod builder;
pub mod color;
pub mod constants;
pub mod currency;
pub mod detection;
pub mod format_result;
pub mod input;
pub mod locale;
pub mod normalize;

pub use api::{
    FormatEntry, format_number, format_number_result, format_number_with_locale, format_text,
    format_value, format_values_batch,
};
pub use builder::{FormatOptions, FractionType, NegativeFormat, build_format_code};
pub use color::{EXCEL_COLOR_PALETTE, FormatColor, palette_color};
pub use constants::{
    ACCOUNTING_PRESETS, CURRENCY_PRESETS, CURRENCY_SYMBOLS, CurrencySymbolDef, DATE_PRESETS,
    EXCEL_BUILTIN_FORMATS, FORMAT_CATEGORIES, FRACTION_PRESETS, FormatCategory,
    FormatConstantsData, FormatPreset, FormatType, GENERAL_PRESETS, NEGATIVE_FORMATS,
    NUMBER_PRESETS, NegativeFormatOption, PERCENTAGE_PRESETS, SCIENTIFIC_PRESETS, SPECIAL_PRESETS,
    TEXT_PRESETS, TIME_PRESETS, builtin_format, default_format, get_format_data, presets_for_type,
};
pub use convenience::{format_dollar, format_fixed};
pub use currency::{
    apply_currency_pattern, apply_negative_currency_pattern, apply_positive_currency_pattern,
};
pub use detection::{
    detect_format_type, has_date_tokens, has_time_tokens, is_date_format, is_likely_date_serial,
    is_time_only_format, should_format_as_date,
};
pub use format_result::FormatResult;
pub use input::{
    DateValueResult, ParsedDateInput, parse_date_input, parse_date_input_with_default_year,
    prepare_date_value, prepare_time_value,
};
pub use locale::{CultureInfo, get_all_cultures, get_culture};
pub use normalize::{get_format_preview, normalize_format_code};
