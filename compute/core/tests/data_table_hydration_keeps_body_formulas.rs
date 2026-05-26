//! Stream D2 regression test (projection-family-unification plan).
//!
//! Asserts that the compute-core hydration pipeline preserves Data Table
//! body-cell formulas. When a snapshot carries `formula = Some("TABLE(...)")`
//! on every cell of a region rectangle (master + body), the engine's
//! formula registry must surface that text for each body cell — not just
//! the master.
//!
//! Architectural intent: Data Table body cells own a synthesized formula by
//! construction. The OOXML representation is asymmetric (master carries
//! `<f t="dataTable">`, body cells carry `<v>` only) for compactness; the
//! data model is symmetric. If hydration drops body-cell formulas, the
//! formula bar / region-membership chokepoint downstream falls back to
//! `String(rawValue)` — the original bug this test locks in against.

use cell_types::{CellId, SheetId};
use compute_core::mirror::CellMirror;
use compute_core::scheduler::ComputeCore;
use compute_core::snapshot::{CellData, SheetSnapshot, WorkbookSnapshot};
use formula_types::CellRef;
use snapshot_types::DataTableRegionDef;
use value_types::CellValue;

fn sheet_uuid(idx: u32) -> String {
    format!("a0000000000000000000{:012x}", idx as u64)
}

fn cell_uuid(sheet_idx: u32, row: u32, col: u32) -> String {
    format!("c{:07x}{:04x}{:04x}0000000000000000", sheet_idx, row, col)
}

fn make_cell(
    sheet_idx: u32,
    row: u32,
    col: u32,
    value: CellValue,
    formula: Option<&str>,
) -> CellData {
    CellData {
        cell_id: cell_uuid(sheet_idx, row, col),
        row,
        col,
        value,
        formula: formula.map(|s| s.to_string()),
        identity_formula: None,
        array_ref: None,
    }
}

/// Build a 2-variable Data Table at B2:C3 with master at B2.
///
/// Layout (mirrors `dev/app-eval/scenarios/array-formulas/fixtures/data-table-minimal.xlsx`):
///
/// |   | A    | B          | C          |
/// |---|------|------------|------------|
/// | 1 | 0.05 |            |            |
/// | 2 | 100  | TABLE() M  | 10         |
/// | 3 |      | 5.5        | 11         |
///
/// All four region cells (master B2 + body B3, C2, C3) carry the synthesized
/// `TABLE($A$2,$A$1)` formula text in the snapshot — that is the post-D2
/// invariant we expect compute-core hydration to preserve.
fn data_table_snapshot() -> WorkbookSnapshot {
    let sheet_id_str = sheet_uuid(0);
    let cells = vec![
        make_cell(0, 0, 0, CellValue::number(0.05), None), // A1
        make_cell(0, 1, 0, CellValue::number(100.0), None), // A2
        // Master B2 (row=1, col=1) — value 5, formula TABLE($A$2,$A$1)
        make_cell(0, 1, 1, CellValue::number(5.0), Some("TABLE($A$2,$A$1)")),
        // C2 body
        make_cell(0, 1, 2, CellValue::number(10.0), Some("TABLE($A$2,$A$1)")),
        // B3 body
        make_cell(0, 2, 1, CellValue::number(5.5), Some("TABLE($A$2,$A$1)")),
        // C3 body
        make_cell(0, 2, 2, CellValue::number(11.0), Some("TABLE($A$2,$A$1)")),
    ];

    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sheet_id_str.clone(),
            name: "Sheet1".to_string(),
            rows: 5,
            cols: 5,
            cells,
            ranges: vec![],
        }],
        named_ranges: vec![],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![DataTableRegionDef {
            sheet: sheet_id_str,
            start_row: 1,
            start_col: 1,
            end_row: 2,
            end_col: 2,
            // Typed-boundary typed CellRef. r2 = $A$2 = (0,1,0) (sheet, row, col).
            row_input_ref: Some(CellRef::Positional {
                sheet: SheetId::from_raw(0),
                row: 1,
                col: 0,
            }),
            // r1 = $A$1 = (0,0,0).
            col_input_ref: Some(CellRef::Positional {
                sheet: SheetId::from_raw(0),
                row: 0,
                col: 0,
            }),
            ooxml_flags: None,
        }],
        iterative_calc: false,
        max_iterations: 100,
        max_change: value_types::FiniteF64::must(0.001),
        calculation_settings: None,
    }
}

fn cell_id_at(mirror: &CellMirror, sheet_id: SheetId, row: u32, col: u32) -> CellId {
    mirror
        .get_sheet(&sheet_id)
        .and_then(|s| {
            s.cells_iter()
                .find_map(|(id, _)| match mirror.resolve_position(id) {
                    Some(pos) if pos.row() == row && pos.col() == col => Some(*id),
                    _ => None,
                })
        })
        .unwrap_or_else(|| panic!("no cell at ({row}, {col})"))
}

#[test]
fn data_table_hydration_preserves_body_formulas() {
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let _ = core
        .init_from_snapshot(&mut mirror, data_table_snapshot())
        .expect("init_from_snapshot");

    let sheet_id = SheetId::from_uuid_str(&sheet_uuid(0)).expect("sheet id parse");

    // Master B2: must surface the TABLE formula.
    let master = cell_id_at(&mirror, sheet_id, 1, 1);
    let master_text = core.get_formula(&master).map(str::to_owned);
    assert!(
        master_text.is_some(),
        "master B2 must surface its TABLE formula text after hydration; got None"
    );

    // Body cells: B3, C2, C3 must each surface a TABLE formula text.
    // (We do NOT pin the exact A1 string here because the scheduler's
    // `regenerate_formula_strings` re-renders identity formulas through
    // `to_a1_string` — small canonical tweaks like absolute-marker
    // preservation are out of scope for this test. The assertion is that
    // the formula propagates, full-stop.)
    for (label, row, col) in [("B3", 2, 1), ("C2", 1, 2), ("C3", 2, 2)] {
        let cid = cell_id_at(&mirror, sheet_id, row, col);
        let text = core.get_formula(&cid).map(str::to_owned);
        let text = text.unwrap_or_else(|| {
            panic!(
                "{label} (Data Table body cell) must surface its synthesized \
                 TABLE() formula text after hydration; got None"
            )
        });
        assert!(
            text.to_ascii_uppercase().contains("TABLE("),
            "{label} formula text should contain `TABLE(` (got: {text:?})"
        );
    }
}
