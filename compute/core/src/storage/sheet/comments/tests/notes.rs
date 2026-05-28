use super::super::*;
use super::helpers::*;
use domain_types::domain::comment::NoteShapeAnchor;

#[test]
fn test_add_comment_note_has_no_thread_or_parent() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = &storage.sheets_ref();
    let note = add_comment(
        doc,
        sheets,
        &sheet_id,
        "cell-001",
        simple_runs("A note"),
        "Alice",
        AddCommentOptions {
            comment_type: CommentType::Note,
            ..Default::default()
        },
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .expect("note add should succeed");
    assert_eq!(note.comment_type, CommentType::Note);
    assert!(note.thread_id.is_none(), "notes never have a thread_id");
    assert!(note.parent_id.is_none(), "notes never have a parent_id");
}

#[test]
fn test_add_comment_note_with_parent_id_is_rejected() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = &storage.sheets_ref();
    let result = add_comment(
        doc,
        sheets,
        &sheet_id,
        "cell-001",
        simple_runs("Illegal note reply"),
        "Alice",
        AddCommentOptions {
            comment_type: CommentType::Note,
            parent_id: Some("some-parent".to_string()),
            ..Default::default()
        },
        &crate::storage::STORAGE_ID_ALLOC,
    );
    assert!(result.is_err(), "notes cannot have replies");
}

#[test]
fn test_add_comment_threaded_keeps_thread_id() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = &storage.sheets_ref();
    let comment = add_comment(
        doc,
        sheets,
        &sheet_id,
        "cell-001",
        simple_runs("A thread"),
        "Alice",
        AddCommentOptions {
            comment_type: CommentType::ThreadedComment,
            ..Default::default()
        },
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .expect("thread add should succeed");
    assert_eq!(comment.comment_type, CommentType::ThreadedComment);
    assert_eq!(comment.thread_id, Some(comment.id.clone()));
}

#[test]
fn test_set_note_dimensions_applies_height_and_width_independently() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = &storage.sheets_ref();
    let note = add_comment(
        doc,
        sheets,
        &sheet_id,
        "cell-001",
        simple_runs("Sized note"),
        "Alice",
        AddCommentOptions {
            comment_type: CommentType::Note,
            ..Default::default()
        },
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    assert!(set_note_dimensions(
        doc,
        sheets,
        &sheet_id,
        &note.id,
        Some(120.0),
        None
    ));
    let height_only = get_comment(doc, sheets, &sheet_id, &note.id).unwrap();
    assert_eq!(height_only.note_height, Some(120.0));
    assert_eq!(height_only.note_width, None);

    assert!(set_note_dimensions(
        doc,
        sheets,
        &sheet_id,
        &note.id,
        None,
        Some(60.0)
    ));
    let width_added = get_comment(doc, sheets, &sheet_id, &note.id).unwrap();
    assert_eq!(width_added.note_height, Some(120.0));
    assert_eq!(width_added.note_width, Some(60.0));

    assert!(set_note_dimensions(
        doc, sheets, &sheet_id, &note.id, None, None
    ));
    let unchanged = get_comment(doc, sheets, &sheet_id, &note.id).unwrap();
    assert_eq!(unchanged.note_height, Some(120.0));
    assert_eq!(unchanged.note_width, Some(60.0));
}

#[test]
fn test_set_note_visibility_and_dimensions_return_false_when_target_missing() {
    let (storage, sheet_id) = storage_with_sheet();
    let missing_sheet = make_sheet_id(999);
    let doc = storage.doc();
    let sheets = &storage.sheets_ref();

    assert!(!set_note_visible(
        doc,
        sheets,
        &sheet_id,
        "missing-comment",
        true
    ));
    assert!(!set_note_dimensions(
        doc,
        sheets,
        &sheet_id,
        "missing-comment",
        Some(120.0),
        Some(60.0)
    ));
    assert!(!set_note_visible(
        doc,
        sheets,
        &missing_sheet,
        "missing-comment",
        true
    ));
    assert!(!set_note_dimensions(
        doc,
        sheets,
        &missing_sheet,
        "missing-comment",
        Some(120.0),
        Some(60.0)
    ));
}

#[test]
fn test_convert_note_to_thread_flips_discriminator_and_clears_geometry() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = &storage.sheets_ref();
    let note = add_comment(
        doc,
        sheets,
        &sheet_id,
        "cell-001",
        simple_runs("Convert me"),
        "Alice",
        AddCommentOptions {
            comment_type: CommentType::Note,
            ..Default::default()
        },
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    // Inject geometry that should be cleared on convert.
    set_note_visible(doc, sheets, &sheet_id, &note.id, true);
    set_note_dimensions(doc, sheets, &sheet_id, &note.id, Some(120.0), Some(60.0));
    // Sanity: geometry was actually written.
    let with_geometry = get_comment(doc, sheets, &sheet_id, &note.id).unwrap();
    assert_eq!(with_geometry.visible, Some(true));
    assert_eq!(with_geometry.note_height, Some(120.0));
    assert_eq!(with_geometry.note_width, Some(60.0));

    let converted = convert_note_to_thread(doc, sheets, &sheet_id, &note.id)
        .expect("convert should return the updated comment");
    assert_eq!(converted.comment_type, CommentType::ThreadedComment);
    assert_eq!(converted.thread_id, Some(note.id.clone()));
    assert!(converted.visible.is_none());
    assert!(converted.note_height.is_none());
    assert!(converted.note_width.is_none());
    assert!(converted.shape_id.is_none());
    assert!(converted.modified_at.is_some());

    // Re-fetch and confirm the in-yrs state matches.
    let refetched = get_comment(doc, sheets, &sheet_id, &note.id).unwrap();
    assert_eq!(refetched.comment_type, CommentType::ThreadedComment);
    assert_eq!(refetched.thread_id, Some(note.id.clone()));
    assert!(refetched.visible.is_none());
    assert!(refetched.note_height.is_none());
    assert!(refetched.note_width.is_none());
    assert!(refetched.shape_id.is_none());
}

#[test]
fn test_convert_note_to_thread_preserves_note_shape_anchor() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = &storage.sheets_ref();
    let note = add_comment(
        doc,
        sheets,
        &sheet_id,
        "cell-001",
        simple_runs("Anchored note"),
        "Alice",
        AddCommentOptions {
            comment_type: CommentType::Note,
            ..Default::default()
        },
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    let anchor = NoteShapeAnchor {
        left_column: 1,
        left_offset: 2,
        top_row: 3,
        top_offset: 4,
        right_column: 5,
        right_offset: 6,
        bottom_row: 7,
        bottom_offset: 8,
    };
    let mut stored = note.clone();
    stored.visible = Some(true);
    stored.note_height = Some(120.0);
    stored.note_width = Some(60.0);
    stored.shape_id = Some(99);
    stored.note_shape_anchor = Some(anchor.clone());
    insert_comment_with_key(&storage, &sheet_id, &note.id, &stored);

    let converted = convert_note_to_thread(doc, sheets, &sheet_id, &note.id).unwrap();
    assert_eq!(converted.comment_type, CommentType::ThreadedComment);
    assert_eq!(converted.note_shape_anchor, Some(anchor.clone()));
    assert!(converted.visible.is_none());
    assert!(converted.note_height.is_none());
    assert!(converted.note_width.is_none());
    assert!(converted.shape_id.is_none());

    let refetched = get_comment(doc, sheets, &sheet_id, &note.id).unwrap();
    assert_eq!(refetched.note_shape_anchor, Some(anchor));
    assert!(refetched.visible.is_none());
    assert!(refetched.note_height.is_none());
    assert!(refetched.note_width.is_none());
    assert!(refetched.shape_id.is_none());
}

#[test]
fn test_convert_note_to_thread_idempotent_on_existing_thread() {
    let (storage, sheet_id) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = &storage.sheets_ref();
    let thread = add_comment(
        doc,
        sheets,
        &sheet_id,
        "cell-001",
        simple_runs("Already a thread"),
        "Alice",
        AddCommentOptions {
            comment_type: CommentType::ThreadedComment,
            ..Default::default()
        },
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    let modified_before = thread.modified_at;
    let converted = convert_note_to_thread(doc, sheets, &sheet_id, &thread.id)
        .expect("idempotent convert should return the existing comment");
    // Discriminator is unchanged; thread_id and modified_at are not bumped.
    assert_eq!(converted.comment_type, CommentType::ThreadedComment);
    assert_eq!(converted.thread_id, thread.thread_id);
    assert_eq!(converted.modified_at, modified_before);
}
