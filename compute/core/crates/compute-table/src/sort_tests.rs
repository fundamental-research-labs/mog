use super::*;
use value_types::{CellError, FiniteF64};

/// Convenience: wrap a known-finite f64 literal in CellValue::Number.
fn n(v: f64) -> CellValue {
    CellValue::Number(FiniteF64::must(v))
}

/// Helper: create a SortSpec with a numeric column index string.
fn sort_spec(col: usize, dir: SortDirection) -> SortSpec {
    SortSpec {
        column_id: col.to_string(),
        direction: dir,
        custom_order: None,
    }
}

fn sort_spec_custom(col: usize, dir: SortDirection, custom: Vec<CellValue>) -> SortSpec {
    SortSpec {
        column_id: col.to_string(),
        direction: dir,
        custom_order: Some(custom),
    }
}

// ---- Identity permutation ----

#[test]
fn empty_specs_returns_identity() {
    let col0 = vec![
        n(3.0),
        n(1.0),
        n(2.0),
    ];
    let data: Vec<&[CellValue]> = vec![&col0];
    let result = compute_sort_order(&[], &data, 3);
    assert_eq!(result, vec![0, 1, 2]);
}

#[test]
fn empty_data_returns_empty() {
    let specs = vec![sort_spec(0, SortDirection::Ascending)];
    let data: Vec<&[CellValue]> = vec![];
    let result = compute_sort_order(&specs, &data, 0);
    assert!(result.is_empty());
}

// ---- Basic ascending sort ----

#[test]
fn sort_numbers_ascending() {
    let col0 = vec![
        n(30.0),
        n(10.0),
        n(20.0),
    ];
    let data: Vec<&[CellValue]> = vec![&col0];
    let specs = vec![sort_spec(0, SortDirection::Ascending)];
    let result = compute_sort_order(&specs, &data, 3);
    // 10 < 20 < 30 → original indices [1, 2, 0]
    assert_eq!(result, vec![1, 2, 0]);
}

// ---- Basic descending sort ----

#[test]
fn sort_numbers_descending() {
    let col0 = vec![
        n(30.0),
        n(10.0),
        n(20.0),
    ];
    let data: Vec<&[CellValue]> = vec![&col0];
    let specs = vec![sort_spec(0, SortDirection::Descending)];
    let result = compute_sort_order(&specs, &data, 3);
    // 30 > 20 > 10 → original indices [0, 2, 1]
    assert_eq!(result, vec![0, 2, 1]);
}

// ---- Blanks always sort last ----

#[test]
fn blanks_sort_last_ascending() {
    let col0 = vec![
        CellValue::Null,
        n(2.0),
        CellValue::Null,
        n(1.0),
    ];
    let data: Vec<&[CellValue]> = vec![&col0];
    let specs = vec![sort_spec(0, SortDirection::Ascending)];
    let result = compute_sort_order(&specs, &data, 4);
    // 1 < 2, then blanks: [3, 1, 0, 2]
    assert_eq!(result, vec![3, 1, 0, 2]);
}

#[test]
fn blanks_sort_last_descending() {
    let col0 = vec![
        CellValue::Null,
        n(2.0),
        CellValue::Null,
        n(1.0),
    ];
    let data: Vec<&[CellValue]> = vec![&col0];
    let specs = vec![sort_spec(0, SortDirection::Descending)];
    let result = compute_sort_order(&specs, &data, 4);
    // 2 > 1, then blanks: [1, 3, 0, 2]
    assert_eq!(result, vec![1, 3, 0, 2]);
}

// ---- Mixed types: numbers < text < booleans < errors < blanks ----

#[test]
fn sort_mixed_types_ascending() {
    let col0 = vec![
        CellValue::Text("banana".to_string()),
        n(1.0),
        CellValue::Boolean(false),
        CellValue::Error(CellError::Na, None),
        CellValue::Null,
    ];
    let data: Vec<&[CellValue]> = vec![&col0];
    let specs = vec![sort_spec(0, SortDirection::Ascending)];
    let result = compute_sort_order(&specs, &data, 5);
    // number(1) < text("banana") < bool(false) < error(#N/A) < blank
    assert_eq!(result, vec![1, 0, 2, 3, 4]);
}

// ---- Multi-key sort ----

#[test]
fn multi_key_sort() {
    // Sort by col0 ascending, then col1 descending
    let col0 = vec![
        n(1.0),
        n(2.0),
        n(1.0),
        n(2.0),
    ];
    let col1 = vec![
        CellValue::Text("B".to_string()),
        CellValue::Text("A".to_string()),
        CellValue::Text("A".to_string()),
        CellValue::Text("B".to_string()),
    ];
    let data: Vec<&[CellValue]> = vec![&col0, &col1];
    let specs = vec![
        sort_spec(0, SortDirection::Ascending),
        sort_spec(1, SortDirection::Descending),
    ];
    let result = compute_sort_order(&specs, &data, 4);
    // First by col0: rows {0,2} (val=1) then rows {1,3} (val=2)
    // Within val=1: col1 desc → "B"(row0) before "A"(row2)
    // Within val=2: col1 desc → "B"(row3) before "A"(row1)
    assert_eq!(result, vec![0, 2, 3, 1]);
}

// ---- Stable sort ----

#[test]
fn stable_sort_preserves_original_order() {
    let col0 = vec![
        n(1.0),
        n(1.0),
        n(1.0),
    ];
    let data: Vec<&[CellValue]> = vec![&col0];
    let specs = vec![sort_spec(0, SortDirection::Ascending)];
    let result = compute_sort_order(&specs, &data, 3);
    // All equal → preserve original order
    assert_eq!(result, vec![0, 1, 2]);
}

// ---- String sort is case-insensitive ----

#[test]
fn string_sort_case_insensitive() {
    let col0 = vec![
        CellValue::Text("Charlie".to_string()),
        CellValue::Text("alpha".to_string()),
        CellValue::Text("BRAVO".to_string()),
    ];
    let data: Vec<&[CellValue]> = vec![&col0];
    let specs = vec![sort_spec(0, SortDirection::Ascending)];
    let result = compute_sort_order(&specs, &data, 3);
    // alpha < BRAVO < Charlie (case-insensitive)
    assert_eq!(result, vec![1, 2, 0]);
}

// ---- Custom order ----

#[test]
fn custom_order_basic() {
    let col0 = vec![
        CellValue::Text("low".to_string()),
        CellValue::Text("high".to_string()),
        CellValue::Text("medium".to_string()),
    ];
    let custom = vec![
        CellValue::Text("high".to_string()),
        CellValue::Text("medium".to_string()),
        CellValue::Text("low".to_string()),
    ];
    let data: Vec<&[CellValue]> = vec![&col0];
    let specs = vec![sort_spec_custom(0, SortDirection::Ascending, custom)];
    let result = compute_sort_order(&specs, &data, 3);
    // Custom order: high(1) < medium(2) < low(0)
    assert_eq!(result, vec![1, 2, 0]);
}

#[test]
fn custom_order_values_not_in_list_sort_after() {
    let col0 = vec![
        CellValue::Text("unknown".to_string()),
        CellValue::Text("high".to_string()),
        CellValue::Text("also_unknown".to_string()),
    ];
    let custom = vec![CellValue::Text("high".to_string())];
    let data: Vec<&[CellValue]> = vec![&col0];
    let specs = vec![sort_spec_custom(0, SortDirection::Ascending, custom)];
    let result = compute_sort_order(&specs, &data, 3);
    // "high" is index 0 in custom → first
    // "unknown" and "also_unknown" not in list → sort after, by compare_values
    // "also_unknown" < "unknown" alphabetically
    assert_eq!(result, vec![1, 2, 0]);
}

#[test]
fn custom_order_blanks_still_last() {
    let col0 = vec![
        CellValue::Null,
        CellValue::Text("high".to_string()),
        CellValue::Text("low".to_string()),
    ];
    let custom = vec![
        CellValue::Text("high".to_string()),
        CellValue::Text("low".to_string()),
    ];
    let data: Vec<&[CellValue]> = vec![&col0];
    let specs = vec![sort_spec_custom(0, SortDirection::Ascending, custom)];
    let result = compute_sort_order(&specs, &data, 3);
    // "high" < "low" by custom, then blank last
    assert_eq!(result, vec![1, 2, 0]);
}

// ---- BUG FIX: find_custom_index uses cell_values_equal ----

#[test]
fn find_custom_index_case_insensitive() {
    let custom = vec![
        CellValue::Text("High".to_string()),
        CellValue::Text("Medium".to_string()),
        CellValue::Text("Low".to_string()),
    ];
    // Should match case-insensitively
    assert_eq!(
        find_custom_index(&CellValue::Text("high".to_string()), &custom),
        Some(0)
    );
    assert_eq!(
        find_custom_index(&CellValue::Text("MEDIUM".to_string()), &custom),
        Some(1)
    );
}

#[test]
fn find_custom_index_error_values() {
    let custom = vec![
        CellValue::Error(CellError::Na, None),
        CellValue::Error(CellError::Div0, None),
    ];
    assert_eq!(
        find_custom_index(&CellValue::Error(CellError::Na, None), &custom),
        Some(0)
    );
    assert_eq!(
        find_custom_index(&CellValue::Error(CellError::Div0, None), &custom),
        Some(1)
    );
    assert_eq!(
        find_custom_index(&CellValue::Error(CellError::Value, None), &custom),
        None
    );
}

#[test]
fn find_custom_index_null_values() {
    let custom = vec![CellValue::Null, n(1.0)];
    assert_eq!(find_custom_index(&CellValue::Null, &custom), Some(0));
}

#[test]
fn find_custom_index_not_found() {
    let custom = vec![n(1.0), n(2.0)];
    assert_eq!(
        find_custom_index(&n(99.0), &custom),
        None
    );
}

// ---- Invalid column index is skipped ----

#[test]
fn invalid_column_index_skipped() {
    let col0 = vec![
        n(3.0),
        n(1.0),
        n(2.0),
    ];
    let data: Vec<&[CellValue]> = vec![&col0];
    // Spec references column 99, which doesn't exist → no sorting, identity
    let specs = vec![SortSpec {
        column_id: "99".to_string(),
        direction: SortDirection::Ascending,
        custom_order: None,
    }];
    let result = compute_sort_order(&specs, &data, 3);
    assert_eq!(result, vec![0, 1, 2]);
}

// ---- Boolean sort order: FALSE < TRUE ----

#[test]
fn sort_booleans() {
    let col0 = vec![
        CellValue::Boolean(true),
        CellValue::Boolean(false),
        CellValue::Boolean(true),
        CellValue::Boolean(false),
    ];
    let data: Vec<&[CellValue]> = vec![&col0];
    let specs = vec![sort_spec(0, SortDirection::Ascending)];
    let result = compute_sort_order(&specs, &data, 4);
    // FALSE < TRUE, stable within same value
    assert_eq!(result, vec![1, 3, 0, 2]);
}

// ---- Error sort order ----

#[test]
fn sort_errors_by_excel_order() {
    let col0 = vec![
        CellValue::Error(CellError::Na, None),
        CellValue::Error(CellError::Null, None),
        CellValue::Error(CellError::Value, None),
    ];
    let data: Vec<&[CellValue]> = vec![&col0];
    let specs = vec![sort_spec(0, SortDirection::Ascending)];
    let result = compute_sort_order(&specs, &data, 3);
    // Excel error order: #NULL!(1) < #VALUE!(2) < #N/A(0)
    assert_eq!(result, vec![1, 2, 0]);
}

// =========================================================================
// Sort Edge Cases
// =========================================================================

#[test]
fn sort_with_array_values() {
    // Arrays should sort after all scalar values (like blanks)
    let col0 = vec![
        n(10.0),
        CellValue::from_rows(vec![vec![n(5.0)]]),
        CellValue::Text("hello".to_string()),
        CellValue::from_rows(vec![vec![n(1.0)]]),
        n(20.0),
    ];
    let data: Vec<&[CellValue]> = vec![&col0];
    let specs = vec![sort_spec(0, SortDirection::Ascending)];
    let result = compute_sort_order(&specs, &data, 5);

    // type_rank: Number=0, Text=1, Array=4 (treated as blank)
    // So: numbers < text < arrays
    // Expected order: [10, 20, "hello", array1, array2]
    // Original indices: [0, 4, 2, 1, 3]
    assert_eq!(result, vec![0, 4, 2, 1, 3]);
}

#[test]
fn sort_with_infinity_values() {
    let col0 = vec![
        CellValue::number(f64::INFINITY),
        n(-10.0),
        n(0.0),
        CellValue::number(f64::NEG_INFINITY),
        n(10.0),
    ];
    let data: Vec<&[CellValue]> = vec![&col0];
    let specs = vec![sort_spec(0, SortDirection::Ascending)];
    let result = compute_sort_order(&specs, &data, 5);

    // Expected order: -∞ < -10 < 0 < 10 < +∞
    // Original indices: [3, 1, 2, 4, 0]
    assert_eq!(result, vec![3, 1, 2, 4, 0]);
}

#[test]
fn sort_with_infinity_descending() {
    let col0 = vec![
        CellValue::number(f64::INFINITY),
        n(-10.0),
        n(0.0),
        CellValue::number(f64::NEG_INFINITY),
        n(10.0),
    ];
    let data: Vec<&[CellValue]> = vec![&col0];
    let specs = vec![sort_spec(0, SortDirection::Descending)];
    let result = compute_sort_order(&specs, &data, 5);

    // Expected order: +∞ > 10 > 0 > -10 > -∞
    // Original indices: [0, 4, 2, 1, 3]
    assert_eq!(result, vec![0, 4, 2, 1, 3]);
}

#[test]
fn sort_with_nan_values() {
    let col0 = vec![
        n(10.0),
        CellValue::number(f64::NAN),
        n(20.0),
        CellValue::number(f64::NAN),
        n(5.0),
    ];
    let data: Vec<&[CellValue]> = vec![&col0];
    let specs = vec![sort_spec(0, SortDirection::Ascending)];
    let result = compute_sort_order(&specs, &data, 5);

    // NaN sorts after all regular numbers
    // Expected: 5 < 10 < 20 < NaN (any order among NaNs)
    // Original indices: [4, 0, 2, ...] where ... are the two NaN positions
    assert_eq!(result[0], 4); // 5.0
    assert_eq!(result[1], 0); // 10.0
    assert_eq!(result[2], 2); // 20.0
    // result[3] and result[4] should be NaN indices (1 and 3 in some order)
    assert!(result[3] == 1 || result[3] == 3);
    assert!(result[4] == 1 || result[4] == 3);
}

#[test]
fn sort_with_nan_descending() {
    let col0 = vec![
        n(10.0),
        CellValue::number(f64::NAN),
        n(20.0),
        n(5.0),
    ];
    let data: Vec<&[CellValue]> = vec![&col0];
    let specs = vec![sort_spec(0, SortDirection::Descending)];
    let result = compute_sort_order(&specs, &data, 4);

    // NaN is treated as "sort blank" and always sorts last, regardless of direction.
    // Descending order for regular numbers: 20 > 10 > 5, then NaN last.
    // Original indices: [2, 0, 3, 1] (20, 10, 5, NaN)
    assert_eq!(result, vec![2, 0, 3, 1]);
}

#[test]
fn nan_becomes_error_sort_behavior() {
    // CellValue::number(f64::NAN) → Error(Num)
    let col0 = vec![
        n(2.0),                        // [idx 0]
        CellValue::number(f64::NAN),   // → Error(Num) [idx 1]
        n(1.0),                        // [idx 2]
        n(3.0),                        // [idx 3]
    ];
    let data: Vec<&[CellValue]> = vec![&col0];

    // Ascending: numbers first (1, 2, 3), then errors
    let specs_asc = vec![sort_spec(0, SortDirection::Ascending)];
    let result_asc = compute_sort_order(&specs_asc, &data, 4);
    assert_eq!(result_asc, vec![2, 0, 3, 1]);

    // Descending: errors before numbers (reversal), numbers desc
    let specs_desc = vec![sort_spec(0, SortDirection::Descending)];
    let result_desc = compute_sort_order(&specs_desc, &data, 4);
    // Error(1), then 3(3), 2(0), 1(2)
    assert_eq!(result_desc, vec![1, 3, 0, 2]);
}

#[test]
fn sort_mixed_infinity_nan_descending() {
    let col0 = vec![
        CellValue::number(f64::INFINITY),
        CellValue::number(f64::NAN),
        n(0.0),
        CellValue::number(f64::NEG_INFINITY),
        CellValue::number(f64::NAN),
        n(10.0),
    ];
    let data: Vec<&[CellValue]> = vec![&col0];
    let specs = vec![sort_spec(0, SortDirection::Descending)];
    let result = compute_sort_order(&specs, &data, 6);

    // Descending: +Inf > 10 > 0 > -Inf, then NaN always last (stable order)
    // Original indices: [0, 5, 2, 3, 1, 4]
    assert_eq!(result[0], 0); // +Inf
    assert_eq!(result[1], 5); // 10
    assert_eq!(result[2], 2); // 0
    assert_eq!(result[3], 3); // -Inf
    // result[4] and result[5] are NaN indices (1 and 4, stable order)
    assert_eq!(result[4], 1);
    assert_eq!(result[5], 4);
}

#[test]
fn sort_non_ascii_case_insensitive() {
    let col0 = vec![
        CellValue::Text("café".to_string()),
        CellValue::Text("CAFÉ".to_string()),
        CellValue::Text("Café".to_string()),
        CellValue::Text("apple".to_string()),
    ];
    let data: Vec<&[CellValue]> = vec![&col0];
    let specs = vec![sort_spec(0, SortDirection::Ascending)];
    let result = compute_sort_order(&specs, &data, 4);

    // "café", "CAFÉ", "Café" should be treated as equal (case-insensitive)
    // "apple" < "café" alphabetically
    // Expected order: apple, then the three café variants (stable sort preserves original order)
    assert_eq!(result[0], 3); // apple

    // The remaining three should be café variants in original order: [0, 1, 2]
    assert_eq!(result[1], 0); // café
    assert_eq!(result[2], 1); // CAFÉ
    assert_eq!(result[3], 2); // Café
}

#[test]
fn sort_mixed_infinity_nan_and_regular() {
    let col0 = vec![
        CellValue::number(f64::INFINITY),
        CellValue::number(f64::NAN),
        n(0.0),
        CellValue::number(f64::NEG_INFINITY),
        CellValue::number(f64::NAN),
        n(10.0),
    ];
    let data: Vec<&[CellValue]> = vec![&col0];
    let specs = vec![sort_spec(0, SortDirection::Ascending)];
    let result = compute_sort_order(&specs, &data, 6);

    // Expected order: -∞ < 0 < 10 < +∞ < NaN < NaN
    // Original indices: [3, 2, 5, 0, 1, 4] (NaNs may be in any order)
    assert_eq!(result[0], 3); // -∞
    assert_eq!(result[1], 2); // 0
    assert_eq!(result[2], 5); // 10
    assert_eq!(result[3], 0); // +∞
    // result[4] and result[5] are NaN indices (1 and 4)
    assert!(result[4] == 1 || result[4] == 4);
    assert!(result[5] == 1 || result[5] == 4);
}

#[test]
fn sort_with_array_and_blanks_mixed() {
    // Arrays and nulls both have type_rank 4, so they should sort as equals
    let col0 = vec![
        n(10.0),
        CellValue::from_rows(vec![vec![n(5.0)]]),
        CellValue::Text("hello".to_string()),
        CellValue::Null,
        n(5.0),
    ];
    let data: Vec<&[CellValue]> = vec![&col0];
    let specs = vec![sort_spec(0, SortDirection::Ascending)];
    let result = compute_sort_order(&specs, &data, 5);

    // Expected: numbers < text < (arrays/nulls)
    // 5 < 10 < "hello" < array < null (stable sort preserves order)
    // Original indices: [4, 0, 2, 1, 3]
    assert_eq!(result, vec![4, 0, 2, 1, 3]);
}

// =========================================================================
// Fix 1 regression tests: Array/Lambda blanks-last in descending sort
// =========================================================================

#[test]
fn sort_with_array_values_descending() {
    // BUG FIX: Arrays must sort last even in descending order.
    // Previously, is_blank only matched Null, so Arrays got direction-reversed.
    let col0 = vec![
        n(10.0),
        CellValue::from_rows(vec![vec![n(5.0)]]),
        CellValue::Text("hello".to_string()),
        CellValue::from_rows(vec![vec![n(1.0)]]),
        n(20.0),
    ];
    let data: Vec<&[CellValue]> = vec![&col0];
    let specs = vec![sort_spec(0, SortDirection::Descending)];
    let result = compute_sort_order(&specs, &data, 5);

    // Descending: text > numbers, then arrays always last (stable order)
    // "hello" > 20 > 10, then Array(row1), Array(row3) last
    assert_eq!(result, vec![2, 4, 0, 1, 3]);
}

#[test]
fn sort_custom_order_descending() {
    // Custom order with descending direction reverses the custom ordering
    let col0 = vec![
        CellValue::Text("low".to_string()),
        CellValue::Text("high".to_string()),
        CellValue::Text("medium".to_string()),
    ];
    let custom = vec![
        CellValue::Text("high".to_string()),
        CellValue::Text("medium".to_string()),
        CellValue::Text("low".to_string()),
    ];
    let data: Vec<&[CellValue]> = vec![&col0];
    let specs = vec![sort_spec_custom(0, SortDirection::Descending, custom)];
    let result = compute_sort_order(&specs, &data, 3);

    // Custom ascending would be: high(1), medium(2), low(0)
    // Descending reverses: low(0), medium(2), high(1)
    assert_eq!(result, vec![0, 2, 1]);
}

#[test]
fn sort_custom_order_with_blanks_descending() {
    // Blanks always sort last, even with custom order + descending
    let col0 = vec![
        CellValue::Null,
        CellValue::Text("high".to_string()),
        CellValue::Text("low".to_string()),
        CellValue::Null,
    ];
    let custom = vec![
        CellValue::Text("high".to_string()),
        CellValue::Text("low".to_string()),
    ];
    let data: Vec<&[CellValue]> = vec![&col0];
    let specs = vec![sort_spec_custom(0, SortDirection::Descending, custom)];
    let result = compute_sort_order(&specs, &data, 4);

    // Custom ascending: high(1), low(2) → descending: low(2), high(1)
    // Blanks always last (stable): Null(0), Null(3)
    assert_eq!(result, vec![2, 1, 0, 3]);
}

#[test]
fn sort_empty_string_vs_text_vs_blank() {
    // Empty string "" is a text value, NOT a blank. It should sort as text.
    let col0 = vec![
        CellValue::Null,
        CellValue::Text("".to_string()),
        CellValue::Text("apple".to_string()),
        CellValue::Null,
        CellValue::Text("".to_string()),
    ];
    let data: Vec<&[CellValue]> = vec![&col0];
    let specs = vec![sort_spec(0, SortDirection::Ascending)];
    let result = compute_sort_order(&specs, &data, 5);

    // Text sort ascending: "" < "" < "apple" (stable: row1 before row4)
    // Blanks always last (stable: row0 before row3)
    assert_eq!(result, vec![1, 4, 2, 0, 3]);
}

#[test]
fn sort_single_row() {
    // Edge case: single row table always returns [0]
    let col0 = vec![n(42.0)];
    let data: Vec<&[CellValue]> = vec![&col0];
    let specs = vec![sort_spec(0, SortDirection::Ascending)];
    let result = compute_sort_order(&specs, &data, 1);
    assert_eq!(result, vec![0]);

    // Also test descending
    let specs_desc = vec![sort_spec(0, SortDirection::Descending)];
    let result_desc = compute_sort_order(&specs_desc, &data, 1);
    assert_eq!(result_desc, vec![0]);
}

#[test]
fn sort_all_same_values() {
    // Stable sort verification: all identical values preserve original order
    let col0 = vec![
        CellValue::Text("same".to_string()),
        CellValue::Text("same".to_string()),
        CellValue::Text("same".to_string()),
        CellValue::Text("same".to_string()),
        CellValue::Text("same".to_string()),
    ];
    let data: Vec<&[CellValue]> = vec![&col0];

    // Ascending
    let specs = vec![sort_spec(0, SortDirection::Ascending)];
    let result = compute_sort_order(&specs, &data, 5);
    assert_eq!(result, vec![0, 1, 2, 3, 4]);

    // Descending — still preserves original order since all values are equal
    let specs_desc = vec![sort_spec(0, SortDirection::Descending)];
    let result_desc = compute_sort_order(&specs_desc, &data, 5);
    assert_eq!(result_desc, vec![0, 1, 2, 3, 4]);
}
