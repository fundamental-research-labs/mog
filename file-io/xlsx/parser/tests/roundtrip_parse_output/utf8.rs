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
fn roundtrip_unicode_text() {
    let original = make_single_sheet(
        "Unicode",
        vec![
            cell(
                0,
                0,
                CellValue::Text(Arc::from("\u{4f60}\u{597d}\u{4e16}\u{754c}")),
            ), // Chinese
            cell(0, 1, CellValue::Text(Arc::from("\u{0410}\u{0411}\u{0412}"))), // Cyrillic
            cell(
                1,
                0,
                CellValue::Text(Arc::from("\u{1f600}\u{1f680}\u{2764}")),
            ), // Emoji
            cell(
                1,
                1,
                CellValue::Text(Arc::from("\u{0639}\u{0631}\u{0628}\u{064a}")),
            ), // Arabic
        ],
    );

    let rt = roundtrip(&original);
    assert_cells_match(&original.sheets[0].cells, &rt.sheets[0].cells, "Unicode");
}

// =============================================================================
// assert_roundtrip_partial() — partial domain comparison
//
// Compares only the fields that ARE currently wired for round-trip export,
// skipping domains that are not yet implemented in the writer (e.g., charts,
// floating objects, slicers, form controls, OLE objects, SmartArt, connectors).
//
// This allows broad round-trip testing of multi-domain ParseOutputs without
// failing on unimplemented export paths.
// =============================================================================
// UTF-8 multi-byte preservation (regression tests)
// =============================================================================

/// Regression test: en-dash (U+2013) and other multi-byte UTF-8 characters
/// must survive the full XLSX write → parse round-trip in both cell values
/// and formula strings.
#[test]
fn roundtrip_preserves_en_dash_in_cell_values() {
    let original = make_single_sheet(
        "Sheet1",
        vec![
            cell(
                0,
                0,
                CellValue::Text(Arc::from("Amendment – Price Increase")),
            ),
            cell(1, 0, CellValue::Text(Arc::from("N/A – Amendment"))),
            cell(
                2,
                0,
                CellValue::Text(Arc::from("Amendment — Mid-term Upsell")),
            ),
            cell(3, 0, CellValue::Text(Arc::from("• bullet point"))),
            cell(4, 0, CellValue::Text(Arc::from("€100 résumé 日本語 🎉"))),
        ],
    );

    let rt = roundtrip(&original);
    let cells = &rt.sheets[0].cells;

    assert_eq!(
        cells[0].value,
        CellValue::Text(Arc::from("Amendment – Price Increase"))
    );
    assert_eq!(
        cells[1].value,
        CellValue::Text(Arc::from("N/A – Amendment"))
    );
    assert_eq!(
        cells[2].value,
        CellValue::Text(Arc::from("Amendment — Mid-term Upsell"))
    );
    assert_eq!(cells[3].value, CellValue::Text(Arc::from("• bullet point")));
    assert_eq!(
        cells[4].value,
        CellValue::Text(Arc::from("€100 résumé 日本語 🎉"))
    );
}

/// Regression test: en-dash inside formula string literals must survive
/// the XLSX write → parse round-trip.
#[test]
fn roundtrip_preserves_en_dash_in_formula_text() {
    let original = make_single_sheet(
        "Sheet1",
        vec![
            // Formula with en-dash in a string literal, cached value is the en-dash string
            formula_cell(
                0,
                0,
                r#"=IF(A2<>"","N/A – Amendment","OK")"#,
                CellValue::Text(Arc::from("N/A – Amendment")),
            ),
            // Formula with em-dash
            formula_cell(
                1,
                0,
                r#"=IF(B2>0,"Pass — yes","Fail")"#,
                CellValue::Text(Arc::from("Pass — yes")),
            ),
            // A plain value cell referenced by the formulas
            cell(0, 1, CellValue::Text(Arc::from("Contract"))),
            cell(1, 1, CellValue::Number(FiniteF64::new(1.0).unwrap())),
        ],
    );

    let rt = roundtrip(&original);
    let cells = &rt.sheets[0].cells;

    // Find formula cells and verify formula text preserved en-dash
    let f0 = cells.iter().find(|c| c.row == 0 && c.col == 0).unwrap();
    assert!(
        f0.formula.as_deref().unwrap().contains("–"),
        "En-dash lost in formula text: {:?}",
        f0.formula
    );
    assert_eq!(f0.value, CellValue::Text(Arc::from("N/A – Amendment")));

    let f1 = cells.iter().find(|c| c.row == 1 && c.col == 0).unwrap();
    assert!(
        f1.formula.as_deref().unwrap().contains("—"),
        "Em-dash lost in formula text: {:?}",
        f1.formula
    );
    assert_eq!(f1.value, CellValue::Text(Arc::from("Pass — yes")));
}

// =============================================================================
// workbook.xml.rels rId preservation tests
