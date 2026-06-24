//! Collaboration bootstrap topology coverage for sync.

use super::super::*;
use super::helpers::*;
use super::sync_helpers::*;
use formula_types::StructureChange;
use snapshot_types::WorkbookSnapshot;

#[test]
fn sync_forked_engines_share_default_sheet_history() {
    let (room_state, sheet_id) = canonical_room_state();
    let (mut engine_a, mut engine_b) = fork_engine_pair_from_state(&room_state);

    assert_eq!(
        engine_a.get_all_sheet_ids(),
        vec![sheet_id.to_uuid_string()],
        "engine A must hydrate the canonical default sheet",
    );
    assert_eq!(
        engine_b.get_all_sheet_ids(),
        vec![sheet_id.to_uuid_string()],
        "engine B must hydrate the canonical default sheet",
    );

    engine_a
        .set_cell_value_as_text(&sheet_id, 0, 0, "42")
        .expect("engine A set A1");
    assert_cell_is_42(&engine_a, &sheet_id);

    let _ = sync_a_to_b_diff(&engine_a, &mut engine_b);
    assert_cell_is_42(&engine_b, &sheet_id);
}

#[test]
fn sync_concurrent_row_delete_and_cell_write_drops_orphaned_cell_payload() {
    let (room_state, sheet_id) = canonical_room_state();
    let (mut engine_a, mut engine_b) = fork_engine_pair_from_state(&room_state);

    for row in 0..5 {
        engine_a
            .set_cell_value_as_text(&sheet_id, row, 0, &(row + 1).to_string())
            .expect("seed row");
    }
    sync_bidirectional(&mut engine_a, &mut engine_b);

    engine_a
        .structure_change(
            &sheet_id,
            &StructureChange::DeleteRows {
                at: 0,
                count: 5,
                deleted_cell_ids: vec![],
            },
        )
        .expect("engine A delete rows");
    engine_b
        .set_cell_value_as_text(&sheet_id, 0, 0, "99")
        .expect("engine B write A1");

    sync_a_to_b_diff(&engine_a, &mut engine_b);
    sync_a_to_b_diff(&engine_b, &mut engine_a);

    assert_eq!(
        engine_a.get_cell_value(&sheet_id, 0, 0),
        engine_b.get_cell_value(&sheet_id, 0, 0),
        "engines must converge after a write races with row-axis deletion",
    );
}

#[test]
fn sync_independent_default_sheet_bootstraps_are_not_deep_merged() {
    let (mut engine_a, _) = YrsComputeEngine::from_snapshot(WorkbookSnapshot::default()).unwrap();
    let (sheet_hex_a, _) = engine_a
        .create_default_sheet("Sheet1")
        .expect("engine A default sheet");
    let sheet_id = SheetId::from_uuid_str(&sheet_hex_a).unwrap();

    let (mut engine_b, _) = YrsComputeEngine::from_snapshot(WorkbookSnapshot::default()).unwrap();
    let (sheet_hex_b, _) = engine_b
        .create_default_sheet("Sheet1")
        .expect("engine B default sheet");
    assert_eq!(
        sheet_hex_a, sheet_hex_b,
        "deterministic default SheetIds can still refer to different Yrs map objects",
    );

    engine_a
        .set_cell_value_as_text(&sheet_id, 0, 0, "from-a")
        .expect("engine A set A1");
    engine_b
        .set_cell_value_as_text(&sheet_id, 0, 1, "from-b")
        .expect("engine B set B1");

    // This invalid setup independently creates sheetOrder, the sheet map,
    // grid index, row/column arrays, and child maps under the same workbook
    // keys. State-vector exchange converges the CRDT document, but it cannot
    // deep-merge two separately-created nested sheet maps into one sheet.
    for _ in 0..3 {
        sync_bidirectional(&mut engine_a, &mut engine_b);
    }

    let a_visible = (
        engine_a.get_cell_value(&sheet_id, 0, 0),
        engine_a.get_cell_value(&sheet_id, 0, 1),
    );
    let b_visible = (
        engine_b.get_cell_value(&sheet_id, 0, 0),
        engine_b.get_cell_value(&sheet_id, 0, 1),
    );
    assert_eq!(
        a_visible, b_visible,
        "independent bootstrap peers must converge to the same visible state",
    );

    let has_a_marker =
        matches!(&b_visible.0, value_types::CellValue::Text(s) if s.as_ref() == "from-a");
    let has_b_marker =
        matches!(&b_visible.1, value_types::CellValue::Text(s) if s.as_ref() == "from-b");
    assert!(
        !(has_a_marker && has_b_marker),
        "independent default-sheet bootstraps must not be treated as a deep merge; visible state was {b_visible:?}",
    );
}
