//! XLSX auto-filter round-trip through the full compute-core engine path.
//!
//! Regression pin for the Typed OOXML preservation gap where hydration → Yrs → export
//! silently dropped `<autoFilter>` because the Yrs side only stored a
//! lossy `FilterState` derived from the OOXML `AutoFilter`.
//!
//! This test constructs XLSX bytes carrying a rich `<autoFilter>`
//! (every `OoxmlFilterType` variant + sort state + button attrs),
//! hydrates it into a `YrsComputeEngine`, exports back to XLSX bytes,
//! and asserts the `<autoFilter>` element survives the round-trip.

use std::sync::Arc;

use compute_core::storage::engine::YrsComputeEngine;
use domain_types::domain::filter::{
    CalendarType, DateGroupItem, DateTimeGrouping, OoxmlFilterCondition, SortCondition,
    SortConditionBy, SortMethod, SortState,
};
use domain_types::{AutoFilter, CellData, FilterColumn, OoxmlFilterType, ParseOutput, SheetData};
use value_types::{CellValue, FiniteF64};
use xlsx_parser::write::write_xlsx_from_parse_output;

fn text_cell(row: u32, col: u32, s: &str) -> CellData {
    CellData {
        row,
        col,
        value: CellValue::Text(Arc::from(s)),
        ..Default::default()
    }
}

fn num_cell(row: u32, col: u32, n: f64) -> CellData {
    CellData {
        row,
        col,
        value: CellValue::Number(FiniteF64::must(n)),
        ..Default::default()
    }
}

fn rich_auto_filter() -> AutoFilter {
    AutoFilter {
        range_ref: "A1:F10".to_string(),
        columns: vec![
            FilterColumn {
                col_index: 0,
                hidden_button: true,
                show_button: false,
                filter_type: Some(OoxmlFilterType::Values {
                    values: vec!["Alice".to_string(), "Bob".to_string()],
                    blanks: true,
                    calendar_type: Some(CalendarType::Japan),
                    date_group_items: vec![DateGroupItem {
                        year: 2025,
                        month: Some(4),
                        day: Some(23),
                        hour: None,
                        minute: None,
                        second: None,
                        date_time_grouping: DateTimeGrouping::Day,
                    }],
                }),
                ext_lst_raw: None,
            },
            FilterColumn {
                col_index: 1,
                hidden_button: false,
                show_button: true,
                filter_type: Some(OoxmlFilterType::Top10 {
                    top: false,
                    percent: true,
                    value: 15.0,
                    filter_val: Some(73.5),
                }),
                ext_lst_raw: None,
            },
            FilterColumn {
                col_index: 2,
                hidden_button: false,
                show_button: true,
                filter_type: Some(OoxmlFilterType::Custom {
                    conditions: vec![OoxmlFilterCondition {
                        operator: "greaterThan".to_string(),
                        value: CellValue::Number(FiniteF64::must(100.0)),
                        value2: None,
                    }],
                    and_logic: false,
                }),
                ext_lst_raw: None,
            },
            FilterColumn {
                col_index: 3,
                hidden_button: false,
                show_button: true,
                filter_type: Some(OoxmlFilterType::Dynamic {
                    dynamic_type: "aboveAverage".to_string(),
                    value: Some(42.5),
                    max_value: None,
                    value_iso: Some("2025-04-23T10:00:00Z".to_string()),
                    max_value_iso: None,
                }),
                ext_lst_raw: None,
            },
            FilterColumn {
                col_index: 4,
                hidden_button: false,
                show_button: true,
                filter_type: Some(OoxmlFilterType::Color {
                    dxf_id: Some(7),
                    cell_color: false,
                }),
                ext_lst_raw: None,
            },
            FilterColumn {
                col_index: 5,
                hidden_button: false,
                show_button: true,
                filter_type: Some(OoxmlFilterType::Icon {
                    icon_set: Some("3TrafficLights1".to_string()),
                    icon_id: 2,
                }),
                ext_lst_raw: None,
            },
        ],
        sort: Some(SortState {
            range_ref: "A1:F10".to_string(),
            column_sort: false,
            case_sensitive: true,
            sort_method: SortMethod::PinYin,
            conditions: vec![SortCondition {
                range_ref: "A2:A10".to_string(),
                descending: true,
                sort_by: SortConditionBy::Value,
                custom_list: Some("low,mid,high".to_string()),
                dxf_id: None,
                icon_set: None,
                icon_id: None,
            }],
            ..Default::default()
        }),
        xr_uid: Some("{DEADBEEF-0000-0000-0000-000000000042}".to_string()),
        ext_lst_raw: None,
    }
}

fn build_parse_output_with_filter(af: AutoFilter) -> ParseOutput {
    let mut cells = Vec::new();
    // 6-column header row
    for c in 0..6 {
        cells.push(text_cell(0, c, &format!("H{c}")));
    }
    // a few data rows
    for r in 1..10 {
        for c in 0..6 {
            cells.push(num_cell(r, c, (r * 10 + c) as f64));
        }
    }

    ParseOutput {
        sheets: vec![SheetData {
            name: "Data".to_string(),
            rows: 10,
            cols: 6,
            cells,
            auto_filter: Some(af),
            ..Default::default()
        }],
        ..Default::default()
    }
}

#[test]
fn rich_auto_filter_survives_hydrate_export_roundtrip() {
    let af = rich_auto_filter();
    let parse_output = build_parse_output_with_filter(af.clone());

    // Serialize → parse round-trip gives us the XLSX bytes we then hydrate
    // through the engine (the production path).
    let xlsx_bytes =
        write_xlsx_from_parse_output(&parse_output).expect("write_xlsx_from_parse_output");
    let (written, _written_diags) =
        xlsx_parser::parse_xlsx_to_output(&xlsx_bytes).expect("parse written xlsx");
    let af_written = written.sheets[0]
        .auto_filter
        .as_ref()
        .expect("written auto_filter should parse");
    let expected_color_dxf_id = match &af_written.columns[4].filter_type {
        Some(OoxmlFilterType::Color { dxf_id, .. }) => *dxf_id,
        other => panic!("written col 4 should be Color, got {other:?}"),
    };

    let (engine, _) = YrsComputeEngine::from_xlsx_bytes(&xlsx_bytes).expect("from_xlsx_bytes");

    // Export back out. The canonical check: the re-exported XLSX must still
    // contain <autoFilter with the original ref.
    let exported = engine.export_to_xlsx_bytes().expect("export_to_xlsx_bytes");
    let (reparsed, _diags) =
        xlsx_parser::parse_xlsx_to_output(&exported).expect("parse_xlsx_to_output");

    let af_rt = reparsed.sheets[0]
        .auto_filter
        .as_ref()
        .expect("auto_filter must survive hydrate→export round-trip");
    assert_eq!(af_rt.range_ref, af.range_ref);
    assert_eq!(
        af_rt.columns.len(),
        af.columns.len(),
        "column count mismatch"
    );
    // Button attrs on column 0 were non-default.
    assert!(af_rt.columns[0].hidden_button, "hiddenButton dropped");
    assert!(!af_rt.columns[0].show_button, "showButton=0 dropped");

    // Extended CT_AutoFilter fields each variant.
    match &af_rt.columns[0].filter_type {
        Some(OoxmlFilterType::Values {
            calendar_type,
            date_group_items,
            blanks,
            ..
        }) => {
            assert_eq!(calendar_type, &Some(CalendarType::Japan));
            assert!(*blanks);
            assert_eq!(date_group_items.len(), 1);
            assert_eq!(
                date_group_items[0].date_time_grouping,
                DateTimeGrouping::Day
            );
        }
        other => panic!("col 0 should be Values, got {other:?}"),
    }
    match &af_rt.columns[1].filter_type {
        Some(OoxmlFilterType::Top10 { filter_val, .. }) => {
            assert_eq!(filter_val, &Some(73.5));
        }
        other => panic!("col 1 should be Top10, got {other:?}"),
    }
    match &af_rt.columns[3].filter_type {
        Some(OoxmlFilterType::Dynamic {
            value, value_iso, ..
        }) => {
            assert_eq!(value, &Some(42.5));
            assert_eq!(value_iso.as_deref(), Some("2025-04-23T10:00:00Z"));
        }
        other => panic!("col 3 should be Dynamic, got {other:?}"),
    }
    match &af_rt.columns[4].filter_type {
        Some(OoxmlFilterType::Color { dxf_id, cell_color }) => {
            assert_eq!(*dxf_id, expected_color_dxf_id);
            assert!(!cell_color);
        }
        other => panic!("col 4 should be Color, got {other:?}"),
    }
    match &af_rt.columns[5].filter_type {
        Some(OoxmlFilterType::Icon { icon_set, icon_id }) => {
            assert_eq!(icon_set.as_deref(), Some("3TrafficLights1"));
            assert_eq!(icon_id, &2);
        }
        other => panic!("col 5 should be Icon, got {other:?}"),
    }

    let ss = af_rt.sort.as_ref().expect("sort state dropped");
    assert_eq!(ss.sort_method, SortMethod::PinYin);
    assert!(ss.case_sensitive);
    assert_eq!(ss.conditions.len(), 1);
    assert!(ss.conditions[0].descending);
    assert_eq!(
        ss.conditions[0].custom_list.as_deref(),
        Some("low,mid,high")
    );

    assert_eq!(af_rt.xr_uid, af.xr_uid, "xr:uid dropped on autoFilter");
}

#[test]
fn childless_and_explicit_empty_values_filters_survive_hydrate_export_roundtrip() {
    let af = AutoFilter {
        range_ref: "A1:C10".to_string(),
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
    let parse_output = build_parse_output_with_filter(af.clone());
    let xlsx_bytes =
        write_xlsx_from_parse_output(&parse_output).expect("write_xlsx_from_parse_output");

    let (engine, _) = YrsComputeEngine::from_xlsx_bytes(&xlsx_bytes).expect("from_xlsx_bytes");
    let exported = engine.export_to_xlsx_bytes().expect("export_to_xlsx_bytes");
    let (reparsed, _diags) =
        xlsx_parser::parse_xlsx_to_output(&exported).expect("parse_xlsx_to_output");

    let af_rt = reparsed.sheets[0]
        .auto_filter
        .as_ref()
        .expect("auto_filter must survive hydrate→export round-trip");
    assert_eq!(af_rt.range_ref, af.range_ref);
    assert_eq!(af_rt.columns.len(), 2);
    assert_eq!(af_rt.columns[0].col_index, 0);
    assert!(af_rt.columns[0].hidden_button);
    assert!(!af_rt.columns[0].show_button);
    assert!(af_rt.columns[0].filter_type.is_none());
    assert!(matches!(
        &af_rt.columns[1].filter_type,
        Some(OoxmlFilterType::Values {
            values,
            blanks: false,
            calendar_type: None,
            date_group_items,
        }) if values.is_empty() && date_group_items.is_empty()
    ));
}

#[test]
fn simple_auto_filter_survives_when_no_column_filters() {
    let af = AutoFilter {
        range_ref: "A1:C5".to_string(),
        columns: Vec::new(),
        sort: None,
        xr_uid: None,
        ext_lst_raw: None,
    };
    let parse_output = build_parse_output_with_filter(af.clone());

    let xlsx_bytes =
        write_xlsx_from_parse_output(&parse_output).expect("write_xlsx_from_parse_output");
    let (engine, _) = YrsComputeEngine::from_xlsx_bytes(&xlsx_bytes).expect("from_xlsx_bytes");
    let exported = engine.export_to_xlsx_bytes().expect("export_to_xlsx_bytes");
    let (reparsed, _diags) =
        xlsx_parser::parse_xlsx_to_output(&exported).expect("parse_xlsx_to_output");

    let af_rt = reparsed.sheets[0]
        .auto_filter
        .as_ref()
        .expect("auto_filter dropped when columns are empty");
    assert_eq!(af_rt.range_ref, "A1:C5");
}
