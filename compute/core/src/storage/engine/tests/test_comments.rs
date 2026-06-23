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
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
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

    let (_patches, result) = engine
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
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
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
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
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
fn undo_comment_delete_emits_set_change_for_original_cell() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
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

    let root = engine
        .get_comments_for_cell_by_position(&sid, 0, 0)
        .into_iter()
        .next()
        .expect("thread root should exist");

    engine
        .delete_comments_for_cell_by_position(&sid, 0, 0)
        .expect("delete comment");

    let (_patches, undo_result) = engine.undo().expect("undo delete comment");

    assert!(engine.has_comments_by_position(&sid, 0, 0));
    assert_eq!(undo_result.comment_changes.len(), 1);
    let change = &undo_result.comment_changes[0];
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
fn undo_value_edit_preserves_note_identity_on_blank_cell() {
    let snap = empty_bulk_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
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

    assert!(engine.has_comments_by_position(&sid, 0, 0));
    let note = engine
        .get_comments_for_cell_by_position(&sid, 0, 0)
        .into_iter()
        .next()
        .expect("note should be addressable before edit");

    engine
        .set_cell_value_parsed(&sid, 0, 0, "New value")
        .expect("set value");

    assert!(engine.has_comments_by_position(&sid, 0, 0));
    let owner_before_undo = engine.stores.storage.read_cell_id_at_pos(&sid, 0, 0);
    assert!(
        owner_before_undo.is_some(),
        "note-backed cell identity should be persisted before undo"
    );

    engine.undo().expect("undo value edit");

    assert!(
        engine.has_comments_by_position(&sid, 0, 0),
        "undoing only the value edit must leave the note reachable by position"
    );
    let after_undo = engine.get_comments_for_cell_by_position(&sid, 0, 0);
    assert_eq!(after_undo.len(), 1);
    assert_eq!(after_undo[0].id, note.id);
    assert_eq!(after_undo[0].comment_type, CommentType::Note);

    engine.redo().expect("redo value edit");

    let after_redo = engine.get_comments_for_cell_by_position(&sid, 0, 0);
    assert_eq!(after_redo.len(), 1);
    assert_eq!(after_redo[0].id, note.id);
    assert_eq!(after_redo[0].comment_type, CommentType::Note);
}

#[test]
fn direct_clear_preserves_note_identity_on_blank_cell() {
    let snap = empty_bulk_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
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
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
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
