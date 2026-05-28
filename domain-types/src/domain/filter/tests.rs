use std::collections::HashMap;

use value_types::CellValue;

use super::range_ref::{col_index_to_letters, col_letters_to_index, parse_range_ref};
use super::runtime::FilterState;
use super::*;

#[test]
fn column_filter_values_roundtrip() {
    let filter = ColumnFilter::Values {
        values: vec![
            serde_json::json!("a"),
            serde_json::json!(1),
            serde_json::json!(null),
        ],
        include_blanks: true,
    };
    let json = serde_json::to_string(&filter).unwrap();
    let reparsed: ColumnFilter = serde_json::from_str(&json).unwrap();
    assert_eq!(filter, reparsed);
}

#[test]
fn column_filter_condition_roundtrip() {
    let filter = ColumnFilter::Condition {
        conditions: vec![FilterCondition {
            operator: FilterOperator::GreaterThan,
            value: Some(CellValue::number(10.0)),
            value2: None,
        }],
        logic: FilterLogic::And,
    };
    let json = serde_json::to_string(&filter).unwrap();
    let reparsed: ColumnFilter = serde_json::from_str(&json).unwrap();
    assert_eq!(filter, reparsed);
}

#[test]
fn column_filter_top_bottom_roundtrip() {
    let filter = ColumnFilter::TopBottom {
        direction: TopBottomDirection::Top,
        count: 10.0,
        by: TopBottomBy::Items,
    };
    let json = serde_json::to_string(&filter).unwrap();
    let reparsed: ColumnFilter = serde_json::from_str(&json).unwrap();
    assert_eq!(filter, reparsed);
}

#[test]
fn column_filter_dynamic_roundtrip() {
    let filter = ColumnFilter::Dynamic {
        rule: DynamicFilterRule::AboveAverage,
    };
    let json = serde_json::to_string(&filter).unwrap();
    let reparsed: ColumnFilter = serde_json::from_str(&json).unwrap();
    assert_eq!(filter, reparsed);
}

#[test]
fn column_filter_color_roundtrip() {
    // Note: `ColumnFilter::Color` is the runtime (Yrs-stored) shape, not
    // the OOXML-typed `OoxmlFilterType::Color`. The `color` token here
    // is a free-form string the UI assigns; typed OOXML preservation did not migrate
    // this runtime shape (see `ooxml_filter_type_to_column_filter` for
    // the `dxf:<id>` shim used to bridge the two).
    let filter = ColumnFilter::Color {
        color: "#ff0000".to_string(),
        by_font: false,
    };
    let json = serde_json::to_string(&filter).unwrap();
    let reparsed: ColumnFilter = serde_json::from_str(&json).unwrap();
    assert_eq!(filter, reparsed);
}

#[test]
fn filter_state_roundtrip() {
    let state = FilterState {
        id: "f1".to_string(),
        filter_kind: FilterKind::AutoFilter,
        header_start_cell_id: "c1".to_string(),
        header_end_cell_id: "c2".to_string(),
        data_end_cell_id: "c3".to_string(),
        column_filters: {
            let mut m = HashMap::new();
            m.insert(
                "c1".to_string(),
                ColumnFilter::Values {
                    values: vec![serde_json::json!("a"), serde_json::json!(1)],
                    include_blanks: false,
                },
            );
            m
        },
        advanced_filter: None,
        sort_state: Some(FilterSortState {
            column_cell_id: "c1".to_string(),
            order: SortOrder::Asc,
            sort_by: SortBy::Value,
        }),
        table_id: None,
        created_at: Some(1000),
        updated_at: Some(2000),
        start_row: None,
        start_col: None,
        end_row: None,
        end_col: None,
    };
    let json = serde_json::to_string(&state).unwrap();
    let reparsed: FilterState = serde_json::from_str(&json).unwrap();
    assert_eq!(state.id, reparsed.id);
    assert_eq!(state.filter_kind, reparsed.filter_kind);
    assert_eq!(state.column_filters, reparsed.column_filters);
    assert_eq!(state.sort_state, reparsed.sort_state);
}

#[test]
fn filter_kind_serde() {
    assert_eq!(
        serde_json::to_string(&FilterKind::AutoFilter).unwrap(),
        "\"autoFilter\""
    );
    assert_eq!(
        serde_json::to_string(&FilterKind::TableFilter).unwrap(),
        "\"tableFilter\""
    );
}

#[test]
fn filter_operator_serde() {
    assert_eq!(
        serde_json::to_string(&FilterOperator::Equals).unwrap(),
        "\"equals\""
    );
    assert_eq!(
        serde_json::to_string(&FilterOperator::GreaterThanOrEqual).unwrap(),
        "\"greaterThanOrEqual\""
    );
    assert_eq!(
        serde_json::to_string(&FilterOperator::IsBlank).unwrap(),
        "\"isBlank\""
    );
}

#[test]
fn test_parse_range_ref() {
    assert_eq!(parse_range_ref("A1:D20"), Some((0, 0, 19, 3)));
    assert_eq!(parse_range_ref("$B$2:$E$10"), Some((1, 1, 9, 4)));
    assert_eq!(parse_range_ref("AA1:AB5"), Some((0, 26, 4, 27)));
}

#[test]
fn test_col_letters_roundtrip() {
    assert_eq!(col_letters_to_index("A"), Some(0));
    assert_eq!(col_letters_to_index("Z"), Some(25));
    assert_eq!(col_letters_to_index("AA"), Some(26));
    assert_eq!(col_index_to_letters(0), "A");
    assert_eq!(col_index_to_letters(25), "Z");
    assert_eq!(col_index_to_letters(26), "AA");
}

#[test]
fn test_auto_filter_to_filter_state() {
    let af = AutoFilter {
        range_ref: "A1:C10".to_string(),
        columns: vec![FilterColumn {
            col_index: 0,
            filter_type: Some(OoxmlFilterType::Values {
                values: vec!["Alice".to_string(), "Bob".to_string()],
                blanks: false,
                calendar_type: None,
                date_group_items: Vec::new(),
            }),
            ..Default::default()
        }],
        sort: None,
        xr_uid: None,
        ext_lst_raw: None,
    };
    let resolver = |row: u32, col: u32| -> Option<String> { Some(format!("cell-{}-{}", row, col)) };
    let state = auto_filter_to_filter_state(&af, &resolver).unwrap();
    assert_eq!(state.filter_kind, FilterKind::AutoFilter);
    assert_eq!(state.header_start_cell_id, "cell-0-0");
    assert_eq!(state.header_end_cell_id, "cell-0-2");
    assert_eq!(state.data_end_cell_id, "cell-9-2");
    assert_eq!(state.column_filters.len(), 1);
    let cf = state.column_filters.get("cell-0-0").unwrap();
    match cf {
        ColumnFilter::Values {
            values,
            include_blanks,
        } => {
            assert_eq!(values.len(), 2);
            assert!(!include_blanks);
        }
        _ => panic!("Expected Values variant"),
    }
}

#[test]
fn test_auto_filter_to_filter_state_skips_childless_columns() {
    let af = AutoFilter {
        range_ref: "A1:C10".to_string(),
        columns: vec![
            FilterColumn {
                col_index: 0,
                filter_type: None,
                ..Default::default()
            },
            FilterColumn {
                col_index: 1,
                filter_type: Some(OoxmlFilterType::Values {
                    values: Vec::new(),
                    blanks: false,
                    calendar_type: None,
                    date_group_items: Vec::new(),
                }),
                ..Default::default()
            },
        ],
        sort: None,
        xr_uid: None,
        ext_lst_raw: None,
    };
    let resolver = |row: u32, col: u32| -> Option<String> { Some(format!("cell-{}-{}", row, col)) };
    let state = auto_filter_to_filter_state(&af, &resolver).unwrap();
    assert_eq!(state.header_start_cell_id, "cell-0-0");
    assert_eq!(state.header_end_cell_id, "cell-0-2");
    assert_eq!(state.data_end_cell_id, "cell-9-2");
    assert!(!state.column_filters.contains_key("cell-0-0"));
    assert!(state.column_filters.contains_key("cell-0-1"));
}

#[test]
fn test_filter_state_to_auto_filter_roundtrip() {
    let af = AutoFilter {
        range_ref: "B2:D10".to_string(),
        columns: vec![
            FilterColumn {
                col_index: 0,
                filter_type: Some(OoxmlFilterType::Values {
                    values: vec!["X".to_string()],
                    blanks: true,
                    calendar_type: None,
                    date_group_items: Vec::new(),
                }),
                ..Default::default()
            },
            FilterColumn {
                col_index: 2,
                filter_type: Some(OoxmlFilterType::Top10 {
                    top: true,
                    percent: false,
                    value: 5.0,
                    filter_val: None,
                }),
                ..Default::default()
            },
        ],
        sort: None,
        xr_uid: None,
        ext_lst_raw: None,
    };
    let resolver = |row: u32, col: u32| -> Option<String> { Some(format!("c-{}-{}", row, col)) };
    let state = auto_filter_to_filter_state(&af, &resolver).unwrap();

    let pos_resolver = |cell_id: &str| -> Option<(u32, u32)> {
        let parts: Vec<&str> = cell_id.strip_prefix("c-")?.split('-').collect();
        Some((parts[0].parse().ok()?, parts[1].parse().ok()?))
    };
    let af2 = filter_state_to_auto_filter(&state, &pos_resolver).unwrap();
    assert_eq!(af2.range_ref, "B2:D10");
    assert_eq!(af2.columns.len(), 2);
    assert_eq!(af2.columns[0].col_index, 0);
    assert_eq!(af2.columns[1].col_index, 2);
}

#[test]
fn ooxml_filter_condition_updated() {
    let cond = OoxmlFilterCondition {
        operator: "greaterThan".to_string(),
        value: CellValue::number(42.0),
        value2: None,
    };
    let json = serde_json::to_string(&cond).unwrap();
    assert!(json.contains("42"));
    let reparsed: OoxmlFilterCondition = serde_json::from_str(&json).unwrap();
    assert_eq!(cond, reparsed);
}

// ── From conversion tests: ooxml_types <-> domain sort types ──

#[test]
fn sort_order_from_ooxml_ascending() {
    let result: SortOrder = ooxml_types::tables::SortOrder::Ascending.into();
    assert_eq!(result, SortOrder::Asc);
}

#[test]
fn sort_order_from_ooxml_descending() {
    let result: SortOrder = ooxml_types::tables::SortOrder::Descending.into();
    assert_eq!(result, SortOrder::Desc);
}

#[test]
fn sort_order_from_ooxml_none_defaults_to_asc() {
    let result: SortOrder = ooxml_types::tables::SortOrder::None.into();
    assert_eq!(result, SortOrder::Asc);
}

#[test]
fn sort_order_to_ooxml_roundtrip() {
    let asc: ooxml_types::tables::SortOrder = SortOrder::Asc.into();
    assert_eq!(asc, ooxml_types::tables::SortOrder::Ascending);

    let desc: ooxml_types::tables::SortOrder = SortOrder::Desc.into();
    assert_eq!(desc, ooxml_types::tables::SortOrder::Descending);
}

#[test]
fn sort_by_from_ooxml_value() {
    let result: SortBy = ooxml_types::tables::SortBy::Value.into();
    assert_eq!(result, SortBy::Value);
}

#[test]
fn sort_by_from_ooxml_cell_color() {
    let result: SortBy = ooxml_types::tables::SortBy::CellColor.into();
    assert_eq!(result, SortBy::Color);
}

#[test]
fn sort_by_from_ooxml_font_color() {
    let result: SortBy = ooxml_types::tables::SortBy::FontColor.into();
    assert_eq!(result, SortBy::Color);
}

#[test]
fn sort_by_from_ooxml_icon() {
    let result: SortBy = ooxml_types::tables::SortBy::Icon.into();
    assert_eq!(result, SortBy::Icon);
}

#[test]
fn sort_by_to_ooxml_roundtrip() {
    let value: ooxml_types::tables::SortBy = SortBy::Value.into();
    assert_eq!(value, ooxml_types::tables::SortBy::Value);

    let color: ooxml_types::tables::SortBy = SortBy::Color.into();
    assert_eq!(color, ooxml_types::tables::SortBy::CellColor);

    let icon: ooxml_types::tables::SortBy = SortBy::Icon.into();
    assert_eq!(icon, ooxml_types::tables::SortBy::Icon);
}

// ── Serde wire format tests (bridge compatibility) ──

#[test]
fn sort_order_serde_wire_format() {
    // Must produce "asc"/"desc" to match what the TS bridge sends
    assert_eq!(serde_json::to_string(&SortOrder::Asc).unwrap(), "\"asc\"");
    assert_eq!(serde_json::to_string(&SortOrder::Desc).unwrap(), "\"desc\"");

    // Must deserialize from those same strings
    let asc: SortOrder = serde_json::from_str("\"asc\"").unwrap();
    assert_eq!(asc, SortOrder::Asc);
    let desc: SortOrder = serde_json::from_str("\"desc\"").unwrap();
    assert_eq!(desc, SortOrder::Desc);
}

#[test]
fn sort_by_serde_wire_format() {
    // Must produce "value"/"color"/"icon" to match what the TS bridge sends
    assert_eq!(serde_json::to_string(&SortBy::Value).unwrap(), "\"value\"");
    assert_eq!(serde_json::to_string(&SortBy::Color).unwrap(), "\"color\"");
    assert_eq!(serde_json::to_string(&SortBy::Icon).unwrap(), "\"icon\"");

    // Must deserialize from those same strings
    let value: SortBy = serde_json::from_str("\"value\"").unwrap();
    assert_eq!(value, SortBy::Value);
    let color: SortBy = serde_json::from_str("\"color\"").unwrap();
    assert_eq!(color, SortBy::Color);
    let icon: SortBy = serde_json::from_str("\"icon\"").unwrap();
    assert_eq!(icon, SortBy::Icon);
}

#[test]
fn column_filter_values_preserves_camel_case_include_blanks() {
    let filter: ColumnFilter = serde_json::from_value(serde_json::json!({
        "type": "values",
        "values": [],
        "includeBlanks": true
    }))
    .unwrap();

    assert_eq!(
        filter,
        ColumnFilter::Values {
            values: Vec::new(),
            include_blanks: true,
        }
    );

    let wire = serde_json::to_value(&filter).unwrap();
    assert_eq!(wire["includeBlanks"], true);
    assert!(wire.get("include_blanks").is_none());
}
