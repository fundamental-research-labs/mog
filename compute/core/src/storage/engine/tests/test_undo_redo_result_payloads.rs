//! Undo and redo report metadata changes and restore rendered formats.

use super::super::*;
use super::helpers::*;
use crate::snapshot::SheetSnapshot;
use domain_types::CellFormat;

fn rendered_format_at(engine: &ComputeEngine, row: u32, col: u32) -> Option<CellFormat> {
    let data = engine.build_viewport_render_data(&sheet_id(), row, col, row + 1, col + 1);
    data.format_palette
        .get(data.cells.first()?.format_idx as usize)
        .cloned()
}

fn assert_dimension_set_size(
    result: &crate::snapshot::MutationResult,
    axis: crate::snapshot::Axis,
    index: u32,
    expected_size: f64,
) {
    let change = result
        .dimension_changes
        .iter()
        .find(|change| change.axis == axis && change.index == index)
        .unwrap_or_else(|| {
            panic!(
                "missing dimension change for {:?} {}; got {:?}",
                axis, index, result.dimension_changes
            )
        });
    assert_eq!(change.kind, crate::snapshot::ChangeKind::Set);
    let size = change.size.as_ref().expect("dimension size").get();
    assert!(
        (size - expected_size).abs() < 0.001,
        "expected restored {:?} {} size {}px, got {}px",
        axis,
        index,
        expected_size,
        size
    );
}

#[test]
fn test_undo_formula_clear_reports_restored_cell_change() {
    let snap = simple_snapshot();
    let (mut engine, _) = ComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    let clear_result = engine.batch_clear_cells(vec![cell_id_a2()]).unwrap();
    assert!(
        clear_result.recalc.changed_cells.iter().any(|change| change
            .position
            .as_ref()
            .is_some_and(|pos| pos.row == 1 && pos.col == 0)),
        "clearing A2 should report a changed cell"
    );

    assert!(engine.can_undo());
    let undo_result = engine.undo().unwrap();

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
    let (mut engine, _) = ComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();
    let format = CellFormat {
        bold: Some(true),
        ..Default::default()
    };
    let _fwd = engine
        .set_format_for_ranges(&sid, &[(0, 0, 0, 0)], &format)
        .unwrap();
    assert!(engine.can_undo());
    let result = engine.undo().unwrap();
    assert!(
        !result.property_changes.is_empty(),
        "undo of format should produce property_changes, got: {:?}",
        result.property_changes,
    );
    let pc = &result.property_changes[0];
    assert_eq!(pc.sheet_id, sid.to_uuid_string());
}

#[test]
fn test_undo_cell_format_to_default_patches_default_format() {
    use domain_types::CellFormat;

    let snap = WorkbookSnapshot {
        axis_run_high_water_mark: None,
        identity_high_water_mark: None,
        canonical_tables: Vec::new(),
        sheets: vec![SheetSnapshot {
            identities: Vec::new(),
            row_axis: None,
            col_axis: None,
            id: sheet_id().to_uuid_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells: vec![],
            ranges: vec![],
        }],
        ..Default::default()
    };
    let (mut engine, _) = ComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    engine
        .register_viewport("main", &sid, 0, 0, 100, 26)
        .unwrap();

    let format = CellFormat {
        font_size: Some(12.0.into()),
        ..Default::default()
    };
    let _ = engine
        .set_format_for_ranges(&sid, &[(0, 0, 0, 0)], &format)
        .unwrap();

    assert_eq!(
        engine
            .get_displayed_cell_properties(&sid, 0, 0)
            .font_size
            .map(|size| size.points()),
        Some(12.0)
    );

    let result = engine.undo().unwrap();

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

    assert_eq!(
        rendered_format_at(&engine, 0, 0)
            .and_then(|format| format.font_size.map(|size| size.points())),
        Some(11.0),
        "undo patch should include a palette entry for A1's restored default format"
    );
}

#[test]
fn undo_format_only_cell_patches_saved_position_after_identity_removal() {
    let (mut engine, _) = ComputeEngine::from_snapshot(empty_bulk_snapshot()).unwrap();
    let sid = sheet_id();
    engine
        .register_viewport("main", &sid, 0, 0, 10, 10)
        .unwrap();
    engine
        .set_format_for_ranges(
            &sid,
            &[(0, 0, 0, 0)],
            &CellFormat {
                font_size: Some(12.0.into()),
                ..Default::default()
            },
        )
        .unwrap();
    let cell_id = engine
        .cell_store()
        .get_sheet(&sid)
        .unwrap()
        .cell_id_at(cell_types::SheetPos::new(0, 0))
        .expect("formatting a blank cell allocates its identity");
    let result = engine.undo().unwrap();
    assert_eq!(
        engine
            .cell_store()
            .get_sheet(&sid)
            .unwrap()
            .cell_position(&cell_id),
        None,
        "undo removes the identity allocated only for the reverted format"
    );

    assert!(result.property_changes.iter().any(|change| {
        change
            .position
            .as_ref()
            .is_some_and(|position| position.row == 0 && position.col == 0)
    }));
    assert_eq!(
        rendered_format_at(&engine, 0, 0)
            .and_then(|format| format.font_size.map(|size| size.points())),
        Some(11.0)
    );
}

#[test]
fn undo_row_format_restores_rendered_cells() {
    let (mut engine, _) = ComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let sid = sheet_id();
    let before = rendered_format_at(&engine, 0, 0).unwrap();
    engine
        .set_row_format(
            &sid,
            0,
            CellFormat {
                bold: Some(true),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(rendered_format_at(&engine, 0, 0).unwrap().bold, Some(true));
    engine.undo().unwrap();
    assert_eq!(rendered_format_at(&engine, 0, 0).unwrap().bold, before.bold);
    engine.redo().unwrap();
    assert_eq!(rendered_format_at(&engine, 0, 0).unwrap().bold, Some(true));
}

#[test]
fn test_redo_grouped_bulk_set_cells_reports_changed_cells_and_viewport_patches() {
    let snap = simple_snapshot();
    let (mut engine, _) = ComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    engine
        .register_viewport("main", &sid, 0, 0, 100, 26)
        .unwrap();

    engine.begin_undo_group().unwrap();
    engine
        .batch_set_cells_by_position(
            vec![
                (
                    sid,
                    17,
                    0,
                    crate::storage::engine::mutation::CellInput::Parse {
                        text: "atlas91 paste alpha".into(),
                    },
                ),
                (
                    sid,
                    17,
                    1,
                    crate::storage::engine::mutation::CellInput::Parse { text: "101".into() },
                ),
            ],
            true,
        )
        .unwrap();
    engine.end_undo_group().unwrap();
    engine.undo().unwrap();

    let result = engine.redo().unwrap();

    let mut changed_positions: Vec<(u32, u32)> = result
        .recalc
        .changed_cells
        .iter()
        .filter_map(|change| change.position.as_ref().map(|pos| (pos.row, pos.col)))
        .collect();
    changed_positions.sort_unstable();
    assert!(
        changed_positions.contains(&(17, 0)) && changed_positions.contains(&(17, 1)),
        "redo of grouped paste should report restored cell positions; got {:?}",
        changed_positions
    );
}

#[test]
fn test_undo_single_position_batch_reports_changed_cell_and_viewport_patch() {
    let snap = simple_snapshot();
    let (mut engine, _) = ComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    engine
        .register_viewport("main", &sid, 0, 0, 20, 20)
        .unwrap();

    engine
        .batch_set_cells_by_position(
            vec![(
                sid,
                9,
                12,
                crate::storage::engine::mutation::CellInput::Parse {
                    text: "atlas91 paste alpha".into(),
                },
            )],
            true,
        )
        .unwrap();

    let result = engine.undo().unwrap();

    let changed_positions: Vec<(u32, u32)> = result
        .recalc
        .changed_cells
        .iter()
        .filter_map(|change| change.position.as_ref().map(|pos| (pos.row, pos.col)))
        .collect();
    assert!(
        changed_positions.contains(&(9, 12)),
        "undo of single positioned paste should report the cleared cell; got {:?}",
        changed_positions
    );
}

#[test]
fn undo_col_format_restores_rendered_cells() {
    let (mut engine, _) = ComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let sid = sheet_id();
    let before = rendered_format_at(&engine, 0, 0).unwrap();
    engine
        .set_col_format(
            &sid,
            0,
            CellFormat {
                bold: Some(true),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(rendered_format_at(&engine, 0, 0).unwrap().bold, Some(true));
    engine.undo().unwrap();
    assert_eq!(rendered_format_at(&engine, 0, 0).unwrap().bold, before.bold);
    engine.redo().unwrap();
    assert_eq!(rendered_format_at(&engine, 0, 0).unwrap().bold, Some(true));
}

#[test]
fn test_undo_structural_replay_provides_viewport_refresh_contract() {
    use formula_types::StructureChange;

    let snap = simple_snapshot();
    let (mut engine, _) = ComputeEngine::from_snapshot(snap).unwrap();
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

    let result = engine.undo().expect("undo row insert");

    assert_eq!(cell_value_at(&engine, &sid, 1, 0), num(30.0));
    assert!(!result.structure_changes.is_empty());

    let redo_result = engine.redo().expect("redo row insert");

    assert_eq!(cell_value_at(&engine, &sid, 2, 0), num(30.0));
    assert!(!redo_result.structure_changes.is_empty());
}

#[test]
fn test_undo_row_height_produces_dimension_changes() {
    let snap = simple_snapshot();
    let (mut engine, _) = ComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();
    let before = engine.get_row_height_query(&sid, 0);
    let _fwd = engine.set_row_height(&sid, 0, 40.0).unwrap();
    assert!(engine.can_undo());
    let result = engine.undo().unwrap();

    assert!(
        !result.dimension_changes.is_empty(),
        "undo of row height should produce dimension_changes",
    );

    let dc = &result.dimension_changes[0];
    assert_eq!(dc.sheet_id, sid.to_uuid_string());
    assert_eq!(dc.axis, crate::snapshot::Axis::Row);
    assert_eq!(dc.index, 0);
    assert_dimension_set_size(&result, crate::snapshot::Axis::Row, 0, before);
}

#[test]
fn test_undo_col_width_restores_width_and_produces_dimension_changes() {
    let snap = simple_snapshot();
    let (mut engine, _) = ComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    let before = engine.get_col_width_query(&sid, 1);
    engine.set_col_width(&sid, 1, 145.0).unwrap();
    assert_ne!(engine.get_col_width_query(&sid, 1), before);

    assert!(engine.can_undo());
    let result = engine.undo().unwrap();

    assert_eq!(engine.get_col_width_query(&sid, 1), before);
    assert!(
        !result.dimension_changes.is_empty(),
        "undo of column width should produce dimension_changes",
    );

    let dc = &result.dimension_changes[0];
    assert_eq!(dc.sheet_id, sid.to_uuid_string());
    assert_eq!(dc.axis, crate::snapshot::Axis::Col);
    assert_eq!(dc.index, 1);
    assert_dimension_set_size(&result, crate::snapshot::Axis::Col, 1, before);
}

#[test]
fn test_undo_col_widths_batch_restores_all_widths_as_one_action() {
    let snap = simple_snapshot();
    let (mut engine, _) = ComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    let before_col_1 = engine.get_col_width_query(&sid, 1);
    let before_col_2 = engine.get_col_width_query(&sid, 2);
    engine
        .set_col_widths(&sid, &[(1, 145.0), (2, 172.0)])
        .unwrap();

    assert_ne!(engine.get_col_width_query(&sid, 1), before_col_1);
    assert_ne!(engine.get_col_width_query(&sid, 2), before_col_2);

    assert!(engine.can_undo());
    let result = engine.undo().unwrap();

    assert_eq!(engine.get_col_width_query(&sid, 1), before_col_1);
    assert_eq!(engine.get_col_width_query(&sid, 2), before_col_2);
    assert_dimension_set_size(&result, crate::snapshot::Axis::Col, 1, before_col_1);
    assert_dimension_set_size(&result, crate::snapshot::Axis::Col, 2, before_col_2);
    let mut changed_cols: Vec<u32> = result
        .dimension_changes
        .iter()
        .filter(|change| change.axis == crate::snapshot::Axis::Col)
        .map(|change| change.index)
        .collect();
    changed_cols.sort_unstable();
    changed_cols.dedup();
    assert_eq!(
        changed_cols,
        vec![1, 2],
        "undo of batch column widths should surface each restored column",
    );
}

#[test]
fn test_undo_col_widths_chars_batch_restores_all_widths_as_one_action() {
    let snap = simple_snapshot();
    let (mut engine, _) = ComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    let before_col_1 = engine.get_col_width_chars_query(&sid, 1);
    let before_col_2 = engine.get_col_width_chars_query(&sid, 2);
    engine
        .set_col_widths_chars(&sid, &[(1, 17.0), (2, 21.0)])
        .unwrap();

    assert_ne!(engine.get_col_width_chars_query(&sid, 1), before_col_1);
    assert_ne!(engine.get_col_width_chars_query(&sid, 2), before_col_2);

    assert!(engine.can_undo());
    let result = engine.undo().unwrap();

    assert_eq!(engine.get_col_width_chars_query(&sid, 1), before_col_1);
    assert_eq!(engine.get_col_width_chars_query(&sid, 2), before_col_2);
    assert_dimension_set_size(
        &result,
        crate::snapshot::Axis::Col,
        1,
        engine.get_col_width_query(&sid, 1),
    );
    assert_dimension_set_size(
        &result,
        crate::snapshot::Axis::Col,
        2,
        engine.get_col_width_query(&sid, 2),
    );

    let mut changed_cols: Vec<u32> = result
        .dimension_changes
        .iter()
        .filter(|change| change.axis == crate::snapshot::Axis::Col)
        .map(|change| change.index)
        .collect();
    changed_cols.sort_unstable();
    changed_cols.dedup();
    assert_eq!(
        changed_cols,
        vec![1, 2],
        "undo of batch char-width columns should surface each restored column",
    );
}

#[test]
fn test_undo_mixed_mutation_produces_both_cell_and_property_changes() {
    use domain_types::CellFormat;

    let snap = simple_snapshot();
    let (mut engine, _) = ComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();
    engine.begin_undo_group().unwrap();
    engine
        .set_cell(
            &sid,
            cell_id_a1(),
            0,
            0,
            crate::bridge_types::CellInput::Parse { text: "42".into() },
        )
        .unwrap();
    let format = CellFormat {
        bold: Some(true),
        ..Default::default()
    };
    engine
        .set_format_for_ranges(&sid, &[(0, 0, 0, 0)], &format)
        .unwrap();

    engine.end_undo_group().unwrap();
    assert!(engine.can_undo());
    let result = engine.undo().unwrap();
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
    let (mut engine, _) = ComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();
    let format = CellFormat {
        bold: Some(true),
        ..Default::default()
    };
    let _fwd = engine
        .set_format_for_ranges(&sid, &[(0, 0, 0, 0)], &format)
        .unwrap();
    engine.undo().unwrap();
    assert!(engine.can_redo());
    let result = engine.redo().unwrap();

    assert!(
        !result.property_changes.is_empty(),
        "redo of format should produce property_changes",
    );
}

#[test]
fn test_redo_row_height_produces_dimension_changes() {
    let snap = simple_snapshot();
    let (mut engine, _) = ComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();
    engine.set_row_height(&sid, 0, 40.0).unwrap();
    engine.undo().unwrap();
    assert!(engine.can_redo());
    let result = engine.redo().unwrap();

    assert!(
        !result.dimension_changes.is_empty(),
        "redo of row height should produce dimension_changes",
    );
}
