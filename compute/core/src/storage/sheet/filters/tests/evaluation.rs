use super::super::evaluation::cell_value_dedup_key;
use super::super::{
    ColumnFilter, FilterCondition, FilterKind, FilterLogic, FilterOperator, create_filter,
    evaluate_filter, get_filtered_record_count, get_unique_values, set_column_filter,
};
use super::helpers::{storage_with_sheet, test_get_cell_format};
use value_types::{CellValue, FiniteF64};

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
