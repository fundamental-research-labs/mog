//! XLSX round-trip tests for `sort_range`.
//!
//! Target: `compute/core/src/storage/sheet/sorting.rs`.
//!
//! Fixture is a sheet with 10 rows × 4 cols of mixed numeric / text /
//! formula cells, materialized via `from_snapshot` → `export_to_xlsx_bytes`
//! then re-loaded via `from_xlsx_bytes` (so the `cellGrid` sub-map is NOT
//! populated, which is where hydration-invariant bugs surface).
//!
//! Each test sorts, exports, re-parses the resulting XLSX, and asserts
//! that every formula's A1 references were shifted to the cell's new row.
//!
//! Tests that fail on today's `dev` are tagged with
//! `#[ignore = "fix target: storage/sheet/sorting.rs"]`.

use compute_core::bridge_types::{BridgeSortCriterion, BridgeSortMode, BridgeSortOptions};
use compute_core::storage::engine::YrsComputeEngine;
use domain_types::domain::filter::SortOrder;
use snapshot_types::{CellData, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellValue, FiniteF64};

fn one_sheet_snapshot(name: &str, rows: u32, cols: u32, cells: Vec<CellData>) -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
            name: name.to_string(),
            rows,
            cols,
            cells,
            ranges: vec![],
        }],
        ..Default::default()
    }
}

fn value_cell(uuid_suffix: u32, row: u32, col: u32, n: f64) -> CellData {
    CellData {
        cell_id: format!("a0000000-0000-0000-0000-{:012x}", uuid_suffix),
        row,
        col,
        value: CellValue::Number(FiniteF64::must(n)),
        formula: None,
        identity_formula: None,
        array_ref: None,
    }
}

fn text_cell(uuid_suffix: u32, row: u32, col: u32, s: &str) -> CellData {
    CellData {
        cell_id: format!("a0000000-0000-0000-0000-{:012x}", uuid_suffix),
        row,
        col,
        value: CellValue::Text(s.to_string().into()),
        formula: None,
        identity_formula: None,
        array_ref: None,
    }
}

fn formula_cell(uuid_suffix: u32, row: u32, col: u32, formula: &str, cached: f64) -> CellData {
    CellData {
        cell_id: format!("a0000000-0000-0000-0000-{:012x}", uuid_suffix),
        row,
        col,
        value: CellValue::Number(FiniteF64::must(cached)),
        formula: Some(formula.to_string()),
        identity_formula: None,
        array_ref: None,
    }
}

fn xlsx_bytes_for(snapshot: WorkbookSnapshot) -> Vec<u8> {
    let (engine, _) = YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
    engine.export_to_xlsx_bytes().expect("export_to_xlsx_bytes")
}

/// 10 rows × 4 cols, mixed numeric, text, and formula (col D references col A and B).
fn mixed_10x4_fixture() -> WorkbookSnapshot {
    let mut cells = Vec::new();
    let mut id = 1u32;
    // Col A: numbers 10..0 descending so an ascending sort rewrites every row.
    for r in 0..10 {
        cells.push(value_cell(id, r, 0, (10 - r) as f64));
        id += 1;
    }
    // Col B: text labels.
    for r in 0..10 {
        cells.push(text_cell(id, r, 1, &format!("row{}", r)));
        id += 1;
    }
    // Col C: more numbers.
    for r in 0..10 {
        cells.push(value_cell(id, r, 2, r as f64 * 2.0));
        id += 1;
    }
    // Col D: formulas =A{r+1}+C{r+1}
    for r in 0..10 {
        let cached = (10 - r) as f64 + r as f64 * 2.0;
        let f = format!("=A{}+C{}", r + 1, r + 1);
        cells.push(formula_cell(id, r, 3, &f, cached));
        id += 1;
    }
    one_sheet_snapshot("SortFix", 10, 4, cells)
}

fn sort_options_single(col: u32, order: SortOrder) -> BridgeSortOptions {
    BridgeSortOptions {
        criteria: vec![BridgeSortCriterion {
            column: col,
            direction: order,
            case_sensitive: false,
            mode: BridgeSortMode::Value { custom_list: None },
        }],
        has_headers: false,
        visible_rows_only: false,
    }
}

#[test]
fn xlsx_sort_range_ascending_shifts_formula_refs() {
    let bytes = xlsx_bytes_for(mixed_10x4_fixture());
    let (mut engine, _) = YrsComputeEngine::from_xlsx_bytes(&bytes).expect("from_xlsx_bytes");
    let sid = *engine.mirror().sheet_ids().next().expect("sheet present");

    // Sort rows 0..=9 by column A ascending. Col-A values go 10..1; ascending
    // should reverse them, so the formula originally at D1 (=A1+C1) should now
    // refer to the cells that ended up on its row after sort.
    engine
        .sort_range(&sid, 0, 0, 9, 3, sort_options_single(0, SortOrder::Asc))
        .expect("sort_range asc");

    let out = engine.export_to_xlsx_bytes().expect("export after sort");
    let parsed = xlsx_api::parse(&out).expect("re-parse sorted XLSX");
    let sheet = &parsed.output.sheets[0];

    // After ascending sort on col A (values 1..10), each row's col-A value
    // equals row+1 and col-D formula on that row should be `=A{row+1}+C{row+1}`.
    for r in 0..10u32 {
        let d = sheet
            .cells
            .iter()
            .find(|c| c.row == r && c.col == 3)
            .unwrap_or_else(|| panic!("missing D{}", r + 1));
        let expected = format!("A{}+C{}", r + 1, r + 1);
        assert_eq!(
            d.formula.as_deref(),
            Some(expected.as_str()),
            "row {}: formula not shifted to row-local refs; got {:?}",
            r,
            d.formula
        );
    }
}

#[test]
fn xlsx_sort_range_descending_shifts_formula_refs() {
    let bytes = xlsx_bytes_for(mixed_10x4_fixture());
    let (mut engine, _) = YrsComputeEngine::from_xlsx_bytes(&bytes).expect("from_xlsx_bytes");
    let sid = *engine.mirror().sheet_ids().next().expect("sheet present");

    // Col A values start already descending (10..1) — descending sort is a no-op
    // on col A values, but the engine must still re-emit correct refs on export.
    engine
        .sort_range(&sid, 0, 0, 9, 3, sort_options_single(0, SortOrder::Desc))
        .expect("sort_range desc");

    let out = engine.export_to_xlsx_bytes().expect("export after sort");
    let parsed = xlsx_api::parse(&out).expect("re-parse sorted XLSX");
    let sheet = &parsed.output.sheets[0];

    for r in 0..10u32 {
        let d = sheet
            .cells
            .iter()
            .find(|c| c.row == r && c.col == 3)
            .unwrap_or_else(|| panic!("missing D{}", r + 1));
        let expected = format!("A{}+C{}", r + 1, r + 1);
        assert_eq!(
            d.formula.as_deref(),
            Some(expected.as_str()),
            "row {}: formula not shifted to row-local refs; got {:?}",
            r,
            d.formula
        );
    }
}
