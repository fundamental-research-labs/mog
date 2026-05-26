//! Text functions: LEN, UPPER, LOWER, TRIM, LEFT, RIGHT, MID, CONCATENATE,
//! TEXT, FIND, SEARCH, SUBSTITUTE, REPLACE, REPT, EXACT, CHAR, CODE,
//! TEXTJOIN, VALUE, PROPER, CLEAN, T, CONCAT, DOLLAR, FIXED, NUMBERVALUE,
//! VALUETOTEXT, UNICHAR, UNICODE, FINDB, LEFTB, LENB, MIDB, REPLACEB,
//! RIGHTB, SEARCHB, ASC, DBCS, JIS, PHONETIC, ARRAYTOTEXT, TEXTAFTER,
//! TEXTBEFORE, TEXTSPLIT, ENCODEURL, BAHTTEXT, JOIN, SPLIT, REGEXEXTRACT,
//! REGEXREPLACE, REGEXMATCH, REGEXTEST, TO_DATE, TO_DOLLARS, TO_PERCENT,
//! TO_PURE_NUMBER, TO_TEXT

mod byte_ops;
mod cjk;
mod conversion;
mod encoding;
mod extraction;
mod joining;
mod manipulation;
mod modern;
mod regex;
mod search;
mod sheets_split;
mod thai_baht;
mod unicode;

use crate::FunctionRegistry;

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

pub fn register(registry: &mut FunctionRegistry) {
    // Extraction: LEN, LEFT, RIGHT, MID
    extraction::register(registry);
    // Manipulation: UPPER, LOWER, PROPER, TRIM, CLEAN, T
    manipulation::register(registry);
    // Search: FIND, SEARCH, SUBSTITUTE, REPLACE
    search::register(registry);
    // Joining: CONCATENATE, CONCAT, TEXTJOIN, REPT, EXACT
    joining::register(registry);
    // Encoding and locale text: ENCODEURL, BAHTTEXT
    encoding::register(registry);
    thai_baht::register(registry);
    // Conversion: TEXT, VALUE, CHAR, CODE, DOLLAR, FIXED, NUMBERVALUE, VALUETOTEXT, ARRAYTOTEXT, TO_*
    conversion::register(registry);
    // Unicode: UNICHAR, UNICODE
    unicode::register(registry);
    // Byte operations (aliases for non-DBCS locales): LEFTB, RIGHTB, MIDB, LENB, FINDB, SEARCHB, REPLACEB
    byte_ops::register(registry);
    // CJK: ASC, DBCS, JIS, PHONETIC
    cjk::register(registry);
    // Modern Text (Excel 365): TEXTBEFORE, TEXTAFTER, TEXTSPLIT
    modern::register(registry);
    // Google Sheets text: SPLIT
    sheets_split::register(registry);
    // Regex Text: REGEXEXTRACT, REGEXREPLACE, REGEXMATCH, REGEXTEST
    regex::register(registry);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::byte_ops::*;
    use super::cjk::*;
    use super::conversion::*;
    use super::extraction::*;
    use super::joining::*;
    use super::manipulation::*;
    use super::modern::*;
    use super::regex::*;
    use super::search::*;
    use super::unicode::*;
    use crate::PureFunction;
    use value_types::{CellControl, CellError, CellValue};

    fn num(n: f64) -> CellValue {
        CellValue::number(n)
    }
    fn text(s: &str) -> CellValue {
        CellValue::Text(s.into())
    }
    fn err(e: CellError) -> CellValue {
        CellValue::Error(e, None)
    }
    fn bool_val(b: bool) -> CellValue {
        CellValue::Boolean(b)
    }
    fn null() -> CellValue {
        CellValue::Null
    }
    fn control(b: bool) -> CellValue {
        CellValue::Control(CellControl::checkbox(b))
    }

    #[test]
    fn test_len() {
        let f = FnLen;
        assert_eq!(f.call(&[text("hello")]), num(5.0));
        assert_eq!(f.call(&[text("")]), num(0.0));
        assert_eq!(f.call(&[num(123.0)]), num(3.0));
    }

    #[test]
    fn test_upper_lower() {
        assert_eq!(FnUpper.call(&[text("hello")]), text("HELLO"));
        assert_eq!(FnLower.call(&[text("HELLO")]), text("hello"));
    }

    #[test]
    fn test_trim() {
        let f = FnTrim;
        assert_eq!(f.call(&[text("  hello  world  ")]), text("hello world"));
    }

    #[test]
    fn test_left() {
        let f = FnLeft;
        assert_eq!(f.call(&[text("hello"), num(3.0)]), text("hel"));
        assert_eq!(f.call(&[text("hello")]), text("h"));
        assert_eq!(f.call(&[text("hello"), num(10.0)]), text("hello"));
    }

    #[test]
    fn test_right() {
        let f = FnRight;
        assert_eq!(f.call(&[text("hello"), num(3.0)]), text("llo"));
        assert_eq!(f.call(&[text("hello")]), text("o"));
    }

    #[test]
    fn test_mid() {
        let f = FnMid;
        assert_eq!(f.call(&[text("hello"), num(2.0), num(3.0)]), text("ell"));
        assert_eq!(
            f.call(&[text("hello"), num(1.0), num(100.0)]),
            text("hello")
        );
        assert_eq!(
            f.call(&[text("hello"), num(0.0), num(3.0)]),
            err(CellError::Value)
        );
    }

    #[test]
    fn test_concatenate() {
        let f = FnConcatenate;
        assert_eq!(
            f.call(&[text("hello"), text(" "), text("world")]),
            text("hello world")
        );
        assert_eq!(
            f.call(&[text("a"), num(1.0), bool_val(true)]),
            text("a1TRUE")
        );
    }

    #[test]
    fn test_find() {
        let f = FnFind;
        assert_eq!(f.call(&[text("ll"), text("hello")]), num(3.0));
        assert_eq!(f.call(&[text("LL"), text("hello")]), err(CellError::Value)); // case-sensitive
        assert_eq!(f.call(&[text("xyz"), text("hello")]), err(CellError::Value));
    }

    #[test]
    fn test_search() {
        let f = FnSearch;
        assert_eq!(f.call(&[text("LL"), text("hello")]), num(3.0)); // case-insensitive
    }

    #[test]
    fn test_substitute() {
        let f = FnSubstitute;
        assert_eq!(
            f.call(&[text("hello world hello"), text("hello"), text("hi")]),
            text("hi world hi")
        );
        assert_eq!(
            f.call(&[
                text("hello world hello"),
                text("hello"),
                text("hi"),
                num(2.0)
            ]),
            text("hello world hi")
        );
    }

    #[test]
    fn test_replace() {
        let f = FnReplace;
        assert_eq!(
            f.call(&[text("hello"), num(2.0), num(3.0), text("a")]),
            text("hao")
        );
    }

    #[test]
    fn test_rept() {
        let f = FnRept;
        assert_eq!(f.call(&[text("ab"), num(3.0)]), text("ababab"));
        assert_eq!(f.call(&[text("a"), num(0.0)]), text(""));
    }

    #[test]
    fn test_exact() {
        let f = FnExact;
        assert_eq!(f.call(&[text("hello"), text("hello")]), bool_val(true));
        assert_eq!(f.call(&[text("hello"), text("Hello")]), bool_val(false)); // case-sensitive
    }

    #[test]
    fn test_char_code() {
        assert_eq!(FnChar.call(&[num(65.0)]), text("A"));
        assert_eq!(FnCode.call(&[text("A")]), num(65.0));
    }

    #[test]
    fn test_textjoin() {
        let f = FnTextJoin;
        assert_eq!(
            f.call(&[text(","), bool_val(true), text("a"), text("b"), text("c")]),
            text("a,b,c")
        );
    }

    #[test]
    fn test_value() {
        let f = FnValue;
        assert_eq!(f.call(&[text("42.5")]), num(42.5));
        assert_eq!(f.call(&[text("hello")]), err(CellError::Value));
        assert_eq!(f.call(&[text("$1,234.56")]), num(1234.56));
    }

    #[test]
    fn test_left_negative_count() {
        let f = FnLeft;
        assert_eq!(f.call(&[text("hello"), num(-1.0)]), err(CellError::Value));
    }

    #[test]
    fn test_error_propagation() {
        let f = FnLen;
        assert_eq!(f.call(&[err(CellError::Div0)]), err(CellError::Div0));
    }

    // -------------------------------------------------------------------
    // Tests for new functions
    // -------------------------------------------------------------------

    #[test]
    fn test_proper() {
        let f = FnProper;
        assert_eq!(f.call(&[text("hello world")]), text("Hello World"));
        assert_eq!(f.call(&[text("HELLO WORLD")]), text("Hello World"));
        assert_eq!(f.call(&[text("hello-world")]), text("Hello-World"));
        assert_eq!(f.call(&[text("can't stop")]), text("Can'T Stop"));
        assert_eq!(f.call(&[text("")]), text(""));
        assert_eq!(f.call(&[num(123.0)]), text("123"));
    }

    #[test]
    fn test_clean() {
        let f = FnClean;
        // Remove control characters (ASCII 0-31)
        assert_eq!(f.call(&[text("hello\x00world")]), text("helloworld"));
        assert_eq!(f.call(&[text("abc\x01\x02def")]), text("abcdef"));
        assert_eq!(f.call(&[text("hello")]), text("hello"));
    }

    #[test]
    fn test_t() {
        let f = FnT;
        assert_eq!(f.call(&[text("hello")]), text("hello"));
        assert_eq!(f.call(&[num(42.0)]), text(""));
        assert_eq!(f.call(&[bool_val(true)]), text(""));
        assert_eq!(f.call(&[null()]), text(""));
    }

    #[test]
    fn test_t_error_propagation() {
        let f = FnT;
        assert_eq!(f.call(&[err(CellError::Na)]), err(CellError::Na));
    }

    #[test]
    fn test_concat() {
        let f = FnConcat;
        assert_eq!(
            f.call(&[text("hello"), text(" "), text("world")]),
            text("hello world")
        );
        // CONCAT supports arrays
        let arr = CellValue::from_rows(vec![vec![text("a"), text("b"), text("c")]]);
        assert_eq!(f.call(&[arr]), text("abc"));
    }

    #[test]
    fn test_dollar() {
        let f = FnDollar;
        assert_eq!(f.call(&[num(1234.567)]), text("$1,234.57"));
        assert_eq!(f.call(&[num(1234.567), num(1.0)]), text("$1,234.6"));
        assert_eq!(f.call(&[num(0.0)]), text("$0.00"));
    }

    #[test]
    fn test_dollar_negative() {
        let f = FnDollar;
        assert_eq!(f.call(&[num(-1234.56)]), text("($1,234.56)"));
    }

    #[test]
    fn test_fixed() {
        let f = FnFixed;
        assert_eq!(f.call(&[num(1234.567), num(2.0)]), text("1,234.57"));
        assert_eq!(
            f.call(&[num(1234.567), num(2.0), bool_val(true)]),
            text("1234.57")
        );
        assert_eq!(f.call(&[num(1234.0)]), text("1,234.00"));
    }

    #[test]
    fn test_numbervalue() {
        let f = FnNumberValue;
        assert_eq!(f.call(&[text("1,234.56")]), num(1234.56));
        // European format: decimal=comma, group=period
        assert_eq!(
            f.call(&[text("1.234,56"), text(","), text(".")]),
            num(1234.56)
        );
        // Percentage
        assert_eq!(f.call(&[text("50%")]), num(0.5));
        // Empty text -> 0 (Excel behavior)
        assert_eq!(f.call(&[text("")]), num(0.0));
    }

    #[test]
    fn test_valuetotext() {
        let f = FnValueToText;
        assert_eq!(f.call(&[text("hello")]), text("hello"));
        assert_eq!(f.call(&[text("hello"), num(1.0)]), text("\"hello\""));
        assert_eq!(f.call(&[num(42.0)]), text("42"));
        assert_eq!(f.call(&[bool_val(true)]), text("TRUE"));
        assert_eq!(f.call(&[null()]), text(""));
    }

    #[test]
    fn test_sheets_to_format_conversions_direct_scalar_classes() {
        let inputs = [
            num(12.5),
            text("12.5"),
            bool_val(true),
            null(),
            control(true),
            err(CellError::Div0),
        ];
        for function in [
            &FnToDate as &dyn crate::PureFunction,
            &FnToDollars,
            &FnToPercent,
            &FnToPureNumber,
        ] {
            for input in &inputs {
                assert_eq!(
                    function.call(std::slice::from_ref(input)),
                    input.clone(),
                    "{} should return {:?} unchanged",
                    function.name(),
                    input
                );
            }
        }
    }

    #[test]
    fn test_to_text_direct_scalar_classes() {
        let f = FnToText;
        assert_eq!(f.call(&[num(24.0)]), text("24"));
        assert_eq!(f.call(&[num(12.345678901234567)]), text("12.3456789012346"));
        assert_eq!(f.call(&[text("hello")]), text("hello"));
        assert_eq!(f.call(&[bool_val(false)]), bool_val(false));
        assert_eq!(f.call(&[null()]), null());
        assert_eq!(f.call(&[control(true)]), control(true));
        assert_eq!(f.call(&[err(CellError::Na)]), err(CellError::Na));
    }

    #[test]
    fn test_unichar() {
        let f = FnUnichar;
        assert_eq!(f.call(&[num(65.0)]), text("A"));
        assert_eq!(f.call(&[num(8364.0)]), text("\u{20AC}")); // Euro sign
        assert_eq!(f.call(&[num(0.0)]), err(CellError::Value));
        assert_eq!(f.call(&[num(1114112.0)]), err(CellError::Value)); // above max
    }

    #[test]
    fn test_unicode() {
        let f = FnUnicode;
        assert_eq!(f.call(&[text("A")]), num(65.0));
        assert_eq!(f.call(&[text("\u{20AC}")]), num(8364.0)); // Euro sign
        assert_eq!(f.call(&[text("")]), err(CellError::Value));
    }

    #[test]
    fn test_byte_aliases() {
        // LEFTB = LEFT in SBCS
        assert_eq!(FnLeftB.call(&[text("hello"), num(3.0)]), text("hel"));
        // RIGHTB = RIGHT in SBCS
        assert_eq!(FnRightB.call(&[text("hello"), num(3.0)]), text("llo"));
        // MIDB = MID in SBCS
        assert_eq!(
            FnMidB.call(&[text("hello"), num(2.0), num(3.0)]),
            text("ell")
        );
        // LENB = LEN in SBCS
        assert_eq!(FnLenB.call(&[text("hello")]), num(5.0));
        // FINDB = FIND in SBCS
        assert_eq!(FnFindB.call(&[text("ll"), text("hello")]), num(3.0));
        // SEARCHB = SEARCH in SBCS
        assert_eq!(FnSearchB.call(&[text("LL"), text("hello")]), num(3.0));
        // REPLACEB = REPLACE in SBCS
        assert_eq!(
            FnReplaceB.call(&[text("hello"), num(2.0), num(3.0), text("a")]),
            text("hao")
        );
    }

    #[test]
    fn test_asc() {
        let f = FnAsc;
        // Full-width 'A' (U+FF21) -> half-width 'A' (U+0041)
        assert_eq!(f.call(&[text("\u{FF21}")]), text("A"));
        // Full-width space -> half-width space
        assert_eq!(f.call(&[text("\u{3000}")]), text(" "));
        // Already half-width — no change
        assert_eq!(f.call(&[text("ABC")]), text("ABC"));
    }

    #[test]
    fn test_dbcs() {
        let f = FnDbcs;
        // Half-width 'A' (U+0041) -> full-width 'A' (U+FF21)
        assert_eq!(f.call(&[text("A")]), text("\u{FF21}"));
        // Half-width space -> full-width space
        assert_eq!(f.call(&[text(" ")]), text("\u{3000}"));
    }

    #[test]
    fn test_jis_same_as_dbcs() {
        assert_eq!(FnJis.call(&[text("A")]), FnDbcs.call(&[text("A")]));
    }

    #[test]
    fn test_phonetic_passthrough() {
        let f = FnPhonetic;
        assert_eq!(f.call(&[text("hello")]), text("hello"));
        assert_eq!(f.call(&[num(123.0)]), text("123"));
    }

    #[test]
    fn test_arraytotext_concise() {
        let f = FnArrayToText;
        let arr = CellValue::from_rows(vec![vec![num(1.0), num(2.0), num(3.0)]]);
        assert_eq!(f.call(&[arr, num(0.0)]), text("1, 2, 3"));
    }

    #[test]
    fn test_arraytotext_strict() {
        let f = FnArrayToText;
        // Single-row 2D array: {{1,"hello",3}}
        let arr = CellValue::from_rows(vec![vec![num(1.0), text("hello"), num(3.0)]]);
        assert_eq!(f.call(&[arr, num(1.0)]), text("{{1,\"hello\",3}}"));
        // Multi-row 2D array: {{1,2};{3,4}}
        let arr2 = CellValue::from_rows(vec![vec![num(1.0), num(2.0)], vec![num(3.0), num(4.0)]]);
        assert_eq!(f.call(&[arr2, num(1.0)]), text("{{1,2};{3,4}}"));
    }

    #[test]
    fn test_arraytotext_single_value() {
        let f = FnArrayToText;
        assert_eq!(f.call(&[num(42.0)]), text("42"));
        assert_eq!(f.call(&[text("hi"), num(1.0)]), text("\"hi\""));
    }

    #[test]
    fn test_textbefore_basic() {
        let f = FnTextBefore;
        assert_eq!(f.call(&[text("hello-world"), text("-")]), text("hello"));
        assert_eq!(f.call(&[text("hello"), text("-")]), err(CellError::Na));
    }

    #[test]
    fn test_textbefore_instance_num() {
        let f = FnTextBefore;
        // Second instance of "-"
        assert_eq!(f.call(&[text("a-b-c"), text("-"), num(2.0)]), text("a-b"));
        // Negative instance (-1 = last)
        assert_eq!(f.call(&[text("a-b-c"), text("-"), num(-1.0)]), text("a-b"));
    }

    #[test]
    fn test_textbefore_case_insensitive() {
        let f = FnTextBefore;
        // match_mode=1 case-insensitive
        assert_eq!(
            f.call(&[text("helloXworld"), text("x"), num(1.0), num(1.0)]),
            text("hello")
        );
    }

    #[test]
    fn test_textafter_basic() {
        let f = FnTextAfter;
        assert_eq!(f.call(&[text("hello-world"), text("-")]), text("world"));
        assert_eq!(f.call(&[text("hello"), text("-")]), err(CellError::Na));
    }

    #[test]
    fn test_textafter_instance_num() {
        let f = FnTextAfter;
        // Second instance of "-"
        assert_eq!(f.call(&[text("a-b-c"), text("-"), num(2.0)]), text("c"));
    }

    #[test]
    fn test_textafter_if_not_found() {
        let f = FnTextAfter;
        // Custom if_not_found
        assert_eq!(
            f.call(&[
                text("hello"),
                text("-"),
                num(1.0),
                num(0.0),
                num(0.0),
                text("N/A")
            ]),
            text("N/A")
        );
    }

    #[test]
    fn test_textsplit_basic() {
        let f = FnTextSplit;
        let result = f.call(&[text("a,b,c"), text(",")]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 1);
                assert_eq!(arr.cols(), 3);
                assert_eq!(arr.get(0, 0).unwrap(), &text("a"));
                assert_eq!(arr.get(0, 1).unwrap(), &text("b"));
                assert_eq!(arr.get(0, 2).unwrap(), &text("c"));
            }
            _ => panic!("Expected array"),
        }
    }

    #[test]
    fn test_textsplit_row_and_col() {
        let f = FnTextSplit;
        // "a,b;c,d" split by "," cols and ";" rows
        let result = f.call(&[text("a,b;c,d"), text(","), text(";")]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 2);
                assert_eq!(arr.row(0), &[text("a"), text("b")]);
                assert_eq!(arr.row(1), &[text("c"), text("d")]);
            }
            _ => panic!("Expected array"),
        }
    }

    #[test]
    fn test_textsplit_single_value() {
        let f = FnTextSplit;
        // No delimiter found -> single value
        assert_eq!(f.call(&[text("hello"), text(",")]), text("hello"));
    }

    // -------------------------------------------------------------------
    // Regression tests for UTF-8 / Unicode fixes
    // -------------------------------------------------------------------

    #[test]
    fn test_len_unicode_chars() {
        let f = FnLen;
        // "cafe\u{0301}" = "cafe" + combining accent = 5 chars (not 6 bytes)
        // "cafe\u{0301}" has 5 chars but "caf\u{00e9}" is a single precomposed char
        assert_eq!(f.call(&[text("caf\u{00e9}")]), num(4.0)); // "cafe" with precomposed e-accent = 4 chars
        assert_eq!(f.call(&[text("\u{1F600}")]), num(1.0)); // emoji = 1 char (4 bytes)
        assert_eq!(f.call(&[text("\u{00FC}ber")]), num(4.0)); // "uber" with u-umlaut = 4 chars
    }

    #[test]
    fn test_textbefore_unicode_no_panic() {
        let f = FnTextBefore;
        // Multi-byte delimiter and text: should not panic
        assert_eq!(
            f.call(&[text("caf\u{00e9}\u{2615}test"), text("\u{2615}")]),
            text("caf\u{00e9}")
        );
        // Emoji delimiter
        assert_eq!(
            f.call(&[text("hello\u{1F600}world"), text("\u{1F600}")]),
            text("hello")
        );
    }

    #[test]
    fn test_textafter_unicode_no_panic() {
        let f = FnTextAfter;
        // Multi-byte delimiter and text: should not panic
        assert_eq!(
            f.call(&[text("caf\u{00e9}\u{2615}test"), text("\u{2615}")]),
            text("test")
        );
        // Emoji delimiter
        assert_eq!(
            f.call(&[text("hello\u{1F600}world"), text("\u{1F600}")]),
            text("world")
        );
    }

    #[test]
    fn test_textbefore_case_insensitive_unicode() {
        let f = FnTextBefore;
        // Case-insensitive with multi-byte chars (German sharp s -> SS)
        assert_eq!(
            f.call(&[
                text("hello\u{00DC}world"),
                text("\u{00fc}"),
                num(1.0),
                num(1.0)
            ]),
            text("hello")
        );
    }

    #[test]
    fn test_textsplit_unicode_no_panic() {
        let f = FnTextSplit;
        // Split on multi-byte delimiter
        let result = f.call(&[text("a\u{2615}b\u{2615}c"), text("\u{2615}")]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 1);
                assert_eq!(arr.cols(), 3);
                assert_eq!(arr.get(0, 0).unwrap(), &text("a"));
                assert_eq!(arr.get(0, 1).unwrap(), &text("b"));
                assert_eq!(arr.get(0, 2).unwrap(), &text("c"));
            }
            _ => panic!("Expected array"),
        }
    }

    #[test]
    fn test_trim_ascii_space_only() {
        let f = FnTrim;
        // Tab should be preserved (not treated as whitespace)
        assert_eq!(f.call(&[text("hello\tworld")]), text("hello\tworld"));
        // Newline should be preserved
        assert_eq!(f.call(&[text("hello\nworld")]), text("hello\nworld"));
        // Only ASCII spaces are trimmed and collapsed
        assert_eq!(f.call(&[text("  hello   world  ")]), text("hello world"));
        // Non-breaking space (U+00A0) should be preserved
        assert_eq!(
            f.call(&[text("hello\u{00A0}world")]),
            text("hello\u{00A0}world")
        );
    }

    #[test]
    fn test_numbervalue_empty_returns_zero() {
        let f = FnNumberValue;
        assert_eq!(f.call(&[text("")]), num(0.0));
        assert_eq!(f.call(&[text("  ")]), num(0.0)); // whitespace-only also empty after trim
    }

    // -------------------------------------------------------------------
    // TEXTBEFORE/TEXTAFTER overlapping match (non-overlapping per Excel)
    // -------------------------------------------------------------------

    #[test]
    fn test_textbefore_no_overlapping_matches() {
        let f = FnTextBefore;
        // TEXTBEFORE("aaa", "aa", 1) = "" (match at pos 0, text before is empty)
        assert_eq!(f.call(&[text("aaa"), text("aa"), num(1.0)]), text(""));
        // TEXTBEFORE("aaa", "aa", 2) = #VALUE! (only one non-overlapping match)
        // Returns #N/A because instance not found (if_not_found defaults to #N/A)
        assert_eq!(
            f.call(&[text("aaa"), text("aa"), num(2.0)]),
            err(CellError::Na)
        );
    }

    #[test]
    fn test_textafter_no_overlapping_matches() {
        let f = FnTextAfter;
        // TEXTAFTER("aaa", "aa", 1) = "a" (match at pos 0, text after "aa" is "a")
        assert_eq!(f.call(&[text("aaa"), text("aa"), num(1.0)]), text("a"));
    }

    // -------------------------------------------------------------------
    // VALUE: parenthetical negatives and currency symbols
    // -------------------------------------------------------------------

    #[test]
    fn test_value_parenthetical_negative() {
        let f = FnValue;
        assert_eq!(f.call(&[text("(100)")]), num(-100.0));
        assert_eq!(f.call(&[text("($1,234.56)")]), num(-1234.56));
    }

    #[test]
    fn test_value_currency_symbols() {
        let f = FnValue;
        assert_eq!(f.call(&[text("$100")]), num(100.0));
        // Euro symbol
        assert_eq!(f.call(&[text("\u{20AC}100")]), num(100.0));
        // Pound symbol
        assert_eq!(f.call(&[text("\u{00A3}100")]), num(100.0));
        // Yen symbol
        assert_eq!(f.call(&[text("\u{00A5}100")]), num(100.0));
    }

    // -------------------------------------------------------------------
    // TEXT: array-lifting via registry (SUMPRODUCT compatibility)
    // -------------------------------------------------------------------

    #[test]
    fn test_text_array_numbers() {
        let reg = crate::FunctionRegistry::new();
        let arr = CellValue::from_rows(vec![vec![num(1.5), num(2.7), num(3.1)]]);
        let result = reg.call("TEXT", &[arr, text("0.0")]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.get(0, 0).unwrap(), &text("1.5"));
                assert_eq!(arr.get(0, 1).unwrap(), &text("2.7"));
                assert_eq!(arr.get(0, 2).unwrap(), &text("3.1"));
            }
            other => panic!("Expected Array, got {:?}", other),
        }
    }

    #[test]
    fn test_text_array_dates() {
        let reg = crate::FunctionRegistry::new();
        let arr = CellValue::from_rows(vec![vec![num(44562.0)], vec![num(44593.0)]]);
        let result = reg.call("TEXT", &[arr, text("mmm-yy")]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 2);
                assert_eq!(arr.get(0, 0).unwrap(), &text("Jan-22"));
                assert_eq!(arr.get(1, 0).unwrap(), &text("Feb-22"));
            }
            other => panic!("Expected Array, got {:?}", other),
        }
    }

    #[test]
    fn test_text_array_with_errors() {
        let reg = crate::FunctionRegistry::new();
        let arr = CellValue::from_rows(vec![vec![
            num(1.0),
            CellValue::Error(CellError::Div0, None),
            num(3.0),
        ]]);
        let result = reg.call("TEXT", &[arr, text("0")]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.get(0, 0).unwrap(), &text("1"));
                assert_eq!(arr.get(0, 1).unwrap(), &err(CellError::Div0));
                assert_eq!(arr.get(0, 2).unwrap(), &text("3"));
            }
            other => panic!("Expected Array, got {:?}", other),
        }
    }

    #[test]
    fn test_text_array_preserves_2d_shape() {
        let reg = crate::FunctionRegistry::new();
        let arr = CellValue::from_rows(vec![vec![num(1.0), num(2.0)], vec![num(3.0), num(4.0)]]);
        let result = reg.call("TEXT", &[arr, text("0")]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 2);
                assert_eq!(arr.cols(), 2);
                assert_eq!(arr.get(0, 0).unwrap(), &text("1"));
                assert_eq!(arr.get(1, 1).unwrap(), &text("4"));
            }
            other => panic!("Expected Array, got {:?}", other),
        }
    }

    #[test]
    fn test_text_scalar_unchanged() {
        let f = FnText;
        assert_eq!(f.call(&[num(0.5), text("0%")]), text("50%"));
    }

    // --- Bulk text function array tests ---

    #[test]
    fn test_lower_array_preserves_structure() {
        let reg = crate::FunctionRegistry::new();
        let arr = CellValue::from_rows(vec![vec![text("ABC"), text("DEF"), text("GHI")]]);
        let result = reg.call("LOWER", &[arr]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.get(0, 0).unwrap(), &text("abc"));
                assert_eq!(arr.get(0, 1).unwrap(), &text("def"));
                assert_eq!(arr.get(0, 2).unwrap(), &text("ghi"));
            }
            other => panic!("Expected Array, got {:?}", other),
        }
    }

    #[test]
    fn test_upper_array_preserves_structure() {
        let reg = crate::FunctionRegistry::new();
        let arr = CellValue::from_rows(vec![vec![text("abc")], vec![text("def")]]);
        let result = reg.call("UPPER", &[arr]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 2);
                assert_eq!(arr.get(0, 0).unwrap(), &text("ABC"));
                assert_eq!(arr.get(1, 0).unwrap(), &text("DEF"));
            }
            other => panic!("Expected Array, got {:?}", other),
        }
    }

    #[test]
    fn test_trim_array() {
        let reg = crate::FunctionRegistry::new();
        let arr = CellValue::from_rows(vec![vec![text("  hello  "), text(" world ")]]);
        let result = reg.call("TRIM", &[arr]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.get(0, 0).unwrap(), &text("hello"));
                assert_eq!(arr.get(0, 1).unwrap(), &text("world"));
            }
            other => panic!("Expected Array, got {:?}", other),
        }
    }

    #[test]
    fn test_proper_array() {
        let reg = crate::FunctionRegistry::new();
        let arr = CellValue::from_rows(vec![vec![text("hello world"), text("foo bar")]]);
        let result = reg.call("PROPER", &[arr]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.get(0, 0).unwrap(), &text("Hello World"));
                assert_eq!(arr.get(0, 1).unwrap(), &text("Foo Bar"));
            }
            other => panic!("Expected Array, got {:?}", other),
        }
    }

    // ===================================================================
    // Comprehensive first-principles tests for text function submodules
    // ===================================================================

    // -------------------------------------------------------------------
    // byte_ops.rs — DBCS byte-length functions (aliases in SBCS locale)
    // -------------------------------------------------------------------

    #[test]
    fn test_lenb_ascii() {
        // LENB("hello") = 5 in SBCS locale
        assert_eq!(FnLenB.call(&[text("hello")]), num(5.0));
    }

    #[test]
    fn test_lenb_empty() {
        assert_eq!(FnLenB.call(&[text("")]), num(0.0));
    }

    #[test]
    fn test_lenb_number_coercion() {
        // Numbers coerced to string: 123 -> "123" -> len 3
        assert_eq!(FnLenB.call(&[num(123.0)]), num(3.0));
    }

    #[test]
    fn test_lenb_boolean_coercion() {
        assert_eq!(FnLenB.call(&[bool_val(true)]), num(4.0)); // "TRUE"
        assert_eq!(FnLenB.call(&[bool_val(false)]), num(5.0)); // "FALSE"
    }

    #[test]
    fn test_lenb_error_propagation() {
        assert_eq!(FnLenB.call(&[err(CellError::Ref)]), err(CellError::Ref));
    }

    #[test]
    fn test_leftb_default_one_char() {
        // LEFTB with no num_bytes defaults to 1
        assert_eq!(FnLeftB.call(&[text("hello")]), text("h"));
    }

    #[test]
    fn test_leftb_specific_count() {
        assert_eq!(FnLeftB.call(&[text("hello"), num(3.0)]), text("hel"));
    }

    #[test]
    fn test_leftb_exceeds_length() {
        assert_eq!(FnLeftB.call(&[text("hi"), num(10.0)]), text("hi"));
    }

    #[test]
    fn test_leftb_zero() {
        assert_eq!(FnLeftB.call(&[text("hello"), num(0.0)]), text(""));
    }

    #[test]
    fn test_leftb_negative_error() {
        assert_eq!(
            FnLeftB.call(&[text("hello"), num(-1.0)]),
            err(CellError::Value)
        );
    }

    #[test]
    fn test_rightb_default_one_char() {
        assert_eq!(FnRightB.call(&[text("hello")]), text("o"));
    }

    #[test]
    fn test_rightb_specific_count() {
        assert_eq!(FnRightB.call(&[text("hello"), num(3.0)]), text("llo"));
    }

    #[test]
    fn test_rightb_exceeds_length() {
        assert_eq!(FnRightB.call(&[text("hi"), num(10.0)]), text("hi"));
    }

    #[test]
    fn test_rightb_negative_error() {
        assert_eq!(
            FnRightB.call(&[text("hello"), num(-1.0)]),
            err(CellError::Value)
        );
    }

    #[test]
    fn test_midb_basic() {
        // MIDB("hello", 2, 3) = "ell" (1-indexed)
        assert_eq!(
            FnMidB.call(&[text("hello"), num(2.0), num(3.0)]),
            text("ell")
        );
    }

    #[test]
    fn test_midb_start_at_one() {
        assert_eq!(
            FnMidB.call(&[text("hello"), num(1.0), num(5.0)]),
            text("hello")
        );
    }

    #[test]
    fn test_midb_start_zero_error() {
        assert_eq!(
            FnMidB.call(&[text("hello"), num(0.0), num(3.0)]),
            err(CellError::Value)
        );
    }

    #[test]
    fn test_midb_num_chars_exceeds() {
        assert_eq!(
            FnMidB.call(&[text("hello"), num(3.0), num(100.0)]),
            text("llo")
        );
    }

    #[test]
    fn test_findb_basic() {
        // FINDB("b", "abc") = 2 (case-sensitive, 1-indexed)
        assert_eq!(FnFindB.call(&[text("b"), text("abc")]), num(2.0));
    }

    #[test]
    fn test_findb_case_sensitive() {
        // FINDB("B", "abc") = #VALUE! (case-sensitive)
        assert_eq!(
            FnFindB.call(&[text("B"), text("abc")]),
            err(CellError::Value)
        );
    }

    #[test]
    fn test_findb_with_start_pos() {
        // FINDB("l", "hello world", 5) = 5 (start searching from position 5)
        assert_eq!(
            FnFindB.call(&[text("o"), text("hello world"), num(5.0)]),
            num(5.0)
        );
    }

    #[test]
    fn test_findb_start_less_than_one() {
        assert_eq!(
            FnFindB.call(&[text("a"), text("abc"), num(0.0)]),
            err(CellError::Value)
        );
    }

    #[test]
    fn test_searchb_case_insensitive() {
        // SEARCHB("B", "abc") = 2 (case-insensitive)
        assert_eq!(FnSearchB.call(&[text("B"), text("abc")]), num(2.0));
    }

    #[test]
    fn test_searchb_with_start_pos() {
        assert_eq!(
            FnSearchB.call(&[text("o"), text("hello world"), num(6.0)]),
            num(8.0)
        );
    }

    #[test]
    fn test_replaceb_basic() {
        // REPLACEB("abcdef", 3, 2, "XY") = "abXYef"
        assert_eq!(
            FnReplaceB.call(&[text("abcdef"), num(3.0), num(2.0), text("XY")]),
            text("abXYef")
        );
    }

    #[test]
    fn test_replaceb_at_start() {
        assert_eq!(
            FnReplaceB.call(&[text("abcdef"), num(1.0), num(2.0), text("ZZ")]),
            text("ZZcdef")
        );
    }

    #[test]
    fn test_replaceb_error_propagation() {
        assert_eq!(
            FnReplaceB.call(&[err(CellError::Na), num(1.0), num(2.0), text("X")]),
            err(CellError::Na)
        );
    }

    // -------------------------------------------------------------------
    // cjk.rs — ASC, DBCS, JIS, PHONETIC
    // -------------------------------------------------------------------

    #[test]
    fn test_asc_full_range() {
        // Full-width digits -> half-width
        assert_eq!(FnAsc.call(&[text("\u{FF10}\u{FF11}\u{FF19}")]), text("019"));
        // Full-width lowercase -> half-width
        assert_eq!(FnAsc.call(&[text("\u{FF41}")]), text("a"));
        // Full-width punctuation
        assert_eq!(FnAsc.call(&[text("\u{FF01}")]), text("!"));
    }

    #[test]
    fn test_asc_empty_string() {
        assert_eq!(FnAsc.call(&[text("")]), text(""));
    }

    #[test]
    fn test_asc_non_convertible_passthrough() {
        // CJK ideographs should pass through unchanged
        assert_eq!(FnAsc.call(&[text("\u{4E16}")]), text("\u{4E16}")); // "world" kanji
    }

    #[test]
    fn test_asc_mixed_content() {
        // Mix of full-width and half-width
        assert_eq!(
            FnAsc.call(&[text("hello\u{FF21}world")]),
            text("helloAworld")
        );
    }

    #[test]
    fn test_asc_error_propagation() {
        assert_eq!(FnAsc.call(&[err(CellError::Div0)]), err(CellError::Div0));
    }

    #[test]
    fn test_dbcs_full_range() {
        // Half-width digits -> full-width
        assert_eq!(FnDbcs.call(&[text("0")]), text("\u{FF10}"));
        assert_eq!(FnDbcs.call(&[text("9")]), text("\u{FF19}"));
        // Half-width lowercase -> full-width
        assert_eq!(FnDbcs.call(&[text("a")]), text("\u{FF41}"));
        // Punctuation
        assert_eq!(FnDbcs.call(&[text("!")]), text("\u{FF01}"));
    }

    #[test]
    fn test_dbcs_empty_string() {
        assert_eq!(FnDbcs.call(&[text("")]), text(""));
    }

    #[test]
    fn test_dbcs_non_convertible_passthrough() {
        // Characters outside 0x0020-0x007E pass through
        assert_eq!(FnDbcs.call(&[text("\u{4E16}")]), text("\u{4E16}"));
    }

    #[test]
    fn test_dbcs_space_to_fullwidth() {
        // Half-width space (0x20) -> full-width space (0x3000)
        assert_eq!(
            FnDbcs.call(&[text("A B")]),
            text("\u{FF21}\u{3000}\u{FF22}")
        );
    }

    #[test]
    fn test_dbcs_roundtrip_with_asc() {
        // DBCS then ASC should be identity for ASCII
        let original = text("Hello World! 123");
        let full_width = FnDbcs.call(std::slice::from_ref(&original));
        let back = FnAsc.call(&[full_width]);
        assert_eq!(back, original);
    }

    #[test]
    fn test_jis_identical_to_dbcs() {
        // JIS is functionally identical to DBCS
        assert_eq!(FnJis.call(&[text("Hello")]), FnDbcs.call(&[text("Hello")]));
        assert_eq!(FnJis.call(&[text("123")]), FnDbcs.call(&[text("123")]));
        assert_eq!(FnJis.call(&[text(" ")]), FnDbcs.call(&[text(" ")]));
    }

    #[test]
    fn test_phonetic_returns_text_unchanged() {
        assert_eq!(FnPhonetic.call(&[text("Tokyo")]), text("Tokyo"));
        assert_eq!(FnPhonetic.call(&[text("")]), text(""));
    }

    #[test]
    fn test_phonetic_number_coercion() {
        assert_eq!(FnPhonetic.call(&[num(42.0)]), text("42"));
    }

    #[test]
    fn test_phonetic_error_propagation() {
        assert_eq!(
            FnPhonetic.call(&[err(CellError::Value)]),
            err(CellError::Value)
        );
    }

    // -------------------------------------------------------------------
    // modern.rs — TEXTBEFORE, TEXTAFTER, TEXTSPLIT
    // -------------------------------------------------------------------

    #[test]
    fn test_textbefore_simple() {
        assert_eq!(
            FnTextBefore.call(&[text("hello-world"), text("-")]),
            text("hello")
        );
    }

    #[test]
    fn test_textbefore_not_found_default_na() {
        assert_eq!(
            FnTextBefore.call(&[text("hello"), text("x")]),
            err(CellError::Na)
        );
    }

    #[test]
    fn test_textbefore_instance_2() {
        assert_eq!(
            FnTextBefore.call(&[text("a-b-c"), text("-"), num(2.0)]),
            text("a-b")
        );
    }

    #[test]
    fn test_textbefore_negative_instance_from_end() {
        // -1 means last delimiter occurrence
        assert_eq!(
            FnTextBefore.call(&[text("a-b-c"), text("-"), num(-1.0)]),
            text("a-b")
        );
        // -2 means second-to-last
        assert_eq!(
            FnTextBefore.call(&[text("a-b-c"), text("-"), num(-2.0)]),
            text("a")
        );
    }

    #[test]
    fn test_textbefore_negative_instance_too_large() {
        // -3 with only 2 occurrences
        assert_eq!(
            FnTextBefore.call(&[text("a-b-c"), text("-"), num(-3.0)]),
            err(CellError::Na)
        );
    }

    #[test]
    fn test_textbefore_instance_zero_error() {
        assert_eq!(
            FnTextBefore.call(&[text("a-b"), text("-"), num(0.0)]),
            err(CellError::Value)
        );
    }

    #[test]
    fn test_textbefore_case_insensitive_mode() {
        // match_mode=1 for case-insensitive
        assert_eq!(
            FnTextBefore.call(&[text("HelloXworld"), text("x"), num(1.0), num(1.0)]),
            text("Hello")
        );
    }

    #[test]
    fn test_textbefore_case_sensitive_default() {
        // match_mode=0 (default) is case-sensitive
        assert_eq!(
            FnTextBefore.call(&[text("HelloXworld"), text("x"), num(1.0), num(0.0)]),
            err(CellError::Na)
        );
    }

    #[test]
    fn test_textbefore_if_not_found_custom() {
        assert_eq!(
            FnTextBefore.call(&[
                text("hello"),
                text("x"),
                num(1.0),
                num(0.0),
                num(0.0),
                text("NOT FOUND")
            ]),
            text("NOT FOUND")
        );
    }

    #[test]
    fn test_textbefore_empty_delimiter_default() {
        // Empty delimiter with match_end=0 => #VALUE!
        assert_eq!(
            FnTextBefore.call(&[text("hello"), text("")]),
            err(CellError::Value)
        );
    }

    #[test]
    fn test_textbefore_empty_delimiter_match_end() {
        // Empty delimiter with match_end=1 => return full text
        assert_eq!(
            FnTextBefore.call(&[text("hello"), text(""), num(1.0), num(0.0), num(1.0)]),
            text("hello")
        );
    }

    #[test]
    fn test_textbefore_delimiter_at_start() {
        // Delimiter at the very start -> empty string before it
        assert_eq!(FnTextBefore.call(&[text("-hello"), text("-")]), text(""));
    }

    #[test]
    fn test_textafter_simple() {
        assert_eq!(
            FnTextAfter.call(&[text("hello-world"), text("-")]),
            text("world")
        );
    }

    #[test]
    fn test_textafter_not_found_default_na() {
        assert_eq!(
            FnTextAfter.call(&[text("hello"), text("x")]),
            err(CellError::Na)
        );
    }

    #[test]
    fn test_textafter_instance_2() {
        assert_eq!(
            FnTextAfter.call(&[text("a-b-c"), text("-"), num(2.0)]),
            text("c")
        );
    }

    #[test]
    fn test_textafter_negative_instance() {
        // -1 = last delimiter
        assert_eq!(
            FnTextAfter.call(&[text("a-b-c"), text("-"), num(-1.0)]),
            text("c")
        );
        // -2 = second-to-last
        assert_eq!(
            FnTextAfter.call(&[text("a-b-c"), text("-"), num(-2.0)]),
            text("b-c")
        );
    }

    #[test]
    fn test_textafter_instance_zero_error() {
        assert_eq!(
            FnTextAfter.call(&[text("a-b"), text("-"), num(0.0)]),
            err(CellError::Value)
        );
    }

    #[test]
    fn test_textafter_case_insensitive() {
        assert_eq!(
            FnTextAfter.call(&[text("HelloXworld"), text("x"), num(1.0), num(1.0)]),
            text("world")
        );
    }

    #[test]
    fn test_textafter_empty_delimiter_default() {
        // Empty delimiter with match_end=0 => #VALUE!
        assert_eq!(
            FnTextAfter.call(&[text("hello"), text("")]),
            err(CellError::Value)
        );
    }

    #[test]
    fn test_textafter_empty_delimiter_match_end() {
        // Empty delimiter with match_end=1 => empty string
        assert_eq!(
            FnTextAfter.call(&[text("hello"), text(""), num(1.0), num(0.0), num(1.0)]),
            text("")
        );
    }

    #[test]
    fn test_textafter_delimiter_at_end() {
        // Delimiter at the very end -> empty string after it
        assert_eq!(FnTextAfter.call(&[text("hello-"), text("-")]), text(""));
    }

    #[test]
    fn test_textafter_if_not_found_custom() {
        assert_eq!(
            FnTextAfter.call(&[
                text("hello"),
                text("x"),
                num(1.0),
                num(0.0),
                num(0.0),
                text("MISSING")
            ]),
            text("MISSING")
        );
    }

    #[test]
    fn test_textafter_instance_exceeds_count() {
        // Only 1 delimiter but asking for instance 2
        assert_eq!(
            FnTextAfter.call(&[text("a-b"), text("-"), num(2.0)]),
            err(CellError::Na)
        );
    }

    #[test]
    fn test_textsplit_horizontal() {
        let result = FnTextSplit.call(&[text("a,b,c"), text(",")]);
        match &result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 1);
                assert_eq!(arr.cols(), 3);
                assert_eq!(arr.get(0, 0).unwrap(), &text("a"));
                assert_eq!(arr.get(0, 1).unwrap(), &text("b"));
                assert_eq!(arr.get(0, 2).unwrap(), &text("c"));
            }
            _ => panic!("Expected array, got {:?}", result),
        }
    }

    #[test]
    fn test_textsplit_2d_row_and_col() {
        // "a,b;c,d" with col_delim="," row_delim=";"
        let result = FnTextSplit.call(&[text("a,b;c,d"), text(","), text(";")]);
        match &result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 2);
                assert_eq!(arr.cols(), 2);
                assert_eq!(arr.get(0, 0).unwrap(), &text("a"));
                assert_eq!(arr.get(0, 1).unwrap(), &text("b"));
                assert_eq!(arr.get(1, 0).unwrap(), &text("c"));
                assert_eq!(arr.get(1, 1).unwrap(), &text("d"));
            }
            _ => panic!("Expected array, got {:?}", result),
        }
    }

    #[test]
    fn test_textsplit_no_match_single_value() {
        assert_eq!(FnTextSplit.call(&[text("hello"), text(",")]), text("hello"));
    }

    #[test]
    fn test_textsplit_ignore_empty_true() {
        // "a,,b" with ignore_empty=TRUE should produce {"a","b"}
        let result = FnTextSplit.call(&[text("a,,b"), text(","), null(), bool_val(true)]);
        match &result {
            CellValue::Array(arr) => {
                assert_eq!(arr.cols(), 2);
                assert_eq!(arr.get(0, 0).unwrap(), &text("a"));
                assert_eq!(arr.get(0, 1).unwrap(), &text("b"));
            }
            _ => panic!("Expected array, got {:?}", result),
        }
    }

    #[test]
    fn test_textsplit_ignore_empty_false() {
        // "a,,b" with ignore_empty=FALSE should produce {"a","","b"}
        let result = FnTextSplit.call(&[text("a,,b"), text(","), null(), bool_val(false)]);
        match &result {
            CellValue::Array(arr) => {
                assert_eq!(arr.cols(), 3);
                assert_eq!(arr.get(0, 0).unwrap(), &text("a"));
                assert_eq!(arr.get(0, 1).unwrap(), &text(""));
                assert_eq!(arr.get(0, 2).unwrap(), &text("b"));
            }
            _ => panic!("Expected array, got {:?}", result),
        }
    }

    #[test]
    fn test_textsplit_case_insensitive() {
        // match_mode=1 case-insensitive split
        let result =
            FnTextSplit.call(&[text("aXbxC"), text("x"), null(), bool_val(false), num(1.0)]);
        match &result {
            CellValue::Array(arr) => {
                assert_eq!(arr.cols(), 3);
                assert_eq!(arr.get(0, 0).unwrap(), &text("a"));
                assert_eq!(arr.get(0, 1).unwrap(), &text("b"));
                assert_eq!(arr.get(0, 2).unwrap(), &text("C"));
            }
            _ => panic!("Expected array, got {:?}", result),
        }
    }

    #[test]
    fn test_textsplit_uneven_rows_padded() {
        // "a,b;c" => row1=[a,b], row2=[c] -> padded with #N/A
        let result = FnTextSplit.call(&[text("a,b;c"), text(","), text(";")]);
        match &result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 2);
                assert_eq!(arr.cols(), 2);
                assert_eq!(arr.get(0, 0).unwrap(), &text("a"));
                assert_eq!(arr.get(0, 1).unwrap(), &text("b"));
                assert_eq!(arr.get(1, 0).unwrap(), &text("c"));
                assert_eq!(arr.get(1, 1).unwrap(), &err(CellError::Na));
            }
            _ => panic!("Expected array, got {:?}", result),
        }
    }

    #[test]
    fn test_textsplit_only_row_delimiter() {
        // col_delimiter is null, only row_delimiter
        let result = FnTextSplit.call(&[text("a;b;c"), null(), text(";")]);
        match &result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 3);
                assert_eq!(arr.cols(), 1);
                assert_eq!(arr.get(0, 0).unwrap(), &text("a"));
                assert_eq!(arr.get(1, 0).unwrap(), &text("b"));
                assert_eq!(arr.get(2, 0).unwrap(), &text("c"));
            }
            _ => panic!("Expected array, got {:?}", result),
        }
    }

    #[test]
    fn test_textsplit_error_propagation() {
        assert_eq!(
            FnTextSplit.call(&[err(CellError::Ref), text(",")]),
            err(CellError::Ref)
        );
    }

    // -------------------------------------------------------------------
    // conversion.rs — CHAR, CODE, DOLLAR, FIXED, NUMBERVALUE, etc.
    // -------------------------------------------------------------------

    #[test]
    fn test_char_uppercase_a() {
        assert_eq!(FnChar.call(&[num(65.0)]), text("A"));
    }

    #[test]
    fn test_char_lowercase_a() {
        assert_eq!(FnChar.call(&[num(97.0)]), text("a"));
    }

    #[test]
    fn test_char_newline() {
        assert_eq!(FnChar.call(&[num(10.0)]), text("\n"));
    }

    #[test]
    fn test_char_space() {
        assert_eq!(FnChar.call(&[num(32.0)]), text(" "));
    }

    #[test]
    fn test_char_out_of_range_zero() {
        assert_eq!(FnChar.call(&[num(0.0)]), err(CellError::Value));
    }

    #[test]
    fn test_char_out_of_range_256() {
        assert_eq!(FnChar.call(&[num(256.0)]), err(CellError::Value));
    }

    #[test]
    fn test_char_boundary_255() {
        // Code 255 should work (max valid)
        let result = FnChar.call(&[num(255.0)]);
        assert!(matches!(result, CellValue::Text(_)));
    }

    #[test]
    fn test_char_boundary_1() {
        // Code 1 should work (min valid)
        let result = FnChar.call(&[num(1.0)]);
        assert!(matches!(result, CellValue::Text(_)));
    }

    #[test]
    fn test_code_uppercase_a() {
        assert_eq!(FnCode.call(&[text("A")]), num(65.0));
    }

    #[test]
    fn test_code_lowercase_a() {
        assert_eq!(FnCode.call(&[text("a")]), num(97.0));
    }

    #[test]
    fn test_code_takes_first_char() {
        // CODE only looks at the first character
        assert_eq!(FnCode.call(&[text("ABC")]), num(65.0));
    }

    #[test]
    fn test_code_empty_string_error() {
        assert_eq!(FnCode.call(&[text("")]), err(CellError::Value));
    }

    #[test]
    fn test_code_unicode_char() {
        // Euro sign U+20AC = 8364
        assert_eq!(FnCode.call(&[text("\u{20AC}")]), num(8364.0));
    }

    #[test]
    fn test_dollar_default_2_decimals() {
        assert_eq!(FnDollar.call(&[num(1234.567)]), text("$1,234.57"));
    }

    #[test]
    fn test_dollar_1_decimal() {
        assert_eq!(FnDollar.call(&[num(1234.567), num(1.0)]), text("$1,234.6"));
    }

    #[test]
    fn test_dollar_0_decimals() {
        assert_eq!(FnDollar.call(&[num(1234.567), num(0.0)]), text("$1,235"));
    }

    #[test]
    fn test_dollar_negative_value() {
        assert_eq!(FnDollar.call(&[num(-1234.56)]), text("($1,234.56)"));
    }

    #[test]
    fn test_dollar_zero() {
        assert_eq!(FnDollar.call(&[num(0.0)]), text("$0.00"));
    }

    #[test]
    fn test_dollar_error_propagation() {
        assert_eq!(FnDollar.call(&[err(CellError::Div0)]), err(CellError::Div0));
    }

    #[test]
    fn test_fixed_default_2_decimals_with_commas() {
        // FIXED(1234.567) defaults to 2 decimals with commas
        assert_eq!(FnFixed.call(&[num(1234.567)]), text("1,234.57"));
    }

    #[test]
    fn test_fixed_2_decimals_with_commas() {
        assert_eq!(FnFixed.call(&[num(1234.567), num(2.0)]), text("1,234.57"));
    }

    #[test]
    fn test_fixed_2_decimals_no_commas() {
        assert_eq!(
            FnFixed.call(&[num(1234.567), num(2.0), bool_val(true)]),
            text("1234.57")
        );
    }

    #[test]
    fn test_fixed_0_decimals() {
        assert_eq!(FnFixed.call(&[num(1234.567), num(0.0)]), text("1,235"));
    }

    #[test]
    fn test_fixed_negative_value() {
        assert_eq!(FnFixed.call(&[num(-1234.56), num(2.0)]), text("-1,234.56"));
    }

    #[test]
    fn test_fixed_error_propagation() {
        assert_eq!(FnFixed.call(&[err(CellError::Na)]), err(CellError::Na));
    }

    #[test]
    fn test_numbervalue_standard() {
        assert_eq!(FnNumberValue.call(&[text("1,234.56")]), num(1234.56));
    }

    #[test]
    fn test_numbervalue_european_format() {
        assert_eq!(
            FnNumberValue.call(&[text("1.234,56"), text(","), text(".")]),
            num(1234.56)
        );
    }

    #[test]
    fn test_numbervalue_percentage() {
        assert_eq!(FnNumberValue.call(&[text("50%")]), num(0.5));
    }

    #[test]
    fn test_numbervalue_empty_is_zero() {
        assert_eq!(FnNumberValue.call(&[text("")]), num(0.0));
    }

    #[test]
    fn test_numbervalue_whitespace_is_zero() {
        assert_eq!(FnNumberValue.call(&[text("   ")]), num(0.0));
    }

    #[test]
    fn test_numbervalue_invalid_text() {
        assert_eq!(FnNumberValue.call(&[text("abc")]), err(CellError::Value));
    }

    #[test]
    fn test_numbervalue_currency_stripped() {
        assert_eq!(FnNumberValue.call(&[text("$100")]), num(100.0));
        assert_eq!(FnNumberValue.call(&[text("\u{20AC}100")]), num(100.0));
    }

    #[test]
    fn test_valuetotext_number() {
        assert_eq!(FnValueToText.call(&[num(123.0)]), text("123"));
    }

    #[test]
    fn test_valuetotext_boolean() {
        assert_eq!(FnValueToText.call(&[bool_val(true)]), text("TRUE"));
        assert_eq!(FnValueToText.call(&[bool_val(false)]), text("FALSE"));
    }

    #[test]
    fn test_valuetotext_text_concise() {
        assert_eq!(FnValueToText.call(&[text("hello")]), text("hello"));
    }

    #[test]
    fn test_valuetotext_text_strict() {
        assert_eq!(
            FnValueToText.call(&[text("hello"), num(1.0)]),
            text("\"hello\"")
        );
    }

    #[test]
    fn test_valuetotext_null() {
        assert_eq!(FnValueToText.call(&[null()]), text(""));
    }

    #[test]
    fn test_valuetotext_invalid_format() {
        assert_eq!(
            FnValueToText.call(&[text("x"), num(2.0)]),
            err(CellError::Value)
        );
    }

    #[test]
    fn test_arraytotext_concise_multirow() {
        let arr = CellValue::from_rows(vec![vec![num(1.0), num(2.0)], vec![num(3.0), num(4.0)]]);
        assert_eq!(FnArrayToText.call(&[arr, num(0.0)]), text("1, 2; 3, 4"));
    }

    #[test]
    fn test_arraytotext_strict_with_text() {
        let arr = CellValue::from_rows(vec![vec![text("hi"), num(1.0)]]);
        assert_eq!(FnArrayToText.call(&[arr, num(1.0)]), text("{{\"hi\",1}}"));
    }

    #[test]
    fn test_arraytotext_boolean_value() {
        let arr = CellValue::from_rows(vec![vec![bool_val(true), bool_val(false)]]);
        assert_eq!(FnArrayToText.call(&[arr, num(0.0)]), text("TRUE, FALSE"));
    }

    #[test]
    fn test_text_format_number() {
        assert_eq!(FnText.call(&[num(0.5), text("0%")]), text("50%"));
    }

    #[test]
    fn test_text_at_sign_format() {
        assert_eq!(FnText.call(&[num(1234.5), text("@")]), text("1234.5"));
        assert_eq!(FnText.call(&[text("hello"), text("@")]), text("hello"));
        assert_eq!(FnText.call(&[bool_val(true), text("@")]), text("TRUE"));
        assert_eq!(FnText.call(&[null(), text("@")]), text(""));
    }

    #[test]
    fn test_value_numeric_string() {
        assert_eq!(FnValue.call(&[text("42.5")]), num(42.5));
    }

    #[test]
    fn test_value_non_numeric_error() {
        assert_eq!(FnValue.call(&[text("hello")]), err(CellError::Value));
    }

    #[test]
    fn test_value_currency() {
        assert_eq!(FnValue.call(&[text("$1,234.56")]), num(1234.56));
    }

    #[test]
    fn test_value_percentage() {
        assert_eq!(FnValue.call(&[text("50%")]), num(0.5));
    }

    #[test]
    fn test_value_empty_string_error() {
        assert_eq!(FnValue.call(&[text("")]), err(CellError::Value));
    }

    #[test]
    fn test_value_number_passthrough() {
        assert_eq!(FnValue.call(&[num(42.0)]), num(42.0));
    }

    #[test]
    fn test_value_boolean_coercion() {
        assert_eq!(FnValue.call(&[bool_val(true)]), num(1.0));
        assert_eq!(FnValue.call(&[bool_val(false)]), num(0.0));
    }

    #[test]
    fn test_value_parens_negative_number() {
        assert_eq!(FnValue.call(&[text("(100)")]), num(-100.0));
    }

    // -------------------------------------------------------------------
    // joining.rs — CONCATENATE, CONCAT, TEXTJOIN, REPT, EXACT
    // -------------------------------------------------------------------

    #[test]
    fn test_concatenate_basic() {
        assert_eq!(
            FnConcatenate.call(&[text("a"), text("b"), text("c")]),
            text("abc")
        );
    }

    #[test]
    fn test_concatenate_with_numbers() {
        assert_eq!(
            FnConcatenate.call(&[text("val="), num(42.0)]),
            text("val=42")
        );
    }

    #[test]
    fn test_concatenate_single_arg() {
        assert_eq!(FnConcatenate.call(&[text("hello")]), text("hello"));
    }

    #[test]
    fn test_concatenate_error_propagation() {
        assert_eq!(
            FnConcatenate.call(&[text("a"), err(CellError::Div0), text("c")]),
            err(CellError::Div0)
        );
    }

    #[test]
    fn test_concat_basic() {
        assert_eq!(FnConcat.call(&[text("a"), text("b")]), text("ab"));
    }

    #[test]
    fn test_concat_flattens_arrays() {
        let arr = CellValue::from_rows(vec![vec![text("x"), text("y")]]);
        assert_eq!(FnConcat.call(&[text("a"), arr]), text("axy"));
    }

    #[test]
    fn test_textjoin_ignore_empty_true() {
        assert_eq!(
            FnTextJoin.call(&[text(","), bool_val(true), text("a"), text(""), text("b")]),
            text("a,b")
        );
    }

    #[test]
    fn test_textjoin_ignore_empty_false() {
        assert_eq!(
            FnTextJoin.call(&[text(","), bool_val(false), text("a"), text(""), text("b")]),
            text("a,,b")
        );
    }

    #[test]
    fn test_textjoin_empty_delimiter() {
        assert_eq!(
            FnTextJoin.call(&[text(""), bool_val(false), text("a"), text("b"), text("c")]),
            text("abc")
        );
    }

    #[test]
    fn test_textjoin_null_values_with_ignore() {
        assert_eq!(
            FnTextJoin.call(&[text(","), bool_val(true), text("a"), null(), text("b")]),
            text("a,b")
        );
    }

    #[test]
    fn test_textjoin_error_in_delimiter() {
        assert_eq!(
            FnTextJoin.call(&[err(CellError::Na), bool_val(true), text("a")]),
            err(CellError::Na)
        );
    }

    #[test]
    fn test_rept_basic() {
        assert_eq!(FnRept.call(&[text("ab"), num(3.0)]), text("ababab"));
    }

    #[test]
    fn test_rept_zero_times() {
        assert_eq!(FnRept.call(&[text("x"), num(0.0)]), text(""));
    }

    #[test]
    fn test_rept_one_time() {
        assert_eq!(FnRept.call(&[text("hello"), num(1.0)]), text("hello"));
    }

    #[test]
    fn test_rept_negative_error() {
        assert_eq!(FnRept.call(&[text("x"), num(-1.0)]), err(CellError::Value));
    }

    #[test]
    fn test_rept_empty_string() {
        assert_eq!(FnRept.call(&[text(""), num(5.0)]), text(""));
    }

    #[test]
    fn test_exact_identical() {
        assert_eq!(
            FnExact.call(&[text("hello"), text("hello")]),
            bool_val(true)
        );
    }

    #[test]
    fn test_exact_case_sensitive() {
        assert_eq!(
            FnExact.call(&[text("Hello"), text("hello")]),
            bool_val(false)
        );
    }

    #[test]
    fn test_exact_different_strings() {
        assert_eq!(FnExact.call(&[text("abc"), text("xyz")]), bool_val(false));
    }

    #[test]
    fn test_exact_empty_strings() {
        assert_eq!(FnExact.call(&[text(""), text("")]), bool_val(true));
    }

    #[test]
    fn test_exact_number_coercion() {
        // Numbers coerced to string for comparison
        assert_eq!(FnExact.call(&[num(1.0), text("1")]), bool_val(true));
    }

    #[test]
    fn test_exact_error_propagation() {
        assert_eq!(
            FnExact.call(&[err(CellError::Ref), text("a")]),
            err(CellError::Ref)
        );
    }

    // -------------------------------------------------------------------
    // search.rs — FIND, SEARCH, SUBSTITUTE, REPLACE
    // -------------------------------------------------------------------

    #[test]
    fn test_find_basic() {
        // FIND("b", "abc") = 2
        assert_eq!(FnFind.call(&[text("b"), text("abc")]), num(2.0));
    }

    #[test]
    fn test_find_case_sensitive_not_found() {
        // FIND("B", "abc") = #VALUE!
        assert_eq!(
            FnFind.call(&[text("B"), text("abc")]),
            err(CellError::Value)
        );
    }

    #[test]
    fn test_find_at_beginning() {
        assert_eq!(FnFind.call(&[text("a"), text("abc")]), num(1.0));
    }

    #[test]
    fn test_find_at_end() {
        assert_eq!(FnFind.call(&[text("c"), text("abc")]), num(3.0));
    }

    #[test]
    fn test_find_multi_char() {
        assert_eq!(FnFind.call(&[text("bc"), text("abcbc")]), num(2.0));
    }

    #[test]
    fn test_find_empty_find_text() {
        // FIND("", "abc") = 1 (Excel: empty string is found at position 1)
        assert_eq!(FnFind.call(&[text(""), text("abc")]), num(1.0));
    }

    #[test]
    fn test_find_with_start_num() {
        // FIND("b", "abcabc", 3) = 5
        assert_eq!(
            FnFind.call(&[text("b"), text("abcabc"), num(3.0)]),
            num(5.0)
        );
    }

    #[test]
    fn test_find_start_num_less_than_one() {
        assert_eq!(
            FnFind.call(&[text("a"), text("abc"), num(0.0)]),
            err(CellError::Value)
        );
    }

    #[test]
    fn test_find_not_found() {
        assert_eq!(
            FnFind.call(&[text("xyz"), text("hello")]),
            err(CellError::Value)
        );
    }

    #[test]
    fn test_search_case_insensitive() {
        // SEARCH("b", "aBc") = 2
        assert_eq!(FnSearch.call(&[text("b"), text("aBc")]), num(2.0));
    }

    #[test]
    fn test_search_wildcard_star() {
        // SEARCH("*", "abc") = 1
        assert_eq!(FnSearch.call(&[text("*"), text("abc")]), num(1.0));
    }

    #[test]
    fn test_search_wildcard_question_mark() {
        // SEARCH("?b", "abc") = 1 (? matches 'a', then 'b')
        assert_eq!(FnSearch.call(&[text("?b"), text("abc")]), num(1.0));
    }

    #[test]
    fn test_search_wildcard_not_found() {
        assert_eq!(
            FnSearch.call(&[text("?z"), text("abc")]),
            err(CellError::Value)
        );
    }

    #[test]
    fn test_search_with_start_num() {
        assert_eq!(
            FnSearch.call(&[text("o"), text("hello world"), num(6.0)]),
            num(8.0)
        );
    }

    #[test]
    fn test_search_start_num_less_than_one() {
        assert_eq!(
            FnSearch.call(&[text("a"), text("abc"), num(0.0)]),
            err(CellError::Value)
        );
    }

    #[test]
    fn test_substitute_all_occurrences() {
        assert_eq!(
            FnSubstitute.call(&[text("hello world"), text("world"), text("earth")]),
            text("hello earth")
        );
    }

    #[test]
    fn test_substitute_multiple_occurrences() {
        assert_eq!(
            FnSubstitute.call(&[text("aaa"), text("a"), text("b")]),
            text("bbb")
        );
    }

    #[test]
    fn test_substitute_nth_instance() {
        // Replace only 2nd "a" in "aaa"
        assert_eq!(
            FnSubstitute.call(&[text("aaa"), text("a"), text("b"), num(2.0)]),
            text("aba")
        );
    }

    #[test]
    fn test_substitute_1st_instance() {
        assert_eq!(
            FnSubstitute.call(&[text("aaa"), text("a"), text("b"), num(1.0)]),
            text("baa")
        );
    }

    #[test]
    fn test_substitute_3rd_instance() {
        assert_eq!(
            FnSubstitute.call(&[text("aaa"), text("a"), text("b"), num(3.0)]),
            text("aab")
        );
    }

    #[test]
    fn test_substitute_instance_not_found() {
        // Instance 4 doesn't exist in "aaa" (only 3 'a's) - returns original
        assert_eq!(
            FnSubstitute.call(&[text("aaa"), text("a"), text("b"), num(4.0)]),
            text("aaa")
        );
    }

    #[test]
    fn test_substitute_empty_old_text() {
        // Empty old_text -> return original unchanged
        assert_eq!(
            FnSubstitute.call(&[text("hello"), text(""), text("x")]),
            text("hello")
        );
    }

    #[test]
    fn test_substitute_instance_zero_error() {
        assert_eq!(
            FnSubstitute.call(&[text("aaa"), text("a"), text("b"), num(0.0)]),
            err(CellError::Value)
        );
    }

    #[test]
    fn test_substitute_negative_instance_error() {
        assert_eq!(
            FnSubstitute.call(&[text("aaa"), text("a"), text("b"), num(-1.0)]),
            err(CellError::Value)
        );
    }

    #[test]
    fn test_substitute_not_found() {
        assert_eq!(
            FnSubstitute.call(&[text("hello"), text("xyz"), text("abc")]),
            text("hello")
        );
    }

    #[test]
    fn test_replace_basic() {
        // REPLACE("abcdef", 3, 2, "XY") = "abXYef"
        assert_eq!(
            FnReplace.call(&[text("abcdef"), num(3.0), num(2.0), text("XY")]),
            text("abXYef")
        );
    }

    #[test]
    fn test_replace_at_start() {
        assert_eq!(
            FnReplace.call(&[text("abcdef"), num(1.0), num(2.0), text("ZZ")]),
            text("ZZcdef")
        );
    }

    #[test]
    fn test_replace_at_end() {
        assert_eq!(
            FnReplace.call(&[text("abcdef"), num(5.0), num(2.0), text("XY")]),
            text("abcdXY")
        );
    }

    #[test]
    fn test_replace_zero_chars_insert() {
        // num_chars=0 means insert without removing
        assert_eq!(
            FnReplace.call(&[text("abc"), num(2.0), num(0.0), text("X")]),
            text("aXbc")
        );
    }

    #[test]
    fn test_replace_entire_string() {
        assert_eq!(
            FnReplace.call(&[text("abc"), num(1.0), num(3.0), text("XYZ")]),
            text("XYZ")
        );
    }

    #[test]
    fn test_replace_start_less_than_one_error() {
        assert_eq!(
            FnReplace.call(&[text("abc"), num(0.0), num(1.0), text("X")]),
            err(CellError::Value)
        );
    }

    #[test]
    fn test_replace_negative_num_chars_error() {
        assert_eq!(
            FnReplace.call(&[text("abc"), num(1.0), num(-1.0), text("X")]),
            err(CellError::Value)
        );
    }

    #[test]
    fn test_replace_with_longer_replacement() {
        assert_eq!(
            FnReplace.call(&[text("abc"), num(2.0), num(1.0), text("XXXX")]),
            text("aXXXXc")
        );
    }

    #[test]
    fn test_replace_with_empty_replacement() {
        // Delete characters
        assert_eq!(
            FnReplace.call(&[text("abcdef"), num(3.0), num(2.0), text("")]),
            text("abef")
        );
    }

    #[test]
    fn test_replace_error_propagation() {
        assert_eq!(
            FnReplace.call(&[err(CellError::Div0), num(1.0), num(1.0), text("X")]),
            err(CellError::Div0)
        );
    }

    // -------------------------------------------------------------------
    // regex.rs — REGEXEXTRACT, REGEXREPLACE, REGEXMATCH, REGEXTEST
    // -------------------------------------------------------------------

    #[test]
    fn test_regextest_default_and_case_insensitive() {
        assert_eq!(
            FnRegexTest.call(&[text("Alpha-123"), text("[0-9]+")]),
            bool_val(true)
        );
        assert_eq!(
            FnRegexTest.call(&[text("Alpha"), text("alpha")]),
            bool_val(false)
        );
        assert_eq!(
            FnRegexTest.call(&[text("Alpha"), text("alpha"), num(1.0)]),
            bool_val(true)
        );
    }

    #[test]
    fn test_regexmatch_boolean_match_and_no_match() {
        assert_eq!(
            FnRegexMatch.call(&[text("abc123"), text("^[a-z]+[0-9]+$")]),
            bool_val(true)
        );
        assert_eq!(
            FnRegexMatch.call(&[text("abc"), text("[0-9]+")]),
            bool_val(false)
        );
    }

    #[test]
    fn test_regexextract_return_modes() {
        assert_eq!(
            FnRegexExtract.call(&[text("id: A12, id: B345"), text("[A-Z][0-9]+")]),
            text("A12")
        );

        let all = FnRegexExtract.call(&[text("id: A12, id: B345"), text("[A-Z][0-9]+"), num(1.0)]);
        assert_eq!(
            all,
            CellValue::column_array(vec![text("A12"), text("B345")])
        );

        let captures = FnRegexExtract.call(&[
            text("name=alice id=42"),
            text("name=([a-z]+) id=([0-9]+)"),
            num(2.0),
        ]);
        assert_eq!(
            captures,
            CellValue::row_array(vec![text("alice"), text("42")])
        );
    }

    #[test]
    fn test_regexextract_empty_and_unmatched_optional_captures() {
        assert_eq!(
            FnRegexExtract.call(&[text("a="), text("a=(.*)"), num(2.0)]),
            CellValue::row_array(vec![text("")])
        );
        assert_eq!(
            FnRegexExtract.call(&[text("a"), text("(a)(b)?"), num(2.0)]),
            CellValue::row_array(vec![text("a"), text("")])
        );
    }

    #[test]
    fn test_regexextract_no_match_and_mode_errors() {
        assert_eq!(
            FnRegexExtract.call(&[text("abc"), text("[0-9]+")]),
            err(CellError::Na)
        );
        assert_eq!(
            FnRegexExtract.call(&[text("abc"), text("abc"), num(2.0)]),
            err(CellError::Value)
        );
        assert_eq!(
            FnRegexExtract.call(&[text("abc"), text("abc"), num(3.0)]),
            err(CellError::Value)
        );
    }

    #[test]
    fn test_regexreplace_all_positive_negative_and_case_insensitive_occurrence() {
        assert_eq!(
            FnRegexReplace.call(&[text("a1 b22 c333"), text("[0-9]+"), text("x")]),
            text("ax bx cx")
        );
        assert_eq!(
            FnRegexReplace.call(&[text("a1 b22 c333"), text("[0-9]+"), text("x"), num(2.0)]),
            text("a1 bx c333")
        );
        assert_eq!(
            FnRegexReplace.call(&[text("a1 b22 c333"), text("[0-9]+"), text("x"), num(-1.0)]),
            text("a1 b22 cx")
        );
        assert_eq!(
            FnRegexReplace.call(&[
                text("Cat cat CAT"),
                text("cat"),
                text("dog"),
                num(2.0),
                num(1.0)
            ]),
            text("Cat dog CAT")
        );
    }

    #[test]
    fn test_regexreplace_occurrence_validation_and_out_of_range() {
        assert_eq!(
            FnRegexReplace.call(&[text("a1"), text("[0-9]+"), text("x"), num(2.0)]),
            text("a1")
        );
        assert_eq!(
            FnRegexReplace.call(&[text("a1"), text("[0-9]+"), text("x"), num(-2.0)]),
            text("a1")
        );
        assert_eq!(
            FnRegexReplace.call(&[text("a1"), text("[0-9]+"), text("x"), num(1.5)]),
            err(CellError::Value)
        );
        assert_eq!(
            FnRegexReplace.call(&[text("a1"), text("[0-9]+"), text("x"), text("one")]),
            err(CellError::Value)
        );
    }

    #[test]
    fn test_regexreplace_replacement_expansion_contract() {
        assert_eq!(
            FnRegexReplace.call(&[text("ab12"), text("([a-z]+)([0-9]+)"), text("$0")]),
            text("ab12")
        );
        assert_eq!(
            FnRegexReplace.call(&[text("ab12"), text("([a-z]+)([0-9]+)"), text("$2-$1")]),
            text("12-ab")
        );
        assert_eq!(
            FnRegexReplace.call(&[text("ab12"), text("([a-z]+)([0-9]+)"), text("$$$1")]),
            text("$ab")
        );
        assert_eq!(
            FnRegexReplace.call(&[text("ab12"), text("([a-z]+)"), text("$2")]),
            err(CellError::Value)
        );
        assert_eq!(
            FnRegexReplace.call(&[text("ab12"), text("([a-z]+)"), text("$")]),
            err(CellError::Value)
        );
        assert_eq!(
            FnRegexReplace.call(&[text("ab12"), text("([a-z]+)"), text("$x")]),
            err(CellError::Value)
        );
        assert_eq!(
            FnRegexReplace.call(&[text("ab12"), text("(?P<word>[a-z]+)"), text("${word}")]),
            err(CellError::Value)
        );
    }

    #[test]
    fn test_regex_invalid_and_unsupported_patterns() {
        assert_eq!(
            FnRegexMatch.call(&[text("abc"), text("(")]),
            err(CellError::Value)
        );
        assert_eq!(
            FnRegexMatch.call(&[text("abc"), text("(?=a)")]),
            err(CellError::Value)
        );
        assert_eq!(
            FnRegexMatch.call(&[text("abc"), text(r"(a)\1")]),
            err(CellError::Value)
        );
        assert_eq!(
            FnRegexMatch.call(&[text("abc"), text(r"\p{L}+")]),
            err(CellError::Value)
        );
        assert_eq!(
            FnRegexMatch.call(&[text("abc"), text("[[:alpha:]]+")]),
            err(CellError::Value)
        );
    }

    #[test]
    fn test_regex_coerces_numeric_and_boolean_text_inputs() {
        assert_eq!(
            FnRegexMatch.call(&[num(123.0), text("[0-9]+")]),
            bool_val(true)
        );
        assert_eq!(
            FnRegexExtract.call(&[bool_val(true), text("TR..")]),
            text("TRUE")
        );
    }

    #[test]
    fn test_regexextract_native_array_handling() {
        let reg = crate::FunctionRegistry::new();
        let input = CellValue::from_rows(vec![vec![text("a1")], vec![text("b")], vec![text("c3")]]);
        let result = reg.call("REGEXEXTRACT", &[input, text("[0-9]+"), num(0.0)]);
        assert_eq!(
            result,
            CellValue::from_rows(vec![
                vec![text("1")],
                vec![err(CellError::Na)],
                vec![text("3")]
            ])
        );
    }

    #[test]
    fn test_regexextract_rejects_nested_spills_for_array_inputs() {
        let reg = crate::FunctionRegistry::new();
        let input = CellValue::from_rows(vec![vec![text("a1 b2")]]);
        assert_eq!(
            reg.call("REGEXEXTRACT", &[input, text("[a-z][0-9]"), num(1.0)]),
            err(CellError::Value)
        );
    }

    #[test]
    fn test_regex_scalar_functions_registry_array_lift() {
        let reg = crate::FunctionRegistry::new();
        let input = CellValue::from_rows(vec![vec![text("a1")], vec![text("b")]]);
        assert_eq!(
            reg.call("REGEXTEST", &[input, text("[0-9]")]),
            CellValue::from_rows(vec![vec![bool_val(true)], vec![bool_val(false)]])
        );

        let input = CellValue::from_rows(vec![vec![text("a1")], vec![text("b2")]]);
        assert_eq!(
            reg.call("REGEXREPLACE", &[input, text("[0-9]"), text("x")]),
            CellValue::from_rows(vec![vec![text("ax")], vec![text("bx")]])
        );
    }

    // -------------------------------------------------------------------
    // Registry-based tests (using FunctionRegistry::new())
    // -------------------------------------------------------------------

    #[test]
    fn test_registry_lenb() {
        let reg = crate::FunctionRegistry::new();
        assert_eq!(reg.call("LENB", &[text("hello")]), num(5.0));
    }

    #[test]
    fn test_registry_asc() {
        let reg = crate::FunctionRegistry::new();
        assert_eq!(reg.call("ASC", &[text("\u{FF21}")]), text("A"));
    }

    #[test]
    fn test_registry_dbcs() {
        let reg = crate::FunctionRegistry::new();
        assert_eq!(reg.call("DBCS", &[text("A")]), text("\u{FF21}"));
    }

    #[test]
    fn test_registry_jis() {
        let reg = crate::FunctionRegistry::new();
        assert_eq!(reg.call("JIS", &[text("A")]), text("\u{FF21}"));
    }

    #[test]
    fn test_registry_textbefore() {
        let reg = crate::FunctionRegistry::new();
        assert_eq!(
            reg.call("TEXTBEFORE", &[text("hello-world"), text("-")]),
            text("hello")
        );
    }

    #[test]
    fn test_registry_textafter() {
        let reg = crate::FunctionRegistry::new();
        assert_eq!(
            reg.call("TEXTAFTER", &[text("hello-world"), text("-")]),
            text("world")
        );
    }

    #[test]
    fn test_registry_textsplit() {
        let reg = crate::FunctionRegistry::new();
        let result = reg.call("TEXTSPLIT", &[text("a,b,c"), text(",")]);
        match &result {
            CellValue::Array(arr) => {
                assert_eq!(arr.cols(), 3);
            }
            _ => panic!("Expected array"),
        }
    }

    #[test]
    fn test_round_74_registry_metadata() {
        let reg = crate::FunctionRegistry::new();
        for (name, min, max, returns_array) in [
            ("BAHTTEXT", 1, Some(1), false),
            ("ENCODEURL", 1, Some(1), false),
            ("JOIN", 2, None, false),
            ("SPLIT", 2, Some(4), true),
        ] {
            let (_, f) = reg
                .get_by_name(name)
                .unwrap_or_else(|| panic!("{name} registered"));
            assert_eq!(f.min_args(), min, "{name} min arity");
            assert_eq!(f.max_args(), max, "{name} max arity");
            assert_eq!(
                reg.returns_array(name),
                returns_array,
                "{name} returns_array"
            );
        }
    }

    #[test]
    fn test_sheets_to_conversion_registry_lookup_and_call() {
        let reg = crate::FunctionRegistry::new();
        for name in [
            "TO_DATE",
            "TO_DOLLARS",
            "TO_PERCENT",
            "TO_PURE_NUMBER",
            "TO_TEXT",
        ] {
            let (_, f) = reg
                .get_by_name(name)
                .unwrap_or_else(|| panic!("{name} registered"));
            assert_eq!(f.min_args(), 1);
            assert_eq!(f.max_args(), Some(1));
        }

        assert_eq!(reg.call("TO_DATE", &[num(1.25)]), num(1.25));
        assert_eq!(reg.call("TO_DOLLARS", &[num(12.5)]), num(12.5));
        assert_eq!(reg.call("TO_PERCENT", &[num(0.5)]), num(0.5));
        assert_eq!(reg.call("TO_PURE_NUMBER", &[num(50.0)]), num(50.0));
        assert_eq!(reg.call("TO_TEXT", &[num(24.0)]), text("24"));
    }

    #[test]
    fn test_sheets_to_conversion_registry_case_and_prefix_normalization() {
        let reg = crate::FunctionRegistry::new();
        assert_eq!(reg.call("to_date", &[num(1.0)]), num(1.0));
        assert_eq!(reg.call("To_Dollars", &[num(2.0)]), num(2.0));
        assert_eq!(reg.call("_xlfn.TO_PERCENT", &[num(0.25)]), num(0.25));
        assert_eq!(
            reg.call("_xlfn._xlws.TO_PURE_NUMBER", &[num(5.0)]),
            num(5.0)
        );
        assert_eq!(reg.call("_xlfn.TO_TEXT", &[num(24.0)]), text("24"));
    }

    #[test]
    fn test_sheets_to_conversion_registry_array_lift() {
        let reg = crate::FunctionRegistry::new();
        let arr = CellValue::from_rows(vec![
            vec![num(1.0), text("x")],
            vec![bool_val(true), null()],
        ]);

        for name in ["TO_DATE", "TO_DOLLARS", "TO_PERCENT", "TO_PURE_NUMBER"] {
            assert_eq!(reg.call(name, std::slice::from_ref(&arr)), arr);
        }

        assert_eq!(
            reg.call("TO_TEXT", &[arr]),
            CellValue::from_rows(vec![
                vec![text("1"), text("x")],
                vec![bool_val(true), null()]
            ])
        );
    }

    #[test]
    fn test_registry_substitute() {
        let reg = crate::FunctionRegistry::new();
        assert_eq!(
            reg.call("SUBSTITUTE", &[text("hello"), text("ell"), text("ELL")]),
            text("hELLo")
        );
    }

    #[test]
    fn test_registry_replace() {
        let reg = crate::FunctionRegistry::new();
        assert_eq!(
            reg.call("REPLACE", &[text("abcdef"), num(3.0), num(2.0), text("XY")]),
            text("abXYef")
        );
    }
}
