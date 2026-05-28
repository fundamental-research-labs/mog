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

#[cfg(test)]
mod test_helpers;

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
mod registry_tests {
    use super::test_helpers::{num, text};
    use value_types::CellValue;

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

#[cfg(test)]
mod source_shape_tests {
    fn implementation_line_count(source: &str) -> usize {
        let source = source.split("#[cfg(test)]").next().unwrap_or(source);
        source
            .lines()
            .map(str::trim)
            .filter(|line| {
                !line.is_empty()
                    && !line.starts_with("//")
                    && !line.starts_with("/*")
                    && !line.starts_with("*")
            })
            .count()
    }

    #[test]
    fn text_mod_stays_registration_root_sized() {
        assert!(
            implementation_line_count(include_str!("mod.rs")) < 180,
            "text/mod.rs should stay below 180 implementation lines excluding tests and comments"
        );
    }

    #[test]
    fn text_implementation_files_stay_split_by_family() {
        for (path, source) in [
            ("byte_ops.rs", include_str!("byte_ops.rs")),
            ("cjk.rs", include_str!("cjk.rs")),
            ("conversion/mod.rs", include_str!("conversion/mod.rs")),
            (
                "conversion/array_text.rs",
                include_str!("conversion/array_text.rs"),
            ),
            (
                "conversion/char_code.rs",
                include_str!("conversion/char_code.rs"),
            ),
            (
                "conversion/number_format.rs",
                include_str!("conversion/number_format.rs"),
            ),
            (
                "conversion/sheets_to.rs",
                include_str!("conversion/sheets_to.rs"),
            ),
            (
                "conversion/text_format.rs",
                include_str!("conversion/text_format.rs"),
            ),
            (
                "conversion/value_parse.rs",
                include_str!("conversion/value_parse.rs"),
            ),
            ("encoding.rs", include_str!("encoding.rs")),
            ("extraction.rs", include_str!("extraction.rs")),
            ("joining.rs", include_str!("joining.rs")),
            ("manipulation.rs", include_str!("manipulation.rs")),
            ("modern/mod.rs", include_str!("modern/mod.rs")),
            ("modern/args.rs", include_str!("modern/args.rs")),
            (
                "modern/before_after.rs",
                include_str!("modern/before_after.rs"),
            ),
            ("modern/delimiter.rs", include_str!("modern/delimiter.rs")),
            ("modern/split.rs", include_str!("modern/split.rs")),
            ("regex.rs", include_str!("regex.rs")),
            ("search.rs", include_str!("search.rs")),
            ("sheets_split.rs", include_str!("sheets_split.rs")),
            ("thai_baht.rs", include_str!("thai_baht.rs")),
            ("unicode.rs", include_str!("unicode.rs")),
        ] {
            assert!(
                implementation_line_count(source) < 800,
                "{path} should stay below 800 implementation lines excluding tests and comments"
            );
        }
    }
}
