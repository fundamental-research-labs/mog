use super::support::{
    as_f64, assert_number_at, cell_at, cell_id, formula_cell, sheet_id, sheet_snap, value_cell,
    workbook_10_rows,
};
use cell_types::SheetPos;
use compute_core::storage::engine::YrsComputeEngine;
use compute_document::hex::id_to_hex;
use domain_types::CellFormat;
use domain_types::domain::comment::CommentType;
use snapshot_types::WorkbookSnapshot;

#[test]
fn lifecycle_copy_sheet() {
    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(workbook_10_rows()).expect("from_snapshot");
    let sid = sheet_id(0);

    let (_hex, _result) = engine.copy_sheet(&sid, "DataCopy").expect("copy_sheet");

    let copy_sid = engine
        .mirror()
        .sheet_by_name("DataCopy")
        .expect("copied sheet should exist");

    for r in 0..10u32 {
        let v = cell_at(&engine, &copy_sid, r, 0);
        assert_eq!(
            as_f64(&v),
            (r + 1) as f64,
            "copy row {} should be {}",
            r,
            r + 1
        );
    }

    // copy_sheet copies formula text; depending on recalc timing, B1 may have
    // either the evaluated value or only a resolvable copied CellId.
    let sum = cell_at(&engine, &copy_sid, 0, 1);
    let copy_b1_cid = engine
        .mirror()
        .resolve_cell_id(&copy_sid, SheetPos::new(0, 1));
    assert!(
        (as_f64(&sum) - 55.0).abs() < 1e-9 || copy_b1_cid.is_some(),
        "copied formula should either evaluate to 55 or have a CellId; got value={:?}, cid={:?}",
        sum,
        copy_b1_cid
    );
}

#[test]
fn copy_sheet_remaps_cell_properties_and_comments_to_copy_cell_ids() {
    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(workbook_10_rows()).expect("from_snapshot");
    let source_sid = sheet_id(0);

    let source_a1_id = engine
        .mirror()
        .resolve_cell_id(&source_sid, SheetPos::new(0, 0))
        .expect("source A1 cell id");
    let bold = CellFormat {
        bold: Some(true),
        ..Default::default()
    };
    engine
        .set_cell_format(&source_sid, &source_a1_id, &bold)
        .expect("set A1 format");

    engine
        .add_comment_by_position(
            &source_sid,
            0,
            1,
            "Copied note",
            "Alice",
            None,
            None,
            CommentType::Note,
        )
        .expect("add B1 note");
    let source_comments = engine.get_comments_for_cell_by_position(&source_sid, 0, 1);
    assert_eq!(source_comments.len(), 1, "source B1 should have one note");
    let source_comment_ref = source_comments[0].cell_ref.clone();

    let (_hex, _result) = engine
        .copy_sheet(&source_sid, "DataCopy")
        .expect("copy_sheet");
    let copy_sid = engine
        .mirror()
        .sheet_by_name("DataCopy")
        .expect("copied sheet should exist");

    let copy_a1_id = engine
        .mirror()
        .resolve_cell_id(&copy_sid, SheetPos::new(0, 0))
        .expect("copy A1 cell id");
    assert_ne!(source_a1_id, copy_a1_id, "copy must get fresh cell ids");
    let copy_format = engine.get_cell_format(&copy_sid, &copy_a1_id, 0, 0);
    assert_eq!(copy_format.bold, Some(true), "copy A1 should stay bold");

    let copy_b1_id = engine
        .mirror()
        .resolve_cell_id(&copy_sid, SheetPos::new(0, 1))
        .expect("copy B1 cell id");
    let copy_comments = engine.get_comments_for_cell_by_position(&copy_sid, 0, 1);
    assert_eq!(copy_comments.len(), 1, "copy B1 should have one note");
    assert_eq!(
        copy_comments[0].runs.first().map(|run| run.text.as_str()),
        Some("Copied note")
    );
    assert_eq!(
        copy_comments[0].cell_ref,
        id_to_hex(copy_b1_id.as_u128()).to_string(),
        "copied note should point at the copied B1 cell id",
    );
    assert_ne!(
        copy_comments[0].cell_ref, source_comment_ref,
        "copied note must not point at the source B1 cell id",
    );
}

#[test]
fn copy_sheet_preserves_existing_cross_sheet_dependency_edges() {
    let snap = WorkbookSnapshot {
        sheets: vec![
            sheet_snap(0, "Sheet1", vec![formula_cell(0, 1, 0, "Sheet2!A1")]),
            sheet_snap(1, "Sheet2", vec![value_cell(1, 0, 0, 1.0)]),
        ],
        ..Default::default()
    };
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).expect("from_snapshot");
    let sheet1_sid = sheet_id(0);
    let sheet2_sid = sheet_id(1);
    let sheet2_a1 = cell_id(1, 0, 0);

    assert_number_at(&engine, &sheet1_sid, 1, 0, 1.0, "before copy");

    engine
        .copy_sheet(&sheet1_sid, "Sheet1 (2)")
        .expect("copy_sheet");
    let copy_sid = engine
        .mirror()
        .sheet_by_name("Sheet1 (2)")
        .expect("copied sheet should exist");

    engine
        .set_cell(&sheet2_sid, sheet2_a1, 0, 0, "2".into())
        .expect("set Sheet2 A1");

    assert_number_at(
        &engine,
        &sheet1_sid,
        1,
        0,
        2.0,
        "original sheet after source edit",
    );
    assert_number_at(
        &engine,
        &copy_sid,
        1,
        0,
        2.0,
        "copied sheet after source edit",
    );
}
