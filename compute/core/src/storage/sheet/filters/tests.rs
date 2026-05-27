use super::bridge::column_filter_to_table_criteria;
use super::evaluation::cell_value_dedup_key;
use super::*;
use crate::storage::YrsStorage;
use cell_types::SheetId;
use std::collections::HashMap;
use value_types::{CellValue, FiniteF64};

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

fn make_sheet_id(n: u128) -> SheetId {
    SheetId::from_raw(n)
}

/// Create a YrsStorage with one sheet and return (storage, sheet_id).
fn storage_with_sheet() -> (YrsStorage, SheetId) {
    let mut storage = YrsStorage::new();
    let mut mirror = crate::mirror::CellMirror::new();
    let sheet_id = make_sheet_id(1);
    storage
        .add_sheet(&mut mirror, sheet_id, "Sheet1", 100, 26)
        .expect("add_sheet should succeed");
    (storage, sheet_id)
}

/// Default-format cell-format closure for tests that don't care about
/// color filters (the only criterion that consults format data).
fn test_get_cell_format(_row: u32, _col: u32) -> domain_types::CellFormat {
    domain_types::CellFormat::default()
}

// -------------------------------------------------------------------
// Test 1: Create filter and retrieve
// -------------------------------------------------------------------

#[test]
fn test_create_filter_and_retrieve() {
    let (storage, sheet_id) = storage_with_sheet();

    let filter = create_filter(
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        "header-start-id",
        "header-end-id",
        "data-end-id",
        FilterKind::AutoFilter,
        None,
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .expect("create_filter should succeed");

    assert!(!filter.id.is_empty());
    assert_eq!(filter.filter_kind, FilterKind::AutoFilter);
    assert_eq!(filter.header_start_cell_id, "header-start-id");
    assert_eq!(filter.header_end_cell_id, "header-end-id");
    assert_eq!(filter.data_end_cell_id, "data-end-id");
    assert!(filter.column_filters.is_empty());
    assert!(filter.sort_state.is_none());
    assert!(filter.table_id.is_none());
    assert!(filter.created_at.is_some());
    assert!(filter.updated_at.is_some());

    // Retrieve by ID
    let fetched = get_filter(storage.doc(), storage.sheets(), &sheet_id, &filter.id);
    assert!(fetched.is_some());
    assert_eq!(fetched.unwrap().id, filter.id);
}

// -------------------------------------------------------------------
// Test 2: Create filter with table ID
// -------------------------------------------------------------------

#[test]
fn test_create_filter_with_table_id() {
    let (storage, sheet_id) = storage_with_sheet();

    let filter = create_filter(
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        "h-start",
        "h-end",
        "d-end",
        FilterKind::TableFilter,
        Some("table-1".to_string()),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .expect("create_filter should succeed");

    assert_eq!(filter.filter_kind, FilterKind::TableFilter);
    assert_eq!(filter.table_id, Some("table-1".to_string()));

    // Look up by table ID
    let table_filter = get_table_filter(storage.doc(), storage.sheets(), &sheet_id, "table-1");
    assert!(table_filter.is_some());
    assert_eq!(table_filter.unwrap().id, filter.id);
}

// -------------------------------------------------------------------
// Test 3: Get all filters in sheet
// -------------------------------------------------------------------

#[test]
fn test_get_filters_in_sheet() {
    let (storage, sheet_id) = storage_with_sheet();

    create_filter(
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        "a",
        "b",
        "c",
        FilterKind::AutoFilter,
        None,
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    create_filter(
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        "d",
        "e",
        "f",
        FilterKind::AutoFilter,
        None,
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    create_filter(
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        "g",
        "h",
        "i",
        FilterKind::TableFilter,
        Some("t1".into()),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    let filters = get_filters_in_sheet(storage.doc(), storage.sheets(), &sheet_id);
    assert_eq!(filters.len(), 3);
    assert_eq!(
        get_filter_count(storage.doc(), storage.sheets(), &sheet_id),
        3
    );
}

// -------------------------------------------------------------------
// Test 4: Set column filter
// -------------------------------------------------------------------

#[test]
fn test_set_column_filter() {
    let (storage, sheet_id) = storage_with_sheet();

    let filter = create_filter(
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        "a",
        "b",
        "c",
        FilterKind::AutoFilter,
        None,
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    let criteria = ColumnFilter::Values {
        values: vec![
            serde_json::Value::String("Apple".to_string()),
            serde_json::Value::String("Banana".to_string()),
        ],
        include_blanks: false,
    };

    set_column_filter(
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        &filter.id,
        "col-header-1",
        criteria.clone(),
    );

    // Verify the filter was updated
    let updated = get_filter(storage.doc(), storage.sheets(), &sheet_id, &filter.id).unwrap();
    assert_eq!(updated.column_filters.len(), 1);
    assert!(matches!(
        updated.column_filters["col-header-1"],
        ColumnFilter::Values { .. }
    ));
    assert!(updated.updated_at >= filter.updated_at);
}

// -------------------------------------------------------------------
// Test 5: Set multiple column filters
// -------------------------------------------------------------------

#[test]
fn test_set_multiple_column_filters() {
    let (storage, sheet_id) = storage_with_sheet();

    let filter = create_filter(
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        "a",
        "b",
        "c",
        FilterKind::AutoFilter,
        None,
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    // Set criteria on two columns
    let criteria1 = ColumnFilter::Values {
        values: vec![serde_json::Value::String("A".to_string())],
        include_blanks: false,
    };
    let criteria2 = ColumnFilter::Condition {
        conditions: vec![FilterCondition {
            operator: FilterOperator::GreaterThan,
            value: Some(CellValue::number(100.0)),
            value2: None,
        }],
        logic: FilterLogic::And,
    };

    set_column_filter(
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        &filter.id,
        "col-1",
        criteria1,
    );
    set_column_filter(
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        &filter.id,
        "col-2",
        criteria2,
    );

    let updated = get_filter(storage.doc(), storage.sheets(), &sheet_id, &filter.id).unwrap();
    assert_eq!(updated.column_filters.len(), 2);
    assert!(matches!(
        updated.column_filters["col-1"],
        ColumnFilter::Values { .. }
    ));
    assert!(matches!(
        updated.column_filters["col-2"],
        ColumnFilter::Condition { .. }
    ));
}

// -------------------------------------------------------------------
// Test 6: Clear column filter
// -------------------------------------------------------------------

#[test]
fn test_clear_column_filter() {
    let (storage, sheet_id) = storage_with_sheet();

    let filter = create_filter(
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        "a",
        "b",
        "c",
        FilterKind::AutoFilter,
        None,
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    let criteria = ColumnFilter::Values {
        values: vec![serde_json::Value::String("A".to_string())],
        include_blanks: false,
    };
    set_column_filter(
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        &filter.id,
        "col-1",
        criteria.clone(),
    );
    set_column_filter(
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        &filter.id,
        "col-2",
        criteria,
    );

    assert_eq!(
        get_filter(storage.doc(), storage.sheets(), &sheet_id, &filter.id)
            .unwrap()
            .column_filters
            .len(),
        2
    );

    // Clear one column
    clear_column_filter(
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        &filter.id,
        "col-1",
    );
    let updated = get_filter(storage.doc(), storage.sheets(), &sheet_id, &filter.id).unwrap();
    assert_eq!(updated.column_filters.len(), 1);
    assert!(updated.column_filters.contains_key("col-2"));
    assert!(!updated.column_filters.contains_key("col-1"));
}

// -------------------------------------------------------------------
// Test 7: Clear all column filters
// -------------------------------------------------------------------

#[test]
fn test_clear_all_column_filters() {
    let (storage, sheet_id) = storage_with_sheet();

    let filter = create_filter(
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        "a",
        "b",
        "c",
        FilterKind::AutoFilter,
        None,
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    let criteria = ColumnFilter::Values {
        values: vec![serde_json::Value::String("A".to_string())],
        include_blanks: false,
    };
    set_column_filter(
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        &filter.id,
        "col-1",
        criteria.clone(),
    );
    set_column_filter(
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        &filter.id,
        "col-2",
        criteria,
    );

    clear_all_column_filters(storage.doc(), storage.sheets(), &sheet_id, &filter.id);

    let updated = get_filter(storage.doc(), storage.sheets(), &sheet_id, &filter.id).unwrap();
    assert!(updated.column_filters.is_empty());
}

// -------------------------------------------------------------------
// Test 8: Delete filter
// -------------------------------------------------------------------

#[test]
fn test_delete_filter() {
    let (storage, sheet_id) = storage_with_sheet();

    let filter = create_filter(
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        "a",
        "b",
        "c",
        FilterKind::AutoFilter,
        None,
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    assert_eq!(
        get_filter_count(storage.doc(), storage.sheets(), &sheet_id),
        1
    );
    assert!(delete_filter(
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        &filter.id
    ));
    assert_eq!(
        get_filter_count(storage.doc(), storage.sheets(), &sheet_id),
        0
    );
    assert!(get_filter(storage.doc(), storage.sheets(), &sheet_id, &filter.id).is_none());

    // Deleting again returns false
    assert!(!delete_filter(
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        &filter.id
    ));
}

// -------------------------------------------------------------------
// Test 9: Clear all filters
// -------------------------------------------------------------------

#[test]
fn test_clear_all_filters() {
    let (storage, sheet_id) = storage_with_sheet();

    for i in 0..5 {
        create_filter(
            storage.doc(),
            storage.sheets(),
            &sheet_id,
            &format!("a{}", i),
            &format!("b{}", i),
            &format!("c{}", i),
            FilterKind::AutoFilter,
            None,
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
    }
    assert_eq!(
        get_filter_count(storage.doc(), storage.sheets(), &sheet_id),
        5
    );

    clear_all_filters(storage.doc(), storage.sheets(), &sheet_id);
    assert_eq!(
        get_filter_count(storage.doc(), storage.sheets(), &sheet_id),
        0
    );
}

// -------------------------------------------------------------------
// Test 10: Sort state
// -------------------------------------------------------------------

#[test]
fn test_filter_sort_state() {
    let (storage, sheet_id) = storage_with_sheet();

    let filter = create_filter(
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        "a",
        "b",
        "c",
        FilterKind::AutoFilter,
        None,
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    // Initially no sort state
    assert!(
        get_filter_sort_state(storage.doc(), storage.sheets(), &sheet_id, &filter.id).is_none()
    );

    // Set sort state
    let sort_state = FilterSortState {
        column_cell_id: "col-header-1".to_string(),
        order: SortOrder::Asc,
        sort_by: SortBy::Value,
    };
    set_filter_sort_state(
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        &filter.id,
        Some(sort_state.clone()),
    );

    let fetched_sort =
        get_filter_sort_state(storage.doc(), storage.sheets(), &sheet_id, &filter.id);
    assert!(fetched_sort.is_some());
    let fetched_sort = fetched_sort.unwrap();
    assert_eq!(fetched_sort.column_cell_id, "col-header-1");
    assert_eq!(fetched_sort.order, SortOrder::Asc);
    assert_eq!(fetched_sort.sort_by, SortBy::Value);

    // Clear sort state
    set_filter_sort_state(storage.doc(), storage.sheets(), &sheet_id, &filter.id, None);
    assert!(
        get_filter_sort_state(storage.doc(), storage.sheets(), &sheet_id, &filter.id).is_none()
    );
}

// -------------------------------------------------------------------
// Test 11: Evaluate filter - value filter
// -------------------------------------------------------------------

#[test]
fn test_evaluate_filter_value() {
    let (storage, sheet_id) = storage_with_sheet();

    let filter = create_filter(
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        "header-start",
        "header-end",
        "data-end",
        FilterKind::AutoFilter,
        None,
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    // Set value filter: only show "Apple" and "Cherry"
    let criteria = ColumnFilter::Values {
        values: vec![
            serde_json::Value::String("Apple".to_string()),
            serde_json::Value::String("Cherry".to_string()),
        ],
        include_blanks: false,
    };
    set_column_filter(
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        &filter.id,
        "col-header-0",
        criteria,
    );

    // Mock data: header at (0,0), data at rows 1-4, col 0
    // Row 1: "Apple", Row 2: "Banana", Row 3: "Cherry", Row 4: "Date"
    let get_cell_value = |row: u32, _col: u32| -> CellValue {
        match row {
            1 => CellValue::Text("Apple".into()),
            2 => CellValue::Text("Banana".into()),
            3 => CellValue::Text("Cherry".into()),
            4 => CellValue::Text("Date".into()),
            _ => CellValue::Null,
        }
    };

    // Mock resolve: header-start -> (0, 0), header-end -> (0, 2), data-end -> (4, 0)
    let resolve = |cell_id: &str| -> Option<(u32, u32)> {
        match cell_id {
            "header-start" => Some((0, 0)),
            "header-end" => Some((0, 2)),
            "data-end" => Some((4, 0)),
            "col-header-0" => Some((0, 0)),
            _ => None,
        }
    };

    let results = evaluate_filter(
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        &filter.id,
        get_cell_value,
        test_get_cell_format,
        resolve,
    );

    assert_eq!(results.len(), 4);
    assert!(results[0].matches); // Apple - matches
    assert!(!results[1].matches); // Banana - no match
    assert!(results[2].matches); // Cherry - matches
    assert!(!results[3].matches); // Date - no match
}

// -------------------------------------------------------------------
// Test 12: Evaluate filter - condition filter (greaterThan)
// -------------------------------------------------------------------

#[test]
fn test_evaluate_filter_condition() {
    let (storage, sheet_id) = storage_with_sheet();

    let filter = create_filter(
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        "header-start",
        "header-end",
        "data-end",
        FilterKind::AutoFilter,
        None,
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    // Set condition filter: greaterThan 50
    let criteria = ColumnFilter::Condition {
        conditions: vec![FilterCondition {
            operator: FilterOperator::GreaterThan,
            value: Some(CellValue::number(50.0)),
            value2: None,
        }],
        logic: FilterLogic::And,
    };
    set_column_filter(
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        &filter.id,
        "col-header-0",
        criteria,
    );

    // Mock data: rows 1-4
    let get_cell_value = |row: u32, _col: u32| -> CellValue {
        match row {
            1 => CellValue::Number(FiniteF64::must(10.0)),
            2 => CellValue::Number(FiniteF64::must(75.0)),
            3 => CellValue::Number(FiniteF64::must(50.0)),
            4 => CellValue::Number(FiniteF64::must(100.0)),
            _ => CellValue::Null,
        }
    };

    let resolve = |cell_id: &str| -> Option<(u32, u32)> {
        match cell_id {
            "header-start" => Some((0, 0)),
            "header-end" => Some((0, 0)),
            "data-end" => Some((4, 0)),
            "col-header-0" => Some((0, 0)),
            _ => None,
        }
    };

    let results = evaluate_filter(
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        &filter.id,
        get_cell_value,
        test_get_cell_format,
        resolve,
    );

    assert_eq!(results.len(), 4);
    assert!(!results[0].matches); // 10 <= 50
    assert!(results[1].matches); // 75 > 50
    assert!(!results[2].matches); // 50 == 50 (not >)
    assert!(results[3].matches); // 100 > 50
}

// -------------------------------------------------------------------
// Test 13: Evaluate filter - multiple column AND
// -------------------------------------------------------------------

#[test]
fn test_evaluate_filter_multi_column_and() {
    let (storage, sheet_id) = storage_with_sheet();

    let filter = create_filter(
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        "header-start",
        "header-end",
        "data-end",
        FilterKind::AutoFilter,
        None,
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    // Col 0: value filter for "Apple"
    let criteria1 = ColumnFilter::Values {
        values: vec![serde_json::Value::String("Apple".to_string())],
        include_blanks: false,
    };
    // Col 1: condition filter > 50
    let criteria2 = ColumnFilter::Condition {
        conditions: vec![FilterCondition {
            operator: FilterOperator::GreaterThan,
            value: Some(CellValue::number(50.0)),
            value2: None,
        }],
        logic: FilterLogic::And,
    };

    set_column_filter(
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        &filter.id,
        "col-header-0",
        criteria1,
    );
    set_column_filter(
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        &filter.id,
        "col-header-1",
        criteria2,
    );

    // Mock data:
    // Row 1: "Apple", 75  -> matches both -> visible
    // Row 2: "Banana", 80 -> col0 fails   -> hidden
    // Row 3: "Apple", 30  -> col1 fails   -> hidden
    let get_cell_value = |row: u32, col: u32| -> CellValue {
        match (row, col) {
            (1, 0) => CellValue::Text("Apple".into()),
            (1, 1) => CellValue::Number(FiniteF64::must(75.0)),
            (2, 0) => CellValue::Text("Banana".into()),
            (2, 1) => CellValue::Number(FiniteF64::must(80.0)),
            (3, 0) => CellValue::Text("Apple".into()),
            (3, 1) => CellValue::Number(FiniteF64::must(30.0)),
            _ => CellValue::Null,
        }
    };

    let resolve = |cell_id: &str| -> Option<(u32, u32)> {
        match cell_id {
            "header-start" => Some((0, 0)),
            "header-end" => Some((0, 1)),
            "data-end" => Some((3, 0)),
            "col-header-0" => Some((0, 0)),
            "col-header-1" => Some((0, 1)),
            _ => None,
        }
    };

    let results = evaluate_filter(
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        &filter.id,
        get_cell_value,
        test_get_cell_format,
        resolve,
    );

    assert_eq!(results.len(), 3);
    assert!(results[0].matches); // Apple + 75 > 50
    assert!(!results[1].matches); // Banana (not Apple)
    assert!(!results[2].matches); // Apple but 30 <= 50
}

// -------------------------------------------------------------------
// Test 14: Evaluate with no column filters returns empty
// -------------------------------------------------------------------

#[test]
fn test_evaluate_no_filters_returns_empty() {
    let (storage, sheet_id) = storage_with_sheet();

    let filter = create_filter(
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        "a",
        "b",
        "c",
        FilterKind::AutoFilter,
        None,
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    let get_cell_value = |_: u32, _: u32| CellValue::Null;
    let resolve = |_: &str| Some((0u32, 0u32));

    let results = evaluate_filter(
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        &filter.id,
        get_cell_value,
        test_get_cell_format,
        resolve,
    );
    assert!(results.is_empty());
}

// -------------------------------------------------------------------
// Test 15: Get unique values
// -------------------------------------------------------------------

#[test]
fn test_get_unique_values() {
    let (storage, sheet_id) = storage_with_sheet();

    let filter = create_filter(
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        "header-start",
        "header-end",
        "data-end",
        FilterKind::AutoFilter,
        None,
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    // Mock data: rows 1-5
    let get_cell_value = |row: u32, _col: u32| -> CellValue {
        match row {
            1 => CellValue::Text("Apple".into()),
            2 => CellValue::Text("Banana".into()),
            3 => CellValue::Text("Apple".into()), // Duplicate
            4 => CellValue::Null,
            5 => CellValue::Text("Cherry".into()),
            _ => CellValue::Null,
        }
    };

    let resolve = |cell_id: &str| -> Option<(u32, u32)> {
        match cell_id {
            "header-start" => Some((0, 0)),
            "header-end" => Some((0, 0)),
            "data-end" => Some((5, 0)),
            "col-header-0" => Some((0, 0)),
            _ => None,
        }
    };

    let unique = get_unique_values(
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        &filter.id,
        "col-header-0",
        get_cell_value,
        resolve,
    );

    // Should be: Null, Apple, Banana, Cherry (sorted: null first, then strings)
    assert_eq!(unique.len(), 4);
    assert_eq!(unique[0], CellValue::Null);
    assert_eq!(unique[1], CellValue::Text("Apple".into()));
    assert_eq!(unique[2], CellValue::Text("Banana".into()));
    assert_eq!(unique[3], CellValue::Text("Cherry".into()));
}

// -------------------------------------------------------------------
// Test 16: Get filtered record count
// -------------------------------------------------------------------

#[test]
fn test_get_filtered_record_count() {
    let (storage, sheet_id) = storage_with_sheet();

    let filter = create_filter(
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        "header-start",
        "header-end",
        "data-end",
        FilterKind::AutoFilter,
        None,
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    let criteria = ColumnFilter::Values {
        values: vec![serde_json::Value::String("Apple".to_string())],
        include_blanks: false,
    };
    set_column_filter(
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        &filter.id,
        "col-header-0",
        criteria,
    );

    let get_cell_value = |row: u32, _col: u32| -> CellValue {
        match row {
            1 => CellValue::Text("Apple".into()),
            2 => CellValue::Text("Banana".into()),
            3 => CellValue::Text("Apple".into()),
            _ => CellValue::Null,
        }
    };

    let resolve = |cell_id: &str| -> Option<(u32, u32)> {
        match cell_id {
            "header-start" => Some((0, 0)),
            "header-end" => Some((0, 0)),
            "data-end" => Some((3, 0)),
            "col-header-0" => Some((0, 0)),
            _ => None,
        }
    };

    let count = get_filtered_record_count(
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        &filter.id,
        get_cell_value,
        test_get_cell_format,
        resolve,
    );

    assert!(count.is_some());
    let count = count.unwrap();
    assert_eq!(count.visible, 2); // Two "Apple" rows
    assert_eq!(count.total, 3);
}

// -------------------------------------------------------------------
// Test 17: Active filters and count
// -------------------------------------------------------------------

#[test]
fn test_active_filters() {
    let (storage, sheet_id) = storage_with_sheet();

    let f1 = create_filter(
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        "a",
        "b",
        "c",
        FilterKind::AutoFilter,
        None,
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    let f2 = create_filter(
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        "d",
        "e",
        "f",
        FilterKind::AutoFilter,
        None,
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    let _f3 = create_filter(
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        "g",
        "h",
        "i",
        FilterKind::AutoFilter,
        None,
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    // f1 has 2 column filters, f2 has 1
    let criteria = ColumnFilter::Values {
        values: vec![serde_json::Value::String("X".to_string())],
        include_blanks: false,
    };
    set_column_filter(
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        &f1.id,
        "col-1",
        criteria.clone(),
    );
    set_column_filter(
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        &f1.id,
        "col-2",
        criteria.clone(),
    );
    set_column_filter(
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        &f2.id,
        "col-3",
        criteria,
    );

    let active = get_active_filters(storage.doc(), storage.sheets(), &sheet_id);
    assert_eq!(active.len(), 2); // f1 and f2 have filters; f3 does not

    let count = get_active_filter_count(storage.doc(), storage.sheets(), &sheet_id);
    assert_eq!(count, 3); // 2 + 1
}

// -------------------------------------------------------------------
// Test 18: Empty sheet returns empty/zero
// -------------------------------------------------------------------

#[test]
fn test_empty_sheet_returns_empty() {
    let (storage, sheet_id) = storage_with_sheet();

    assert!(get_filter(storage.doc(), storage.sheets(), &sheet_id, "nonexistent").is_none());
    assert!(get_filters_in_sheet(storage.doc(), storage.sheets(), &sheet_id).is_empty());
    assert_eq!(
        get_filter_count(storage.doc(), storage.sheets(), &sheet_id),
        0
    );
    assert!(get_table_filter(storage.doc(), storage.sheets(), &sheet_id, "t1").is_none());
    assert!(get_active_filters(storage.doc(), storage.sheets(), &sheet_id).is_empty());
    assert_eq!(
        get_active_filter_count(storage.doc(), storage.sheets(), &sheet_id),
        0
    );
}

// -------------------------------------------------------------------
// Test 19: Nonexistent sheet
// -------------------------------------------------------------------

#[test]
fn test_nonexistent_sheet() {
    let storage = YrsStorage::new();
    let fake_sheet = make_sheet_id(999);

    assert!(get_filter(storage.doc(), storage.sheets(), &fake_sheet, "id").is_none());
    assert!(get_filters_in_sheet(storage.doc(), storage.sheets(), &fake_sheet).is_empty());
    assert_eq!(
        get_filter_count(storage.doc(), storage.sheets(), &fake_sheet),
        0
    );
}

// -------------------------------------------------------------------
// Test 20: Create filter on nonexistent sheet returns error
// -------------------------------------------------------------------

#[test]
fn test_create_filter_nonexistent_sheet() {
    let storage = YrsStorage::new();
    let fake_sheet = make_sheet_id(999);

    let result = create_filter(
        storage.doc(),
        storage.sheets(),
        &fake_sheet,
        "a",
        "b",
        "c",
        FilterKind::AutoFilter,
        None,
        &crate::storage::STORAGE_ID_ALLOC,
    );
    assert!(result.is_err());
}

// -------------------------------------------------------------------
// Test 21: Set column filter on nonexistent filter is no-op
// -------------------------------------------------------------------

#[test]
fn test_set_column_filter_nonexistent() {
    let (storage, sheet_id) = storage_with_sheet();

    let criteria = ColumnFilter::Values {
        values: vec![],
        include_blanks: false,
    };

    // Should not panic
    set_column_filter(
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        "nonexistent",
        "col-1",
        criteria,
    );
}

// -------------------------------------------------------------------
// Test 22: Clear column filter on nonexistent filter is no-op
// -------------------------------------------------------------------

#[test]
fn test_clear_column_filter_nonexistent() {
    let (storage, sheet_id) = storage_with_sheet();

    // Should not panic
    clear_column_filter(
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        "nonexistent",
        "col-1",
    );
}

// -------------------------------------------------------------------
// Test 23: FilterState serde roundtrip
// -------------------------------------------------------------------

#[test]
fn test_filter_state_serde_roundtrip() {
    let mut column_filters = HashMap::new();
    column_filters.insert(
        "col-1".to_string(),
        ColumnFilter::Values {
            values: vec![serde_json::Value::String("A".to_string())],
            include_blanks: false,
        },
    );
    column_filters.insert(
        "col-2".to_string(),
        ColumnFilter::Condition {
            conditions: vec![FilterCondition {
                operator: FilterOperator::Equals,
                value: Some(CellValue::number(42.0)),
                value2: None,
            }],
            logic: FilterLogic::And,
        },
    );

    let state = FilterState {
        id: "filter-001".to_string(),
        filter_kind: FilterKind::AutoFilter,
        header_start_cell_id: "cell-a1".to_string(),
        header_end_cell_id: "cell-c1".to_string(),
        data_end_cell_id: "cell-a10".to_string(),
        column_filters,
        advanced_filter: None,
        sort_state: Some(FilterSortState {
            column_cell_id: "col-1".to_string(),
            order: SortOrder::Asc,
            sort_by: SortBy::Value,
        }),
        table_id: Some("table-1".to_string()),
        created_at: Some(1700000000000),
        updated_at: Some(1700000001000),
        start_row: None,
        start_col: None,
        end_row: None,
        end_col: None,
    };

    let json = serde_json::to_string(&state).unwrap();
    let deserialized: FilterState = serde_json::from_str(&json).unwrap();
    assert_eq!(state, deserialized);
}

// -------------------------------------------------------------------
// Test 24: ColumnFilter serde roundtrip
// -------------------------------------------------------------------

#[test]
fn test_column_filter_serde_roundtrip() {
    let criteria = ColumnFilter::Values {
        values: vec![serde_json::json!("A")],
        include_blanks: false,
    };

    let json = serde_json::to_string(&criteria).unwrap();
    let deserialized: ColumnFilter = serde_json::from_str(&json).unwrap();
    assert_eq!(criteria, deserialized);
}

// -------------------------------------------------------------------
// Test 25: Condition filter — isBlank / isNotBlank (via compute-table delegation)
// -------------------------------------------------------------------

/// Helper: evaluate a single ColumnFilter against a slice of CellValues via compute-table.
/// Returns a Vec<bool> indicating which rows are visible.
fn eval_column_filter(criteria: &ColumnFilter, data: &[CellValue]) -> Vec<bool> {
    let table_criteria = column_filter_to_table_criteria(criteria);
    let bitmap =
        compute_table::filter::evaluate_column_filter(&table_criteria, data, None, None, None);
    bitmap.iter().map(|&b| b == 1).collect()
}

#[test]
fn test_condition_is_blank() {
    let data = vec![
        CellValue::Null,
        CellValue::Text("".into()),
        CellValue::Text("hello".into()),
    ];

    let blank_filter = ColumnFilter::Condition {
        conditions: vec![FilterCondition {
            operator: FilterOperator::IsBlank,
            value: None,
            value2: None,
        }],
        logic: FilterLogic::And,
    };
    let result = eval_column_filter(&blank_filter, &data);
    assert_eq!(result, vec![true, true, false]);

    let not_blank_filter = ColumnFilter::Condition {
        conditions: vec![FilterCondition {
            operator: FilterOperator::IsNotBlank,
            value: None,
            value2: None,
        }],
        logic: FilterLogic::And,
    };
    let result = eval_column_filter(&not_blank_filter, &data);
    assert_eq!(result, vec![false, false, true]);
}

// -------------------------------------------------------------------
// Test 26: Condition filter — contains / startsWith / endsWith (via compute-table)
// -------------------------------------------------------------------

#[test]
fn test_condition_string_operators() {
    let data = vec![CellValue::Text("Hello World".into())];

    let contains = ColumnFilter::Condition {
        conditions: vec![FilterCondition {
            operator: FilterOperator::Contains,
            value: Some(CellValue::from("world")),
            value2: None,
        }],
        logic: FilterLogic::And,
    };
    assert_eq!(eval_column_filter(&contains, &data), vec![true]);

    let not_contains = ColumnFilter::Condition {
        conditions: vec![FilterCondition {
            operator: FilterOperator::NotContains,
            value: Some(CellValue::from("xyz")),
            value2: None,
        }],
        logic: FilterLogic::And,
    };
    assert_eq!(eval_column_filter(&not_contains, &data), vec![true]);

    let starts = ColumnFilter::Condition {
        conditions: vec![FilterCondition {
            operator: FilterOperator::BeginsWith,
            value: Some(CellValue::from("hello")),
            value2: None,
        }],
        logic: FilterLogic::And,
    };
    assert_eq!(eval_column_filter(&starts, &data), vec![true]);

    let ends = ColumnFilter::Condition {
        conditions: vec![FilterCondition {
            operator: FilterOperator::EndsWith,
            value: Some(CellValue::from("world")),
            value2: None,
        }],
        logic: FilterLogic::And,
    };
    assert_eq!(eval_column_filter(&ends, &data), vec![true]);
}

// -------------------------------------------------------------------
// Test 27: Condition filter — between / notBetween (via compute-table)
// -------------------------------------------------------------------

#[test]
fn test_condition_between() {
    let data = vec![
        CellValue::Number(FiniteF64::must(50.0)),
        CellValue::Number(FiniteF64::must(75.0)),
        CellValue::Number(FiniteF64::must(150.0)),
    ];

    let between = ColumnFilter::Condition {
        conditions: vec![FilterCondition {
            operator: FilterOperator::Between,
            value: Some(CellValue::number(40.0)),
            value2: Some(CellValue::number(100.0)),
        }],
        logic: FilterLogic::And,
    };
    assert_eq!(eval_column_filter(&between, &data), vec![true, true, false]);

    let not_between = ColumnFilter::Condition {
        conditions: vec![FilterCondition {
            operator: FilterOperator::NotBetween,
            value: Some(CellValue::number(40.0)),
            value2: Some(CellValue::number(100.0)),
        }],
        logic: FilterLogic::And,
    };
    assert_eq!(
        eval_column_filter(&not_between, &data),
        vec![false, false, true]
    );
}

// -------------------------------------------------------------------
// Test 28: Value filter — case-insensitive string matching (via compute-table)
// -------------------------------------------------------------------

#[test]
fn test_value_filter_case_insensitive() {
    let data = vec![CellValue::Text("Apple".into())];

    let filter1 = ColumnFilter::Values {
        values: vec![serde_json::Value::String("apple".to_string())],
        include_blanks: false,
    };
    assert_eq!(eval_column_filter(&filter1, &data), vec![true]);

    let filter2 = ColumnFilter::Values {
        values: vec![serde_json::Value::String("APPLE".to_string())],
        include_blanks: false,
    };
    assert_eq!(eval_column_filter(&filter2, &data), vec![true]);

    let filter3 = ColumnFilter::Values {
        values: vec![serde_json::Value::String("Banana".to_string())],
        include_blanks: false,
    };
    assert_eq!(eval_column_filter(&filter3, &data), vec![false]);
}

// -------------------------------------------------------------------
// Test 29: Value filter — blank matching (via compute-table)
// -------------------------------------------------------------------

#[test]
fn test_value_filter_blanks() {
    let data = vec![CellValue::Null, CellValue::Text("".into())];

    // include_blanks: true
    let filter_with_blanks = ColumnFilter::Values {
        values: vec![serde_json::json!("Apple")],
        include_blanks: true,
    };
    let result = eval_column_filter(&filter_with_blanks, &data);
    assert_eq!(result, vec![true, true]);

    // include_blanks: false
    let filter_no_blanks = ColumnFilter::Values {
        values: vec![serde_json::json!("Apple")],
        include_blanks: false,
    };
    let result = eval_column_filter(&filter_no_blanks, &data);
    assert_eq!(result, vec![false, false]);
}

// -------------------------------------------------------------------
// Test 30: Condition filter — OR logic (via compute-table)
// -------------------------------------------------------------------

#[test]
fn test_condition_filter_or_logic() {
    let data = vec![CellValue::Number(FiniteF64::must(10.0))];

    let conditions = vec![
        FilterCondition {
            operator: FilterOperator::Equals,
            value: Some(CellValue::number(10.0)),
            value2: None,
        },
        FilterCondition {
            operator: FilterOperator::Equals,
            value: Some(CellValue::number(20.0)),
            value2: None,
        },
    ];

    // OR: 10 == 10 -> true
    let or_filter = ColumnFilter::Condition {
        conditions: conditions.clone(),
        logic: FilterLogic::Or,
    };
    assert_eq!(eval_column_filter(&or_filter, &data), vec![true]);

    // AND: 10 == 10 && 10 == 20 -> false
    let and_filter = ColumnFilter::Condition {
        conditions,
        logic: FilterLogic::And,
    };
    assert_eq!(eval_column_filter(&and_filter, &data), vec![false]);
}

// -------------------------------------------------------------------
// Test 31: FilterKind serde
// -------------------------------------------------------------------

#[test]
fn test_filter_kind_serde() {
    let json = serde_json::to_string(&FilterKind::AutoFilter).unwrap();
    assert_eq!(json, "\"autoFilter\"");

    let json = serde_json::to_string(&FilterKind::TableFilter).unwrap();
    assert_eq!(json, "\"tableFilter\"");

    let json = serde_json::to_string(&FilterKind::AdvancedFilter).unwrap();
    assert_eq!(json, "\"advancedFilter\"");

    let parsed: FilterKind = serde_json::from_str("\"autoFilter\"").unwrap();
    assert_eq!(parsed, FilterKind::AutoFilter);
}

// -------------------------------------------------------------------
// Test 32: StoredFilterState roundtrip through Yrs
// -------------------------------------------------------------------

#[test]
fn test_filter_yrs_roundtrip() {
    let (storage, sheet_id) = storage_with_sheet();

    let filter = create_filter(
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        "cell-a1",
        "cell-c1",
        "cell-a10",
        FilterKind::AutoFilter,
        None,
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    // Set criteria
    let criteria = ColumnFilter::Condition {
        conditions: vec![
            FilterCondition {
                operator: FilterOperator::GreaterThan,
                value: Some(CellValue::number(50.0)),
                value2: None,
            },
            FilterCondition {
                operator: FilterOperator::LessThan,
                value: Some(CellValue::number(200.0)),
                value2: None,
            },
        ],
        logic: FilterLogic::And,
    };
    set_column_filter(
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        &filter.id,
        "header-col-1",
        criteria,
    );

    // Set sort
    let sort_state = FilterSortState {
        column_cell_id: "header-col-1".to_string(),
        order: SortOrder::Desc,
        sort_by: SortBy::Value,
    };
    set_filter_sort_state(
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        &filter.id,
        Some(sort_state),
    );

    // Read back and verify
    let fetched = get_filter(storage.doc(), storage.sheets(), &sheet_id, &filter.id).unwrap();
    assert_eq!(fetched.header_start_cell_id, "cell-a1");
    assert_eq!(fetched.header_end_cell_id, "cell-c1");
    assert_eq!(fetched.data_end_cell_id, "cell-a10");
    assert_eq!(fetched.column_filters.len(), 1);
    let col_filter = &fetched.column_filters["header-col-1"];
    assert!(
        matches!(col_filter, ColumnFilter::Condition { conditions, logic } if conditions.len() == 2 && *logic == FilterLogic::And)
    );
    let sort = fetched.sort_state.unwrap();
    assert_eq!(sort.column_cell_id, "header-col-1");
    assert_eq!(sort.order, SortOrder::Desc);
}

// -------------------------------------------------------------------
// Test 33: Evaluate filter with deleted header returns empty
// -------------------------------------------------------------------

#[test]
fn test_evaluate_deleted_header() {
    let (storage, sheet_id) = storage_with_sheet();

    let filter = create_filter(
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        "header-start",
        "header-end",
        "data-end",
        FilterKind::AutoFilter,
        None,
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    let criteria = ColumnFilter::Values {
        values: vec![serde_json::json!("X")],
        include_blanks: false,
    };
    set_column_filter(
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        &filter.id,
        "deleted-header",
        criteria,
    );

    let get_cell_value = |_: u32, _: u32| CellValue::Null;

    // Resolve header-start but not the deleted column header
    let resolve = |cell_id: &str| -> Option<(u32, u32)> {
        match cell_id {
            "header-start" => Some((0, 0)),
            "header-end" => Some((0, 2)),
            "data-end" => Some((5, 0)),
            // "deleted-header" -> None (deleted)
            _ => None,
        }
    };

    let results = evaluate_filter(
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        &filter.id,
        get_cell_value,
        test_get_cell_format,
        resolve,
    );
    // Column header was deleted, so its bitmap is skipped.
    // Since no other bitmaps exist, result is empty.
    assert!(results.is_empty());
}

// -------------------------------------------------------------------
// Test 34: Evaluate filter with deleted range corners returns empty
// -------------------------------------------------------------------

#[test]
fn test_evaluate_deleted_range_corners() {
    let (storage, sheet_id) = storage_with_sheet();

    let filter = create_filter(
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        "header-start",
        "header-end",
        "data-end",
        FilterKind::AutoFilter,
        None,
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    let criteria = ColumnFilter::Values {
        values: vec![serde_json::json!("X")],
        include_blanks: false,
    };
    set_column_filter(
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        &filter.id,
        "col-1",
        criteria,
    );

    let get_cell_value = |_: u32, _: u32| CellValue::Null;

    // header-start can't be resolved -> filter range invalid
    let resolve = |_: &str| -> Option<(u32, u32)> { None };

    let results = evaluate_filter(
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        &filter.id,
        get_cell_value,
        test_get_cell_format,
        resolve,
    );
    assert!(results.is_empty());
}

// -------------------------------------------------------------------
// Test 35: Unique values dedup with numbers
// -------------------------------------------------------------------

#[test]
fn test_unique_values_with_numbers() {
    let (storage, sheet_id) = storage_with_sheet();

    let filter = create_filter(
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        "header-start",
        "header-end",
        "data-end",
        FilterKind::AutoFilter,
        None,
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    let get_cell_value = |row: u32, _col: u32| -> CellValue {
        match row {
            1 => CellValue::Number(FiniteF64::must(10.0)),
            2 => CellValue::Number(FiniteF64::must(20.0)),
            3 => CellValue::Number(FiniteF64::must(10.0)), // Dup
            4 => CellValue::Number(FiniteF64::must(30.0)),
            _ => CellValue::Null,
        }
    };

    let resolve = |cell_id: &str| -> Option<(u32, u32)> {
        match cell_id {
            "header-start" => Some((0, 0)),
            "header-end" => Some((0, 0)),
            "data-end" => Some((4, 0)),
            "col-0" => Some((0, 0)),
            _ => None,
        }
    };

    let unique = get_unique_values(
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        &filter.id,
        "col-0",
        get_cell_value,
        resolve,
    );

    assert_eq!(unique.len(), 3); // 10, 20, 30 (no dup)
    assert_eq!(unique[0], CellValue::Number(FiniteF64::must(10.0)));
    assert_eq!(unique[1], CellValue::Number(FiniteF64::must(20.0)));
    assert_eq!(unique[2], CellValue::Number(FiniteF64::must(30.0)));
}

// -------------------------------------------------------------------
// Test 36: Color filter criteria serde
// -------------------------------------------------------------------

#[test]
fn test_color_filter_serde() {
    let criteria = ColumnFilter::Color {
        color: "#ff0000".to_string(),
        by_font: false,
    };

    let json = serde_json::to_string(&criteria).unwrap();
    let deserialized: ColumnFilter = serde_json::from_str(&json).unwrap();
    assert_eq!(criteria, deserialized);
    if let ColumnFilter::Color { color, .. } = &deserialized {
        assert_eq!(color, "#ff0000");
    } else {
        panic!("Expected ColumnFilter::Color");
    }
}

// -------------------------------------------------------------------
// Test 37: Top/bottom filter criteria serde
// -------------------------------------------------------------------

#[test]
fn test_top_bottom_filter_serde() {
    let criteria = ColumnFilter::TopBottom {
        direction: TopBottomDirection::Top,
        count: 10.0,
        by: TopBottomBy::Items,
    };

    let json = serde_json::to_string(&criteria).unwrap();
    let deserialized: ColumnFilter = serde_json::from_str(&json).unwrap();
    assert_eq!(criteria, deserialized);
    if let ColumnFilter::TopBottom { direction, .. } = &deserialized {
        assert_eq!(*direction, TopBottomDirection::Top);
    } else {
        panic!("Expected ColumnFilter::TopBottom");
    }
}

// -------------------------------------------------------------------
// Test 38: cell_value_dedup_key uniqueness
// -------------------------------------------------------------------

#[test]
fn test_dedup_key_uniqueness() {
    // Number 1 and string "1" should have different keys
    let num_key = cell_value_dedup_key(&CellValue::Number(FiniteF64::must(1.0)));
    let str_key = cell_value_dedup_key(&CellValue::Text("1".into()));
    assert_ne!(num_key, str_key);

    // Boolean true and string "true" should have different keys
    let bool_key = cell_value_dedup_key(&CellValue::Boolean(true));
    let str_true_key = cell_value_dedup_key(&CellValue::Text("true".into()));
    assert_ne!(bool_key, str_true_key);

    // Null should have a unique key
    let null_key = cell_value_dedup_key(&CellValue::Null);
    assert_ne!(null_key, num_key);
    assert_ne!(null_key, str_key);
}

// -------------------------------------------------------------------
// Test 39: Condition filter — aboveAverage / belowAverage (via compute-table)
// -------------------------------------------------------------------

#[test]
fn test_condition_above_below_average() {
    // Data: 80, 20, text. Average of numeric values = 50.
    let data = vec![
        CellValue::Number(FiniteF64::must(80.0)),
        CellValue::Number(FiniteF64::must(20.0)),
        CellValue::Text("text".into()),
    ];

    // AboveAverage via Condition operator (converted to DynamicFilter internally)
    let above_filter = ColumnFilter::Condition {
        conditions: vec![FilterCondition {
            operator: FilterOperator::AboveAverage,
            value: None,
            value2: None,
        }],
        logic: FilterLogic::And,
    };
    let result = eval_column_filter(&above_filter, &data);
    // 80 > 50 (above avg), 20 < 50 (not above), "text" (not numeric, not above)
    assert_eq!(result, vec![true, false, false]);

    // BelowAverage via Condition operator
    let below_filter = ColumnFilter::Condition {
        conditions: vec![FilterCondition {
            operator: FilterOperator::BelowAverage,
            value: None,
            value2: None,
        }],
        logic: FilterLogic::And,
    };
    let result = eval_column_filter(&below_filter, &data);
    // 80 > 50 (not below), 20 < 50 (below avg), "text" (not numeric, not below)
    assert_eq!(result, vec![false, true, false]);
}

// -------------------------------------------------------------------
// Test 40: Clear all on empty sheet is no-op
// -------------------------------------------------------------------

#[test]
fn test_clear_all_empty_sheet() {
    let (storage, sheet_id) = storage_with_sheet();
    // Should not panic
    clear_all_filters(storage.doc(), storage.sheets(), &sheet_id);
    assert_eq!(
        get_filter_count(storage.doc(), storage.sheets(), &sheet_id),
        0
    );
}
