use super::super::{
    convert_cell, full_parse_result_to_parse_output, parse_error_code, resolve_cell_value,
};
use super::helpers::{test_cell, threading_result};
use crate::output::results::{
    CELL_TYPE_VAL_BOOL as CELL_TYPE_BOOL, CELL_TYPE_VAL_EMPTY as CELL_TYPE_EMPTY,
    CELL_TYPE_VAL_FORMULA as CELL_TYPE_FORMULA, CELL_TYPE_VAL_NUMBER as CELL_TYPE_NUMBER,
    CELL_TYPE_VAL_STRING as CELL_TYPE_STRING,
};
use crate::output::results::{
    CellMetadataBlock, CellMetadataRecord, MetadataOutput, MetadataTypeOutput,
};
use crate::output::results::{FullCellData, FullParsedSheet};
use domain_types::ImportedCellProjectionRole;
use value_types::{CellError, CellValue};

#[test]
fn test_parse_error_codes() {
    assert_eq!(parse_error_code("#DIV/0!"), CellError::Div0);
    assert_eq!(parse_error_code("#VALUE!"), CellError::Value);
    assert_eq!(parse_error_code("#REF!"), CellError::Ref);
    assert_eq!(parse_error_code("#NAME?"), CellError::Name);
    assert_eq!(parse_error_code("#NUM!"), CellError::Num);
    assert_eq!(parse_error_code("#N/A"), CellError::Na);
    assert_eq!(parse_error_code("#NULL!"), CellError::Null);
    assert_eq!(parse_error_code("#SPILL!"), CellError::Spill);
    assert_eq!(parse_error_code("#CALC!"), CellError::Calc);
    assert_eq!(parse_error_code("unknown"), CellError::Value);
}

#[test]
fn test_resolve_cell_value_number() {
    let cell = FullCellData {
        row: 0,
        col: 0,
        cell_type: CELL_TYPE_NUMBER,
        style_idx: 0,
        value: Some("42.5".to_string()),
        formula: None,
        force_recalc: false,
        array_ref: None,
        cell_metadata_index: None,
        vm: None,
        phonetic: false,
        date_lexical_value: None,
        cached_value_type: 0,
        cell_formula: None,
        preserve_space_formula: false,
        preserve_space_value: false,
        sst_index: None,
        has_explicit_style: false,
    };
    match resolve_cell_value(&cell, &[]) {
        CellValue::Number(n) => assert_eq!(n.get(), 42.5),
        other => panic!("Expected Number, got {:?}", other),
    }
}

#[test]
fn projection_roles_preserve_authored_cm_cells_and_classify_only_proven_spills() {
    let sheet = FullParsedSheet {
        cells: vec![
            test_cell(0, 0, Some("1"), Some("SEQUENCE(2,2)"), Some("A1:B2"), true),
            test_cell(0, 1, Some("2"), None, None, true),
            test_cell(5, 30, Some("35.676741130091997"), None, None, true),
            test_cell(6, 30, Some("42"), None, None, false),
        ],
        ..FullParsedSheet::default()
    };
    let mut result = threading_result(sheet, None, Vec::new());
    result.metadata = Some(MetadataOutput {
        metadata_types: vec![MetadataTypeOutput {
            name: "XLDAPR".to_string(),
            ..Default::default()
        }],
        cell_metadata: vec![CellMetadataBlock {
            records: vec![CellMetadataRecord { t: 1, v: 0 }],
        }],
        ..Default::default()
    });

    let (output, _diagnostics) = full_parse_result_to_parse_output(&result);
    let cells = &output.sheets[0].cells;
    assert_eq!(cells.len(), 4);

    let role_at = |row, col| {
        cells
            .iter()
            .find(|cell| cell.row == row && cell.col == col)
            .map(|cell| cell.projection_role)
            .expect("cell exists")
    };

    assert_eq!(
        role_at(0, 0),
        ImportedCellProjectionRole::DynamicArraySource
    );
    assert_eq!(
        role_at(0, 1),
        ImportedCellProjectionRole::DynamicArraySpillTarget
    );
    assert_eq!(
        role_at(5, 30),
        ImportedCellProjectionRole::UnknownCellMetadata
    );
    assert_eq!(role_at(6, 30), ImportedCellProjectionRole::Normal);

    let authored_cm = cells
        .iter()
        .find(|cell| cell.row == 5 && cell.col == 30)
        .expect("authored cm cell is preserved");
    assert_eq!(authored_cm.cell_metadata_index, Some(1));
    assert!(authored_cm.formula.is_none());
    assert_eq!(
        authored_cm.original_value.as_deref(),
        Some("35.676741130091997")
    );
}

#[test]
fn test_resolve_cell_value_string() {
    let cell = FullCellData {
        row: 0,
        col: 0,
        cell_type: CELL_TYPE_STRING,
        style_idx: 0,
        value: Some("hello".to_string()),
        formula: None,
        force_recalc: false,
        array_ref: None,
        cell_metadata_index: None,
        vm: None,
        phonetic: false,
        date_lexical_value: None,
        cached_value_type: 0,
        cell_formula: None,
        preserve_space_formula: false,
        preserve_space_value: false,
        sst_index: None,
        has_explicit_style: false,
    };
    match resolve_cell_value(&cell, &[]) {
        CellValue::Text(s) => assert_eq!(&*s, "hello"),
        other => panic!("Expected Text, got {:?}", other),
    }
}

#[test]
fn test_resolve_cell_value_bool() {
    let cell = FullCellData {
        row: 0,
        col: 0,
        cell_type: CELL_TYPE_BOOL,
        style_idx: 0,
        value: Some("1".to_string()),
        formula: None,
        force_recalc: false,
        array_ref: None,
        cell_metadata_index: None,
        vm: None,
        phonetic: false,
        date_lexical_value: None,
        cached_value_type: 0,
        cell_formula: None,
        preserve_space_formula: false,
        preserve_space_value: false,
        sst_index: None,
        has_explicit_style: false,
    };
    match resolve_cell_value(&cell, &[]) {
        CellValue::Boolean(b) => assert!(b),
        other => panic!("Expected Boolean(true), got {:?}", other),
    }
}

#[test]
fn test_resolve_cell_value_empty() {
    let cell = FullCellData {
        row: 0,
        col: 0,
        cell_type: CELL_TYPE_EMPTY,
        style_idx: 0,
        value: None,
        formula: None,
        force_recalc: false,
        array_ref: None,
        cell_metadata_index: None,
        vm: None,
        phonetic: false,
        date_lexical_value: None,
        cached_value_type: 0,
        cell_formula: None,
        preserve_space_formula: false,
        preserve_space_value: false,
        sst_index: None,
        has_explicit_style: false,
    };
    assert_eq!(resolve_cell_value(&cell, &[]), CellValue::Null);
}

#[test]
fn test_convert_cell_with_formula() {
    let cell = FullCellData {
        row: 1,
        col: 2,
        cell_type: CELL_TYPE_FORMULA,
        style_idx: 3,
        value: Some("42".to_string()),
        formula: Some("=A1+B1".to_string()),
        force_recalc: false,
        array_ref: None,
        cell_metadata_index: None,
        vm: None,
        phonetic: false,
        date_lexical_value: None,
        cached_value_type: 0,
        cell_formula: None,
        preserve_space_formula: false,
        preserve_space_value: false,
        sst_index: None,
        has_explicit_style: false,
    };
    let cd = convert_cell(&cell, &[]);
    assert_eq!(cd.row, 1);
    assert_eq!(cd.col, 2);
    assert_eq!(cd.formula, Some("=A1+B1".to_string()));
    assert_eq!(cd.style_id, Some(3));
    match cd.value {
        CellValue::Number(n) => assert_eq!(n.get(), 42.0),
        other => panic!("Expected Number, got {:?}", other),
    }
}
