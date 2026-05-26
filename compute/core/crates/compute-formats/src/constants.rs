//! Excel built-in format codes, format presets, and currency symbol definitions.
//!
//! This module is the **single source of truth** for all format constants.
//! TypeScript constants are generated from this file via:
//!   cargo test -p bridge-ts --test `generate_format_constants` -- generate --nocapture

use std::collections::BTreeMap;

/// Excel built-in format IDs (numFmtId 0-49).
/// Maps the numeric format ID used in XLSX files to the format code string.
pub static EXCEL_BUILTIN_FORMATS: &[(u32, &str)] = &[
    (0, "General"),
    (1, "0"),
    (2, "0.00"),
    (3, "#,##0"),
    (4, "#,##0.00"),
    (9, "0%"),
    (10, "0.00%"),
    (11, "0.00E+00"),
    (12, "# ?/?"),
    (13, "# ??/??"),
    (14, "m/d/yy"),
    (15, "d-mmm-yy"),
    (16, "d-mmm"),
    (17, "mmm-yy"),
    (18, "h:mm AM/PM"),
    (19, "h:mm:ss AM/PM"),
    (20, "h:mm"),
    (21, "h:mm:ss"),
    (22, "m/d/yy h:mm"),
    (37, "#,##0 ;(#,##0)"),
    (38, "#,##0 ;[Red](#,##0)"),
    (39, "#,##0.00;(#,##0.00)"),
    (40, "#,##0.00;[Red](#,##0.00)"),
    (45, "mm:ss"),
    (46, "[h]:mm:ss"),
    (47, "mm:ss.0"),
    (48, "##0.0E+0"),
    (49, "@"),
];

/// Look up a built-in format code by its `numFmtId`.
///
/// Returns `None` if the ID is not one of the standard Excel built-in format IDs
/// (0-49, with gaps).
///
/// # Examples
///
/// ```
/// use compute_formats::builtin_format;
///
/// assert_eq!(builtin_format(0), Some("General"));
/// assert_eq!(builtin_format(14), Some("m/d/yy"));
/// assert_eq!(builtin_format(49), Some("@"));
/// assert_eq!(builtin_format(5), None); // not a standard builtin
/// ```
#[must_use]
pub fn builtin_format(id: u32) -> Option<&'static str> {
    EXCEL_BUILTIN_FORMATS
        .iter()
        .find(|(k, _)| *k == id)
        .map(|(_, v)| *v)
}

/// Format type classification (12 types matching Excel's Format Cells dialog).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FormatType {
    /// No specific format (`General`).
    General,
    /// Decimal numbers with optional thousands separator (`#,##0.00`).
    Number,
    /// Currency values with symbol (`$#,##0.00`).
    Currency,
    /// Currency with aligned symbols and parentheses for negatives.
    Accounting,
    /// Date values (`m/d/yyyy`, `yyyy-mm-dd`).
    Date,
    /// Time values (`h:mm AM/PM`, `h:mm:ss`).
    Time,
    /// Percentage values (`0.00%`).
    Percentage,
    /// Fractional values (`# ?/?`, `# ??/??`).
    Fraction,
    /// Scientific notation (`0.00E+00`).
    Scientific,
    /// Treat as text (`@`).
    Text,
    /// Special formats: ZIP, Phone, SSN.
    Special,
    /// Custom user-defined format string.
    Custom,
}

impl std::fmt::Display for FormatType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::General => "General",
            Self::Number => "Number",
            Self::Currency => "Currency",
            Self::Accounting => "Accounting",
            Self::Date => "Date",
            Self::Time => "Time",
            Self::Percentage => "Percentage",
            Self::Fraction => "Fraction",
            Self::Scientific => "Scientific",
            Self::Text => "Text",
            Self::Special => "Special",
            Self::Custom => "Custom",
        })
    }
}

impl FormatType {
    /// All variants in canonical order.
    pub const ALL: [FormatType; 12] = [
        FormatType::General,
        FormatType::Number,
        FormatType::Currency,
        FormatType::Accounting,
        FormatType::Date,
        FormatType::Time,
        FormatType::Percentage,
        FormatType::Fraction,
        FormatType::Scientific,
        FormatType::Text,
        FormatType::Special,
        FormatType::Custom,
    ];

    /// Lowercase string key (matches serde serialization).
    pub fn as_str(self) -> &'static str {
        match self {
            FormatType::General => "general",
            FormatType::Number => "number",
            FormatType::Currency => "currency",
            FormatType::Accounting => "accounting",
            FormatType::Date => "date",
            FormatType::Time => "time",
            FormatType::Percentage => "percentage",
            FormatType::Fraction => "fraction",
            FormatType::Scientific => "scientific",
            FormatType::Text => "text",
            FormatType::Special => "special",
            FormatType::Custom => "custom",
        }
    }
}

/// Metadata for a format category in the Format Cells dialog.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatCategory {
    /// The format type this category represents.
    pub format_type: FormatType,
    /// Display label (e.g., "Number", "Currency").
    pub label: &'static str,
    /// Short description of the category.
    pub description: &'static str,
}

/// All 12 format categories in canonical order.
pub static FORMAT_CATEGORIES: [FormatCategory; 12] = [
    FormatCategory {
        format_type: FormatType::General,
        label: "General",
        description: "No specific format",
    },
    FormatCategory {
        format_type: FormatType::Number,
        label: "Number",
        description: "Decimal numbers with optional thousands separator",
    },
    FormatCategory {
        format_type: FormatType::Currency,
        label: "Currency",
        description: "Currency values with symbol",
    },
    FormatCategory {
        format_type: FormatType::Accounting,
        label: "Accounting",
        description: "Currency with aligned symbols and parentheses for negatives",
    },
    FormatCategory {
        format_type: FormatType::Date,
        label: "Date",
        description: "Date values",
    },
    FormatCategory {
        format_type: FormatType::Time,
        label: "Time",
        description: "Time values",
    },
    FormatCategory {
        format_type: FormatType::Percentage,
        label: "Percentage",
        description: "Percentage values",
    },
    FormatCategory {
        format_type: FormatType::Fraction,
        label: "Fraction",
        description: "Fractional values",
    },
    FormatCategory {
        format_type: FormatType::Scientific,
        label: "Scientific",
        description: "Scientific notation",
    },
    FormatCategory {
        format_type: FormatType::Text,
        label: "Text",
        description: "Treat as text",
    },
    FormatCategory {
        format_type: FormatType::Special,
        label: "Special",
        description: "Special formats (Zip, Phone, SSN)",
    },
    FormatCategory {
        format_type: FormatType::Custom,
        label: "Custom",
        description: "Custom format string",
    },
];

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

/// A format preset with code, example output, and description.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatPreset {
    /// The Excel format code string.
    pub code: &'static str,
    /// Example formatted output for display in the UI.
    pub example: &'static str,
    /// Human-readable description of the format.
    pub description: &'static str,
}

// ---------------------------------------------------------------------------
// Format presets by category
// ---------------------------------------------------------------------------

/// General format presets.
pub static GENERAL_PRESETS: &[(&str, FormatPreset)] = &[(
    "default",
    FormatPreset {
        code: "General",
        example: "1234.5",
        description: "",
    },
)];

/// Number format presets (integer, decimal, thousands separator variants).
pub static NUMBER_PRESETS: &[(&str, FormatPreset)] = &[
    (
        "integer",
        FormatPreset {
            code: "0",
            example: "1235",
            description: "No decimal places",
        },
    ),
    (
        "decimal1",
        FormatPreset {
            code: "0.0",
            example: "1234.5",
            description: "1 decimal place",
        },
    ),
    (
        "decimal2",
        FormatPreset {
            code: "0.00",
            example: "1234.50",
            description: "2 decimal places",
        },
    ),
    (
        "decimal3",
        FormatPreset {
            code: "0.000",
            example: "1234.500",
            description: "3 decimal places",
        },
    ),
    (
        "thousands",
        FormatPreset {
            code: "#,##0",
            example: "1,235",
            description: "Thousands separator, no decimals",
        },
    ),
    (
        "thousandsDecimal1",
        FormatPreset {
            code: "#,##0.0",
            example: "1,234.5",
            description: "Thousands separator, 1 decimal",
        },
    ),
    (
        "thousandsDecimal2",
        FormatPreset {
            code: "#,##0.00",
            example: "1,234.50",
            description: "Thousands separator, 2 decimals",
        },
    ),
    (
        "negativeRed",
        FormatPreset {
            code: "#,##0.00;[Red]-#,##0.00",
            example: "-1,234.50",
            description: "Red negative numbers",
        },
    ),
    (
        "negativeParens",
        FormatPreset {
            code: "#,##0.00;(#,##0.00)",
            example: "(1,234.50)",
            description: "Parentheses for negatives",
        },
    ),
    (
        "negativeParensRed",
        FormatPreset {
            code: "#,##0.00;[Red](#,##0.00)",
            example: "(1,234.50)",
            description: "Red parentheses for negatives",
        },
    ),
];

/// Currency format presets (USD, EUR, GBP, JPY, etc.).
pub static CURRENCY_PRESETS: &[(&str, FormatPreset)] = &[
    (
        "usd",
        FormatPreset {
            code: "$#,##0.00",
            example: "$1,234.50",
            description: "US Dollar",
        },
    ),
    (
        "usdNegMinus",
        FormatPreset {
            code: "$#,##0.00;-$#,##0.00",
            example: "-$1,234.50",
            description: "USD minus",
        },
    ),
    (
        "usdNegParens",
        FormatPreset {
            code: "$#,##0.00;($#,##0.00)",
            example: "($1,234.50)",
            description: "USD parentheses",
        },
    ),
    (
        "usdNegRed",
        FormatPreset {
            code: "$#,##0.00;[Red]-$#,##0.00",
            example: "-$1,234.50",
            description: "USD red minus",
        },
    ),
    (
        "usdNegParensRed",
        FormatPreset {
            code: "$#,##0.00;[Red]($#,##0.00)",
            example: "($1,234.50)",
            description: "USD red parentheses",
        },
    ),
    (
        "eur",
        FormatPreset {
            code: "\u{20ac}#,##0.00",
            example: "\u{20ac}1,234.50",
            description: "Euro",
        },
    ),
    (
        "gbp",
        FormatPreset {
            code: "\u{00a3}#,##0.00",
            example: "\u{00a3}1,234.50",
            description: "British Pound",
        },
    ),
    (
        "jpy",
        FormatPreset {
            code: "\u{00a5}#,##0",
            example: "\u{00a5}1,235",
            description: "Japanese Yen (no decimals)",
        },
    ),
    (
        "cny",
        FormatPreset {
            code: "\u{00a5}#,##0.00",
            example: "\u{00a5}1,234.50",
            description: "Chinese Yuan",
        },
    ),
    (
        "inr",
        FormatPreset {
            code: "\u{20b9}#,##0.00",
            example: "\u{20b9}1,234.50",
            description: "Indian Rupee",
        },
    ),
    (
        "krw",
        FormatPreset {
            code: "\u{20a9}#,##0",
            example: "\u{20a9}1,235",
            description: "Korean Won (no decimals)",
        },
    ),
    (
        "chf",
        FormatPreset {
            code: "CHF #,##0.00",
            example: "CHF 1,234.50",
            description: "Swiss Franc",
        },
    ),
    (
        "cad",
        FormatPreset {
            code: "CA$#,##0.00",
            example: "CA$1,234.50",
            description: "Canadian Dollar",
        },
    ),
    (
        "aud",
        FormatPreset {
            code: "A$#,##0.00",
            example: "A$1,234.50",
            description: "Australian Dollar",
        },
    ),
];

/// Accounting format presets (aligned currency symbols with parentheses).
pub static ACCOUNTING_PRESETS: &[(&str, FormatPreset)] = &[
    (
        "usd",
        FormatPreset {
            code: "_($* #,##0.00_);_($* (#,##0.00);_($* \"-\"??_);_(@_)",
            example: "$ 1,234.50",
            description: "USD Accounting",
        },
    ),
    (
        "eur",
        FormatPreset {
            code: "_(\u{20ac}* #,##0.00_);_(\u{20ac}* (#,##0.00);_(\u{20ac}* \"-\"??_);_(@_)",
            example: "\u{20ac} 1,234.50",
            description: "EUR Accounting",
        },
    ),
    (
        "gbp",
        FormatPreset {
            code: "_(\u{00a3}* #,##0.00_);_(\u{00a3}* (#,##0.00);_(\u{00a3}* \"-\"??_);_(@_)",
            example: "\u{00a3} 1,234.50",
            description: "GBP Accounting",
        },
    ),
];

/// Date format presets (US, ISO, EU, long, medium, short).
pub static DATE_PRESETS: &[(&str, FormatPreset)] = &[
    // US formats (use lowercase Excel-native tokens — parser is case-insensitive)
    (
        "shortUS",
        FormatPreset {
            code: "m/d/yyyy",
            example: "12/13/2025",
            description: "Short date (US)",
        },
    ),
    (
        "mediumUS",
        FormatPreset {
            code: "mmm d, yyyy",
            example: "Dec 13, 2025",
            description: "Medium date (US)",
        },
    ),
    (
        "longUS",
        FormatPreset {
            code: "mmmm d, yyyy",
            example: "December 13, 2025",
            description: "Long date (US)",
        },
    ),
    (
        "fullUS",
        FormatPreset {
            code: "dddd, mmmm d, yyyy",
            example: "Saturday, December 13, 2025",
            description: "Full date (US)",
        },
    ),
    // ISO format
    (
        "iso",
        FormatPreset {
            code: "yyyy-mm-dd",
            example: "2025-12-13",
            description: "ISO 8601",
        },
    ),
    // European formats
    (
        "shortEU",
        FormatPreset {
            code: "d/m/yyyy",
            example: "13/12/2025",
            description: "Short date (EU)",
        },
    ),
    (
        "mediumEU",
        FormatPreset {
            code: "d mmm yyyy",
            example: "13 Dec 2025",
            description: "Medium date (EU)",
        },
    ),
    (
        "longEU",
        FormatPreset {
            code: "d mmmm yyyy",
            example: "13 December 2025",
            description: "Long date (EU)",
        },
    ),
    // Month/Year only
    (
        "monthYear",
        FormatPreset {
            code: "mmmm yyyy",
            example: "December 2025",
            description: "Month and year",
        },
    ),
    (
        "monthYearShort",
        FormatPreset {
            code: "mmm yyyy",
            example: "Dec 2025",
            description: "Short month and year",
        },
    ),
    // Day/Month only
    (
        "dayMonth",
        FormatPreset {
            code: "d mmmm",
            example: "13 December",
            description: "Day and month",
        },
    ),
    (
        "dayMonthShort",
        FormatPreset {
            code: "d mmm",
            example: "13 Dec",
            description: "Short day and month",
        },
    ),
    // Excel serial number formats
    (
        "excelShort",
        FormatPreset {
            code: "m/d/yy",
            example: "12/13/25",
            description: "Excel short date",
        },
    ),
    (
        "excelMedium",
        FormatPreset {
            code: "d-mmm-yy",
            example: "13-Dec-25",
            description: "Excel medium date",
        },
    ),
    (
        "excelLong",
        FormatPreset {
            code: "d-mmm-yyyy",
            example: "13-Dec-2025",
            description: "Excel long date",
        },
    ),
];

/// Time format presets (12-hour, 24-hour, with/without seconds).
pub static TIME_PRESETS: &[(&str, FormatPreset)] = &[
    (
        "short12",
        FormatPreset {
            code: "h:mm AM/PM",
            example: "3:45 PM",
            description: "12-hour short",
        },
    ),
    (
        "long12",
        FormatPreset {
            code: "h:mm:ss AM/PM",
            example: "3:45:30 PM",
            description: "12-hour with seconds",
        },
    ),
    (
        "short24",
        FormatPreset {
            code: "HH:mm",
            example: "15:45",
            description: "24-hour short",
        },
    ),
    (
        "long24",
        FormatPreset {
            code: "HH:mm:ss",
            example: "15:45:30",
            description: "24-hour with seconds",
        },
    ),
    // Date and time combined
    (
        "dateTime12",
        FormatPreset {
            code: "m/d/yyyy h:mm AM/PM",
            example: "12/13/2025 3:45 PM",
            description: "Date and 12-hour time",
        },
    ),
    (
        "dateTime24",
        FormatPreset {
            code: "yyyy-mm-dd HH:mm",
            example: "2025-12-13 15:45",
            description: "ISO date and 24-hour time",
        },
    ),
    // Duration formats (elapsed time)
    (
        "durationHM",
        FormatPreset {
            code: "[h]:mm",
            example: "25:30",
            description: "Hours and minutes (elapsed)",
        },
    ),
    (
        "durationHMS",
        FormatPreset {
            code: "[h]:mm:ss",
            example: "25:30:45",
            description: "Hours, minutes, seconds (elapsed)",
        },
    ),
    (
        "durationMS",
        FormatPreset {
            code: "[mm]:ss",
            example: "1530:45",
            description: "Minutes and seconds (elapsed)",
        },
    ),
];

/// Percentage format presets.
pub static PERCENTAGE_PRESETS: &[(&str, FormatPreset)] = &[
    (
        "integer",
        FormatPreset {
            code: "0%",
            example: "50%",
            description: "No decimal places",
        },
    ),
    (
        "decimal1",
        FormatPreset {
            code: "0.0%",
            example: "50.0%",
            description: "1 decimal place",
        },
    ),
    (
        "decimal2",
        FormatPreset {
            code: "0.00%",
            example: "50.00%",
            description: "2 decimal places",
        },
    ),
    (
        "decimal3",
        FormatPreset {
            code: "0.000%",
            example: "50.000%",
            description: "3 decimal places",
        },
    ),
];

/// Fraction format presets (halves, quarters, up to three digits).
pub static FRACTION_PRESETS: &[(&str, FormatPreset)] = &[
    (
        "halves",
        FormatPreset {
            code: "# ?/2",
            example: "1 1/2",
            description: "Halves (1/2)",
        },
    ),
    (
        "quarters",
        FormatPreset {
            code: "# ?/4",
            example: "1 1/4",
            description: "Quarters (1/4)",
        },
    ),
    (
        "eighths",
        FormatPreset {
            code: "# ?/8",
            example: "1 3/8",
            description: "Eighths (1/8)",
        },
    ),
    (
        "sixteenths",
        FormatPreset {
            code: "# ??/16",
            example: "1 5/16",
            description: "Sixteenths (1/16)",
        },
    ),
    (
        "tenths",
        FormatPreset {
            code: "# ?/10",
            example: "1 3/10",
            description: "Tenths (1/10)",
        },
    ),
    (
        "hundredths",
        FormatPreset {
            code: "# ??/100",
            example: "1 25/100",
            description: "Hundredths (1/100)",
        },
    ),
    (
        "upToOneDigit",
        FormatPreset {
            code: "# ?/?",
            example: "1 2/3",
            description: "Up to one digit (1/4)",
        },
    ),
    (
        "upToTwoDigits",
        FormatPreset {
            code: "# ??/??",
            example: "1 25/67",
            description: "Up to two digits (21/25)",
        },
    ),
    (
        "upToThreeDigits",
        FormatPreset {
            code: "# ???/???",
            example: "1 312/943",
            description: "Up to three digits (312/943)",
        },
    ),
];

/// Scientific notation format presets.
pub static SCIENTIFIC_PRESETS: &[(&str, FormatPreset)] = &[
    (
        "default",
        FormatPreset {
            code: "0.00E+00",
            example: "1.23E+03",
            description: "2 decimal places",
        },
    ),
    (
        "decimal1",
        FormatPreset {
            code: "0.0E+00",
            example: "1.2E+03",
            description: "1 decimal place",
        },
    ),
    (
        "decimal3",
        FormatPreset {
            code: "0.000E+00",
            example: "1.235E+03",
            description: "3 decimal places",
        },
    ),
    (
        "noDecimals",
        FormatPreset {
            code: "0E+00",
            example: "1E+03",
            description: "No decimal places",
        },
    ),
];

/// Text format presets.
pub static TEXT_PRESETS: &[(&str, FormatPreset)] = &[(
    "default",
    FormatPreset {
        code: "@",
        example: "1234",
        description: "Display as entered",
    },
)];

/// Special format presets (ZIP code, phone number, SSN).
pub static SPECIAL_PRESETS: &[(&str, FormatPreset)] = &[
    (
        "zipCode",
        FormatPreset {
            code: "00000",
            example: "01234",
            description: "ZIP Code (5-digit)",
        },
    ),
    (
        "zipPlus4",
        FormatPreset {
            code: "00000-0000",
            example: "01234-5678",
            description: "ZIP+4 Code",
        },
    ),
    (
        "phone",
        FormatPreset {
            code: "(###) ###-####",
            example: "(555) 123-4567",
            description: "Phone Number",
        },
    ),
    (
        "ssn",
        FormatPreset {
            code: "000-00-0000",
            example: "123-45-6789",
            description: "Social Security Number",
        },
    ),
];

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

/// Currency symbol definition (symbol glyph, human name, ISO 4217 code).
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrencySymbolDef {
    /// The currency symbol glyph (e.g., "$", "\u{20AC}").
    pub symbol: &'static str,
    /// Human-readable name (e.g., "US Dollar").
    pub name: &'static str,
    /// ISO 4217 currency code (e.g., "USD").
    pub code: &'static str,
}

/// All supported currency symbols (26 currencies).
pub static CURRENCY_SYMBOLS: [CurrencySymbolDef; 26] = [
    CurrencySymbolDef {
        symbol: "$",
        name: "US Dollar",
        code: "USD",
    },
    CurrencySymbolDef {
        symbol: "\u{20ac}",
        name: "Euro",
        code: "EUR",
    },
    CurrencySymbolDef {
        symbol: "\u{00a3}",
        name: "British Pound",
        code: "GBP",
    },
    CurrencySymbolDef {
        symbol: "\u{00a5}",
        name: "Japanese Yen",
        code: "JPY",
    },
    CurrencySymbolDef {
        symbol: "\u{00a5}",
        name: "Chinese Yuan",
        code: "CNY",
    },
    CurrencySymbolDef {
        symbol: "\u{20b9}",
        name: "Indian Rupee",
        code: "INR",
    },
    CurrencySymbolDef {
        symbol: "\u{20a9}",
        name: "Korean Won",
        code: "KRW",
    },
    CurrencySymbolDef {
        symbol: "CHF",
        name: "Swiss Franc",
        code: "CHF",
    },
    CurrencySymbolDef {
        symbol: "CA$",
        name: "Canadian Dollar",
        code: "CAD",
    },
    CurrencySymbolDef {
        symbol: "A$",
        name: "Australian Dollar",
        code: "AUD",
    },
    CurrencySymbolDef {
        symbol: "R$",
        name: "Brazilian Real",
        code: "BRL",
    },
    CurrencySymbolDef {
        symbol: "\u{20bd}",
        name: "Russian Ruble",
        code: "RUB",
    },
    CurrencySymbolDef {
        symbol: "kr",
        name: "Swedish Krona",
        code: "SEK",
    },
    CurrencySymbolDef {
        symbol: "kr",
        name: "Norwegian Krone",
        code: "NOK",
    },
    CurrencySymbolDef {
        symbol: "kr",
        name: "Danish Krone",
        code: "DKK",
    },
    CurrencySymbolDef {
        symbol: "z\u{0142}",
        name: "Polish Zloty",
        code: "PLN",
    },
    CurrencySymbolDef {
        symbol: "\u{20ba}",
        name: "Turkish Lira",
        code: "TRY",
    },
    CurrencySymbolDef {
        symbol: "\u{0e3f}",
        name: "Thai Baht",
        code: "THB",
    },
    CurrencySymbolDef {
        symbol: "S$",
        name: "Singapore Dollar",
        code: "SGD",
    },
    CurrencySymbolDef {
        symbol: "HK$",
        name: "Hong Kong Dollar",
        code: "HKD",
    },
    CurrencySymbolDef {
        symbol: "NT$",
        name: "Taiwan Dollar",
        code: "TWD",
    },
    CurrencySymbolDef {
        symbol: "\u{20b1}",
        name: "Philippine Peso",
        code: "PHP",
    },
    CurrencySymbolDef {
        symbol: "R",
        name: "South African Rand",
        code: "ZAR",
    },
    CurrencySymbolDef {
        symbol: "Mex$",
        name: "Mexican Peso",
        code: "MXN",
    },
    CurrencySymbolDef {
        symbol: "AED",
        name: "UAE Dirham",
        code: "AED",
    },
    CurrencySymbolDef {
        symbol: "SAR",
        name: "Saudi Riyal",
        code: "SAR",
    },
];

/// Negative number display option for the Format Cells dialog.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NegativeFormatOption {
    /// Unique identifier (e.g., "minus", "parens").
    pub id: &'static str,
    /// Display label showing the visual style (e.g., "-1,234.10").
    pub label: &'static str,
    /// The format code fragment for negative numbers.
    pub format: &'static str,
    /// Optional color name (e.g., "Red") for colored negative formats.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<&'static str>,
}

/// The 4 standard negative number display options.
pub static NEGATIVE_FORMATS: [NegativeFormatOption; 4] = [
    NegativeFormatOption {
        id: "minus",
        label: "-1,234.10",
        format: "-#,##0.00",
        color: None,
    },
    NegativeFormatOption {
        id: "minusRed",
        label: "-1,234.10",
        format: "[Red]-#,##0.00",
        color: Some("red"),
    },
    NegativeFormatOption {
        id: "parentheses",
        label: "(1,234.10)",
        format: "(#,##0.00)",
        color: None,
    },
    NegativeFormatOption {
        id: "parenthesesRed",
        label: "(1,234.10)",
        format: "[Red](#,##0.00)",
        color: Some("red"),
    },
];

// ---------------------------------------------------------------------------
// Aggregate data for codegen
// ---------------------------------------------------------------------------

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

    // -----------------------------------------------------------------------
    // builtin_format
    // -----------------------------------------------------------------------

    #[test]
    fn builtin_format_general() {
        assert_eq!(builtin_format(0), Some("General"));
    }

    #[test]
    fn builtin_format_date() {
        assert_eq!(builtin_format(14), Some("m/d/yy"));
    }

    #[test]
    fn builtin_format_text() {
        assert_eq!(builtin_format(49), Some("@"));
    }

    #[test]
    fn builtin_format_gap_returns_none() {
        // ID 5 is not a standard builtin
        assert_eq!(builtin_format(5), None);
    }

    #[test]
    fn builtin_format_large_id_returns_none() {
        assert_eq!(builtin_format(100), None);
    }

    #[test]
    fn builtin_format_number_formats() {
        assert_eq!(builtin_format(1), Some("0"));
        assert_eq!(builtin_format(2), Some("0.00"));
        assert_eq!(builtin_format(3), Some("#,##0"));
        assert_eq!(builtin_format(4), Some("#,##0.00"));
    }

    #[test]
    fn builtin_format_percent_formats() {
        assert_eq!(builtin_format(9), Some("0%"));
        assert_eq!(builtin_format(10), Some("0.00%"));
    }

    #[test]
    fn builtin_format_scientific() {
        assert_eq!(builtin_format(11), Some("0.00E+00"));
    }

    #[test]
    fn builtin_format_fraction() {
        assert_eq!(builtin_format(12), Some("# ?/?"));
        assert_eq!(builtin_format(13), Some("# ??/??"));
    }

    #[test]
    fn builtin_format_time_formats() {
        assert_eq!(builtin_format(18), Some("h:mm AM/PM"));
        assert_eq!(builtin_format(19), Some("h:mm:ss AM/PM"));
        assert_eq!(builtin_format(20), Some("h:mm"));
        assert_eq!(builtin_format(21), Some("h:mm:ss"));
        assert_eq!(builtin_format(45), Some("mm:ss"));
        assert_eq!(builtin_format(46), Some("[h]:mm:ss"));
        assert_eq!(builtin_format(47), Some("mm:ss.0"));
    }

    #[test]
    fn builtin_format_accounting_formats() {
        assert_eq!(builtin_format(37), Some("#,##0 ;(#,##0)"));
        assert_eq!(builtin_format(38), Some("#,##0 ;[Red](#,##0)"));
        assert_eq!(builtin_format(39), Some("#,##0.00;(#,##0.00)"));
        assert_eq!(builtin_format(40), Some("#,##0.00;[Red](#,##0.00)"));
    }

    // -----------------------------------------------------------------------
    // default_format
    // -----------------------------------------------------------------------

    #[test]
    fn default_format_general() {
        assert_eq!(default_format(FormatType::General), "General");
    }

    #[test]
    fn default_format_currency() {
        assert_eq!(default_format(FormatType::Currency), "$#,##0.00");
    }

    #[test]
    fn default_format_number() {
        assert_eq!(default_format(FormatType::Number), "#,##0.00");
    }

    #[test]
    fn default_format_date() {
        assert_eq!(default_format(FormatType::Date), "m/d/yyyy");
    }

    #[test]
    fn default_format_time() {
        assert_eq!(default_format(FormatType::Time), "h:mm AM/PM");
    }

    #[test]
    fn default_format_percentage() {
        assert_eq!(default_format(FormatType::Percentage), "0.00%");
    }

    #[test]
    fn default_format_text() {
        assert_eq!(default_format(FormatType::Text), "@");
    }

    #[test]
    fn default_format_accounting() {
        assert_eq!(
            default_format(FormatType::Accounting),
            "_($* #,##0.00_);_($* (#,##0.00);_($* \"-\"??_);_(@_)"
        );
    }

    #[test]
    fn default_format_fraction() {
        assert_eq!(default_format(FormatType::Fraction), "# ?/?");
    }

    #[test]
    fn default_format_scientific() {
        assert_eq!(default_format(FormatType::Scientific), "0.00E+00");
    }

    #[test]
    fn default_format_special() {
        assert_eq!(default_format(FormatType::Special), "00000");
    }

    #[test]
    fn default_format_custom() {
        assert_eq!(default_format(FormatType::Custom), "General");
    }

    // -----------------------------------------------------------------------
    // Static array sizes
    // -----------------------------------------------------------------------

    #[test]
    fn currency_symbols_has_26_entries() {
        assert_eq!(CURRENCY_SYMBOLS.len(), 26);
    }

    #[test]
    fn format_categories_has_12_entries() {
        assert_eq!(FORMAT_CATEGORIES.len(), 12);
    }

    #[test]
    fn negative_formats_has_4_entries() {
        assert_eq!(NEGATIVE_FORMATS.len(), 4);
    }

    #[test]
    fn builtin_formats_has_28_entries() {
        assert_eq!(EXCEL_BUILTIN_FORMATS.len(), 28);
    }

    // -----------------------------------------------------------------------
    // Currency symbol spot checks
    // -----------------------------------------------------------------------

    #[test]
    fn currency_usd_is_first() {
        assert_eq!(CURRENCY_SYMBOLS[0].symbol, "$");
        assert_eq!(CURRENCY_SYMBOLS[0].code, "USD");
    }

    #[test]
    fn currency_eur_is_second() {
        assert_eq!(CURRENCY_SYMBOLS[1].symbol, "\u{20ac}");
        assert_eq!(CURRENCY_SYMBOLS[1].code, "EUR");
    }

    #[test]
    fn currency_sar_is_last() {
        assert_eq!(CURRENCY_SYMBOLS[25].code, "SAR");
    }

    // -----------------------------------------------------------------------
    // Format category spot checks
    // -----------------------------------------------------------------------

    #[test]
    fn format_category_general_is_first() {
        assert_eq!(FORMAT_CATEGORIES[0].format_type, FormatType::General);
        assert_eq!(FORMAT_CATEGORIES[0].label, "General");
    }

    #[test]
    fn format_category_custom_is_last() {
        assert_eq!(FORMAT_CATEGORIES[11].format_type, FormatType::Custom);
        assert_eq!(FORMAT_CATEGORIES[11].label, "Custom");
    }

    // -----------------------------------------------------------------------
    // Negative format spot checks
    // -----------------------------------------------------------------------

    #[test]
    fn negative_format_minus_has_no_color() {
        assert!(NEGATIVE_FORMATS[0].color.is_none());
        assert_eq!(NEGATIVE_FORMATS[0].id, "minus");
    }

    #[test]
    fn negative_format_minus_red_has_color() {
        assert_eq!(NEGATIVE_FORMATS[1].color, Some("red"));
        assert_eq!(NEGATIVE_FORMATS[1].id, "minusRed");
    }

    #[test]
    fn negative_format_parentheses_red_has_color() {
        assert_eq!(NEGATIVE_FORMATS[3].color, Some("red"));
        assert_eq!(NEGATIVE_FORMATS[3].id, "parenthesesRed");
    }
}
