use super::super::{Comment, CommentType, RichTextRun};

#[test]
fn test_cell_comment_serde_roundtrip() {
    let comment = Comment {
        id: "abc-123".to_string(),
        cell_ref: "cell-001".to_string(),
        author: "Alice".to_string(),
        author_id: Some("alice-id".to_string()),
        author_email: None,
        created_at: Some(1700000000000),
        modified_at: Some(1700000001000),
        comment_pr: None,
        runs: vec![
            RichTextRun {
                text: "Hello ".to_string(),
                bold: true,
                ..Default::default()
            },
            RichTextRun {
                text: "world".to_string(),
                italic: true,
                color: Some("#ff0000".to_string()),
                ..Default::default()
            },
        ],
        content: None,
        thread_id: Some("abc-123".to_string()),
        parent_id: None,
        resolved: Some(false),
        person_id: None,
        timestamp: None,
        xr_uid: None,
        shape_id: None,
        ext_lst_xml: None,
        content_type: None,
        mentions: Vec::new(),
        comment_type: CommentType::ThreadedComment,
        visible: None,
        note_height: None,
        note_width: None,
        note_shape_anchor: None,
    };
    let json = serde_json::to_string(&comment).unwrap();
    let deserialized: Comment = serde_json::from_str(&json).unwrap();
    assert_eq!(comment, deserialized);
}
