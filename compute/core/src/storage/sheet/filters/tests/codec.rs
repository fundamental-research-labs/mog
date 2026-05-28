use super::super::{
    ColumnFilter, FilterCondition, FilterKind, FilterLogic, FilterOperator, FilterSortState,
    FilterState, SortBy, SortOrder, TopBottomBy, TopBottomDirection, create_filter, get_filter,
    set_column_filter, set_filter_sort_state,
};
use super::helpers::storage_with_sheet;
use std::collections::HashMap;
use value_types::CellValue;

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
