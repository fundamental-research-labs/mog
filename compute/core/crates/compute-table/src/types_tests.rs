use super::*;
use value_types::{CellValue, FiniteF64};

fn round_trip<T: serde::Serialize + serde::de::DeserializeOwned + PartialEq + std::fmt::Debug>(
    val: &T,
) {
    let json = serde_json::to_string(val).expect("serialize");
    let back: T = serde_json::from_str(&json).expect("deserialize");
    assert_eq!(*val, back);
}

#[test]
fn test_table_round_trip() {
    let table = Table {
        id: "t1".to_string(),
        name: "Sales".to_string(),
        sheet_id: "sheet1".to_string(),
        range: TableRange {
            start_row: 0,
            start_col: 0,
            end_row: 10,
            end_col: 3,
        },
        columns: vec![
            TableColumn {
                id: "c1".to_string(),
                name: "Region".to_string(),
                index: 0,
                totals_function: Some(TotalsFunction::Count),
                totals_label: Some("Total".to_string()),
                calculated_formula: None,},
            TableColumn {
                id: "c2".to_string(),
                name: "Amount".to_string(),
                index: 1,
                totals_function: None,
                totals_label: None,
                calculated_formula: None,},
        ],
        has_header_row: true,
        has_totals_row: true,
        style: "TableStyleMedium2".to_string(),
        banded_rows: true,
        banded_columns: false,
        emphasize_first_column: false,
        emphasize_last_column: true,
        show_filter_buttons: true,
    auto_expand: true,
    auto_calculated_columns: true,
    };
    round_trip(&table);

    // Verify camelCase field names in JSON output
    let json = serde_json::to_string(&table).unwrap();
    assert!(json.contains("\"hasHeaderRow\""));
    assert!(json.contains("\"hasTotalsRow\""));
    assert!(json.contains("\"sheetId\""));
    assert!(json.contains("\"bandedRows\""));
    assert!(json.contains("\"emphasizeFirstColumn\""));
    assert!(json.contains("\"showFilterButtons\""));

    // Verify nullable fields serialize as null when None (TS `| null`, not `?:`)
    assert!(json.contains("\"totalsFunction\":null"));
    assert!(json.contains("\"totalsLabel\":null"));
    // And present with value when Some
    assert!(json.contains("\"totalsFunction\":\"count\""));
}

#[test]
fn test_table_range_round_trip() {
    let range = TableRange {
        start_row: 5,
        start_col: 2,
        end_row: 100,
        end_col: 10,
    };
    round_trip(&range);

    let json = serde_json::to_string(&range).unwrap();
    assert!(json.contains("\"startRow\""));
    assert!(json.contains("\"startCol\""));
    assert!(json.contains("\"endRow\""));
    assert!(json.contains("\"endCol\""));
}

#[test]
fn test_filter_criteria_value_round_trip() {
    let criteria = FilterCriteria::Values(ValueFilter {
        included: vec![
            CellValue::Text("East".to_string()),
            CellValue::Number(FiniteF64::must(42.0)),
            CellValue::Boolean(true),
        ],
        include_blanks: true,
    });
    round_trip(&criteria);

    // Verify tagged enum serialization with "type" tag
    let json = serde_json::to_string(&criteria).unwrap();
    assert!(json.contains("\"type\":\"values\""));
    assert!(json.contains("\"includeBlanks\":true"));
}

#[test]
fn test_filter_criteria_condition_round_trip() {
    let criteria = FilterCriteria::Condition(ConditionFilter {
        conditions: vec![
            TableFilterCondition {
                operator: FilterOperator::GreaterThan,
                value: CellValue::Number(FiniteF64::must(100.0)),
                value2: None,
            },
            TableFilterCondition {
                operator: FilterOperator::Between,
                value: CellValue::Number(FiniteF64::must(10.0)),
                value2: Some(CellValue::Number(FiniteF64::must(50.0))),
            },
            TableFilterCondition {
                operator: FilterOperator::Contains,
                value: CellValue::Text("hello".to_string()),
                value2: None,
            },
            TableFilterCondition {
                operator: FilterOperator::IsBlank,
                value: CellValue::Null,
                value2: None,
            },
        ],
        logic: FilterLogic::Or,
    });
    round_trip(&criteria);

    let json = serde_json::to_string(&criteria).unwrap();
    assert!(json.contains("\"type\":\"condition\""));
    assert!(json.contains("\"greaterThan\""));
    assert!(json.contains("\"between\""));
    assert!(json.contains("\"contains\""));
    assert!(json.contains("\"isBlank\""));
}

#[test]
fn test_filter_criteria_top_bottom_round_trip() {
    let criteria = FilterCriteria::TopBottom(TableTopBottomFilter {
        direction: TopBottomDirection::Top,
        count: 10.0,
        by: TopBottomBy::Items,
    });
    round_trip(&criteria);

    let json = serde_json::to_string(&criteria).unwrap();
    assert!(json.contains("\"type\":\"topBottom\""));
    assert!(json.contains("\"direction\":\"top\""));
    assert!(json.contains("\"by\":\"items\""));

    // Also test bottom + percent
    let criteria2 = FilterCriteria::TopBottom(TableTopBottomFilter {
        direction: TopBottomDirection::Bottom,
        count: 25.0,
        by: TopBottomBy::Percent,
    });
    round_trip(&criteria2);

    // Also test sum
    let criteria3 = FilterCriteria::TopBottom(TableTopBottomFilter {
        direction: TopBottomDirection::Top,
        count: 1000.0,
        by: TopBottomBy::Sum,
    });
    round_trip(&criteria3);
}

#[test]
fn test_filter_criteria_dynamic_round_trip() {
    let rules = vec![
        DynamicFilterRule::AboveAverage,
        DynamicFilterRule::BelowAverage,
        DynamicFilterRule::Today,
        DynamicFilterRule::Yesterday,
        DynamicFilterRule::Tomorrow,
        DynamicFilterRule::ThisWeek,
        DynamicFilterRule::LastWeek,
        DynamicFilterRule::NextWeek,
        DynamicFilterRule::ThisMonth,
        DynamicFilterRule::LastMonth,
        DynamicFilterRule::NextMonth,
        DynamicFilterRule::ThisQuarter,
        DynamicFilterRule::LastQuarter,
        DynamicFilterRule::NextQuarter,
        DynamicFilterRule::ThisYear,
        DynamicFilterRule::LastYear,
        DynamicFilterRule::NextYear,
    ];

    for rule in rules {
        let criteria = FilterCriteria::Dynamic(DynamicFilter { rule });
        round_trip(&criteria);
    }

    let json =
        serde_json::to_string(&FilterCriteria::Dynamic(DynamicFilter {
            rule: DynamicFilterRule::AboveAverage,
        }))
        .unwrap();
    assert!(json.contains("\"type\":\"dynamic\""));
    assert!(json.contains("\"aboveAverage\""));
}

#[test]
fn test_filter_state_round_trip() {
    let mut filters = BTreeMap::new();
    filters.insert(
        "col1".to_string(),
        FilterCriteria::Values(ValueFilter {
            included: vec![CellValue::Text("East".to_string())],
            include_blanks: false,
        }),
    );
    filters.insert(
        "col2".to_string(),
        FilterCriteria::Condition(ConditionFilter {
            conditions: vec![TableFilterCondition {
                operator: FilterOperator::GreaterThan,
                value: CellValue::Number(FiniteF64::must(50.0)),
                value2: None,
            }],
            logic: FilterLogic::And,
        }),
    );
    let state = TableFilterState { filters };
    round_trip(&state);
}

#[test]
fn test_slicer_round_trip() {
    let slicer = Slicer {
        id: "s1".to_string(),
        name: "Region Slicer".to_string(),
        source_type: SlicerSourceType::Table,
        source_id: "table1".to_string(),
        source_column_id: "col1".to_string(),
        selected_values: vec![
            CellValue::Text("East".to_string()),
            CellValue::Null,
        ],
        multi_select: true,
        show_items_with_no_data: false,
        sort_order: SlicerSortOrder::Ascending,
    };
    round_trip(&slicer);

    let json = serde_json::to_string(&slicer).unwrap();
    assert!(json.contains("\"sourceType\":\"table\""));
    assert!(json.contains("\"sourceColumnId\""));
    assert!(json.contains("\"multiSelect\""));
    assert!(json.contains("\"showItemsWithNoData\""));
    assert!(json.contains("\"sortOrder\":\"ascending\""));

    // Test pivot source type
    let slicer_pivot = Slicer {
        source_type: SlicerSourceType::Pivot,
        ..slicer
    };
    round_trip(&slicer_pivot);
    let json2 = serde_json::to_string(&slicer_pivot).unwrap();
    assert!(json2.contains("\"sourceType\":\"pivot\""));
}

#[test]
fn test_row_visibility_round_trip() {
    // Test with Some values
    let vis = RowVisibility {
        bitmap: vec![1, 0, 1, 1],
        visible_count: 3,
        total_count: 4,
        first_visible_row: Some(0),
        last_visible_row: Some(3),
    };
    round_trip(&vis);

    // Also test None case explicitly -- None should serialize as -1
    let vis_none = RowVisibility {
        bitmap: vec![0, 0],
        visible_count: 0,
        total_count: 2,
        first_visible_row: None,
        last_visible_row: None,
    };
    let json = serde_json::to_string(&vis_none).unwrap();
    assert!(json.contains("-1"), "None should serialize as -1");
    round_trip(&vis_none);

    // Verify the Some case does NOT contain -1 for visible rows
    let json_some = serde_json::to_string(&vis).unwrap();
    assert!(json_some.contains("\"firstVisibleRow\":0"));
    assert!(json_some.contains("\"lastVisibleRow\":3"));
}

#[test]
fn test_table_structure_change_round_trip() {
    // ColumnRenamed
    let change = TableStructureChange::ColumnRenamed {
        old_name: "OldCol".to_string(),
        new_name: "NewCol".to_string(),
    };
    round_trip(&change);
    let json = serde_json::to_string(&change).unwrap();
    assert!(json.contains("\"type\":\"columnRenamed\""));
    assert!(json.contains("\"oldName\""));
    assert!(json.contains("\"newName\""));

    // TableRenamed
    let change2 = TableStructureChange::TableRenamed {
        old_name: "OldTable".to_string(),
        new_name: "NewTable".to_string(),
    };
    round_trip(&change2);
    let json2 = serde_json::to_string(&change2).unwrap();
    assert!(json2.contains("\"type\":\"tableRenamed\""));

    // ColumnRemoved
    let change3 = TableStructureChange::ColumnRemoved {
        name: "RemovedCol".to_string(),
    };
    round_trip(&change3);
    let json3 = serde_json::to_string(&change3).unwrap();
    assert!(json3.contains("\"type\":\"columnRemoved\""));

    // ColumnAdded
    let change4 = TableStructureChange::ColumnAdded {
        name: "NewCol".to_string(),
        index: 3,
    };
    round_trip(&change4);
    let json4 = serde_json::to_string(&change4).unwrap();
    assert!(json4.contains("\"type\":\"columnAdded\""));

    // TableResized
    let change5 = TableStructureChange::TableResized {
        old_range: TableRange {
            start_row: 0,
            start_col: 0,
            end_row: 5,
            end_col: 3,
        },
        new_range: TableRange {
            start_row: 0,
            start_col: 0,
            end_row: 10,
            end_col: 5,
        },
    };
    round_trip(&change5);
    let json5 = serde_json::to_string(&change5).unwrap();
    assert!(json5.contains("\"type\":\"tableResized\""));
    assert!(json5.contains("\"oldRange\""));
    assert!(json5.contains("\"newRange\""));
}

#[test]
fn test_slicer_cache_round_trip() {
    let cache = SlicerCache {
        items: vec![
            SlicerCacheItem {
                value: CellValue::Text("East".to_string()),
                display_text: "East".to_string(),
                count: 5,
                selected: true,
                has_data: true,
            },
            SlicerCacheItem {
                value: CellValue::Number(FiniteF64::must(42.0)),
                display_text: "42".to_string(),
                count: 2,
                selected: false,
                has_data: false,
            },
            SlicerCacheItem {
                value: CellValue::Null,
                display_text: "(Blank)".to_string(),
                count: 1,
                selected: true,
                has_data: true,
            },
        ],
        total_count: 3,
        selected_count: 2,
    };
    round_trip(&cache);

    let json = serde_json::to_string(&cache).unwrap();
    assert!(json.contains("\"totalCount\""));
    assert!(json.contains("\"selectedCount\""));
    assert!(json.contains("\"displayText\""));
    assert!(json.contains("\"hasData\""));
}

#[test]
fn test_sort_spec_round_trip() {
    // Without custom_order
    let spec = SortSpec {
        column_id: "col1".to_string(),
        direction: SortDirection::Ascending,
        custom_order: None,
    };
    round_trip(&spec);

    let json = serde_json::to_string(&spec).unwrap();
    assert!(json.contains("\"columnId\""));
    assert!(json.contains("\"direction\":\"ascending\""));
    // custom_order should be skipped when None
    assert!(!json.contains("customOrder"));

    // With custom_order
    let spec2 = SortSpec {
        column_id: "col2".to_string(),
        direction: SortDirection::Descending,
        custom_order: Some(vec![
            CellValue::Text("High".to_string()),
            CellValue::Text("Medium".to_string()),
            CellValue::Text("Low".to_string()),
        ]),
    };
    round_trip(&spec2);

    let json2 = serde_json::to_string(&spec2).unwrap();
    assert!(json2.contains("\"direction\":\"descending\""));
    assert!(json2.contains("\"customOrder\""));
}
