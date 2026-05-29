//! End-to-end round-trip tests for worksheet-level `<sortState>`.
//!
//! Typed OOXML preservation: inventory row 5.3 replaced the prior raw-XML sidecar
//! (sort state) with a typed field
//! (`SheetData.sort_state`). Before the typing, the writer would silently
//! drop worksheet-level sort state on any path where the blob was absent —
//! most notably the Yrs hydration path. These tests lock the correctness
//! fix: write → re-parse preserves sort state even when no raw blob exists
//! (i.e. the `ParseOutput` was built from the typed field alone).

use domain_types::{
    ParseOutput, SheetData, SheetDimensions, SortCondition, SortConditionBy, SortMethod, SortState,
};
use xlsx_parser::parse_xlsx_to_output;
use xlsx_parser::write::write_xlsx_from_parse_output;

fn make_sheet_with_sort_state(sort_state: SortState) -> ParseOutput {
    ParseOutput {
        sheets: vec![SheetData {
            name: "Sheet1".to_string(),
            rows: 20,
            cols: 4,
            cells: Vec::new(),
            dimensions: SheetDimensions::default(),
            sort_state: Some(sort_state),
            ..Default::default()
        }],
        ..Default::default()
    }
}

#[test]
fn sort_state_typed_field_round_trips_losslessly() {
    let original = SortState {
        range_ref: "A1:D20".to_string(),
        namespace_attrs: vec![(
            "xlrd2".to_string(),
            "http://schemas.microsoft.com/office/spreadsheetml/2017/richdata2".to_string(),
        )],
        column_sort: false,
        case_sensitive: true,
        sort_method: SortMethod::PinYin,
        conditions: vec![
            SortCondition {
                range_ref: "A1:A20".to_string(),
                descending: true,
                sort_by: SortConditionBy::Value,
                custom_list: Some("High,Med,Low".to_string()),
                dxf_id: None,
                icon_set: None,
                icon_id: None,
            },
            SortCondition {
                range_ref: "B1:B20".to_string(),
                descending: false,
                sort_by: SortConditionBy::CellColor,
                custom_list: None,
                dxf_id: Some(7),
                icon_set: None,
                icon_id: None,
            },
        ],
        ext_lst_raw: None,
    };

    let po = make_sheet_with_sort_state(original.clone());
    let bytes = write_xlsx_from_parse_output(&po).expect("write");
    assert_eq!(&bytes[0..2], b"PK");

    let (rt, _diag) = parse_xlsx_to_output(&bytes).expect("parse");
    let ss = rt.sheets[0]
        .sort_state
        .as_ref()
        .expect("sort_state lost during round trip — regressing correctness fix for inventory 5.3");
    assert_eq!(ss, &original);
}

#[test]
fn sort_state_element_local_namespace_round_trips() {
    let original_xml = br#"<sortState ref="C323:C326" xmlns:xlrd2="http://schemas.microsoft.com/office/spreadsheetml/2017/richdata2"><sortCondition ref="C324:C326"/></sortState>"#;
    let parsed = xlsx_parser::domain::worksheet::read::parse_standalone_sort_state(original_xml)
        .expect("parse sortState with element-local namespace");

    assert_eq!(
        parsed.namespace_attrs,
        vec![(
            "xlrd2".to_string(),
            "http://schemas.microsoft.com/office/spreadsheetml/2017/richdata2".to_string()
        )]
    );

    let po = make_sheet_with_sort_state(parsed);
    let bytes = write_xlsx_from_parse_output(&po).expect("write");
    let (rt, _diag) = parse_xlsx_to_output(&bytes).expect("parse");
    let ss = rt.sheets[0]
        .sort_state
        .as_ref()
        .expect("sort_state lost during round trip");
    assert_eq!(
        ss.namespace_attrs,
        vec![(
            "xlrd2".to_string(),
            "http://schemas.microsoft.com/office/spreadsheetml/2017/richdata2".to_string()
        )]
    );
}

#[test]
fn sort_state_minimal_round_trips() {
    let original = SortState {
        range_ref: "A1:C10".to_string(),
        ..Default::default()
    };

    let po = make_sheet_with_sort_state(original.clone());
    let bytes = write_xlsx_from_parse_output(&po).expect("write");
    let (rt, _diag) = parse_xlsx_to_output(&bytes).expect("parse");
    let ss = rt.sheets[0]
        .sort_state
        .as_ref()
        .expect("sort_state lost during round trip");
    assert_eq!(ss.range_ref, "A1:C10");
    assert!(!ss.column_sort);
    assert!(!ss.case_sensitive);
    assert_eq!(ss.sort_method, SortMethod::None);
    assert!(ss.conditions.is_empty());
}

#[test]
fn sort_state_icon_condition_round_trips() {
    let original = SortState {
        range_ref: "B2:B10".to_string(),
        conditions: vec![SortCondition {
            range_ref: "B2:B10".to_string(),
            sort_by: SortConditionBy::Icon,
            icon_set: Some(ooxml_types::cond_format::IconSetType::ThreeTrafficLights1),
            icon_id: Some(1),
            ..Default::default()
        }],
        ..Default::default()
    };

    let po = make_sheet_with_sort_state(original.clone());
    let bytes = write_xlsx_from_parse_output(&po).expect("write");
    let (rt, _diag) = parse_xlsx_to_output(&bytes).expect("parse");
    let ss = rt.sheets[0].sort_state.as_ref().expect("sort_state");
    assert_eq!(ss.conditions.len(), 1);
    assert_eq!(ss.conditions[0].sort_by, SortConditionBy::Icon);
    assert_eq!(
        ss.conditions[0].icon_set,
        Some(ooxml_types::cond_format::IconSetType::ThreeTrafficLights1),
    );
    assert_eq!(ss.conditions[0].icon_id, Some(1));
}
