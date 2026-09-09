//! Session-only formats survive inverses captured before their application.

use super::super::*;
use super::helpers::*;
use domain_types::CellFormat;

fn bold() -> CellFormat {
    CellFormat {
        bold: Some(true),
        ..Default::default()
    }
}
fn italic() -> CellFormat {
    CellFormat {
        italic: Some(true),
        ..Default::default()
    }
}
fn assert_formats(engine: &ComputeEngine, is_bold: bool) {
    let format = engine.get_displayed_cell_properties(&sheet_id(), 0, 0);
    assert_eq!(format.bold == Some(true), is_bold);
    assert_eq!(format.italic, Some(true));
}

#[test]
fn ui_format_preserves_unrelated_fields_across_undo_and_redo() {
    let (mut engine, _) = ComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    engine
        .set_format_for_ranges(&sheet_id(), &[(0, 0, 0, 1)], &bold())
        .unwrap();
    engine
        .set_format_for_ranges_ui_state(&sheet_id(), &[(0, 0, 0, 0)], &italic())
        .unwrap();
    assert_eq!(engine.get_undo_state().undo_depth, 1);
    for _ in 0..2 {
        engine.undo().unwrap();
        assert_formats(&engine, false);
        assert_ne!(
            engine
                .get_displayed_cell_properties(&sheet_id(), 0, 1)
                .italic,
            Some(true)
        );
        engine.redo().unwrap();
        assert_formats(&engine, true);
    }
}

#[test]
fn ui_format_rebases_redo_and_overlapping_fields_without_clearing_history() {
    let (mut engine, _) = ComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    engine
        .set_format_for_ranges(&sheet_id(), &[(0, 0, 0, 0)], &bold())
        .unwrap();
    engine.undo().unwrap();
    engine
        .set_format_for_ranges_ui_state(
            &sheet_id(),
            &[(0, 0, 0, 0)],
            &CellFormat {
                bold: Some(false),
                italic: Some(true),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(engine.get_undo_state().redo_depth, 1);
    engine.redo().unwrap();
    assert_formats(&engine, false);
    engine.undo().unwrap();
    assert_formats(&engine, false);
}

#[test]
fn ui_format_rebases_open_group_and_active_action_inverses() {
    let (mut engine, _) = ComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    engine.begin_undo_group().unwrap();
    engine
        .set_format_for_ranges(&sheet_id(), &[(0, 0, 0, 0)], &bold())
        .unwrap();
    engine
        .set_format_for_ranges_ui_state(&sheet_id(), &[(0, 0, 0, 0)], &italic())
        .unwrap();
    engine.end_undo_group().unwrap();
    engine.undo().unwrap();
    assert_formats(&engine, false);
    engine.redo().unwrap();
    assert_formats(&engine, true);

    engine.with_history(|engine| {
        engine
            .set_format_for_ranges(
                &sheet_id(),
                &[(0, 0, 0, 0)],
                &CellFormat {
                    number_format: Some("0.00".into()),
                    ..Default::default()
                },
            )
            .unwrap();
        engine
            .set_format_for_ranges_ui_state(
                &sheet_id(),
                &[(0, 0, 0, 0)],
                &CellFormat {
                    font_size: Some(17.0.into()),
                    ..Default::default()
                },
            )
            .unwrap();
    });
    engine.undo().unwrap();
    let format = engine.get_displayed_cell_properties(&sheet_id(), 0, 0);
    assert_eq!(format.font_size, Some(17.0.into()));
    assert_ne!(format.number_format.as_deref(), Some("0.00"));
    engine.redo().unwrap();
    let format = engine.get_displayed_cell_properties(&sheet_id(), 0, 0);
    assert_eq!(format.font_size, Some(17.0.into()));
    assert_eq!(format.number_format.as_deref(), Some("0.00"));
}

#[test]
fn ui_large_overlay_survives_cell_and_range_format_inverses() {
    let (mut engine, _) = ComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    engine
        .set_format_for_ranges(&sheet_id(), &[(0, 0, 99_999, 0)], &bold())
        .unwrap();
    engine
        .set_format_for_ranges(
            &sheet_id(),
            &[(0, 0, 0, 0)],
            &CellFormat {
                number_format: Some("0.00".into()),
                ..Default::default()
            },
        )
        .unwrap();
    engine
        .set_format_for_ranges_ui_state(&sheet_id(), &[(0, 0, 99_999, 0)], &italic())
        .unwrap();
    engine.undo().unwrap();
    assert_formats(&engine, true);
    engine.undo().unwrap();
    assert_formats(&engine, false);
    assert_eq!(
        engine
            .get_displayed_cell_properties(&sheet_id(), 99_999, 0)
            .italic,
        Some(true)
    );
    engine.redo().unwrap();
    engine.redo().unwrap();
    assert_formats(&engine, true);
}
