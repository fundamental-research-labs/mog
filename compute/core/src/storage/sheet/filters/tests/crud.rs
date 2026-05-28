use super::super::{
    ColumnFilter, FilterCondition, FilterKind, FilterLogic, FilterOperator, FilterSortState,
    SortBy, SortOrder, clear_all_column_filters, clear_all_filters, clear_column_filter,
    create_filter, delete_filter, get_active_filter_count, get_active_filters, get_filter,
    get_filter_count, get_filter_sort_state, get_filters_in_sheet, get_table_filter,
    set_column_filter, set_filter_sort_state,
};
use super::helpers::{make_sheet_id, storage_with_sheet};
use crate::storage::YrsStorage;
use value_types::CellValue;

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
