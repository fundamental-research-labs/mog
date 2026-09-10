//! Comment mutation contract tests.

use super::super::*;
use super::helpers::*;
use crate::snapshot::ChangeKind;
use cell_types::CellId;
use compute_document::hex::hex_to_id;
use domain_types::domain::comment::CommentType;

#[test]
fn set_thread_resolved_emits_comment_change_for_thread_cell() {
    let snap = simple_snapshot();
    let (mut engine, _) = ComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    engine
        .add_comment_by_position(
            &sid,
            0,
            0,
            "Root thread",
            "Alice",
            None,
            None,
            CommentType::ThreadedComment,
        )
        .expect("add thread root");

    let comments = engine.get_comments_for_cell_by_position(&sid, 0, 0);
    let root = comments.first().expect("thread root should exist");

    let result = engine
        .set_thread_resolved(&sid, &root.id, true)
        .expect("resolve thread");

    assert_eq!(result.comment_changes.len(), 1);
    let change = &result.comment_changes[0];
    assert_eq!(change.sheet_id, sid.to_uuid_string());
    assert_eq!(change.cell_id, root.cell_ref);
    assert_eq!(
        change
            .position
            .as_ref()
            .map(|position| (position.row, position.col)),
        Some((0, 0))
    );
    assert_eq!(change.kind, ChangeKind::Set);
}

#[test]
fn sdk_authored_threaded_comments_export_with_person_identity() {
    let snap = simple_snapshot();
    let (mut engine, _) = ComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    engine
        .add_comment_by_position(
            &sid,
            1,
            1,
            "SDK threaded comment draft",
            "Alice Threader",
            None,
            None,
            CommentType::ThreadedComment,
        )
        .expect("add root threaded comment");
    let root = engine
        .get_comments_for_cell_by_position(&sid, 1, 1)
        .into_iter()
        .find(|comment| comment.parent_id.is_none())
        .expect("root comment");
    engine
        .update_comment(&sid, &root.id, "SDK threaded comment updated before export")
        .expect("update root threaded comment");
    engine
        .add_comment(
            &sid,
            &root.cell_ref,
            "SDK threaded reply survives export",
            "Bob Reviewer",
            None,
            Some(root.id.clone()),
            CommentType::ThreadedComment,
        )
        .expect("add threaded reply");
    engine
        .set_thread_resolved(&sid, &root.id, true)
        .expect("resolve thread");

    let authored = engine.get_comments_for_cell_by_position(&sid, 1, 1);
    assert_eq!(authored.len(), 2);
    assert!(authored.iter().all(|comment| comment.person_id.is_some()));
    assert!(
        authored
            .iter()
            .all(|comment| comment.resolved == Some(true))
    );

    let exported_bytes = engine.export_to_xlsx_bytes().expect("export xlsx bytes");
    let parsed = xlsx_api::parse(&exported_bytes)
        .expect("exported XLSX should parse")
        .output;

    assert!(
        parsed
            .persons
            .iter()
            .any(|person| person.display_name == "Alice Threader")
    );
    assert!(
        parsed
            .persons
            .iter()
            .any(|person| person.display_name == "Bob Reviewer")
    );
    let root = parsed.sheets[0]
        .comments
        .iter()
        .find(|comment| {
            comment.content.as_deref() == Some("SDK threaded comment updated before export")
        })
        .expect("parsed root threaded comment");
    let reply = parsed.sheets[0]
        .comments
        .iter()
        .find(|comment| comment.content.as_deref() == Some("SDK threaded reply survives export"))
        .expect("parsed reply threaded comment");

    assert_eq!(root.comment_type, CommentType::ThreadedComment);
    assert_eq!(reply.comment_type, CommentType::ThreadedComment);
    assert_eq!(reply.thread_id, root.thread_id);
    assert_eq!(reply.parent_id.as_deref(), Some(root.id.as_str()));
    assert!(root.person_id.is_some());
    assert!(reply.person_id.is_some());
    assert_eq!(root.resolved, Some(true));
    assert_eq!(reply.resolved, Some(true));
}

#[test]
fn sdk_authored_note_exports_as_legacy_note_without_person_identity() {
    let snap = simple_snapshot();
    let (mut engine, _) = ComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    engine
        .add_comment_by_position(
            &sid,
            2,
            2,
            "SDK legacy note survives export",
            "Nora Notes",
            None,
            None,
            CommentType::Note,
        )
        .expect("add note");

    let authored = engine.get_comments_for_cell_by_position(&sid, 2, 2);
    assert_eq!(authored.len(), 1);
    assert_eq!(authored[0].comment_type, CommentType::Note);
    assert!(authored[0].person_id.is_none());
    assert!(authored[0].thread_id.is_none());

    let exported_bytes = engine.export_to_xlsx_bytes().expect("export xlsx bytes");
    let parsed = xlsx_api::parse(&exported_bytes)
        .expect("exported XLSX should parse")
        .output;

    assert!(parsed.persons.is_empty());
    let note = parsed.sheets[0]
        .comments
        .iter()
        .find(|comment| comment.author == "Nora Notes")
        .expect("parsed note");
    assert_eq!(note.cell_ref, "C3");
    assert_eq!(note.comment_type, CommentType::Note);
    assert!(note.person_id.is_none());
    assert!(note.thread_id.is_none());
    assert!(
        note.content
            .as_deref()
            .is_some_and(|content| content.contains("SDK legacy note survives export"))
    );
}

#[test]
fn direct_clear_preserves_note_identity_on_blank_cell() {
    let snap = empty_bulk_snapshot();
    let (mut engine, _) = ComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    engine
        .add_comment_by_position(
            &sid,
            0,
            0,
            "Original note",
            "User",
            None,
            None,
            CommentType::Note,
        )
        .expect("add note");

    let note = engine
        .get_comments_for_cell_by_position(&sid, 0, 0)
        .into_iter()
        .next()
        .expect("note should be addressable before edit");
    let cell_id = CellId::from_raw(hex_to_id(&note.cell_ref).expect("note cell ref parses"));

    engine
        .set_cell_value_parsed(&sid, 0, 0, "New value")
        .expect("set value");
    engine
        .set_cell(
            &sid,
            cell_id,
            0,
            0,
            crate::storage::engine::mutation::CellInput::Clear,
        )
        .expect("clear value");

    let after_clear = engine.get_comments_for_cell_by_position(&sid, 0, 0);
    assert_eq!(after_clear.len(), 1);
    assert_eq!(after_clear[0].id, note.id);
    assert_eq!(after_clear[0].comment_type, CommentType::Note);
}

#[test]
fn batch_clear_preserves_note_identity_on_blank_cell() {
    let snap = empty_bulk_snapshot();
    let (mut engine, _) = ComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    engine
        .add_comment_by_position(
            &sid,
            0,
            0,
            "Original note",
            "User",
            None,
            None,
            CommentType::Note,
        )
        .expect("add note");

    let note = engine
        .get_comments_for_cell_by_position(&sid, 0, 0)
        .into_iter()
        .next()
        .expect("note should be addressable before edit");
    let cell_id = CellId::from_raw(hex_to_id(&note.cell_ref).expect("note cell ref parses"));

    engine
        .set_cell_value_parsed(&sid, 0, 0, "New value")
        .expect("set value");
    engine
        .batch_clear_cells(vec![cell_id])
        .expect("batch clear value");

    let after_clear = engine.get_comments_for_cell_by_position(&sid, 0, 0);
    assert_eq!(after_clear.len(), 1);
    assert_eq!(after_clear[0].id, note.id);
    assert_eq!(after_clear[0].comment_type, CommentType::Note);
}

#[test]
fn native_comments_copy_preserves_threads_note_geometry_annotations_and_xlsx() {
    let (mut engine, _) = ComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let sid = sheet_id();
    engine
        .add_comment_by_position(
            &sid,
            4,
            4,
            "Native note",
            "Alice",
            None,
            None,
            CommentType::Note,
        )
        .unwrap();
    let note = engine
        .get_comments_for_cell_by_position(&sid, 4, 4)
        .remove(0);
    let geometry = engine
        .set_note_dimensions(&sid, &note.id, Some(105.0), Some(165.0))
        .unwrap();
    assert_eq!(geometry.comment_changes.len(), 1);
    engine.set_note_visible(&sid, &note.id, true).unwrap();
    engine
        .set_cell_annotation_by_position(&sid, 4, 4, "Copied annotation")
        .unwrap();
    engine
        .add_comment_by_position(
            &sid,
            1,
            1,
            "Thread root",
            "Alice",
            None,
            None,
            CommentType::ThreadedComment,
        )
        .unwrap();
    let root = engine
        .get_comments_for_cell_by_position(&sid, 1, 1)
        .remove(0);
    engine
        .add_comment(
            &sid,
            &root.cell_ref,
            "Reply",
            "Bob",
            None,
            Some(root.id.clone()),
            CommentType::ThreadedComment,
        )
        .unwrap();
    engine.set_thread_resolved(&sid, &root.id, true).unwrap();
    let (copy, _) = engine.copy_sheet(&sid, "Copied comments").unwrap();
    let copy = cell_types::SheetId::from_uuid_str(&copy).unwrap();
    let copied_note = engine
        .get_comments_for_cell_by_position(&copy, 4, 4)
        .remove(0);
    assert_ne!(copied_note.cell_ref, note.cell_ref);
    assert_ne!(copied_note.id, note.id);
    assert_eq!(copied_note.note_height, Some(105.0));
    assert_eq!(copied_note.note_width, Some(165.0));
    assert_eq!(copied_note.visible, Some(true));
    let thread = engine.get_comments_for_cell_by_position(&copy, 1, 1);
    let copied_root = thread
        .iter()
        .find(|comment| comment.parent_id.is_none())
        .unwrap();
    let copied_reply = thread
        .iter()
        .find(|comment| comment.parent_id.is_some())
        .unwrap();
    assert_ne!(copied_root.id, root.id);
    assert_eq!(
        copied_reply.parent_id.as_deref(),
        Some(copied_root.id.as_str())
    );
    assert!(thread.iter().all(|comment| comment.resolved == Some(true)));
    let annotation = engine
        .get_cell_annotation_by_position(&copy, 4, 4)
        .unwrap()
        .unwrap();
    assert_eq!(annotation.text, "Copied annotation");
    assert_eq!(
        annotation.status,
        crate::engine_types::AnnotationStatus::Fresh
    );
    let bytes = engine.export_to_xlsx_bytes().unwrap();
    let (reloaded, _) = ComputeEngine::from_xlsx_bytes(&bytes).unwrap();
    let copy = *reloaded
        .cell_store()
        .sheet_ids()
        .find(|id| reloaded.cell_store().get_sheet(id).unwrap().name == "Copied comments")
        .unwrap();
    assert_eq!(reloaded.get_comment_count(&copy), 3);
    let note = reloaded
        .get_comments_for_cell_by_position(&copy, 4, 4)
        .remove(0);
    assert_eq!(note.visible, Some(true));
    assert_eq!(note.note_height, Some(105.0));
    assert_eq!(note.note_width, Some(165.0));
    assert_eq!(
        reloaded
            .get_comments_for_cell_by_position(&copy, 1, 1)
            .len(),
        2
    );
}

#[test]
fn native_comments_and_annotations_follow_relocation_and_row_identity_deletion() {
    let (mut engine, _) = ComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let sid = sheet_id();
    engine
        .add_comment_by_position(
            &sid,
            3,
            3,
            "Move me",
            "Alice",
            None,
            None,
            CommentType::Note,
        )
        .unwrap();
    engine
        .set_cell_annotation_by_position(&sid, 3, 3, "Move annotation")
        .unwrap();
    let original = engine
        .get_comments_for_cell_by_position(&sid, 3, 3)
        .remove(0);
    let (target, _) = engine.copy_sheet(&sid, "Target comments").unwrap();
    let target = cell_types::SheetId::from_uuid_str(&target).unwrap();
    engine.clear_all_comments(&target).unwrap();
    engine
        .add_comment_by_position(
            &target,
            5,
            5,
            "Displaced note",
            "Bob",
            None,
            None,
            CommentType::Note,
        )
        .unwrap();
    engine
        .set_cell_annotation_by_position(&target, 5, 5, "Displaced annotation")
        .unwrap();
    engine
        .relocate_cells(&sid, 3, 3, 3, 3, &target, 5, 5)
        .unwrap();
    assert!(
        engine
            .get_comments_for_cell_by_position(&sid, 3, 3)
            .is_empty()
    );
    let moved = engine
        .get_comments_for_cell_by_position(&target, 5, 5)
        .remove(0);
    assert_eq!(moved.id, original.id);
    assert_eq!(moved.cell_ref, original.cell_ref);
    assert_eq!(engine.get_comment_count(&target), 1);
    let moved_id = CellId::from_uuid_str(&moved.cell_ref).unwrap();
    assert!(engine.cell_store().get_cell_value_raw(&moved_id).is_none());
    assert_eq!(
        engine
            .get_cell_annotation_by_position(&target, 5, 5)
            .unwrap()
            .unwrap()
            .text,
        "Move annotation"
    );
    engine
        .structure_change(
            &target,
            &formula_types::StructureChange::InsertRows {
                at: 5,
                count: 1,
                new_row_ids: Vec::new(),
            },
        )
        .unwrap();
    assert_eq!(
        engine
            .get_comments_for_cell_by_position(&target, 6, 5)
            .remove(0)
            .id,
        original.id
    );
    engine
        .structure_change(
            &target,
            &formula_types::StructureChange::DeleteRows {
                at: 6,
                count: 1,
                deleted_cell_ids: Vec::new(),
            },
        )
        .unwrap();
    assert_eq!(engine.get_comment_count(&target), 0);
    assert!(
        engine
            .get_cell_annotation_by_position(&target, 6, 5)
            .unwrap()
            .is_none()
    );
}

#[test]
fn selected_sheet_comment_import_preserves_colliding_person_identities() {
    let (mut source, _) = ComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let sid = sheet_id();
    source
        .add_comment_by_position(
            &sid,
            2,
            2,
            "Imported thread",
            "Imported author",
            None,
            None,
            CommentType::ThreadedComment,
        )
        .unwrap();
    let imported_person = source.stores.storage.metadata.persons[0].clone();
    let source_name = source.cell_store().get_sheet(&sid).unwrap().name.clone();
    let bytes = source.export_to_xlsx_bytes().unwrap();
    let (mut target, _) = ComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let mut existing = imported_person.clone();
    existing.display_name = "Existing author".into();
    target
        .stores
        .storage
        .metadata
        .persons
        .push(existing.clone());
    let before = target.stores.storage.metadata.persons.clone();
    assert!(
        target
            .import_sheets_from_xlsx(&bytes, vec!["Missing sheet".into()], None)
            .is_err()
    );
    assert_eq!(target.stores.storage.metadata.persons, before);
    let imported = target
        .import_sheets_from_xlsx(&bytes, vec![source_name], None)
        .unwrap();
    let imported = *target
        .cell_store()
        .sheet_ids()
        .find(|id| target.cell_store().get_sheet(id).unwrap().name == imported[0])
        .unwrap();
    let thread = target
        .get_comments_for_cell_by_position(&imported, 2, 2)
        .remove(0);
    assert_ne!(thread.person_id.as_deref(), Some(existing.id.as_str()));
    let parsed = xlsx_api::parse(&target.export_to_xlsx_bytes().unwrap())
        .unwrap()
        .output;
    assert!(parsed.persons.iter().any(|person| person == &existing));
    assert!(
        parsed
            .persons
            .iter()
            .any(|person| Some(&person.id) == thread.person_id.as_ref()
                && person.display_name == imported_person.display_name)
    );
}
