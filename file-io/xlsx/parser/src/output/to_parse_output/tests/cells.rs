use super::super::{
    build_projection_roles, classify_projection_role, convert_cell,
    full_parse_result_to_parse_output, parse_error_code, resolve_cell_value,
};
use super::helpers::{test_cell, threading_result};
use crate::output::results::{
    CellMetadataBlock, CellMetadataRecord, MetadataOutput, MetadataTypeOutput,
};
use crate::output::results::{FullCellData, FullParsedSheet};
use crate::output::results::{
    CELL_TYPE_VAL_BOOL as CELL_TYPE_BOOL, CELL_TYPE_VAL_EMPTY as CELL_TYPE_EMPTY,
    CELL_TYPE_VAL_FORMULA as CELL_TYPE_FORMULA, CELL_TYPE_VAL_NUMBER as CELL_TYPE_NUMBER,
    CELL_TYPE_VAL_STRING as CELL_TYPE_STRING,
};
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
        has_empty_cached_value: false,
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

fn metadata_with_records(type_names: &[&str], record_types: &[&[u32]]) -> MetadataOutput {
    MetadataOutput {
        metadata_types: type_names
            .iter()
            .map(|name| MetadataTypeOutput {
                name: (*name).to_string(),
                ..Default::default()
            })
            .collect(),
        cell_metadata: record_types
            .iter()
            .map(|types| CellMetadataBlock {
                records: types
                    .iter()
                    .map(|&t| CellMetadataRecord { t, v: 0 })
                    .collect(),
            })
            .collect(),
        ..Default::default()
    }
}

fn cached_cell(row: u32, col: u32, value: &str, cm: Option<u32>) -> FullCellData {
    let mut cell = test_cell(row, col, Some(value), None, None, false);
    cell.cell_metadata_index = cm;
    cell
}

fn marker_cell(row: u32, col: u32, value: &str, cm: Option<u32>) -> FullCellData {
    let mut cell = cached_cell(row, col, value, cm);
    cell.cell_type = CELL_TYPE_FORMULA;
    cell.force_recalc = true;
    cell
}

fn dynamic_source(row: u32, col: u32, array_ref: &str, cm: Option<u32>) -> FullCellData {
    let mut cell = test_cell(
        row,
        col,
        Some("1"),
        Some("SEQUENCE(2,2)"),
        Some(array_ref),
        false,
    );
    cell.cell_metadata_index = cm;
    cell
}

fn role_at(
    roles: &std::collections::HashMap<(u32, u32), ImportedCellProjectionRole>,
    row: u32,
    col: u32,
) -> ImportedCellProjectionRole {
    roles
        .get(&(row, col))
        .copied()
        .unwrap_or(ImportedCellProjectionRole::Normal)
}

#[test]
fn projection_roles_derive_marked_and_unmarked_children_for_1d_and_2d_arrays() {
    let cells = vec![
        dynamic_source(0, 0, "A1:A3", Some(1)),
        marker_cell(1, 0, "cached marker", None),
        cached_cell(2, 0, "cached value", None),
        dynamic_source(0, 2, "C1:D2", Some(1)),
        marker_cell(1, 2, "cached marker", None),
        cached_cell(0, 3, "cached value", Some(1)),
        cached_cell(1, 3, "cached value", None),
    ];
    let metadata = metadata_with_records(&["XLDAPR"], &[&[1]]);

    let roles = build_projection_roles(&cells, Some(&metadata));

    assert_eq!(
        role_at(&roles, 0, 0),
        ImportedCellProjectionRole::DynamicArraySource
    );
    assert_eq!(
        role_at(&roles, 1, 0),
        ImportedCellProjectionRole::DynamicArraySpillTarget
    );
    assert_eq!(
        role_at(&roles, 2, 0),
        ImportedCellProjectionRole::DynamicArraySpillTarget
    );
    assert_eq!(
        role_at(&roles, 0, 2),
        ImportedCellProjectionRole::DynamicArraySource
    );
    assert_eq!(
        role_at(&roles, 1, 2),
        ImportedCellProjectionRole::DynamicArraySpillTarget
    );
    assert_eq!(
        role_at(&roles, 0, 3),
        ImportedCellProjectionRole::DynamicArraySpillTarget
    );
    assert_eq!(
        role_at(&roles, 1, 3),
        ImportedCellProjectionRole::DynamicArraySpillTarget
    );
}

#[test]
fn projection_roles_preserve_cse_formula_anchors_and_unrelated_metadata() {
    let mut authored_formula = cached_cell(2, 1, "21", None);
    authored_formula.cell_type = CELL_TYPE_FORMULA;
    authored_formula.formula = Some("SUM(A1:A3)".to_string());

    let mut peer_array_anchor = cached_cell(1, 2, "13", None);
    peer_array_anchor.cell_type = CELL_TYPE_FORMULA;
    peer_array_anchor.array_ref = Some("C2:C3".to_string());
    peer_array_anchor.cell_formula = Some(ooxml_types::worksheet::CellFormula {
        t: ooxml_types::worksheet::CellFormulaType::Array,
        r#ref: Some("C2:C3".to_string()),
        ..Default::default()
    });

    let mut empty_formula_metadata_marker = marker_cell(1, 1, "12", None);
    empty_formula_metadata_marker.cell_formula = Some(ooxml_types::worksheet::CellFormula {
        ca: true,
        ..Default::default()
    });

    let mut cse_source = dynamic_source(0, 4, "E1:E2", None);
    cse_source.cell_formula = Some(ooxml_types::worksheet::CellFormula {
        t: ooxml_types::worksheet::CellFormulaType::Array,
        r#ref: Some("E1:E2".to_string()),
        ..Default::default()
    });
    let cse_child = cached_cell(1, 4, "15", None);
    let scalar_dynamic_source = dynamic_source(4, 6, "G5", Some(1));
    let unknown_metadata_child = cached_cell(2, 2, "22", Some(2));
    let unknown_metadata_outside = cached_cell(10, 10, "1010", Some(2));
    let dynamic_cm_child = cached_cell(2, 0, "20", Some(1));
    let unmarked_child = marker_cell(1, 0, "marker", None);

    let cells = vec![
        dynamic_source(0, 0, "A1:C3", Some(1)),
        unmarked_child,
        empty_formula_metadata_marker,
        peer_array_anchor,
        dynamic_cm_child,
        cse_source,
        cse_child,
        authored_formula,
        unknown_metadata_child,
        unknown_metadata_outside,
        scalar_dynamic_source,
    ];
    let metadata = metadata_with_records(&["XLDAPR", "XLRICHVALUE"], &[&[1], &[2]]);

    let roles = build_projection_roles(&cells, Some(&metadata));

    assert_eq!(
        role_at(&roles, 0, 0),
        ImportedCellProjectionRole::DynamicArraySource
    );
    assert_eq!(
        role_at(&roles, 1, 0),
        ImportedCellProjectionRole::DynamicArraySpillTarget
    );
    assert_eq!(
        role_at(&roles, 2, 0),
        ImportedCellProjectionRole::DynamicArraySpillTarget
    );
    assert_eq!(
        role_at(&roles, 1, 1),
        ImportedCellProjectionRole::DynamicArraySpillTarget,
        "an empty normal CellFormula carrying ca=1 is still a spill marker"
    );
    assert_eq!(role_at(&roles, 1, 2), ImportedCellProjectionRole::Normal);
    assert_eq!(role_at(&roles, 1, 4), ImportedCellProjectionRole::Normal);
    assert_eq!(
        role_at(&roles, 2, 2),
        ImportedCellProjectionRole::UnknownCellMetadata
    );
    assert_eq!(
        role_at(&roles, 10, 10),
        ImportedCellProjectionRole::UnknownCellMetadata
    );
    assert_eq!(
        role_at(&roles, 2, 1),
        ImportedCellProjectionRole::Normal,
        "an authored formula inside a dynamic range remains independent"
    );

    // The source at E1 has a legacy CSE range but no XLDAPR metadata, so its
    // cache and its peer remain ordinary cells.
    assert_eq!(role_at(&roles, 0, 4), ImportedCellProjectionRole::Normal);
    assert_eq!(role_at(&roles, 1, 4), ImportedCellProjectionRole::Normal);
    assert_eq!(
        role_at(&roles, 4, 6),
        ImportedCellProjectionRole::DynamicArraySource,
        "a scalar ref is a valid dynamic-array source declaration"
    );

    let malformed_ranges = vec![
        dynamic_source(0, 0, "B1:C2", Some(1)),
        dynamic_source(3, 0, "A4:A3", Some(1)),
        dynamic_source(5, 0, "A:A", Some(1)),
        dynamic_source(7, 0, "1:3", Some(1)),
        dynamic_source(9, 0, "Other!A10:A11", Some(1)),
    ];
    let malformed_roles = build_projection_roles(&malformed_ranges, Some(&metadata));
    assert!(malformed_roles.is_empty());

    // A caller-provided reversed claim is also ignored by the bounded
    // classifier rather than being normalized into a different source.
    let reversed = cached_cell(0, 0, "1", None);
    assert_eq!(
        classify_projection_role(&reversed, &[(1, 1, 0, 1)], Some(&metadata)),
        ImportedCellProjectionRole::Normal
    );
}

#[test]
fn projection_roles_reject_ambiguous_overlapping_dynamic_claims() {
    let cells = vec![
        dynamic_source(0, 0, "A1:B2", Some(1)),
        dynamic_source(0, 1, "B1:C2", Some(1)),
        cached_cell(1, 0, "11", None),
        cached_cell(1, 1, "12", None),
        cached_cell(1, 2, "13", None),
    ];
    let metadata = metadata_with_records(&["XLDAPR"], &[&[1]]);

    let roles = build_projection_roles(&cells, Some(&metadata));

    assert_eq!(
        role_at(&roles, 0, 0),
        ImportedCellProjectionRole::DynamicArraySource
    );
    assert_eq!(
        role_at(&roles, 0, 1),
        ImportedCellProjectionRole::DynamicArraySource,
        "the peer source remains a source even though its range overlaps"
    );
    assert_eq!(
        role_at(&roles, 1, 0),
        ImportedCellProjectionRole::DynamicArraySpillTarget
    );
    assert_eq!(
        role_at(&roles, 1, 1),
        ImportedCellProjectionRole::Normal,
        "an overlapping child is ambiguous and must remain authored"
    );
    assert_eq!(
        role_at(&roles, 1, 2),
        ImportedCellProjectionRole::DynamicArraySpillTarget
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
        has_empty_cached_value: false,
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
        has_empty_cached_value: false,
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
        has_empty_cached_value: false,
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
        has_empty_cached_value: false,
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
