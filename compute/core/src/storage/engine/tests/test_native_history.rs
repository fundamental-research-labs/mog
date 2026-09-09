//! Native history grouping, failure, sparse storage, and excluded-state regressions.

use super::super::*;
use super::helpers::*;
use domain_types::CellFormat;
use std::sync::Arc;
use value_types::{CellValue, ComputeError};

fn edit(engine: &mut ComputeEngine, cell_id: CellId, col: u32, value: &str) {
    engine
        .set_cell(&sheet_id(), cell_id, 0, col, value.into())
        .unwrap();
}

#[test]
fn nested_groups_keep_first_before_and_last_after_values() {
    let (mut engine, _) = ComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    engine.begin_undo_group().unwrap();
    edit(&mut engine, cell_id_a1(), 0, "100");
    engine.begin_undo_group().unwrap();
    edit(&mut engine, cell_id_b1(), 1, "200");
    edit(&mut engine, cell_id_a1(), 0, "150");
    engine.end_undo_group().unwrap();
    engine
        .set_format_for_ranges(
            &sheet_id(),
            &[(0, 0, 0, 0)],
            &CellFormat {
                bold: Some(true),
                ..Default::default()
            },
        )
        .unwrap();
    engine.end_undo_group().unwrap();

    assert_eq!(engine.get_undo_state().undo_depth, 1);
    assert_eq!(cell_value_at(&engine, &sheet_id(), 1, 0), num(350.0));
    engine.undo().unwrap();
    assert_eq!(cell_value_at(&engine, &sheet_id(), 0, 0), num(10.0));
    assert_eq!(cell_value_at(&engine, &sheet_id(), 0, 1), num(20.0));
    assert_eq!(cell_value_at(&engine, &sheet_id(), 1, 0), num(30.0));
    assert_ne!(
        engine.get_displayed_cell_properties(&sheet_id(), 0, 0).bold,
        Some(true)
    );
    assert!(!engine.can_undo());
    engine.redo().unwrap();
    assert_eq!(cell_value_at(&engine, &sheet_id(), 0, 0), num(150.0));
    assert_eq!(cell_value_at(&engine, &sheet_id(), 0, 1), num(200.0));
    assert_eq!(cell_value_at(&engine, &sheet_id(), 1, 0), num(350.0));
    assert_eq!(
        engine.get_displayed_cell_properties(&sheet_id(), 0, 0).bold,
        Some(true)
    );
    assert_eq!(engine.get_undo_state().undo_depth, 1);
}

#[test]
fn groups_are_isolated_empty_groups_are_noops_and_new_edits_clear_redo() {
    let (mut engine, _) = ComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    engine.end_undo_group().unwrap();
    edit(&mut engine, cell_id_a1(), 0, "11");
    engine.begin_undo_group().unwrap();
    engine.end_undo_group().unwrap();
    assert_eq!(engine.get_undo_state().undo_depth, 1);

    engine.begin_undo_group().unwrap();
    edit(&mut engine, cell_id_b1(), 1, "22");
    edit(&mut engine, cell_id_a1(), 0, "33");
    engine.end_undo_group().unwrap();
    edit(&mut engine, cell_id_b1(), 1, "44");
    assert_eq!(engine.get_undo_state().undo_depth, 3);

    engine.undo().unwrap();
    assert_eq!(cell_value_at(&engine, &sheet_id(), 0, 0), num(33.0));
    assert_eq!(cell_value_at(&engine, &sheet_id(), 0, 1), num(22.0));
    engine.undo().unwrap();
    assert_eq!(cell_value_at(&engine, &sheet_id(), 0, 0), num(11.0));
    assert_eq!(cell_value_at(&engine, &sheet_id(), 0, 1), num(20.0));
    assert_eq!(engine.get_undo_state().redo_depth, 2);

    engine.begin_undo_group().unwrap();
    engine.end_undo_group().unwrap();
    assert_eq!(engine.get_undo_state().redo_depth, 2);
    edit(&mut engine, cell_id_a1(), 0, "55");
    assert_eq!(engine.get_undo_state().undo_depth, 2);
    assert!(!engine.can_redo());
    engine.undo().unwrap();
    assert_eq!(cell_value_at(&engine, &sheet_id(), 0, 0), num(11.0));
}

fn rejected_mixed_sheet_batch(engine: &mut ComputeEngine) {
    let missing = SheetId::from_raw(0xdead_beef);
    assert!(engine.mirror().get_sheet(&missing).is_none());
    assert!(
        engine
            .batch_set_cells_by_position(
                vec![
                    (sheet_id(), 0, 1, "999".into()),
                    (missing, 0, 0, "1".into()),
                ],
                true,
            )
            .is_err()
    );
    assert_eq!(cell_value_at(engine, &sheet_id(), 0, 1), num(20.0));
}

#[test]
fn rejected_batch_inside_an_empty_group_preserves_redo() {
    let (mut engine, _) = ComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    edit(&mut engine, cell_id_a1(), 0, "99");
    engine.undo().unwrap();
    engine.begin_undo_group().unwrap();
    rejected_mixed_sheet_batch(&mut engine);
    engine.end_undo_group().unwrap();
    assert_eq!(engine.get_undo_state().undo_depth, 0);
    assert_eq!(engine.get_undo_state().redo_depth, 1);
    assert_eq!(cell_value_at(&engine, &sheet_id(), 0, 0), num(10.0));
    engine.redo().unwrap();
    assert_eq!(cell_value_at(&engine, &sheet_id(), 0, 0), num(99.0));
}

#[test]
fn rejected_nested_batch_preserves_successful_edits_in_the_outer_group() {
    let (mut engine, _) = ComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    engine.begin_undo_group().unwrap();
    edit(&mut engine, cell_id_a1(), 0, "77");
    rejected_mixed_sheet_batch(&mut engine);
    engine.end_undo_group().unwrap();
    assert_eq!(engine.get_undo_state().undo_depth, 1);
    assert_eq!(cell_value_at(&engine, &sheet_id(), 0, 0), num(77.0));
    engine.undo().unwrap();
    assert_eq!(cell_value_at(&engine, &sheet_id(), 0, 0), num(10.0));
    assert!(!engine.can_undo());
    engine.redo().unwrap();
    assert_eq!(cell_value_at(&engine, &sheet_id(), 0, 0), num(77.0));
    assert_eq!(cell_value_at(&engine, &sheet_id(), 0, 1), num(20.0));
}

#[test]
fn compact_range_undo_redo_preserves_payload_and_virtual_identity() {
    use cell_types::{ColId, PayloadEncoding, RangeAnchor, RangeKind, RowId};
    let mut snapshot = empty_bulk_snapshot();
    let sheet = &mut snapshot.sheets[0];
    sheet.rows = 512;
    sheet.cols = 2;
    let rows: Vec<_> = (1..=512).map(RowId::from_raw).collect();
    let col = ColId::from_raw(513);
    sheet.ranges.push(crate::snapshot::RangeData {
        range_id: cell_types::RangeId::from_raw(0x1234),
        kind: RangeKind::Data,
        anchor: RangeAnchor::Elastic {
            start_row: rows[0],
            end_row: rows[511],
            start_col: col,
            end_col: col,
        },
        encoding: PayloadEncoding::F64Le,
        payload: (1..=512)
            .flat_map(|value| (value as f64).to_le_bytes())
            .collect(),
        row_axis: None,
        col_axis: None,
        row_ids: rows,
        col_ids: vec![col],
    });
    sheet.cells.push(crate::snapshot::CellData {
        cell_id: cell_id_b1().to_uuid_string(),
        row: 0,
        col: 1,
        value: CellValue::Null,
        formula: Some("=SUM(A1:A512)".into()),
        identity_formula: None,
        array_ref: None,
    });
    let (mut engine, _) = ComputeEngine::from_snapshot(snapshot).unwrap();
    let sid = *engine.mirror().sheet_ids().next().unwrap();
    assert!(!engine.can_undo());
    let sheet = engine.mirror().get_sheet(&sid).unwrap();
    let (range_id, range) = sheet.iter_ranges().next().expect("compact numeric column");
    let range_id = *range_id;
    let original_payload = Arc::as_ptr(&range.values);
    let authored_cells = sheet.cells_iter().count();
    let position = SheetPos::new(255, 0);
    let cell_id = engine.mirror().resolve_cell_id(&sid, position).unwrap();
    assert!(cell_id.is_virtual());

    engine
        .set_cell(&sid, cell_id, 255, 0, "999".into())
        .unwrap();
    assert_eq!(engine.get_undo_state().undo_depth, 1);
    for (redo, expected, sum) in [(false, 256.0, 131328.0), (true, 999.0, 132071.0)] {
        if redo {
            engine.redo().unwrap();
        } else {
            engine.undo().unwrap();
        }
        assert_eq!(cell_value_at(&engine, &sid, 255, 0), num(expected));
        assert_eq!(cell_value_at(&engine, &sid, 0, 1), num(sum));
        assert_eq!(
            engine.mirror().resolve_cell_id(&sid, position),
            Some(cell_id)
        );
        let sheet = engine.mirror().get_sheet(&sid).unwrap();
        let range = sheet
            .iter_ranges()
            .find(|(id, _)| **id == range_id)
            .unwrap()
            .1;
        assert!(
            original_payload == Arc::as_ptr(&range.values),
            "history must retain the native compact payload without cloning its values"
        );
        if redo {
            assert_eq!(
                engine.mirror().get_cell_value(&cell_id),
                Some(&num(expected))
            );
            assert_eq!(engine.mirror().resolve_position(&cell_id), Some(position));
        } else {
            assert_eq!(
                sheet.cells_iter().count(),
                authored_cells,
                "undo must remove the authored override without materializing range values"
            );
        }
    }
}

#[test]
fn ui_changes_after_an_edit_survive_undo_and_recalculation() {
    let (mut engine, _) = ComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let sid = sheet_id();
    edit(&mut engine, cell_id_a1(), 0, "99");
    engine.set_scroll_position(&sid, 12, 7).unwrap();
    let selected = vec![sid.to_uuid_string()];
    let mut settings = engine.get_workbook_settings();
    settings.selected_sheet_ids = Some(selected.clone());
    engine.set_workbook_settings(settings).unwrap();
    engine
        .set_custom_setting("mog.activeSheetId", Some(sid.to_uuid_string()))
        .unwrap();
    engine
        .set_format_for_ranges_ui_state(
            &sid,
            &[(2, 1, 2, 1)],
            &CellFormat {
                number_format: Some("0.00".into()),
                ..Default::default()
            },
        )
        .unwrap();

    assert_eq!(engine.get_undo_state().undo_depth, 1);
    engine.undo().unwrap();
    engine.recalculate().unwrap();
    assert_eq!(cell_value_at(&engine, &sid, 0, 0), num(10.0));
    assert_eq!(engine.get_scroll_position_query(&sid).top_row, 12);
    assert_eq!(engine.get_scroll_position_query(&sid).left_col, 7);
    assert_eq!(
        engine.get_workbook_settings().selected_sheet_ids,
        Some(selected)
    );
    assert_eq!(
        engine.get_custom_setting("mog.activeSheetId"),
        Some(sid.to_uuid_string())
    );
    assert_eq!(
        engine
            .get_displayed_cell_properties(&sid, 2, 1)
            .number_format
            .as_deref(),
        Some("0.00")
    );
    assert_eq!(engine.get_undo_state().undo_depth, 0);
    assert_eq!(engine.get_undo_state().redo_depth, 1);
    engine.redo().unwrap();
    assert_eq!(cell_value_at(&engine, &sid, 0, 0), num(99.0));
}

#[test]
fn empty_history_commands_return_empty_successful_mutations() {
    let (mut engine, _) = ComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    for (patches, result) in [engine.undo().unwrap(), engine.redo().unwrap()] {
        assert_eq!(patches.len(), 2);
        assert!(result.recalc.changed_cells.is_empty());
        assert!(result.property_changes.is_empty());
        assert!(result.structure_changes.is_empty());
        assert!(result.sheet_changes.is_empty());
    }
    assert!(!engine.can_undo());
    assert!(!engine.can_redo());
    assert_eq!(cell_value_at(&engine, &sheet_id(), 0, 0), num(10.0));
    assert_eq!(cell_value_at(&engine, &sheet_id(), 1, 0), num(30.0));
}

#[test]
fn mixed_workbook_settings_restore_authored_fields_and_preserve_later_ui_state() {
    let (mut engine, _) = ComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let before = engine.get_workbook_settings();
    let mut authored = before.clone();
    authored.date1904 = true;
    authored.show_formula_bar = false;
    authored.is_workbook_protected = true;
    authored.workbook_protection_password_hash = Some("ABCD".into());
    authored.selected_sheet_ids = Some(vec![sheet_id().to_uuid_string()]);
    engine.set_workbook_settings(authored).unwrap();
    engine
        .patch_workbook_settings(crate::snapshot::RustWorkbookSettingsPatch {
            selected_sheet_ids: Some(Some(Vec::new())),
            ..Default::default()
        })
        .unwrap();
    engine
        .set_custom_setting("session", Some("latest".into()))
        .unwrap();
    assert_eq!(engine.get_undo_state().undo_depth, 1);

    engine.undo().unwrap();
    let restored = engine.get_workbook_settings();
    assert_eq!(restored.date1904, before.date1904);
    assert_eq!(restored.show_formula_bar, before.show_formula_bar);
    assert_eq!(restored.is_workbook_protected, before.is_workbook_protected);
    assert_eq!(
        restored.workbook_protection_password_hash,
        before.workbook_protection_password_hash
    );
    assert_eq!(restored.selected_sheet_ids, Some(Vec::new()));
    assert_eq!(
        engine.get_custom_setting("session").as_deref(),
        Some("latest")
    );
    engine.redo().unwrap();
    let redone = engine.get_workbook_settings();
    assert!(redone.date1904);
    assert!(!redone.show_formula_bar);
    assert!(redone.is_workbook_protected);
    assert_eq!(
        redone.workbook_protection_password_hash.as_deref(),
        Some("ABCD")
    );
    assert_eq!(redone.selected_sheet_ids, Some(Vec::new()));
    assert_eq!(
        engine.get_custom_setting("session").as_deref(),
        Some("latest")
    );
}

#[test]
fn named_range_rename_history_rebuilds_dependent_names_and_formula_references() {
    let (mut engine, _) = ComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    for (name, refers_to) in [
        ("BaseAmount", "=Sheet1!$A$1"),
        ("DoubleAmount", "=BaseAmount*2"),
    ] {
        engine
            .create_named_range(domain_types::DefinedNameInput {
                name: name.into(),
                refers_to: refers_to.into(),
                scope: None,
                comment: None,
            })
            .unwrap();
    }
    engine
        .set_cell_value_parsed(&sheet_id(), 0, 2, "=BaseAmount+DoubleAmount")
        .unwrap();
    let original = engine.get_named_range_by_name("BaseAmount", None).unwrap();
    engine.clear_history();
    engine
        .update_named_range(
            &original.id,
            domain_types::NamedRangeUpdate {
                name: Some("RevenueAmount".into()),
                ..Default::default()
            },
        )
        .unwrap();
    assert!(engine.get_named_range_by_name("BaseAmount", None).is_none());
    assert!(
        engine
            .get_named_range_by_name("RevenueAmount", None)
            .is_some()
    );
    assert_eq!(cell_value_at(&engine, &sheet_id(), 0, 2), num(30.0));
    engine.undo().unwrap();
    assert_eq!(
        engine
            .get_named_range_by_name("BaseAmount", None)
            .unwrap()
            .id,
        original.id
    );
    assert!(
        engine
            .get_named_range_by_name("RevenueAmount", None)
            .is_none()
    );
    assert!(
        engine
            .get_named_range_by_name("DoubleAmount", None)
            .unwrap()
            .refers_to
            .contains("BaseAmount")
    );
    assert_eq!(cell_value_at(&engine, &sheet_id(), 0, 2), num(30.0));
    engine.redo().unwrap();
    assert!(engine.get_named_range_by_name("BaseAmount", None).is_none());
    assert_eq!(
        engine
            .get_named_range_by_name("RevenueAmount", None)
            .unwrap()
            .id,
        original.id
    );
    assert!(
        engine
            .get_named_range_by_name("DoubleAmount", None)
            .unwrap()
            .refers_to
            .contains("RevenueAmount")
    );
    edit(&mut engine, cell_id_a1(), 0, "15");
    assert_eq!(cell_value_at(&engine, &sheet_id(), 0, 2), num(45.0));
}

#[test]
fn whole_workbook_replacement_clears_history_only_after_success() {
    let (mut engine, _) = ComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    edit(&mut engine, cell_id_a1(), 0, "99");
    engine.undo().unwrap();
    assert!(
        engine
            .import_from_xlsx_bytes(b"invalid workbook", false)
            .is_err()
    );
    assert_eq!(engine.get_undo_state().redo_depth, 1);
    assert_eq!(cell_value_at(&engine, &sheet_id(), 0, 0), num(10.0));
    engine.redo().unwrap();
    assert_eq!(cell_value_at(&engine, &sheet_id(), 0, 0), num(99.0));
    engine
        .import_from_csv_bytes_no_recalc(b"7\n8\n", CsvImportOptions::default())
        .unwrap();
    assert!(!engine.can_undo());
    assert!(!engine.can_redo());
    let sid = *engine.mirror().sheet_ids().next().unwrap();
    engine.undo().unwrap();
    assert_eq!(cell_value_at(&engine, &sid, 0, 0), num(7.0));
    assert_eq!(cell_value_at(&engine, &sid, 1, 0), num(8.0));
}

fn queried_value(engine: &ComputeEngine, row: u32, col: u32) -> CellValue {
    engine
        .query_range(&sheet_id(), row, col, row, col)
        .cells
        .into_iter()
        .find(|cell| cell.row == row && cell.col == col)
        .map_or(CellValue::Null, |cell| cell.value)
}

fn assert_sequence_projection(engine: &ComputeEngine, count: u32) {
    for row in 0..5 {
        let expected = if row < count {
            num(f64::from(row + 1))
        } else {
            CellValue::Null
        };
        assert_eq!(
            queried_value(engine, row, 3),
            expected,
            "D{} with {count} spilled rows",
            row + 1
        );
    }
    assert_eq!(
        queried_value(engine, 0, 4),
        num(f64::from(count * (count + 1) / 2))
    );
}

#[test]
fn dynamic_spill_creation_resize_and_clear_history_recalculate_dependents() {
    let (mut engine, _) = ComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    engine.without_history(|engine| {
        engine
            .set_cell_value_parsed(&sheet_id(), 0, 4, "=SUM(D1:D5)")
            .unwrap()
    });
    engine
        .set_cell_value_parsed(&sheet_id(), 0, 3, "=SEQUENCE(3)")
        .unwrap();
    assert_sequence_projection(&engine, 3);
    engine
        .set_cell_value_parsed(&sheet_id(), 0, 3, "=SEQUENCE(5)")
        .unwrap();
    assert_sequence_projection(&engine, 5);
    engine.undo().unwrap();
    assert_sequence_projection(&engine, 3);
    engine.redo().unwrap();
    assert_sequence_projection(&engine, 5);
    engine.clear_range(&sheet_id(), 0, 3, 0, 3).unwrap();
    assert_sequence_projection(&engine, 0);
    engine.undo().unwrap();
    assert_sequence_projection(&engine, 5);
    engine.redo().unwrap();
    assert_sequence_projection(&engine, 0);
    for expected in [5, 3, 0] {
        engine.undo().unwrap();
        assert_sequence_projection(&engine, expected);
    }
    assert!(!engine.can_undo());
    for expected in [3, 5, 0] {
        engine.redo().unwrap();
        assert_sequence_projection(&engine, expected);
    }
    assert!(!engine.can_redo());
}

#[test]
fn cse_creation_and_clear_history_preserve_atomic_region() {
    let (mut engine, _) = ComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    engine.without_history(|engine| {
        engine
            .set_cell_value_parsed(&sheet_id(), 0, 4, "=SUM(D1:D5)")
            .unwrap()
    });
    engine
        .set_array_formula(&sheet_id(), 0, 3, 2, 3, "=SEQUENCE(3)".into())
        .unwrap();
    let anchor = engine
        .mirror()
        .resolve_cell_id(&sheet_id(), SheetPos::new(0, 3))
        .unwrap();
    assert!(engine.mirror().is_cse_anchor(&anchor));
    assert_sequence_projection(&engine, 3);
    assert!(matches!(
        engine.set_cell_value_parsed(&sheet_id(), 1, 3, "99"),
        Err(ComputeError::PartialArrayWrite { .. })
    ));
    assert_eq!(engine.get_undo_state().undo_depth, 1);
    engine.clear_range(&sheet_id(), 0, 3, 2, 3).unwrap();
    assert!(!engine.mirror().is_cse_anchor(&anchor));
    assert_sequence_projection(&engine, 0);
    engine.undo().unwrap();
    assert!(engine.mirror().is_cse_anchor(&anchor));
    assert_sequence_projection(&engine, 3);
    for row in 0..3 {
        assert_eq!(
            engine.query_range(&sheet_id(), row, 3, row, 3).cells[0]
                .formula
                .as_deref(),
            Some("=SEQUENCE(3)")
        );
    }
    assert!(matches!(
        engine.set_cell_value_parsed(&sheet_id(), 1, 3, "99"),
        Err(ComputeError::PartialArrayWrite { .. })
    ));
    assert_eq!(engine.get_undo_state().redo_depth, 1);
    engine.redo().unwrap();
    assert!(!engine.mirror().is_cse_anchor(&anchor));
    assert_sequence_projection(&engine, 0);
    engine.undo().unwrap();
    engine.undo().unwrap();
    assert!(!engine.mirror().is_cse_anchor(&anchor));
    assert_sequence_projection(&engine, 0);
    engine.redo().unwrap();
    assert!(engine.mirror().is_cse_anchor(&anchor));
    assert_sequence_projection(&engine, 3);
}

#[test]
fn invalid_formula_raw_source_survives_undo_and_redo() {
    let (mut engine, _) = ComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    edit(&mut engine, cell_id_a1(), 0, "=1+*");
    assert!(matches!(
        cell_value_at(&engine, &sheet_id(), 0, 0),
        CellValue::Error(..)
    ));
    assert_eq!(engine.compute().get_formula(&cell_id_a1()), Some("=1+*"));
    assert!(matches!(
        cell_value_at(&engine, &sheet_id(), 1, 0),
        CellValue::Error(..)
    ));
    engine.undo().unwrap();
    assert_eq!(cell_value_at(&engine, &sheet_id(), 0, 0), num(10.0));
    assert_eq!(cell_value_at(&engine, &sheet_id(), 1, 0), num(30.0));
    assert_eq!(engine.compute().get_formula(&cell_id_a1()), None);
    engine.redo().unwrap();
    assert!(matches!(
        cell_value_at(&engine, &sheet_id(), 0, 0),
        CellValue::Error(..)
    ));
    assert_eq!(engine.compute().get_formula(&cell_id_a1()), Some("=1+*"));
    assert_eq!(
        engine.query_range(&sheet_id(), 0, 0, 0, 0).cells[0]
            .formula
            .as_deref(),
        Some("=1+*")
    );
    assert!(matches!(
        cell_value_at(&engine, &sheet_id(), 1, 0),
        CellValue::Error(..)
    ));
}

#[test]
fn undo_new_value_preserves_subsequent_untracked_format_on_that_cell() {
    let (mut engine, _) = ComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    engine
        .set_cell_value_parsed(&sheet_id(), 0, 3, "77")
        .unwrap();
    let id = engine
        .mirror()
        .resolve_cell_id(&sheet_id(), SheetPos::new(0, 3))
        .unwrap();
    engine
        .set_format_for_ranges_ui_state(
            &sheet_id(),
            &[(0, 3, 0, 3)],
            &CellFormat {
                bold: Some(true),
                number_format: Some("0.00".into()),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(engine.get_undo_state().undo_depth, 1);
    engine.undo().unwrap();
    assert_eq!(queried_value(&engine, 0, 3), CellValue::Null);
    assert_eq!(
        engine
            .mirror()
            .resolve_cell_id(&sheet_id(), SheetPos::new(0, 3)),
        Some(id)
    );
    let properties = engine.get_displayed_cell_properties(&sheet_id(), 0, 3);
    assert_eq!(properties.bold, Some(true));
    assert_eq!(properties.number_format.as_deref(), Some("0.00"));
    engine.redo().unwrap();
    assert_eq!(queried_value(&engine, 0, 3), num(77.0));
    let properties = engine.get_displayed_cell_properties(&sheet_id(), 0, 3);
    assert_eq!(properties.bold, Some(true));
    assert_eq!(properties.number_format.as_deref(), Some("0.00"));
}

#[test]
fn selected_sheet_import_history_restores_global_additions_and_imported_identities() {
    let sid = sheet_id();
    let (mut source, _) = ComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    source
        .set_format_for_ranges(
            &sid,
            &[(0, 0, 0, 0)],
            &CellFormat {
                bold: Some(true),
                ..Default::default()
            },
        )
        .unwrap();
    source
        .add_comment_by_position(
            &sid,
            2,
            2,
            "Imported thread",
            "Imported author",
            None,
            None,
            domain_types::domain::comment::CommentType::ThreadedComment,
        )
        .unwrap();
    source
        .create_custom_table_style(
            domain_types::domain::custom_table_style::CustomTableStyleConfig {
                id: "history-brand".into(),
                name: "HistoryBrand".into(),
                created_at: 0.0,
                updated_at: 0.0,
                header_row: Default::default(),
                total_row: Default::default(),
                first_column: Default::default(),
                last_column: Default::default(),
                row_stripes: Default::default(),
                column_stripes: Default::default(),
                whole_table: Default::default(),
            },
        )
        .unwrap();
    let name = source.mirror().get_sheet(&sid).unwrap().name.clone();
    let bytes = source.export_to_xlsx_bytes().unwrap();
    let (mut engine, _) = ComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let original_order = engine.stores.storage.metadata.sheet_order.clone();
    let original_palette = engine.stores.storage.metadata.style_palette.clone();
    let original_persons = engine.stores.storage.metadata.persons.clone();
    let original_person_part = engine.stores.storage.metadata.has_persons_part;
    let original_styles = engine.stores.storage.metadata.custom_table_styles.clone();
    let names = engine
        .import_sheets_from_xlsx(&bytes, vec![name], None)
        .unwrap();
    let imported = *engine
        .mirror()
        .sheet_ids()
        .find(|id| engine.mirror().get_sheet(id).unwrap().name == names[0])
        .unwrap();
    let identity = engine
        .mirror()
        .resolve_cell_id(&imported, SheetPos::new(0, 0))
        .unwrap();
    let imported_palette = engine.stores.storage.metadata.style_palette.clone();
    let imported_persons = engine.stores.storage.metadata.persons.clone();
    let imported_styles = engine.stores.storage.metadata.custom_table_styles.clone();
    assert!(imported_palette.len() > original_palette.len());
    assert!(imported_persons.len() > original_persons.len());
    assert!(imported_styles.contains_key("HistoryBrand"));
    assert_eq!(engine.get_undo_state().undo_depth, 1);
    for _ in 0..3 {
        engine.undo().unwrap();
        assert!(engine.mirror().get_sheet(&imported).is_none());
        assert_eq!(engine.stores.storage.metadata.sheet_order, original_order);
        assert_eq!(
            engine.stores.storage.metadata.style_palette,
            original_palette
        );
        assert_eq!(engine.stores.storage.metadata.persons, original_persons);
        assert_eq!(
            engine.stores.storage.metadata.has_persons_part,
            original_person_part
        );
        assert_eq!(
            engine.stores.storage.metadata.custom_table_styles,
            original_styles
        );
        assert_eq!(cell_value_at(&engine, &sid, 0, 0), num(10.0));
        engine.redo().unwrap();
        assert_eq!(
            engine
                .mirror()
                .resolve_cell_id(&imported, SheetPos::new(0, 0)),
            Some(identity)
        );
        assert_eq!(cell_value_at(&engine, &imported, 0, 0), num(10.0));
        assert_eq!(
            engine.get_displayed_cell_properties(&imported, 0, 0).bold,
            Some(true)
        );
        assert_eq!(
            engine
                .get_comments_for_cell_by_position(&imported, 2, 2)
                .len(),
            1
        );
        assert_eq!(
            engine.stores.storage.metadata.style_palette,
            imported_palette
        );
        assert_eq!(engine.stores.storage.metadata.persons, imported_persons);
        assert_eq!(
            engine.stores.storage.metadata.custom_table_styles,
            imported_styles
        );
    }
    let exported = xlsx_api::parse(&engine.export_to_xlsx_bytes().unwrap())
        .unwrap()
        .output;
    assert!(exported.sheets.iter().any(|sheet| sheet.name == names[0]));
    assert!(
        exported
            .persons
            .iter()
            .any(|person| person.display_name == "Imported author")
    );
}
