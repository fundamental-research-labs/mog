use super::super::*;
use super::helpers::*;
use std::sync::Arc;

use yrs::{Any, Map, Origin, Out, Transact};

use compute_document::hex::id_to_hex;
use compute_document::schema::KEY_COMMENTS;
use compute_document::undo::ORIGIN_USER_EDIT;
use domain_types::domain::comment::{CommentContentType, CommentMention};
use domain_types::yrs_schema::comment as comment_schema;

use crate::storage::YrsStorage;

#[test]
fn test_add_reply_inherits_thread_id() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = &storage.sheets_ref();
    let root = add_comment(
        doc,
        sheets,
        &sheet_id,
        "cell-001",
        simple_runs("Root comment"),
        "Alice",
        AddCommentOptions::default(),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    let reply = add_comment(
        doc,
        sheets,
        &sheet_id,
        "cell-001",
        simple_runs("Reply to root"),
        "Bob",
        AddCommentOptions {
            author_id: Some("bob-123".to_string()),
            parent_id: Some(root.id.clone()),
            comment_type: CommentType::ThreadedComment,
            ..Default::default()
        },
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    assert_ne!(reply.id, root.id);
    assert_eq!(reply.thread_id, root.thread_id);
    assert_eq!(reply.parent_id, Some(root.id.clone()));
    assert_eq!(reply.author_id, Some("bob-123".to_string()));
}

#[test]
fn test_update_comment() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = &storage.sheets_ref();
    let comment = add_comment(
        doc,
        sheets,
        &sheet_id,
        "cell-001",
        simple_runs("Original"),
        "Alice",
        AddCommentOptions::default(),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    assert!(comment.modified_at.is_none());
    let updated = update_comment(
        doc,
        sheets,
        &sheet_id,
        &comment.id,
        simple_runs("Updated text"),
    )
    .expect("update should succeed");
    assert_eq!(updated.id, comment.id);
    assert_eq!(updated.runs[0].text, "Updated text");
    assert!(updated.modified_at.is_some());
    assert!(updated.modified_at.unwrap() >= comment.created_at.unwrap_or(0));
    assert_eq!(updated.author, "Alice");
    assert_eq!(updated.cell_ref, "cell-001");
    assert_eq!(updated.thread_id, comment.thread_id);
}

#[test]
fn test_update_comment_mentions_preserves_existing_fields() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = &storage.sheets_ref();
    let root = add_comment(
        doc,
        sheets,
        &sheet_id,
        "cell-001",
        simple_runs("Original"),
        "Alice",
        AddCommentOptions {
            author_id: Some("author-1".to_string()),
            ..Default::default()
        },
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    set_thread_resolved(doc, sheets, &sheet_id, &root.id, true);
    let before = get_comment(doc, sheets, &sheet_id, &root.id).unwrap();
    let mentions = vec![CommentMention {
        display_text: "@Bob".to_string(),
        user_id: "bob".to_string(),
        email: Some("bob@example.com".to_string()),
        start_index: 6,
        length: 4,
    }];

    let updated = update_comment_mentions(
        doc,
        sheets,
        &sheet_id,
        &root.id,
        "Hello @Bob",
        mentions.clone(),
    )
    .expect("mention update should succeed");

    assert_eq!(updated.content, Some("Hello @Bob".to_string()));
    assert_eq!(updated.content_type, Some(CommentContentType::Mention));
    assert_eq!(updated.mentions, mentions);
    assert_eq!(updated.runs, before.runs);
    assert_eq!(updated.author, before.author);
    assert_eq!(updated.author_id, before.author_id);
    assert_eq!(updated.cell_ref, before.cell_ref);
    assert_eq!(updated.thread_id, before.thread_id);
    assert_eq!(updated.parent_id, before.parent_id);
    assert_eq!(updated.resolved, before.resolved);
    assert_eq!(updated.comment_type, before.comment_type);
    assert!(updated.modified_at.is_some());
}

#[test]
fn test_delete_comment() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = &storage.sheets_ref();
    let comment = add_comment(
        doc,
        sheets,
        &sheet_id,
        "cell-001",
        simple_runs("To be deleted"),
        "Alice",
        AddCommentOptions::default(),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    assert!(delete_comment(doc, sheets, &sheet_id, &comment.id));
    assert!(get_comment(doc, sheets, &sheet_id, &comment.id).is_none());
    assert_eq!(get_comment_count(doc, sheets, &sheet_id), 0);
    assert!(!delete_comment(doc, sheets, &sheet_id, &comment.id));
}

#[test]
fn test_delete_comments_for_cell() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = &storage.sheets_ref();
    for i in 0..3 {
        add_comment(
            doc,
            sheets,
            &sheet_id,
            "cell-001",
            simple_runs(&format!("Comment {}", i)),
            "Alice",
            AddCommentOptions::default(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
    }
    add_comment(
        doc,
        sheets,
        &sheet_id,
        "cell-002",
        simple_runs("Other cell"),
        "Bob",
        AddCommentOptions::default(),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    assert_eq!(get_comment_count(doc, sheets, &sheet_id), 4);
    let deleted = delete_comments_for_cell(doc, sheets, &sheet_id, "cell-001");
    assert_eq!(deleted, 3);
    assert_eq!(get_comment_count(doc, sheets, &sheet_id), 1);
    assert!(has_comments(doc, sheets, &sheet_id, "cell-002"));
    assert!(!has_comments(doc, sheets, &sheet_id, "cell-001"));
}

#[test]
fn test_set_thread_resolved() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = &storage.sheets_ref();
    let root = add_comment(
        doc,
        sheets,
        &sheet_id,
        "cell-001",
        simple_runs("Root"),
        "Alice",
        AddCommentOptions::default(),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    let _reply = add_comment(
        doc,
        sheets,
        &sheet_id,
        "cell-001",
        simple_runs("Reply"),
        "Bob",
        AddCommentOptions {
            parent_id: Some(root.id.clone()),
            comment_type: CommentType::ThreadedComment,
            ..Default::default()
        },
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    set_thread_resolved(doc, sheets, &sheet_id, &root.id, true);
    let thread = get_comment_thread(doc, sheets, &sheet_id, &root.id);
    assert_eq!(thread.len(), 2);
    for comment in &thread {
        assert_eq!(comment.resolved, Some(true));
    }
    set_thread_resolved(doc, sheets, &sheet_id, &root.id, false);
    let thread = get_comment_thread(doc, sheets, &sheet_id, &root.id);
    for comment in &thread {
        assert_eq!(comment.resolved, Some(false));
    }
}

#[test]
fn test_set_thread_resolved_matches_root_id_when_thread_id_is_mismatched() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = &storage.sheets_ref();
    let root = add_comment(
        doc,
        sheets,
        &sheet_id,
        "cell-001",
        simple_runs("Root"),
        "Alice",
        AddCommentOptions::default(),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    {
        let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
        let sheet_map = match sheets.get(&txn, &sheet_hex) {
            Some(Out::YMap(m)) => m,
            _ => panic!("sheet not found"),
        };
        let comments_map = match sheet_map.get(&txn, KEY_COMMENTS) {
            Some(Out::YMap(m)) => m,
            _ => panic!("comments map not found"),
        };
        let root_map = match comments_map.get(&txn, root.id.as_str()) {
            Some(Out::YMap(m)) => m,
            _ => panic!("root comment not found"),
        };
        root_map.insert(
            &mut txn,
            comment_schema::KEY_THREAD_ID,
            Any::String(Arc::from("different-thread")),
        );
    }

    set_thread_resolved(doc, sheets, &sheet_id, &root.id, true);

    let updated = get_comment(doc, sheets, &sheet_id, &root.id).unwrap();
    assert_eq!(updated.thread_id, Some("different-thread".to_string()));
    assert_eq!(updated.resolved, Some(true));
}

#[test]
fn test_clear_all_comments() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = &storage.sheets_ref();
    for i in 0..5 {
        add_comment(
            doc,
            sheets,
            &sheet_id,
            &format!("cell-{:03}", i),
            simple_runs(&format!("Comment {}", i)),
            "Alice",
            AddCommentOptions::default(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
    }
    assert_eq!(get_comment_count(doc, sheets, &sheet_id), 5);
    clear_all_comments(doc, sheets, &sheet_id);
    assert_eq!(get_comment_count(doc, sheets, &sheet_id), 0);
    assert!(get_all_comments(doc, sheets, &sheet_id).is_empty());
}

#[test]
fn test_update_nonexistent_comment() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = &storage.sheets_ref();
    let result = update_comment(
        doc,
        sheets,
        &sheet_id,
        "nonexistent",
        simple_runs("New content"),
    );
    assert!(result.is_none());
}

#[test]
fn test_delete_comments_for_cell_no_comments() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = &storage.sheets_ref();
    let count = delete_comments_for_cell(doc, sheets, &sheet_id, "cell-001");
    assert_eq!(count, 0);
}

#[test]
fn test_clear_all_empty_sheet() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = &storage.sheets_ref();
    clear_all_comments(doc, sheets, &sheet_id);
    assert_eq!(get_comment_count(doc, sheets, &sheet_id), 0);
}

#[test]
fn test_reply_to_nonexistent_parent() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = &storage.sheets_ref();
    let comment = add_comment(
        doc,
        sheets,
        &sheet_id,
        "cell-001",
        simple_runs("Reply to ghost"),
        "Alice",
        AddCommentOptions {
            parent_id: Some("nonexistent-parent".to_string()),
            comment_type: CommentType::ThreadedComment,
            ..Default::default()
        },
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    assert_eq!(comment.thread_id, Some("nonexistent-parent".to_string()));
    assert_eq!(comment.parent_id, Some("nonexistent-parent".to_string()));
}

#[test]
fn test_set_thread_resolved_nonexistent() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = &storage.sheets_ref();
    set_thread_resolved(doc, sheets, &sheet_id, "nonexistent-thread", true);
}

#[test]
fn test_add_comment_nonexistent_sheet() {
    let storage = YrsStorage::new();
    let doc = storage.doc();
    let sheets = &storage.sheets_ref();
    let fake_sheet = make_sheet_id(999);
    let result = add_comment(
        doc,
        sheets,
        &fake_sheet,
        "cell-001",
        simple_runs("Hello"),
        "Alice",
        AddCommentOptions::default(),
        &crate::storage::STORAGE_ID_ALLOC,
    );
    assert!(result.is_err());
}

// -------------------------------------------------------------------
// Note vs thread discriminator tests
// -------------------------------------------------------------------
