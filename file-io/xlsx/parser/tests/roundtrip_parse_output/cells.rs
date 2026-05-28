#![allow(unused_imports)]

use std::sync::Arc;

use super::helpers::{
    assert_cells_match, cell, formula_cell, make_single_sheet, roundtrip, styled_cell,
};
use domain_types::{
    AlignmentFormat, BorderFormat, BorderSide, CFCellRange, CFRule, CFStyle, CellData,
    ColDimension, Comment, CommentType, ConditionalFormat, DocumentFormat, DocumentProperties,
    ErrorStyle, FillFormat, FontFormat, FrozenPane, MergeRegion, NamedRange, ParseOutput,
    RowDimension, SheetData, SheetDimensions, TableColumnSpec, TableSpec, ValidationOperator,
    ValidationRule, ValidationSpec,
};
use value_types::{CellError, CellValue, FiniteF64};

#[test]
fn roundtrip_number_cells() {
    let original = make_single_sheet(
        "Numbers",
        vec![
            cell(0, 0, CellValue::Number(FiniteF64::new(42.0).unwrap())),
            cell(0, 1, CellValue::Number(FiniteF64::new(0.0).unwrap())),
            cell(0, 2, CellValue::Number(FiniteF64::new(-123.456).unwrap())),
            cell(1, 0, CellValue::Number(FiniteF64::new(1e15).unwrap())),
            cell(1, 1, CellValue::Number(FiniteF64::new(0.000001).unwrap())),
        ],
    );

    let rt = roundtrip(&original);
    assert_eq!(rt.sheets.len(), 1);
    assert_cells_match(&original.sheets[0].cells, &rt.sheets[0].cells, "Numbers");
}

#[test]
fn roundtrip_text_cells() {
    let original = make_single_sheet(
        "Text",
        vec![
            cell(0, 0, CellValue::Text(Arc::from("Hello, World!"))),
            cell(0, 1, CellValue::Text(Arc::from(""))),
            cell(1, 0, CellValue::Text(Arc::from("Line1\nLine2"))),
            cell(
                1,
                1,
                CellValue::Text(Arc::from("Special <chars> & \"quotes\"")),
            ),
            cell(
                2,
                0,
                CellValue::Text(Arc::from("Unicode: \u{00e9}\u{00f1}\u{00fc}")),
            ),
        ],
    );

    let rt = roundtrip(&original);
    assert_eq!(rt.sheets.len(), 1);
    assert_cells_match(&original.sheets[0].cells, &rt.sheets[0].cells, "Text");
}

#[test]
fn roundtrip_boolean_cells() {
    let original = make_single_sheet(
        "Booleans",
        vec![
            cell(0, 0, CellValue::Boolean(true)),
            cell(0, 1, CellValue::Boolean(false)),
        ],
    );

    let rt = roundtrip(&original);
    assert_eq!(rt.sheets.len(), 1);
    assert_cells_match(&original.sheets[0].cells, &rt.sheets[0].cells, "Booleans");
}

#[test]
fn roundtrip_error_cells() {
    let original = make_single_sheet(
        "Errors",
        vec![
            cell(0, 0, CellValue::Error(CellError::Div0, None)),
            cell(0, 1, CellValue::Error(CellError::Value, None)),
            cell(0, 2, CellValue::Error(CellError::Ref, None)),
            cell(1, 0, CellValue::Error(CellError::Name, None)),
            cell(1, 1, CellValue::Error(CellError::Null, None)),
            cell(1, 2, CellValue::Error(CellError::Na, None)),
        ],
    );

    let rt = roundtrip(&original);
    assert_eq!(rt.sheets.len(), 1);
    assert_cells_match(&original.sheets[0].cells, &rt.sheets[0].cells, "Errors");
}

#[test]
fn roundtrip_null_cells_dropped() {
    let original = make_single_sheet(
        "Nulls",
        vec![
            cell(0, 0, CellValue::Number(FiniteF64::new(1.0).unwrap())),
            cell(0, 1, CellValue::Null),
            cell(1, 0, CellValue::Null),
            cell(1, 1, CellValue::Number(FiniteF64::new(2.0).unwrap())),
        ],
    );

    let rt = roundtrip(&original);
    assert_eq!(rt.sheets.len(), 1);

    // Non-null cells should survive
    assert_cells_match(&original.sheets[0].cells, &rt.sheets[0].cells, "Nulls");

    // Null cells may be dropped -- verify non-null cells exist
    let rt_map: std::collections::HashMap<(u32, u32), &CellData> = rt.sheets[0]
        .cells
        .iter()
        .map(|c| ((c.row, c.col), c))
        .collect();
    assert!(
        rt_map.contains_key(&(0, 0)),
        "Non-null cell (0,0) must survive"
    );
    assert!(
        rt_map.contains_key(&(1, 1)),
        "Non-null cell (1,1) must survive"
    );
}

#[test]
fn roundtrip_mixed_cell_types() {
    let original = make_single_sheet(
        "Mixed",
        vec![
            cell(0, 0, CellValue::Number(FiniteF64::new(1.0).unwrap())),
            cell(0, 1, CellValue::Text(Arc::from("text"))),
            cell(0, 2, CellValue::Boolean(true)),
            cell(0, 3, CellValue::Error(CellError::Div0, None)),
            cell(0, 4, CellValue::Null),
        ],
    );

    let rt = roundtrip(&original);
    assert_eq!(rt.sheets.len(), 1);
    assert_cells_match(&original.sheets[0].cells, &rt.sheets[0].cells, "Mixed");
}

#[test]
fn roundtrip_formula_cells() {
    let original = make_single_sheet(
        "Formulas",
        vec![
            cell(0, 0, CellValue::Number(FiniteF64::new(10.0).unwrap())),
            cell(0, 1, CellValue::Number(FiniteF64::new(20.0).unwrap())),
            formula_cell(
                1,
                0,
                "A1+B1",
                CellValue::Number(FiniteF64::new(30.0).unwrap()),
            ),
            formula_cell(
                1,
                1,
                "SUM(A1:B1)",
                CellValue::Number(FiniteF64::new(30.0).unwrap()),
            ),
        ],
    );

    let rt = roundtrip(&original);
    assert_eq!(rt.sheets.len(), 1);
    assert_cells_match(&original.sheets[0].cells, &rt.sheets[0].cells, "Formulas");
}

#[test]
fn roundtrip_formula_with_text_result() {
    let original = make_single_sheet(
        "FormulaText",
        vec![
            cell(0, 0, CellValue::Text(Arc::from("Hello"))),
            cell(0, 1, CellValue::Text(Arc::from(" World"))),
            formula_cell(1, 0, "A1&B1", CellValue::Text(Arc::from("Hello World"))),
        ],
    );

    let rt = roundtrip(&original);
    assert_eq!(rt.sheets.len(), 1);
    assert_cells_match(
        &original.sheets[0].cells,
        &rt.sheets[0].cells,
        "FormulaText",
    );
}

#[test]
fn roundtrip_formula_with_boolean_result() {
    let original = make_single_sheet(
        "FormulaBool",
        vec![
            cell(0, 0, CellValue::Number(FiniteF64::new(5.0).unwrap())),
            cell(0, 1, CellValue::Number(FiniteF64::new(10.0).unwrap())),
            formula_cell(1, 0, "A1>B1", CellValue::Boolean(false)),
            formula_cell(1, 1, "A1<B1", CellValue::Boolean(true)),
        ],
    );

    let rt = roundtrip(&original);
    assert_eq!(rt.sheets.len(), 1);
    assert_cells_match(
        &original.sheets[0].cells,
        &rt.sheets[0].cells,
        "FormulaBool",
    );
}

#[test]
fn roundtrip_formula_with_error_result() {
    let original = make_single_sheet(
        "FormulaErr",
        vec![
            cell(0, 0, CellValue::Number(FiniteF64::new(0.0).unwrap())),
            formula_cell(1, 0, "1/A1", CellValue::Error(CellError::Div0, None)),
        ],
    );

    let rt = roundtrip(&original);
    assert_eq!(rt.sheets.len(), 1);
    assert_cells_match(&original.sheets[0].cells, &rt.sheets[0].cells, "FormulaErr");
}

// =============================================================================
// 6d: Layout round-trip tests
// =============================================================================
