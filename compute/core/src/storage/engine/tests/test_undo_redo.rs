//! Groups 3, 12: Undo/redo basics + pipeline unification.

use super::super::*;
use super::helpers::*;
use crate::snapshot::{CellData, SheetSnapshot};
use value_types::{CellValue, FiniteF64};

fn num(value: f64) -> CellValue {
    CellValue::Number(FiniteF64::must(value))
}

fn cell_value_at(engine: &YrsComputeEngine, sheet_id: &SheetId, row: u32, col: u32) -> CellValue {
    engine
        .mirror()
        .get_cell_value_at(sheet_id, SheetPos::new(row, col))
        .cloned()
        .unwrap_or(CellValue::Null)
}

fn empty_bulk_snapshot() -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sheet_id().to_uuid_string(),
            name: "Sheet1".to_string(),
            rows: 0,
            cols: 0,
            cells: vec![],
            ranges: vec![],
        }],
        named_ranges: vec![],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: value_types::FiniteF64::must(0.001),
        calculation_settings: None,
    }
}

// -------------------------------------------------------------------
// Test 3: Undo reverts cell edit
// -------------------------------------------------------------------

#[test]
fn test_undo_reverts_cell_edit() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    // Initial: A1 = 10
    assert_eq!(
        *engine.mirror().get_cell_value(&cell_id_a1()).unwrap(),
        CellValue::Number(FiniteF64::must(10.0))
    );

    // Edit A1 to 99
    engine
        .set_cell(
            &sheet_id(),
            cell_id_a1(),
            0,
            0,
            crate::bridge_types::CellInput::Parse { text: "99".into() },
        )
        .unwrap();
    assert_eq!(
        *engine.mirror().get_cell_value(&cell_id_a1()).unwrap(),
        CellValue::Number(FiniteF64::must(99.0))
    );

    // Undo should revert A1 back to 10
    assert!(engine.can_undo());
    let _undo_result = engine.undo().unwrap();

    // After undo, the yrs doc should have A1 = 10 again
    // Check yrs doc directly
    let (yrs_val, _, _) = engine
        .storage()
        .read_cell_from_yrs(&sheet_id(), &cell_id_a1())
        .expect("cell should exist in yrs after undo");
    assert_eq!(yrs_val, CellValue::Number(FiniteF64::must(10.0)));
}

#[test]
fn test_undo_formula_clear_reports_restored_cell_change() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    let (_patches, clear_result) = engine.batch_clear_cells(vec![cell_id_a2()]).unwrap();
    assert!(
        clear_result.recalc.changed_cells.iter().any(|change| change
            .position
            .as_ref()
            .is_some_and(|pos| pos.row == 1 && pos.col == 0)),
        "clearing A2 should report a changed cell"
    );

    assert!(engine.can_undo());
    let (_patches, undo_result) = engine.undo().unwrap();

    assert_eq!(cell_value_at(&engine, &sid, 1, 0), num(30.0));
    let restored = undo_result.recalc.changed_cells.iter().find(|change| {
        change
            .position
            .as_ref()
            .is_some_and(|pos| pos.row == 1 && pos.col == 0)
    });
    assert!(
        restored.is_some(),
        "undoing a formula clear must report A2 in changed_cells so UI subscribers invalidate; result={:?}",
        undo_result.recalc.changed_cells
    );
}

// -------------------------------------------------------------------
// Test 4: Redo restores cell edit
// -------------------------------------------------------------------

#[test]
fn test_redo_restores_cell_edit() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    // Edit A1 to 99
    engine
        .set_cell(
            &sheet_id(),
            cell_id_a1(),
            0,
            0,
            crate::bridge_types::CellInput::Parse { text: "99".into() },
        )
        .unwrap();

    // Undo
    engine.undo().unwrap();
    let (yrs_val, _, _) = engine
        .storage()
        .read_cell_from_yrs(&sheet_id(), &cell_id_a1())
        .unwrap();
    assert_eq!(yrs_val, CellValue::Number(FiniteF64::must(10.0)));

    // Redo should restore A1 = 99
    assert!(engine.can_redo());
    let _redo_result = engine.redo().unwrap();

    let (yrs_val, _, _) = engine
        .storage()
        .read_cell_from_yrs(&sheet_id(), &cell_id_a1())
        .unwrap();
    assert_eq!(yrs_val, CellValue::Number(FiniteF64::must(99.0)));
}

// -------------------------------------------------------------------
// Sort undo must replay identity-position changes from Yrs
// -------------------------------------------------------------------

#[test]
fn test_undo_reverts_per_cell_sort_positions() {
    let sid = sheet_id();
    let cells = [
        ("550e8400-e29b-41d4-a716-446655440011", 3.0),
        ("550e8400-e29b-41d4-a716-446655440012", 1.0),
        ("550e8400-e29b-41d4-a716-446655440013", 5.0),
        ("550e8400-e29b-41d4-a716-446655440014", 2.0),
        ("550e8400-e29b-41d4-a716-446655440015", 4.0),
    ];
    let snap = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sid.to_uuid_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells: cells
                .iter()
                .enumerate()
                .map(|(row, (cell_id, value))| CellData {
                    cell_id: (*cell_id).to_string(),
                    row: row as u32,
                    col: 0,
                    value: CellValue::Number(FiniteF64::must(*value)),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                })
                .collect(),
            ranges: vec![],
        }],
        named_ranges: vec![],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: value_types::FiniteF64::must(0.001),
        calculation_settings: None,
    };
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    let options = crate::storage::engine::mutation::BridgeSortOptions {
        criteria: vec![crate::storage::engine::mutation::BridgeSortCriterion {
            column: 0,
            direction: domain_types::domain::filter::SortOrder::Asc,
            case_sensitive: false,
            mode: crate::storage::engine::mutation::BridgeSortMode::Value { custom_list: None },
        }],
        has_headers: false,
        visible_rows_only: false,
    };

    engine.sort_range(&sid, 0, 0, 4, 0, options).unwrap();
    let sorted: Vec<CellValue> = (0..5)
        .map(|row| {
            engine
                .mirror()
                .get_cell_value_at(&sid, SheetPos::new(row, 0))
                .cloned()
                .unwrap()
        })
        .collect();
    assert_eq!(
        sorted,
        [1.0, 2.0, 3.0, 4.0, 5.0]
            .into_iter()
            .map(|n| CellValue::Number(FiniteF64::must(n)))
            .collect::<Vec<_>>()
    );

    assert!(engine.can_undo());
    let undo_result = engine.undo().unwrap().1;

    let restored: Vec<CellValue> = (0..5)
        .map(|row| {
            engine
                .mirror()
                .get_cell_value_at(&sid, SheetPos::new(row, 0))
                .cloned()
                .unwrap()
        })
        .collect();
    assert_eq!(
        restored,
        [3.0, 1.0, 5.0, 2.0, 4.0]
            .into_iter()
            .map(|n| CellValue::Number(FiniteF64::must(n)))
            .collect::<Vec<_>>(),
        "undo must restore the pre-sort position order in one step",
    );
    let changed_rows: std::collections::HashSet<u32> = undo_result
        .recalc
        .changed_cells
        .iter()
        .filter_map(|change| {
            let pos = change.position.as_ref()?;
            (pos.col == 0).then_some(pos.row)
        })
        .collect();
    assert_eq!(
        changed_rows,
        (0..5).collect(),
        "undo must emit value patches for every restored sort row",
    );
}

// -------------------------------------------------------------------
// Bulk cell edits must undo atomically
// -------------------------------------------------------------------

#[test]
fn bulk_set_cells_by_position_undoes_atomically() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    engine
        .batch_set_cells_by_position(
            vec![
                (
                    sid,
                    0,
                    0,
                    crate::storage::engine::mutation::CellInput::Parse { text: "100".into() },
                ),
                (
                    sid,
                    0,
                    1,
                    crate::storage::engine::mutation::CellInput::Parse { text: "200".into() },
                ),
                (
                    sid,
                    0,
                    2,
                    crate::storage::engine::mutation::CellInput::Parse { text: "300".into() },
                ),
            ],
            true,
        )
        .unwrap();

    assert_eq!(cell_value_at(&engine, &sid, 0, 0), num(100.0));
    assert_eq!(cell_value_at(&engine, &sid, 0, 1), num(200.0));
    assert_eq!(cell_value_at(&engine, &sid, 0, 2), num(300.0));

    engine.undo().unwrap();

    assert_eq!(cell_value_at(&engine, &sid, 0, 0), num(10.0));
    assert_eq!(cell_value_at(&engine, &sid, 0, 1), num(20.0));
    assert_eq!(cell_value_at(&engine, &sid, 0, 2), CellValue::Null);
    assert!(
        !engine.can_undo(),
        "bulk set-by-position must be one undo stack item, not one item per cell"
    );
}

#[test]
fn bulk_set_cells_by_position_grows_fresh_sheet_to_100k_once() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(empty_bulk_snapshot()).unwrap();
    let sid = sheet_id();

    let edits = (0..100_000)
        .map(|row| {
            (
                sid,
                row,
                0,
                crate::storage::engine::mutation::CellInput::Parse {
                    text: (row + 1).to_string(),
                },
            )
        })
        .collect();

    engine
        .batch_set_cells_by_position(edits, true)
        .expect("100k fresh-sheet batch write");

    assert_eq!(cell_value_at(&engine, &sid, 0, 0), num(1.0));
    assert_eq!(cell_value_at(&engine, &sid, 49_999, 0), num(50_000.0));
    assert_eq!(cell_value_at(&engine, &sid, 99_999, 0), num(100_000.0));

    let grid = engine.grid_index(&sid).expect("grid index");
    assert!(grid.row_count() >= 100_000);
    assert!(grid.col_count() >= 1);
}

#[test]
fn duplicate_set_cells_by_position_uses_last_write_and_one_identity() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(empty_bulk_snapshot()).unwrap();
    let sid = sheet_id();

    engine
        .batch_set_cells_by_position(
            vec![
                (
                    sid,
                    0,
                    0,
                    crate::storage::engine::mutation::CellInput::Parse { text: "1".into() },
                ),
                (
                    sid,
                    0,
                    0,
                    crate::storage::engine::mutation::CellInput::Parse { text: "2".into() },
                ),
            ],
            true,
        )
        .unwrap();

    assert_eq!(cell_value_at(&engine, &sid, 0, 0), num(2.0));
    let grid = engine.grid_index(&sid).expect("grid index");
    let cell_id = grid.cell_id_at(0, 0).expect("winning cell id");
    assert_eq!(
        grid.cells().filter(|(id, _, _)| *id == cell_id).count(),
        1,
        "duplicate by-position writes must allocate/register one winning identity",
    );
}

#[test]
fn undo_redo_restores_bulk_dimension_growth() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(empty_bulk_snapshot()).unwrap();
    let sid = sheet_id();
    assert_eq!(engine.grid_index(&sid).unwrap().row_count(), 0);
    assert_eq!(engine.grid_index(&sid).unwrap().col_count(), 0);

    engine
        .batch_set_cells_by_position(
            vec![(
                sid,
                99_999,
                27,
                crate::storage::engine::mutation::CellInput::Parse { text: "7".into() },
            )],
            true,
        )
        .unwrap();

    assert_eq!(cell_value_at(&engine, &sid, 99_999, 27), num(7.0));
    assert!(engine.grid_index(&sid).unwrap().row_count() >= 100_000);
    assert!(engine.grid_index(&sid).unwrap().col_count() >= 28);

    engine.undo().unwrap();
    assert_eq!(cell_value_at(&engine, &sid, 99_999, 27), CellValue::Null);
    assert_eq!(engine.grid_index(&sid).unwrap().row_count(), 0);
    assert_eq!(engine.grid_index(&sid).unwrap().col_count(), 0);

    engine.redo().unwrap();
    assert_eq!(cell_value_at(&engine, &sid, 99_999, 27), num(7.0));
    assert!(engine.grid_index(&sid).unwrap().row_count() >= 100_000);
    assert!(engine.grid_index(&sid).unwrap().col_count() >= 28);
}

#[test]
fn text_to_columns_undoes_atomically_and_reports_stats() {
    let sid = sheet_id();
    let snap = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sid.to_uuid_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells: vec![
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440011".to_string(),
                    row: 0,
                    col: 0,
                    value: CellValue::Text("John,Doe".into()),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440012".to_string(),
                    row: 1,
                    col: 0,
                    value: CellValue::Text("Jane,Smith".into()),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440013".to_string(),
                    row: 2,
                    col: 0,
                    value: CellValue::Text("Bob,Jones".into()),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
            ],
            ranges: vec![],
        }],
        named_ranges: vec![],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: value_types::FiniteF64::must(0.001),
        calculation_settings: None,
    };
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    let result = engine
        .text_to_columns(
            &sid,
            0,
            2,
            0,
            0,
            0,
            serde_json::json!({
                "splitType": "delimited",
                "delimiters": {
                    "tab": false,
                    "comma": true,
                    "semicolon": false,
                    "space": false,
                },
                "treatConsecutiveAsOne": false,
                "textQualifier": "none",
            }),
        )
        .unwrap()
        .1;

    assert_eq!(
        result.data,
        Some(serde_json::json!({ "rowsProcessed": 3, "columnsCreated": 2 }))
    );
    assert_eq!(engine.get_undo_state().undo_depth, 1);
    assert_eq!(
        cell_value_at(&engine, &sid, 0, 0),
        CellValue::Text("John".into())
    );
    assert_eq!(
        cell_value_at(&engine, &sid, 0, 1),
        CellValue::Text("Doe".into())
    );
    assert_eq!(
        cell_value_at(&engine, &sid, 1, 0),
        CellValue::Text("Jane".into())
    );
    assert_eq!(
        cell_value_at(&engine, &sid, 1, 1),
        CellValue::Text("Smith".into())
    );
    assert_eq!(
        cell_value_at(&engine, &sid, 2, 0),
        CellValue::Text("Bob".into())
    );
    assert_eq!(
        cell_value_at(&engine, &sid, 2, 1),
        CellValue::Text("Jones".into())
    );

    engine.undo().unwrap();

    assert_eq!(
        cell_value_at(&engine, &sid, 0, 0),
        CellValue::Text("John,Doe".into())
    );
    assert_eq!(
        cell_value_at(&engine, &sid, 1, 0),
        CellValue::Text("Jane,Smith".into())
    );
    assert_eq!(
        cell_value_at(&engine, &sid, 2, 0),
        CellValue::Text("Bob,Jones".into())
    );
    assert_eq!(cell_value_at(&engine, &sid, 0, 1), CellValue::Null);
    assert_eq!(cell_value_at(&engine, &sid, 1, 1), CellValue::Null);
    assert_eq!(cell_value_at(&engine, &sid, 2, 1), CellValue::Null);
    assert!(
        !engine.can_undo(),
        "text-to-columns must be one undo stack item, not one item per written cell"
    );
}

#[test]
fn autofill_undoes_atomically() {
    let sid = sheet_id();
    let snap = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sid.to_uuid_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells: vec![
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440021".to_string(),
                    row: 0,
                    col: 0,
                    value: num(1.0),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440022".to_string(),
                    row: 1,
                    col: 0,
                    value: num(2.0),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
            ],
            ranges: vec![],
        }],
        named_ranges: vec![],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: value_types::FiniteF64::must(0.001),
        calculation_settings: None,
    };
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    let request = crate::engine_types::fill::BridgeAutoFillRequest {
        source_range: crate::engine_types::fill::BridgeFillRangeSpec {
            start_row: 0,
            start_col: 0,
            end_row: 1,
            end_col: 0,
        },
        target_range: crate::engine_types::fill::BridgeFillRangeSpec {
            start_row: 2,
            start_col: 0,
            end_row: 4,
            end_col: 0,
        },
        direction: "down".to_string(),
        mode: "series".to_string(),
        include_formulas: true,
        include_values: true,
        include_formats: false,
        step_value: 1.0,
    };

    engine.auto_fill(&sid, request).unwrap();

    for row in 0..5 {
        assert_eq!(cell_value_at(&engine, &sid, row, 0), num((row + 1) as f64));
    }

    engine.undo().unwrap();

    assert_eq!(cell_value_at(&engine, &sid, 0, 0), num(1.0));
    assert_eq!(cell_value_at(&engine, &sid, 1, 0), num(2.0));
    for row in 2..5 {
        assert_eq!(cell_value_at(&engine, &sid, row, 0), CellValue::Null);
    }
    assert!(
        !engine.can_undo(),
        "autofill must be one undo stack item, not one item per filled cell"
    );
}

// -------------------------------------------------------------------
// Test 9: Multiple edits then undo all
// -------------------------------------------------------------------

#[test]
fn test_multiple_edits_undo() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    // Edit A1 to 100
    engine
        .set_cell(
            &sheet_id(),
            cell_id_a1(),
            0,
            0,
            crate::bridge_types::CellInput::Parse { text: "100".into() },
        )
        .unwrap();

    // Edit B1 to 200
    engine
        .set_cell(
            &sheet_id(),
            cell_id_b1(),
            0,
            1,
            crate::bridge_types::CellInput::Parse { text: "200".into() },
        )
        .unwrap();

    // Both edits should be undoable
    assert!(engine.can_undo());

    // Undo B1 edit
    engine.undo().unwrap();

    // B1 should be back to 20 in yrs doc
    let (yrs_val, _, _) = engine
        .storage()
        .read_cell_from_yrs(&sheet_id(), &cell_id_b1())
        .unwrap();
    assert_eq!(yrs_val, CellValue::Number(FiniteF64::must(20.0)));

    // Undo A1 edit
    engine.undo().unwrap();

    // A1 should be back to 10 in yrs doc
    let (yrs_val, _, _) = engine
        .storage()
        .read_cell_from_yrs(&sheet_id(), &cell_id_a1())
        .unwrap();
    assert_eq!(yrs_val, CellValue::Number(FiniteF64::must(10.0)));
}

// -------------------------------------------------------------------
// Test 10: can_undo/can_redo state transitions
// -------------------------------------------------------------------

#[test]
fn test_undo_redo_state_transitions() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    // Initially, nothing to undo or redo
    assert!(!engine.can_undo());
    assert!(!engine.can_redo());

    // After edit, can undo but not redo
    engine
        .set_cell(
            &sheet_id(),
            cell_id_a1(),
            0,
            0,
            crate::bridge_types::CellInput::Parse { text: "42".into() },
        )
        .unwrap();
    assert!(engine.can_undo());
    assert!(!engine.can_redo());

    // After undo, can redo but not undo
    engine.undo().unwrap();
    assert!(!engine.can_undo());
    assert!(engine.can_redo());

    // After redo, can undo but not redo
    engine.redo().unwrap();
    assert!(engine.can_undo());
    assert!(!engine.can_redo());
}

// -------------------------------------------------------------------
// Bootstrap path: default-sheet creation must NOT enter the undo stack
// -------------------------------------------------------------------
//
// A freshly-started blank workbook reports `canUndo == false`. The
// document lifecycle creates "Sheet1" via the bootstrap path
// (`create_default_sheet`); that path tags the underlying Yrs
// transaction with `ORIGIN_BOOTSTRAP`, which the UndoManager does not
// track. If this regresses, the user's first Cmd+Z deletes the only
// sheet (api-eval `history/undo-redo-state`,
// `history/undo-state-tracking`).
// -------------------------------------------------------------------

#[test]
fn create_default_sheet_does_not_enter_undo_stack() {
    use snapshot_types::WorkbookSnapshot;

    // Boot from an empty snapshot, mirroring the lifecycle's "blank
    // workbook" path before the implicit Sheet1 is created.
    let (mut engine, _) = YrsComputeEngine::from_snapshot(WorkbookSnapshot::default()).unwrap();
    assert!(!engine.can_undo(), "fresh empty engine has nothing to undo");

    // The bootstrap path used by `executeStartBridge`.
    let (_hex, _result) = engine
        .create_default_sheet("Sheet1")
        .expect("default-sheet bootstrap should succeed");

    assert!(
        !engine.can_undo(),
        "bootstrap default-sheet creation must NOT land on the undo stack — \
         a fresh workbook must report canUndo == false"
    );

    // Sanity: a regular user-initiated sheet creation IS undoable, so
    // we know the test isn't accidentally suppressing all sheet ops.
    let (_hex, _result) = engine
        .create_sheet("UserSheet")
        .expect("user-facing create_sheet should succeed");
    assert!(
        engine.can_undo(),
        "user-initiated create_sheet should land on the undo stack"
    );
}

#[test]
fn selected_sheet_ids_do_not_clear_redo_stack() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    engine
        .set_cell(
            &sheet_id(),
            cell_id_a1(),
            0,
            0,
            crate::bridge_types::CellInput::Parse { text: "42".into() },
        )
        .unwrap();
    engine.undo().unwrap();
    assert!(engine.can_redo(), "cell edit should be redoable after undo");

    let mut settings = engine.get_workbook_settings();
    settings.selected_sheet_ids = Some(vec![sheet_id().to_uuid_string()]);
    engine
        .set_workbook_settings(settings)
        .expect("selected sheet state write should succeed");

    assert!(
        engine.can_redo(),
        "selected sheet UI state must not clear the redo stack"
    );
    engine.redo().unwrap();
    assert_eq!(cell_value_at(&engine, &sheet_id(), 0, 0), num(42.0));
}

#[test]
fn scroll_position_does_not_clear_redo_stack() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    engine
        .set_cell(
            &sheet_id(),
            cell_id_a1(),
            0,
            0,
            crate::bridge_types::CellInput::Parse { text: "42".into() },
        )
        .unwrap();
    engine.undo().unwrap();
    assert!(engine.can_redo(), "cell edit should be redoable after undo");

    engine
        .set_scroll_position(&sheet_id(), 12, 7)
        .expect("scroll position write should succeed");

    assert!(
        engine.can_redo(),
        "scroll/view UI state must not clear the redo stack"
    );
    engine.redo().unwrap();
    assert_eq!(cell_value_at(&engine, &sheet_id(), 0, 0), num(42.0));
}

// ===================================================================
// Undo/Redo Pipeline Unification Tests
// ===================================================================

// -------------------------------------------------------------------
// Test: set_format_for_ranges -> undo -> MutationResult has property_changes
// -------------------------------------------------------------------

#[test]
fn test_undo_format_produces_property_changes() {
    use domain_types::CellFormat;

    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    // Apply a format change (bold A1)
    let format = CellFormat {
        bold: Some(true),
        ..Default::default()
    };
    let _fwd = engine
        .set_format_for_ranges(&sid, &[(0, 0, 0, 0)], &format)
        .unwrap();

    // Undo it
    assert!(engine.can_undo());
    let (patches, result) = engine.undo().unwrap();

    // The MutationResult should contain property_changes for the reverted cell
    assert!(
        !result.property_changes.is_empty(),
        "undo of format should produce property_changes, got: {:?}",
        result.property_changes,
    );

    // The first property change should reference the sheet
    let pc = &result.property_changes[0];
    assert_eq!(pc.sheet_id, sid.to_uuid_string());
}

// -------------------------------------------------------------------
// Test: set_format_for_ranges -> undo -> viewport patches are non-empty
// -------------------------------------------------------------------

#[test]
fn test_undo_format_produces_viewport_patches() {
    use domain_types::CellFormat;

    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    // Register a viewport so patches get produced
    engine
        .register_viewport("main", &sid, 0, 0, 100, 26)
        .unwrap();

    // Apply a format change
    let format = CellFormat {
        bold: Some(true),
        ..Default::default()
    };
    let _fwd = engine
        .set_format_for_ranges(&sid, &[(0, 0, 0, 0)], &format)
        .unwrap();

    // Undo it
    let (patches, _result) = engine.undo().unwrap();

    // Patches should be non-trivial (more than just the 2-byte count header)
    assert!(
        patches.len() > 2,
        "undo of format should produce viewport patches, got {} bytes",
        patches.len(),
    );
}

// -------------------------------------------------------------------
// Test: set_row_height -> undo -> MutationResult has dimension_changes
// -------------------------------------------------------------------

#[test]
fn test_undo_row_height_produces_dimension_changes() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    // Set a row height
    let _fwd = engine.set_row_height(&sid, 0, 40.0).unwrap();

    // Undo it
    assert!(engine.can_undo());
    let (_patches, result) = engine.undo().unwrap();

    assert!(
        !result.dimension_changes.is_empty(),
        "undo of row height should produce dimension_changes",
    );

    let dc = &result.dimension_changes[0];
    assert_eq!(dc.sheet_id, sid.to_uuid_string());
    assert_eq!(dc.axis, crate::snapshot::Axis::Row);
    assert_eq!(dc.index, 0);
}

// -------------------------------------------------------------------
// Test: merge_range -> undo -> MutationResult has merge_changes
// -------------------------------------------------------------------

#[test]
fn test_undo_merge_produces_merge_changes() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    // Merge A1:B1
    let _fwd = engine.merge_range(&sid, 0, 0, 0, 1).unwrap();

    // Undo it
    assert!(engine.can_undo());
    let (_patches, result) = engine.undo().unwrap();

    assert!(
        !result.merge_changes.is_empty(),
        "undo of merge should produce merge_changes",
    );
}

#[test]
fn test_merge_range_discards_non_origin_values_after_explicit_unmerge() {
    let snap = copy_range_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    engine.merge_range(&sid, 0, 0, 1, 1).unwrap();

    assert_eq!(cell_value_at(&engine, &sid, 0, 0), num(10.0));
    assert_eq!(cell_value_at(&engine, &sid, 0, 1), CellValue::Null);
    assert_eq!(cell_value_at(&engine, &sid, 1, 0), CellValue::Null);
    assert_eq!(cell_value_at(&engine, &sid, 1, 1), CellValue::Null);

    engine.unmerge_range(&sid, 0, 0, 1, 1).unwrap();

    assert!(engine.get_all_merges_in_sheet(&sid).is_empty());
    assert_eq!(cell_value_at(&engine, &sid, 0, 0), num(10.0));
    assert_eq!(cell_value_at(&engine, &sid, 0, 1), CellValue::Null);
    assert_eq!(cell_value_at(&engine, &sid, 1, 0), CellValue::Null);
    assert_eq!(cell_value_at(&engine, &sid, 1, 1), CellValue::Null);
}

#[test]
fn test_rejected_overlapping_merge_does_not_discard_values() {
    let snap = copy_range_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    engine.merge_range(&sid, 0, 0, 0, 1).unwrap();
    let (_patches, result) = engine.merge_range(&sid, 0, 0, 1, 1).unwrap();

    assert!(result.merge_changes.is_empty());
    assert_eq!(cell_value_at(&engine, &sid, 0, 0), num(10.0));
    assert_eq!(cell_value_at(&engine, &sid, 0, 1), CellValue::Null);
    assert_eq!(cell_value_at(&engine, &sid, 1, 0), num(30.0));
    assert_eq!(cell_value_at(&engine, &sid, 1, 1), num(40.0));
}

#[test]
fn test_undo_merge_restores_discarded_non_origin_values() {
    let snap = copy_range_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    engine.merge_range(&sid, 0, 0, 1, 1).unwrap();

    assert_eq!(cell_value_at(&engine, &sid, 0, 1), CellValue::Null);
    assert_eq!(cell_value_at(&engine, &sid, 1, 0), CellValue::Null);
    assert_eq!(cell_value_at(&engine, &sid, 1, 1), CellValue::Null);

    assert!(engine.can_undo());
    engine.undo().unwrap();

    assert!(engine.get_all_merges_in_sheet(&sid).is_empty());
    assert_eq!(cell_value_at(&engine, &sid, 0, 0), num(10.0));
    assert_eq!(cell_value_at(&engine, &sid, 0, 1), num(20.0));
    assert_eq!(cell_value_at(&engine, &sid, 1, 0), num(30.0));
    assert_eq!(cell_value_at(&engine, &sid, 1, 1), num(40.0));
}

// -------------------------------------------------------------------
// Test: mixed mutation (value + format) -> undo -> both changes present
// -------------------------------------------------------------------

#[test]
fn test_undo_mixed_mutation_produces_both_cell_and_property_changes() {
    use domain_types::CellFormat;

    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    // Begin undo group so both changes are in one undo step
    engine.begin_undo_group().unwrap();

    // Change cell value
    engine
        .set_cell(
            &sid,
            cell_id_a1(),
            0,
            0,
            crate::bridge_types::CellInput::Parse { text: "42".into() },
        )
        .unwrap();

    // Change format
    let format = CellFormat {
        bold: Some(true),
        ..Default::default()
    };
    engine
        .set_format_for_ranges(&sid, &[(0, 0, 0, 0)], &format)
        .unwrap();

    engine.end_undo_group().unwrap();

    // Undo the group
    assert!(engine.can_undo());
    let (_patches, result) = engine.undo().unwrap();

    // Should have both cell changes (from recalc) and property changes
    assert!(
        !result.recalc.changed_cells.is_empty(),
        "undo of mixed mutation should produce cell changes",
    );
    assert!(
        !result.property_changes.is_empty(),
        "undo of mixed mutation should produce property_changes",
    );
}

// -------------------------------------------------------------------
// Test: redo produces same quality of results as undo
// -------------------------------------------------------------------

#[test]
fn test_redo_produces_property_changes() {
    use domain_types::CellFormat;

    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    // Apply a format change
    let format = CellFormat {
        bold: Some(true),
        ..Default::default()
    };
    let _fwd = engine
        .set_format_for_ranges(&sid, &[(0, 0, 0, 0)], &format)
        .unwrap();

    // Undo
    engine.undo().unwrap();

    // Redo
    assert!(engine.can_redo());
    let (_patches, result) = engine.redo().unwrap();

    assert!(
        !result.property_changes.is_empty(),
        "redo of format should produce property_changes",
    );
}

// -------------------------------------------------------------------
// Test: redo of row height produces dimension changes
// -------------------------------------------------------------------

#[test]
fn test_redo_row_height_produces_dimension_changes() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    // Set row height
    engine.set_row_height(&sid, 0, 40.0).unwrap();

    // Undo + redo
    engine.undo().unwrap();
    assert!(engine.can_redo());
    let (_patches, result) = engine.redo().unwrap();

    assert!(
        !result.dimension_changes.is_empty(),
        "redo of row height should produce dimension_changes",
    );
}
