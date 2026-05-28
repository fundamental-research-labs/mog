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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn general_preset_keeps_default_code() {
        assert_eq!(GENERAL_PRESETS[0].0, "default");
        assert_eq!(GENERAL_PRESETS[0].1.code, "General");
    }

    #[test]
    fn number_presets_keep_selected_entries() {
        assert_eq!(NUMBER_PRESETS[0].0, "integer");
        assert_eq!(NUMBER_PRESETS[0].1.code, "0");
        assert_eq!(NUMBER_PRESETS[6].0, "thousandsDecimal2");
        assert_eq!(NUMBER_PRESETS[6].1.code, "#,##0.00");
    }

    #[test]
    fn currency_presets_keep_currency_escape_examples() {
        assert_eq!(CURRENCY_PRESETS[0].0, "usd");
        assert_eq!(CURRENCY_PRESETS[0].1.code, "$#,##0.00");
        assert_eq!(CURRENCY_PRESETS[5].0, "eur");
        assert_eq!(CURRENCY_PRESETS[5].1.code, "\u{20ac}#,##0.00");
        assert_eq!(CURRENCY_PRESETS[7].0, "jpy");
        assert_eq!(CURRENCY_PRESETS[7].1.code, "\u{00a5}#,##0");
    }

    #[test]
    fn fraction_presets_keep_fixed_denominators() {
        assert_eq!(FRACTION_PRESETS[0].0, "halves");
        assert_eq!(FRACTION_PRESETS[0].1.code, "# ?/2");
        assert_eq!(FRACTION_PRESETS[3].0, "sixteenths");
        assert_eq!(FRACTION_PRESETS[3].1.code, "# ??/16");
    }

    #[test]
    fn special_presets_keep_expected_order() {
        assert_eq!(
            SPECIAL_PRESETS
                .iter()
                .map(|(key, _)| *key)
                .collect::<Vec<_>>()
                .as_slice(),
            &["zipCode", "zipPlus4", "phone", "ssn"]
        );
    }
}
