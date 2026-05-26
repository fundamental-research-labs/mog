//! Structural-op → `structure_version` bump regression tests (R2.3).
//!
//! The set of methods that must bump `structure_version` is the set that
//! will be annotated `#[bridge::structural]` after R3.2. For R2 we have
//! a hand-maintained list; this test runs through each entry and
//! confirms the counter increments. R3.2 will convert this to a
//! reflective enumeration over the bridge descriptors.
//!
//! Grep-worthy list of bump sites (each must be in this test):
//! 1. `YrsComputeEngine::structure_change` (insert/delete rows/cols)
//! 2. `YrsComputeEngine::apply_mutation(EngineMutation::CreateSheet)`
//! 3. `YrsComputeEngine::apply_mutation(EngineMutation::DeleteSheet)`
//! 4. `YrsComputeEngine::apply_mutation(EngineMutation::CopySheet)`
//! 5. `YrsComputeEngine::apply_mutation(EngineMutation::RenameSheet)`
//! 6. `YrsComputeEngine::reorder_sheets`

use compute_core::storage::engine::YrsComputeEngine;
use formula_types::StructureChange;
use snapshot_types::{SheetSnapshot, WorkbookSnapshot};

const SHEET1_UUID: &str = "11111111-1111-1111-1111-111111111111";

fn fresh_engine() -> YrsComputeEngine {
    let snapshot = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: SHEET1_UUID.to_string(),
            name: "Sheet1".to_string(),
            rows: 10,
            cols: 5,
            cells: vec![],
            ranges: vec![],
        }],
        ..Default::default()
    };
    let (engine, _) = YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
    engine
}

#[test]
fn structure_change_insert_rows_bumps_structure_version() {
    let mut engine = fresh_engine();
    let sheets = engine.storage().sheet_order();
    let sheet = sheets[0];
    let before = engine.security().structure_version();
    engine
        .structure_change(
            &sheet,
            &StructureChange::InsertRows {
                at: 0,
                count: 1,
                new_row_ids: Vec::new(),
            },
        )
        .expect("insert rows");
    assert!(engine.security().structure_version() > before);
}

#[test]
fn structure_change_delete_cols_bumps_structure_version() {
    // Column deletes are the regression case from R1 — stale column
    // overrides must not resurface at a recreated column's position.
    let mut engine = fresh_engine();
    let sheets = engine.storage().sheet_order();
    let sheet = sheets[0];
    let before = engine.security().structure_version();
    engine
        .structure_change(
            &sheet,
            &StructureChange::DeleteCols {
                at: 0,
                count: 1,
                deleted_cell_ids: Vec::new(),
            },
        )
        .expect("delete cols");
    assert!(engine.security().structure_version() > before);
}

#[test]
fn create_sheet_bumps_structure_version() {
    let mut engine = fresh_engine();
    let before = engine.security().structure_version();
    engine.create_sheet("AnotherSheet").expect("create_sheet");
    assert!(engine.security().structure_version() > before);
}

#[test]
fn delete_sheet_bumps_structure_version() {
    let mut engine = fresh_engine();
    // Need at least two sheets before deleting one (can't delete last).
    engine.create_sheet("ToDelete").expect("create_sheet");
    let sheets = engine.storage().sheet_order();
    assert!(sheets.len() >= 2);
    let before = engine.security().structure_version();
    engine.delete_sheet(&sheets[1]).expect("delete_sheet");
    assert!(engine.security().structure_version() > before);
}

#[test]
fn copy_sheet_bumps_structure_version() {
    let mut engine = fresh_engine();
    let sheets = engine.storage().sheet_order();
    let src = sheets[0];
    let before = engine.security().structure_version();
    engine.copy_sheet(&src, "Copy").expect("copy_sheet");
    assert!(engine.security().structure_version() > before);
}

// rename_sheet has no direct `#[bridge::write]` entry point on
// YrsComputeEngine — it routes through `EngineMutation::RenameSheet`
// via `apply_mutation` which is `pub(crate)`. The bump is verified at
// the apply_mutation branch (see engine/mod.rs). When R3.2 reclassifies
// and exposes a structural rename method, this test should be
// reinstated.

#[test]
fn reorder_sheets_bumps_structure_version() {
    let mut engine = fresh_engine();
    engine.create_sheet("B").expect("create B");
    let sheets = engine.storage().sheet_order();
    assert_eq!(sheets.len(), 2);
    let before = engine.security().structure_version();
    let order: Vec<String> = sheets.iter().rev().map(|id| id.to_uuid_string()).collect();
    engine.reorder_sheets(order).expect("reorder_sheets");
    assert!(engine.security().structure_version() > before);
}
