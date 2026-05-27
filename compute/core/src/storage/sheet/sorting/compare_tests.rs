use std::cmp::Ordering;

use domain_types::CellFormat;
use domain_types::domain::filter::{ColorPosition, SortOrder};
use value_types::{CellError, CellValue, FiniteF64};

use super::*;
use crate::storage::sheet::sorting::types::SortConfig;

#[test]
fn test_compare_nulls() {
    let config = SortConfig::default();
    assert_eq!(
        compare_cell_values(&CellValue::Null, &CellValue::Null, &config),
        Ordering::Equal
    );
}

// ===================================================================
// Test 2: compare_cell_values — null vs non-null, nulls_first=true
// ===================================================================

#[test]
fn test_compare_null_vs_value_nulls_first() {
    let config = SortConfig {
        nulls_first: true,
        ..Default::default()
    };
    assert_eq!(
        compare_cell_values(
            &CellValue::Null,
            &CellValue::Number(FiniteF64::must(1.0)),
            &config
        ),
        Ordering::Less
    );
    assert_eq!(
        compare_cell_values(
            &CellValue::Number(FiniteF64::must(1.0)),
            &CellValue::Null,
            &config
        ),
        Ordering::Greater
    );
}

// ===================================================================
// Test 3: compare_cell_values — null vs non-null, nulls_first=false
// ===================================================================

#[test]
fn test_compare_null_vs_value_nulls_last() {
    let config = SortConfig {
        nulls_first: false,
        ..Default::default()
    };
    assert_eq!(
        compare_cell_values(
            &CellValue::Null,
            &CellValue::Number(FiniteF64::must(1.0)),
            &config
        ),
        Ordering::Greater
    );
}

// ===================================================================
// Test 4: compare_cell_values — different types
// ===================================================================

#[test]
fn test_compare_different_types() {
    let config = SortConfig::default();
    // error < bool
    assert_eq!(
        compare_cell_values(
            &CellValue::Error(CellError::Na, None),
            &CellValue::Boolean(true),
            &config
        ),
        Ordering::Less
    );
    // bool < number
    assert_eq!(
        compare_cell_values(
            &CellValue::Boolean(false),
            &CellValue::Number(FiniteF64::must(1.0)),
            &config
        ),
        Ordering::Less
    );
    // number < string
    assert_eq!(
        compare_cell_values(
            &CellValue::Number(FiniteF64::must(999.0)),
            &CellValue::Text("abc".into()),
            &config
        ),
        Ordering::Less
    );
}

// ===================================================================
// Test 5: compare_cell_values — same type, numbers
// ===================================================================

#[test]
fn test_compare_numbers() {
    let config = SortConfig::default();
    assert_eq!(
        compare_cell_values(
            &CellValue::Number(FiniteF64::must(1.0)),
            &CellValue::Number(FiniteF64::must(2.0)),
            &config
        ),
        Ordering::Less
    );
    assert_eq!(
        compare_cell_values(
            &CellValue::Number(FiniteF64::must(2.0)),
            &CellValue::Number(FiniteF64::must(2.0)),
            &config
        ),
        Ordering::Equal
    );
    assert_eq!(
        compare_cell_values(
            &CellValue::Number(FiniteF64::must(3.0)),
            &CellValue::Number(FiniteF64::must(2.0)),
            &config
        ),
        Ordering::Greater
    );
}

// ===================================================================
// Test 6: compare_cell_values — same type, booleans
// ===================================================================

#[test]
fn test_compare_booleans() {
    let config = SortConfig::default();
    assert_eq!(
        compare_cell_values(
            &CellValue::Boolean(false),
            &CellValue::Boolean(true),
            &config
        ),
        Ordering::Less
    );
    assert_eq!(
        compare_cell_values(
            &CellValue::Boolean(true),
            &CellValue::Boolean(true),
            &config
        ),
        Ordering::Equal
    );
}

// ===================================================================
// Test 7: compare_cell_values — same type, strings
// ===================================================================

#[test]
fn test_compare_strings_natural() {
    let config = SortConfig::default();
    assert_eq!(
        compare_cell_values(
            &CellValue::Text("abc".into()),
            &CellValue::Text("def".into()),
            &config
        ),
        Ordering::Less
    );
    assert_eq!(
        compare_cell_values(
            &CellValue::Text("abc".into()),
            &CellValue::Text("ABC".into()),
            &config
        ),
        Ordering::Equal
    );
}

// ===================================================================
// Test 8: compare_cell_values — descending reverses
// ===================================================================

#[test]
fn test_compare_descending() {
    let config = SortConfig {
        order: Some(SortOrder::Desc),
        ..Default::default()
    };
    assert_eq!(
        compare_cell_values(
            &CellValue::Number(FiniteF64::must(1.0)),
            &CellValue::Number(FiniteF64::must(2.0)),
            &config
        ),
        Ordering::Greater
    );
}

// ===================================================================
// Test 9: compare_cell_values — order=none returns Equal
// ===================================================================

#[test]
fn test_compare_order_none() {
    let config = SortConfig {
        order: None,
        ..Default::default()
    };
    assert_eq!(
        compare_cell_values(
            &CellValue::Number(FiniteF64::must(1.0)),
            &CellValue::Number(FiniteF64::must(2.0)),
            &config
        ),
        Ordering::Equal
    );
}

// ===================================================================
// Test 10: compare_cell_values — errors compared by string
// ===================================================================

#[test]
fn test_compare_errors() {
    let config = SortConfig::default();
    let result = compare_cell_values(
        &CellValue::Error(CellError::Div0, None),
        &CellValue::Error(CellError::Na, None),
        &config,
    );
    // "#DIV/0!" < "#N/A" lexicographically
    assert_eq!(result, Ordering::Less);
}

// ===================================================================
// Test 11: natural_compare — mixed numeric/alpha
// ===================================================================

#[test]
fn test_natural_compare_basic() {
    assert_eq!(natural_compare("Item 2", "Item 10", false), Ordering::Less);
    assert_eq!(
        natural_compare("Item 10", "Item 10", false),
        Ordering::Equal
    );
    assert_eq!(
        natural_compare("Item 20", "Item 10", false),
        Ordering::Greater
    );
}

// ===================================================================
// Test 12: natural_compare — case sensitivity
// ===================================================================

#[test]
fn test_natural_compare_case_sensitive() {
    // Case insensitive: "abc" == "ABC"
    assert_eq!(natural_compare("abc", "ABC", false), Ordering::Equal);
    // Case sensitive: 'A'(65) < 'a'(97)
    assert_eq!(natural_compare("ABC", "abc", true), Ordering::Less);
}

// ===================================================================
// Test 13: natural_compare — pure numeric
// ===================================================================

#[test]
fn test_natural_compare_pure_numeric() {
    assert_eq!(natural_compare("2", "10", false), Ordering::Less);
    assert_eq!(natural_compare("100", "20", false), Ordering::Greater);
}

// ===================================================================
// Test 14: get_type_priority — all types
// ===================================================================

#[test]
fn test_get_type_priority() {
    assert_eq!(get_type_priority(&CellValue::Null), 0);
    assert_eq!(get_type_priority(&CellValue::Error(CellError::Na, None)), 1);
    assert_eq!(get_type_priority(&CellValue::Boolean(false)), 2);
    assert_eq!(
        get_type_priority(&CellValue::Number(FiniteF64::must(0.0))),
        3
    );
    assert_eq!(get_type_priority(&CellValue::Text("x".into())), 4);
}

// ===================================================================
// Test 15: compute_sorted_row_order — single criterion, ascending
// ===================================================================

#[test]
fn test_natural_compare_no_numbers() {
    assert_eq!(natural_compare("apple", "banana", false), Ordering::Less);
    assert_eq!(natural_compare("banana", "apple", false), Ordering::Greater);
    assert_eq!(natural_compare("apple", "apple", false), Ordering::Equal);
}

// ===================================================================
// Test 30: sort with strings and natural sort
// ===================================================================

#[test]
fn test_compare_desc_reverses_type_priority() {
    let config = SortConfig {
        order: Some(SortOrder::Desc),
        ..Default::default()
    };
    // In desc mode, string should come before number (reversed priority)
    assert_eq!(
        compare_cell_values(
            &CellValue::Text("abc".into()),
            &CellValue::Number(FiniteF64::must(1.0)),
            &config,
        ),
        Ordering::Less
    );
}

// ===================================================================
// Test 32: split_natural_chunks helper
// ===================================================================

#[test]
fn test_split_natural_chunks() {
    let chunks = split_natural_chunks("Item 10 foo");
    assert_eq!(chunks, vec!["Item ", "10", " foo"]);

    let chunks2 = split_natural_chunks("abc");
    assert_eq!(chunks2, vec!["abc"]);

    let chunks3 = split_natural_chunks("123");
    assert_eq!(chunks3, vec!["123"]);

    let chunks4 = split_natural_chunks("");
    assert!(chunks4.is_empty());
}

#[test]
fn test_compare_by_custom_list_keeps_list_members_first() {
    let config = SortConfig::default();
    let list = vec![
        CellValue::Text("High".into()),
        CellValue::Text("Low".into()),
    ];

    assert_eq!(
        compare_by_custom_list(
            &CellValue::Text("Low".into()),
            &CellValue::Text("Other".into()),
            &list,
            &config,
        ),
        Ordering::Less
    );
}

#[test]
fn test_compare_by_color_matches_case_insensitively() {
    let config = SortConfig::default();
    let matched = CellFormat {
        background_color: Some("#ff0000".to_string()),
        ..Default::default()
    };
    let other = CellFormat::default();

    assert_eq!(
        compare_by_color(
            &matched,
            &other,
            "#FF0000",
            false,
            ColorPosition::Top,
            &config
        ),
        Ordering::Less
    );
}
