use std::sync::Arc;

use super::super::ComputeEngine;
use super::helpers::*;
use formula_types::StructureChange;

#[test]
fn formula_workloads_initialize_geometry_and_fonts_only_when_requested() {
    let (mut engine, _) = ComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let sid = sheet_id();
    engine
        .set_cell(&sid, cell_id_a1(), 0, 0, "15".into())
        .unwrap();
    assert_eq!(cell_value_at(&engine, &sid, 1, 0), num(35.0));
    engine.set_row_height(&sid, 5, 30.0).unwrap();
    assert!(engine.stores.pixel_layouts.read().unwrap().is_empty());
    assert!(engine.stores.font_db.get().is_none());

    assert_eq!(engine.get_row_position(&sid, 6), 130.0);
    assert_eq!(engine.stores.pixel_layouts.read().unwrap().len(), 1);
    assert!(engine.stores.font_db.get().is_none());
    let layout = engine.pixel_layout(&sid).unwrap();
    assert!(Arc::ptr_eq(&layout, &engine.pixel_layout(&sid).unwrap()));

    engine.auto_fit_column_and_set(&sid, 0).unwrap();
    assert!(engine.stores.font_db.get().is_some());
    assert!(engine.get_col_width_from_index(&sid, 0) >= 20.0);
    let font_db = engine.stores.font_db.get().unwrap() as *const _;
    let png = engine.capture_screenshot(&sid, 0, 0, 1, 1, 1.0, false, false, None, None);
    assert!(png.starts_with(b"\x89PNG\r\n\x1a\n"));
    assert_eq!(font_db, engine.stores.font_db.get().unwrap() as *const _);
}

#[test]
fn cached_geometry_tracks_resize_visibility_structure_and_history() {
    let (mut engine, _) = ComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let sid = sheet_id();
    let original = engine.pixel_layout(&sid).unwrap();
    engine.set_row_height(&sid, 2, 40.0).unwrap();
    let resized = engine.pixel_layout(&sid).unwrap();
    assert!(!Arc::ptr_eq(&original, &resized));
    assert_eq!(resized.get_row_position(3).0, 80.0);
    engine.hide_rows(&sid, &[2]).unwrap();
    assert_eq!(engine.get_row_position(&sid, 3), 40.0);
    assert_eq!(engine.get_row_at_pixel(&sid, 40.0), 3);
    engine.unhide_rows(&sid, &[2]).unwrap();
    assert_eq!(engine.get_row_position(&sid, 3), 80.0);

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
    assert_eq!(engine.get_row_height_from_index(&sid, 2), 20.0);
    assert_eq!(engine.get_row_height_from_index(&sid, 4), 40.0);
    assert_eq!(engine.get_row_position(&sid, 5), 120.0);
    engine.undo().unwrap();
    assert_eq!(engine.get_row_position(&sid, 3), 80.0);
    engine.redo().unwrap();
    assert_eq!(engine.get_row_position(&sid, 5), 120.0);

    engine.set_col_width(&sid, 2, 100.0).unwrap();
    let width = engine.get_col_width_from_index(&sid, 2);
    let start = engine.get_col_position(&sid, 2);
    assert_eq!(engine.get_col_position(&sid, 3), start + width);
    engine.hide_columns(&sid, &[2]).unwrap();
    assert_eq!(engine.get_col_position(&sid, 3), start);
    assert_eq!(engine.get_col_at_pixel(&sid, start), 3);
    engine.unhide_columns(&sid, &[2]).unwrap();
    assert_eq!(engine.get_col_width_from_index(&sid, 2), width);
}

#[test]
fn cached_geometry_tracks_defaults_and_axis_growth() {
    let (mut engine, _) = ComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let sid = sheet_id();
    let original = engine.pixel_layout(&sid).unwrap();
    engine
        .set_sheet_setting(&sid, "defaultRowHeight", "32")
        .unwrap();
    assert_eq!(engine.get_row_position(&sid, 2), 64.0);
    assert!(!Arc::ptr_eq(&original, &engine.pixel_layout(&sid).unwrap()));
    engine.set_row_height(&sid, 1000, 48.0).unwrap();
    assert!(engine.pixel_layout(&sid).unwrap().row_count() > 1000);
    assert_eq!(engine.get_row_position(&sid, 1001), 32048.0);
    assert_eq!(engine.get_row_at_pixel(&sid, 32032.0), 1000);
}
