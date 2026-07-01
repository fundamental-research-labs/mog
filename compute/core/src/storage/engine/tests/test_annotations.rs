//! Annotation mutation contract tests.

use super::super::*;
use super::helpers::*;
use crate::engine_types::{
    AnnotationDeleteResult, AnnotationFingerprintProfile, AnnotationRecord, AnnotationStatus,
};

#[test]
fn blank_cell_annotation_roundtrips_and_removes() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let sid = sheet_id();

    let (_patches, result) = engine
        .set_cell_annotation_by_position(&sid, 5, 5, "Check blank cell")
        .expect("set cell annotation");
    let created = result
        .extract_data::<AnnotationRecord>()
        .expect("record returned in mutation result");

    assert_eq!(created.text, "Check blank cell");
    assert_eq!(created.status, AnnotationStatus::Fresh);
    assert_eq!(
        created.fingerprint.profile,
        AnnotationFingerprintProfile::CellBlank
    );

    let record = engine
        .get_cell_annotation_by_position(&sid, 5, 5)
        .expect("get cell annotation")
        .expect("annotation should exist");
    assert_eq!(record.id, created.id);
    assert_eq!(record.status, AnnotationStatus::Fresh);
    assert_eq!(engine.list_cell_annotations(&sid).unwrap().len(), 1);

    let (_patches, result) = engine
        .remove_cell_annotation_by_position(&sid, 5, 5)
        .expect("remove cell annotation");
    let deleted = result
        .extract_data::<AnnotationDeleteResult>()
        .expect("delete result returned");
    assert!(deleted.removed);
    assert_eq!(deleted.annotation.expect("removed record").id, created.id);
    assert!(
        engine
            .get_cell_annotation_by_position(&sid, 5, 5)
            .unwrap()
            .is_none()
    );
}

#[test]
fn cell_annotation_becomes_stale_after_cell_edit() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let sid = sheet_id();

    engine
        .set_cell_annotation_by_position(&sid, 0, 0, "Check source number")
        .expect("set annotation");
    let fresh = engine
        .get_cell_annotation_by_position(&sid, 0, 0)
        .expect("get fresh annotation")
        .expect("annotation should exist");
    assert_eq!(fresh.status, AnnotationStatus::Fresh);

    engine
        .set_cell_value_parsed(&sid, 0, 0, "New value")
        .expect("edit annotated cell");

    let stale = engine
        .get_cell_annotation_by_position(&sid, 0, 0)
        .expect("get stale annotation")
        .expect("annotation should still exist");
    assert_eq!(stale.status, AnnotationStatus::Stale);
    assert_eq!(stale.stale_reason.as_deref(), Some("fingerprintMismatch"));
}

#[test]
fn table_annotation_uses_stable_table_id_across_rename() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let sid = sheet_id();

    engine
        .create_table(
            &sid,
            "People".into(),
            0,
            0,
            2,
            1,
            vec!["Name".into(), "Amount".into()],
            true,
        )
        .expect("create table");
    let table_id = engine
        .get_table_by_name("People")
        .expect("table should exist")
        .id
        .clone();

    let (_patches, result) = engine
        .set_table_annotation("People", "Check source table")
        .expect("set table annotation");
    let created = result
        .extract_data::<AnnotationRecord>()
        .expect("record returned");
    assert_eq!(created.anchor_id, table_id);
    assert_eq!(
        created.fingerprint.profile,
        AnnotationFingerprintProfile::TableSchema
    );

    engine
        .rename_table("People", "PeopleRenamed")
        .expect("rename table");

    let by_new_name = engine
        .get_table_annotation("PeopleRenamed")
        .expect("get by renamed table")
        .expect("annotation should exist");
    assert_eq!(by_new_name.anchor_id, table_id);
    assert_eq!(by_new_name.status, AnnotationStatus::Stale);
    assert_eq!(
        by_new_name.stale_reason.as_deref(),
        Some("fingerprintMismatch")
    );

    let by_id = engine
        .get_table_annotation(&table_id)
        .expect("get by table id")
        .expect("annotation should exist");
    assert_eq!(by_id.id, created.id);
}
