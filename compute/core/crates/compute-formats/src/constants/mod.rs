//! Excel built-in format codes, format presets, and currency symbol definitions.
//!
//! This module is the **single source of truth** for all format constants.
//! TypeScript constants are generated from the data exposed by this module via:
//!   cargo test -p bridge-ts --test `generate_format_constants` -- generate --nocapture

use std::collections::BTreeMap;

mod builtins;
mod categories;
mod currency_symbols;
mod negative_formats;
mod presets;

pub use builtins::{EXCEL_BUILTIN_FORMATS, builtin_format};
pub use categories::{FORMAT_CATEGORIES, FormatCategory, FormatType};
pub use currency_symbols::{CURRENCY_SYMBOLS, CurrencySymbolDef};
pub use negative_formats::{NEGATIVE_FORMATS, NegativeFormatOption};
pub use presets::{
    ACCOUNTING_PRESETS, CURRENCY_PRESETS, DATE_PRESETS, FRACTION_PRESETS, FormatPreset,
    GENERAL_PRESETS, NUMBER_PRESETS, PERCENTAGE_PRESETS, SCIENTIFIC_PRESETS, SPECIAL_PRESETS,
    TEXT_PRESETS, TIME_PRESETS,
};

/// Default format code for each format type.
///
/// # Examples
///
/// ```
/// use compute_formats::{default_format, FormatType};
///
/// assert_eq!(default_format(FormatType::Number), "#,##0.00");
/// assert_eq!(default_format(FormatType::Date), "m/d/yyyy");
/// assert_eq!(default_format(FormatType::Text), "@");
/// ```
#[must_use]
pub fn default_format(format_type: FormatType) -> &'static str {
    match format_type {
        FormatType::Number => "#,##0.00",
        FormatType::Currency => "$#,##0.00",
        FormatType::Accounting => "_($* #,##0.00_);_($* (#,##0.00);_($* \"-\"??_);_(@_)",
        FormatType::Date => "m/d/yyyy",
        FormatType::Time => "h:mm AM/PM",
        FormatType::Percentage => "0.00%",
        FormatType::Fraction => "# ?/?",
        FormatType::Scientific => "0.00E+00",
        FormatType::Text => "@",
        FormatType::Special => "00000",
        FormatType::General | FormatType::Custom => "General",
    }
}

/// Get all presets for a given format type.
///
/// # Examples
///
/// ```
/// use compute_formats::{presets_for_type, FormatType};
///
/// let number_presets = presets_for_type(FormatType::Number);
/// assert!(!number_presets.is_empty());
/// assert_eq!(presets_for_type(FormatType::Custom).len(), 0);
/// ```
#[must_use]
pub fn presets_for_type(format_type: FormatType) -> &'static [(&'static str, FormatPreset)] {
    match format_type {
        FormatType::General => GENERAL_PRESETS,
        FormatType::Number => NUMBER_PRESETS,
        FormatType::Currency => CURRENCY_PRESETS,
        FormatType::Accounting => ACCOUNTING_PRESETS,
        FormatType::Date => DATE_PRESETS,
        FormatType::Time => TIME_PRESETS,
        FormatType::Percentage => PERCENTAGE_PRESETS,
        FormatType::Fraction => FRACTION_PRESETS,
        FormatType::Scientific => SCIENTIFIC_PRESETS,
        FormatType::Text => TEXT_PRESETS,
        FormatType::Special => SPECIAL_PRESETS,
        FormatType::Custom => &[],
    }
}

/// All format constants collected for serialization / codegen.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatConstantsData {
    /// The 12 format categories with labels and descriptions.
    pub format_categories: &'static [FormatCategory],
    /// Presets keyed by format type name.
    pub format_presets: BTreeMap<&'static str, &'static [(&'static str, FormatPreset)]>,
    /// Default format code for each format type.
    pub default_formats: BTreeMap<&'static str, &'static str>,
    /// Supported currency symbols.
    pub currency_symbols: &'static [CurrencySymbolDef],
    /// Negative number display options.
    pub negative_formats: &'static [NegativeFormatOption],
    /// Excel built-in numFmtId to format code mapping.
    pub excel_builtin_formats: &'static [(u32, &'static str)],
}

/// Collect all format constants into a single serializable struct.
///
/// Used by the bridge layer to generate TypeScript constants from Rust data.
///
/// # Examples
///
/// ```
/// use compute_formats::get_format_data;
///
/// let data = get_format_data();
/// assert_eq!(data.format_categories.len(), 12);
/// assert!(!data.currency_symbols.is_empty());
/// ```
#[must_use]
pub fn get_format_data() -> FormatConstantsData {
    let mut format_presets = BTreeMap::new();
    let mut default_formats = BTreeMap::new();

    for ft in &FormatType::ALL {
        format_presets.insert(ft.as_str(), presets_for_type(*ft));
        default_formats.insert(ft.as_str(), default_format(*ft));
    }

    FormatConstantsData {
        format_categories: &FORMAT_CATEGORIES,
        format_presets,
        default_formats,
        currency_symbols: &CURRENCY_SYMBOLS,
        negative_formats: &NEGATIVE_FORMATS,
        excel_builtin_formats: EXCEL_BUILTIN_FORMATS,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_format_covers_every_format_type() {
        assert_eq!(default_format(FormatType::General), "General");
        assert_eq!(default_format(FormatType::Number), "#,##0.00");
        assert_eq!(default_format(FormatType::Currency), "$#,##0.00");
        assert_eq!(
            default_format(FormatType::Accounting),
            "_($* #,##0.00_);_($* (#,##0.00);_($* \"-\"??_);_(@_)"
        );
        assert_eq!(default_format(FormatType::Date), "m/d/yyyy");
        assert_eq!(default_format(FormatType::Time), "h:mm AM/PM");
        assert_eq!(default_format(FormatType::Percentage), "0.00%");
        assert_eq!(default_format(FormatType::Fraction), "# ?/?");
        assert_eq!(default_format(FormatType::Scientific), "0.00E+00");
        assert_eq!(default_format(FormatType::Text), "@");
        assert_eq!(default_format(FormatType::Special), "00000");
        assert_eq!(default_format(FormatType::Custom), "General");
    }

    #[test]
    fn presets_for_type_routes_all_categories() {
        for format_type in FormatType::ALL {
            let presets = presets_for_type(format_type);

            if format_type == FormatType::Custom {
                assert!(presets.is_empty());
            } else {
                assert!(!presets.is_empty());
            }
        }
    }

    #[test]
    fn get_format_data_assembles_all_constant_groups() {
        let data = get_format_data();

        assert_eq!(data.format_categories.len(), 12);
        assert_eq!(data.format_presets.len(), 12);
        assert_eq!(data.default_formats.len(), 12);
        assert_eq!(data.currency_symbols.len(), 26);
        assert_eq!(data.negative_formats.len(), 4);
        assert_eq!(data.excel_builtin_formats.len(), 28);
    }
}
