//! Nested border-patch mutation contracts.

use super::super::*;
use super::helpers::*;
use crate::bridge_types::{BorderPatchField, BorderPatchOperation, BorderPatchTarget};
use domain_types::{CellBorderSide, CellBorders, CellFormat};
use ooxml_types::styles::BorderStyle;

fn thin_border() -> CellBorderSide {
    CellBorderSide {
        style: Some(BorderStyle::Thin),
        color: Some("#000000".to_string()),
        ..Default::default()
    }
}

fn cell_target(row: u32, col: u32) -> BorderPatchTarget {
    BorderPatchTarget::Cells {
        start_row: row,
        start_col: col,
        end_row: row,
        end_col: col,
    }
}

#[test]
fn patch_borders_composes_edges_preserves_other_format_and_undoes_atomically() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let sid = sheet_id();
    let thin = thin_border();

    engine
        .patch_format_for_ranges(
            &sid,
            &[(0, 0, 0, 0)],
            &CellFormat {
                bold: Some(true),
                borders: Some(CellBorders {
                    top: Some(thin.clone()),
                    diagonal: Some(thin.clone()),
                    diagonal_up: Some(true),
                    diagonal_down: Some(false),
                    ..Default::default()
                }),
                ..Default::default()
            },
            &[],
        )
        .unwrap();

    engine
        .patch_borders(
            &sid,
            vec![
                BorderPatchOperation {
                    target: cell_target(0, 0),
                    borders: CellBorders {
                        bottom: Some(thin.clone()),
                        ..Default::default()
                    },
                    clear_fields: vec![],
                },
                BorderPatchOperation {
                    target: cell_target(0, 0),
                    borders: CellBorders {
                        right: Some(thin.clone()),
                        ..Default::default()
                    },
                    clear_fields: vec![],
                },
            ],
        )
        .unwrap();

    let cell_id =
        crate::storage::engine::services::cell_editing::find_cell_id_at(&engine.stores, &sid, 0, 0)
            .unwrap();
    let patched = engine.get_cell_format(&sid, &cell_id, 0, 0);
    let borders = patched.borders.unwrap();
    assert_eq!(patched.bold, Some(true));
    assert_eq!(borders.top, Some(thin.clone()));
    assert_eq!(borders.right, Some(thin.clone()));
    assert_eq!(borders.bottom, Some(thin.clone()));
    assert_eq!(borders.diagonal, Some(thin.clone()));
    assert_eq!(borders.diagonal_up, Some(true));
    assert_eq!(borders.diagonal_down, Some(false));

    engine.undo().unwrap();
    let undone = engine.get_cell_format(&sid, &cell_id, 0, 0);
    let undone_borders = undone.borders.unwrap();
    assert_eq!(undone.bold, Some(true));
    assert_eq!(undone_borders.top, Some(thin.clone()));
    assert!(undone_borders.right.is_none());
    assert!(undone_borders.bottom.is_none());

    engine.redo().unwrap();
    let redone = engine.get_cell_format(&sid, &cell_id, 0, 0);
    assert_eq!(redone.borders.unwrap().right, Some(thin.clone()));

    engine
        .patch_borders(
            &sid,
            vec![BorderPatchOperation {
                target: cell_target(0, 0),
                borders: CellBorders::default(),
                clear_fields: vec![BorderPatchField::Top],
            }],
        )
        .unwrap();
    let cleared = engine.get_cell_format(&sid, &cell_id, 0, 0);
    let cleared_borders = cleared.borders.unwrap();
    assert!(cleared_borders.top.is_none());
    assert_eq!(cleared_borders.right, Some(thin));
    assert_eq!(cleared.bold, Some(true));
}

#[test]
fn patch_borders_has_matching_row_and_column_layer_semantics() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let sid = sheet_id();
    let thin = thin_border();

    engine
        .patch_borders(
            &sid,
            vec![
                BorderPatchOperation {
                    target: BorderPatchTarget::Row { row: 3 },
                    borders: CellBorders {
                        top: Some(thin.clone()),
                        ..Default::default()
                    },
                    clear_fields: vec![],
                },
                BorderPatchOperation {
                    target: BorderPatchTarget::Column { col: 4 },
                    borders: CellBorders {
                        right: Some(thin.clone()),
                        ..Default::default()
                    },
                    clear_fields: vec![],
                },
            ],
        )
        .unwrap();

    assert_eq!(
        engine.get_resolved_format(&sid, 3, 0).borders.unwrap().top,
        Some(thin.clone())
    );
    assert_eq!(
        engine
            .get_resolved_format(&sid, 0, 4)
            .borders
            .unwrap()
            .right,
        Some(thin)
    );
}

#[test]
fn patch_borders_validates_the_complete_batch_before_writing() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let sid = sheet_id();
    let thin = thin_border();

    let error = engine
        .patch_borders(
            &sid,
            vec![
                BorderPatchOperation {
                    target: cell_target(0, 0),
                    borders: CellBorders {
                        bottom: Some(thin.clone()),
                        ..Default::default()
                    },
                    clear_fields: vec![],
                },
                BorderPatchOperation {
                    target: cell_target(0, 1),
                    borders: CellBorders {
                        top: Some(thin),
                        ..Default::default()
                    },
                    clear_fields: vec![BorderPatchField::Top],
                },
            ],
        )
        .expect_err("conflicting tri-state input must reject the entire command");

    assert!(error.to_string().contains("both set and clear top"));
    assert!(
        engine
            .get_resolved_format(&sid, 0, 0)
            .borders
            .and_then(|borders| borders.bottom)
            .is_none()
    );
}
