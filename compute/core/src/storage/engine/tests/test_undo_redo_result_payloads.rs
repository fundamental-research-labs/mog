//! Undo/redo mutation result payload coverage.

use super::super::*;
use super::helpers::*;
use crate::snapshot::SheetSnapshot;
use compute_wire::constants::{MUTATION_HEADER_SIZE, PATCH_STRIDE};
use compute_wire::flags::{MUT_HAS_PALETTE, MUT_HAS_PROJECTION_CHANGES};
use domain_types::CellFormat;

fn sorted_first_viewport_patch_positions(patches: &[u8]) -> Vec<(u32, u32)> {
    let mutation =
        extract_first_viewport_mutation(patches).expect("expected first viewport mutation patch");
    let mut positions = extract_patch_positions(&mutation);
    positions.sort_unstable();
    positions
}

fn first_viewport_format_idx_at(patches: &[u8], row: u32, col: u32) -> Option<u16> {
    let mutation = extract_first_viewport_mutation(patches)?;
    let patch_count =
        u32::from_le_bytes([mutation[0], mutation[1], mutation[2], mutation[3]]) as usize;
    let sheet_id_len = u16::from_le_bytes([mutation[8], mutation[9]]) as usize;
    let patches_start = MUTATION_HEADER_SIZE + sheet_id_len;

    for i in 0..patch_count {
        let patch_off = patches_start + i * PATCH_STRIDE;
        let patch_row = u32::from_le_bytes([
            mutation[patch_off],
            mutation[patch_off + 1],
            mutation[patch_off + 2],
            mutation[patch_off + 3],
        ]);
        let patch_col = u32::from_le_bytes([
            mutation[patch_off + 4],
            mutation[patch_off + 5],
            mutation[patch_off + 6],
            mutation[patch_off + 7],
        ]);
        if patch_row == row && patch_col == col {
            let record_off = patch_off + 8;
            return Some(u16::from_le_bytes([
                mutation[record_off + 18],
                mutation[record_off + 19],
            ]));
        }
    }

    None
}

fn first_viewport_format_at(patches: &[u8], row: u32, col: u32) -> Option<CellFormat> {
    let mutation = extract_first_viewport_mutation(patches)?;
    let format_idx = first_viewport_format_idx_at(patches, row, col)?;
    let patch_count =
        u32::from_le_bytes([mutation[0], mutation[1], mutation[2], mutation[3]]) as usize;
    let string_bytes =
        u32::from_le_bytes([mutation[4], mutation[5], mutation[6], mutation[7]]) as usize;
    let sheet_id_len = u16::from_le_bytes([mutation[8], mutation[9]]) as usize;
    let flags = mutation[10];
    if flags & MUT_HAS_PALETTE == 0 {
        return None;
    }

    let mut palette_offset =
        MUTATION_HEADER_SIZE + sheet_id_len + patch_count * PATCH_STRIDE + string_bytes;
    if flags & MUT_HAS_PROJECTION_CHANGES != 0 {
        let projection_count = u32::from_le_bytes([
            mutation[palette_offset],
            mutation[palette_offset + 1],
            mutation[palette_offset + 2],
            mutation[palette_offset + 3],
        ]) as usize;
        palette_offset += 4 + projection_count * PATCH_STRIDE;
    }

    let palette_bytes_len = u32::from_le_bytes([
        mutation[palette_offset + 2],
        mutation[palette_offset + 3],
        mutation[palette_offset + 4],
        mutation[palette_offset + 5],
    ]) as usize;
    let palette_bytes_start = palette_offset + 6;
    let palette_bytes_end = palette_bytes_start + palette_bytes_len;
    let (palette_start_index, formats) = compute_wire::palette_binary::deserialize_palette_binary(
        &mutation[palette_bytes_start..palette_bytes_end],
    )
    .ok()?;

    let local_idx = format_idx.checked_sub(palette_start_index)? as usize;
    formats.get(local_idx).cloned()
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

#[test]
fn test_undo_format_produces_viewport_patches() {
    use domain_types::CellFormat;

    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    // Register a viewport so patches get produced
    let _initial_viewport = engine.get_viewport_binary(&sid, 0, 0, 100, 26, false);

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

#[test]
fn test_undo_cell_format_to_default_patches_default_format() {
    use domain_types::CellFormat;

    let snap = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sheet_id().to_uuid_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells: vec![],
            ranges: vec![],
        }],
        ..Default::default()
    };
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    engine
        .register_viewport("main", &sid, 0, 0, 100, 26)
        .unwrap();

    let format = CellFormat {
        font_size: Some(12.0.into()),
        ..Default::default()
    };
    let (forward_patches, _) = engine
        .set_format_for_ranges(&sid, &[(0, 0, 0, 0)], &format)
        .unwrap();
    assert!(first_viewport_format_idx_at(&forward_patches, 0, 0).is_some());
    assert_eq!(
        engine
            .get_displayed_cell_properties(&sid, 0, 0)
            .font_size
            .map(|size| size.points()),
        Some(12.0)
    );

    let (patches, result) = engine.undo().unwrap();

    assert_eq!(
        engine
            .get_displayed_cell_properties(&sid, 0, 0)
            .font_size
            .map(|size| size.points()),
        Some(11.0),
        "undo should restore the default displayed font size"
    );
    assert!(
        result.property_changes.iter().any(|change| change
            .position
            .as_ref()
            .is_some_and(|pos| pos.row == 0 && pos.col == 0)),
        "undo should report A1 as a property change; got {:?}",
        result.property_changes
    );

    let undo_positions = sorted_first_viewport_patch_positions(&patches);
    assert!(
        undo_positions.contains(&(0, 0)),
        "undo should patch A1 back to the default format; got {:?}",
        undo_positions
    );
    assert_eq!(
        first_viewport_format_at(&patches, 0, 0)
            .and_then(|format| format.font_size.map(|size| size.points())),
        Some(11.0),
        "undo patch should include a palette entry for A1's restored default format"
    );
}

#[test]
fn test_observer_format_patches_use_grid_index_position_fallback() {
    use compute_document::observe::{
        CellChangeKind, DocumentChanges, GridIndexCellChange, PropertyCellChange,
    };
    use domain_types::CellFormat;

    let snap = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sheet_id().to_uuid_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells: vec![],
            ranges: vec![],
        }],
        ..Default::default()
    };
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    engine
        .register_viewport("main", &sid, 0, 0, 100, 26)
        .unwrap();

    let format = CellFormat {
        font_size: Some(12.0.into()),
        ..Default::default()
    };
    engine
        .set_format_for_ranges(&sid, &[(0, 0, 0, 0)], &format)
        .unwrap();

    let (cell_id, row_hex, col_hex) = {
        let grid = engine
            .stores
            .grid_indexes
            .get(&sid)
            .expect("sheet should have a grid index");
        (
            grid.cell_id_at(0, 0)
                .expect("formatting A1 should allocate a CellId"),
            grid.row_id_hex(0)
                .expect("A1 row should have a row identity")
                .to_string(),
            grid.col_id_hex(0)
                .expect("A1 column should have a column identity")
                .to_string(),
        )
    };

    engine
        .stores
        .grid_indexes
        .get_mut(&sid)
        .expect("sheet should have a mutable grid index")
        .remove_cell(&cell_id);
    assert_eq!(
        engine
            .stores
            .grid_indexes
            .get(&sid)
            .and_then(|grid| grid.cell_position(&cell_id)),
        None,
        "test setup should simulate the observer state after gridIndex removal"
    );

    let mut changes = DocumentChanges::default();
    changes.properties.push(PropertyCellChange {
        sheet_id: sid,
        cell_id,
        kind: CellChangeKind::Removed,
    });
    changes.grid_index.push(GridIndexCellChange {
        sheet_id: sid,
        cell_id,
        row_hex,
        col_hex,
        kind: CellChangeKind::Removed,
    });

    let patches = engine.produce_observer_format_patches(&changes);
    let positions = sorted_first_viewport_patch_positions(&patches);
    assert!(
        positions.contains(&(0, 0)),
        "format observer patch should use gridIndex row/col fallback; got {:?}",
        positions
    );
}

#[test]
fn test_undo_row_format_produces_viewport_patches() {
    use domain_types::CellFormat;

    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    engine
        .register_viewport("main", &sid, 0, 0, 100, 26)
        .unwrap();

    let format = CellFormat {
        bold: Some(true),
        ..Default::default()
    };
    let (forward_patches, _result) = engine.set_row_format(&sid, 0, format).unwrap();
    let forward_positions = sorted_first_viewport_patch_positions(&forward_patches);
    assert_eq!(
        forward_positions.len(),
        27,
        "forward row format should patch only the visible row strip"
    );
    assert!(
        forward_positions.iter().all(|(row, _col)| *row == 0),
        "forward row format patched non-row cells: {:?}",
        forward_positions
    );

    let (patches, _result) = engine.undo().unwrap();
    let undo_positions = sorted_first_viewport_patch_positions(&patches);

    assert_eq!(
        undo_positions.len(),
        27,
        "undo row format should patch only the visible row strip"
    );
    assert!(
        undo_positions.iter().all(|(row, _col)| *row == 0),
        "undo row format patched non-row cells: {:?}",
        undo_positions
    );
}

#[test]
fn test_undo_col_format_produces_viewport_patches() {
    use domain_types::CellFormat;

    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    engine
        .register_viewport("main", &sid, 0, 0, 100, 26)
        .unwrap();

    let format = CellFormat {
        bold: Some(true),
        ..Default::default()
    };
    let (forward_patches, _result) = engine.set_col_format(&sid, 0, format).unwrap();
    let forward_positions = sorted_first_viewport_patch_positions(&forward_patches);
    assert_eq!(
        forward_positions.len(),
        101,
        "forward column format should patch only the visible column strip"
    );
    assert!(
        forward_positions.iter().all(|(_row, col)| *col == 0),
        "forward column format patched non-column cells: {:?}",
        forward_positions
    );

    let (patches, _result) = engine.undo().unwrap();
    let undo_positions = sorted_first_viewport_patch_positions(&patches);

    assert_eq!(
        undo_positions.len(),
        101,
        "undo column format should patch only the visible column strip"
    );
    assert!(
        undo_positions.iter().all(|(_row, col)| *col == 0),
        "undo column format patched non-column cells: {:?}",
        undo_positions
    );
}

#[test]
fn test_undo_structural_replay_provides_viewport_refresh_contract() {
    use formula_types::StructureChange;

    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    engine
        .register_viewport("main", &sid, 0, 0, 3, 2)
        .expect("register viewport");

    engine
        .structure_change(
            &sid,
            &StructureChange::InsertRows {
                at: 1,
                count: 1,
                new_row_ids: vec![],
            },
        )
        .expect("insert row");

    assert_eq!(cell_value_at(&engine, &sid, 2, 0), num(30.0));

    let (patches, result) = engine.undo().expect("undo row insert");

    assert_eq!(cell_value_at(&engine, &sid, 1, 0), num(30.0));
    assert!(
        patches.len() > 2 || !result.structure_changes.is_empty(),
        "structural undo replay must either patch shifted viewport cells or emit structure_changes for bridge refresh; patches={} structure_changes={:?}",
        patches.len(),
        result.structure_changes
    );

    if patches.len() > 2 {
        let mutation = extract_first_viewport_mutation(&patches).expect("viewport mutation");
        let positions = extract_patch_positions(&mutation);
        assert!(
            positions.contains(&(1, 0)),
            "undo patches must include the restored A2 position; got {positions:?}"
        );
    }

    let (redo_patches, redo_result) = engine.redo().expect("redo row insert");

    assert_eq!(cell_value_at(&engine, &sid, 2, 0), num(30.0));
    assert!(
        redo_patches.len() > 2 || !redo_result.structure_changes.is_empty(),
        "structural redo replay must either patch shifted viewport cells or emit structure_changes for bridge refresh; patches={} structure_changes={:?}",
        redo_patches.len(),
        redo_result.structure_changes
    );
}

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
