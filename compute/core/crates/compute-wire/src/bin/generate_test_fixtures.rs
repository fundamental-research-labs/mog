#![allow(clippy::approx_constant, clippy::pedantic)] // test fixtures intentionally use 3.14, not PI
//! Generates cross-language test fixtures for the wire binary protocol.
//!
//! Produces `.bin` files (serialized using the real serializer functions) and
//! companion `.json` files with the expected decoded values for the TypeScript
//! test suite to consume.
//!
//! Run from the repo root:
//! ```bash
//! cargo run -p compute-wire --bin generate-test-fixtures
//! ```

use compute_wire::flags::*;
use compute_wire::mutation::serialize_mutation_result;
use compute_wire::types::*;
use compute_wire::viewport::serialize_viewport_binary;
use domain_types::CellFormat;
use snapshot_types::{
    CellChange, CellErrorInfo, ProjectionCellData, ProjectionChange, RecalcMetrics, RecalcResult,
};
use value_types::{CellError, CellValue};

use std::fs;
use std::path::PathBuf;

fn fixtures_dir() -> PathBuf {
    // Run from repo root
    PathBuf::from("kernel/src/bridges/wire/__tests__/fixtures")
}

/// Build the viewport test fixture data.
fn build_viewport_data() -> ViewportRenderData {
    // 3 rows x 4 cols = 12 cells, row-major order
    // Row 10: (10,5) Number, (10,6) Text, (10,7) Error, (10,8) Null
    // Row 11: (11,5) Bool, (11,6) Number w/ comment+hyperlink, (11,7) Number w/ format
    // Row 12: all null/empty (5 cells)
    let mut cells = Vec::with_capacity(12);

    // Cell (10,5): Number 42.5, hasFormula
    cells.push(ViewportRenderCell {
        row: 10,
        col: 5,
        format_idx: 0,
        flags: VALUE_TYPE_NUMBER | HAS_FORMULA,
        number_value: 42.5,
        formatted: Some("42.5".to_string()),
        error: None,
        bg_color_override: 0,
        font_color_override: 0,
        cf_extras: None,
    });

    // Cell (10,6): Text "Hello World"
    cells.push(ViewportRenderCell {
        row: 10,
        col: 6,
        format_idx: 0,
        flags: VALUE_TYPE_TEXT,
        number_value: f64::NAN,
        formatted: Some("Hello World".to_string()),
        error: None,
        bg_color_override: 0,
        font_color_override: 0,
        cf_extras: None,
    });

    // Cell (10,7): Error #DIV/0!
    cells.push(ViewportRenderCell {
        row: 10,
        col: 7,
        format_idx: 0,
        flags: VALUE_TYPE_ERROR,
        number_value: f64::NAN,
        formatted: Some("#DIV/0!".to_string()),
        error: Some("#DIV/0!".to_string()),
        bg_color_override: 0,
        font_color_override: 0,
        cf_extras: None,
    });

    // Cell (10,8): Null (empty)
    cells.push(ViewportRenderCell {
        row: 10,
        col: 8,
        format_idx: 0,
        flags: VALUE_TYPE_NULL,
        number_value: f64::NAN,
        formatted: None,
        error: None,
        bg_color_override: 0,
        font_color_override: 0,
        cf_extras: None,
    });

    // Cell (11,5): Bool TRUE
    cells.push(ViewportRenderCell {
        row: 11,
        col: 5,
        format_idx: 0,
        flags: VALUE_TYPE_BOOL,
        number_value: 1.0,
        formatted: Some("TRUE".to_string()),
        error: None,
        bg_color_override: 0,
        font_color_override: 0,
        cf_extras: None,
    });

    // Cell (11,6): Number 0 with comment + hyperlink
    cells.push(ViewportRenderCell {
        row: 11,
        col: 6,
        format_idx: 0,
        flags: VALUE_TYPE_NUMBER | HAS_COMMENT | HAS_HYPERLINK,
        number_value: 0.0,
        formatted: Some("0".to_string()),
        error: None,
        bg_color_override: 0,
        font_color_override: 0,
        cf_extras: None,
    });

    // Cell (11,7): Number 3.14 with formatIdx=2
    cells.push(ViewportRenderCell {
        row: 11,
        col: 7,
        format_idx: 2,
        flags: VALUE_TYPE_NUMBER,
        number_value: 3.14,
        formatted: Some("3.14".to_string()),
        error: None,
        bg_color_override: 0,
        font_color_override: 0,
        cf_extras: None,
    });

    // Remaining 5 cells: row 12, cols 5-8 + one extra to fill 3x4=12
    // Actually 3 rows x 4 cols: row 12 cols 5,6,7,8
    for col in 5..=8u32 {
        cells.push(ViewportRenderCell {
            row: 12,
            col,
            format_idx: 0,
            flags: VALUE_TYPE_NULL,
            number_value: f64::NAN,
            formatted: None,
            error: None,
            bg_color_override: 0,
            font_color_override: 0,
            cf_extras: None,
        });
    }

    // That gives us 7 + 4 = 11, need one more for row 11 col 8
    // Insert it at the right position (after row 11 col 7, before row 12 cells)
    // Actually let me recalculate: 3 rows x 4 cols = 12 cells
    // Row 10: 4 cells (indices 0-3)
    // Row 11: 4 cells (indices 4-7)
    // Row 12: 4 cells (indices 8-11)
    // We have 7 cells for rows 10-11 so far, need cell (11,8) too
    // Let me restructure:
    cells.clear();

    // Row 10 (4 cells)
    cells.push(ViewportRenderCell {
        row: 10,
        col: 5,
        format_idx: 0,
        flags: VALUE_TYPE_NUMBER | HAS_FORMULA,
        number_value: 42.5,
        formatted: Some("42.5".to_string()),
        error: None,
        bg_color_override: 0,
        font_color_override: 0,
        cf_extras: None,
    });
    cells.push(ViewportRenderCell {
        row: 10,
        col: 6,
        format_idx: 0,
        flags: VALUE_TYPE_TEXT,
        number_value: f64::NAN,
        formatted: Some("Hello World".to_string()),
        error: None,
        bg_color_override: 0,
        font_color_override: 0,
        cf_extras: None,
    });
    cells.push(ViewportRenderCell {
        row: 10,
        col: 7,
        format_idx: 0,
        flags: VALUE_TYPE_ERROR,
        number_value: f64::NAN,
        formatted: Some("#DIV/0!".to_string()),
        error: Some("#DIV/0!".to_string()),
        bg_color_override: 0,
        font_color_override: 0,
        cf_extras: None,
    });
    cells.push(ViewportRenderCell {
        row: 10,
        col: 8,
        format_idx: 0,
        flags: VALUE_TYPE_NULL,
        number_value: f64::NAN,
        formatted: None,
        error: None,
        bg_color_override: 0,
        font_color_override: 0,
        cf_extras: None,
    });

    // Row 11 (4 cells)
    cells.push(ViewportRenderCell {
        row: 11,
        col: 5,
        format_idx: 0,
        flags: VALUE_TYPE_BOOL,
        number_value: 1.0,
        formatted: Some("TRUE".to_string()),
        error: None,
        bg_color_override: 0,
        font_color_override: 0,
        cf_extras: None,
    });
    cells.push(ViewportRenderCell {
        row: 11,
        col: 6,
        format_idx: 0,
        flags: VALUE_TYPE_NUMBER | HAS_COMMENT | HAS_HYPERLINK,
        number_value: 0.0,
        formatted: Some("0".to_string()),
        error: None,
        bg_color_override: 0,
        font_color_override: 0,
        cf_extras: None,
    });
    cells.push(ViewportRenderCell {
        row: 11,
        col: 7,
        format_idx: 2,
        flags: VALUE_TYPE_NUMBER,
        number_value: 3.14,
        formatted: Some("3.14".to_string()),
        error: None,
        bg_color_override: 0,
        font_color_override: 0,
        cf_extras: None,
    });
    cells.push(ViewportRenderCell {
        row: 11,
        col: 8,
        format_idx: 0,
        flags: VALUE_TYPE_NULL,
        number_value: f64::NAN,
        formatted: None,
        error: None,
        bg_color_override: 0,
        font_color_override: 0,
        cf_extras: None,
    });

    // Row 12 (4 cells, all null)
    for col in 5..=8u32 {
        cells.push(ViewportRenderCell {
            row: 12,
            col,
            format_idx: 0,
            flags: VALUE_TYPE_NULL,
            number_value: f64::NAN,
            formatted: None,
            error: None,
            bg_color_override: 0,
            font_color_override: 0,
            cf_extras: None,
        });
    }

    assert_eq!(cells.len(), 12);

    // Format palette: default + bold + number format
    let format_palette = vec![
        CellFormat::default(), // index 0
        CellFormat {
            bold: Some(true),
            ..Default::default()
        }, // index 1
        CellFormat {
            number_format: Some("#,##0.00".to_string()),
            ..Default::default()
        }, // index 2
    ];

    ViewportRenderData {
        cells,
        format_palette,
        merges: vec![RenderViewportMerge {
            start_row: 10,
            start_col: 5,
            end_row: 10,
            end_col: 6,
        }],
        row_dimensions: vec![RenderRowDimension {
            row: 11,
            height: 30.0,
            hidden: false,
        }],
        col_dimensions: vec![RenderColDimension {
            col: 7,
            width: 120.0,
            hidden: true,
        }],
        viewport_rows: 3,
        viewport_cols: 4,
        start_row: 10,
        start_col: 5,
        row_positions: Vec::new(),
        col_positions: Vec::new(),
    }
}

fn build_viewport_json() -> serde_json::Value {
    serde_json::json!({
        "startRow": 10,
        "startCol": 5,
        "rows": 3,
        "cols": 4,
        "cellCount": 12,
        "generation": 7,
        "cells": [
            { "row": 10, "col": 5, "numberValue": 42.5, "display": "42.5", "valueType": 1, "hasFormula": true },
            { "row": 10, "col": 6, "numberValue": null, "display": "Hello World", "valueType": 2 },
            { "row": 10, "col": 7, "numberValue": null, "display": "#DIV/0!", "error": "#DIV/0!", "valueType": 4 },
            { "row": 10, "col": 8, "valueType": 0 },
            { "row": 11, "col": 5, "numberValue": 1.0, "display": "TRUE", "valueType": 3 },
            { "row": 11, "col": 6, "numberValue": 0.0, "display": "0", "valueType": 1, "hasComment": true, "hasHyperlink": true },
            { "row": 11, "col": 7, "numberValue": 3.14, "display": "3.14", "valueType": 1, "formatIdx": 2 },
            { "row": 11, "col": 8, "valueType": 0 },
            { "row": 12, "col": 5, "valueType": 0 },
            { "row": 12, "col": 6, "valueType": 0 },
            { "row": 12, "col": 7, "valueType": 0 },
            { "row": 12, "col": 8, "valueType": 0 }
        ],
        "merges": [{ "startRow": 10, "startCol": 5, "endRow": 10, "endCol": 6 }],
        "rowDimensions": [{ "row": 11, "height": 30.0, "hidden": false }],
        "colDimensions": [{ "col": 7, "width": 120.0, "hidden": true }]
    })
}

/// Build the mutation test fixture data.
fn build_mutation_recalc_result() -> RecalcResult {
    RecalcResult {
        changed_cells: vec![
            // Patch 0: row=10, col=5, Number 100.0, display="100"
            // Note: HAS_FORMULA is not in CellChange (flags are derived from CellValue type)
            // We can only set value type via CellValue. HAS_FORMULA isn't tracked in RecalcResult.
            CellChange {
                cell_id: "cell-0".to_string(),
                sheet_id: "test-sheet-1".to_string(),
                position: Some(snapshot_types::CellPosition { row: 10, col: 5 }),
                value: CellValue::number(100.0),
                display_text: Some("100".to_string()),
                old_display_text: None,
                old_formula: None,
                new_formula: None,
                number_format: None,
                format_idx: None,
                extra_flags: 0,
                old_value: None,
            },
            // Patch 1: row=10, col=7, Error #NAME?
            CellChange {
                cell_id: "cell-1".to_string(),
                sheet_id: "test-sheet-1".to_string(),
                position: Some(snapshot_types::CellPosition { row: 10, col: 7 }),
                value: CellValue::Error(CellError::Name, None),
                display_text: Some("#NAME?".to_string()),
                old_display_text: None,
                old_formula: None,
                new_formula: None,
                number_format: None,
                format_idx: None,
                extra_flags: 0,
                old_value: None,
            },
            // Patch 2: row=11, col=5, Bool FALSE
            CellChange {
                cell_id: "cell-2".to_string(),
                sheet_id: "test-sheet-1".to_string(),
                position: Some(snapshot_types::CellPosition { row: 11, col: 5 }),
                value: CellValue::Boolean(false),
                display_text: Some("FALSE".to_string()),
                old_display_text: None,
                old_formula: None,
                new_formula: None,
                number_format: None,
                format_idx: None,
                extra_flags: 0,
                old_value: None,
            },
        ],
        projection_changes: vec![ProjectionChange {
            source_cell_id: "cell-spill-source".to_string(),
            sheet_id: "test-sheet-1".to_string(),
            is_cse: false,
            projection_cells: vec![ProjectionCellData {
                cell_id: "cell-spill-0".to_string(),
                row: 12,
                col: 5,
                value: CellValue::Text("spilled".to_string().into()),
            }],
        }],
        errors: vec![CellErrorInfo {
            cell_id: "cell-1".to_string(),
            sheet_id: "test-sheet-1".to_string(),
            error: "#NAME?".to_string(),
        }],
        validation_annotations: vec![],
        metrics: RecalcMetrics::default(),
        old_values: std::collections::HashMap::new(),
        policy_preserved_parse_outcomes: Vec::new(),
        policy_preserved_parse_summary: None,
    }
}

fn build_mutation_json() -> serde_json::Value {
    serde_json::json!({
        "sheetId": "test-sheet-1",
        "generation": 3,
        "hasErrors": true,
        "hasProjectionChanges": true,
        "patchCount": 3,
        "patches": [
            { "row": 10, "col": 5, "numberValue": 100.0, "display": "100" },
            { "row": 10, "col": 7, "display": "#NAME?", "error": "#NAME?" },
            { "row": 11, "col": 5, "numberValue": 0.0, "display": "FALSE" }
        ],
        "spillPatchCount": 1,
        "spillPatches": [
            { "row": 12, "col": 5, "display": "spilled" }
        ]
    })
}

fn main() {
    let dir = fixtures_dir();
    fs::create_dir_all(&dir).expect("Failed to create fixtures directory");

    // --- Viewport fixture ---
    let viewport_data = build_viewport_data();
    let viewport_bin = serialize_viewport_binary(&viewport_data, 7, false, 0);
    let viewport_json = build_viewport_json();

    let viewport_bin_path = dir.join("viewport.bin");
    let viewport_json_path = dir.join("viewport.json");

    fs::write(&viewport_bin_path, &viewport_bin).expect("Failed to write viewport.bin");
    fs::write(
        &viewport_json_path,
        serde_json::to_string_pretty(&viewport_json).unwrap(),
    )
    .expect("Failed to write viewport.json");

    println!(
        "Wrote viewport.bin ({} bytes) -> {}",
        viewport_bin.len(),
        viewport_bin_path.display()
    );
    println!("Wrote viewport.json -> {}", viewport_json_path.display());

    // --- Mutation fixture ---
    let mutation_result = build_mutation_recalc_result();
    let mutation_bin = serialize_mutation_result(&mutation_result, "test-sheet-1", 3, None);
    let mutation_json = build_mutation_json();

    let mutation_bin_path = dir.join("mutation.bin");
    let mutation_json_path = dir.join("mutation.json");

    fs::write(&mutation_bin_path, &mutation_bin).expect("Failed to write mutation.bin");
    fs::write(
        &mutation_json_path,
        serde_json::to_string_pretty(&mutation_json).unwrap(),
    )
    .expect("Failed to write mutation.json");

    println!(
        "Wrote mutation.bin ({} bytes) -> {}",
        mutation_bin.len(),
        mutation_bin_path.display()
    );
    println!("Wrote mutation.json -> {}", mutation_json_path.display());

    println!("\nAll test fixtures generated successfully.");
}
