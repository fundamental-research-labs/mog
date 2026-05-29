use super::arrays::{arr7, arr12};

/// Date order for locale-aware date formatting.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum DateOrder {
    /// Month/Day/Year (US)
    MDY,
    /// Day/Month/Year (EU)
    DMY,
    /// Year/Month/Day (ISO)
    YMD,
}

/// Full culture information for locale-aware formatting.
///
/// Matches the TypeScript `CultureInfo` interface 1:1 for bridge-ts compatibility.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct CultureInfo {
    // -- Identification --
    /// IETF culture tag, e.g. "en-US"
    pub name: String,
    /// Display name, e.g. "English (United States)"
    pub display_name: String,
    /// Native display name, e.g. "日本語 (日本)"
    pub native_name: String,
    /// ISO 639-1 two-letter language code, e.g. "en"
    pub two_letter_language_code: String,

    // -- Number --
    /// Decimal separator (default: ".")
    pub decimal_separator: String,
    /// Thousands separator (default: ",")
    pub thousands_separator: String,
    /// Negative sign (default: "-")
    pub negative_sign: String,
    /// Positive sign (default: "+")
    pub positive_sign: String,
    /// Negative number pattern (always 1)
    pub negative_number_pattern: u8,
    /// Number group size (always 3)
    pub number_group_size: u8,

    // -- Percent --
    /// Percent symbol (default: "%")
    pub percent_symbol: String,
    /// Per-mille symbol (default: "‰")
    pub per_mille_symbol: String,
    /// Percent positive pattern
    pub percent_positive_pattern: u8,
    /// Percent negative pattern
    pub percent_negative_pattern: u8,

    // -- Currency --
    /// Currency symbol, e.g. "$", "€", "¥"
    pub currency_symbol: String,
    /// ISO 4217 currency code, e.g. "USD", "EUR"
    pub currency_code: String,
    /// .NET `CurrencyPositivePattern` (0-3)
    pub currency_positive_pattern: u8,
    /// .NET `CurrencyNegativePattern` (0-15)
    pub currency_negative_pattern: u8,
    /// Decimal digits for currency display
    pub currency_decimal_digits: u8,

    // -- Date/Time --
    /// Date separator, e.g. "/", ".", "-"
    pub date_separator: String,
    /// Time separator (always ":")
    pub time_separator: String,
    /// Short date pattern, e.g. "M/d/yyyy"
    pub short_date_pattern: String,
    /// Long date pattern, e.g. "dddd, MMMM d, yyyy"
    pub long_date_pattern: String,
    /// Short time pattern, e.g. "h:mm tt"
    pub short_time_pattern: String,
    /// Long time pattern, e.g. "h:mm:ss tt"
    pub long_time_pattern: String,
    /// AM designator
    pub am_designator: String,
    /// PM designator
    pub pm_designator: String,

    // -- Calendar --
    /// First day of week: 0=Sunday, 1=Monday
    pub first_day_of_week: u8,
    /// Full month names (January..December)
    pub month_names: [String; 12],
    /// Abbreviated month names (Jan..Dec)
    pub abbreviated_month_names: [String; 12],
    /// Full day names (Sunday..Saturday)
    pub day_names: [String; 7],
    /// Abbreviated day names (Sun..Sat)
    pub abbreviated_day_names: [String; 7],
    /// Shortest day names (Su, Mo, ...)
    pub shortest_day_names: [String; 7],

    // -- Boolean/List --
    /// Localized TRUE string
    pub true_string: String,
    /// Localized FALSE string
    pub false_string: String,
    /// List separator ("," or ";")
    pub list_separator: String,
}

impl Default for CultureInfo {
    fn default() -> Self {
        Self {
            name: "en-US".to_string(),
            display_name: "English (United States)".to_string(),
            native_name: "English (United States)".to_string(),
            two_letter_language_code: "en".to_string(),

            decimal_separator: ".".to_string(),
            thousands_separator: ",".to_string(),
            negative_sign: "-".to_string(),
            positive_sign: "+".to_string(),
            negative_number_pattern: 1,
            number_group_size: 3,

            percent_symbol: "%".to_string(),
            per_mille_symbol: "\u{2030}".to_string(),
            percent_positive_pattern: 1,
            percent_negative_pattern: 1,

            currency_symbol: "$".to_string(),
            currency_code: "USD".to_string(),
            currency_positive_pattern: 0,
            currency_negative_pattern: 0,
            currency_decimal_digits: 2,

            date_separator: "/".to_string(),
            time_separator: ":".to_string(),
            short_date_pattern: "M/d/yyyy".to_string(),
            long_date_pattern: "dddd, MMMM d, yyyy".to_string(),
            short_time_pattern: "h:mm tt".to_string(),
            long_time_pattern: "h:mm:ss tt".to_string(),
            am_designator: "AM".to_string(),
            pm_designator: "PM".to_string(),

            first_day_of_week: 0,
            month_names: arr12([
                "January",
                "February",
                "March",
                "April",
                "May",
                "June",
                "July",
                "August",
                "September",
                "October",
                "November",
                "December",
            ]),
            abbreviated_month_names: arr12([
                "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
            ]),
            day_names: arr7(
                "Sunday",
                "Monday",
                "Tuesday",
                "Wednesday",
                "Thursday",
                "Friday",
                "Saturday",
            ),
            abbreviated_day_names: arr7("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"),
            shortest_day_names: arr7("Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"),

            true_string: "TRUE".to_string(),
            false_string: "FALSE".to_string(),
            list_separator: ",".to_string(),
        }
    }
}

impl CultureInfo {
    /// Derive date component ordering from `short_date_pattern`.
    pub fn date_order(&self) -> DateOrder {
        match first_pattern_token(&self.short_date_pattern, &['M', 'd', 'y']) {
            Some('d') => DateOrder::DMY,
            Some('y') => DateOrder::YMD,
            _ => DateOrder::MDY,
        }
    }

    /// Derive 24-hour preference from `short_time_pattern`.
    /// If pattern contains 't' (AM/PM marker), it's 12-hour.
    pub fn use_24_hour(&self) -> bool {
        first_pattern_token(&self.short_time_pattern, &['t']).is_none()
    }
}

fn first_pattern_token(pattern: &str, tokens: &[char]) -> Option<char> {
    let chars: Vec<char> = pattern.chars().collect();
    let mut quote = None;
    let mut index = 0;

    while index < chars.len() {
        let ch = chars[index];

        if let Some(quote_ch) = quote {
            if ch == quote_ch {
                quote = None;
            }
            index += 1;
            continue;
        }

        if ch == '\'' || ch == '"' {
            quote = Some(ch);
            index += 1;
            continue;
        }

        if ch == '\\' {
            index += 2;
            continue;
        }

        if tokens.contains(&ch) {
            let start = index;
            while index < chars.len() && chars[index] == ch {
                index += 1;
            }

            let previous = start.checked_sub(1).map(|prev| chars[prev]);
            let next = chars.get(index).copied();
            if !is_ascii_letter(previous) && !is_ascii_letter(next) {
                return Some(ch);
            }

            continue;
        }

        index += 1;
    }

    None
}

fn is_ascii_letter(ch: Option<char>) -> bool {
    ch.is_some_and(|ch| ch.is_ascii_alphabetic())
}
