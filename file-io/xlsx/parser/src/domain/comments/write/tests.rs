use super::helpers::{current_timestamp, indices_to_cell_ref, parse_cell_ref};
use super::*;
use domain_types::domain::comment::CommentType;

// -------------------------------------------------------------------------
// Helper function tests
// -------------------------------------------------------------------------

#[test]
fn test_generate_guid() {
    let guid1 = generate_guid();
    let guid2 = generate_guid();

    // Should have correct format
    assert!(guid1.starts_with('{'));
    assert!(guid1.ends_with('}'));
    assert_eq!(guid1.len(), 38); // {8-4-4-4-12} = 36 chars + 2 braces

    // Should be unique
    assert_ne!(guid1, guid2);
}

#[test]
fn test_parse_cell_ref() {
    assert_eq!(parse_cell_ref("A1"), (0, 0));
    assert_eq!(parse_cell_ref("B1"), (1, 0));
    assert_eq!(parse_cell_ref("Z1"), (25, 0));
    assert_eq!(parse_cell_ref("AA1"), (26, 0));
    assert_eq!(parse_cell_ref("AB1"), (27, 0));
    assert_eq!(parse_cell_ref("A100"), (0, 99));
    assert_eq!(parse_cell_ref("XFD1048576"), (16383, 1048575));
}

#[test]
fn test_indices_to_cell_ref() {
    assert_eq!(indices_to_cell_ref(0, 0), "A1");
    assert_eq!(indices_to_cell_ref(1, 0), "B1");
    assert_eq!(indices_to_cell_ref(25, 0), "Z1");
    assert_eq!(indices_to_cell_ref(26, 0), "AA1");
    assert_eq!(indices_to_cell_ref(27, 0), "AB1");
    assert_eq!(indices_to_cell_ref(0, 99), "A100");
}

#[test]
fn test_current_timestamp() {
    let ts = current_timestamp();
    // Should be in ISO 8601 format
    assert!(ts.contains('T'));
    assert!(ts.contains('-'));
    assert!(ts.contains(':'));
    assert!(ts.contains('.'));
}

// -------------------------------------------------------------------------
// CommentTextRun tests
// -------------------------------------------------------------------------

#[test]
fn test_comment_text_run_plain() {
    let run = CommentTextRun::plain("Hello");
    assert_eq!(run.text, "Hello");
    assert!(!run.bold);
    assert!(!run.italic);
}

#[test]
fn test_comment_text_run_bold() {
    let run = CommentTextRun::bold("Bold text");
    assert_eq!(run.text, "Bold text");
    assert!(run.bold);
    assert!(!run.italic);
}

#[test]
fn test_comment_text_run_italic() {
    let run = CommentTextRun::italic("Italic text");
    assert_eq!(run.text, "Italic text");
    assert!(!run.bold);
    assert!(run.italic);
}

// -------------------------------------------------------------------------
// CommentsWriter tests
// -------------------------------------------------------------------------

#[test]
fn test_comments_writer_new() {
    let writer = CommentsWriter::new();
    assert!(writer.is_empty());
    assert_eq!(writer.len(), 0);
}

#[test]
fn test_comments_writer_add_author() {
    let mut writer = CommentsWriter::new();
    let id1 = writer.add_author("John Doe");
    let id2 = writer.add_author("Jane Smith");

    assert_eq!(id1, 0);
    assert_eq!(id2, 1);
}

#[test]
fn test_comments_writer_get_or_create_author() {
    let mut writer = CommentsWriter::new();
    let id1 = writer.get_or_create_author("John Doe");
    let id2 = writer.get_or_create_author("John Doe");
    let id3 = writer.get_or_create_author("Jane Smith");

    assert_eq!(id1, 0);
    assert_eq!(id2, 0); // Same author, same ID
    assert_eq!(id3, 1);
}

#[test]
fn test_comments_writer_add_simple() {
    let mut writer = CommentsWriter::new();
    writer.add_simple("A1", "John Doe", "Test comment");

    assert_eq!(writer.len(), 1);
    assert!(!writer.is_empty());
}

#[test]
fn test_comments_writer_to_xml() {
    let mut writer = CommentsWriter::new();
    writer.add_simple("A1", "John Doe", "Test comment");

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    // Check XML structure
    assert!(xml_str.contains("<?xml version=\"1.0\""));
    assert!(xml_str.contains("<comments xmlns="));
    assert!(xml_str.contains("<authors>"));
    assert!(xml_str.contains("<author>John Doe</author>"));
    assert!(xml_str.contains("<commentList>"));
    assert!(xml_str.contains("ref=\"A1\""));
    assert!(xml_str.contains("authorId=\"0\""));
    assert!(xml_str.contains("Test comment"));
}

#[test]
fn test_comments_writer_to_xml_rich_text() {
    let mut writer = CommentsWriter::new();
    let author_id = writer.add_author("User");

    let comment = LegacyComment {
        cell_ref: "B2".to_string(),
        author_id,
        text: vec![
            CommentTextRun {
                text: "Bold ".to_string(),
                bold: true,
                font_size: Some(11.0),
                ..Default::default()
            },
            CommentTextRun {
                text: "Normal".to_string(),
                ..Default::default()
            },
        ],
        visible: false,
        shape_id: None,
        xr_uid: None,
        comment_pr: None,
    };
    writer.add_comment(comment);

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("<r>"));
    assert!(xml_str.contains("<rPr>"));
    assert!(xml_str.contains("<b/>"));
    assert!(xml_str.contains("val=\"11\""));
    assert!(xml_str.contains("Bold "));
    assert!(xml_str.contains("Normal"));
}

#[test]
fn test_comments_writer_to_vml() {
    let mut writer = CommentsWriter::new();
    writer.add_simple("A1", "John Doe", "Test comment");

    let vml = writer.to_vml();
    let vml_str = String::from_utf8(vml).unwrap();

    // Check VML structure
    assert!(vml_str.contains("xmlns:v=\"urn:schemas-microsoft-com:vml\""));
    assert!(vml_str.contains("xmlns:o=\"urn:schemas-microsoft-com:office:office\""));
    assert!(vml_str.contains("xmlns:x=\"urn:schemas-microsoft-com:office:excel\""));
    assert!(vml_str.contains("<o:shapelayout"));
    assert!(vml_str.contains("<v:shapetype"));
    assert!(vml_str.contains("<v:shape"));
    assert!(vml_str.contains("ObjectType=\"Note\""));
    assert!(vml_str.contains("<x:Anchor>"));
    assert!(vml_str.contains("<x:Row>"));
    assert!(vml_str.contains("<x:Column>"));
}

#[test]
fn test_comments_writer_multiple_comments() {
    let mut writer = CommentsWriter::new();
    writer
        .add_simple("A1", "User1", "First comment")
        .add_simple("B2", "User2", "Second comment")
        .add_simple("C3", "User1", "Third comment");

    assert_eq!(writer.len(), 3);

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("ref=\"A1\""));
    assert!(xml_str.contains("ref=\"B2\""));
    assert!(xml_str.contains("ref=\"C3\""));
    assert!(xml_str.contains("<author>User1</author>"));
    assert!(xml_str.contains("<author>User2</author>"));
}

// -------------------------------------------------------------------------
// ThreadedCommentsWriter tests
// -------------------------------------------------------------------------

#[test]
fn test_threaded_writer_new() {
    let writer = ThreadedCommentsWriter::new();
    assert!(writer.is_empty());
    assert_eq!(writer.len(), 0);
}

#[test]
fn test_threaded_writer_add_author() {
    let mut writer = ThreadedCommentsWriter::new();
    let id = writer.add_author("John Doe");

    assert!(!id.is_empty());
    assert!(id.starts_with('{'));
    assert!(id.ends_with('}'));
}

#[test]
fn test_threaded_writer_add_simple() {
    let mut writer = ThreadedCommentsWriter::new();
    let author_id = writer.add_author("John Doe");
    writer.add_simple("A1", &author_id, "Test comment");

    assert_eq!(writer.len(), 1);
}

#[test]
fn test_threaded_writer_add_reply() {
    let mut writer = ThreadedCommentsWriter::new();
    let author1 = writer.add_author("User1");
    let author2 = writer.add_author("User2");

    let parent_id = "{11111111-1111-1111-1111-111111111111}".to_string();
    writer.add_comment(ThreadedComment {
        id: parent_id.clone(),
        cell_ref: "A1".to_string(),
        author_id: author1,
        text: "Original comment".to_string(),
        timestamp: current_timestamp(),
        parent_id: None,
        done: false,
        ext_lst_xml: None,
        mentions: Vec::new(),
    });

    writer.add_reply(&parent_id, &author2, "Reply to original");

    assert_eq!(writer.len(), 2);
    let xml = String::from_utf8(writer.to_xml()).unwrap();
    assert!(xml.contains(&format!("parentId=\"{}\"", parent_id)));
    assert!(xml.contains("<text>Reply to original</text>"));
}

#[test]
fn test_threaded_writer_to_xml() {
    let mut writer = ThreadedCommentsWriter::new();
    let author_id = writer.add_author("John Doe");
    writer.add_simple("A1", &author_id, "Test comment");

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("<?xml version=\"1.0\""));
    assert!(xml_str.contains("<ThreadedComments xmlns="));
    assert!(
        xml_str.contains("http://schemas.microsoft.com/office/spreadsheetml/2018/threadedcomments")
    );
    assert!(xml_str.contains("<threadedComment"));
    assert!(xml_str.contains("ref=\"A1\""));
    assert!(xml_str.contains("personId="));
    assert!(xml_str.contains("dT="));
    assert!(xml_str.contains("<text>Test comment</text>"));
}

#[test]
fn test_threaded_writer_to_xml_with_reply() {
    let mut writer = ThreadedCommentsWriter::new();
    let author1 = writer.add_author("User1");
    let author2 = writer.add_author("User2");

    let parent_id = "{22222222-2222-2222-2222-222222222222}".to_string();
    writer.add_comment(ThreadedComment {
        id: parent_id.clone(),
        cell_ref: "A1".to_string(),
        author_id: author1,
        text: "Original".to_string(),
        timestamp: current_timestamp(),
        parent_id: None,
        done: false,
        ext_lst_xml: None,
        mentions: Vec::new(),
    });
    writer.add_reply(&parent_id, &author2, "Reply");

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("parentId="));
}

#[test]
fn test_threaded_writer_to_persons_xml() {
    let mut writer = ThreadedCommentsWriter::new();
    writer.add_author("John Doe");
    writer.add_author("Jane Smith");

    let xml = writer.to_persons_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("<?xml version=\"1.0\""));
    assert!(xml_str.contains("<personList xmlns="));
    assert!(xml_str.contains("<person"));
    assert!(xml_str.contains("displayName=\"John Doe\""));
    assert!(xml_str.contains("displayName=\"Jane Smith\""));
    assert!(xml_str.contains("id=\"{"));
}

#[test]
fn test_threaded_writer_done_comment() {
    let mut writer = ThreadedCommentsWriter::new();
    let author_id = writer.add_author("User");

    let comment = ThreadedComment {
        id: generate_guid(),
        cell_ref: "A1".to_string(),
        author_id: author_id.clone(),
        text: "Resolved comment".to_string(),
        timestamp: current_timestamp(),
        parent_id: None,
        done: true,
        ext_lst_xml: None,
        mentions: Vec::new(),
    };
    writer.add_comment(comment);

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("done=\"1\""));
}

// -------------------------------------------------------------------------
// CommentShape tests
// -------------------------------------------------------------------------

#[test]
fn test_comment_shape_for_cell() {
    let shape = CommentShape::for_cell("A1");
    assert_eq!(shape.cell_ref, "A1");
    assert_eq!(shape.left_col, 1);
    assert_eq!(shape.top_row, 0);
    assert!(!shape.visible);
}

#[test]
fn test_comment_shape_for_cell_b5() {
    let shape = CommentShape::for_cell("B5");
    assert_eq!(shape.cell_ref, "B5");
    assert_eq!(shape.left_col, 2); // B is col 1, so left_col = 1 + 1 = 2
    assert_eq!(shape.top_row, 4); // Row 5 is index 4
}

// -------------------------------------------------------------------------
// Integration tests
// -------------------------------------------------------------------------

#[test]
fn test_roundtrip_comments_xml() {
    let mut writer = CommentsWriter::new();
    writer
        .add_simple("A1", "Author1", "Comment 1")
        .add_simple("B2", "Author2", "Comment 2");

    let xml = writer.to_xml();

    // Parse it back (basic validation)
    let xml_str = String::from_utf8(xml).unwrap();
    assert!(xml_str.contains("Comment 1"));
    assert!(xml_str.contains("Comment 2"));
    assert!(xml_str.contains("Author1"));
    assert!(xml_str.contains("Author2"));
}

#[test]
fn test_xml_escaping_in_comments() {
    let mut writer = CommentsWriter::new();
    writer.add_simple("A1", "John & Jane", "Test <tag> & \"quotes\"");

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    // Should have escaped entities in author name (appears in text content)
    assert!(xml_str.contains("John &amp; Jane"));
    // Should escape angle brackets in text content
    assert!(xml_str.contains("&lt;tag&gt;"));
    // Should escape ampersand
    assert!(xml_str.contains("&amp;"));
    // Double quotes don't need to be escaped in XML text content
    // (only in attribute values), so they appear as-is
    assert!(xml_str.contains("\"quotes\""));
}

#[test]
fn test_empty_comments_writer() {
    let writer = CommentsWriter::new();
    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    // Should still produce valid XML
    assert!(xml_str.contains("<comments"));
    assert!(xml_str.contains("<authors>"));
    assert!(xml_str.contains("</authors>"));
    assert!(xml_str.contains("<commentList>"));
    assert!(xml_str.contains("</commentList>"));
}

#[test]
fn test_threaded_author_full() {
    let mut writer = ThreadedCommentsWriter::new();
    let author = ThreadedAuthor {
        id: "{12345678-1234-1234-1234-123456789012}".to_string(),
        display_name: "John Doe".to_string(),
        user_id: Some("john.doe@example.com".to_string()),
        provider_id: Some("AD".to_string()),
    };
    writer.add_author_full(author);

    let xml = writer.to_persons_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("id=\"{12345678-1234-1234-1234-123456789012}\""));
    assert!(xml_str.contains("userId=\"john.doe@example.com\""));
    assert!(xml_str.contains("providerId=\"AD\""));
}

#[test]
fn test_get_author_id() {
    let mut writer = ThreadedCommentsWriter::new();
    writer.add_author("John Doe");
    writer.add_author("Jane Smith");

    let id1 = writer.get_author_id("John Doe");
    let id2 = writer.get_author_id("Jane Smith");
    let id3 = writer.get_author_id("Unknown");

    assert!(id1.is_some());
    assert!(id2.is_some());
    assert!(id3.is_none());
}

#[test]
fn test_comment_with_newlines() {
    let mut writer = CommentsWriter::new();
    writer.add_simple("A1", "User", "Line 1\nLine 2\nLine 3");

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    // preserve_space defaults to false, so xml:space="preserve" should NOT appear
    // unless explicitly set (round-trip from parsed data).
    assert!(!xml_str.contains("xml:space=\"preserve\""));
    assert!(xml_str.contains("Line 1\nLine 2\nLine 3"));
}

#[test]
fn test_comment_with_preserve_space_roundtrip() {
    let mut writer = CommentsWriter::new();
    let author_id = writer.get_or_create_author("User");
    let comment = LegacyComment {
        cell_ref: "A1".to_string(),
        author_id,
        text: vec![CommentTextRun {
            text: "  spaced  ".to_string(),
            preserve_space: true,
            ..Default::default()
        }],
        visible: false,
        shape_id: None,
        xr_uid: None,
        comment_pr: None,
    };
    let shape = CommentShape::for_cell("A1");
    writer.add_with_shape(comment, shape);

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("xml:space=\"preserve\""));
    assert!(xml_str.contains("  spaced  "));
}

// -------------------------------------------------------------------------
// Dispatch on `comment_type` (Track 1 invariant)
// -------------------------------------------------------------------------

#[test]
fn test_dispatch_note_writes_only_to_legacy_xml() {
    let note = domain_types::Comment {
        id: "note-001".to_string(),
        cell_ref: "A1".to_string(),
        author: "Alice".to_string(),
        content: Some("A legacy note".to_string()),
        comment_type: CommentType::Note,
        thread_id: None,
        parent_id: None,
        ..Default::default()
    };

    // Legacy comments XML must contain the note's author (not "tc=...").
    let (legacy_xml, _vml_xml) = comments_from_domain(1, &[note.clone()], None, None, None);
    let legacy_str = String::from_utf8(legacy_xml).expect("utf8");
    assert!(
        legacy_str.contains("<author>Alice</author>"),
        "legacy XML must contain note author"
    );
    assert!(
        !legacy_str.contains("tc="),
        "legacy XML for a note must NOT contain `tc=` author"
    );

    // Threaded XML must be `None` — notes never write threaded entries.
    let threaded = threaded_comments_xml_from_domain(&[note], None);
    assert!(
        threaded.is_none(),
        "notes must not produce threaded XML output"
    );
}

#[test]
fn test_note_with_tc_author_and_stale_thread_id_stays_legacy_only() {
    let note = domain_types::Comment {
        id: "note-001".to_string(),
        cell_ref: "A1".to_string(),
        author: "tc={LITERAL-AUTHOR}".to_string(),
        runs: vec![domain_types::RichTextRun {
            text: "Literal legacy note".to_string(),
            ..Default::default()
        }],
        comment_type: CommentType::Note,
        thread_id: Some("stale-thread-id".to_string()),
        xr_uid: Some("xr-note-uid".to_string()),
        ..Default::default()
    };

    let (legacy_xml, _vml_xml) = comments_from_domain(1, &[note.clone()], None, None, None);
    let legacy_str = String::from_utf8(legacy_xml).expect("utf8");

    assert!(legacy_str.contains("<author>tc={LITERAL-AUTHOR}</author>"));
    assert!(legacy_str.contains("Literal legacy note"));
    assert!(legacy_str.contains("xr:uid=\"xr-note-uid\""));
    assert!(
        !legacy_str.contains("stale-thread-id"),
        "a note's thread_id metadata must not rewrite its legacy author or xr:uid"
    );
    assert!(
        threaded_comments_xml_from_domain(&[note], None).is_none(),
        "threaded XML is gated by CommentType, not thread_id"
    );
}

#[test]
fn test_dispatch_threaded_writes_to_both() {
    let thread = domain_types::Comment {
        id: "thread-001".to_string(),
        cell_ref: "B2".to_string(),
        author: "Bob".to_string(),
        content: Some("A thread".to_string()),
        comment_type: CommentType::ThreadedComment,
        thread_id: Some("thread-001".to_string()),
        parent_id: None,
        ..Default::default()
    };

    let (legacy_xml, _vml_xml) = comments_from_domain(1, &[thread.clone()], None, None, None);
    let legacy_str = String::from_utf8(legacy_xml).expect("utf8");
    assert!(
        legacy_str.contains("tc=thread-001"),
        "threaded comment must use `tc={{thread_id}}` author in legacy XML"
    );

    let threaded = threaded_comments_xml_from_domain(&[thread], None)
        .expect("threaded comment must produce threaded XML");
    let threaded_str = String::from_utf8(threaded).expect("utf8");
    assert!(threaded_str.contains("thread-001"));
}

#[test]
fn test_dispatch_threaded_reply_uses_own_comment_id() {
    let root = domain_types::Comment {
        id: "thread-root".to_string(),
        cell_ref: "B2".to_string(),
        author: "Alice".to_string(),
        content: Some("Root".to_string()),
        comment_type: CommentType::ThreadedComment,
        thread_id: Some("thread-root".to_string()),
        person_id: Some("person-alice".to_string()),
        parent_id: None,
        ..Default::default()
    };
    let reply = domain_types::Comment {
        id: "reply-001".to_string(),
        cell_ref: "B2".to_string(),
        author: "Bob".to_string(),
        content: Some("Reply".to_string()),
        comment_type: CommentType::ThreadedComment,
        thread_id: Some("thread-root".to_string()),
        person_id: Some("person-bob".to_string()),
        parent_id: Some("thread-root".to_string()),
        ..Default::default()
    };

    let threaded = threaded_comments_xml_from_domain(&[root, reply], None)
        .expect("threaded comments must produce threaded XML");
    let threaded_str = String::from_utf8(threaded).expect("utf8");

    assert!(threaded_str.contains(r#"id="thread-root""#));
    assert!(threaded_str.contains(r#"id="reply-001""#));
    assert!(threaded_str.contains(r#"parentId="thread-root""#));
}
