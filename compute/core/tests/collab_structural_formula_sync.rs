//! CRDT sync of formula shifts after structural ops.
//!
//! Verifies that when engine A performs a structural op, the yrs delta
//! that B receives carries enough information for B to render the shifted
//! A1 formula string.
//!
//! Specifically, the fix at
//! `compute/core/src/storage/engine/services/structural.rs`
//! invalidates the stale `KEY_FORMULA` sub-key on formula cells whose
//! A1 text shifted. The corresponding yrs update is what this test
//! exercises on the sync path.
//!
//! # Scenario
//!
//! - A1=1, B1=2, C1=`=A1+B1` (baseline).
//! - A: insert 1 row at row 0 (shift everything down by 1 → C2 should now
//!   render as `=A2+B2`).
//! - B: apply A's update; assert C2's formula on B is `=A2+B2`.

use compute_core::storage::engine::YrsComputeEngine;
use formula_types::StructureChange;
use snapshot_types::{CellData, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellValue, FiniteF64};

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

fn fixture() -> WorkbookSnapshot {
    let cells = vec![
        value_cell(1, 0, 0, 1.0),             // A1 = 1
        value_cell(2, 0, 1, 2.0),             // B1 = 2
        formula_cell(3, 0, 2, "=A1+B1", 3.0), // C1 = =A1+B1
    ];
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
            name: "Collab".to_string(),
            rows: 10,
            cols: 5,
            cells,
            ranges: vec![],
        }],
        ..Default::default()
    }
}

/// Read the formula body (without leading '=') for the cell at (row, col)
/// on the first sheet of the given engine's yrs state via its snapshot
/// export. Uses `export_to_xlsx_bytes` → `xlsx_api::parse` to go through
/// the real export path — which reads yrs `KEY_FORMULA` first with a
/// fallthrough to `compute.get_formula`. This is the same path that
/// `xlsx_structural_roundtrip.rs` uses, so the collab assertion
/// exercises the identical surface.
fn read_formula_via_xlsx(engine: &YrsComputeEngine, row: u32, col: u32) -> Option<String> {
    let bytes = engine.export_to_xlsx_bytes().expect("export_to_xlsx_bytes");
    let parsed = xlsx_api::parse(&bytes).expect("re-parse");
    let sheet = &parsed.output.sheets[0];
    sheet
        .cells
        .iter()
        .find(|c| c.row == row && c.col == col)
        .and_then(|c| c.formula.clone())
}

#[test]
fn collab_formula_shift_on_insert_row_propagates() {
    // 1. Build A from fixture.
    let (mut engine_a, _) = YrsComputeEngine::from_snapshot(fixture()).expect("A from_snapshot");
    let sid_a = *engine_a.mirror().sheet_ids().next().expect("A has a sheet");

    // 2. Seed B from A's current yrs state so they share CellIds + history.
    //    `encode_diff` against an empty state vector yields the full
    //    document state bytes.
    let empty_sv = {
        // A fresh `yrs::StateVector::default()` encoded as v1.
        // Accessed via the engine's public sync surface: encode against
        // our own fresh SV proxy.
        // NOTE: compute-collab doesn't expose a helper for this, so we
        // build it using yrs directly.
        use yrs::updates::encoder::Encode;
        yrs::StateVector::default().encode_v1()
    };
    let full_state = engine_a
        .encode_diff(&empty_sv)
        .expect("A encode_diff(empty)");
    let (mut engine_b, _) =
        YrsComputeEngine::from_yrs_state(&full_state).expect("B from_yrs_state");

    // Sanity: both see C1 as `=A1+B1`.
    assert_eq!(
        read_formula_via_xlsx(&engine_a, 0, 2).as_deref(),
        Some("A1+B1"),
        "A baseline C1 formula"
    );
    assert_eq!(
        read_formula_via_xlsx(&engine_b, 0, 2).as_deref(),
        Some("A1+B1"),
        "B baseline C1 formula"
    );

    // 3. A does: insert 1 row at row 0.
    engine_a
        .structure_change(
            &sid_a,
            &StructureChange::InsertRows {
                at: 0,
                count: 1,
                new_row_ids: Vec::new(),
            },
        )
        .expect("A insert_row");

    // 4. A post-condition: C2 (shifted from C1) now reads `=A2+B2` on A.
    assert_eq!(
        read_formula_via_xlsx(&engine_a, 1, 2).as_deref(),
        Some("A2+B2"),
        "A post-insert C2 formula should be shifted to A2+B2"
    );

    // 5. Ship A's delta to B.
    let b_sv = engine_b.encode_state_vector();
    let delta = engine_a.encode_diff(&b_sv).expect("A encode_diff(B.sv)");
    engine_b
        .apply_sync_update_legacy(&delta)
        .expect("B apply_sync_update");

    // 6. B post-condition: after applying A's structural delta, B's own
    //    reconstruction (driven by the observer-triggered rebuild path
    //    in `rebuild_after_structural_observer_change`) must produce
    //    C2 = `=A2+B2`. This verifies the KEY_FORMULA invalidation
    //    doesn't corrupt the cross-client view — B reconstructs the
    //    correct A1 text from its local copy of the IdentityFormula
    //    template (stored under KEY_FORMULA_TEMPLATE, untouched by the
    //    invalidation).
    // Debug: dump B's full cell state.
    let bytes = engine_b.export_to_xlsx_bytes().expect("B export");
    let parsed = xlsx_api::parse(&bytes).expect("B re-parse");
    let sheet = &parsed.output.sheets[0];
    eprintln!("B sheet name: {}", sheet.name);
    eprintln!("B sheet cells:");
    for c in &sheet.cells {
        eprintln!(
            "  ({}, {}): value={:?} formula={:?}",
            c.row, c.col, c.value, c.formula
        );
    }
    assert_eq!(
        read_formula_via_xlsx(&engine_b, 1, 2).as_deref(),
        Some("A2+B2"),
        "B post-sync C2 formula should be shifted to A2+B2 (observed \
         stale KEY_FORMULA would leave the pre-shift A1+B1 behind)"
    );
}
