use std::sync::Arc;

use super::helpers::*;
use domain_types::{AutoFilter, FilterColumn, OoxmlFilterType};
use value_types::{CellValue, FiniteF64};

#[test]
fn roundtrip_auto_filter_basic() {
    // NOTE: The parser does not yet convert auto_filter XML back into the structured
    // AutoFilter type (see to_parse_output.rs pass 7 TODO). This test verifies the
    // writer produces valid XLSX (no crash) and documents the current round-trip gap.
    let mut output = make_single_sheet(
        "Sheet1",
        vec![
            cell(0, 0, CellValue::Text(Arc::from("Header1".to_string()))),
            cell(0, 1, CellValue::Text(Arc::from("Header2".to_string()))),
            cell(1, 0, CellValue::Number(FiniteF64::new(1.0).unwrap())),
            cell(1, 1, CellValue::Number(FiniteF64::new(2.0).unwrap())),
            cell(2, 0, CellValue::Number(FiniteF64::new(3.0).unwrap())),
            cell(2, 1, CellValue::Number(FiniteF64::new(4.0).unwrap())),
        ],
    );
    output.sheets[0].auto_filter = Some(AutoFilter {
        range_ref: "A1:B3".to_string(),
        columns: vec![],
        sort: None,
        xr_uid: None,
        ext_lst_raw: None,
    });
    // Should not panic -- the writer produces valid XLSX even with auto_filter set.
    let rt = roundtrip(&output);
    // Parser does not yet populate auto_filter from XML (known TODO).
    // When parser support is added, upgrade this to assert the range_ref survives.
    if let Some(ref af) = rt.sheets[0].auto_filter {
        assert_eq!(af.range_ref, "A1:B3");
    }
}

#[test]
fn roundtrip_auto_filter_with_column_filter() {
    // NOTE: Same parser limitation as roundtrip_auto_filter_basic.
    let mut output = make_single_sheet(
        "Sheet1",
        vec![
            cell(0, 0, CellValue::Text(Arc::from("Name".to_string()))),
            cell(1, 0, CellValue::Text(Arc::from("Alice".to_string()))),
            cell(2, 0, CellValue::Text(Arc::from("Bob".to_string()))),
        ],
    );
    output.sheets[0].auto_filter = Some(AutoFilter {
        range_ref: "A1:A3".to_string(),
        columns: vec![FilterColumn {
            col_index: 0,
            filter_type: Some(OoxmlFilterType::Values {
                values: vec!["Alice".to_string()],
                blanks: false,
                calendar_type: None,
                date_group_items: Vec::new(),
            }),
            ..Default::default()
        }],
        sort: None,
        xr_uid: None,
        ext_lst_raw: None,
    });
    // Should not panic -- the writer handles filter columns correctly.
    let rt = roundtrip(&output);
    // Parser does not yet populate auto_filter from XML (known TODO).
    if let Some(ref af) = rt.sheets[0].auto_filter {
        assert_eq!(af.range_ref, "A1:A3");
    }
}
