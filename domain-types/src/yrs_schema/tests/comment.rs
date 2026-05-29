use crate::domain::comment::{Comment, CommentType, NoteShapeAnchor, RichTextRun};
use crate::yrs_schema::comment;

use super::support::roundtrip_map;

#[test]
fn rich_note_comment_round_trips_through_real_yrs_map() {
    let original = Comment {
        id: "comment-123".to_string(),
        cell_ref: "B5".to_string(),
        author: "Alice".to_string(),
        author_id: Some("author-001".to_string()),
        author_email: Some("alice@example.com".to_string()),
        created_at: Some(1700000000),
        modified_at: Some(1700000001),
        content: Some("Hello world".to_string()),
        runs: vec![RichTextRun {
            text: "Hello".to_string(),
            font_name: Some("Calibri".to_string()),
            font_size: Some(11.0),
            bold: true,
            italic: false,
            underline_style: None,
            underline: true,
            strikethrough: false,
            outline: None,
            shadow: None,
            condense: None,
            extend: None,
            color: Some("#FF0000".to_string()),
            color_indexed: Some(10),
            color_theme: Some(1),
            color_tint: Some(0.5),
            charset: Some(1),
            family: Some(2),
            scheme: Some("minor".to_string()),
            vert_align: Some("superscript".to_string()),
            preserve_space: true,
        }],
        xr_uid: Some("{ABC-123}".to_string()),
        shape_id: Some(0),
        ext_lst_xml: Some("<extLst/>".to_string()),
        comment_type: CommentType::Note,
        visible: Some(true),
        note_height: Some(59.25),
        note_width: Some(108.0),
        note_shape_anchor: Some(NoteShapeAnchor {
            left_column: 1,
            left_offset: 2,
            top_row: 3,
            top_offset: 4,
            right_column: 5,
            right_offset: 6,
            bottom_row: 7,
            bottom_offset: 8,
        }),
        ..Default::default()
    };

    assert_eq!(
        original,
        roundtrip_map(comment::to_yrs_prelim(&original), |map, txn| {
            comment::from_yrs_map(map, txn)
        })
    );
}
