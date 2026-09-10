//! Native structural inverses preserve identities and one live compact payload.

use super::super::*;
use super::helpers::*;
use crate::snapshot::{CellData, RangeData, SheetSnapshot};
use cell_types::{ColId, PayloadEncoding, RangeAnchor, RangeId, RangeKind, RowId};
use formula_types::StructureChange;
use std::sync::Arc;
use value_types::CellValue;

fn compact_snapshot() -> WorkbookSnapshot {
    let mut snapshot = empty_bulk_snapshot();
    let sheet = &mut snapshot.sheets[0];
    sheet.rows = 512;
    sheet.cols = 2;
    let rows: Vec<_> = (1..=512).map(RowId::from_raw).collect();
    let cols = vec![ColId::from_raw(513), ColId::from_raw(514)];
    sheet.ranges.push(RangeData {
        range_id: RangeId::from_raw(0xabc),
        kind: RangeKind::Data,
        anchor: RangeAnchor::Elastic {
            start_row: rows[0],
            end_row: rows[511],
            start_col: cols[0],
            end_col: cols[1],
        },
        encoding: PayloadEncoding::F64Le,
        payload: (0..512)
            .flat_map(|row| [row as f64, row as f64 + 1000.0])
            .flat_map(f64::to_le_bytes)
            .collect(),
        row_axis: None,
        col_axis: None,
        row_ids: rows,
        col_ids: cols,
    });
    snapshot
}

#[test]
fn partial_range_deletions_restore_slots_and_axis_ids_without_payload_clone() {
    let (mut engine, _) = ComputeEngine::from_snapshot(compact_snapshot()).unwrap();
    let sid = sheet_id();
    let original_rows = engine.stores.grid_indexes[&sid].row_axis();
    let original_cols = engine.stores.grid_indexes[&sid].col_axis();
    let original = engine.cell_store().get_sheet(&sid).unwrap();
    let pointer = Arc::as_ptr(&original.iter_ranges().next().unwrap().1.values);
    let authored = engine.cell_store().iter_sheet_cells(&sid).count();
    let original_identity = engine
        .cell_store()
        .resolve_cell_id(&sid, SheetPos::new(255, 1));
    engine
        .structure_change(
            &sid,
            &StructureChange::DeleteRows {
                at: 255,
                count: 2,
                deleted_cell_ids: vec![],
            },
        )
        .unwrap();
    assert_eq!(cell_value_at(&engine, &sid, 255, 1), num(1257.0));
    engine
        .structure_change(
            &sid,
            &StructureChange::DeleteCols {
                at: 0,
                count: 1,
                deleted_cell_ids: vec![],
            },
        )
        .unwrap();
    assert_eq!(cell_value_at(&engine, &sid, 255, 0), num(1257.0));
    for _ in 0..3 {
        engine.undo().unwrap();
        engine.undo().unwrap();
        assert_eq!(cell_value_at(&engine, &sid, 255, 0), num(255.0));
        assert_eq!(cell_value_at(&engine, &sid, 255, 1), num(1255.0));
        assert_eq!(
            engine
                .cell_store()
                .resolve_cell_id(&sid, SheetPos::new(255, 1)),
            original_identity
        );
        assert_eq!(
            engine.stores.grid_indexes[&sid].row_axis().store(),
            original_rows.store()
        );
        assert_eq!(
            engine.stores.grid_indexes[&sid].col_axis().store(),
            original_cols.store()
        );
        let sheet = engine.cell_store().get_sheet(&sid).unwrap();
        assert_eq!(engine.cell_store().iter_sheet_cells(&sheet.id).count(), authored);
        assert_eq!(
            Arc::as_ptr(&sheet.iter_ranges().next().unwrap().1.values),
            pointer
        );
        engine.redo().unwrap();
        engine.redo().unwrap();
        assert_eq!(cell_value_at(&engine, &sid, 255, 0), num(1257.0));
        assert_eq!(
            Arc::as_ptr(
                &engine
                    .cell_store()
                    .get_sheet(&sid)
                    .unwrap()
                    .iter_ranges()
                    .next()
                    .unwrap()
                    .1
                    .values
            ),
            pointer
        );
    }
}

#[test]
fn fully_deleted_range_returns_with_original_payload_and_no_materialized_cells() {
    let (mut engine, _) = ComputeEngine::from_snapshot(compact_snapshot()).unwrap();
    let sid = sheet_id();
    let pointer = Arc::as_ptr(
        &engine
            .cell_store()
            .get_sheet(&sid)
            .unwrap()
            .iter_ranges()
            .next()
            .unwrap()
            .1
            .values,
    );
    engine
        .structure_change(
            &sid,
            &StructureChange::DeleteRows {
                at: 0,
                count: 512,
                deleted_cell_ids: vec![],
            },
        )
        .unwrap();
    assert_eq!(
        engine
            .cell_store()
            .get_sheet(&sid)
            .unwrap()
            .iter_ranges()
            .count(),
        0
    );
    for _ in 0..3 {
        engine.undo().unwrap();
        let sheet = engine.cell_store().get_sheet(&sid).unwrap();
        assert_eq!(
            Arc::as_ptr(&sheet.iter_ranges().next().unwrap().1.values),
            pointer
        );
        assert_eq!(engine.cell_store().iter_sheet_cells(&sheet.id).count(), 0);
        assert_eq!(cell_value_at(&engine, &sid, 511, 1), num(1511.0));
        engine.redo().unwrap();
        assert_eq!(
            engine
                .cell_store()
                .get_sheet(&sid)
                .unwrap()
                .iter_ranges()
                .count(),
            0
        );
    }
}

#[test]
fn deleted_rows_restore_cross_sheet_reanchors_and_never_rewind_allocator() {
    let mut snapshot = simple_snapshot();
    snapshot.sheets[0].cells = (0..3)
        .map(|row| CellData {
            cell_id: CellId::from_raw(0x500 + row as u128).to_uuid_string(),
            row,
            col: 0,
            value: num((row + 1) as f64 * 10.0),
            formula: None,
            identity_formula: None,
            array_ref: None,
        })
        .collect();
    let other = SheetId::from_raw(0x9876);
    let formula_id = CellId::from_raw(0x9999);
    snapshot.sheets.push(SheetSnapshot {
        id: other.to_uuid_string(),
        name: "Summary".into(),
        rows: 10,
        cols: 2,
        row_axis: None,
        col_axis: None,
        identities: vec![],
        ranges: vec![],
        cells: vec![CellData {
            cell_id: formula_id.to_uuid_string(),
            row: 0,
            col: 0,
            value: CellValue::Null,
            formula: Some("=SUM(Sheet1!A1:A3)".into()),
            identity_formula: None,
            array_ref: None,
        }],
    });
    let (mut engine, _) = ComputeEngine::from_snapshot(snapshot).unwrap();
    let original = engine
        .cell_store()
        .get_formula(&formula_id)
        .cloned()
        .unwrap();
    let first = engine
        .cell_store()
        .resolve_cell_id(&sheet_id(), SheetPos::new(0, 0));
    engine
        .structure_change(
            &sheet_id(),
            &StructureChange::DeleteRows {
                at: 0,
                count: 1,
                deleted_cell_ids: vec![],
            },
        )
        .unwrap();
    assert_eq!(cell_value_at(&engine, &other, 0, 0), num(50.0));
    let water = engine.stores.grid_id_alloc.high_water_mark();
    let axes_water = engine.stores.grid_id_alloc.axis_run_high_water_mark();
    for _ in 0..3 {
        let result = engine.undo().unwrap();
        assert!(!result.structure_changes.is_empty());
        assert_eq!(cell_value_at(&engine, &other, 0, 0), num(60.0));
        assert_eq!(
            engine.cell_store().get_formula(&formula_id),
            Some(&original)
        );
        assert_eq!(
            engine
                .cell_store()
                .resolve_cell_id(&sheet_id(), SheetPos::new(0, 0)),
            first
        );
        engine.redo().unwrap();
        assert_eq!(cell_value_at(&engine, &other, 0, 0), num(50.0));
        assert!(engine.stores.grid_id_alloc.high_water_mark() >= water);
        assert!(engine.stores.grid_id_alloc.axis_run_high_water_mark() >= axes_water);
    }
}

#[test]
fn group_interleaving_cells_and_axes_restores_each_position_stage() {
    let (mut engine, _) = ComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    engine.begin_undo_group().unwrap();
    engine
        .set_cell(&sheet_id(), cell_id_a1(), 0, 0, "12".into())
        .unwrap();
    engine
        .structure_change(
            &sheet_id(),
            &StructureChange::InsertRows {
                at: 0,
                count: 2,
                new_row_ids: vec![],
            },
        )
        .unwrap();
    engine
        .set_cell(&sheet_id(), cell_id_a1(), 2, 0, "14".into())
        .unwrap();
    engine
        .structure_change(
            &sheet_id(),
            &StructureChange::DeleteCols {
                at: 1,
                count: 1,
                deleted_cell_ids: vec![],
            },
        )
        .unwrap();
    engine.end_undo_group().unwrap();
    let axis_water = engine.stores.grid_id_alloc.axis_run_high_water_mark();
    for _ in 0..3 {
        engine.undo().unwrap();
        assert_eq!(cell_value_at(&engine, &sheet_id(), 0, 0), num(10.0));
        assert_eq!(cell_value_at(&engine, &sheet_id(), 0, 1), num(20.0));
        assert_eq!(cell_value_at(&engine, &sheet_id(), 1, 0), num(30.0));
        engine.redo().unwrap();
        assert_eq!(cell_value_at(&engine, &sheet_id(), 2, 0), num(14.0));
        assert_eq!(
            engine
                .cell_store()
                .resolve_cell_id(&sheet_id(), SheetPos::new(2, 0)),
            Some(cell_id_a1())
        );
        assert!(engine.stores.grid_id_alloc.axis_run_high_water_mark() >= axis_water);
    }
}

#[test]
fn copied_and_deleted_sheet_history_preserves_identity_metadata_and_raw_formulas() {
    let (mut engine, _) = ComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    engine
        .stores
        .storage
        .sheet_metadata
        .get_mut(&sheet_id())
        .unwrap()
        .custom_properties = Some("native metadata".into());
    engine.stores.storage.cell_metadata.insert(
        cell_id_a1(),
        crate::storage::CellMetadata {
            array_ref: Some("A1:A2".into()),
            ..Default::default()
        },
    );
    let (copied, _) = engine.copy_sheet(&sheet_id(), "Copy").unwrap();
    let copied = SheetId::from_raw(compute_document::hex::hex_to_id(&copied).unwrap());
    let cell = engine
        .cell_store()
        .resolve_cell_id(&copied, SheetPos::new(0, 0))
        .unwrap();
    let axis = engine.stores.grid_indexes[&copied].row_axis();
    engine.undo().unwrap();
    assert!(engine.cell_store().get_sheet(&copied).is_none());
    assert!(!engine.stores.storage.cell_metadata.contains_key(&cell));
    let result = engine.redo().unwrap();
    assert!(
        result
            .sheet_changes
            .iter()
            .any(|change| change.sheet_id == copied.to_uuid_string())
    );
    assert_eq!(
        engine
            .cell_store()
            .resolve_cell_id(&copied, SheetPos::new(0, 0)),
        Some(cell)
    );
    assert_eq!(
        engine.stores.grid_indexes[&copied].row_axis().store(),
        axis.store()
    );
    assert_eq!(
        engine.stores.storage.cell_metadata[&cell]
            .array_ref
            .as_deref(),
        Some("A1:A2")
    );
    assert_eq!(
        engine.stores.storage.sheet_metadata[&copied]
            .custom_properties
            .as_deref(),
        Some("native metadata")
    );
    engine.delete_sheet(&copied).unwrap();
    assert!(!engine.stores.storage.cell_metadata.contains_key(&cell));
    engine.undo().unwrap();
    assert_eq!(cell_value_at(&engine, &copied, 1, 0), num(30.0));
    assert_eq!(
        engine.stores.storage.cell_metadata[&cell]
            .array_ref
            .as_deref(),
        Some("A1:A2")
    );
    engine.redo().unwrap();
    assert!(engine.cell_store().get_sheet(&copied).is_none());
}

#[test]
fn compact_sort_undo_redo_keeps_payload_and_row_identity_order() {
    let (mut engine, _) = ComputeEngine::from_snapshot(compact_snapshot()).unwrap();
    let sid = sheet_id();
    let original_axis = engine.stores.grid_indexes[&sid].row_axis();
    let pointer = Arc::as_ptr(
        &engine
            .cell_store()
            .get_sheet(&sid)
            .unwrap()
            .iter_ranges()
            .next()
            .unwrap()
            .1
            .values,
    );
    let first = engine
        .cell_store()
        .resolve_cell_id(&sid, SheetPos::new(0, 0));
    engine
        .sort_range(
            &sid,
            0,
            0,
            511,
            1,
            crate::storage::engine::mutation::BridgeSortOptions {
                criteria: vec![crate::storage::engine::mutation::BridgeSortCriterion {
                    column: 0,
                    direction: domain_types::domain::filter::SortOrder::Desc,
                    case_sensitive: false,
                    mode: crate::storage::engine::mutation::BridgeSortMode::Value {
                        custom_list: None,
                    },
                }],
                has_headers: false,
                visible_rows_only: false,
            },
        )
        .unwrap();
    assert_eq!(cell_value_at(&engine, &sid, 0, 0), num(511.0));
    for _ in 0..3 {
        engine.undo().unwrap();
        assert_eq!(cell_value_at(&engine, &sid, 0, 0), num(0.0));
        assert_eq!(
            engine.stores.grid_indexes[&sid].row_axis().store(),
            original_axis.store()
        );
        assert_eq!(
            engine
                .cell_store()
                .resolve_cell_id(&sid, SheetPos::new(0, 0)),
            first
        );
        engine.redo().unwrap();
        assert_eq!(cell_value_at(&engine, &sid, 0, 0), num(511.0));
        assert_eq!(
            engine
                .cell_store()
                .resolve_cell_id(&sid, SheetPos::new(511, 0)),
            first
        );
        let sheet = engine.cell_store().get_sheet(&sid).unwrap();
        assert_eq!(engine.cell_store().iter_sheet_cells(&sheet.id).count(), 0);
        assert_eq!(
            Arc::as_ptr(&sheet.iter_ranges().next().unwrap().1.values),
            pointer
        );
    }
}

#[test]
fn overlapping_relocation_replays_all_mappings_together() {
    let mut snapshot = simple_snapshot();
    snapshot.sheets[0].cells = (0..4)
        .map(|row| CellData {
            cell_id: CellId::from_raw(0x800 + row as u128).to_uuid_string(),
            row,
            col: 0,
            value: num((row + 1) as f64),
            formula: match row {
                1 => Some("=A1+1".into()),
                2 => Some("=A2+1".into()),
                _ => None,
            },
            identity_formula: None,
            array_ref: None,
        })
        .collect();
    let (mut engine, _) = ComputeEngine::from_snapshot(snapshot).unwrap();
    let sid = sheet_id();
    let ids: Vec<_> = (0..4)
        .map(|row| {
            engine
                .cell_store()
                .resolve_cell_id(&sid, SheetPos::new(row, 0))
                .unwrap()
        })
        .collect();
    engine.relocate_cells(&sid, 0, 0, 2, 0, &sid, 1, 0).unwrap();
    assert_eq!(cell_value_at(&engine, &sid, 0, 0), CellValue::Null);
    for _ in 0..3 {
        let result = engine.undo().unwrap();
        for row in 0..4 {
            assert_eq!(cell_value_at(&engine, &sid, row, 0), num((row + 1) as f64));
            assert_eq!(
                engine
                    .cell_store()
                    .get_sheet(&sid)
                    .unwrap()
                    .cell_id_at(cell_types::SheetPos::new(row, 0)),
                Some(ids[row as usize])
            );
        }
        assert!(result.recalc.changed_cells.iter().any(|change| {
            change
                .position
                .as_ref()
                .is_some_and(|p| p.row == 0 && p.col == 0)
        }));
        assert_eq!(engine.get_formula(&ids[1]).as_deref(), Some("=A1+1"));
        assert_eq!(engine.get_formula(&ids[2]).as_deref(), Some("=A2+1"));
        engine.redo().unwrap();
        assert_eq!(engine.get_formula(&ids[1]).as_deref(), Some("=A2+1"));
        assert_eq!(engine.get_formula(&ids[2]).as_deref(), Some("=A3+1"));
        assert_eq!(
            engine
                .cell_store()
                .get_sheet(&sid)
                .unwrap()
                .cell_position(&ids[3]),
            None
        );
        assert_eq!(cell_value_at(&engine, &sid, 0, 0), CellValue::Null);
        for row in 1..4 {
            assert_eq!(cell_value_at(&engine, &sid, row, 0), num(row as f64));
            assert_eq!(
                engine
                    .cell_store()
                    .get_sheet(&sid)
                    .unwrap()
                    .cell_id_at(cell_types::SheetPos::new(row, 0)),
                Some(ids[row as usize - 1])
            );
        }
    }
}

#[test]
fn cross_sheet_relocation_restores_formula_owner_target_value_and_growth() {
    let mut snapshot = simple_snapshot();
    let other = SheetId::from_raw(0x7987);
    let displaced = CellId::from_raw(0x7899);
    snapshot.sheets.push(SheetSnapshot {
        id: other.to_uuid_string(),
        name: "Destination".into(),
        rows: 3,
        cols: 2,
        identities: vec![],
        row_axis: None,
        col_axis: None,
        ranges: vec![],
        cells: vec![CellData {
            cell_id: displaced.to_uuid_string(),
            row: 2,
            col: 0,
            value: num(99.0),
            formula: None,
            identity_formula: None,
            array_ref: None,
        }],
    });
    let (mut engine, _) = ComputeEngine::from_snapshot(snapshot).unwrap();
    engine
        .relocate_cells(&sheet_id(), 0, 0, 1, 1, &other, 2, 0)
        .unwrap();
    assert_eq!(cell_value_at(&engine, &other, 3, 0), num(30.0));
    for _ in 0..3 {
        let result = engine.undo().unwrap();
        assert_eq!(
            engine.cell_store().sheet_for_cell(&cell_id_a2()),
            Some(sheet_id())
        );
        assert_eq!(cell_value_at(&engine, &sheet_id(), 1, 0), num(30.0));
        assert_eq!(cell_value_at(&engine, &other, 2, 0), num(99.0));
        assert_eq!(engine.stores.grid_indexes[&other].row_count(), 3);
        assert!(
            result
                .recalc
                .changed_cells
                .iter()
                .any(|change| change.sheet_id == other.to_uuid_string())
        );
        engine.redo().unwrap();
        assert_eq!(
            engine.cell_store().sheet_for_cell(&cell_id_a2()),
            Some(other)
        );
        assert_eq!(cell_value_at(&engine, &other, 3, 0), num(30.0));
        assert_eq!(cell_value_at(&engine, &sheet_id(), 0, 0), CellValue::Null);
        assert_eq!(
            engine
                .cell_store()
                .get_sheet(&other)
                .unwrap()
                .cell_id_at(cell_types::SheetPos::new(2, 0)),
            Some(cell_id_a1())
        );
    }
}

#[test]
fn relocation_to_compact_destination_restores_only_consumed_payload_slots() {
    let mut snapshot = compact_snapshot();
    let target = sheet_id();
    let source = SheetId::from_raw(0xabc123);
    let id = CellId::from_raw(0xabc124);
    snapshot.sheets.push(SheetSnapshot {
        id: source.to_uuid_string(),
        name: "Authored".into(),
        rows: 3,
        cols: 2,
        identities: vec![],
        row_axis: None,
        col_axis: None,
        ranges: vec![],
        cells: vec![CellData {
            cell_id: id.to_uuid_string(),
            row: 0,
            col: 0,
            value: num(42.0),
            formula: None,
            identity_formula: None,
            array_ref: None,
        }],
    });
    let (mut engine, _) = ComputeEngine::from_snapshot(snapshot).unwrap();
    let pointer = Arc::as_ptr(
        &engine
            .cell_store()
            .get_sheet(&target)
            .unwrap()
            .iter_ranges()
            .next()
            .unwrap()
            .1
            .values,
    );
    engine
        .relocate_cells(&source, 0, 0, 0, 0, &target, 255, 1)
        .unwrap();
    assert_eq!(cell_value_at(&engine, &target, 255, 1), num(42.0));
    for _ in 0..3 {
        engine.undo().unwrap();
        assert_eq!(cell_value_at(&engine, &source, 0, 0), num(42.0));
        assert_eq!(cell_value_at(&engine, &target, 255, 1), num(1255.0));
        engine.redo().unwrap();
        assert_eq!(cell_value_at(&engine, &source, 0, 0), CellValue::Null);
        assert_eq!(cell_value_at(&engine, &target, 255, 1), num(42.0));
        assert_eq!(
            Arc::as_ptr(
                &engine
                    .cell_store()
                    .get_sheet(&target)
                    .unwrap()
                    .iter_ranges()
                    .next()
                    .unwrap()
                    .1
                    .values
            ),
            pointer
        );
    }
}

#[test]
fn undo_implicit_growth_preserves_later_ui_format_axis_identities() {
    let mut snapshot = empty_bulk_snapshot();
    snapshot.sheets[0].rows = 2;
    snapshot.sheets[0].cols = 2;
    let (mut engine, _) = ComputeEngine::from_snapshot(snapshot).unwrap();
    let sid = sheet_id();
    engine
        .batch_set_cells_by_position(vec![(sid, 250, 80, "11".into())], true)
        .unwrap();
    let id = engine
        .cell_store()
        .resolve_cell_id(&sid, SheetPos::new(250, 80))
        .unwrap();
    engine
        .set_format_for_ranges_ui_state(
            &sid,
            &[(250, 80, 250, 80)],
            &domain_types::CellFormat {
                bold: Some(true),
                ..Default::default()
            },
        )
        .unwrap();
    engine
        .set_format_for_ranges_ui_state(
            &sid,
            &[(300, 90, 300, 90)],
            &domain_types::CellFormat {
                italic: Some(true),
                ..Default::default()
            },
        )
        .unwrap();
    let far = engine
        .cell_store()
        .resolve_cell_id(&sid, SheetPos::new(300, 90))
        .unwrap();
    let row_id = engine.stores.grid_indexes[&sid].row_id(300);
    let col_id = engine.stores.grid_indexes[&sid].col_id(90);
    for _ in 0..3 {
        engine.undo().unwrap();
        assert_eq!(cell_value_at(&engine, &sid, 250, 80), CellValue::Null);
        assert_eq!(
            engine
                .cell_store()
                .resolve_cell_id(&sid, SheetPos::new(250, 80)),
            Some(id)
        );
        assert_eq!(
            engine
                .cell_store()
                .resolve_cell_id(&sid, SheetPos::new(300, 90)),
            Some(far)
        );
        assert_eq!(engine.stores.grid_indexes[&sid].row_id(300), row_id);
        assert_eq!(engine.stores.grid_indexes[&sid].col_id(90), col_id);
        assert_eq!(
            engine.get_displayed_cell_properties(&sid, 250, 80).bold,
            Some(true)
        );
        assert_eq!(
            engine.get_displayed_cell_properties(&sid, 300, 90).italic,
            Some(true)
        );
        engine.redo().unwrap();
        assert_eq!(cell_value_at(&engine, &sid, 250, 80), num(11.0));
    }
}

#[test]
fn untracked_identity_helpers_keep_redo_and_survive_extent_undo() {
    let (mut engine, _) = ComputeEngine::from_snapshot(empty_bulk_snapshot()).unwrap();
    let sid = sheet_id();
    engine
        .batch_set_cells_by_position(vec![(sid, 10, 0, "11".into())], true)
        .unwrap();
    engine.get_or_create_cell_id(&sid, 200, 0).unwrap();
    let id = engine
        .cell_store()
        .get_sheet(&sid)
        .unwrap()
        .cell_id_at(cell_types::SheetPos::new(200, 0))
        .unwrap();
    let axis = engine.stores.grid_indexes[&sid].row_id(200);
    engine.undo().unwrap();
    assert_eq!(engine.stores.grid_indexes[&sid].row_id(200), axis);
    assert_eq!(
        engine
            .cell_store()
            .resolve_cell_id(&sid, SheetPos::new(200, 0)),
        Some(id)
    );
    let state = engine.get_undo_state();
    engine
        .update_cell_position(
            &sid,
            &compute_document::hex::id_to_hex(id.as_u128()),
            300,
            0,
        )
        .unwrap();
    assert_eq!(engine.get_undo_state(), state);
    let axis = engine.stores.grid_indexes[&sid].row_id(300);
    engine.redo().unwrap();
    assert_eq!(
        engine
            .cell_store()
            .resolve_cell_id(&sid, SheetPos::new(300, 0)),
        Some(id)
    );
    assert_eq!(engine.stores.grid_indexes[&sid].row_id(300), axis);
    assert_eq!(cell_value_at(&engine, &sid, 10, 0), num(11.0));
}

#[test]
fn blank_comment_anchor_keeps_identity_through_structure_and_history() {
    let (mut engine, _) = ComputeEngine::from_snapshot(empty_bulk_snapshot()).unwrap();
    let sid = sheet_id();
    engine
        .add_comment_by_position(
            &sid,
            2,
            2,
            "Retain this anchor",
            "Author",
            None,
            None,
            domain_types::domain::comment::CommentType::ThreadedComment,
        )
        .unwrap();
    let anchor = engine
        .cell_store()
        .get_sheet(&sid)
        .unwrap()
        .cell_id_at(SheetPos::new(2, 2))
        .unwrap();
    assert!(
        engine
            .cell_store()
            .get_cell_entry(&anchor)
            .is_none()
    );

    engine
        .structure_change(
            &sid,
            &StructureChange::InsertRows {
                at: 1,
                count: 2,
                new_row_ids: vec![],
            },
        )
        .unwrap();
    assert_eq!(
        engine
            .cell_store()
            .get_sheet(&sid)
            .unwrap()
            .cell_position(&anchor),
        Some((4, 2))
    );
    assert_eq!(
        engine.get_comments_for_cell_by_position(&sid, 4, 2).len(),
        1
    );

    engine
        .structure_change(
            &sid,
            &StructureChange::DeleteRows {
                at: 4,
                count: 1,
                deleted_cell_ids: vec![],
            },
        )
        .unwrap();
    assert!(
        engine
            .cell_store()
            .get_sheet(&sid)
            .unwrap()
            .cell_position(&anchor)
            .is_none()
    );
    assert!(
        engine
            .get_comments_for_cell_by_position(&sid, 4, 2)
            .is_empty()
    );

    for _ in 0..2 {
        engine.undo().unwrap();
        assert_eq!(
            engine
                .cell_store()
                .get_sheet(&sid)
                .unwrap()
                .cell_position(&anchor),
            Some((4, 2))
        );
        assert_eq!(
            engine.get_comments_for_cell_by_position(&sid, 4, 2).len(),
            1
        );
        assert!(
            engine
                .cell_store()
                .get_cell_entry(&anchor)
                .is_none()
        );
        engine.redo().unwrap();
        assert!(
            engine
                .cell_store()
                .get_sheet(&sid)
                .unwrap()
                .cell_position(&anchor)
                .is_none()
        );
    }
    engine.undo().unwrap();
    engine.undo().unwrap();
    assert_eq!(
        engine
            .cell_store()
            .get_sheet(&sid)
            .unwrap()
            .cell_position(&anchor),
        Some((2, 2))
    );
    assert_eq!(
        engine.get_comments_for_cell_by_position(&sid, 2, 2).len(),
        1
    );
    assert!(
        engine
            .cell_store()
            .get_cell_entry(&anchor)
            .is_none()
    );
}
