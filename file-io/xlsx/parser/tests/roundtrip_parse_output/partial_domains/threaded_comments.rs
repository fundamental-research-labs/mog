use std::sync::Arc;

use super::super::helpers::{cell, make_single_sheet};
use domain_types::{Comment, CommentType, PersonInfo};
use value_types::CellValue;
use xlsx_parser::infra::package_integrity::validate_archive_package_integrity;
use xlsx_parser::parse_xlsx_to_output;
use xlsx_parser::write::write_xlsx_from_parse_output;
use xlsx_parser::zip::XlsxArchive;

#[test]
fn threaded_comment_export_registers_comment_and_person_package_graph() {
    let mut output = make_single_sheet(
        "Comments",
        vec![cell(0, 0, CellValue::Text(Arc::from("threaded")))],
    );
    output.persons = vec![PersonInfo {
        id: "{PERSON-1}".to_string(),
        display_name: "Modeled Author".to_string(),
        user_id: Some("S::author@example.com::1".to_string()),
        provider_id: Some("AD".to_string()),
    }];
    output.sheets[0].comments = vec![Comment {
        id: "comment-1".to_string(),
        cell_ref: "A1".to_string(),
        author: "Modeled Author".to_string(),
        author_id: Some("S::author@example.com::1".to_string()),
        content: Some("Threaded package comment".to_string()),
        thread_id: Some("thread-1".to_string()),
        person_id: Some("{PERSON-1}".to_string()),
        timestamp: Some("2026-05-27T10:00:00Z".to_string()),
        comment_type: CommentType::ThreadedComment,
        ..Default::default()
    }];

    let bytes =
        write_xlsx_from_parse_output(&output).expect("threaded comment export should succeed");
    let archive = XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_rels = String::from_utf8(
        archive
            .read_file("xl/worksheets/_rels/sheet1.xml.rels")
            .unwrap(),
    )
    .unwrap();
    let workbook_rels =
        String::from_utf8(archive.read_file("xl/_rels/workbook.xml.rels").unwrap()).unwrap();
    let threaded_xml = String::from_utf8(
        archive
            .read_file("xl/threadedComments/threadedComment1.xml")
            .unwrap(),
    )
    .unwrap();
    let persons_xml =
        String::from_utf8(archive.read_file("xl/persons/person.xml").unwrap()).unwrap();
    let content_types = String::from_utf8(archive.read_file("[Content_Types].xml").unwrap())
        .expect("content types should be UTF-8");

    assert!(sheet_rels.contains(xlsx_parser::write::REL_THREADED_COMMENT));
    assert!(sheet_rels.contains(r#"Target="../threadedComments/threadedComment1.xml""#));
    assert!(workbook_rels.contains(xlsx_parser::write::REL_PERSON));
    assert!(workbook_rels.contains(r#"Target="persons/person.xml""#));
    assert!(content_types.contains(r#"PartName="/xl/threadedComments/threadedComment1.xml""#));
    assert!(content_types.contains("application/vnd.ms-excel.threadedcomments+xml"));
    assert!(content_types.contains(r#"PartName="/xl/persons/person.xml""#));
    assert!(content_types.contains("application/vnd.ms-excel.person+xml"));
    assert!(threaded_xml.contains(r#"id="thread-1""#));
    assert!(threaded_xml.contains(r#"personId="{PERSON-1}""#));
    assert!(threaded_xml.contains("Threaded package comment"));
    assert!(persons_xml.contains("Modeled Author"));
    assert!(persons_xml.contains("{PERSON-1}"));

    validate_archive_package_integrity(&archive).expect("exported package should be valid");
    let (rt, _diagnostics) = parse_xlsx_to_output(&bytes).expect("exported XLSX should parse back");
    assert_eq!(rt.persons.len(), 1);
    assert_eq!(rt.persons[0].id, "{PERSON-1}");
    assert!(rt.sheets[0].comments.iter().any(|comment| {
        comment.comment_type == CommentType::ThreadedComment
            && comment.thread_id.as_deref() == Some("thread-1")
            && comment.person_id.as_deref() == Some("{PERSON-1}")
    }));
}

#[test]
fn threaded_comment_export_preserves_imported_part_path_not_relationship_id() {
    let mut output = make_single_sheet(
        "Comments",
        vec![cell(0, 0, CellValue::Text(Arc::from("threaded")))],
    );
    output.persons = vec![PersonInfo {
        id: "{PERSON-7}".to_string(),
        display_name: "Imported Author".to_string(),
        user_id: Some("S::author7@example.com::1".to_string()),
        provider_id: Some("AD".to_string()),
    }];
    output.sheets[0].comments = vec![Comment {
        id: "comment-7".to_string(),
        cell_ref: "A1".to_string(),
        author: "Imported Author".to_string(),
        author_id: Some("S::author7@example.com::1".to_string()),
        content: Some("Imported threaded package comment".to_string()),
        thread_id: Some("thread-7".to_string()),
        person_id: Some("{PERSON-7}".to_string()),
        timestamp: Some("2026-05-27T10:00:00Z".to_string()),
        comment_type: CommentType::ThreadedComment,
        ..Default::default()
    }];
    let bytes =
        write_xlsx_from_parse_output(&output).expect("threaded comment export should succeed");
    let archive = XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_rels = String::from_utf8(
        archive
            .read_file("xl/worksheets/_rels/sheet1.xml.rels")
            .unwrap(),
    )
    .unwrap();
    let threaded_xml = String::from_utf8(
        archive
            .read_file("xl/threadedComments/threadedComment1.xml")
            .unwrap(),
    )
    .unwrap();
    let content_types = String::from_utf8(archive.read_file("[Content_Types].xml").unwrap())
        .expect("content types should be UTF-8");

    assert!(!sheet_rels.contains(r#"Id="rIdThreaded7""#));
    assert!(sheet_rels.contains(r#"Target="../threadedComments/threadedComment1.xml""#));
    assert!(content_types.contains(r#"PartName="/xl/threadedComments/threadedComment1.xml""#));
    assert!(threaded_xml.contains(r#"id="thread-7""#));
    assert!(threaded_xml.contains(r#"personId="{PERSON-7}""#));
    assert!(threaded_xml.contains("Imported threaded package comment"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");

    let (rt, _diagnostics) = parse_xlsx_to_output(&bytes).expect("exported XLSX should parse back");
    assert!(rt.sheets[0].comments.iter().any(|comment| {
        comment.comment_type == CommentType::ThreadedComment
            && comment.thread_id.as_deref() == Some("thread-7")
            && comment.person_id.as_deref() == Some("{PERSON-7}")
    }));
}
