use super::*;
use value_types::{CellError, CellValue, FiniteF64};

/// Convenience: wrap a known-finite f64 literal in CellValue::Number.
fn n(v: f64) -> CellValue {
    CellValue::Number(FiniteF64::must(v))
}

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
    assert_eq!(type_rank(&n(42.0)), 0);
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
        &n(42.0),
        &n(42.0)
    ));
}

#[test]
fn not_equal_different_numbers() {
    assert!(!cell_values_equal(
        &n(42.0),
        &n(43.0)
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
        &n(42.0),
        &CellValue::Text("42".into())
    ));
}

#[test]
fn cross_type_null_zero_not_equal() {
    assert!(!cell_values_equal(
        &CellValue::Null,
        &n(0.0)
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
    assert_eq!(cell_value_key(&n(42.0)), "__NUM__:42");
}

#[test]
fn key_booleans() {
    assert_eq!(cell_value_key(&CellValue::Boolean(true)), "__BOOL__:true");
    assert_eq!(
        cell_value_key(&CellValue::Boolean(false)),
        "__BOOL__:false"
    );
}

#[test]
fn key_different_types_same_tostring() {
    // 42 (number) vs "42" (string) should produce different keys
    assert_ne!(
        cell_value_key(&n(42.0)),
        cell_value_key(&CellValue::Text("42".into()))
    );
}

#[test]
fn key_error() {
    assert_eq!(
        cell_value_key(&cell_error(CellError::Na)),
        "__ERR__:#N/A"
    );
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
    assert_eq!(format_cell_display(&n(42.0)), "42");
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
    assert_eq!(
        format_cell_display(&cell_error(CellError::Na)),
        "#N/A"
    );
}

// -----------------------------------------------------------------------
// value_in_list
// -----------------------------------------------------------------------

#[test]
fn value_in_list_null_found_in_list_with_null() {
    assert!(value_in_list(
        &CellValue::Null,
        &[
            n(1.0),
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
            n(1.0),
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
            n(1.0),
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
        &[
            n(1.0),
            nan(),
            CellValue::Text("a".into())
        ]
    ));
}

#[test]
fn value_in_list_nan_not_found() {
    assert!(!value_in_list(
        &nan(),
        &[
            n(1.0),
            n(2.0),
            CellValue::Text("a".into())
        ]
    ));
}

#[test]
fn value_in_list_number_found() {
    assert!(value_in_list(
        &n(42.0),
        &[
            n(1.0),
            n(42.0),
            n(100.0)
        ]
    ));
}

#[test]
fn value_in_list_number_not_found() {
    assert!(!value_in_list(
        &n(42.0),
        &[
            n(1.0),
            n(2.0),
            n(3.0)
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
            n(0.0),
            n(1.0)
        ]
    ));
}

#[test]
fn value_in_list_empty_list_always_false() {
    assert!(!value_in_list(&CellValue::Null, &[]));
    assert!(!value_in_list(&n(42.0), &[]));
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
        compare_values(
            &n(1.0),
            &CellValue::Text("a".into())
        ),
        Ordering::Less
    );
}

#[test]
fn compare_string_before_boolean() {
    assert_eq!(
        compare_values(
            &CellValue::Text("z".into()),
            &CellValue::Boolean(false)
        ),
        Ordering::Less
    );
}

#[test]
fn compare_boolean_before_error() {
    assert_eq!(
        compare_values(
            &CellValue::Boolean(true),
            &cell_error(CellError::Na)
        ),
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
        compare_values(&n(1.0), &n(2.0)),
        Ordering::Less
    );
    assert_eq!(
        compare_values(&n(2.0), &n(1.0)),
        Ordering::Greater
    );
    assert_eq!(
        compare_values(&n(1.0), &n(1.0)),
        Ordering::Equal
    );
}

#[test]
fn compare_nan_sorts_after_numbers() {
    assert_eq!(
        compare_values(&nan(), &n(999.0)),
        Ordering::Greater
    );
    assert_eq!(
        compare_values(&n(999.0), &nan()),
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
            "#NULL!", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#N/A",
            "#GETTING_DATA", "#SPILL!", "#CALC!"
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
        compare_values(
            &cell_error(CellError::Spill),
            &cell_error(CellError::Calc)
        ),
        Ordering::Less
    );
}

#[test]
fn compare_calc_after_spill() {
    assert_eq!(
        compare_values(
            &cell_error(CellError::Calc),
            &cell_error(CellError::Spill)
        ),
        Ordering::Greater
    );
}

#[test]
fn compare_null_error_before_spill() {
    assert_eq!(
        compare_values(
            &cell_error(CellError::Null),
            &cell_error(CellError::Spill)
        ),
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
        compare_values(&n(-5.0), &n(5.0)),
        Ordering::Less
    );
}

#[test]
fn compare_zero() {
    assert_eq!(
        compare_values(&n(0.0), &n(0.0)),
        Ordering::Equal
    );
}

#[test]
fn display_number_with_decimal() {
    assert_eq!(format_cell_display(&n(3.14)), "3.14");
}

#[test]
fn display_nan() {
    // nan() → Error(Num) since FiniteF64 excludes NaN
    assert_eq!(format_cell_display(&nan()), "#NUM!");
}
