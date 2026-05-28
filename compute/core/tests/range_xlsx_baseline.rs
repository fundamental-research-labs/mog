//! Range-refactor XLSX round-trip baseline tests.
//!
//! Documents current behavior for large-scale numeric data, formulas,
//! and anchored cells (merges) before the Range refactor lands.
//!
//! Run:
//!   cargo test -p compute-core --features perf-tests \
//!     --test range_xlsx_baseline -- --nocapture

#![cfg(feature = "perf-tests")]

use std::sync::Arc;

use compute_core::storage::engine::YrsComputeEngine;
use domain_types::{CellData, DocumentFormat, FontFormat, MergeRegion, ParseOutput, SheetData};
use value_types::{CellValue, FiniteF64};
use xlsx_parser::write::write_xlsx_from_parse_output;

/// Number of rows used in bulk tests.
/// Set to 100_000 for the full baseline; reduce if compile/run time is prohibitive.
const N: u32 = 100_000;
const N_500K: u32 = 500_000;
const N_1M: u32 = 1_000_000;

// ── helpers ────────────────────────────────────────────────────────────────

fn num_cell(row: u32, col: u32, n: f64) -> CellData {
    CellData {
        row,
        col,
        value: CellValue::Number(FiniteF64::must(n)),
        ..Default::default()
    }
}

fn formula_cell(row: u32, col: u32, formula: &str) -> CellData {
    CellData {
        row,
        col,
        formula: Some(formula.to_string()),
        // Cached value is 0; the formula text is what we care about.
        value: CellValue::Number(FiniteF64::must(0.0)),
        ..Default::default()
    }
}

fn text_cell(row: u32, col: u32, s: &str) -> CellData {
    CellData {
        row,
        col,
        value: CellValue::Text(Arc::from(s)),
        ..Default::default()
    }
}

/// Build a single-sheet `ParseOutput` from the given cells.
fn single_sheet(name: &str, rows: u32, cols: u32, cells: Vec<CellData>) -> ParseOutput {
    ParseOutput {
        sheets: vec![SheetData {
            name: name.to_string(),
            rows,
            cols,
            cells,
            ..Default::default()
        }],
        ..Default::default()
    }
}

fn styled_num_cell(row: u32, col: u32, n: f64, style_id: u32) -> CellData {
    CellData {
        row,
        col,
        value: CellValue::Number(FiniteF64::must(n)),
        style_id: Some(style_id),
        ..Default::default()
    }
}

/// Full round-trip: ParseOutput -> XLSX bytes -> engine -> export -> re-parse.
/// Returns the re-parsed `ParseOutput`.
fn roundtrip(po: &ParseOutput) -> ParseOutput {
    let xlsx_bytes = write_xlsx_from_parse_output(po).expect("write_xlsx_from_parse_output");
    let (engine, _) = YrsComputeEngine::from_xlsx_bytes(&xlsx_bytes).expect("from_xlsx_bytes");
    let exported = engine.export_to_xlsx_bytes().expect("export_to_xlsx_bytes");
    let (reparsed, _ctx, _diags) =
        xlsx_parser::parse_xlsx_to_output(&exported).expect("parse_xlsx_to_output");
    reparsed
}

// ── tests ──────────────────────────────────────────────────────────────────

#[test]
fn xlsx_roundtrip_100k_numeric_column() {
    // Build N numeric cells in column A (values 1.0 .. N).
    let cells: Vec<CellData> = (0..N).map(|r| num_cell(r, 0, (r + 1) as f64)).collect();
    let po = single_sheet("Numeric", N, 1, cells);

    let reparsed = roundtrip(&po);
    let sheet = &reparsed.sheets[0];

    assert_eq!(
        sheet.cells.len() as u32,
        N,
        "cell count mismatch after round-trip"
    );

    // Spot-check first, last, and a middle row.
    let find =
        |row: u32| -> Option<&CellData> { sheet.cells.iter().find(|c| c.row == row && c.col == 0) };
    let check = |row: u32, expected: f64| {
        let cell = find(row).unwrap_or_else(|| panic!("missing cell at row {row}"));
        match cell.value {
            CellValue::Number(n) => assert!(
                (n.get() - expected).abs() < 1e-10,
                "row {row}: expected {expected}, got {}",
                n.get()
            ),
            ref other => panic!("row {row}: expected Number, got {other:?}"),
        }
    };
    check(0, 1.0);
    check(N / 2, (N / 2 + 1) as f64);
    check(N - 1, N as f64);
}

#[test]
fn xlsx_roundtrip_preserves_formulas_in_numeric_sea() {
    let mut cells: Vec<CellData> = (0..N).map(|r| num_cell(r, 0, (r + 1) as f64)).collect();

    // Scatter 10 formula cells at rows 100, 200, ..., 1000.
    let formulas = [
        (100, "=A1+1"),
        (200, "=SUM(A1:A10)"),
        (300, "=AVERAGE(A1:A100)"),
        (400, "=MAX(A1:A200)"),
        (500, "=MIN(A1:A500)"),
        (600, "=A1*2"),
        (700, "=A1+A2+A3"),
        (800, "=COUNT(A1:A800)"),
        (900, "=IF(A1>0,1,0)"),
        (1000, "=A999+A998"),
    ];
    for &(row, f) in &formulas {
        cells[row as usize] = formula_cell(row, 0, f);
    }

    let po = single_sheet("Formulas", N, 1, cells);
    let reparsed = roundtrip(&po);
    let sheet = &reparsed.sheets[0];

    for &(row, expected_formula) in &formulas {
        let cell = sheet
            .cells
            .iter()
            .find(|c| c.row == row && c.col == 0)
            .unwrap_or_else(|| panic!("missing formula cell at row {row}"));
        let actual = cell
            .formula
            .as_deref()
            .unwrap_or_else(|| panic!("row {row}: formula field is None after round-trip"));
        // The formula text stored in ParseOutput omits the leading '='.
        let expected_body = expected_formula
            .strip_prefix('=')
            .unwrap_or(expected_formula);
        assert_eq!(
            actual, expected_body,
            "row {row}: formula mismatch after round-trip"
        );
    }
}

#[test]
fn xlsx_roundtrip_preserves_anchored_cells() {
    let mut cells: Vec<CellData> = (0..N).map(|r| num_cell(r, 0, (r + 1) as f64)).collect();
    // Add a text cell in column B for merge anchor visibility.
    cells.push(text_cell(0, 1, "merged"));
    cells.push(text_cell(0, 2, "also merged"));
    cells.push(num_cell(1, 1, 99.0));
    cells.push(num_cell(1, 2, 100.0));

    let merges = vec![MergeRegion {
        start_row: 0,
        start_col: 1,
        end_row: 1,
        end_col: 2,
    }];

    let po = ParseOutput {
        sheets: vec![SheetData {
            name: "Anchored".to_string(),
            rows: N,
            cols: 3,
            cells,
            merges,
            ..Default::default()
        }],
        ..Default::default()
    };

    let reparsed = roundtrip(&po);
    let sheet = &reparsed.sheets[0];

    // Assert merge survives round-trip.
    assert!(
        !sheet.merges.is_empty(),
        "merge regions lost after round-trip; merges = {:?}",
        sheet.merges
    );
    let m = &sheet.merges[0];
    assert_eq!(m.start_row, 0, "merge start_row");
    assert_eq!(m.start_col, 1, "merge start_col");
    assert_eq!(m.end_row, 1, "merge end_row");
    assert_eq!(m.end_col, 2, "merge end_col");

    // Assert numeric data also survived.
    let a1 = sheet.cells.iter().find(|c| c.row == 0 && c.col == 0);
    assert!(a1.is_some(), "A1 numeric cell lost after round-trip");
    let a_last = sheet.cells.iter().find(|c| c.row == N - 1 && c.col == 0);
    assert!(
        a_last.is_some(),
        "last numeric cell (row {}) lost after round-trip",
        N - 1
    );
}

#[test]
fn xlsx_import_wall_clock_100k() {
    // Build a 100k-row ParseOutput and measure import wall-clock time.
    let cells: Vec<CellData> = (0..N).map(|r| num_cell(r, 0, (r + 1) as f64)).collect();
    let po = single_sheet("WallClock", N, 1, cells);

    let xlsx_bytes = write_xlsx_from_parse_output(&po).expect("write_xlsx_from_parse_output");

    let start = std::time::Instant::now();
    let (engine, _) = YrsComputeEngine::from_xlsx_bytes(&xlsx_bytes).expect("from_xlsx_bytes");
    let import_elapsed = start.elapsed();

    // Print timing (not gated — just recording baseline).
    eprintln!(
        "[range_xlsx_baseline] import {N} rows: {:.3}s ({:.0} rows/sec)",
        import_elapsed.as_secs_f64(),
        N as f64 / import_elapsed.as_secs_f64()
    );

    // Sanity: engine has the right number of sheets.
    assert_eq!(
        engine.mirror().sheet_ids().count(),
        1,
        "expected 1 sheet after import"
    );

    // Measure export too, for reference.
    let start = std::time::Instant::now();
    let _exported = engine.export_to_xlsx_bytes().expect("export_to_xlsx_bytes");
    let export_elapsed = start.elapsed();
    eprintln!(
        "[range_xlsx_baseline] export {N} rows: {:.3}s ({:.0} rows/sec)",
        export_elapsed.as_secs_f64(),
        N as f64 / export_elapsed.as_secs_f64()
    );
}

// ── 500k / 1M scale tests ────────────────────────────────────────────────

#[test]
#[ignore]
fn xlsx_import_wall_clock_500k() {
    let cells: Vec<CellData> = (0..N_500K)
        .map(|r| num_cell(r, 0, (r + 1) as f64))
        .collect();
    let po = single_sheet("WallClock500k", N_500K, 1, cells);

    let xlsx_bytes = write_xlsx_from_parse_output(&po).expect("write_xlsx_from_parse_output");

    let start = std::time::Instant::now();
    let (engine, _) = YrsComputeEngine::from_xlsx_bytes(&xlsx_bytes).expect("from_xlsx_bytes");
    let import_elapsed = start.elapsed();

    eprintln!(
        "[range_xlsx_baseline] import {N_500K} rows: {:.3}s ({:.0} rows/sec)",
        import_elapsed.as_secs_f64(),
        N_500K as f64 / import_elapsed.as_secs_f64()
    );

    assert_eq!(
        engine.mirror().sheet_ids().count(),
        1,
        "expected 1 sheet after import"
    );

    let start = std::time::Instant::now();
    let _exported = engine.export_to_xlsx_bytes().expect("export_to_xlsx_bytes");
    let export_elapsed = start.elapsed();
    eprintln!(
        "[range_xlsx_baseline] export {N_500K} rows: {:.3}s ({:.0} rows/sec)",
        export_elapsed.as_secs_f64(),
        N_500K as f64 / export_elapsed.as_secs_f64()
    );
}

#[test]
#[ignore]
fn xlsx_import_wall_clock_1m() {
    let cells: Vec<CellData> = (0..N_1M).map(|r| num_cell(r, 0, (r + 1) as f64)).collect();
    let po = single_sheet("WallClock1M", N_1M, 1, cells);

    let xlsx_bytes = write_xlsx_from_parse_output(&po).expect("write_xlsx_from_parse_output");

    let start = std::time::Instant::now();
    let (engine, _) = YrsComputeEngine::from_xlsx_bytes(&xlsx_bytes).expect("from_xlsx_bytes");
    let import_elapsed = start.elapsed();

    eprintln!(
        "[range_xlsx_baseline] import {N_1M} rows: {:.3}s ({:.0} rows/sec)",
        import_elapsed.as_secs_f64(),
        N_1M as f64 / import_elapsed.as_secs_f64()
    );

    assert_eq!(
        engine.mirror().sheet_ids().count(),
        1,
        "expected 1 sheet after import"
    );

    let start = std::time::Instant::now();
    let _exported = engine.export_to_xlsx_bytes().expect("export_to_xlsx_bytes");
    let export_elapsed = start.elapsed();
    eprintln!(
        "[range_xlsx_baseline] export {N_1M} rows: {:.3}s ({:.0} rows/sec)",
        export_elapsed.as_secs_f64(),
        N_1M as f64 / export_elapsed.as_secs_f64()
    );
}

#[test]
#[ignore]
fn xlsx_roundtrip_500k_numeric_column() {
    let cells: Vec<CellData> = (0..N_500K)
        .map(|r| num_cell(r, 0, (r + 1) as f64))
        .collect();
    let po = single_sheet("Numeric500k", N_500K, 1, cells);

    let reparsed = roundtrip(&po);
    let sheet = &reparsed.sheets[0];

    assert_eq!(
        sheet.cells.len() as u32,
        N_500K,
        "cell count mismatch after round-trip"
    );

    // Spot-check first, last, middle, and quarter positions.
    let find =
        |row: u32| -> Option<&CellData> { sheet.cells.iter().find(|c| c.row == row && c.col == 0) };
    let check = |row: u32, expected: f64| {
        let cell = find(row).unwrap_or_else(|| panic!("missing cell at row {row}"));
        match cell.value {
            CellValue::Number(n) => assert!(
                (n.get() - expected).abs() < 1e-10,
                "row {row}: expected {expected}, got {}",
                n.get()
            ),
            ref other => panic!("row {row}: expected Number, got {other:?}"),
        }
    };
    check(0, 1.0);
    check(N_500K / 4, (N_500K / 4 + 1) as f64);
    check(N_500K / 2, (N_500K / 2 + 1) as f64);
    check(3 * N_500K / 4, (3 * N_500K / 4 + 1) as f64);
    check(N_500K - 1, N_500K as f64);
}

#[test]
#[ignore]
fn xlsx_roundtrip_1m_numeric_column() {
    let cells: Vec<CellData> = (0..N_1M).map(|r| num_cell(r, 0, (r + 1) as f64)).collect();
    let po = single_sheet("Numeric1M", N_1M, 1, cells);

    let reparsed = roundtrip(&po);
    let sheet = &reparsed.sheets[0];

    assert_eq!(
        sheet.cells.len() as u32,
        N_1M,
        "cell count mismatch after round-trip"
    );

    // Spot-check first, last, middle, and quarter positions.
    let find =
        |row: u32| -> Option<&CellData> { sheet.cells.iter().find(|c| c.row == row && c.col == 0) };
    let check = |row: u32, expected: f64| {
        let cell = find(row).unwrap_or_else(|| panic!("missing cell at row {row}"));
        match cell.value {
            CellValue::Number(n) => assert!(
                (n.get() - expected).abs() < 1e-10,
                "row {row}: expected {expected}, got {}",
                n.get()
            ),
            ref other => panic!("row {row}: expected Number, got {other:?}"),
        }
    };
    check(0, 1.0);
    check(N_1M / 4, (N_1M / 4 + 1) as f64);
    check(N_1M / 2, (N_1M / 2 + 1) as f64);
    check(3 * N_1M / 4, (3 * N_1M / 4 + 1) as f64);
    check(N_1M - 1, N_1M as f64);
}

#[test]
#[ignore]
fn xlsx_roundtrip_preserves_formulas_500k() {
    let mut cells: Vec<CellData> = (0..N_500K)
        .map(|r| num_cell(r, 0, (r + 1) as f64))
        .collect();

    // Scatter 10 formula cells at rows 100, 200, ..., 1000.
    let formulas = [
        (100, "=A1+1"),
        (200, "=SUM(A1:A10)"),
        (300, "=AVERAGE(A1:A100)"),
        (400, "=MAX(A1:A200)"),
        (500, "=MIN(A1:A500)"),
        (600, "=A1*2"),
        (700, "=A1+A2+A3"),
        (800, "=COUNT(A1:A800)"),
        (900, "=IF(A1>0,1,0)"),
        (1000, "=A999+A998"),
    ];
    for &(row, f) in &formulas {
        cells[row as usize] = formula_cell(row, 0, f);
    }

    let po = single_sheet("Formulas500k", N_500K, 1, cells);
    let reparsed = roundtrip(&po);
    let sheet = &reparsed.sheets[0];

    for &(row, expected_formula) in &formulas {
        let cell = sheet
            .cells
            .iter()
            .find(|c| c.row == row && c.col == 0)
            .unwrap_or_else(|| panic!("missing formula cell at row {row}"));
        let actual = cell
            .formula
            .as_deref()
            .unwrap_or_else(|| panic!("row {row}: formula field is None after round-trip"));
        let expected_body = expected_formula
            .strip_prefix('=')
            .unwrap_or(expected_formula);
        assert_eq!(
            actual, expected_body,
            "row {row}: formula mismatch after round-trip"
        );
    }
}

#[test]
#[ignore]
fn xlsx_roundtrip_preserves_formulas_1m() {
    let mut cells: Vec<CellData> = (0..N_1M).map(|r| num_cell(r, 0, (r + 1) as f64)).collect();

    // Scatter 10 formula cells at rows 100, 200, ..., 1000.
    let formulas = [
        (100, "=A1+1"),
        (200, "=SUM(A1:A10)"),
        (300, "=AVERAGE(A1:A100)"),
        (400, "=MAX(A1:A200)"),
        (500, "=MIN(A1:A500)"),
        (600, "=A1*2"),
        (700, "=A1+A2+A3"),
        (800, "=COUNT(A1:A800)"),
        (900, "=IF(A1>0,1,0)"),
        (1000, "=A999+A998"),
    ];
    for &(row, f) in &formulas {
        cells[row as usize] = formula_cell(row, 0, f);
    }

    let po = single_sheet("Formulas1M", N_1M, 1, cells);
    let reparsed = roundtrip(&po);
    let sheet = &reparsed.sheets[0];

    for &(row, expected_formula) in &formulas {
        let cell = sheet
            .cells
            .iter()
            .find(|c| c.row == row && c.col == 0)
            .unwrap_or_else(|| panic!("missing formula cell at row {row}"));
        let actual = cell
            .formula
            .as_deref()
            .unwrap_or_else(|| panic!("row {row}: formula field is None after round-trip"));
        let expected_body = expected_formula
            .strip_prefix('=')
            .unwrap_or(expected_formula);
        assert_eq!(
            actual, expected_body,
            "row {row}: formula mismatch after round-trip"
        );
    }
}

#[test]
#[ignore]
fn xlsx_roundtrip_preserves_anchored_cells_500k() {
    let mut cells: Vec<CellData> = (0..N_500K)
        .map(|r| num_cell(r, 0, (r + 1) as f64))
        .collect();
    cells.push(text_cell(0, 1, "merged"));
    cells.push(text_cell(0, 2, "also merged"));
    cells.push(num_cell(1, 1, 99.0));
    cells.push(num_cell(1, 2, 100.0));

    let merges = vec![MergeRegion {
        start_row: 0,
        start_col: 1,
        end_row: 1,
        end_col: 2,
    }];

    let po = ParseOutput {
        sheets: vec![SheetData {
            name: "Anchored500k".to_string(),
            rows: N_500K,
            cols: 3,
            cells,
            merges,
            ..Default::default()
        }],
        ..Default::default()
    };

    let reparsed = roundtrip(&po);
    let sheet = &reparsed.sheets[0];

    assert!(
        !sheet.merges.is_empty(),
        "merge regions lost after round-trip; merges = {:?}",
        sheet.merges
    );
    let m = &sheet.merges[0];
    assert_eq!(m.start_row, 0, "merge start_row");
    assert_eq!(m.start_col, 1, "merge start_col");
    assert_eq!(m.end_row, 1, "merge end_row");
    assert_eq!(m.end_col, 2, "merge end_col");

    let a1 = sheet.cells.iter().find(|c| c.row == 0 && c.col == 0);
    assert!(a1.is_some(), "A1 numeric cell lost after round-trip");
    let a_last = sheet
        .cells
        .iter()
        .find(|c| c.row == N_500K - 1 && c.col == 0);
    assert!(
        a_last.is_some(),
        "last numeric cell (row {}) lost after round-trip",
        N_500K - 1
    );
}

#[test]
#[ignore]
fn xlsx_roundtrip_preserves_anchored_cells_1m() {
    let mut cells: Vec<CellData> = (0..N_1M).map(|r| num_cell(r, 0, (r + 1) as f64)).collect();
    cells.push(text_cell(0, 1, "merged"));
    cells.push(text_cell(0, 2, "also merged"));
    cells.push(num_cell(1, 1, 99.0));
    cells.push(num_cell(1, 2, 100.0));

    let merges = vec![MergeRegion {
        start_row: 0,
        start_col: 1,
        end_row: 1,
        end_col: 2,
    }];

    let po = ParseOutput {
        sheets: vec![SheetData {
            name: "Anchored1M".to_string(),
            rows: N_1M,
            cols: 3,
            cells,
            merges,
            ..Default::default()
        }],
        ..Default::default()
    };

    let reparsed = roundtrip(&po);
    let sheet = &reparsed.sheets[0];

    assert!(
        !sheet.merges.is_empty(),
        "merge regions lost after round-trip; merges = {:?}",
        sheet.merges
    );
    let m = &sheet.merges[0];
    assert_eq!(m.start_row, 0, "merge start_row");
    assert_eq!(m.start_col, 1, "merge start_col");
    assert_eq!(m.end_row, 1, "merge end_row");
    assert_eq!(m.end_col, 2, "merge end_col");

    let a1 = sheet.cells.iter().find(|c| c.row == 0 && c.col == 0);
    assert!(a1.is_some(), "A1 numeric cell lost after round-trip");
    let a_last = sheet.cells.iter().find(|c| c.row == N_1M - 1 && c.col == 0);
    assert!(
        a_last.is_some(),
        "last numeric cell (row {}) lost after round-trip",
        N_1M - 1
    );
}

// ── format scale tests ───────────────────────────────────────────────────

#[test]
#[ignore]
fn scale_format_column_bold_100k() {
    // Apply column-wide bold formatting to 100k cells and verify round-trip.
    let bold = DocumentFormat {
        font: Some(FontFormat {
            bold: Some(true),
            ..Default::default()
        }),
        ..Default::default()
    };

    let cells: Vec<CellData> = (0..N)
        .map(|r| styled_num_cell(r, 0, (r + 1) as f64, 0))
        .collect();

    let mut po = single_sheet("BoldScale100k", N, 1, cells);
    po.style_palette = vec![bold];

    let start = std::time::Instant::now();
    let reparsed = roundtrip(&po);
    let elapsed = start.elapsed();

    eprintln!(
        "[range_xlsx_baseline] bold format round-trip {N} rows: {:.3}s",
        elapsed.as_secs_f64()
    );

    let sheet = &reparsed.sheets[0];
    assert_eq!(
        sheet.cells.len() as u32,
        N,
        "cell count mismatch after bold round-trip"
    );

    // Spot-check that bold survives on first, middle, and last cells.
    for probe_row in [0, N / 2, N - 1] {
        let cell = sheet
            .cells
            .iter()
            .find(|c| c.row == probe_row && c.col == 0)
            .unwrap_or_else(|| panic!("missing cell at row {probe_row}"));
        let sid = cell
            .style_id
            .unwrap_or_else(|| panic!("row {probe_row}: style_id is None after round-trip"));
        let fmt = &reparsed.style_palette[sid as usize];
        let font = fmt
            .font
            .as_ref()
            .unwrap_or_else(|| panic!("row {probe_row}: font is None after round-trip"));
        assert_eq!(
            font.bold,
            Some(true),
            "row {probe_row}: bold should be preserved"
        );
    }
}

#[test]
#[ignore]
fn scale_format_column_bold_1m() {
    // Apply column-wide bold formatting to 1M cells and verify round-trip.
    let bold = DocumentFormat {
        font: Some(FontFormat {
            bold: Some(true),
            ..Default::default()
        }),
        ..Default::default()
    };

    let cells: Vec<CellData> = (0..N_1M)
        .map(|r| styled_num_cell(r, 0, (r + 1) as f64, 0))
        .collect();

    let mut po = single_sheet("BoldScale1M", N_1M, 1, cells);
    po.style_palette = vec![bold];

    let start = std::time::Instant::now();
    let reparsed = roundtrip(&po);
    let elapsed = start.elapsed();

    eprintln!(
        "[range_xlsx_baseline] bold format round-trip {N_1M} rows: {:.3}s",
        elapsed.as_secs_f64()
    );

    let sheet = &reparsed.sheets[0];
    assert_eq!(
        sheet.cells.len() as u32,
        N_1M,
        "cell count mismatch after bold round-trip"
    );

    // Spot-check that bold survives on first, quarter, middle, three-quarter, and last cells.
    for probe_row in [0, N_1M / 4, N_1M / 2, 3 * N_1M / 4, N_1M - 1] {
        let cell = sheet
            .cells
            .iter()
            .find(|c| c.row == probe_row && c.col == 0)
            .unwrap_or_else(|| panic!("missing cell at row {probe_row}"));
        let sid = cell
            .style_id
            .unwrap_or_else(|| panic!("row {probe_row}: style_id is None after round-trip"));
        let fmt = &reparsed.style_palette[sid as usize];
        let font = fmt
            .font
            .as_ref()
            .unwrap_or_else(|| panic!("row {probe_row}: font is None after round-trip"));
        assert_eq!(
            font.bold,
            Some(true),
            "row {probe_row}: bold should be preserved"
        );
    }
}
