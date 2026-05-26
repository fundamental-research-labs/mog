//! Function name interning for common Excel functions.
//!
//! Avoids allocating a new `String` via `to_uppercase()` for every function call
//! by looking up the name in a sorted static table of canonical forms first.

use std::borrow::Cow;

/// Sorted list of canonical (uppercase) Excel function names.
/// Binary search gives O(log n) lookup.
static KNOWN_FUNCTIONS: &[&str] = &[
    "ABS",
    "ADDRESS",
    "AND",
    "AREAS",
    "ARRAYFORMULA",
    "AVERAGE",
    "AVERAGEIF",
    "AVERAGEIFS",
    "BAHTTEXT",
    "BYCOL",
    "BYROW",
    "CEILING",
    "CELL",
    "CHAR",
    "CHOOSE",
    "CHOOSECOLS",
    "CHOOSEROWS",
    "CLEAN",
    "CODE",
    "COLUMN",
    "COLUMNS",
    "CONCAT",
    "CONCATENATE",
    "COUNT",
    "COUNTA",
    "COUNTBLANK",
    "COUNTIF",
    "COUNTIFS",
    "DATE",
    "DAY",
    "DOLLAR",
    "DROP",
    "ENCODEURL",
    "EPOCHTODATE",
    "ERROR.TYPE",
    "EXACT",
    "EXP",
    "EXPAND",
    "FALSE",
    "FILTER",
    "FIND",
    "FIXED",
    "FLOOR",
    "FORMULATEXT",
    "GETPIVOTDATA",
    "HLOOKUP",
    "HOUR",
    "HSTACK",
    "HYPERLINK",
    "IF",
    "IFERROR",
    "IFNA",
    "IFS",
    "INDEX",
    "INDIRECT",
    "INFO",
    "INT",
    "ISBETWEEN",
    "ISBLANK",
    "ISDATE",
    "ISEMAIL",
    "ISERROR",
    "ISFORMULA",
    "ISLOGICAL",
    "ISNA",
    "ISNUMBER",
    "ISOMITTED",
    "ISTEXT",
    "ISURL",
    "JOIN",
    "LAMBDA",
    "LARGE",
    "LEFT",
    "LEN",
    "LET",
    "LN",
    "LOG",
    "LOOKUP",
    "LOWER",
    "MAKEARRAY",
    "MAP",
    "MATCH",
    "MAX",
    "MAXIFS",
    "MEDIAN",
    "MID",
    "MIN",
    "MINIFS",
    "MINUTE",
    "MOD",
    "MONTH",
    "N",
    "NA",
    "NOT",
    "NOW",
    "NUMBERVALUE",
    "OFFSET",
    "OR",
    "PERCENTILE",
    "PI",
    "POWER",
    "PRODUCT",
    "PROPER",
    "RAND",
    "RANDARRAY",
    "RANK",
    "REDUCE",
    "REPLACE",
    "REPT",
    "RIGHT",
    "ROUND",
    "ROUNDDOWN",
    "ROUNDUP",
    "ROW",
    "ROWS",
    "SCAN",
    "SEARCH",
    "SECOND",
    "SEQUENCE",
    "SHEET",
    "SHEETS",
    "SIGN",
    "SMALL",
    "SORT",
    "SORTBY",
    "SPLIT",
    "SQRT",
    "STDEV",
    "SUBSTITUTE",
    "SUM",
    "SUMIF",
    "SUMIFS",
    "SUMPRODUCT",
    "SWITCH",
    "T",
    "TAKE",
    "TEXT",
    "TEXTJOIN",
    "TOCOL",
    "TODAY",
    "TOROW",
    "TO_DATE",
    "TO_DOLLARS",
    "TO_PERCENT",
    "TO_PURE_NUMBER",
    "TO_TEXT",
    "TRANSPOSE",
    "TRIM",
    "TRUE",
    "TYPE",
    "UNIQUE",
    "UPPER",
    "VALUE",
    "VAR",
    "VLOOKUP",
    "VSTACK",
    "WRAPCOLS",
    "WRAPROWS",
    "XLOOKUP",
    "XMATCH",
    "XOR",
    "YEAR",
];

/// Look up a function name case-insensitively in the known functions table.
/// Returns the canonical `&'static str` if found, `None` otherwise.
#[inline]
fn lookup_known_function(name: &str) -> Option<&'static str> {
    KNOWN_FUNCTIONS
        .binary_search_by(|canonical| {
            // Compare canonical (uppercase) against name (case-insensitive)
            let mut canonical_bytes = canonical.as_bytes().iter();
            let mut name_bytes = name.as_bytes().iter();
            loop {
                match (canonical_bytes.next(), name_bytes.next()) {
                    (Some(&c), Some(&n)) => {
                        let upper_n = n.to_ascii_uppercase();
                        match c.cmp(&upper_n) {
                            std::cmp::Ordering::Equal => {}
                            ord => return ord,
                        }
                    }
                    (None, None) => return std::cmp::Ordering::Equal,
                    (None, Some(_)) => return std::cmp::Ordering::Less,
                    (Some(_), None) => return std::cmp::Ordering::Greater,
                }
            }
        })
        .ok()
        .map(|idx| KNOWN_FUNCTIONS[idx])
}

/// Intern a function name: if it matches a known Excel function name (case-insensitive),
/// return the canonical uppercase form without a fresh allocation per unique name.
/// Otherwise fall back to `to_uppercase()`.
#[inline]
pub fn intern_function_name(name: &str) -> Cow<'static, str> {
    lookup_known_function(name).map_or_else(|| Cow::Owned(name.to_uppercase()), Cow::Borrowed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_known_functions_sorted() {
        // Verify the static table is actually sorted (required for binary search).
        for window in KNOWN_FUNCTIONS.windows(2) {
            assert!(
                window[0] < window[1],
                "KNOWN_FUNCTIONS not sorted: {:?} >= {:?}",
                window[0],
                window[1]
            );
        }
    }

    #[test]
    fn test_intern_known_lowercase() {
        assert_eq!(intern_function_name("sum"), "SUM");
        assert_eq!(intern_function_name("average"), "AVERAGE");
        assert_eq!(intern_function_name("vlookup"), "VLOOKUP");
        assert_eq!(intern_function_name("if"), "IF");
    }

    #[test]
    fn test_intern_known_mixed_case() {
        assert_eq!(intern_function_name("Sum"), "SUM");
        assert_eq!(intern_function_name("Average"), "AVERAGE");
        assert_eq!(intern_function_name("VLookup"), "VLOOKUP");
        assert_eq!(intern_function_name("CountIfs"), "COUNTIFS");
    }

    #[test]
    fn test_intern_known_uppercase() {
        assert_eq!(intern_function_name("SUM"), "SUM");
        assert_eq!(intern_function_name("INDEX"), "INDEX");
        assert_eq!(intern_function_name("MATCH"), "MATCH");
    }

    #[test]
    fn test_intern_unknown_falls_back_to_uppercase() {
        assert_eq!(intern_function_name("myfunc"), "MYFUNC");
        assert_eq!(intern_function_name("CustomCalc"), "CUSTOMCALC");
    }

    #[test]
    fn test_intern_edge_cases() {
        // Single-char functions
        assert_eq!(intern_function_name("n"), "N");
        assert_eq!(intern_function_name("t"), "T");
        // With dot
        assert_eq!(intern_function_name("error.type"), "ERROR.TYPE");
    }

    #[test]
    fn test_intern_sheets_type_conversion_functions() {
        for name in [
            "EPOCHTODATE",
            "TO_DATE",
            "TO_DOLLARS",
            "TO_PERCENT",
            "TO_PURE_NUMBER",
            "TO_TEXT",
        ] {
            assert_eq!(intern_function_name(name), name);
        }

        assert_eq!(intern_function_name("epochtodate"), "EPOCHTODATE");
        assert_eq!(intern_function_name("EpochToDate"), "EPOCHTODATE");
        assert_eq!(intern_function_name("to_date"), "TO_DATE");
        assert_eq!(intern_function_name("To_Dollars"), "TO_DOLLARS");
        assert_eq!(intern_function_name("to_percent"), "TO_PERCENT");
        assert_eq!(intern_function_name("To_Pure_Number"), "TO_PURE_NUMBER");
        assert_eq!(intern_function_name("to_text"), "TO_TEXT");
    }

    #[test]
    fn test_lookup_returns_none_for_unknown() {
        assert!(lookup_known_function("DOESNOTEXIST").is_none());
        assert!(lookup_known_function("").is_none());
    }

    #[test]
    fn test_lookup_returns_some_for_known() {
        assert_eq!(lookup_known_function("sum"), Some("SUM"));
        assert_eq!(lookup_known_function("SUM"), Some("SUM"));
        assert_eq!(lookup_known_function("xlookup"), Some("XLOOKUP"));
    }
}
