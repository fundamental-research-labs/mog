//! Regex-based semantic type detectors.
//!
//! Each detector uses `OnceLock<Regex>` for lazy one-time compilation.
//! Ported from the TypeScript `patterns.ts` module.

use regex::Regex;
use std::sync::OnceLock;

use super::types::SchemaType;

// ---------------------------------------------------------------------------
// Lazy-compiled regex patterns
// ---------------------------------------------------------------------------

fn email_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r"^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$"
        )
        // SAFETY: regex is a compile-time constant
        .unwrap()
    })
}

fn url_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r"(?i)^(?:https?://)?(?:[\da-z.-]+)\.(?:[a-z.]{2,6})(?:[/\w .-]*)*/?(?:\?[^\s]*)?(?:#[^\s]*)?$"
        )
        // SAFETY: regex is a compile-time constant
        .unwrap()
    })
}

fn phone_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r"^(?:\+[1-9]\d{0,2}[-.\s]?)(?:\d{3}|\(\d{3}\))[-.\s]?\d{3}[-.\s]?\d{4}$|^(?:\(\d{3}\))[-.\s]?\d{3}[-.\s]?\d{4}$|^\d{3}[.\s]\d{3}[.\s]\d{4}$|^\+[1-9]\d{7,14}$"
        )
        // SAFETY: regex is a compile-time constant
        .unwrap()
    })
}

fn percentage_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        // SAFETY: regex is a compile-time constant
        Regex::new(r"^-?(?:\d+(?:\.\d+)?%|0?\.\d+)$").unwrap()
    })
}

fn currency_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r"^-?[$\u{20ac}\u{00a3}\u{00a5}\u{20b9}\u{20bd}\u{20a9}]\s?-?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?$|^-?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?\s?[$\u{20ac}\u{00a3}\u{00a5}\u{20b9}\u{20bd}\u{20a9}]$"
        )
        // SAFETY: regex is a compile-time constant
        .unwrap()
    })
}

fn integer_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        // SAFETY: regex is a compile-time constant
        Regex::new(r"^[+-]?\d+$").unwrap()
    })
}

// Date patterns (ISO, US, EU)
fn date_iso_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:?\d{2})?)?$")
            // SAFETY: regex is a compile-time constant
            .unwrap()
    })
}

fn date_us_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"^(?:0?[1-9]|1[0-2])[-/](?:0?[1-9]|[12]\d|3[01])[-/](?:\d{2}|\d{4})$")
            // SAFETY: regex is a compile-time constant
            .unwrap()
    })
}

fn date_eu_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"^(?:0?[1-9]|[12]\d|3[01])[-/.](?:0?[1-9]|1[0-2])[-/.](?:\d{2}|\d{4})$")
            // SAFETY: regex is a compile-time constant
            .unwrap()
    })
}

// Time patterns (24h, 12h, compact)
fn time_24h_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?$")
            // SAFETY: regex is a compile-time constant
            .unwrap()
    })
}

fn time_12h_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r"(?i)^(?:0?[1-9]|1[0-2]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?\s?(?:AM|PM|am|pm|a\.?m\.?|p\.?m\.?)$"
        )
        // SAFETY: regex is a compile-time constant
        .unwrap()
    })
}

fn time_compact_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        // SAFETY: regex is a compile-time constant
        Regex::new(r"^(?:[01]\d|2[0-3])[0-5]\d(?:[0-5]\d)?$").unwrap()
    })
}

fn company_suffix_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r"(?i)\b(?:Inc\.?|Corp\.?|LLC|Ltd\.?|Co\.?|Company|GmbH|AG|SA|PLC|NV|BV|AB|AS|Oy|SpA|SRL|KG|UG|SE)\s*$"
        )
        // SAFETY: regex is a compile-time constant
        .unwrap()
    })
}

fn stock_ticker_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        // SAFETY: regex is a compile-time constant
        Regex::new(r"^(?:[A-Z]{2,5}:)?[A-Z]{1,5}(?:\.[A-Z])?$").unwrap()
    })
}

// ---------------------------------------------------------------------------
// Public detector functions
// ---------------------------------------------------------------------------

/// Returns `true` if `text` looks like an email address.
pub fn is_email(text: &str) -> bool {
    email_regex().is_match(text.trim())
}

/// Returns `true` if `text` looks like a URL.
pub fn is_url(text: &str) -> bool {
    url_regex().is_match(text.trim())
}

/// Returns `true` if `text` looks like a phone number.
pub fn is_phone(text: &str) -> bool {
    phone_regex().is_match(text.trim())
}

/// Returns `true` if `text` looks like a percentage (e.g. "50%" or ".5").
pub fn is_percentage(text: &str) -> bool {
    percentage_regex().is_match(text.trim())
}

/// Returns `true` if `text` looks like a currency value (e.g. "$1,234.56").
pub fn is_currency(text: &str) -> bool {
    currency_regex().is_match(text.trim())
}

/// Returns `true` if `text` is an integer string (e.g. "+123", "-456", "0").
pub fn is_integer_str(text: &str) -> bool {
    integer_regex().is_match(text.trim())
}

/// Returns `true` if `text` matches any date pattern (ISO, US, or EU).
pub fn is_date_string(text: &str) -> bool {
    let t = text.trim();
    date_iso_regex().is_match(t) || date_us_regex().is_match(t) || date_eu_regex().is_match(t)
}

/// Returns `true` if `text` matches any time pattern (24h, 12h, or compact).
pub fn is_time_string(text: &str) -> bool {
    let t = text.trim();
    time_24h_regex().is_match(t) || time_12h_regex().is_match(t) || time_compact_regex().is_match(t)
}

/// Returns `true` if `text` ends with a known company suffix.
pub fn is_company_name(text: &str) -> bool {
    company_suffix_regex().is_match(text.trim())
}

/// Returns `true` if `text` looks like a stock ticker symbol (e.g. "AAPL", "NYSE:AAPL").
pub fn is_stock_ticker(text: &str) -> bool {
    stock_ticker_regex().is_match(text.trim())
}

// ---------------------------------------------------------------------------
// Unified detector
// ---------------------------------------------------------------------------

/// Runs all detectors in specificity order and returns the first matching
/// `SchemaType`. Returns `None` for plain strings (no semantic match).
///
/// Order: email -> url -> date -> time -> phone -> stock -> percentage -> currency
///        -> integer -> company -> (None)
pub fn detect_semantic_type(text: &str) -> Option<SchemaType> {
    let t = text.trim();
    if t.is_empty() {
        return None;
    }

    if is_email(t) {
        return Some(SchemaType::Email);
    }
    if is_url(t) {
        return Some(SchemaType::Url);
    }
    if is_date_string(t) {
        return Some(SchemaType::Date);
    }
    if is_time_string(t) {
        return Some(SchemaType::Time);
    }
    if is_phone(t) {
        return Some(SchemaType::Phone);
    }
    if is_stock_ticker(t) {
        return Some(SchemaType::Stock);
    }
    if is_percentage(t) {
        return Some(SchemaType::Percentage);
    }
    if is_currency(t) {
        return Some(SchemaType::Currency);
    }
    if is_integer_str(t) {
        return Some(SchemaType::Integer);
    }
    if is_company_name(t) {
        return Some(SchemaType::Company);
    }

    None
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // -- Email --
    #[test]
    fn email_valid() {
        assert!(is_email("user@example.com"));
        assert!(is_email("user.name@sub.domain.co.uk"));
    }

    #[test]
    fn email_invalid() {
        assert!(!is_email("not-an-email"));
        assert!(!is_email("user@"));
        assert!(!is_email("@example.com"));
    }

    // -- URL --
    #[test]
    fn url_valid() {
        assert!(is_url("https://example.com"));
        assert!(is_url("http://sub.domain.com/path"));
        assert!(is_url("example.com"));
    }

    #[test]
    fn url_invalid() {
        assert!(!is_url("not a url"));
    }

    // -- Phone --
    #[test]
    fn phone_valid() {
        assert!(is_phone("+1-555-555-5555"));
        assert!(is_phone("(555) 555-5555"));
        assert!(is_phone("555.555.5555"));
        assert!(is_phone("+14155551234"));
    }

    #[test]
    fn phone_invalid() {
        assert!(!is_phone("123"));
        assert!(!is_phone("2024-12-11"));
    }

    // -- Percentage --
    #[test]
    fn percentage_valid() {
        assert!(is_percentage("50%"));
        assert!(is_percentage("12.5%"));
        assert!(is_percentage("-10%"));
        assert!(is_percentage(".5"));
        assert!(is_percentage("0.25"));
    }

    #[test]
    fn percentage_invalid() {
        assert!(!is_percentage("50"));
    }

    // -- Currency --
    #[test]
    fn currency_valid() {
        assert!(is_currency("$100"));
        assert!(is_currency("$1,234.56"));
        assert!(is_currency("\u{20ac}50.00")); // €50.00
        assert!(is_currency("\u{00a3}99.99")); // £99.99
        assert!(is_currency("-$100"));
    }

    #[test]
    fn currency_invalid() {
        assert!(!is_currency("100"));
    }

    // -- Integer --
    #[test]
    fn integer_valid() {
        assert!(is_integer_str("123"));
        assert!(is_integer_str("-456"));
        assert!(is_integer_str("0"));
        assert!(is_integer_str("+789"));
    }

    #[test]
    fn integer_invalid() {
        assert!(!is_integer_str("12.5"));
        assert!(!is_integer_str("abc"));
    }

    // -- Date --
    #[test]
    fn date_valid() {
        assert!(is_date_string("2024-12-11"));
        assert!(is_date_string("2024-12-11T10:30:00"));
        assert!(is_date_string("12/11/2024"));
        assert!(is_date_string("1/5/24"));
        assert!(is_date_string("11.12.2024"));
    }

    #[test]
    fn date_invalid() {
        assert!(!is_date_string("not a date"));
    }

    // -- Time --
    #[test]
    fn time_valid() {
        assert!(is_time_string("14:30"));
        assert!(is_time_string("14:30:45"));
        assert!(is_time_string("2:30 PM"));
        assert!(is_time_string("1430"));
    }

    #[test]
    fn time_invalid() {
        assert!(!is_time_string("not-time"));
    }

    // -- Company --
    #[test]
    fn company_valid() {
        assert!(is_company_name("Apple Inc."));
        assert!(is_company_name("Microsoft Corp"));
        assert!(is_company_name("Acme LLC"));
    }

    #[test]
    fn company_invalid() {
        assert!(!is_company_name("John Smith"));
    }

    // -- Stock ticker --
    #[test]
    fn stock_ticker_valid() {
        assert!(is_stock_ticker("AAPL"));
        assert!(is_stock_ticker("GOOGL"));
        assert!(is_stock_ticker("BRK.A"));
        assert!(is_stock_ticker("NYSE:AAPL"));
    }

    #[test]
    fn stock_ticker_invalid() {
        assert!(!is_stock_ticker("apple"));
        assert!(!is_stock_ticker("TOOLONG"));
    }

    // -- detect_semantic_type --
    #[test]
    fn detect_email() {
        assert_eq!(
            detect_semantic_type("user@example.com"),
            Some(SchemaType::Email)
        );
    }

    #[test]
    fn detect_currency() {
        assert_eq!(detect_semantic_type("$100"), Some(SchemaType::Currency));
    }

    #[test]
    fn detect_percentage() {
        assert_eq!(detect_semantic_type("50%"), Some(SchemaType::Percentage));
    }

    #[test]
    fn detect_date() {
        assert_eq!(detect_semantic_type("2024-12-11"), Some(SchemaType::Date));
    }

    #[test]
    fn detect_time() {
        assert_eq!(detect_semantic_type("14:30"), Some(SchemaType::Time));
    }

    #[test]
    fn detect_stock() {
        assert_eq!(detect_semantic_type("AAPL"), Some(SchemaType::Stock));
    }

    #[test]
    fn detect_plain_string() {
        assert_eq!(detect_semantic_type("hello"), None);
    }

    #[test]
    fn detect_empty() {
        assert_eq!(detect_semantic_type(""), None);
    }
}
