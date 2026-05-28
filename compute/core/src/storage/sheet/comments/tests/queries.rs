use super::super::*;
use super::helpers::*;
use crate::storage::YrsStorage;

#[test]
fn test_add_comment_and_retrieve() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = &storage.sheets_ref();
    let comment = add_comment(
        doc,
        sheets,
        &sheet_id,
        "cell-001",
        simple_runs("Hello world"),
        "Alice",
        AddCommentOptions::default(),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .expect("add_comment should succeed");
    assert!(!comment.id.is_empty());
    assert_eq!(comment.cell_ref, "cell-001");
    assert_eq!(comment.author, "Alice");
    assert!(comment.created_at.unwrap_or(0) > 0);
    assert!(comment.modified_at.is_none());
    assert_eq!(comment.runs.len(), 1);
    assert_eq!(comment.runs[0].text, "Hello world");
    assert_eq!(comment.thread_id, Some(comment.id.clone()));
    assert!(comment.parent_id.is_none());
    assert!(comment.resolved.is_none());
    let fetched = get_comment(doc, sheets, &sheet_id, &comment.id);
    assert!(fetched.is_some());
    assert_eq!(fetched.unwrap(), comment);
}

#[test]
fn test_get_comment_thread() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = &storage.sheets_ref();
    let root = add_comment(
        doc,
        sheets,
        &sheet_id,
        "cell-001",
        simple_runs("Thread root"),
        "Alice",
        AddCommentOptions::default(),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    let _reply1 = add_comment(
        doc,
        sheets,
        &sheet_id,
        "cell-001",
        simple_runs("Reply 1"),
        "Bob",
        AddCommentOptions {
            parent_id: Some(root.id.clone()),
            comment_type: CommentType::ThreadedComment,
            ..Default::default()
        },
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    let _reply2 = add_comment(
        doc,
        sheets,
        &sheet_id,
        "cell-001",
        simple_runs("Reply 2"),
        "Charlie",
        AddCommentOptions {
            parent_id: Some(root.id.clone()),
            comment_type: CommentType::ThreadedComment,
            ..Default::default()
        },
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    let _other = add_comment(
        doc,
        sheets,
        &sheet_id,
        "cell-002",
        simple_runs("Different thread"),
        "Dave",
        AddCommentOptions::default(),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    let thread = get_comment_thread(doc, sheets, &sheet_id, &root.id);
    assert_eq!(thread.len(), 3);
    assert_eq!(thread[0].runs[0].text, "Thread root");
    let reply_texts: Vec<&str> = thread[1..]
        .iter()
        .map(|c| c.runs[0].text.as_str())
        .collect();
    assert!(reply_texts.contains(&"Reply 1"));
    assert!(reply_texts.contains(&"Reply 2"));
}

#[test]
fn test_get_all_notes_and_note_count_on_mixed_sheet() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = &storage.sheets_ref();
    add_comment(
        doc,
        sheets,
        &sheet_id,
        "cell-001",
        simple_runs("Note 1"),
        "Alice",
        AddCommentOptions {
            comment_type: CommentType::Note,
            ..Default::default()
        },
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    add_comment(
        doc,
        sheets,
        &sheet_id,
        "cell-002",
        simple_runs("Thread"),
        "Bob",
        AddCommentOptions::default(),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    add_comment(
        doc,
        sheets,
        &sheet_id,
        "cell-003",
        simple_runs("Note 2"),
        "Charlie",
        AddCommentOptions {
            comment_type: CommentType::Note,
            ..Default::default()
        },
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    let notes = get_all_notes(doc, sheets, &sheet_id);
    assert_eq!(notes.len(), 2);
    assert_eq!(get_note_count(doc, sheets, &sheet_id), 2);
    assert!(notes.iter().all(|c| c.comment_type == CommentType::Note));
}

#[test]
fn test_get_all_comments_uses_deterministic_storage_ordering() {
    let (storage, sheet_id) = storage_with_sheet();
    let mut comment_2 = Comment {
        id: "comment-2-id".to_string(),
        cell_ref: "cell-001".to_string(),
        author: "Alice".to_string(),
        runs: simple_runs("2"),
        ..Default::default()
    };
    comment_2.created_at = Some(2);
    let comment_10 = Comment {
        id: "comment-10-id".to_string(),
        cell_ref: "cell-001".to_string(),
        author: "Alice".to_string(),
        runs: simple_runs("10"),
        created_at: Some(10),
        ..Default::default()
    };
    let runtime_hex = Comment {
        id: "runtime-hex-id".to_string(),
        cell_ref: "cell-001".to_string(),
        author: "Alice".to_string(),
        runs: simple_runs("hex"),
        ..Default::default()
    };
    let alpha = Comment {
        id: "alpha-id".to_string(),
        cell_ref: "cell-001".to_string(),
        author: "Alice".to_string(),
        runs: simple_runs("alpha"),
        ..Default::default()
    };
    let zeta = Comment {
        id: "zeta-id".to_string(),
        cell_ref: "cell-001".to_string(),
        author: "Alice".to_string(),
        runs: simple_runs("zeta"),
        ..Default::default()
    };

    insert_comment_with_key(&storage, &sheet_id, "zeta", &zeta);
    insert_comment_with_key(
        &storage,
        &sheet_id,
        "00000000000000000000000000000001",
        &runtime_hex,
    );
    insert_comment_with_key(&storage, &sheet_id, "comment-10", &comment_10);
    insert_comment_with_key(&storage, &sheet_id, "alpha", &alpha);
    insert_comment_with_key(&storage, &sheet_id, "comment-2", &comment_2);

    let ids: Vec<String> = get_all_comments(storage.doc(), &storage.sheets_ref(), &sheet_id)
        .into_iter()
        .map(|c| c.id)
        .collect();
    assert_eq!(
        ids,
        vec![
            "comment-2-id",
            "comment-10-id",
            "runtime-hex-id",
            "alpha-id",
            "zeta-id"
        ]
    );
}

#[test]
fn test_has_comments() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = &storage.sheets_ref();
    assert!(!has_comments(doc, sheets, &sheet_id, "cell-001"));
    add_comment(
        doc,
        sheets,
        &sheet_id,
        "cell-001",
        simple_runs("A comment"),
        "Alice",
        AddCommentOptions::default(),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    assert!(has_comments(doc, sheets, &sheet_id, "cell-001"));
    assert!(!has_comments(doc, sheets, &sheet_id, "cell-002"));
}

#[test]
fn test_get_cell_ids_with_comments() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = &storage.sheets_ref();
    add_comment(
        doc,
        sheets,
        &sheet_id,
        "cell-001",
        simple_runs("Comment 1"),
        "Alice",
        AddCommentOptions::default(),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    add_comment(
        doc,
        sheets,
        &sheet_id,
        "cell-001",
        simple_runs("Comment 2"),
        "Bob",
        AddCommentOptions::default(),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    add_comment(
        doc,
        sheets,
        &sheet_id,
        "cell-002",
        simple_runs("Comment 3"),
        "Charlie",
        AddCommentOptions::default(),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    let mut cell_ids = get_cell_ids_with_comments(doc, sheets, &sheet_id);
    cell_ids.sort();
    assert_eq!(cell_ids.len(), 2);
    assert!(cell_ids.contains(&"cell-001".to_string()));
    assert!(cell_ids.contains(&"cell-002".to_string()));
}

#[test]
fn test_comment_count() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = &storage.sheets_ref();
    assert_eq!(get_comment_count(doc, sheets, &sheet_id), 0);
    add_comment(
        doc,
        sheets,
        &sheet_id,
        "cell-001",
        simple_runs("First"),
        "Alice",
        AddCommentOptions::default(),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    assert_eq!(get_comment_count(doc, sheets, &sheet_id), 1);
    add_comment(
        doc,
        sheets,
        &sheet_id,
        "cell-002",
        simple_runs("Second"),
        "Bob",
        AddCommentOptions::default(),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    assert_eq!(get_comment_count(doc, sheets, &sheet_id), 2);
}

#[test]
fn test_empty_sheet_returns_empty() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = &storage.sheets_ref();
    assert!(get_comments_for_cell(doc, sheets, &sheet_id, "cell-001").is_empty());
    assert!(get_comment(doc, sheets, &sheet_id, "nonexistent").is_none());
    assert!(!has_comments(doc, sheets, &sheet_id, "cell-001"));
    assert!(get_all_comments(doc, sheets, &sheet_id).is_empty());
    assert!(get_cell_ids_with_comments(doc, sheets, &sheet_id).is_empty());
    assert_eq!(get_comment_count(doc, sheets, &sheet_id), 0);
    assert!(get_comment_thread(doc, sheets, &sheet_id, "nonexistent").is_empty());
}

#[test]
fn test_comments_sorted_by_created_at() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = &storage.sheets_ref();
    add_comment(
        doc,
        sheets,
        &sheet_id,
        "cell-001",
        simple_runs("First"),
        "Alice",
        AddCommentOptions::default(),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    add_comment(
        doc,
        sheets,
        &sheet_id,
        "cell-001",
        simple_runs("Second"),
        "Bob",
        AddCommentOptions::default(),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    add_comment(
        doc,
        sheets,
        &sheet_id,
        "cell-001",
        simple_runs("Third"),
        "Charlie",
        AddCommentOptions::default(),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    let comments = get_comments_for_cell(doc, sheets, &sheet_id, "cell-001");
    assert_eq!(comments.len(), 3);
    assert!(comments[0].created_at.unwrap_or(0) <= comments[1].created_at.unwrap_or(0));
    assert!(comments[1].created_at.unwrap_or(0) <= comments[2].created_at.unwrap_or(0));
}

#[test]
fn test_multiple_cells_different_comments() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = &storage.sheets_ref();
    let c1 = add_comment(
        doc,
        sheets,
        &sheet_id,
        "cell-A1",
        simple_runs("Comment on A1"),
        "Alice",
        AddCommentOptions::default(),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    let c2 = add_comment(
        doc,
        sheets,
        &sheet_id,
        "cell-B2",
        simple_runs("Comment on B2"),
        "Bob",
        AddCommentOptions::default(),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    let c3 = add_comment(
        doc,
        sheets,
        &sheet_id,
        "cell-C3",
        simple_runs("Comment on C3"),
        "Charlie",
        AddCommentOptions::default(),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    assert_eq!(
        get_comments_for_cell(doc, sheets, &sheet_id, "cell-A1").len(),
        1
    );
    assert_eq!(
        get_comments_for_cell(doc, sheets, &sheet_id, "cell-B2").len(),
        1
    );
    assert_eq!(
        get_comments_for_cell(doc, sheets, &sheet_id, "cell-C3").len(),
        1
    );
    assert_eq!(get_comment_count(doc, sheets, &sheet_id), 3);
    assert_eq!(get_all_comments(doc, sheets, &sheet_id).len(), 3);
    let cell_ids = get_cell_ids_with_comments(doc, sheets, &sheet_id);
    assert_eq!(cell_ids.len(), 3);
    delete_comments_for_cell(doc, sheets, &sheet_id, "cell-B2");
    assert_eq!(get_comment_count(doc, sheets, &sheet_id), 2);
    assert!(get_comment(doc, sheets, &sheet_id, &c1.id).is_some());
    assert!(get_comment(doc, sheets, &sheet_id, &c2.id).is_none());
    assert!(get_comment(doc, sheets, &sheet_id, &c3.id).is_some());
}

#[test]
fn test_nonexistent_sheet() {
    let storage = YrsStorage::new();
    let doc = storage.doc();
    let sheets = &storage.sheets_ref();
    let fake_sheet = make_sheet_id(999);
    assert!(get_comments_for_cell(doc, sheets, &fake_sheet, "cell-001").is_empty());
    assert!(get_comment(doc, sheets, &fake_sheet, "some-id").is_none());
    assert!(!has_comments(doc, sheets, &fake_sheet, "cell-001"));
    assert!(get_all_comments(doc, sheets, &fake_sheet).is_empty());
    assert!(get_cell_ids_with_comments(doc, sheets, &fake_sheet).is_empty());
    assert_eq!(get_comment_count(doc, sheets, &fake_sheet), 0);
    assert!(get_comment_thread(doc, sheets, &fake_sheet, "some-id").is_empty());
}
