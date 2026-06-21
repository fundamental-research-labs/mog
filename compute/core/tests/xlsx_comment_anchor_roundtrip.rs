use std::sync::Arc;

use cell_types::SheetId;
use compute_core::storage::engine::YrsComputeEngine;
use domain_types::domain::comment::{CommentType, NoteShapeAnchor, PersonInfo, RichTextRun};
use domain_types::domain::floating_object::{
    AnchorMode, FloatingObject, FloatingObjectAnchor, FloatingObjectCommon, FloatingObjectData,
    ShapeData,
};
use domain_types::{CellData, Comment, ParseOutput, SheetData};
use value_types::CellValue;
use xlsx_parser::write::write_xlsx_from_parse_output;

fn text_cell(row: u32, col: u32, text: &str) -> CellData {
    CellData {
        row,
        col,
        value: CellValue::Text(Arc::from(text)),
        ..Default::default()
    }
}

fn fixture_parse_output() -> ParseOutput {
    ParseOutput {
        persons: vec![
            PersonInfo {
                id: "{11111111-1111-1111-1111-111111111111}".to_string(),
                display_name: "Alice Threader".to_string(),
                user_id: Some("S::alice@example.com::11111111".to_string()),
                provider_id: Some("AD".to_string()),
            },
            PersonInfo {
                id: "{22222222-2222-2222-2222-222222222222}".to_string(),
                display_name: "Bob Reviewer".to_string(),
                user_id: Some("S::bob@example.com::22222222".to_string()),
                provider_id: Some("AD".to_string()),
            },
        ],
        has_persons_part: true,
        sheets: vec![SheetData {
            name: "CommentAnchors".to_string(),
            rows: 1,
            cols: 1,
            cells: vec![text_cell(0, 0, "data")],
            comments: vec![
                Comment {
                    cell_ref: "AV1".to_string(),
                    author: "Wide".to_string(),
                    content: Some("wide empty anchor".to_string()),
                    comment_type: CommentType::Note,
                    visible: Some(true),
                    note_height: Some(96.0),
                    note_width: Some(144.0),
                    note_shape_anchor: Some(NoteShapeAnchor {
                        left_column: 47,
                        left_offset: 12,
                        top_row: 0,
                        top_offset: 8,
                        right_column: 49,
                        right_offset: 32,
                        bottom_row: 4,
                        bottom_offset: 18,
                    }),
                    ..Default::default()
                },
                Comment {
                    cell_ref: "B111".to_string(),
                    author: "HexLike".to_string(),
                    content: Some("A1-looking hex guard".to_string()),
                    comment_type: CommentType::Note,
                    ..Default::default()
                },
                Comment {
                    id: "{33333333-3333-3333-3333-333333333333}".to_string(),
                    cell_ref: "C3".to_string(),
                    author: "Alice Threader".to_string(),
                    author_id: Some("alice@example.com".to_string()),
                    content: Some("Thread root anchored at C3".to_string()),
                    runs: rich_text_runs("Thread root anchored at C3"),
                    thread_id: Some("{33333333-3333-3333-3333-333333333333}".to_string()),
                    person_id: Some("{11111111-1111-1111-1111-111111111111}".to_string()),
                    resolved: Some(true),
                    timestamp: Some("2026-01-02T03:04:05.000Z".to_string()),
                    comment_type: CommentType::ThreadedComment,
                    ..Default::default()
                },
                Comment {
                    id: "{44444444-4444-4444-4444-444444444444}".to_string(),
                    cell_ref: "C3".to_string(),
                    author: "Bob Reviewer".to_string(),
                    author_id: Some("bob@example.com".to_string()),
                    content: Some("Thread reply anchored at C3".to_string()),
                    runs: rich_text_runs("Thread reply anchored at C3"),
                    thread_id: Some("{33333333-3333-3333-3333-333333333333}".to_string()),
                    parent_id: Some("{33333333-3333-3333-3333-333333333333}".to_string()),
                    person_id: Some("{22222222-2222-2222-2222-222222222222}".to_string()),
                    resolved: Some(true),
                    timestamp: Some("2026-01-02T03:05:06.000Z".to_string()),
                    comment_type: CommentType::ThreadedComment,
                    ..Default::default()
                },
            ],
            ..Default::default()
        }],
        ..Default::default()
    }
}

fn rich_text_runs(text: &str) -> Vec<RichTextRun> {
    vec![RichTextRun {
        text: text.to_string(),
        ..Default::default()
    }]
}

fn is_cell_id_hex(s: &str) -> bool {
    s.len() == 32 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

fn stored_comment_by_author<'a>(comments: &'a [Comment], author: &str) -> &'a Comment {
    comments
        .iter()
        .find(|comment| comment.author == author)
        .unwrap_or_else(|| panic!("missing stored comment by {author}"))
}

fn exported_ref_by_author<'a>(comments: &'a [Comment], author: &str) -> &'a str {
    comments
        .iter()
        .find(|comment| comment.author == author)
        .map(|comment| comment.cell_ref.as_str())
        .unwrap_or_else(|| panic!("missing exported comment by {author}"))
}

fn comment_by_content<'a>(comments: &'a [Comment], content: &str) -> &'a Comment {
    comments
        .iter()
        .find(|comment| comment.content.as_deref() == Some(content))
        .unwrap_or_else(|| panic!("missing comment with content {content}"))
}

#[test]
fn l2_preserves_empty_comment_anchor_identity_without_data_cells() {
    let input = fixture_parse_output();
    let input_bytes = write_xlsx_from_parse_output(&input).expect("write input xlsx");

    let (engine, _) = YrsComputeEngine::from_xlsx_bytes(&input_bytes).expect("from_xlsx_bytes");
    let sheet_id = SheetId::from_uuid_str(
        engine
            .get_sheet_order()
            .first()
            .expect("imported workbook should have a sheet"),
    )
    .expect("sheet id");

    let stored_comments = engine.get_all_comments(&sheet_id);
    assert_eq!(stored_comments.len(), 4);

    for (author, row, col) in [("Wide", 0, 47), ("HexLike", 110, 1)] {
        let comment = stored_comment_by_author(&stored_comments, author);
        assert!(
            is_cell_id_hex(&comment.cell_ref),
            "hydrated comment ref for {author} should be CellId hex, got {}",
            comment.cell_ref
        );

        let grid_cell = engine
            .get_cell_id_at(&sheet_id, row, col)
            .unwrap_or_else(|| panic!("{author} anchor should resolve in runtime GridIndex"));
        assert_eq!(grid_cell, comment.cell_ref);

        let pos = engine
            .get_cell_position(&sheet_id, &comment.cell_ref)
            .unwrap_or_else(|| panic!("{author} CellId should resolve to a position"));
        assert_eq!((pos.row, pos.col), (row, col));
    }

    let thread_root = comment_by_content(&stored_comments, "Thread root anchored at C3");
    let thread_reply = comment_by_content(&stored_comments, "Thread reply anchored at C3");
    assert_eq!(thread_root.comment_type, CommentType::ThreadedComment);
    assert_eq!(thread_reply.comment_type, CommentType::ThreadedComment);
    assert_eq!(
        thread_root.person_id.as_deref(),
        Some("{11111111-1111-1111-1111-111111111111}")
    );
    assert_eq!(
        thread_reply.person_id.as_deref(),
        Some("{22222222-2222-2222-2222-222222222222}")
    );
    assert_eq!(
        thread_root.author_email.as_deref(),
        Some("alice@example.com")
    );
    assert_eq!(
        thread_reply.parent_id.as_deref(),
        Some(thread_root.id.as_str())
    );
    assert_eq!(thread_reply.thread_id, thread_root.thread_id);
    assert_eq!(thread_root.resolved, Some(true));
    let thread_pos = engine
        .get_cell_position(&sheet_id, &thread_root.cell_ref)
        .expect("thread root CellId should resolve to a position");
    assert_eq!((thread_pos.row, thread_pos.col), (2, 2));

    let exported = engine
        .export_to_parse_output()
        .expect("export_to_parse_output")
        .parse_output;
    let sheet = &exported.sheets[0];
    assert_eq!(sheet.rows, 1, "comment-only anchors must not grow rows");
    assert_eq!(sheet.cols, 1, "comment-only anchors must not grow cols");
    assert_eq!(exported_ref_by_author(&sheet.comments, "Wide"), "AV1");
    assert_eq!(exported_ref_by_author(&sheet.comments, "HexLike"), "B111");
    assert_eq!(
        exported_ref_by_author(&sheet.comments, "Alice Threader"),
        "C3"
    );
    assert_eq!(exported.persons.len(), 2);
    assert!(exported.has_persons_part);

    let exported_note = stored_comment_by_author(&sheet.comments, "Wide");
    assert_eq!(exported_note.comment_type, CommentType::Note);
    assert_eq!(exported_note.visible, Some(true));
    assert_eq!(exported_note.note_height, Some(96.0));
    assert_eq!(exported_note.note_width, Some(144.0));
    assert_eq!(
        exported_note.note_shape_anchor,
        Some(NoteShapeAnchor {
            left_column: 47,
            left_offset: 12,
            top_row: 0,
            top_offset: 8,
            right_column: 49,
            right_offset: 32,
            bottom_row: 4,
            bottom_offset: 18,
        })
    );

    let exported_root = comment_by_content(&sheet.comments, "Thread root anchored at C3");
    let exported_reply = comment_by_content(&sheet.comments, "Thread reply anchored at C3");
    assert_eq!(exported_root.comment_type, CommentType::ThreadedComment);
    assert_eq!(exported_reply.comment_type, CommentType::ThreadedComment);
    assert_eq!(
        exported_reply.parent_id.as_deref(),
        Some(exported_root.id.as_str())
    );
    assert_eq!(exported_root.resolved, Some(true));
    assert!(
        !sheet
            .cells
            .iter()
            .any(|cell| matches!((cell.row, cell.col), (0, 47) | (110, 1))),
        "comment-only anchors must not export data cells"
    );

    let exported_bytes = engine.export_to_xlsx_bytes().expect("export_to_xlsx_bytes");
    let (reparsed, _diagnostics) =
        xlsx_parser::parse_xlsx_to_output(&exported_bytes).expect("parse exported xlsx");
    let reparsed_sheet = &reparsed.sheets[0];
    assert_eq!(
        exported_ref_by_author(&reparsed_sheet.comments, "Wide"),
        "AV1"
    );
    assert_eq!(
        exported_ref_by_author(&reparsed_sheet.comments, "HexLike"),
        "B111"
    );
    assert_eq!(
        exported_ref_by_author(&reparsed_sheet.comments, "Alice Threader"),
        "C3"
    );
    assert_eq!(reparsed.persons.len(), 2);
    assert!(reparsed.has_persons_part);
    let reparsed_note = stored_comment_by_author(&reparsed_sheet.comments, "Wide");
    assert_eq!(reparsed_note.comment_type, CommentType::Note);
    assert_eq!(
        reparsed_note.note_shape_anchor,
        Some(NoteShapeAnchor {
            left_column: 47,
            left_offset: 12,
            top_row: 0,
            top_offset: 8,
            right_column: 49,
            right_offset: 32,
            bottom_row: 4,
            bottom_offset: 18,
        })
    );
    let reparsed_root = comment_by_content(&reparsed_sheet.comments, "Thread root anchored at C3");
    let reparsed_reply =
        comment_by_content(&reparsed_sheet.comments, "Thread reply anchored at C3");
    assert_eq!(reparsed_root.comment_type, CommentType::ThreadedComment);
    assert_eq!(reparsed_reply.comment_type, CommentType::ThreadedComment);
    assert_eq!(
        reparsed_root.person_id.as_deref(),
        Some("{11111111-1111-1111-1111-111111111111}")
    );
    assert_eq!(reparsed_reply.thread_id, reparsed_root.thread_id);
    assert_eq!(
        reparsed_reply.parent_id.as_deref(),
        Some(reparsed_root.id.as_str())
    );
    assert_eq!(reparsed_root.resolved, Some(true));
    assert!(
        !reparsed_sheet
            .cells
            .iter()
            .any(|cell| matches!((cell.row, cell.col), (0, 47) | (110, 1))),
        "reparsed XLSX must not contain data cells for comment-only anchors"
    );
}

fn shape_object(id: &str, name: &str, anchor: FloatingObjectAnchor) -> FloatingObject {
    FloatingObject {
        common: FloatingObjectCommon {
            id: id.to_string(),
            name: name.to_string(),
            width: 120.0,
            height: 80.0,
            anchor,
            ..Default::default()
        },
        data: FloatingObjectData::Shape(ShapeData {
            shape_type: "rect".to_string(),
            ..Default::default()
        }),
    }
}

fn anchor_object<'a>(objects: &'a [FloatingObject], name: &str) -> &'a FloatingObject {
    objects
        .iter()
        .find(|object| object.common.name == name)
        .unwrap_or_else(|| panic!("missing floating object {name}"))
}

fn assert_one_cell_anchor(objects: &[FloatingObject]) {
    let anchor = &anchor_object(objects, "One Cell Anchor").common.anchor;
    assert_eq!(anchor.anchor_mode, AnchorMode::OneCell);
    assert_eq!(anchor.anchor_row, 1);
    assert_eq!(anchor.anchor_col, 2);
    assert_eq!(anchor.anchor_row_offset, 10);
    assert_eq!(anchor.anchor_col_offset, 20);
    assert_eq!(anchor.extent_cx, Some(1_143_000));
    assert_eq!(anchor.extent_cy, Some(762_000));
}

fn assert_two_cell_anchor(objects: &[FloatingObject]) {
    let anchor = &anchor_object(objects, "Two Cell Anchor").common.anchor;
    assert_eq!(anchor.anchor_mode, AnchorMode::TwoCell);
    assert_eq!(anchor.anchor_row, 4);
    assert_eq!(anchor.anchor_col, 1);
    assert_eq!(anchor.anchor_row_offset, 30);
    assert_eq!(anchor.anchor_col_offset, 40);
    assert_eq!(anchor.end_row, Some(9));
    assert_eq!(anchor.end_col, Some(5));
    assert_eq!(anchor.end_row_offset, Some(50));
    assert_eq!(anchor.end_col_offset, Some(60));
}

fn assert_absolute_anchor(objects: &[FloatingObject]) {
    let anchor = &anchor_object(objects, "Absolute Anchor").common.anchor;
    assert_eq!(anchor.anchor_mode, AnchorMode::Absolute);
    assert_eq!(anchor.absolute_x, Some(321_000));
    assert_eq!(anchor.absolute_y, Some(654_000));
    assert_eq!(anchor.extent_cx, Some(952_500));
    assert_eq!(anchor.extent_cy, Some(476_250));
}

#[test]
fn l2_preserves_typed_floating_object_anchors_through_xlsx_import_export() {
    let input = ParseOutput {
        sheets: vec![SheetData {
            name: "FloatingAnchors".to_string(),
            rows: 12,
            cols: 8,
            cells: vec![text_cell(0, 0, "anchor data")],
            floating_objects: vec![
                shape_object(
                    "shape-one-cell",
                    "One Cell Anchor",
                    FloatingObjectAnchor {
                        anchor_row: 1,
                        anchor_col: 2,
                        anchor_row_offset: 10,
                        anchor_col_offset: 20,
                        anchor_mode: AnchorMode::OneCell,
                        extent_cx: Some(1_143_000),
                        extent_cy: Some(762_000),
                        ..Default::default()
                    },
                ),
                shape_object(
                    "shape-two-cell",
                    "Two Cell Anchor",
                    FloatingObjectAnchor {
                        anchor_row: 4,
                        anchor_col: 1,
                        anchor_row_offset: 30,
                        anchor_col_offset: 40,
                        anchor_mode: AnchorMode::TwoCell,
                        end_row: Some(9),
                        end_col: Some(5),
                        end_row_offset: Some(50),
                        end_col_offset: Some(60),
                        ..Default::default()
                    },
                ),
                shape_object(
                    "shape-absolute",
                    "Absolute Anchor",
                    FloatingObjectAnchor {
                        anchor_mode: AnchorMode::Absolute,
                        absolute_x: Some(321_000),
                        absolute_y: Some(654_000),
                        extent_cx: Some(952_500),
                        extent_cy: Some(476_250),
                        ..Default::default()
                    },
                ),
            ],
            ..Default::default()
        }],
        ..Default::default()
    };

    let input_bytes = write_xlsx_from_parse_output(&input).expect("write input xlsx");
    let (engine, _) = YrsComputeEngine::from_xlsx_bytes(&input_bytes).expect("from_xlsx_bytes");

    let exported = engine
        .export_to_parse_output()
        .expect("export_to_parse_output")
        .parse_output;
    let exported_objects = &exported.sheets[0].floating_objects;
    assert_one_cell_anchor(exported_objects);
    assert_two_cell_anchor(exported_objects);
    assert_absolute_anchor(exported_objects);

    let exported_bytes = engine.export_to_xlsx_bytes().expect("export_to_xlsx_bytes");
    let (reparsed, _diagnostics) =
        xlsx_parser::parse_xlsx_to_output(&exported_bytes).expect("parse exported xlsx");
    let reparsed_objects = &reparsed.sheets[0].floating_objects;
    assert_one_cell_anchor(reparsed_objects);
    assert_two_cell_anchor(reparsed_objects);
    assert_absolute_anchor(reparsed_objects);
}
