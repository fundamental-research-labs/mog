//! Comment mutation contract tests.

use super::super::*;
use super::helpers::*;
use crate::snapshot::ChangeKind;
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
