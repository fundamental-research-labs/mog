#![allow(unused_imports)]

use std::sync::Arc;

use domain_types::{
    AlignmentFormat, BorderFormat, BorderSide, CFCellRange, CFRule, CFStyle, CellData,
    ColDimension, Comment, CommentType, ConditionalFormat, DocumentFormat, DocumentProperties,
    ErrorStyle, FillFormat, FontFormat, FrozenPane, MergeRegion, NamedRange, ParseOutput,
    RowDimension, SheetData, SheetDimensions, TableColumnSpec, TableSpec, ValidationOperator,
    ValidationRule, ValidationSpec,
};
use value_types::{CellError, CellValue, FiniteF64};
use xlsx_parser::parse_xlsx_to_output;
use xlsx_parser::write::write_xlsx_from_parse_output;

// =============================================================================

/// Round-trip a ParseOutput through XLSX write -> parse -> convert.
///
/// Returns the round-tripped ParseOutput for further assertions.
pub(super) fn roundtrip(original: &ParseOutput) -> ParseOutput {
    // Step 1: Write XLSX bytes from ParseOutput
    let bytes = write_xlsx_from_parse_output(original)
        .expect("write_xlsx_from_parse_output should succeed");

    // Sanity: output should be a valid ZIP (starts with PK)
    assert!(
        bytes.len() > 4,
        "XLSX output too small: {} bytes",
        bytes.len()
    );
    assert_eq!(&bytes[0..2], b"PK", "Output is not a valid ZIP archive");

    // Step 2: Parse the XLSX bytes back into ParseOutput
    let (round_tripped, _diagnostics) =
        parse_xlsx_to_output(&bytes).expect("parse_xlsx_to_output should succeed");

    round_tripped
}

/// Helper: create a minimal ParseOutput with one sheet and given cells.
pub(super) fn make_single_sheet(name: &str, cells: Vec<CellData>) -> ParseOutput {
    let max_row = cells.iter().map(|c| c.row).max().unwrap_or(0);
    let max_col = cells.iter().map(|c| c.col).max().unwrap_or(0);
    ParseOutput {
        sheets: vec![SheetData {
            name: name.to_string(),
            rows: max_row + 1,
            cols: max_col + 1,
            cells,
            ..Default::default()
        }],
        ..Default::default()
    }
}

/// Helper: create a CellData with just a value at (row, col).
pub(super) fn cell(row: u32, col: u32, value: CellValue) -> CellData {
    CellData {
        row,
        col,
        value,
        formula: None,
        array_ref: None,
        style_id: None,
        cell_formula: None,
        ..Default::default()
    }
}

/// Helper: create a CellData with a formula at (row, col).
pub(super) fn formula_cell(row: u32, col: u32, formula: &str, cached: CellValue) -> CellData {
    CellData {
        row,
        col,
        value: cached,
        formula: Some(formula.to_string()),
        array_ref: None,
        style_id: None,
        cell_formula: None,
        ..Default::default()
    }
}

/// Helper: create a CellData with a style_id.
pub(super) fn styled_cell(row: u32, col: u32, value: CellValue, style_id: u32) -> CellData {
    CellData {
        row,
        col,
        value,
        formula: None,
        array_ref: None,
        style_id: Some(style_id),
        cell_formula: None,
        ..Default::default()
    }
}

/// Assert two ParseOutputs have the same cell values (ignoring style differences).
pub(super) fn assert_cells_match(
    original: &[CellData],
    round_tripped: &[CellData],
    sheet_name: &str,
) {
    // Build maps by (row, col) for flexible comparison -- cell order may differ
    let orig_map: std::collections::HashMap<(u32, u32), &CellData> =
        original.iter().map(|c| ((c.row, c.col), c)).collect();
    let rt_map: std::collections::HashMap<(u32, u32), &CellData> =
        round_tripped.iter().map(|c| ((c.row, c.col), c)).collect();

    // Check all original cells exist in round-tripped
    for ((row, col), orig_cell) in &orig_map {
        // Skip empty/null cells -- the parser may drop them
        if matches!(orig_cell.value, CellValue::Null) && orig_cell.formula.is_none() {
            continue;
        }
        // Skip empty text cells -- they are not written to XLSX
        if matches!(&orig_cell.value, CellValue::Text(s) if s.as_ref().is_empty())
            && orig_cell.formula.is_none()
        {
            continue;
        }

        let rt_cell = rt_map.get(&(*row, *col)).unwrap_or_else(|| {
            panic!(
                "[{sheet_name}] Cell ({row}, {col}) missing in round-trip. Original value: {:?}",
                orig_cell.value
            )
        });

        // Compare values with epsilon for floats
        match (&orig_cell.value, &rt_cell.value) {
            (CellValue::Number(a), CellValue::Number(b)) => {
                let diff = (a.get() - b.get()).abs();
                assert!(
                    diff < 1e-10,
                    "[{sheet_name}] Cell ({row}, {col}): number mismatch {a:?} vs {b:?} (diff={diff})"
                );
            }
            (a, b) => {
                assert_eq!(a, b, "[{sheet_name}] Cell ({row}, {col}): value mismatch");
            }
        }

        // Compare formulas
        assert_eq!(
            orig_cell.formula, rt_cell.formula,
            "[{sheet_name}] Cell ({row}, {col}): formula mismatch"
        );
    }
}
