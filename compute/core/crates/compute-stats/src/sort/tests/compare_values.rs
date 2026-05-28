use std::cmp::Ordering;

use value_types::{CellError, CellValue};

use super::super::{SortConfig, compare_cell_values};

#[test]
fn blanks_always_sort_last_ascending() {
    let config = SortConfig::asc();

    assert_eq!(
        compare_cell_values(&CellValue::Null, &CellValue::number(1.0), &config),
        Ordering::Greater
    );
    assert_eq!(
        compare_cell_values(&CellValue::number(1.0), &CellValue::Null, &config),
        Ordering::Less
    );
    assert_eq!(
        compare_cell_values(&CellValue::Null, &CellValue::Null, &config),
        Ordering::Equal
    );
}

#[test]
fn blanks_always_sort_last_descending() {
    let config = SortConfig::desc();

    assert_eq!(
        compare_cell_values(&CellValue::Null, &CellValue::number(1.0), &config),
        Ordering::Greater
    );
    assert_eq!(
        compare_cell_values(&CellValue::number(1.0), &CellValue::Null, &config),
        Ordering::Less
    );
}

#[test]
fn empty_text_is_blank_sorts_last() {
    let config = SortConfig::asc();

    assert_eq!(
        compare_cell_values(
            &CellValue::Text("".into()),
            &CellValue::number(1.0),
            &config
        ),
        Ordering::Greater
    );
}

#[test]
fn whitespace_only_text_is_blank_sorts_last() {
    let config = SortConfig::asc();

    assert_eq!(
        compare_cell_values(
            &CellValue::Text("  ".into()),
            &CellValue::number(1.0),
            &config
        ),
        Ordering::Greater
    );
    assert_eq!(
        compare_cell_values(
            &CellValue::Text("\t\n".into()),
            &CellValue::Boolean(false),
            &config
        ),
        Ordering::Greater
    );
}

#[test]
fn whitespace_only_text_is_blank_sorts_last_descending() {
    let config = SortConfig::desc();

    assert_eq!(
        compare_cell_values(
            &CellValue::Text("  ".into()),
            &CellValue::number(1.0),
            &config
        ),
        Ordering::Greater
    );
}

#[test]
fn compares_numbers_correctly() {
    let config = SortConfig::asc();

    assert_eq!(
        compare_cell_values(&CellValue::number(1.0), &CellValue::number(2.0), &config),
        Ordering::Less
    );
    assert_eq!(
        compare_cell_values(&CellValue::number(2.0), &CellValue::number(1.0), &config),
        Ordering::Greater
    );
    assert_eq!(
        compare_cell_values(&CellValue::number(5.0), &CellValue::number(5.0), &config),
        Ordering::Equal
    );
}

#[test]
fn compares_strings_case_insensitive_by_default() {
    let config = SortConfig::asc();

    assert_eq!(
        compare_cell_values(
            &CellValue::Text("apple".into()),
            &CellValue::Text("Banana".into()),
            &config
        ),
        Ordering::Less
    );
    assert_eq!(
        compare_cell_values(
            &CellValue::Text("APPLE".into()),
            &CellValue::Text("apple".into()),
            &config
        ),
        Ordering::Equal
    );
}

#[test]
fn compares_strings_case_sensitive_when_configured() {
    let config = SortConfig {
        case_sensitive: true,
        natural_sort: false,
        ..SortConfig::asc()
    };

    assert_eq!(
        compare_cell_values(
            &CellValue::Text("Apple".into()),
            &CellValue::Text("apple".into()),
            &config
        ),
        Ordering::Less
    );
}

#[test]
fn reverses_order_for_desc() {
    let config = SortConfig::desc();

    assert_eq!(
        compare_cell_values(&CellValue::number(1.0), &CellValue::number(2.0), &config),
        Ordering::Greater
    );
    assert_eq!(
        compare_cell_values(
            &CellValue::Text("apple".into()),
            &CellValue::Text("banana".into()),
            &config
        ),
        Ordering::Greater
    );
}

#[test]
fn handles_booleans() {
    let config = SortConfig::asc();

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
            &CellValue::Boolean(false),
            &config
        ),
        Ordering::Greater
    );
}

#[test]
fn handles_errors() {
    let config = SortConfig::asc();
    let div0 = CellValue::Error(CellError::Div0, None);
    let value = CellValue::Error(CellError::Value, None);

    assert_eq!(compare_cell_values(&div0, &value, &config), Ordering::Less);
}

#[test]
fn type_priority_ascending() {
    let config = SortConfig::asc();
    let values = [
        CellValue::number(999.0),
        CellValue::Text("zzz".into()),
        CellValue::Boolean(true),
        CellValue::Error(CellError::Na, None),
        CellValue::Null,
    ];

    for window in values.windows(2) {
        assert_eq!(
            compare_cell_values(&window[0], &window[1], &config),
            Ordering::Less
        );
    }
    assert_eq!(
        compare_cell_values(&CellValue::Null, &CellValue::Null, &config),
        Ordering::Equal
    );
}

#[test]
fn type_priority_stable_in_descending() {
    let config = SortConfig::desc();
    let values = [
        CellValue::number(999.0),
        CellValue::Text("zzz".into()),
        CellValue::Boolean(true),
        CellValue::Error(CellError::Na, None),
        CellValue::Null,
    ];

    for window in values.windows(2) {
        assert_eq!(
            compare_cell_values(&window[0], &window[1], &config),
            Ordering::Less
        );
    }
}
