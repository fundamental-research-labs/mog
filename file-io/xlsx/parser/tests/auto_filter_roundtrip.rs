//! End-to-end round-trip tests for the worksheet-level `<autoFilter>`.
//!
//! Typed OOXML preservation: inventory row 5.2 replaced the raw-XML sidecar
//! (raw XML sidecars
//! `SheetData.auto_filter: Option<domain_types::AutoFilter>` field and made
//! the typed representation lossless over CT_AutoFilter (filter-column
//! choice group including `colorFilter` with real `dxfId`, `iconFilter`,
//! and `<filters>`/`<dateGroupItem>`/`<top10>`/`<dynamicFilter>`
//! attributes that the prior domain type dropped). These tests exercise
//! the parse → write → re-parse cycle to confirm the typed field carries
//! every previously-dropped attribute.

use domain_types::{
    AutoFilter, CalendarType, DateGroupItem, DateTimeGrouping, FilterColumn, OoxmlFilterCondition,
    OoxmlFilterType, ParseOutput, SheetData, SheetDimensions,
};
use xlsx_parser::parse_xlsx_to_output;
use xlsx_parser::write::write_xlsx_from_parse_output;

fn make_sheet_with_autofilter(af: AutoFilter) -> ParseOutput {
    ParseOutput {
        sheets: vec![SheetData {
            name: "Sheet1".to_string(),
            rows: 20,
            cols: 4,
            cells: Vec::new(),
            dimensions: SheetDimensions::default(),
            auto_filter: Some(af),
            ..Default::default()
        }],
        ..Default::default()
    }
}

fn round_trip(af: AutoFilter) -> AutoFilter {
    let po = make_sheet_with_autofilter(af);
    let bytes = write_xlsx_from_parse_output(&po).expect("write");
    let (rt, _diag) = parse_xlsx_to_output(&bytes).expect("parse");
    rt.sheets[0]
        .auto_filter
        .clone()
        .expect("auto_filter dropped during round trip — regressing row 5.2")
}

#[test]
fn values_with_calendar_type_and_date_group_items_round_trip() {
    let original = AutoFilter {
        range_ref: "A1:D20".to_string(),
        columns: vec![FilterColumn {
            col_index: 0,
            filter_type: Some(OoxmlFilterType::Values {
                values: vec!["Alpha".to_string(), "Beta".to_string()],
                blanks: true,
                calendar_type: Some(CalendarType::Gregorian),
                date_group_items: vec![DateGroupItem {
                    year: 2024,
                    month: Some(3),
                    day: Some(15),
                    hour: None,
                    minute: None,
                    second: None,
                    date_time_grouping: DateTimeGrouping::Day,
                }],
            }),
            hidden_button: false,
            show_button: true,
            ext_lst_raw: None,
        }],
        sort: None,
        xr_uid: None,
        ext_lst_raw: None,
    };
    let rt = round_trip(original.clone());
    assert_eq!(rt, original);
}

#[test]
fn top10_preserves_filter_val() {
    let original = AutoFilter {
        range_ref: "A1:D20".to_string(),
        columns: vec![FilterColumn {
            col_index: 2,
            filter_type: Some(OoxmlFilterType::Top10 {
                top: false,
                percent: true,
                value: 25.0,
                filter_val: Some(42.5),
            }),
            ..Default::default()
        }],
        sort: None,
        xr_uid: None,
        ext_lst_raw: None,
    };
    let rt = round_trip(original.clone());
    assert_eq!(rt, original);
}

#[test]
fn color_filter_preserves_dxf_id() {
    // Pre-5.2, ColorFilter was `{ color: String, by_font: bool }` — `dxfId`
    // was dropped and the writer hard-coded `dxfId="0"`. After 5.2, the
    // typed variant carries the real dxfId.
    let original = AutoFilter {
        range_ref: "A1:D20".to_string(),
        columns: vec![FilterColumn {
            col_index: 1,
            filter_type: Some(OoxmlFilterType::Color {
                dxf_id: Some(7),
                cell_color: false,
            }),
            ..Default::default()
        }],
        sort: None,
        xr_uid: None,
        ext_lst_raw: None,
    };
    let rt = round_trip(original.clone());
    assert_eq!(rt, original);
}

#[test]
fn icon_filter_round_trips() {
    // Pre-5.2, `OoxmlFilterType::Icon` didn't exist; the writer fell
    // through to an empty Values list. After 5.2, iconFilter round-trips.
    let original = AutoFilter {
        range_ref: "A1:D20".to_string(),
        columns: vec![FilterColumn {
            col_index: 0,
            filter_type: Some(OoxmlFilterType::Icon {
                icon_set: Some("3TrafficLights1".to_string()),
                icon_id: 1,
            }),
            ..Default::default()
        }],
        sort: None,
        xr_uid: None,
        ext_lst_raw: None,
    };
    let rt = round_trip(original.clone());
    assert_eq!(rt, original);
}

#[test]
fn dynamic_filter_preserves_val_and_iso() {
    let original = AutoFilter {
        range_ref: "A1:D20".to_string(),
        columns: vec![FilterColumn {
            col_index: 3,
            filter_type: Some(OoxmlFilterType::Dynamic {
                dynamic_type: "aboveAverage".to_string(),
                value: Some(10.0),
                max_value: Some(20.0),
                value_iso: Some("2024-01-01T00:00:00".to_string()),
                max_value_iso: None,
            }),
            ..Default::default()
        }],
        sort: None,
        xr_uid: None,
        ext_lst_raw: None,
    };
    let rt = round_trip(original.clone());
    assert_eq!(rt, original);
}

#[test]
fn filter_column_hidden_and_show_button_round_trip() {
    let original = AutoFilter {
        range_ref: "A1:D20".to_string(),
        columns: vec![FilterColumn {
            col_index: 0,
            filter_type: Some(OoxmlFilterType::Values {
                values: Vec::new(),
                blanks: false,
                calendar_type: None,
                date_group_items: Vec::new(),
            }),
            hidden_button: true,
            show_button: false,
            ext_lst_raw: None,
        }],
        sort: None,
        xr_uid: None,
        ext_lst_raw: None,
    };
    let rt = round_trip(original.clone());
    assert_eq!(rt, original);
}

#[test]
fn childless_and_explicit_empty_values_filters_round_trip_distinctly() {
    let original = AutoFilter {
        range_ref: "A1:D20".to_string(),
        columns: vec![
            FilterColumn {
                col_index: 0,
                hidden_button: true,
                show_button: false,
                filter_type: None,
                ext_lst_raw: None,
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

    let rt = round_trip(original.clone());
    assert_eq!(rt, original);
    assert!(rt.columns[0].filter_type.is_none());
    assert!(matches!(
        &rt.columns[1].filter_type,
        Some(OoxmlFilterType::Values {
            values,
            blanks: false,
            calendar_type: None,
            date_group_items,
        }) if values.is_empty() && date_group_items.is_empty()
    ));
}

#[test]
fn custom_filter_round_trips_with_two_conditions() {
    let original = AutoFilter {
        range_ref: "A1:D20".to_string(),
        columns: vec![FilterColumn {
            col_index: 1,
            filter_type: Some(OoxmlFilterType::Custom {
                conditions: vec![
                    OoxmlFilterCondition {
                        operator: "greaterThan".to_string(),
                        value: value_types::CellValue::from("10"),
                        value2: None,
                    },
                    OoxmlFilterCondition {
                        operator: "lessThan".to_string(),
                        value: value_types::CellValue::from("100"),
                        value2: None,
                    },
                ],
                and_logic: true,
            }),
            ..Default::default()
        }],
        sort: None,
        xr_uid: None,
        ext_lst_raw: None,
    };
    let rt = round_trip(original.clone());
    // Note: in this path, `CellValue::Text("10")` survives as `Text("10")`
    // on re-parse because the writer emits `val="10"` and the parser reads
    // `val` into a `CellValue::Text`.
    assert_eq!(rt.range_ref, original.range_ref);
    assert_eq!(rt.columns.len(), 1);
    match &rt.columns[0].filter_type {
        Some(OoxmlFilterType::Custom {
            conditions,
            and_logic,
        }) => {
            assert!(*and_logic);
            assert_eq!(conditions.len(), 2);
            assert_eq!(conditions[0].operator, "greaterThan");
            assert_eq!(conditions[1].operator, "lessThan");
        }
        other => panic!("expected Custom, got {:?}", other),
    }
}

#[test]
fn autofilter_with_nested_sort_state_round_trips() {
    use domain_types::{SortCondition, SortConditionBy, SortMethod, SortState};

    let original = AutoFilter {
        range_ref: "A1:D20".to_string(),
        columns: vec![FilterColumn {
            col_index: 0,
            filter_type: Some(OoxmlFilterType::Values {
                values: vec!["x".to_string()],
                blanks: false,
                calendar_type: None,
                date_group_items: Vec::new(),
            }),
            ..Default::default()
        }],
        sort: Some(SortState {
            range_ref: "A2:D20".to_string(),
            column_sort: false,
            case_sensitive: false,
            sort_method: SortMethod::None,
            conditions: vec![SortCondition {
                range_ref: "A2:A20".to_string(),
                descending: true,
                sort_by: SortConditionBy::Value,
                custom_list: None,
                dxf_id: None,
                icon_set: None,
                icon_id: None,
            }],
            ..Default::default()
        }),
        xr_uid: None,
        ext_lst_raw: None,
    };
    let rt = round_trip(original.clone());
    assert_eq!(rt.sort, original.sort);
}

#[test]
fn xr_uid_round_trips() {
    // ~80 corpus files carry an `xr:uid` attribute on `<autoFilter>` (Microsoft's
    // revision-tracking GUID). It's a closed-out-of-XSD extension attribute; the
    // contract is preservation, not interpretation.
    let original = AutoFilter {
        range_ref: "AA11:BV21".to_string(),
        columns: Vec::new(),
        sort: None,
        xr_uid: Some("{00000000-0001-0000-0000-000000000000}".to_string()),
        ext_lst_raw: None,
    };
    let rt = round_trip(original.clone());
    assert_eq!(rt.xr_uid, original.xr_uid);
    assert_eq!(rt, original);
}
