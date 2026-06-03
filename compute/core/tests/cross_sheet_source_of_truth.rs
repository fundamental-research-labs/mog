//! Cross-sheet formula source-of-truth contract tests.
//!
//! These tests lock in the invariants that previously required a TS-side
//! shadow `formula-registry`. The kernel relies on these contracts holding in
//! Rust so that formula text for any cell — including ones with cross-sheet
//! references — round-trips through `set_cell_value_parsed` → `get_formula`
//! and survives sheet renames, named-range renames, and autofill.
//!
//! Each test corresponds to a real production scenario the registry used to
//! work around. If any of these regress, the kernel's `getFormula` and the
//! formula-bar UI go silently wrong.
//!
//! Run:
//!   cargo test -p compute-core --test cross_sheet_source_of_truth -- --nocapture

use cell_types::{SheetId, SheetPos};
use compute_core::engine_types::fill::{BridgeAutoFillRequest, BridgeFillRangeSpec};
use compute_core::storage::engine::YrsComputeEngine;
use snapshot_types::{CellData, SheetSnapshot, WorkbookSnapshot};
use value_types::CellValue;

const SHEET1_UUID: &str = "00000000000000000000000000000001";
const SHEET2_UUID: &str = "00000000000000000000000000000002";

fn cell_uuid(sheet_idx: u32, row: u32, col: u32) -> String {
    format!("{:08x}0000000000000000{:04x}{:04x}", sheet_idx, row, col)
}

fn make_cell(sheet_idx: u32, row: u32, col: u32, value: CellValue) -> CellData {
    CellData {
        cell_id: cell_uuid(sheet_idx, row, col),
        row,
        col,
        value,
        formula: None,
        identity_formula: None,
        array_ref: None,
    }
}

fn make_two_sheet_snapshot(
    sheet1_cells: Vec<CellData>,
    sheet2_cells: Vec<CellData>,
) -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![
            SheetSnapshot {
                id: SHEET1_UUID.to_string(),
                name: "Sheet1".to_string(),
                rows: 50,
                cols: 26,
                cells: sheet1_cells,
                ranges: vec![],
            },
            SheetSnapshot {
                id: SHEET2_UUID.to_string(),
                name: "Sheet2".to_string(),
                rows: 50,
                cols: 26,
                cells: sheet2_cells,
                ranges: vec![],
            },
        ],
        ..Default::default()
    }
}

fn fill_request(
    src_start_row: u32,
    src_start_col: u32,
    src_end_row: u32,
    src_end_col: u32,
    tgt_start_row: u32,
    tgt_start_col: u32,
    tgt_end_row: u32,
    tgt_end_col: u32,
    direction: &str,
) -> BridgeAutoFillRequest {
    BridgeAutoFillRequest {
        source_range: BridgeFillRangeSpec {
            start_row: src_start_row,
            start_col: src_start_col,
            end_row: src_end_row,
            end_col: src_end_col,
        },
        target_range: BridgeFillRangeSpec {
            start_row: tgt_start_row,
            start_col: tgt_start_col,
            end_row: tgt_end_row,
            end_col: tgt_end_col,
        },
        direction: direction.to_string(),
        mode: "auto".to_string(),
        include_formulas: true,
        include_values: true,
        include_formats: true,
        step_value: 1.0,
    }
}

/// Resolve formula text via the same path the kernel's `getFormula` bridge
/// uses: cell_id → `compute.get_formula(cell_id)` → display string.
fn formula_text_at(engine: &YrsComputeEngine, sheet_id: &SheetId, row: u32, col: u32) -> String {
    let cell_id = engine
        .mirror()
        .resolve_cell_id(sheet_id, SheetPos::new(row, col))
        .unwrap_or_else(|| panic!("no CellId at ({},{})", row, col));
    let formula = engine
        .mirror()
        .get_formula(&cell_id)
        .unwrap_or_else(|| panic!("no formula stored for cell at ({},{})", row, col));
    engine.to_a1_display(sheet_id, formula)
}

fn stored_formula_text_at(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> String {
    let cell_id = engine
        .mirror()
        .resolve_cell_id(sheet_id, SheetPos::new(row, col))
        .unwrap_or_else(|| panic!("no CellId at ({},{})", row, col));
    engine
        .get_formula(&cell_id)
        .unwrap_or_else(|| panic!("no stored formula text for cell at ({},{})", row, col))
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. Cross-sheet `set_cell` round-trip
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
// Writing `=Sheet2!A1` to Sheet1!A1 must persist the formula text such that
// reading the cell back yields `=Sheet2!A1` (not the evaluated number, not
// `=#REF!`, not the formula minus the sheet prefix).

#[test]
fn cross_sheet_set_cell_round_trips_formula_text() {
    let snapshot = make_two_sheet_snapshot(
        vec![],
        vec![make_cell(1, 0, 0, CellValue::number(42.0))], // Sheet2!A1 = 42
    );
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet1 = engine.mirror().sheet_by_name("Sheet1").unwrap();

    engine
        .set_cell_value_parsed(&sheet1, 0, 0, "=Sheet2!A1")
        .unwrap();

    assert_eq!(
        formula_text_at(&engine, &sheet1, 0, 0),
        "=Sheet2!A1",
        "Sheet1!A1 must round-trip its cross-sheet formula text"
    );

    let cell_id = engine
        .mirror()
        .resolve_cell_id(&sheet1, SheetPos::new(0, 0))
        .unwrap();
    let value = engine.mirror().get_cell_value(&cell_id);
    assert_eq!(
        value.cloned(),
        Some(CellValue::number(42.0)),
        "evaluated value must equal Sheet2!A1"
    );
}

#[test]
fn cross_sheet_set_cell_quoted_sheet_name_round_trips() {
    let snapshot = WorkbookSnapshot {
        sheets: vec![
            SheetSnapshot {
                id: SHEET1_UUID.to_string(),
                name: "Sheet1".to_string(),
                rows: 50,
                cols: 26,
                cells: vec![],
                ranges: vec![],
            },
            SheetSnapshot {
                id: SHEET2_UUID.to_string(),
                name: "My Sheet".to_string(),
                rows: 50,
                cols: 26,
                cells: vec![make_cell(1, 0, 0, CellValue::number(7.0))],
                ranges: vec![],
            },
        ],
        ..Default::default()
    };
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet1 = engine.mirror().sheet_by_name("Sheet1").unwrap();

    engine
        .set_cell_value_parsed(&sheet1, 0, 0, "='My Sheet'!A1")
        .unwrap();

    assert_eq!(
        formula_text_at(&engine, &sheet1, 0, 0),
        "='My Sheet'!A1",
        "quoted sheet name must round-trip"
    );
}

#[test]
fn explicit_same_sheet_refs_round_trip_as_authored_text() {
    let snapshot = make_two_sheet_snapshot(
        vec![
            make_cell(1, 0, 0, CellValue::number(5.0)),
            make_cell(1, 1, 0, CellValue::number(7.0)),
        ],
        vec![],
    );
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet1 = engine.mirror().sheet_by_name("Sheet1").unwrap();

    engine
        .set_cell_value_parsed(&sheet1, 0, 4, "=Sheet1!A1+Sheet1!A2")
        .unwrap();

    assert_eq!(
        stored_formula_text_at(&engine, &sheet1, 0, 4),
        "=Sheet1!A1+Sheet1!A2",
        "explicit same-sheet qualifiers are authored source text and must survive readback"
    );
}

#[test]
fn cross_sheet_copy_preserves_explicit_same_sheet_refs_after_prior_copies() {
    let snapshot = make_two_sheet_snapshot(
        vec![
            make_cell(1, 0, 0, CellValue::number(5.0)),
            make_cell(1, 1, 0, CellValue::number(7.0)),
        ],
        vec![
            make_cell(2, 0, 0, CellValue::number(100.0)),
            make_cell(2, 1, 0, CellValue::number(200.0)),
            make_cell(2, 3, 1, CellValue::number(8.0)),
            make_cell(2, 4, 1, CellValue::number(9.0)),
        ],
    );
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet1 = engine.mirror().sheet_by_name("Sheet1").unwrap();
    let sheet2 = engine.mirror().sheet_by_name("Sheet2").unwrap();

    engine
        .set_cell_value_parsed(&sheet1, 0, 2, "=A1+A2")
        .unwrap();
    engine
        .set_cell_value_parsed(&sheet1, 0, 4, "=Sheet1!A1+Sheet1!A2")
        .unwrap();

    engine
        .copy_range(
            &sheet1,
            0,
            2,
            0,
            2,
            &sheet2,
            0,
            2,
            domain_types::CopyType::All,
            false,
            false,
        )
        .unwrap();
    engine
        .copy_range(
            &sheet1,
            0,
            2,
            0,
            2,
            &sheet2,
            3,
            3,
            domain_types::CopyType::All,
            false,
            false,
        )
        .unwrap();
    engine
        .copy_range(
            &sheet1,
            0,
            4,
            0,
            4,
            &sheet2,
            0,
            4,
            domain_types::CopyType::All,
            false,
            false,
        )
        .unwrap();

    assert_eq!(
        stored_formula_text_at(&engine, &sheet1, 0, 4),
        "=Sheet1!A1+Sheet1!A2",
        "copying other formulas must not normalize the explicit source formula"
    );
    assert_eq!(
        stored_formula_text_at(&engine, &sheet2, 0, 4),
        "=Sheet1!A1+Sheet1!A2",
        "cross-sheet copy must preserve explicit authored source-sheet qualifiers"
    );
    assert_eq!(
        engine
            .mirror()
            .get_cell_value_at(&sheet2, SheetPos::new(0, 4))
            .cloned(),
        Some(CellValue::number(12.0)),
        "target formula must evaluate against Sheet1 values"
    );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. Cross-sheet autofill preserves the sheet prefix
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
// Filling `Sheet1!A1 = =Sheet2!A1` down into Sheet1!A2:A5 must produce
// formulas that retain the `Sheet2!` prefix. The TS workaround
// `doManualFormulaFill` existed because the kernel feared this dropped the
// prefix. The Rust pipeline is correct — this test is the lock-in.

#[test]
fn cross_sheet_fill_down_preserves_sheet_prefix() {
    let snapshot = make_two_sheet_snapshot(
        vec![],
        vec![
            make_cell(1, 0, 0, CellValue::number(10.0)),
            make_cell(1, 1, 0, CellValue::number(20.0)),
            make_cell(1, 2, 0, CellValue::number(30.0)),
            make_cell(1, 3, 0, CellValue::number(40.0)),
            make_cell(1, 4, 0, CellValue::number(50.0)),
        ],
    );
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet1 = engine.mirror().sheet_by_name("Sheet1").unwrap();

    // Sheet1!A1 = =Sheet2!A1
    engine
        .set_cell_value_parsed(&sheet1, 0, 0, "=Sheet2!A1")
        .unwrap();

    // Fill A1 → A2:A4
    let req = fill_request(0, 0, 0, 0, 1, 0, 4, 0, "down");
    engine.auto_fill(&sheet1, req).unwrap();

    for target_row in 1..=4u32 {
        let display = formula_text_at(&engine, &sheet1, target_row, 0);
        let expected = format!("=Sheet2!A{}", target_row + 1);
        assert_eq!(
            display, expected,
            "row {} must retain Sheet2! prefix and adjust the row component",
            target_row
        );
    }
}

#[test]
fn cross_sheet_fill_right_preserves_sheet_prefix() {
    let snapshot = make_two_sheet_snapshot(
        vec![],
        vec![
            make_cell(1, 0, 0, CellValue::number(1.0)),
            make_cell(1, 0, 1, CellValue::number(2.0)),
            make_cell(1, 0, 2, CellValue::number(3.0)),
            make_cell(1, 0, 3, CellValue::number(4.0)),
        ],
    );
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet1 = engine.mirror().sheet_by_name("Sheet1").unwrap();

    engine
        .set_cell_value_parsed(&sheet1, 0, 0, "=Sheet2!A1")
        .unwrap();

    let req = fill_request(0, 0, 0, 0, 0, 1, 0, 3, "right");
    engine.auto_fill(&sheet1, req).unwrap();

    for target_col in 1..=3u32 {
        let display = formula_text_at(&engine, &sheet1, 0, target_col);
        let col_letter = char::from(b'A' + target_col as u8);
        let expected = format!("=Sheet2!{}1", col_letter);
        assert_eq!(
            display, expected,
            "col {} must retain Sheet2! prefix and adjust the column component",
            target_col
        );
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3. Sheet rename rewrites cross-sheet formula text
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
// `updateFormulaRegistryOnRename` in compute-bridge.ts duplicated this work
// in TS with regex. The Rust `mutation_rename_sheet` path already does it
// properly via `regenerate_formula_strings` on the new sheet name.

#[test]
fn sheet_rename_rewrites_cross_sheet_formula_text() {
    let snapshot =
        make_two_sheet_snapshot(vec![], vec![make_cell(1, 0, 0, CellValue::number(99.0))]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet1 = engine.mirror().sheet_by_name("Sheet1").unwrap();
    let sheet2 = engine.mirror().sheet_by_name("Sheet2").unwrap();

    engine
        .set_cell_value_parsed(&sheet1, 0, 0, "=Sheet2!A1+1")
        .unwrap();
    assert_eq!(formula_text_at(&engine, &sheet1, 0, 0), "=Sheet2!A1+1");

    // Rename Sheet2 → Revenue
    engine.rename_compute_sheet(&sheet2, "Revenue").unwrap();

    assert_eq!(
        formula_text_at(&engine, &sheet1, 0, 0),
        "=Revenue!A1+1",
        "Sheet1!A1 formula must reflect the new sheet name after rename"
    );
}

#[test]
fn sheet_rename_to_quoted_form_uses_quotes() {
    let snapshot =
        make_two_sheet_snapshot(vec![], vec![make_cell(1, 0, 0, CellValue::number(5.0))]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet1 = engine.mirror().sheet_by_name("Sheet1").unwrap();
    let sheet2 = engine.mirror().sheet_by_name("Sheet2").unwrap();

    engine
        .set_cell_value_parsed(&sheet1, 0, 0, "=Sheet2!A1")
        .unwrap();

    engine
        .rename_compute_sheet(&sheet2, "My Quarterly Sheet")
        .unwrap();

    assert_eq!(
        formula_text_at(&engine, &sheet1, 0, 0),
        "='My Quarterly Sheet'!A1",
        "rename to a name needing quoting must emit quoted form"
    );
}

#[test]
fn sheet_rename_preserves_explicit_same_sheet_formula_text() {
    let snapshot =
        make_two_sheet_snapshot(vec![], vec![make_cell(1, 0, 0, CellValue::number(5.0))]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet2 = engine.mirror().sheet_by_name("Sheet2").unwrap();

    engine
        .set_cell_value_parsed(&sheet2, 0, 1, "=Sheet2!A1+1")
        .unwrap();

    assert_eq!(
        stored_formula_text_at(&engine, &sheet2, 0, 1),
        "=Sheet2!A1+1",
        "precondition: authored same-sheet qualifier is stored"
    );

    engine.rename_compute_sheet(&sheet2, "Data Sheet").unwrap();

    assert_eq!(
        stored_formula_text_at(&engine, &sheet2, 0, 1),
        "='Data Sheet'!A1+1",
        "rename must update the authored same-sheet qualifier without collapsing it"
    );
}

#[test]
fn sheet_rename_undo_redo_rewrites_formula_text() {
    let snapshot = make_two_sheet_snapshot(
        vec![],
        vec![
            make_cell(2, 0, 0, CellValue::number(42.0)),
            make_cell(2, 1, 0, CellValue::number(8.0)),
            make_cell(2, 1, 1, CellValue::number(10.0)),
        ],
    );
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet1 = engine.mirror().sheet_by_name("Sheet1").unwrap();
    let sheet2 = engine.mirror().sheet_by_name("Sheet2").unwrap();

    engine
        .set_cell_value_parsed(&sheet1, 0, 0, "=Sheet2!A1")
        .unwrap();
    engine
        .set_cell_value_parsed(&sheet1, 0, 1, "=SUM(Sheet2!A1:B2)")
        .unwrap();
    engine
        .set_cell_value_parsed(&sheet2, 0, 2, "=Sheet2!A1+1")
        .unwrap();

    engine.rename_compute_sheet(&sheet2, "Data Sheet").unwrap();

    assert_eq!(
        stored_formula_text_at(&engine, &sheet1, 0, 0),
        "='Data Sheet'!A1"
    );
    assert_eq!(
        stored_formula_text_at(&engine, &sheet1, 0, 1),
        "=SUM('Data Sheet'!A1:B2)"
    );
    assert_eq!(
        stored_formula_text_at(&engine, &sheet2, 0, 2),
        "='Data Sheet'!A1+1"
    );

    engine.undo().unwrap();

    assert_eq!(stored_formula_text_at(&engine, &sheet1, 0, 0), "=Sheet2!A1");
    assert_eq!(
        stored_formula_text_at(&engine, &sheet1, 0, 1),
        "=SUM(Sheet2!A1:B2)"
    );
    assert_eq!(
        stored_formula_text_at(&engine, &sheet2, 0, 2),
        "=Sheet2!A1+1"
    );

    engine.redo().unwrap();

    assert_eq!(
        stored_formula_text_at(&engine, &sheet1, 0, 0),
        "='Data Sheet'!A1"
    );
    assert_eq!(
        stored_formula_text_at(&engine, &sheet1, 0, 1),
        "=SUM('Data Sheet'!A1:B2)"
    );
    assert_eq!(
        stored_formula_text_at(&engine, &sheet2, 0, 2),
        "='Data Sheet'!A1+1"
    );
}

#[test]
fn delete_sheet_preserves_ref_suffix_and_absolute_markers() {
    let snapshot =
        make_two_sheet_snapshot(vec![], vec![make_cell(1, 0, 0, CellValue::number(5.0))]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet1 = engine.mirror().sheet_by_name("Sheet1").unwrap();
    let sheet2 = engine.mirror().sheet_by_name("Sheet2").unwrap();

    engine
        .set_cell_value_parsed(&sheet1, 2, 2, "=Sheet2!$A$1&\"\"")
        .unwrap();

    engine.delete_sheet(&sheet2).unwrap();

    assert_eq!(
        stored_formula_text_at(&engine, &sheet1, 2, 2),
        "=#REF!$A$1&\"\"",
        "delete must replace only the sheet prefix and preserve the A1 suffix"
    );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 4. Cross-sheet formula survives sheet rename + autofill round-trip
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
// Composite: rename a sheet, then fill a cross-sheet formula that referenced
// the (now renamed) sheet — the fill output must use the new name.

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 5. Named-range rename rewrites referencing formulas
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
// `_rewriteNamedRangeInFormulas` in kernel/src/api/workbook/names.ts did this
// in TS via regex-on-text after rename. The Rust `mutation_named_range_update`
// path now performs the rewrite atomically. Word-boundary matching ensures
// `Data` doesn't corrupt `SalesData` or `MyData_2`.

#[test]
fn named_range_rename_rewrites_referencing_formulas() {
    use domain_types::{DefinedNameInput, NamedRangeUpdate};

    let snapshot =
        make_two_sheet_snapshot(vec![make_cell(0, 0, 0, CellValue::number(100.0))], vec![]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet1 = engine.mirror().sheet_by_name("Sheet1").unwrap();

    // Define MyVal → =Sheet1!A1 (workbook-scoped).
    let (_, mr) = engine
        .create_named_range(DefinedNameInput {
            name: "MyVal".to_string(),
            refers_to: "=Sheet1!A1".to_string(),
            scope: None,
            comment: None,
        })
        .unwrap();

    // Recover the new ID from the result.
    let dn: domain_types::DefinedName =
        serde_json::from_value(mr.data.clone().expect("data")).expect("DefinedName");

    // Sheet1!B1 = =MyVal+5; Sheet1!C1 = =SalesData (substring of "Sales" + "Data" — must NOT match)
    engine
        .set_cell_value_parsed(&sheet1, 0, 1, "=MyVal+5")
        .unwrap();

    // Add a value cell for SalesData reference (define it as a different name)
    engine
        .create_named_range(DefinedNameInput {
            name: "SalesData".to_string(),
            refers_to: "=Sheet1!A1".to_string(),
            scope: None,
            comment: None,
        })
        .unwrap();
    engine
        .set_cell_value_parsed(&sheet1, 0, 2, "=SalesData*2")
        .unwrap();

    // Rename MyVal → Revenue.
    engine
        .update_named_range(
            &dn.id,
            NamedRangeUpdate {
                name: Some("Revenue".to_string()),
                refers_to: None,
                comment: None,
                visible: None,
            },
        )
        .unwrap();

    // B1 must now reference Revenue.
    assert_eq!(formula_text_at(&engine, &sheet1, 0, 1), "=Revenue+5");
    // C1 must remain untouched — `MyVal`/`Revenue` is a different identifier
    // from `SalesData` (and a strict word-boundary match).
    assert_eq!(formula_text_at(&engine, &sheet1, 0, 2), "=SalesData*2");
}

#[test]
fn rename_then_fill_uses_new_sheet_name() {
    let snapshot = make_two_sheet_snapshot(
        vec![],
        vec![
            make_cell(1, 0, 0, CellValue::number(11.0)),
            make_cell(1, 1, 0, CellValue::number(22.0)),
            make_cell(1, 2, 0, CellValue::number(33.0)),
        ],
    );
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet1 = engine.mirror().sheet_by_name("Sheet1").unwrap();
    let sheet2 = engine.mirror().sheet_by_name("Sheet2").unwrap();

    engine
        .set_cell_value_parsed(&sheet1, 0, 0, "=Sheet2!A1")
        .unwrap();
    engine.rename_compute_sheet(&sheet2, "Data").unwrap();

    let req = fill_request(0, 0, 0, 0, 1, 0, 2, 0, "down");
    engine.auto_fill(&sheet1, req).unwrap();

    assert_eq!(formula_text_at(&engine, &sheet1, 0, 0), "=Data!A1");
    assert_eq!(formula_text_at(&engine, &sheet1, 1, 0), "=Data!A2");
    assert_eq!(formula_text_at(&engine, &sheet1, 2, 0), "=Data!A3");
}
