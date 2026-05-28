//! Shared comparison and value identity utilities for the Table Engine.
//!
//! Centralizes Excel-compatible value comparison, type ranking, error detection,
//! and canonical value identity (dedup key, equality, display text).
//!
//! **CRITICAL: Table sort order is DIFFERENT from pivot sort order.**
//! - Table: number(0) < string(1) < boolean(2) < error(3) < blank(4)
//! - Pivot: null(0) < error(1) < boolean(2) < number(3) < string(4)
//!
//! **NOTE: Text comparison uses Unicode codepoint ordering (via `char::to_lowercase()`),
//! NOT locale-aware collation (like JavaScript's `localeCompare`).** This avoids an ICU
//! dependency and is allocation-free. For ASCII text the results are identical. For
//! accented characters (e.g., "ä" vs "b"), the sort order may differ from locale-aware
//! implementations. This is an intentional trade-off for performance.

use std::cmp::Ordering;

use value_types::{CellError, CellValue};

// =============================================================================
// Excel error sort order (fixed, NOT alphabetical)
// =============================================================================

/// Return the fixed sort rank for an Excel error type.
///
/// Excel sorts errors in a specific fixed order, not alphabetically.
/// Unknown errors (which cannot occur with our enum) would sort after all known ones.
///
/// Order: #NULL!(0) < #DIV/0!(1) < #VALUE!(2) < #REF!(3) < #NAME?(4) < #NUM!(5)
///        < #N/A(6) < #GETTING_DATA(7) < #SPILL!(8) < #CALC!(9)
pub fn error_sort_rank(e: &CellError) -> u8 {
    match e {
        CellError::Null => 0,
        CellError::Div0 => 1,
        CellError::Value => 2,
        CellError::Ref => 3,
        CellError::Name => 4,
        CellError::Num => 5,
        CellError::Na => 6,
        CellError::GettingData => 7,
        CellError::Spill => 8,
        CellError::Calc => 9,
        CellError::Circ => 3, // Same rank as Ref (displays as #REF!)
    }
}

// =============================================================================
// type_rank — Excel table type ordering
// =============================================================================

/// Assign a numeric rank for type-based ordering in table sort/filter.
///
///   0 = number, 1 = string, 2 = boolean, 3 = error, 4 = blank (Null)
///
/// NaN is treated as a number (rank 0) but sorts after all regular numbers.
pub fn type_rank(value: &CellValue) -> u8 {
    match value {
        CellValue::Null => 4,
        CellValue::Error(..) => 3,
        CellValue::Boolean(_) => 2,
        CellValue::Text(_) => 1,
        CellValue::Number(_) => 0,
        CellValue::Array(_) => 4,   // treat arrays as blank for sorting
        CellValue::Control(_) => 2, // same rank as Boolean
        CellValue::Image(_) => 1,   // sort image fallback with string-like values
    }
}

// =============================================================================
// compare_values — Excel sort/filter ordering
// =============================================================================

/// Compare two CellValues using Excel table ordering semantics.
///
/// Sort order:
///   1. Numbers (ascending; NaN sorts after all regular numbers)
///   2. Text (case-insensitive alphabetical)
///   3. Booleans (FALSE before TRUE)
///   4. Errors (Excel fixed order)
///   5. Blanks (null) — ALWAYS last
pub fn compare_values(a: &CellValue, b: &CellValue) -> Ordering {
    let rank_a = type_rank(a);
    let rank_b = type_rank(b);

    // Different type ranks: sort by rank
    if rank_a != rank_b {
        return rank_a.cmp(&rank_b);
    }

    // Same type rank — compare within type
    match rank_a {
        // Both blank
        4 => Ordering::Equal,

        // Both errors — use Excel's fixed order
        3 => {
            if let (CellValue::Error(ea, None), CellValue::Error(eb, None)) = (a, b) {
                let order_a = error_sort_rank(ea);
                let order_b = error_sort_rank(eb);
                if order_a != order_b {
                    order_a.cmp(&order_b)
                } else {
                    // Same error type — equal
                    Ordering::Equal
                }
            } else {
                Ordering::Equal
            }
        }

        // Both booleans
        2 => {
            if let (CellValue::Boolean(ba), CellValue::Boolean(bb)) = (a, b) {
                // FALSE < TRUE
                ba.cmp(bb)
            } else {
                Ordering::Equal
            }
        }

        // Both text — case-insensitive via Unicode `char::to_lowercase()`.
        // Uses codepoint ordering, NOT locale-aware collation (see module doc).
        1 => {
            if let (CellValue::Text(sa), CellValue::Text(sb)) = (a, b) {
                sa.chars()
                    .flat_map(|c| c.to_lowercase())
                    .cmp(sb.chars().flat_map(|c| c.to_lowercase()))
            } else {
                Ordering::Equal
            }
        }

        // Both numbers — FiniteF64 is always finite, so no NaN handling needed.
        0 => {
            if let (CellValue::Number(na), CellValue::Number(nb)) = (a, b) {
                na.cmp(nb)
            } else {
                Ordering::Equal
            }
        }

        _ => Ordering::Equal,
    }
}

// =============================================================================
// cell_values_equal — canonical equality
// =============================================================================

/// Compare two CellValues for equality using canonical semantics.
///
/// Semantics:
/// - Strings are case-insensitive ("Hello" === "hello")
/// - NaN === NaN (unlike default float behavior)
/// - Errors equal if their error types match
/// - Numbers and booleans use strict equality
/// - Null is only equal to Null
pub fn cell_values_equal(a: &CellValue, b: &CellValue) -> bool {
    match (a, b) {
        (CellValue::Null, CellValue::Null) => true,
        // FiniteF64 implements Eq (NaN excluded by construction).
        (CellValue::Number(na), CellValue::Number(nb)) => na == nb,
        // Full Unicode case-insensitive comparison, consistent with compare_values.
        // We use the same char::to_lowercase iterator approach to avoid allocations
        // and to handle non-ASCII characters correctly (e.g., "CAFÉ" == "café").
        (CellValue::Text(sa), CellValue::Text(sb)) => sa
            .chars()
            .flat_map(|c| c.to_lowercase())
            .eq(sb.chars().flat_map(|c| c.to_lowercase())),
        (CellValue::Boolean(ba), CellValue::Boolean(bb)) => ba == bb,
        (CellValue::Error(ea, None), CellValue::Error(eb, None)) => ea == eb,
        _ => false,
    }
}

// =============================================================================
// cell_value_key — canonical dedup key
// =============================================================================

/// Produce a canonical string key for a CellValue, for deduplication.
///
/// Semantics:
/// - Strings are case-insensitive ("Hello" and "hello" produce the same key)
/// - NaN maps to `"__NUM__:NaN"`
/// - Null maps to `"__BLANK__"`
/// - Errors keyed by their error string
/// - Numbers produce `"__NUM__:<value>"`
/// - Booleans produce `"__BOOL__:true"` or `"__BOOL__:false"`
pub fn cell_value_key(value: &CellValue) -> String {
    match value {
        CellValue::Null => "__BLANK__".to_string(),
        CellValue::Error(e, _) => format!("__ERR__:{}", e.as_str()),
        CellValue::Boolean(b) => format!("__BOOL__:{}", b),
        // FiniteF64 can never be NaN, so no NaN branch needed.
        CellValue::Number(n) => format!("__NUM__:{}", n),
        CellValue::Text(s) => format!("__STR__:{}", s.to_lowercase()),
        CellValue::Control(c) => format!("__BOOL__:{}", c.value),
        CellValue::Image(image) => format!("__IMG__:{}", image.fallback_text().to_lowercase()),
        CellValue::Array(_) => "__BLANK__".to_string(),
    }
}

// =============================================================================
// value_in_list — check membership using canonical equality
// =============================================================================

/// Check if a cell value is included in a list of values.
///
/// Uses semantic equality: case-insensitive strings, NaN === NaN.
pub fn value_in_list(value: &CellValue, list: &[CellValue]) -> bool {
    list.iter().any(|v| cell_values_equal(value, v))
}

/// Build a HashSet of canonical keys from a list of CellValues.
///
/// Used with `value_in_key_set` to amortize O(k) per-row lookup to O(1).
/// Build the set once before the per-row loop, then call `value_in_key_set`
/// for each row.
pub fn build_value_key_set(values: &[CellValue]) -> std::collections::HashSet<String> {
    values.iter().map(cell_value_key).collect()
}

/// Like `value_in_list` but O(1) per lookup using pre-computed keys.
/// Build the key set with `build_value_key_set` first.
pub fn value_in_key_set(value: &CellValue, key_set: &std::collections::HashSet<String>) -> bool {
    key_set.contains(&cell_value_key(value))
}

// =============================================================================
// format_cell_display — canonical display text
// =============================================================================

/// Format a CellValue for display in UI elements (slicer items, filter dropdown).
pub fn format_cell_display(value: &CellValue) -> String {
    match value {
        CellValue::Null => "(Blank)".to_string(),
        CellValue::Error(e, _) => e.as_str().to_string(),
        CellValue::Boolean(b) => {
            if *b {
                "TRUE".to_string()
            } else {
                "FALSE".to_string()
            }
        }
        CellValue::Number(n) => {
            let v = n.get();
            if v == v.trunc() && v.abs() < 1e15 {
                format!("{}", v as i64)
            } else {
                format!("{}", v)
            }
        }
        CellValue::Text(s) => s.to_string(),
        CellValue::Control(c) => if c.value { "TRUE" } else { "FALSE" }.to_string(),
        CellValue::Image(image) => image.fallback_text().to_string(),
        CellValue::Array(_) => "(Array)".to_string(),
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use value_types::{CellError, CellValue};

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    fn cell_error(e: CellError) -> CellValue {
        CellValue::Error(e, None)
    }

    fn nan() -> CellValue {
        CellValue::number(f64::NAN)
    }

    // -----------------------------------------------------------------------
    // type_rank
    // -----------------------------------------------------------------------

    #[test]
    fn type_rank_null_is_4() {
        assert_eq!(type_rank(&CellValue::Null), 4);
    }

    #[test]
    fn type_rank_number_is_0() {
        assert_eq!(type_rank(&CellValue::number(42.0)), 0);
    }

    #[test]
    fn type_rank_string_is_1() {
        assert_eq!(type_rank(&CellValue::Text("hello".into())), 1);
    }

    #[test]
    fn type_rank_boolean_is_2() {
        assert_eq!(type_rank(&CellValue::Boolean(true)), 2);
    }

    #[test]
    fn type_rank_error_is_3() {
        assert_eq!(type_rank(&cell_error(CellError::Na)), 3);
    }

    #[test]
    fn type_rank_nan_is_error_rank() {
        // nan() → Error(Num), so type_rank is 3 (error rank)
        assert_eq!(type_rank(&nan()), 3);
    }

    // -----------------------------------------------------------------------
    // cell_values_equal
    // -----------------------------------------------------------------------

    #[test]
    fn equal_null_null() {
        assert!(cell_values_equal(&CellValue::Null, &CellValue::Null));
    }

    #[test]
    fn equal_nan_nan() {
        assert!(cell_values_equal(&nan(), &nan()));
    }

    #[test]
    fn equal_strings_case_insensitive() {
        assert!(cell_values_equal(
            &CellValue::Text("Hello".into()),
            &CellValue::Text("hello".into())
        ));
    }

    #[test]
    fn not_equal_different_strings() {
        assert!(!cell_values_equal(
            &CellValue::Text("Hello".into()),
            &CellValue::Text("world".into())
        ));
    }

    #[test]
    fn equal_same_numbers() {
        assert!(cell_values_equal(
            &CellValue::number(42.0),
            &CellValue::number(42.0)
        ));
    }

    #[test]
    fn not_equal_different_numbers() {
        assert!(!cell_values_equal(
            &CellValue::number(42.0),
            &CellValue::number(43.0)
        ));
    }

    #[test]
    fn equal_same_booleans() {
        assert!(cell_values_equal(
            &CellValue::Boolean(true),
            &CellValue::Boolean(true)
        ));
    }

    #[test]
    fn not_equal_different_booleans() {
        assert!(!cell_values_equal(
            &CellValue::Boolean(true),
            &CellValue::Boolean(false)
        ));
    }

    #[test]
    fn equal_same_errors() {
        assert!(cell_values_equal(
            &cell_error(CellError::Na),
            &cell_error(CellError::Na)
        ));
    }

    #[test]
    fn not_equal_different_errors() {
        assert!(!cell_values_equal(
            &cell_error(CellError::Na),
            &cell_error(CellError::Ref)
        ));
    }

    #[test]
    fn cross_type_number_string_not_equal() {
        assert!(!cell_values_equal(
            &CellValue::number(42.0),
            &CellValue::Text("42".into())
        ));
    }

    #[test]
    fn cross_type_null_zero_not_equal() {
        assert!(!cell_values_equal(
            &CellValue::Null,
            &CellValue::number(0.0)
        ));
    }

    #[test]
    fn cross_type_null_empty_string_not_equal() {
        assert!(!cell_values_equal(
            &CellValue::Null,
            &CellValue::Text("".into())
        ));
    }

    #[test]
    fn equal_empty_strings() {
        assert!(cell_values_equal(
            &CellValue::Text("".into()),
            &CellValue::Text("".into())
        ));
    }

    // -----------------------------------------------------------------------
    // cell_value_key
    // -----------------------------------------------------------------------

    #[test]
    fn key_null() {
        assert_eq!(cell_value_key(&CellValue::Null), "__BLANK__");
    }

    #[test]
    fn key_nan() {
        // nan() → Error(Num) since FiniteF64 excludes NaN
        assert_eq!(cell_value_key(&nan()), "__ERR__:#NUM!");
    }

    #[test]
    fn key_strings_case_insensitive() {
        assert_eq!(
            cell_value_key(&CellValue::Text("Hello".into())),
            cell_value_key(&CellValue::Text("hello".into()))
        );
    }

    #[test]
    fn key_number() {
        assert_eq!(cell_value_key(&CellValue::number(42.0)), "__NUM__:42");
    }

    #[test]
    fn key_booleans() {
        assert_eq!(cell_value_key(&CellValue::Boolean(true)), "__BOOL__:true");
        assert_eq!(cell_value_key(&CellValue::Boolean(false)), "__BOOL__:false");
    }

    #[test]
    fn key_different_types_same_tostring() {
        // 42 (number) vs "42" (string) should produce different keys
        assert_ne!(
            cell_value_key(&CellValue::number(42.0)),
            cell_value_key(&CellValue::Text("42".into()))
        );
    }

    #[test]
    fn key_error() {
        assert_eq!(cell_value_key(&cell_error(CellError::Na)), "__ERR__:#N/A");
    }

    // -----------------------------------------------------------------------
    // format_cell_display
    // -----------------------------------------------------------------------

    #[test]
    fn display_null() {
        assert_eq!(format_cell_display(&CellValue::Null), "(Blank)");
    }

    #[test]
    fn display_number() {
        assert_eq!(format_cell_display(&CellValue::number(42.0)), "42");
    }

    #[test]
    fn display_string() {
        assert_eq!(
            format_cell_display(&CellValue::Text("hello".into())),
            "hello"
        );
    }

    #[test]
    fn display_true() {
        assert_eq!(format_cell_display(&CellValue::Boolean(true)), "TRUE");
    }

    #[test]
    fn display_false() {
        assert_eq!(format_cell_display(&CellValue::Boolean(false)), "FALSE");
    }

    #[test]
    fn display_error() {
        assert_eq!(format_cell_display(&cell_error(CellError::Na)), "#N/A");
    }

    // -----------------------------------------------------------------------
    // value_in_list
    // -----------------------------------------------------------------------

    #[test]
    fn value_in_list_null_found_in_list_with_null() {
        assert!(value_in_list(
            &CellValue::Null,
            &[
                CellValue::number(1.0),
                CellValue::Null,
                CellValue::Text("a".into())
            ]
        ));
    }

    #[test]
    fn value_in_list_null_not_found_without_null() {
        assert!(!value_in_list(
            &CellValue::Null,
            &[
                CellValue::number(1.0),
                CellValue::Text("hello".into()),
                CellValue::Boolean(true)
            ]
        ));
    }

    #[test]
    fn value_in_list_error_found() {
        assert!(value_in_list(
            &cell_error(CellError::Na),
            &[
                CellValue::number(1.0),
                cell_error(CellError::Na),
                CellValue::Text("a".into())
            ]
        ));
    }

    #[test]
    fn value_in_list_error_not_found_different_error() {
        assert!(!value_in_list(
            &cell_error(CellError::Na),
            &[cell_error(CellError::Ref), CellValue::Text("a".into())]
        ));
    }

    #[test]
    fn value_in_list_string_case_insensitive() {
        assert!(value_in_list(
            &CellValue::Text("Hello".into()),
            &[
                CellValue::Text("HELLO".into()),
                CellValue::Text("world".into())
            ]
        ));
    }

    #[test]
    fn value_in_list_string_not_found() {
        assert!(!value_in_list(
            &CellValue::Text("Hello".into()),
            &[
                CellValue::Text("world".into()),
                CellValue::Text("foo".into())
            ]
        ));
    }

    #[test]
    fn value_in_list_nan_found() {
        assert!(value_in_list(
            &nan(),
            &[CellValue::number(1.0), nan(), CellValue::Text("a".into())]
        ));
    }

    #[test]
    fn value_in_list_nan_not_found() {
        assert!(!value_in_list(
            &nan(),
            &[
                CellValue::number(1.0),
                CellValue::number(2.0),
                CellValue::Text("a".into())
            ]
        ));
    }

    #[test]
    fn value_in_list_number_found() {
        assert!(value_in_list(
            &CellValue::number(42.0),
            &[
                CellValue::number(1.0),
                CellValue::number(42.0),
                CellValue::number(100.0)
            ]
        ));
    }

    #[test]
    fn value_in_list_number_not_found() {
        assert!(!value_in_list(
            &CellValue::number(42.0),
            &[
                CellValue::number(1.0),
                CellValue::number(2.0),
                CellValue::number(3.0)
            ]
        ));
    }

    #[test]
    fn value_in_list_boolean_found() {
        assert!(value_in_list(
            &CellValue::Boolean(true),
            &[CellValue::Boolean(false), CellValue::Boolean(true)]
        ));
    }

    #[test]
    fn value_in_list_boolean_not_found() {
        assert!(!value_in_list(
            &CellValue::Boolean(true),
            &[
                CellValue::Boolean(false),
                CellValue::number(0.0),
                CellValue::number(1.0)
            ]
        ));
    }

    #[test]
    fn value_in_list_empty_list_always_false() {
        assert!(!value_in_list(&CellValue::Null, &[]));
        assert!(!value_in_list(&CellValue::number(42.0), &[]));
        assert!(!value_in_list(&CellValue::Text("hello".into()), &[]));
        assert!(!value_in_list(&CellValue::Boolean(true), &[]));
        assert!(!value_in_list(&cell_error(CellError::Na), &[]));
    }

    // -----------------------------------------------------------------------
    // compare_values — cross-type ordering
    // -----------------------------------------------------------------------

    #[test]
    fn compare_number_before_string() {
        assert_eq!(
            compare_values(&CellValue::number(1.0), &CellValue::Text("a".into())),
            Ordering::Less
        );
    }

    #[test]
    fn compare_string_before_boolean() {
        assert_eq!(
            compare_values(&CellValue::Text("z".into()), &CellValue::Boolean(false)),
            Ordering::Less
        );
    }

    #[test]
    fn compare_boolean_before_error() {
        assert_eq!(
            compare_values(&CellValue::Boolean(true), &cell_error(CellError::Na)),
            Ordering::Less
        );
    }

    #[test]
    fn compare_error_before_blank() {
        assert_eq!(
            compare_values(&cell_error(CellError::Na), &CellValue::Null),
            Ordering::Less
        );
    }

    #[test]
    fn compare_blank_equals_blank() {
        assert_eq!(
            compare_values(&CellValue::Null, &CellValue::Null),
            Ordering::Equal
        );
    }

    // -----------------------------------------------------------------------
    // compare_values — within-type ordering
    // -----------------------------------------------------------------------

    #[test]
    fn compare_numbers_ascending() {
        assert_eq!(
            compare_values(&CellValue::number(1.0), &CellValue::number(2.0)),
            Ordering::Less
        );
        assert_eq!(
            compare_values(&CellValue::number(2.0), &CellValue::number(1.0)),
            Ordering::Greater
        );
        assert_eq!(
            compare_values(&CellValue::number(1.0), &CellValue::number(1.0)),
            Ordering::Equal
        );
    }

    #[test]
    fn compare_nan_sorts_after_numbers() {
        assert_eq!(
            compare_values(&nan(), &CellValue::number(999.0)),
            Ordering::Greater
        );
        assert_eq!(
            compare_values(&CellValue::number(999.0), &nan()),
            Ordering::Less
        );
    }

    #[test]
    fn compare_nan_equals_nan() {
        assert_eq!(compare_values(&nan(), &nan()), Ordering::Equal);
    }

    #[test]
    fn compare_strings_case_insensitive() {
        assert_eq!(
            compare_values(
                &CellValue::Text("apple".into()),
                &CellValue::Text("Banana".into())
            ),
            Ordering::Less
        );
    }

    #[test]
    fn compare_booleans_false_before_true() {
        assert_eq!(
            compare_values(&CellValue::Boolean(false), &CellValue::Boolean(true)),
            Ordering::Less
        );
        assert_eq!(
            compare_values(&CellValue::Boolean(true), &CellValue::Boolean(false)),
            Ordering::Greater
        );
        assert_eq!(
            compare_values(&CellValue::Boolean(true), &CellValue::Boolean(true)),
            Ordering::Equal
        );
    }

    // -----------------------------------------------------------------------
    // compare_values — error sort order
    // -----------------------------------------------------------------------

    #[test]
    fn compare_error_sort_order() {
        let errors = vec![
            cell_error(CellError::Calc),
            cell_error(CellError::Spill),
            cell_error(CellError::GettingData),
            cell_error(CellError::Na),
            cell_error(CellError::Num),
            cell_error(CellError::Name),
            cell_error(CellError::Ref),
            cell_error(CellError::Value),
            cell_error(CellError::Div0),
            cell_error(CellError::Null),
        ];

        let mut sorted = errors.clone();
        sorted.sort_by(|a, b| compare_values(a, b));

        let error_strs: Vec<&str> = sorted
            .iter()
            .map(|v| match v {
                CellValue::Error(e, _) => e.as_str(),
                _ => unreachable!(),
            })
            .collect();

        assert_eq!(
            error_strs,
            vec![
                "#NULL!",
                "#DIV/0!",
                "#VALUE!",
                "#REF!",
                "#NAME?",
                "#NUM!",
                "#N/A",
                "#GETTING_DATA",
                "#SPILL!",
                "#CALC!"
            ]
        );
    }

    #[test]
    fn compare_spill_after_getting_data() {
        assert_eq!(
            compare_values(
                &cell_error(CellError::Spill),
                &cell_error(CellError::GettingData)
            ),
            Ordering::Greater
        );
    }

    #[test]
    fn compare_spill_before_calc() {
        assert_eq!(
            compare_values(&cell_error(CellError::Spill), &cell_error(CellError::Calc)),
            Ordering::Less
        );
    }

    #[test]
    fn compare_calc_after_spill() {
        assert_eq!(
            compare_values(&cell_error(CellError::Calc), &cell_error(CellError::Spill)),
            Ordering::Greater
        );
    }

    #[test]
    fn compare_null_error_before_spill() {
        assert_eq!(
            compare_values(&cell_error(CellError::Null), &cell_error(CellError::Spill)),
            Ordering::Less
        );
    }

    // -----------------------------------------------------------------------
    // error_sort_rank
    // -----------------------------------------------------------------------

    #[test]
    fn error_sort_rank_all_values() {
        assert_eq!(error_sort_rank(&CellError::Null), 0);
        assert_eq!(error_sort_rank(&CellError::Div0), 1);
        assert_eq!(error_sort_rank(&CellError::Value), 2);
        assert_eq!(error_sort_rank(&CellError::Ref), 3);
        assert_eq!(error_sort_rank(&CellError::Name), 4);
        assert_eq!(error_sort_rank(&CellError::Num), 5);
        assert_eq!(error_sort_rank(&CellError::Na), 6);
        assert_eq!(error_sort_rank(&CellError::GettingData), 7);
        assert_eq!(error_sort_rank(&CellError::Spill), 8);
        assert_eq!(error_sort_rank(&CellError::Calc), 9);
    }

    // -----------------------------------------------------------------------
    // Negative float, zero, and special cases
    // -----------------------------------------------------------------------

    #[test]
    fn compare_negative_numbers() {
        assert_eq!(
            compare_values(&CellValue::number(-5.0), &CellValue::number(5.0)),
            Ordering::Less
        );
    }

    #[test]
    fn compare_zero() {
        assert_eq!(
            compare_values(&CellValue::number(0.0), &CellValue::number(0.0)),
            Ordering::Equal
        );
    }

    #[test]
    fn display_number_with_decimal() {
        assert_eq!(format_cell_display(&CellValue::number(3.14)), "3.14");
    }

    #[test]
    fn display_nan() {
        // nan() → Error(Num) since FiniteF64 excludes NaN
        assert_eq!(format_cell_display(&nan()), "#NUM!");
    }
}
