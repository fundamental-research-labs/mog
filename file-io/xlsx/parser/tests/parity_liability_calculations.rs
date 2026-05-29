//! Parity tests for liability-calculation spreadsheet patterns.
//!
//! Two bug patterns are covered:
//! 1. Wide horizontal merges with empty sub-cells (A1:P1 = 16 columns)
//! 2. Spacer column/row dimensions with mixed custom widths/heights
//!
//! Each pattern has a parse-level test (loads a synthetic XLSX fixture from
//! `test-corpus/parity/cells/`) and a round-trip test (builds a ParseOutput
//! programmatically, writes it to XLSX, re-parses, and compares).

use std::sync::Arc;

use domain_types::{
    CellData, ColDimension, MergeRegion, ParseOutput, RowDimension, SheetData, SheetDimensions,
};
use value_types::CellValue;
use xlsx_parser::parse_xlsx_to_output;
use xlsx_parser::write::write_xlsx_from_parse_output;

// =============================================================================
// Test infrastructure
// =============================================================================

/// Round-trip a ParseOutput through XLSX write -> parse -> convert.
fn roundtrip(original: &ParseOutput) -> ParseOutput {
    let bytes = write_xlsx_from_parse_output(original)
        .expect("write_xlsx_from_parse_output should succeed");

    assert!(
        bytes.len() > 4,
        "XLSX output too small: {} bytes",
        bytes.len()
    );
    assert_eq!(&bytes[0..2], b"PK", "Output is not a valid ZIP archive");

    let (rt, _diagnostics) =
        parse_xlsx_to_output(&bytes).expect("parse_xlsx_to_output should succeed");
    rt
}

/// Helper: create a CellData with just a value at (row, col).
fn cell(row: u32, col: u32, value: CellValue) -> CellData {
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

/// Helper: build a minimal ParseOutput with one sheet and given cells.
fn make_single_sheet(name: &str, cells: Vec<CellData>) -> ParseOutput {
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

/// Assert that a float `actual` is within `tolerance` of `expected`.
fn assert_approx(actual: f64, expected: f64, tolerance: f64, label: &str) {
    let diff = (actual - expected).abs();
    assert!(
        diff <= tolerance,
        "{label}: expected {expected} ± {tolerance}, got {actual} (diff={diff})"
    );
}

// =============================================================================
// Parse-level tests — load synthetic XLSX fixtures from disk
// =============================================================================

#[test]
fn parse_wide_merge_empty_subcells() {
    let bytes = std::fs::read(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("test-corpus/parity/cells/wide-merge-empty-subcells.xlsx"),
    )
    .expect("fixture file wide-merge-empty-subcells.xlsx should exist");

    let (parsed, _diag) = parse_xlsx_to_output(&bytes).expect("parse should succeed");

    let sheet = &parsed.sheets[0];

    // --- Merge region assertions ---
    assert_eq!(
        sheet.merges.len(),
        1,
        "Expected exactly 1 merge region, found {}",
        sheet.merges.len()
    );

    let merge = &sheet.merges[0];
    assert_eq!(merge.start_row, 0, "merge start_row");
    assert_eq!(merge.start_col, 0, "merge start_col");
    assert_eq!(merge.end_row, 0, "merge end_row");
    assert_eq!(merge.end_col, 15, "merge end_col (A1:P1 = cols 0..15)");

    // --- Cell value assertions ---
    // Cell (0,0) should have text "Liability Calculations"
    let top_left = sheet
        .cells
        .iter()
        .find(|c| c.row == 0 && c.col == 0)
        .expect("cell (0,0) should exist");
    match &top_left.value {
        CellValue::Text(s) => assert_eq!(
            s.as_ref(),
            "Liability Calculations",
            "cell (0,0) text content"
        ),
        other => panic!("cell (0,0) expected Text, got {:?}", other),
    }

    // Cells (0,1) through (0,15) should have no value (absent or Null)
    for col in 1..=15u32 {
        let maybe_cell = sheet.cells.iter().find(|c| c.row == 0 && c.col == col);
        if let Some(c) = maybe_cell {
            assert!(
                matches!(c.value, CellValue::Null),
                "cell (0,{col}) should be absent or Null, got {:?}",
                c.value
            );
        }
        // If not present at all, that's fine — empty sub-cells are correctly omitted.
    }
}

#[test]
fn parse_spacer_content_dimensions() {
    let bytes = std::fs::read(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("test-corpus/parity/cells/spacer-content-dimensions.xlsx"),
    )
    .expect("fixture file spacer-content-dimensions.xlsx should exist");

    let (parsed, _diag) = parse_xlsx_to_output(&bytes).expect("parse should succeed");

    let sheet = &parsed.sheets[0];
    let dims = &sheet.dimensions;

    // --- Default dimensions ---
    assert_approx(
        dims.default_col_width.unwrap_or(0.0),
        9.140625,
        0.01,
        "default_col_width",
    );
    assert_approx(
        dims.default_row_height.unwrap_or(0.0),
        15.0,
        0.01,
        "default_row_height",
    );

    // --- Column dimensions ---
    assert_eq!(
        dims.col_widths.len(),
        6,
        "Expected 6 ColDimension entries, found {}",
        dims.col_widths.len()
    );

    let expected_col_widths: [(u32, f64); 6] = [
        (0, 3.71),
        (1, 17.71),
        (2, 2.28),
        (3, 17.71),
        (4, 2.28),
        (5, 17.71),
    ];

    for (expected_col, expected_width) in &expected_col_widths {
        let col_dim = dims
            .col_widths
            .iter()
            .find(|cd| cd.col == *expected_col)
            .unwrap_or_else(|| panic!("ColDimension for col {} not found", expected_col));
        assert_approx(
            col_dim.width,
            *expected_width,
            0.01,
            &format!("col {} width", expected_col),
        );
        assert!(
            col_dim.custom_width,
            "col {} should have custom_width=true",
            expected_col
        );
    }

    // --- Row dimensions ---
    assert_eq!(
        dims.row_heights.len(),
        5,
        "Expected 5 RowDimension entries, found {}",
        dims.row_heights.len()
    );

    let expected_row_heights: [(u32, f64); 5] =
        [(0, 69.75), (1, 60.0), (2, 6.0), (3, 15.0), (4, 79.5)];

    for (expected_row, expected_height) in &expected_row_heights {
        let row_dim = dims
            .row_heights
            .iter()
            .find(|rd| rd.row == *expected_row)
            .unwrap_or_else(|| panic!("RowDimension for row {} not found", expected_row));
        assert_approx(
            row_dim.height,
            *expected_height,
            0.01,
            &format!("row {} height", expected_row),
        );
    }

    // --- Verify spacer columns (2.28) and spacer rows (6pt) are present ---
    let spacer_cols: Vec<&ColDimension> = dims
        .col_widths
        .iter()
        .filter(|cd| (cd.width - 2.28).abs() < 0.01)
        .collect();
    assert_eq!(
        spacer_cols.len(),
        2,
        "Expected 2 spacer columns (width ≈ 2.28), found {}",
        spacer_cols.len()
    );

    let spacer_rows: Vec<&RowDimension> = dims
        .row_heights
        .iter()
        .filter(|rd| (rd.height - 6.0).abs() < 0.01)
        .collect();
    assert_eq!(
        spacer_rows.len(),
        1,
        "Expected 1 spacer row (height ≈ 6pt), found {}",
        spacer_rows.len()
    );
}

// =============================================================================
// Round-trip tests — build ParseOutput, write→parse→compare
// =============================================================================

#[test]
fn roundtrip_wide_horizontal_merge() {
    let mut po = make_single_sheet(
        "Merges",
        vec![cell(
            0,
            0,
            CellValue::Text(Arc::from("Liability Calculations")),
        )],
    );

    // Widen the sheet to cover the merge range.
    po.sheets[0].cols = 16;

    // Add the wide merge: A1:P1 (row 0, cols 0–15).
    po.sheets[0].merges.push(MergeRegion {
        start_row: 0,
        start_col: 0,
        end_row: 0,
        end_col: 15,
    });

    let rt = roundtrip(&po);

    assert_eq!(rt.sheets.len(), 1);
    let sheet = &rt.sheets[0];

    // --- Merge preserved ---
    assert_eq!(
        sheet.merges.len(),
        1,
        "Expected 1 merge region after round-trip, found {}",
        sheet.merges.len()
    );
    let merge = &sheet.merges[0];
    assert_eq!(merge.start_row, 0, "rt merge start_row");
    assert_eq!(merge.start_col, 0, "rt merge start_col");
    assert_eq!(merge.end_row, 0, "rt merge end_row");
    assert_eq!(merge.end_col, 15, "rt merge end_col");

    // --- Cell (0,0) preserved ---
    let top_left = sheet
        .cells
        .iter()
        .find(|c| c.row == 0 && c.col == 0)
        .expect("cell (0,0) should exist after round-trip");
    match &top_left.value {
        CellValue::Text(s) => assert_eq!(s.as_ref(), "Liability Calculations"),
        other => panic!("cell (0,0) expected Text after round-trip, got {:?}", other),
    }

    // --- No extra cells in the sub-cell range (0,1)-(0,15) ---
    for col in 1..=15u32 {
        let maybe_cell = sheet.cells.iter().find(|c| c.row == 0 && c.col == col);
        if let Some(c) = maybe_cell {
            assert!(
                matches!(c.value, CellValue::Null),
                "cell (0,{col}) should be absent or Null after round-trip, got {:?}",
                c.value
            );
        }
    }
}

#[test]
fn roundtrip_spacer_content_dimensions() {
    let cells = vec![
        cell(0, 0, CellValue::Text(Arc::from("Header"))),
        cell(1, 0, CellValue::Text(Arc::from("Content"))),
        cell(2, 0, CellValue::Text(Arc::from("Spacer"))),
        cell(0, 1, CellValue::Text(Arc::from("Wide Col"))),
    ];

    let mut po = make_single_sheet("Dimensions", cells);

    // Set dimensions on the sheet.
    po.sheets[0].dimensions = SheetDimensions {
        default_row_height: Some(15.0),
        default_col_width: Some(9.140625),
        col_widths: vec![
            ColDimension {
                col: 0,
                width: 3.71,
                custom_width: true,
                hidden: false,
                best_fit: false,
                collapsed: false,
                phonetic: false,
                ..Default::default()
            },
            ColDimension {
                col: 1,
                width: 17.71,
                custom_width: true,
                hidden: false,
                best_fit: false,
                collapsed: false,
                phonetic: false,
                ..Default::default()
            },
            ColDimension {
                col: 2,
                width: 2.28,
                custom_width: true,
                hidden: false,
                best_fit: false,
                collapsed: false,
                phonetic: false,
                ..Default::default()
            },
            ColDimension {
                col: 3,
                width: 17.71,
                custom_width: true,
                hidden: false,
                best_fit: false,
                collapsed: false,
                phonetic: false,
                ..Default::default()
            },
            ColDimension {
                col: 4,
                width: 2.28,
                custom_width: true,
                hidden: false,
                best_fit: false,
                collapsed: false,
                phonetic: false,
                ..Default::default()
            },
            ColDimension {
                col: 5,
                width: 17.71,
                custom_width: true,
                hidden: false,
                best_fit: false,
                collapsed: false,
                phonetic: false,
                ..Default::default()
            },
        ],
        row_heights: vec![
            RowDimension {
                row: 0,
                height: 69.75,
                custom_height: true,
                hidden: false,
                custom_format: false,
                descent: None,
                ..Default::default()
            },
            RowDimension {
                row: 1,
                height: 60.0,
                custom_height: true,
                hidden: false,
                custom_format: false,
                descent: None,
                ..Default::default()
            },
            RowDimension {
                row: 2,
                height: 6.0,
                custom_height: true,
                hidden: false,
                custom_format: false,
                descent: None,
                ..Default::default()
            },
            RowDimension {
                row: 3,
                height: 15.0,
                custom_height: true,
                hidden: false,
                custom_format: false,
                descent: None,
                ..Default::default()
            },
            RowDimension {
                row: 4,
                height: 79.5,
                custom_height: true,
                hidden: false,
                custom_format: false,
                descent: None,
                ..Default::default()
            },
        ],
        ..Default::default()
    };

    // Ensure the sheet grid covers all dimensioned rows/cols.
    po.sheets[0].rows = 5;
    po.sheets[0].cols = 6;

    let rt = roundtrip(&po);

    assert_eq!(rt.sheets.len(), 1);
    let sheet = &rt.sheets[0];
    let dims = &sheet.dimensions;

    // --- Default dimensions preserved ---
    assert_approx(
        dims.default_col_width.unwrap_or(0.0),
        9.140625,
        0.01,
        "rt default_col_width",
    );
    assert_approx(
        dims.default_row_height.unwrap_or(0.0),
        15.0,
        0.01,
        "rt default_row_height",
    );

    // --- Column dimensions preserved ---
    let expected_col_widths: [(u32, f64); 6] = [
        (0, 3.71),
        (1, 17.71),
        (2, 2.28),
        (3, 17.71),
        (4, 2.28),
        (5, 17.71),
    ];

    assert_eq!(
        dims.col_widths.len(),
        6,
        "Expected 6 ColDimension entries after round-trip, found {}",
        dims.col_widths.len()
    );

    for (expected_col, expected_width) in &expected_col_widths {
        let col_dim = dims
            .col_widths
            .iter()
            .find(|cd| cd.col == *expected_col)
            .unwrap_or_else(|| {
                panic!(
                    "ColDimension for col {} not found after round-trip",
                    expected_col
                )
            });
        assert_approx(
            col_dim.width,
            *expected_width,
            0.01,
            &format!("rt col {} width", expected_col),
        );
        assert!(
            col_dim.custom_width,
            "rt col {} should have custom_width=true",
            expected_col
        );
    }

    // --- Row dimensions preserved ---
    let expected_row_heights: [(u32, f64); 5] =
        [(0, 69.75), (1, 60.0), (2, 6.0), (3, 15.0), (4, 79.5)];

    assert_eq!(
        dims.row_heights.len(),
        5,
        "Expected 5 RowDimension entries after round-trip, found {}",
        dims.row_heights.len()
    );

    for (expected_row, expected_height) in &expected_row_heights {
        let row_dim = dims
            .row_heights
            .iter()
            .find(|rd| rd.row == *expected_row)
            .unwrap_or_else(|| {
                panic!(
                    "RowDimension for row {} not found after round-trip",
                    expected_row
                )
            });
        assert_approx(
            row_dim.height,
            *expected_height,
            0.01,
            &format!("rt row {} height", expected_row),
        );
    }

    // --- Cells preserved ---
    let expected_cells: [(u32, u32, &str); 4] = [
        (0, 0, "Header"),
        (1, 0, "Content"),
        (2, 0, "Spacer"),
        (0, 1, "Wide Col"),
    ];

    for (row, col, text) in &expected_cells {
        let c = sheet
            .cells
            .iter()
            .find(|c| c.row == *row && c.col == *col)
            .unwrap_or_else(|| panic!("cell ({},{}) should exist after round-trip", row, col));
        match &c.value {
            CellValue::Text(s) => assert_eq!(
                s.as_ref(),
                *text,
                "cell ({},{}) text content after round-trip",
                row,
                col
            ),
            other => panic!(
                "cell ({},{}) expected Text after round-trip, got {:?}",
                row, col, other
            ),
        }
    }
}
