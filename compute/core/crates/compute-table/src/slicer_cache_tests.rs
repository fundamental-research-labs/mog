use super::*;
use crate::slicer::{create_slicer, select_slicer_values};
use crate::types::{SlicerSortOrder, SlicerSourceType};
use value_types::{CellError, CellValue, FiniteF64};

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

fn make_slicer() -> Slicer {
    create_slicer("s1", "Region", SlicerSourceType::Table, "table1", "col1")
}

fn make_slicer_with_sort(sort_order: SlicerSortOrder) -> Slicer {
    let mut s = make_slicer();
    s.sort_order = sort_order;
    s
}

fn cv_str(s: &str) -> CellValue {
    CellValue::Text(s.to_string())
}

fn cv_num(n: f64) -> CellValue {
    CellValue::Number(FiniteF64::must(n))
}

// -----------------------------------------------------------------------
// basic cache building
// -----------------------------------------------------------------------

#[test]
fn builds_cache_from_column_data() {
    let slicer = make_slicer();
    let data = vec![
        cv_str("East"),
        cv_str("West"),
        cv_str("East"),
        cv_str("North"),
        cv_str("West"),
        cv_str("East"),
    ];
    let cache = build_slicer_cache(&slicer, &data, None);
    assert_eq!(cache.total_count, 3);
    assert_eq!(cache.items.len(), 3);
}

#[test]
fn counts_occurrences() {
    let slicer = make_slicer_with_sort(SlicerSortOrder::DataSourceOrder);
    let data = vec![
        cv_str("East"),
        cv_str("West"),
        cv_str("East"),
        cv_str("North"),
        cv_str("West"),
        cv_str("East"),
    ];
    let cache = build_slicer_cache(&slicer, &data, None);

    let east = cache.items.iter().find(|i| i.display_text == "East").unwrap();
    let west = cache.items.iter().find(|i| i.display_text == "West").unwrap();
    let north = cache.items.iter().find(|i| i.display_text == "North").unwrap();

    assert_eq!(east.count, 3);
    assert_eq!(west.count, 2);
    assert_eq!(north.count, 1);
}

// -----------------------------------------------------------------------
// selected state
// -----------------------------------------------------------------------

#[test]
fn all_selected_when_no_selection() {
    let slicer = make_slicer();
    let cache = build_slicer_cache(&slicer, &[cv_str("East"), cv_str("West")], None);
    assert!(cache.items.iter().all(|i| i.selected));
}

#[test]
fn marks_only_selected_values() {
    let slicer = make_slicer();
    let slicer = select_slicer_values(&slicer, &[cv_str("East")]);
    let cache = build_slicer_cache(
        &slicer,
        &[cv_str("East"), cv_str("West"), cv_str("East")],
        None,
    );

    let east = cache.items.iter().find(|i| i.display_text == "East").unwrap();
    let west = cache.items.iter().find(|i| i.display_text == "West").unwrap();

    assert!(east.selected);
    assert!(!west.selected);
}

// -----------------------------------------------------------------------
// hasData with rowVisibility
// -----------------------------------------------------------------------

#[test]
fn has_data_true_when_no_visibility() {
    let slicer = make_slicer();
    let cache = build_slicer_cache(&slicer, &[cv_str("East"), cv_str("West")], None);
    assert!(cache.items.iter().all(|i| i.has_data));
}

#[test]
fn has_data_false_when_all_rows_hidden() {
    let mut slicer = make_slicer();
    slicer.sort_order = SlicerSortOrder::DataSourceOrder;
    slicer.show_items_with_no_data = true;

    let data = vec![cv_str("East"), cv_str("West"), cv_str("East")];
    let visibility: Vec<u8> = vec![1, 0, 0];
    let cache = build_slicer_cache(&slicer, &data, Some(&visibility));

    let east = cache.items.iter().find(|i| i.display_text == "East").unwrap();
    let west = cache.items.iter().find(|i| i.display_text == "West").unwrap();

    assert!(east.has_data); // appears at row 0 (visible)
    assert!(!west.has_data); // appears only at row 1 (hidden)
}

#[test]
fn all_rows_visible() {
    let slicer = make_slicer();
    let data = vec![cv_str("East"), cv_str("West")];
    let visibility: Vec<u8> = vec![1, 1];
    let cache = build_slicer_cache(&slicer, &data, Some(&visibility));
    assert!(cache.items.iter().all(|i| i.has_data));
}

// -----------------------------------------------------------------------
// sort order
// -----------------------------------------------------------------------

#[test]
fn sorts_ascending_by_default() {
    let slicer = make_slicer_with_sort(SlicerSortOrder::Ascending);
    let cache = build_slicer_cache(
        &slicer,
        &[cv_str("West"), cv_str("East"), cv_str("North")],
        None,
    );
    let values: Vec<String> = cache.items.iter().map(|i| i.display_text.clone()).collect();
    assert_eq!(values, vec!["East", "North", "West"]);
}

#[test]
fn sorts_descending() {
    let slicer = make_slicer_with_sort(SlicerSortOrder::Descending);
    let cache = build_slicer_cache(
        &slicer,
        &[cv_str("West"), cv_str("East"), cv_str("North")],
        None,
    );
    let values: Vec<String> = cache.items.iter().map(|i| i.display_text.clone()).collect();
    assert_eq!(values, vec!["West", "North", "East"]);
}

#[test]
fn preserves_data_source_order() {
    let slicer = make_slicer_with_sort(SlicerSortOrder::DataSourceOrder);
    let cache = build_slicer_cache(
        &slicer,
        &[
            cv_str("West"),
            cv_str("East"),
            cv_str("North"),
            cv_str("East"),
        ],
        None,
    );
    let values: Vec<String> = cache.items.iter().map(|i| i.display_text.clone()).collect();
    assert_eq!(values, vec!["West", "East", "North"]);
}

#[test]
fn sorts_numbers_before_strings() {
    let slicer = make_slicer_with_sort(SlicerSortOrder::Ascending);
    let cache = build_slicer_cache(
        &slicer,
        &[cv_str("beta"), cv_num(10.0), cv_str("alpha"), cv_num(5.0)],
        None,
    );
    let values: Vec<CellValue> = cache.items.iter().map(|i| i.value.clone()).collect();
    assert_eq!(values.len(), 4);
    // 5, 10, alpha, beta
    assert!(matches!(&values[0], CellValue::Number(n) if n.0 == 5.0));
    assert!(matches!(&values[1], CellValue::Number(n) if n.0 == 10.0));
    assert!(matches!(&values[2], CellValue::Text(s) if s == "alpha"));
    assert!(matches!(&values[3], CellValue::Text(s) if s == "beta"));
}

#[test]
fn descending_preserves_type_grouping() {
    let slicer = make_slicer_with_sort(SlicerSortOrder::Descending);
    let cache = build_slicer_cache(
        &slicer,
        &[cv_str("beta"), cv_num(10.0), cv_str("alpha"), cv_num(5.0)],
        None,
    );
    let values: Vec<CellValue> = cache.items.iter().map(|i| i.value.clone()).collect();
    // Descending: 10, 5, beta, alpha
    assert!(matches!(&values[0], CellValue::Number(n) if n.0 == 10.0));
    assert!(matches!(&values[1], CellValue::Number(n) if n.0 == 5.0));
    assert!(matches!(&values[2], CellValue::Text(s) if s == "beta"));
    assert!(matches!(&values[3], CellValue::Text(s) if s == "alpha"));
}

#[test]
fn nan_sorts_last_within_numbers_descending() {
    let slicer = make_slicer_with_sort(SlicerSortOrder::Descending);
    let cache = build_slicer_cache(
        &slicer,
        &[
            CellValue::number(f64::NAN),
            cv_num(10.0),
            cv_num(5.0),
            CellValue::number(f64::NAN),
        ],
        None,
    );
    let values: Vec<CellValue> = cache.items.iter().map(|i| i.value.clone()).collect();
    // NaN deduped to one, descending: 10, 5, NaN
    assert_eq!(values.len(), 3);
    assert!(matches!(&values[0], CellValue::Number(n) if n.0 == 10.0));
    assert!(matches!(&values[1], CellValue::Number(n) if n.0 == 5.0));
    assert!(matches!(&values[2], CellValue::Error(CellError::Num, _)));
}

// -----------------------------------------------------------------------
// case-insensitive string dedup
// -----------------------------------------------------------------------

#[test]
fn deduplicates_strings_case_insensitively() {
    let slicer = make_slicer_with_sort(SlicerSortOrder::Ascending);
    let cache = build_slicer_cache(
        &slicer,
        &[
            cv_str("Hello"),
            cv_str("hello"),
            cv_str("HELLO"),
            cv_str("World"),
        ],
        None,
    );
    assert_eq!(cache.items.len(), 2);
    assert_eq!(cache.items[0].count, 3); // Hello/hello/HELLO
    assert_eq!(cache.items[1].count, 1); // World
}

// -----------------------------------------------------------------------
// blanks handling
// -----------------------------------------------------------------------

#[test]
fn handles_null_values() {
    let slicer = make_slicer_with_sort(SlicerSortOrder::Ascending);
    let cache = build_slicer_cache(
        &slicer,
        &[cv_str("East"), CellValue::Null, cv_str("West"), CellValue::Null],
        None,
    );

    let blank_item = cache.items.iter().find(|i| matches!(i.value, CellValue::Null));
    assert!(blank_item.is_some());
    let blank_item = blank_item.unwrap();
    assert_eq!(blank_item.display_text, "(Blank)");
    assert_eq!(blank_item.count, 2);
}

#[test]
fn blanks_sort_last() {
    let slicer = make_slicer_with_sort(SlicerSortOrder::Ascending);
    let cache = build_slicer_cache(
        &slicer,
        &[CellValue::Null, cv_str("Alpha"), cv_str("Bravo")],
        None,
    );
    let last = cache.items.last().unwrap();
    assert!(matches!(last.value, CellValue::Null));
}

#[test]
fn blanks_sort_last_descending() {
    let slicer = make_slicer_with_sort(SlicerSortOrder::Descending);
    let cache = build_slicer_cache(
        &slicer,
        &[CellValue::Null, cv_str("Alpha"), cv_str("Bravo")],
        None,
    );
    let last = cache.items.last().unwrap();
    assert!(matches!(last.value, CellValue::Null));
}

// -----------------------------------------------------------------------
// showItemsWithNoData
// -----------------------------------------------------------------------

#[test]
fn excludes_no_data_items_when_false() {
    let mut slicer = make_slicer();
    slicer.show_items_with_no_data = false;
    slicer.sort_order = SlicerSortOrder::DataSourceOrder;

    let data = vec![
        cv_str("East"),
        cv_str("West"),
        cv_str("East"),
        cv_str("North"),
    ];
    let visibility: Vec<u8> = vec![1, 0, 1, 0];
    let cache = build_slicer_cache(&slicer, &data, Some(&visibility));

    assert_eq!(cache.items.len(), 1);
    assert_eq!(cache.items[0].display_text, "East");
    assert_eq!(cache.total_count, 1);
}

#[test]
fn includes_no_data_items_when_true() {
    let mut slicer = make_slicer();
    slicer.show_items_with_no_data = true;
    slicer.sort_order = SlicerSortOrder::DataSourceOrder;

    let data = vec![
        cv_str("East"),
        cv_str("West"),
        cv_str("East"),
        cv_str("North"),
    ];
    let visibility: Vec<u8> = vec![1, 0, 1, 0];
    let cache = build_slicer_cache(&slicer, &data, Some(&visibility));

    assert_eq!(cache.items.len(), 3);
    let values: Vec<String> = cache.items.iter().map(|i| i.display_text.clone()).collect();
    assert_eq!(values, vec!["East", "West", "North"]);

    let east = cache.items.iter().find(|i| i.display_text == "East").unwrap();
    let west = cache.items.iter().find(|i| i.display_text == "West").unwrap();
    let north = cache.items.iter().find(|i| i.display_text == "North").unwrap();
    assert!(east.has_data);
    assert!(!west.has_data);
    assert!(!north.has_data);
}

#[test]
fn keeps_all_items_without_visibility_bitmap() {
    let mut slicer = make_slicer();
    slicer.show_items_with_no_data = false;
    slicer.sort_order = SlicerSortOrder::DataSourceOrder;

    let data = vec![cv_str("East"), cv_str("West"), cv_str("North")];
    let cache = build_slicer_cache(&slicer, &data, None);

    assert_eq!(cache.items.len(), 3);
}

// -----------------------------------------------------------------------
// display text formatting
// -----------------------------------------------------------------------

#[test]
fn formats_booleans() {
    let mut slicer = make_slicer();
    slicer.sort_order = SlicerSortOrder::DataSourceOrder;

    let cache = build_slicer_cache(
        &slicer,
        &[CellValue::Boolean(true), CellValue::Boolean(false)],
        None,
    );

    let true_item = cache
        .items
        .iter()
        .find(|i| matches!(i.value, CellValue::Boolean(true)))
        .unwrap();
    let false_item = cache
        .items
        .iter()
        .find(|i| matches!(i.value, CellValue::Boolean(false)))
        .unwrap();
    assert_eq!(true_item.display_text, "TRUE");
    assert_eq!(false_item.display_text, "FALSE");
}

// -----------------------------------------------------------------------
// error values
// -----------------------------------------------------------------------

#[test]
fn error_values_in_cache() {
    let mut slicer = make_slicer();
    slicer.sort_order = SlicerSortOrder::DataSourceOrder;

    let err_na = CellValue::Error(CellError::Na, None);
    let err_ref = CellValue::Error(CellError::Ref, None);
    let data = vec![
        err_na.clone(),
        cv_str("Valid"),
        err_na.clone(),
        err_ref.clone(),
    ];
    let cache = build_slicer_cache(&slicer, &data, None);

    assert_eq!(cache.items.len(), 3);

    let na_item = cache.items.iter().find(|i| i.display_text == "#N/A");
    let ref_item = cache.items.iter().find(|i| i.display_text == "#REF!");
    let valid_item = cache.items.iter().find(|i| i.display_text == "Valid");

    assert!(na_item.is_some());
    assert_eq!(na_item.unwrap().count, 2);
    assert!(ref_item.is_some());
    assert_eq!(ref_item.unwrap().count, 1);
    assert!(valid_item.is_some());
    assert_eq!(valid_item.unwrap().count, 1);
}

// -----------------------------------------------------------------------
// empty column data
// -----------------------------------------------------------------------

#[test]
fn test_build_cache_empty_data() {
    let slicer = make_slicer();
    let data: Vec<CellValue> = vec![];
    let cache = build_slicer_cache(&slicer, &data, None);

    assert_eq!(cache.items.len(), 0);
    assert_eq!(cache.total_count, 0);
    assert_eq!(cache.selected_count, 0);
}

// -----------------------------------------------------------------------
// all identical values
// -----------------------------------------------------------------------

#[test]
fn test_build_cache_all_identical() {
    let slicer = make_slicer_with_sort(SlicerSortOrder::DataSourceOrder);
    let data = vec![
        cv_str("Same"),
        cv_str("Same"),
        cv_str("Same"),
        cv_str("Same"),
        cv_str("Same"),
    ];
    let cache = build_slicer_cache(&slicer, &data, None);

    // All identical values should be deduped into a single item
    assert_eq!(cache.items.len(), 1);
    assert_eq!(cache.total_count, 1);
    assert_eq!(cache.items[0].count, 5);
    assert_eq!(cache.items[0].display_text, "Same");
    assert!(cache.items[0].has_data);
    // No selection means all are selected
    assert!(cache.items[0].selected);
    assert_eq!(cache.selected_count, 1);
}
