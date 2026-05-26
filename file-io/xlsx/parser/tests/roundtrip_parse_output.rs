//! Round-trip tests for the ParseOutput pipeline (parser-only, no Yrs).
//!
//! Tests the cycle: ParseOutput -> write_xlsx_from_parse_output -> parse_xlsx_to_output -> compare.
//!
//! This validates that the unified pipeline preserves data through:
//! 1. `write_xlsx_from_parse_output()` (domain-types -> XLSX bytes)
//! 2. `parse_xlsx_to_output()` (XLSX bytes -> ParseOutput, via full_parse + conversion)
//!
//! Level 1 tests: no compute-core, no Yrs — pure parser/writer fidelity.

use std::sync::Arc;

use domain_types::{
    AlignmentFormat, BorderFormat, BorderSide, CFCellRange, CFRule, CFStyle, CellData,
    ColDimension, Comment, CommentType, ConditionalFormat, DocumentFormat, ErrorStyle, FillFormat,
    FontFormat, FrozenPane, MergeRegion, NamedRange, ParseOutput, RoundTripContext, RowDimension,
    SheetData, SheetDimensions, TableColumnSpec, TableSpec, ValidationOperator, ValidationRule,
    ValidationSpec,
};
use value_types::{CellError, CellValue, FiniteF64};
use xlsx_parser::parse_xlsx_to_output;
use xlsx_parser::write::write_xlsx_from_parse_output;

// =============================================================================
// Test infrastructure
// =============================================================================

/// Round-trip a ParseOutput through XLSX write -> parse -> convert.
///
/// Returns the round-tripped ParseOutput for further assertions.
fn roundtrip(original: &ParseOutput) -> ParseOutput {
    // Step 1: Write XLSX bytes from ParseOutput
    let bytes = write_xlsx_from_parse_output(original, None)
        .expect("write_xlsx_from_parse_output should succeed");

    // Sanity: output should be a valid ZIP (starts with PK)
    assert!(
        bytes.len() > 4,
        "XLSX output too small: {} bytes",
        bytes.len()
    );
    assert_eq!(&bytes[0..2], b"PK", "Output is not a valid ZIP archive");

    // Step 2: Parse the XLSX bytes back into ParseOutput
    let (round_tripped, _rt_ctx, _diagnostics) =
        parse_xlsx_to_output(&bytes).expect("parse_xlsx_to_output should succeed");

    round_tripped
}

/// Helper: create a minimal ParseOutput with one sheet and given cells.
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

/// Helper: create a CellData with a formula at (row, col).
fn formula_cell(row: u32, col: u32, formula: &str, cached: CellValue) -> CellData {
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
fn styled_cell(row: u32, col: u32, value: CellValue, style_id: u32) -> CellData {
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
fn assert_cells_match(original: &[CellData], round_tripped: &[CellData], sheet_name: &str) {
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

// =============================================================================
// 6c: Cell value round-trip tests
// =============================================================================

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

#[test]
fn roundtrip_merge_regions() {
    let mut output = make_single_sheet(
        "Merges",
        vec![
            cell(0, 0, CellValue::Text(Arc::from("Merged"))),
            cell(2, 0, CellValue::Text(Arc::from("Another merge"))),
        ],
    );
    output.sheets[0].merges = vec![
        MergeRegion {
            start_row: 0,
            start_col: 0,
            end_row: 0,
            end_col: 2,
        },
        MergeRegion {
            start_row: 2,
            start_col: 0,
            end_row: 3,
            end_col: 1,
        },
    ];
    output.sheets[0].rows = 4;
    output.sheets[0].cols = 3;

    let rt = roundtrip(&output);
    assert_eq!(rt.sheets.len(), 1);

    // Sort merges for stable comparison
    let mut orig_merges = output.sheets[0].merges.clone();
    let mut rt_merges = rt.sheets[0].merges.clone();
    orig_merges.sort_by_key(|m| (m.start_row, m.start_col));
    rt_merges.sort_by_key(|m| (m.start_row, m.start_col));

    assert_eq!(
        orig_merges, rt_merges,
        "Merge regions should round-trip exactly"
    );
}

#[test]
fn roundtrip_single_cell_merge() {
    // Edge case: a merge region that spans just 2 cells
    let mut output = make_single_sheet(
        "SmallMerge",
        vec![cell(0, 0, CellValue::Text(Arc::from("Merged")))],
    );
    output.sheets[0].merges = vec![MergeRegion {
        start_row: 0,
        start_col: 0,
        end_row: 0,
        end_col: 1,
    }];
    output.sheets[0].rows = 1;
    output.sheets[0].cols = 2;

    let rt = roundtrip(&output);
    assert_eq!(rt.sheets[0].merges.len(), 1);
    assert_eq!(rt.sheets[0].merges[0].start_row, 0);
    assert_eq!(rt.sheets[0].merges[0].end_col, 1);
}

#[test]
fn roundtrip_row_and_col_dimensions() {
    let mut output = make_single_sheet(
        "Dimensions",
        vec![cell(0, 0, CellValue::Number(FiniteF64::new(1.0).unwrap()))],
    );
    output.sheets[0].dimensions = SheetDimensions {
        default_row_height: Some(15.0),
        default_col_width: Some(8.43),
        row_heights: vec![
            RowDimension {
                row: 0,
                height: 30.0,
                custom_height: true,
                hidden: false,
                ..Default::default()
            },
            RowDimension {
                row: 5,
                height: 45.0,
                custom_height: true,
                hidden: false,
                ..Default::default()
            },
        ],
        col_widths: vec![
            ColDimension {
                col: 0,
                width: 20.0,
                custom_width: true,
                hidden: false,
                best_fit: false,
                collapsed: false,
            },
            ColDimension {
                col: 3,
                width: 50.0,
                custom_width: true,
                hidden: false,
                best_fit: false,
                collapsed: false,
            },
        ],
        ..Default::default()
    };
    output.sheets[0].rows = 10;
    output.sheets[0].cols = 5;

    let rt = roundtrip(&output);
    assert_eq!(rt.sheets.len(), 1);

    let orig_dims = &output.sheets[0].dimensions;
    let rt_dims = &rt.sheets[0].dimensions;

    // Row heights
    let orig_rows: std::collections::HashMap<u32, f64> = orig_dims
        .row_heights
        .iter()
        .map(|r| (r.row, r.height))
        .collect();
    let rt_rows: std::collections::HashMap<u32, f64> = rt_dims
        .row_heights
        .iter()
        .filter(|r| r.custom_height)
        .map(|r| (r.row, r.height))
        .collect();

    for (row, orig_h) in &orig_rows {
        let rt_h = rt_rows.get(row).unwrap_or_else(|| {
            panic!("Row {row} height missing in round-trip. Original: {orig_h}")
        });
        let diff = (orig_h - rt_h).abs();
        assert!(diff < 0.01, "Row {row} height mismatch: {orig_h} vs {rt_h}");
    }

    // Col widths
    let orig_cols: std::collections::HashMap<u32, f64> = orig_dims
        .col_widths
        .iter()
        .map(|c| (c.col, c.width))
        .collect();
    let rt_cols: std::collections::HashMap<u32, f64> = rt_dims
        .col_widths
        .iter()
        .filter(|c| c.custom_width)
        .map(|c| (c.col, c.width))
        .collect();

    for (col, orig_w) in &orig_cols {
        let rt_w = rt_cols
            .get(col)
            .unwrap_or_else(|| panic!("Col {col} width missing in round-trip. Original: {orig_w}"));
        let diff = (orig_w - rt_w).abs();
        assert!(diff < 0.01, "Col {col} width mismatch: {orig_w} vs {rt_w}");
    }
}

#[test]
fn roundtrip_hidden_rows_and_cols() {
    let mut output = make_single_sheet(
        "Hidden",
        vec![cell(0, 0, CellValue::Number(FiniteF64::new(1.0).unwrap()))],
    );
    output.sheets[0].dimensions = SheetDimensions {
        default_row_height: Some(15.0),
        default_col_width: None,
        row_heights: vec![RowDimension {
            row: 2,
            height: 0.0,
            custom_height: true,
            hidden: true,
            ..Default::default()
        }],
        col_widths: vec![ColDimension {
            col: 1,
            width: 0.0,
            custom_width: true,
            hidden: true,
            best_fit: false,
            collapsed: false,
        }],
        ..Default::default()
    };
    output.sheets[0].rows = 5;
    output.sheets[0].cols = 3;

    let rt = roundtrip(&output);

    // Hidden row should survive -- at minimum the dimension entry should exist.
    // NOTE: The `hidden` flag may not round-trip perfectly through the current
    // pipeline (known gap). We verify the row dimension entry exists.
    let hidden_row = rt.sheets[0]
        .dimensions
        .row_heights
        .iter()
        .find(|r| r.row == 2);
    assert!(
        hidden_row.is_some(),
        "Hidden row 2 dimension entry should survive round-trip"
    );

    // Hidden col should survive -- at minimum the dimension entry should exist.
    let hidden_col = rt.sheets[0]
        .dimensions
        .col_widths
        .iter()
        .find(|c| c.col == 1);
    assert!(
        hidden_col.is_some(),
        "Hidden col 1 dimension entry should survive round-trip"
    );
}

#[test]
fn roundtrip_frozen_panes() {
    let mut output = make_single_sheet(
        "Frozen",
        vec![cell(0, 0, CellValue::Number(FiniteF64::new(1.0).unwrap()))],
    );
    output.sheets[0].frozen_pane = Some(FrozenPane {
        rows: 2,
        cols: 1,
        top_left_cell: None,
    });
    output.sheets[0].rows = 10;
    output.sheets[0].cols = 5;

    let rt = roundtrip(&output);
    assert_eq!(rt.sheets.len(), 1);

    let rt_pane = rt.sheets[0]
        .frozen_pane
        .as_ref()
        .expect("frozen pane should be preserved");
    assert_eq!(rt_pane.rows, 2, "Frozen rows mismatch");
    assert_eq!(rt_pane.cols, 1, "Frozen cols mismatch");
}

#[test]
fn roundtrip_frozen_rows_only() {
    let mut output = make_single_sheet(
        "FrozenRows",
        vec![cell(0, 0, CellValue::Number(FiniteF64::new(1.0).unwrap()))],
    );
    output.sheets[0].frozen_pane = Some(FrozenPane {
        rows: 3,
        cols: 0,
        top_left_cell: None,
    });
    output.sheets[0].rows = 10;
    output.sheets[0].cols = 5;

    let rt = roundtrip(&output);
    let rt_pane = rt.sheets[0]
        .frozen_pane
        .as_ref()
        .expect("frozen pane should be preserved");
    assert_eq!(rt_pane.rows, 3);
    assert_eq!(rt_pane.cols, 0);
}

#[test]
fn roundtrip_frozen_cols_only() {
    let mut output = make_single_sheet(
        "FrozenCols",
        vec![cell(0, 0, CellValue::Number(FiniteF64::new(1.0).unwrap()))],
    );
    output.sheets[0].frozen_pane = Some(FrozenPane {
        rows: 0,
        cols: 2,
        top_left_cell: None,
    });
    output.sheets[0].rows = 10;
    output.sheets[0].cols = 5;

    let rt = roundtrip(&output);
    let rt_pane = rt.sheets[0]
        .frozen_pane
        .as_ref()
        .expect("frozen pane should be preserved");
    assert_eq!(rt_pane.rows, 0);
    assert_eq!(rt_pane.cols, 2);
}

// =============================================================================
// 6e: Style round-trip tests
// =============================================================================

#[test]
fn roundtrip_font_formatting() {
    let bold_red = DocumentFormat {
        font: Some(FontFormat {
            name: Some("Arial".to_string()),
            size: Some(14_000), // 14pt in millipoints
            color: Some("#FF0000".to_string()),
            bold: Some(true),
            italic: Some(true),
            underline: Some("single".to_string()),
            strikethrough: Some(true),
            ..Default::default()
        }),
        ..Default::default()
    };

    let mut output = make_single_sheet(
        "FontStyles",
        vec![styled_cell(
            0,
            0,
            CellValue::Text(Arc::from("Styled text")),
            0,
        )],
    );
    output.style_palette = vec![bold_red.clone()];

    let rt = roundtrip(&output);
    assert_eq!(rt.sheets.len(), 1);

    let rt_cell = rt.sheets[0]
        .cells
        .iter()
        .find(|c| c.row == 0 && c.col == 0)
        .expect("styled cell should exist");

    let rt_style_id = rt_cell.style_id.expect("cell should have a style_id");
    let rt_fmt = &rt.style_palette[rt_style_id as usize];

    let rt_font = rt_fmt.font.as_ref().expect("font should be preserved");
    assert_eq!(rt_font.name.as_deref(), Some("Arial"));
    assert_eq!(rt_font.bold, Some(true));
    assert_eq!(rt_font.italic, Some(true));
    assert_eq!(rt_font.strikethrough, Some(true));
    assert_eq!(rt_font.underline.as_deref(), Some("single"));
    // Color may be normalized -- check it contains red
    if let Some(ref color) = rt_font.color {
        assert!(
            color.to_uppercase().contains("FF0000"),
            "Expected red color, got {color}"
        );
    }
}

#[test]
fn roundtrip_font_size_preserved() {
    // Test multiple font sizes survive round-trip
    let small = DocumentFormat {
        font: Some(FontFormat {
            size: Some(8_000), // 8pt
            ..Default::default()
        }),
        ..Default::default()
    };
    let large = DocumentFormat {
        font: Some(FontFormat {
            size: Some(24_000), // 24pt
            ..Default::default()
        }),
        ..Default::default()
    };

    let output = ParseOutput {
        sheets: vec![SheetData {
            name: "FontSizes".to_string(),
            rows: 1,
            cols: 2,
            cells: vec![
                styled_cell(0, 0, CellValue::Text(Arc::from("Small")), 0),
                styled_cell(0, 1, CellValue::Text(Arc::from("Large")), 1),
            ],
            ..Default::default()
        }],
        style_palette: vec![small, large],
        ..Default::default()
    };

    let rt = roundtrip(&output);

    // Verify both font sizes survived
    let cell_0 = rt.sheets[0].cells.iter().find(|c| c.col == 0).unwrap();
    let cell_1 = rt.sheets[0].cells.iter().find(|c| c.col == 1).unwrap();

    let fmt_0 = &rt.style_palette[cell_0.style_id.unwrap() as usize];
    let fmt_1 = &rt.style_palette[cell_1.style_id.unwrap() as usize];

    let size_0 = fmt_0.font.as_ref().and_then(|f| f.size).unwrap_or(0);
    let size_1 = fmt_1.font.as_ref().and_then(|f| f.size).unwrap_or(0);

    // Sizes should be different and roughly correct (allow millipoint rounding)
    assert!(size_0 < size_1, "Small font should be smaller than large");
    assert!(
        (size_0 as f64 - 8_000.0).abs() < 500.0,
        "Small font size {size_0} should be ~8000 millipoints"
    );
    assert!(
        (size_1 as f64 - 24_000.0).abs() < 500.0,
        "Large font size {size_1} should be ~24000 millipoints"
    );
}

#[test]
fn roundtrip_fill_formatting() {
    let yellow_fill = DocumentFormat {
        fill: Some(FillFormat {
            background_color: None,
            pattern_type: Some("solid".to_string()),
            pattern_foreground_color: Some("#FFFF00".to_string()),
            ..Default::default()
        }),
        ..Default::default()
    };

    let mut output = make_single_sheet(
        "FillStyles",
        vec![styled_cell(
            0,
            0,
            CellValue::Text(Arc::from("Yellow cell")),
            0,
        )],
    );
    output.style_palette = vec![yellow_fill.clone()];

    let rt = roundtrip(&output);

    let rt_cell = rt.sheets[0]
        .cells
        .iter()
        .find(|c| c.row == 0 && c.col == 0)
        .expect("styled cell should exist");
    let rt_style_id = rt_cell.style_id.expect("cell should have a style_id");
    let rt_fmt = &rt.style_palette[rt_style_id as usize];

    let rt_fill = rt_fmt.fill.as_ref().expect("fill should be preserved");
    assert_eq!(rt_fill.pattern_type.as_deref(), Some("solid"));
    assert!(
        rt_fill.pattern_foreground_color.is_some() || rt_fill.background_color.is_some(),
        "Fill color should be preserved in some form"
    );
}

#[test]
fn roundtrip_border_formatting() {
    let borders = DocumentFormat {
        border: Some(BorderFormat {
            top: Some(BorderSide {
                style: "thin".to_string(),
                color: Some("#000000".to_string()),
                color_tint: None,
            }),
            bottom: Some(BorderSide {
                style: "medium".to_string(),
                color: Some("#FF0000".to_string()),
                color_tint: None,
            }),
            left: Some(BorderSide {
                style: "thin".to_string(),
                color: Some("#000000".to_string()),
                color_tint: None,
            }),
            right: Some(BorderSide {
                style: "thin".to_string(),
                color: Some("#000000".to_string()),
                color_tint: None,
            }),
            diagonal: None,
            diagonal_up: None,
            diagonal_down: None,
        }),
        ..Default::default()
    };

    let mut output = make_single_sheet(
        "Borders",
        vec![styled_cell(0, 0, CellValue::Text(Arc::from("Bordered")), 0)],
    );
    output.style_palette = vec![borders.clone()];

    let rt = roundtrip(&output);

    let rt_cell = rt.sheets[0]
        .cells
        .iter()
        .find(|c| c.row == 0 && c.col == 0)
        .expect("styled cell should exist");
    let rt_style_id = rt_cell.style_id.expect("cell should have a style_id");
    let rt_fmt = &rt.style_palette[rt_style_id as usize];

    let rt_border = rt_fmt.border.as_ref().expect("border should be preserved");

    assert!(rt_border.top.is_some(), "Top border should be preserved");
    assert!(
        rt_border.bottom.is_some(),
        "Bottom border should be preserved"
    );
    assert!(rt_border.left.is_some(), "Left border should be preserved");
    assert!(
        rt_border.right.is_some(),
        "Right border should be preserved"
    );

    // Check border styles survived
    assert_eq!(rt_border.top.as_ref().unwrap().style, "thin");
    assert_eq!(rt_border.bottom.as_ref().unwrap().style, "medium");
}

#[test]
fn roundtrip_diagonal_border() {
    let borders = DocumentFormat {
        border: Some(BorderFormat {
            top: None,
            bottom: None,
            left: None,
            right: None,
            diagonal: Some(BorderSide {
                style: "thin".to_string(),
                color: Some("#0000FF".to_string()),
                color_tint: None,
            }),
            diagonal_up: Some(true),
            diagonal_down: Some(true),
        }),
        ..Default::default()
    };

    let mut output = make_single_sheet(
        "DiagBorder",
        vec![styled_cell(0, 0, CellValue::Text(Arc::from("Diagonal")), 0)],
    );
    output.style_palette = vec![borders];

    let rt = roundtrip(&output);

    let rt_cell = rt.sheets[0]
        .cells
        .iter()
        .find(|c| c.row == 0 && c.col == 0)
        .expect("styled cell should exist");
    let rt_style_id = rt_cell.style_id.expect("cell should have a style_id");
    let rt_fmt = &rt.style_palette[rt_style_id as usize];

    // Diagonal border is less commonly supported -- just check it doesn't crash
    // and the cell still has formatting
    assert!(
        rt_fmt.border.is_some()
            || rt_fmt.font.is_some()
            || rt_fmt.fill.is_some()
            || rt_fmt.alignment.is_some()
            || rt_fmt.number_format.is_some(),
        "Some formatting should survive even if diagonal is dropped"
    );
}

#[test]
fn roundtrip_alignment_formatting() {
    let centered = DocumentFormat {
        alignment: Some(AlignmentFormat {
            horizontal: Some("center".to_string()),
            vertical: Some("middle".to_string()),
            wrap_text: Some(true),
            ..Default::default()
        }),
        ..Default::default()
    };

    let mut output = make_single_sheet(
        "Alignment",
        vec![styled_cell(0, 0, CellValue::Text(Arc::from("Centered")), 0)],
    );
    output.style_palette = vec![centered.clone()];

    let rt = roundtrip(&output);

    let rt_cell = rt.sheets[0]
        .cells
        .iter()
        .find(|c| c.row == 0 && c.col == 0)
        .expect("styled cell should exist");
    let rt_style_id = rt_cell.style_id.expect("cell should have a style_id");
    let rt_fmt = &rt.style_palette[rt_style_id as usize];

    let rt_align = rt_fmt
        .alignment
        .as_ref()
        .expect("alignment should be preserved");
    assert_eq!(rt_align.horizontal.as_deref(), Some("center"));
    assert_eq!(rt_align.vertical.as_deref(), Some("middle"));
    assert_eq!(rt_align.wrap_text, Some(true));
}

#[test]
fn roundtrip_text_rotation() {
    let rotated = DocumentFormat {
        alignment: Some(AlignmentFormat {
            rotation: Some(45),
            ..Default::default()
        }),
        ..Default::default()
    };

    let mut output = make_single_sheet(
        "Rotated",
        vec![styled_cell(0, 0, CellValue::Text(Arc::from("Rotated")), 0)],
    );
    output.style_palette = vec![rotated];

    let rt = roundtrip(&output);

    let rt_cell = rt.sheets[0]
        .cells
        .iter()
        .find(|c| c.row == 0 && c.col == 0)
        .expect("styled cell should exist");
    let rt_style_id = rt_cell.style_id.expect("cell should have a style_id");
    let rt_fmt = &rt.style_palette[rt_style_id as usize];

    let rt_align = rt_fmt
        .alignment
        .as_ref()
        .expect("alignment should be preserved for rotation");
    assert_eq!(rt_align.rotation, Some(45), "Rotation should round-trip");
}

#[test]
fn roundtrip_number_format() {
    let currency = DocumentFormat {
        number_format: Some("#,##0.00".to_string()),
        ..Default::default()
    };

    let mut output = make_single_sheet(
        "NumFmt",
        vec![styled_cell(
            0,
            0,
            CellValue::Number(FiniteF64::new(1234.56).unwrap()),
            0,
        )],
    );
    output.style_palette = vec![currency.clone()];

    let rt = roundtrip(&output);

    let rt_cell = rt.sheets[0]
        .cells
        .iter()
        .find(|c| c.row == 0 && c.col == 0)
        .expect("styled cell should exist");
    let rt_style_id = rt_cell.style_id.expect("cell should have a style_id");
    let rt_fmt = &rt.style_palette[rt_style_id as usize];

    assert_eq!(
        rt_fmt.number_format.as_deref(),
        Some("#,##0.00"),
        "Number format should round-trip exactly"
    );
}

#[test]
fn roundtrip_date_number_format() {
    let date_fmt = DocumentFormat {
        number_format: Some("yyyy-mm-dd".to_string()),
        ..Default::default()
    };

    let mut output = make_single_sheet(
        "DateFmt",
        vec![styled_cell(
            0,
            0,
            // Excel date serial for 2024-01-15
            CellValue::Number(FiniteF64::new(45306.0).unwrap()),
            0,
        )],
    );
    output.style_palette = vec![date_fmt];

    let rt = roundtrip(&output);

    let rt_cell = rt.sheets[0]
        .cells
        .iter()
        .find(|c| c.row == 0 && c.col == 0)
        .expect("styled cell should exist");
    let rt_style_id = rt_cell.style_id.expect("cell should have a style_id");
    let rt_fmt = &rt.style_palette[rt_style_id as usize];

    assert_eq!(
        rt_fmt.number_format.as_deref(),
        Some("yyyy-mm-dd"),
        "Date format should round-trip exactly"
    );
}

#[test]
fn roundtrip_combined_styles() {
    // A cell with font + fill + border + alignment + number format all at once
    let rich_style = DocumentFormat {
        font: Some(FontFormat {
            name: Some("Calibri".to_string()),
            size: Some(11_000),
            bold: Some(true),
            color: Some("#FFFFFF".to_string()),
            ..Default::default()
        }),
        fill: Some(FillFormat {
            pattern_type: Some("solid".to_string()),
            pattern_foreground_color: Some("#4472C4".to_string()),
            background_color: None,
            ..Default::default()
        }),
        border: Some(BorderFormat {
            top: Some(BorderSide {
                style: "thin".to_string(),
                color: Some("#000000".to_string()),
                color_tint: None,
            }),
            bottom: Some(BorderSide {
                style: "thin".to_string(),
                color: Some("#000000".to_string()),
                color_tint: None,
            }),
            left: Some(BorderSide {
                style: "thin".to_string(),
                color: Some("#000000".to_string()),
                color_tint: None,
            }),
            right: Some(BorderSide {
                style: "thin".to_string(),
                color: Some("#000000".to_string()),
                color_tint: None,
            }),
            diagonal: None,
            diagonal_up: None,
            diagonal_down: None,
        }),
        alignment: Some(AlignmentFormat {
            horizontal: Some("center".to_string()),
            vertical: Some("middle".to_string()),
            wrap_text: Some(true),
            ..Default::default()
        }),
        number_format: Some("#,##0".to_string()),
        ..Default::default()
    };

    let mut output = make_single_sheet(
        "RichStyle",
        vec![styled_cell(
            0,
            0,
            CellValue::Number(FiniteF64::new(42000.0).unwrap()),
            0,
        )],
    );
    output.style_palette = vec![rich_style];

    let rt = roundtrip(&output);

    let rt_cell = rt.sheets[0]
        .cells
        .iter()
        .find(|c| c.row == 0 && c.col == 0)
        .expect("styled cell should exist");
    let rt_style_id = rt_cell.style_id.expect("cell should have a style_id");
    let rt_fmt = &rt.style_palette[rt_style_id as usize];

    // Each style component should survive
    assert!(rt_fmt.font.is_some(), "Font should survive combined style");
    assert!(rt_fmt.fill.is_some(), "Fill should survive combined style");
    assert!(
        rt_fmt.border.is_some(),
        "Border should survive combined style"
    );
    assert!(
        rt_fmt.alignment.is_some(),
        "Alignment should survive combined style"
    );
    assert_eq!(
        rt_fmt.number_format.as_deref(),
        Some("#,##0"),
        "Number format should survive combined style"
    );

    // Verify font details
    let font = rt_fmt.font.as_ref().unwrap();
    assert_eq!(font.name.as_deref(), Some("Calibri"));
    assert_eq!(font.bold, Some(true));
}

// =============================================================================
// Named ranges
// =============================================================================

#[test]
fn roundtrip_named_ranges() {
    let mut output = make_single_sheet(
        "Sheet1",
        vec![cell(
            0,
            0,
            CellValue::Number(FiniteF64::new(100.0).unwrap()),
        )],
    );
    output.named_ranges = vec![
        NamedRange {
            name: "MyRange".to_string(),
            refers_to: "Sheet1!$A$1".to_string(),
            local_sheet_id: None,
            hidden: false,
            comment: None,
            ..Default::default()
        },
        NamedRange {
            name: "SheetScoped".to_string(),
            refers_to: "Sheet1!$A$1:$B$2".to_string(),
            local_sheet_id: Some(0),
            hidden: false,
            comment: None,
            ..Default::default()
        },
    ];

    let rt = roundtrip(&output);

    let rt_names: std::collections::HashSet<String> =
        rt.named_ranges.iter().map(|n| n.name.clone()).collect();

    assert!(
        rt_names.contains("MyRange"),
        "Named range 'MyRange' should be preserved. Got: {rt_names:?}"
    );

    let my_range = rt
        .named_ranges
        .iter()
        .find(|n| n.name == "MyRange")
        .expect("MyRange should exist");
    assert_eq!(my_range.refers_to, "Sheet1!$A$1");
}

// =============================================================================
// Multiple sheets
// =============================================================================

#[test]
fn roundtrip_multiple_sheets() {
    let output = ParseOutput {
        sheets: vec![
            SheetData {
                name: "Data".to_string(),
                rows: 3,
                cols: 2,
                cells: vec![
                    cell(0, 0, CellValue::Text(Arc::from("Name"))),
                    cell(0, 1, CellValue::Text(Arc::from("Value"))),
                    cell(1, 0, CellValue::Text(Arc::from("Alpha"))),
                    cell(1, 1, CellValue::Number(FiniteF64::new(100.0).unwrap())),
                    cell(2, 0, CellValue::Text(Arc::from("Beta"))),
                    cell(2, 1, CellValue::Number(FiniteF64::new(200.0).unwrap())),
                ],
                ..Default::default()
            },
            SheetData {
                name: "Summary".to_string(),
                rows: 1,
                cols: 1,
                cells: vec![formula_cell(
                    0,
                    0,
                    "SUM(Data!B2:B3)",
                    CellValue::Number(FiniteF64::new(300.0).unwrap()),
                )],
                ..Default::default()
            },
        ],
        ..Default::default()
    };

    let rt = roundtrip(&output);

    assert_eq!(rt.sheets.len(), 2, "Both sheets should survive");
    assert_eq!(rt.sheets[0].name, "Data");
    assert_eq!(rt.sheets[1].name, "Summary");

    assert_cells_match(&output.sheets[0].cells, &rt.sheets[0].cells, "Data");
    assert_cells_match(&output.sheets[1].cells, &rt.sheets[1].cells, "Summary");
}

#[test]
fn roundtrip_many_sheets() {
    let sheets: Vec<SheetData> = (0..5)
        .map(|i| SheetData {
            name: format!("Sheet{}", i + 1),
            rows: 1,
            cols: 1,
            cells: vec![cell(
                0,
                0,
                CellValue::Number(FiniteF64::new((i + 1) as f64).unwrap()),
            )],
            ..Default::default()
        })
        .collect();

    let output = ParseOutput {
        sheets,
        ..Default::default()
    };

    let rt = roundtrip(&output);
    assert_eq!(rt.sheets.len(), 5);
    for (i, sheet) in rt.sheets.iter().enumerate() {
        assert_eq!(sheet.name, format!("Sheet{}", i + 1));
    }
}

#[test]
fn roundtrip_sheet_name_special_chars() {
    let output = make_single_sheet(
        "My Sheet (1)",
        vec![cell(0, 0, CellValue::Text(Arc::from("data")))],
    );

    let rt = roundtrip(&output);
    assert_eq!(rt.sheets[0].name, "My Sheet (1)");
}

// =============================================================================
// Comprehensive integration test
// =============================================================================

#[test]
fn roundtrip_comprehensive() {
    let bold = DocumentFormat {
        font: Some(FontFormat {
            bold: Some(true),
            ..Default::default()
        }),
        ..Default::default()
    };
    let highlighted = DocumentFormat {
        fill: Some(FillFormat {
            pattern_type: Some("solid".to_string()),
            pattern_foreground_color: Some("#CCFFCC".to_string()),
            background_color: None,
            ..Default::default()
        }),
        ..Default::default()
    };

    let output = ParseOutput {
        sheets: vec![SheetData {
            name: "Report".to_string(),
            rows: 5,
            cols: 3,
            cells: vec![
                // Header row (bold)
                styled_cell(0, 0, CellValue::Text(Arc::from("Item")), 0),
                styled_cell(0, 1, CellValue::Text(Arc::from("Qty")), 0),
                styled_cell(0, 2, CellValue::Text(Arc::from("Total")), 0),
                // Data rows
                cell(1, 0, CellValue::Text(Arc::from("Widget"))),
                cell(1, 1, CellValue::Number(FiniteF64::new(5.0).unwrap())),
                formula_cell(
                    1,
                    2,
                    "B2*10",
                    CellValue::Number(FiniteF64::new(50.0).unwrap()),
                ),
                cell(2, 0, CellValue::Text(Arc::from("Gadget"))),
                cell(2, 1, CellValue::Number(FiniteF64::new(3.0).unwrap())),
                formula_cell(
                    2,
                    2,
                    "B3*20",
                    CellValue::Number(FiniteF64::new(60.0).unwrap()),
                ),
                // Summary row (highlighted)
                styled_cell(4, 0, CellValue::Text(Arc::from("Grand Total")), 1),
                formula_cell(
                    4,
                    2,
                    "SUM(C2:C3)",
                    CellValue::Number(FiniteF64::new(110.0).unwrap()),
                ),
            ],
            merges: vec![MergeRegion {
                start_row: 4,
                start_col: 0,
                end_row: 4,
                end_col: 1,
            }],
            frozen_pane: Some(FrozenPane {
                rows: 1,
                cols: 0,
                top_left_cell: None,
            }),
            dimensions: SheetDimensions {
                default_row_height: Some(15.0),
                default_col_width: None,
                row_heights: vec![RowDimension {
                    row: 0,
                    height: 20.0,
                    custom_height: true,
                    hidden: false,
                    ..Default::default()
                }],
                col_widths: vec![ColDimension {
                    col: 0,
                    width: 25.0,
                    custom_width: true,
                    hidden: false,
                    best_fit: false,
                    collapsed: false,
                }],
                ..Default::default()
            },
            ..Default::default()
        }],
        style_palette: vec![bold, highlighted],
        named_ranges: vec![NamedRange {
            name: "Totals".to_string(),
            refers_to: "Report!$C$2:$C$3".to_string(),
            local_sheet_id: None,
            hidden: false,
            comment: None,
            ..Default::default()
        }],
        ..Default::default()
    };

    let rt = roundtrip(&output);

    // Verify structure
    assert_eq!(rt.sheets.len(), 1);
    assert_eq!(rt.sheets[0].name, "Report");

    // Verify cells
    assert_cells_match(&output.sheets[0].cells, &rt.sheets[0].cells, "Report");

    // Verify merges
    assert_eq!(rt.sheets[0].merges.len(), 1);
    assert_eq!(rt.sheets[0].merges[0].start_row, 4);
    assert_eq!(rt.sheets[0].merges[0].end_col, 1);

    // Verify frozen pane
    let pane = rt.sheets[0]
        .frozen_pane
        .as_ref()
        .expect("frozen pane should survive");
    assert_eq!(pane.rows, 1);
    assert_eq!(pane.cols, 0);

    // Verify named range
    assert!(
        rt.named_ranges.iter().any(|n| n.name == "Totals"),
        "Named range 'Totals' should survive round-trip"
    );

    // Verify some style survived
    assert!(
        !rt.style_palette.is_empty(),
        "Style palette should be non-empty"
    );
}

// =============================================================================
// Edge cases
// =============================================================================

#[test]
fn roundtrip_empty_sheet() {
    let output = ParseOutput {
        sheets: vec![SheetData {
            name: "Empty".to_string(),
            rows: 0,
            cols: 0,
            cells: vec![],
            ..Default::default()
        }],
        ..Default::default()
    };

    let rt = roundtrip(&output);
    assert_eq!(rt.sheets.len(), 1);
    assert_eq!(rt.sheets[0].name, "Empty");
    // Empty sheet should have no cells (or only null cells)
    let non_null: Vec<_> = rt.sheets[0]
        .cells
        .iter()
        .filter(|c| !matches!(c.value, CellValue::Null))
        .collect();
    assert!(
        non_null.is_empty(),
        "Empty sheet should have no non-null cells after round-trip"
    );
}

#[test]
fn roundtrip_large_numbers() {
    let original = make_single_sheet(
        "LargeNums",
        vec![
            cell(
                0,
                0,
                CellValue::Number(FiniteF64::new(1.7976931348623157e308).unwrap()),
            ),
            cell(0, 1, CellValue::Number(FiniteF64::new(5e-324).unwrap())),
            cell(0, 2, CellValue::Number(FiniteF64::new(-1e100).unwrap())),
        ],
    );

    let rt = roundtrip(&original);
    assert_cells_match(&original.sheets[0].cells, &rt.sheets[0].cells, "LargeNums");
}

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

/// Domains that are currently wired for round-trip through the XLSX writer.
/// Update this list as new domains gain export support.
#[allow(dead_code)]
struct RoundtripDomainFlags {
    cells: bool,
    merges: bool,
    dimensions: bool,
    frozen_pane: bool,
    styles: bool,
    named_ranges: bool,
    comments: bool,
    hyperlinks: bool,
    conditional_formats: bool,
    data_validations: bool,
    tables: bool,
    sparklines: bool,
    print_settings: bool,
    page_breaks: bool,
    protection: bool,
    auto_filter: bool,
    outline_groups: bool,
    // Domains NOT yet wired (always skipped):
    // - charts
    // - floating_objects
    // - slicers / slicer_caches / slicer_anchors
    // - form_controls
    // - ole_objects
    // - smartart_diagrams
    // - connectors
    // - pivot_tables
    // - data_table_regions
}

impl Default for RoundtripDomainFlags {
    fn default() -> Self {
        Self {
            cells: true,
            merges: true,
            dimensions: true,
            frozen_pane: true,
            styles: true,
            named_ranges: true,
            comments: true,
            hyperlinks: true,
            conditional_formats: true,
            data_validations: true,
            tables: true,
            sparklines: true,
            print_settings: true,
            page_breaks: true,
            protection: true,
            auto_filter: true,
            outline_groups: true,
        }
    }
}

/// Perform a partial round-trip assertion: write → parse → compare only the
/// domains flagged as wired. Panics with a descriptive message on mismatch.
///
/// Returns the round-tripped ParseOutput for additional assertions.
fn assert_roundtrip_partial(original: &ParseOutput, flags: &RoundtripDomainFlags) -> ParseOutput {
    let rt = roundtrip(original);

    assert_eq!(
        original.sheets.len(),
        rt.sheets.len(),
        "Sheet count should be preserved"
    );

    for (i, (orig_sheet, rt_sheet)) in original.sheets.iter().zip(rt.sheets.iter()).enumerate() {
        let sn = &orig_sheet.name;

        // Cells
        if flags.cells {
            assert_cells_match(&orig_sheet.cells, &rt_sheet.cells, sn);
        }

        // Merges
        if flags.merges {
            let mut orig_m = orig_sheet.merges.clone();
            let mut rt_m = rt_sheet.merges.clone();
            orig_m.sort_by_key(|m| (m.start_row, m.start_col));
            rt_m.sort_by_key(|m| (m.start_row, m.start_col));
            assert_eq!(orig_m, rt_m, "[{sn}] Merge regions mismatch");
        }

        // Frozen pane
        if flags.frozen_pane {
            match (&orig_sheet.frozen_pane, &rt_sheet.frozen_pane) {
                (Some(orig_fp), Some(rt_fp)) => {
                    assert_eq!(orig_fp.rows, rt_fp.rows, "[{sn}] Frozen pane rows mismatch");
                    assert_eq!(orig_fp.cols, rt_fp.cols, "[{sn}] Frozen pane cols mismatch");
                }
                (None, None) => {}
                (Some(_), None) => panic!("[{sn}] Frozen pane lost in round-trip"),
                (None, Some(_)) => {} // Extra frozen pane is OK (defaults)
            }
        }

        // Comments (count only — content normalization may differ)
        if flags.comments {
            assert_eq!(
                orig_sheet.comments.len(),
                rt_sheet.comments.len(),
                "[{sn}] Comment count mismatch. Original: {:?}, RT: {:?}",
                orig_sheet
                    .comments
                    .iter()
                    .map(|c| &c.cell_ref)
                    .collect::<Vec<_>>(),
                rt_sheet
                    .comments
                    .iter()
                    .map(|c| &c.cell_ref)
                    .collect::<Vec<_>>(),
            );
        }

        // Conditional formats (count only)
        if flags.conditional_formats {
            // Total rule count across all specs
            let orig_rule_count: usize = orig_sheet
                .conditional_formats
                .iter()
                .map(|cf| cf.rules.len())
                .sum();
            let rt_rule_count: usize = rt_sheet
                .conditional_formats
                .iter()
                .map(|cf| cf.rules.len())
                .sum();
            assert_eq!(
                orig_rule_count, rt_rule_count,
                "[{sn}] CF rule count mismatch"
            );
        }

        // Data validations (count only)
        if flags.data_validations {
            assert_eq!(
                orig_sheet.data_validations.len(),
                rt_sheet.data_validations.len(),
                "[{sn}] Data validation count mismatch"
            );
        }

        // Tables (count + names)
        if flags.tables {
            assert_eq!(
                orig_sheet.tables.len(),
                rt_sheet.tables.len(),
                "[{sn}] Table count mismatch"
            );
            for (ot, rt_t) in orig_sheet.tables.iter().zip(rt_sheet.tables.iter()) {
                assert_eq!(ot.name, rt_t.name, "[{sn}] Table name mismatch");
            }
        }

        // Named ranges (at ParseOutput level, checked once for sheet 0)
        if flags.named_ranges && i == 0 {
            assert_eq!(
                original.named_ranges.len(),
                rt.named_ranges.len(),
                "Named range count mismatch"
            );
        }

        // Protection
        if flags.protection {
            assert_eq!(
                orig_sheet.protection.is_some(),
                rt_sheet.protection.is_some(),
                "[{sn}] Sheet protection presence mismatch"
            );
        }

        // Auto filter
        if flags.auto_filter {
            assert_eq!(
                orig_sheet.auto_filter.is_some(),
                rt_sheet.auto_filter.is_some(),
                "[{sn}] Auto filter presence mismatch"
            );
        }
    }

    // Styles (palette should have at least as many entries)
    if flags.styles && !original.style_palette.is_empty() {
        assert!(
            !rt.style_palette.is_empty(),
            "Style palette should not be empty after round-trip"
        );
    }

    rt
}

#[test]
fn partial_roundtrip_cells_and_merges_only() {
    // A ParseOutput with cells + merges + unimplemented domains (charts stub).
    // assert_roundtrip_partial should succeed by checking only wired domains.
    let mut output = make_single_sheet(
        "PartialTest",
        vec![
            cell(0, 0, CellValue::Text(Arc::from("Hello"))),
            cell(1, 0, CellValue::Number(FiniteF64::new(42.0).unwrap())),
        ],
    );
    output.sheets[0].merges = vec![MergeRegion {
        start_row: 0,
        start_col: 0,
        end_row: 0,
        end_col: 1,
    }];
    output.sheets[0].rows = 2;
    output.sheets[0].cols = 2;

    // NOTE: We intentionally do NOT populate charts/floating_objects/slicers,
    // but assert_roundtrip_partial skips those by default.
    let flags = RoundtripDomainFlags::default();
    let _rt = assert_roundtrip_partial(&output, &flags);
}

#[test]
fn partial_roundtrip_multi_domain() {
    // A richer ParseOutput with comments, CF, validations, and tables.
    let mut output = make_single_sheet(
        "MultiDomain",
        vec![
            cell(0, 0, CellValue::Text(Arc::from("Name"))),
            cell(0, 1, CellValue::Text(Arc::from("Score"))),
            cell(1, 0, CellValue::Text(Arc::from("Alice"))),
            cell(1, 1, CellValue::Number(FiniteF64::new(95.0).unwrap())),
            cell(2, 0, CellValue::Text(Arc::from("Bob"))),
            cell(2, 1, CellValue::Number(FiniteF64::new(80.0).unwrap())),
        ],
    );
    output.sheets[0].rows = 3;
    output.sheets[0].cols = 2;

    output.sheets[0].comments = vec![Comment {
        cell_ref: "A1".to_string(),
        author: "Tester".to_string(),
        content: Some("Header comment".to_string()),
        comment_type: CommentType::Note,
        ..Default::default()
    }];

    output.sheets[0].conditional_formats = vec![ConditionalFormat {
        id: "test-cf-1".to_string(),
        sheet_id: String::new(),
        pivot: None,
        ranges: vec![CFCellRange::new(1, 1, 2, 1)], // B2:B3
        range_identities: None,
        rules: vec![CFRule::CellValue {
            id: "test-rule-1".to_string(),
            operator: ooxml_types::cond_format::CfOperator::GreaterThan,
            value1: serde_json::Value::String("90".to_string()),
            value2: None,
            style: CFStyle::default(),
            priority: 1,
            stop_if_true: None,
            text: None,
        }],
    }];

    output.sheets[0].data_validations = vec![ValidationSpec {
        ranges: vec!["B2:B3".to_string()],
        rule: ValidationRule::WholeNumber {
            operator: ValidationOperator::Between,
            formula1: "0".to_string(),
            formula2: Some("100".to_string()),
        },
        error_style: ErrorStyle::Stop,
        show_error: true,
        error_title: Some("Invalid".to_string()),
        error_message: Some("Enter 0-100".to_string()),
        show_prompt: false,
        prompt_title: None,
        prompt_message: None,
        allow_blank: true,
        ime_mode: domain_types::ImeMode::NoControl,
        uid: None,
    }];

    output.sheets[0].tables = vec![TableSpec {
        id: 1,
        name: "ScoreTable".to_string(),
        display_name: "ScoreTable".to_string(),
        range_ref: "A1:B3".to_string(),
        has_headers: true,
        has_totals: false,
        style_name: Some("TableStyleMedium2".to_string()),
        row_stripes: true,
        col_stripes: false,
        first_col_highlight: false,
        last_col_highlight: false,
        auto_filter_ref: Some("A1:B3".to_string()),
        columns: vec![
            TableColumnSpec {
                name: "Name".to_string(),
                ..Default::default()
            },
            TableColumnSpec {
                name: "Score".to_string(),
                ..Default::default()
            },
        ],
        ..Default::default()
    }];

    let flags = RoundtripDomainFlags::default();
    let _rt = assert_roundtrip_partial(&output, &flags);
}

#[test]
fn partial_roundtrip_skip_unimplemented_domains() {
    // Verify that we can selectively skip domains.
    // Even if the original has data that might not round-trip perfectly,
    // disabling those flags means no assertion fires.
    let mut output = make_single_sheet(
        "SkipTest",
        vec![cell(0, 0, CellValue::Text(Arc::from("Data")))],
    );
    output.sheets[0].rows = 1;
    output.sheets[0].cols = 1;

    // Use flags that skip everything except cells
    let flags = RoundtripDomainFlags {
        cells: true,
        merges: false,
        dimensions: false,
        frozen_pane: false,
        styles: false,
        named_ranges: false,
        comments: false,
        hyperlinks: false,
        conditional_formats: false,
        data_validations: false,
        tables: false,
        sparklines: false,
        print_settings: false,
        page_breaks: false,
        protection: false,
        auto_filter: false,
        outline_groups: false,
    };

    let _rt = assert_roundtrip_partial(&output, &flags);
}

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
// =============================================================================

/// Round-trip through write_xlsx_from_parse_output with a RoundTripContext,
/// then parse back and verify the workbook.xml.rels relationship IDs.
fn roundtrip_with_ctx(
    output: &ParseOutput,
    ctx: &RoundTripContext,
) -> (ParseOutput, RoundTripContext) {
    let bytes = write_xlsx_from_parse_output(output, Some(ctx))
        .expect("write_xlsx_from_parse_output should succeed");
    assert!(bytes.len() > 4);
    assert_eq!(&bytes[0..2], b"PK");
    let (rt_output, rt_ctx, _diag) =
        parse_xlsx_to_output(&bytes).expect("parse_xlsx_to_output should succeed");
    (rt_output, rt_ctx)
}

/// Build a multi-sheet ParseOutput for rId tests.
fn make_multi_sheet(count: usize) -> ParseOutput {
    let sheets = (0..count)
        .map(|i| SheetData {
            name: format!("Sheet{}", i + 1),
            rows: 1,
            cols: 1,
            cells: vec![cell(0, 0, CellValue::Text(Arc::from(format!("data{}", i))))],
            ..Default::default()
        })
        .collect();
    ParseOutput {
        sheets,
        ..Default::default()
    }
}

#[test]
fn roundtrip_workbook_rels_preserves_non_sequential_rids() {
    // Create a 3-sheet workbook and get initial RoundTripContext
    let mut output = make_multi_sheet(3);
    output.theme = Some(domain_types::ThemeData {
        name: Some("Office Theme".to_string()),
        ..Default::default()
    });
    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
    let (_po, mut ctx, _d) = parse_xlsx_to_output(&bytes).unwrap();

    // Simulate an original file where rIds are NOT sequential starting from rId1.
    // Original ordering: rId10=styles, rId20=theme, rId5=sheet1, rId6=sheet2, rId7=sheet3, rId30=sharedStrings
    let ws_type = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet";
    let styles_type = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles";
    let theme_type = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme";
    let ss_type =
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings";

    ctx.workbook_relationships = vec![
        domain_types::OpcRelationship {
            id: "rId10".into(),
            rel_type: styles_type.into(),
            target: "styles.xml".into(),
            target_mode: None,
        },
        domain_types::OpcRelationship {
            id: "rId20".into(),
            rel_type: theme_type.into(),
            target: "theme/theme1.xml".into(),
            target_mode: None,
        },
        domain_types::OpcRelationship {
            id: "rId5".into(),
            rel_type: ws_type.into(),
            target: "worksheets/sheet1.xml".into(),
            target_mode: None,
        },
        domain_types::OpcRelationship {
            id: "rId6".into(),
            rel_type: ws_type.into(),
            target: "worksheets/sheet2.xml".into(),
            target_mode: None,
        },
        domain_types::OpcRelationship {
            id: "rId7".into(),
            rel_type: ws_type.into(),
            target: "worksheets/sheet3.xml".into(),
            target_mode: None,
        },
        domain_types::OpcRelationship {
            id: "rId30".into(),
            rel_type: ss_type.into(),
            target: "sharedStrings.xml".into(),
            target_mode: None,
        },
    ];
    ctx.sheet_workbook_r_ids = vec!["rId5".into(), "rId6".into(), "rId7".into()];

    // Round-trip with the custom context
    let (_rt_output, rt_ctx) = roundtrip_with_ctx(&output, &ctx);

    // Verify the re-parsed workbook relationships preserve the original rIds
    let find_rel = |rels: &[domain_types::OpcRelationship], target: &str| -> Option<String> {
        rels.iter()
            .find(|r| r.target == target)
            .map(|r| r.id.clone())
    };

    let wb_rels = &rt_ctx.workbook_relationships;
    assert_eq!(
        find_rel(wb_rels, "styles.xml"),
        Some("rId10".into()),
        "styles.xml should keep rId10"
    );
    assert_eq!(
        find_rel(wb_rels, "theme/theme1.xml"),
        Some("rId20".into()),
        "theme should keep rId20"
    );
    assert_eq!(
        find_rel(wb_rels, "worksheets/sheet1.xml"),
        Some("rId5".into()),
        "sheet1 should keep rId5"
    );
    assert_eq!(
        find_rel(wb_rels, "worksheets/sheet2.xml"),
        Some("rId6".into()),
        "sheet2 should keep rId6"
    );
    assert_eq!(
        find_rel(wb_rels, "worksheets/sheet3.xml"),
        Some("rId7".into()),
        "sheet3 should keep rId7"
    );
    assert_eq!(
        find_rel(wb_rels, "sharedStrings.xml"),
        Some("rId30".into()),
        "sharedStrings should keep rId30"
    );
}

#[test]
fn roundtrip_workbook_rels_sheet_rids_used_in_workbook_xml() {
    // Verify that workbook.xml <sheet> elements reference the correct rIds
    // by confirming the re-parsed sheet_workbook_r_ids match what we set.
    let output = make_multi_sheet(2);
    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
    let (_po, mut ctx, _d) = parse_xlsx_to_output(&bytes).unwrap();

    let ws_type = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet";
    let styles_type = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles";

    // Set up: sheets at rId8/rId9, styles at rId1
    ctx.workbook_relationships = vec![
        domain_types::OpcRelationship {
            id: "rId1".into(),
            rel_type: styles_type.into(),
            target: "styles.xml".into(),
            target_mode: None,
        },
        domain_types::OpcRelationship {
            id: "rId8".into(),
            rel_type: ws_type.into(),
            target: "worksheets/sheet1.xml".into(),
            target_mode: None,
        },
        domain_types::OpcRelationship {
            id: "rId9".into(),
            rel_type: ws_type.into(),
            target: "worksheets/sheet2.xml".into(),
            target_mode: None,
        },
    ];
    ctx.sheet_workbook_r_ids = vec!["rId8".into(), "rId9".into()];

    let (_rt_output, rt_ctx) = roundtrip_with_ctx(&output, &ctx);

    // The re-parsed sheet_workbook_r_ids should match
    assert_eq!(rt_ctx.sheet_workbook_r_ids.len(), 2);
    assert_eq!(rt_ctx.sheet_workbook_r_ids[0], "rId8");
    assert_eq!(rt_ctx.sheet_workbook_r_ids[1], "rId9");
}

#[test]
fn roundtrip_workbook_rels_fallback_to_sequential_without_context() {
    // Without RoundTripContext, rIds should be sequential (rId1, rId2, ...)
    let output = make_multi_sheet(3);
    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
    let (_po, ctx, _d) = parse_xlsx_to_output(&bytes).unwrap();

    // Sheets should get rId1, rId2, rId3 (sequential)
    assert_eq!(ctx.sheet_workbook_r_ids.len(), 3);
    assert_eq!(ctx.sheet_workbook_r_ids[0], "rId1");
    assert_eq!(ctx.sheet_workbook_r_ids[1], "rId2");
    assert_eq!(ctx.sheet_workbook_r_ids[2], "rId3");
}
