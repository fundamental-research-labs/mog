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
