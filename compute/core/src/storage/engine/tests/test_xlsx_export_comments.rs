//! XLSX comment export contracts.

use super::helpers::{archive_text, engine_from_parse_output_normal};
use domain_types::{
    ParseOutput, SheetCommentPackageInfo, SheetData,
    domain::comment::{Comment, CommentType, PersonInfo, RichTextRun},
};
use value_types::CellValue;

#[test]
fn l2_xlsx_export_preserves_imported_comment_package_paths() {
    let thread_id = "{00000000-0000-0000-0000-000000000001}";
    let person_id = "{00000000-0000-0000-0000-0000000000A1}";
    let input = ParseOutput {
        sheets: vec![SheetData {
            name: "Comments".to_string(),
            rows: 1,
            cols: 2,
            cells: vec![
                domain_types::CellData {
                    row: 0,
                    col: 0,
                    value: CellValue::Text("note-cell".into()),
                    ..Default::default()
                },
                domain_types::CellData {
                    row: 0,
                    col: 1,
                    value: CellValue::Text("thread-cell".into()),
                    ..Default::default()
                },
            ],
            comments: vec![
                Comment {
                    cell_ref: "A1".to_string(),
                    author: "Test User".to_string(),
                    content: Some("hello".to_string()),
                    runs: vec![RichTextRun {
                        text: "hello".to_string(),
                        ..Default::default()
                    }],
                    comment_type: CommentType::Note,
                    ..Default::default()
                },
                Comment {
                    id: thread_id.to_string(),
                    cell_ref: "B1".to_string(),
                    author: "Test User".to_string(),
                    content: Some("world".to_string()),
                    runs: vec![RichTextRun {
                        text: format!("tc={thread_id}"),
                        ..Default::default()
                    }],
                    thread_id: Some(thread_id.to_string()),
                    person_id: Some(person_id.to_string()),
                    timestamp: Some("2026-04-26T00:00:00.00".to_string()),
                    comment_type: CommentType::ThreadedComment,
                    ..Default::default()
                },
            ],
            legacy_comment_authors: vec!["Test User".to_string(), format!("tc={thread_id}")],
            comment_package: Some(SheetCommentPackageInfo {
                comments_path_hint: Some("xl/comments/comment1.xml".to_string()),
                comments_relationship_id_hint: Some("comments".to_string()),
                vml_path_hint: Some("xl/drawings/commentsDrawing1.vml".to_string()),
                vml_relationship_id_hint: Some("anysvml".to_string()),
                threaded_comments_path_hint: Some(
                    "xl/threadedComments/threadedComment1.xml".to_string(),
                ),
                threaded_comments_relationship_id_hint: Some("rId99".to_string()),
                ..Default::default()
            }),
            ..Default::default()
        }],
        persons: vec![PersonInfo {
            id: person_id.to_string(),
            display_name: "Test User".to_string(),
            user_id: None,
            provider_id: Some("None".to_string()),
        }],
        has_persons_part: true,
        ..Default::default()
    };

    let engine = engine_from_parse_output_normal(&input);
    let exported_parse = engine
        .export_to_parse_output()
        .expect("production Yrs export should succeed")
        .parse_output;
    let exported_package = exported_parse.sheets[0]
        .comment_package
        .as_ref()
        .expect("comment package metadata should survive hydration");
    assert_eq!(
        exported_package.comments_path_hint.as_deref(),
        Some("xl/comments/comment1.xml")
    );
    assert_eq!(
        exported_package.vml_path_hint.as_deref(),
        Some("xl/drawings/commentsDrawing1.vml")
    );

    let exported_bytes = engine.export_to_xlsx_bytes().expect("export xlsx bytes");
    let comments_xml = archive_text(&exported_bytes, "xl/comments/comment1.xml")
        .expect("export should use imported comments path");
    assert!(comments_xml.contains(r#"ref="A1""#));
    assert!(comments_xml.contains(r#"ref="B1""#));
    assert!(comments_xml.contains("hello"));
    assert!(
        archive_text(&exported_bytes, "xl/comments1.xml").is_none(),
        "export should not create a regenerated default comments path"
    );
    assert!(
        archive_text(&exported_bytes, "xl/drawings/commentsDrawing1.vml").is_some(),
        "export should use imported VML path"
    );
    let rels = archive_text(&exported_bytes, "xl/worksheets/_rels/sheet1.xml.rels")
        .expect("worksheet rels should exist");
    assert!(rels.contains(r#"Id="comments""#));
    assert!(rels.contains(r#"Target="../comments/comment1.xml""#));
    assert!(rels.contains(r#"Id="anysvml""#));
    assert!(rels.contains(r#"Target="../drawings/commentsDrawing1.vml""#));
    assert!(rels.contains(r#"Id="rId99""#));
}
