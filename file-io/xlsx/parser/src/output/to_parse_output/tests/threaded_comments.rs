use super::super::{convert_sheet, merge_threaded_comments, threaded_candidate_ids};
use super::helpers::{comment_run, rich_run, threaded_comments_xml, threading_result};
use crate::infra::opc::REL_THREADED_COMMENT;
use crate::output::results::{CommentOutput, FullParsedSheet};
use domain_types::domain::comment::{CommentContentType, CommentType};
use domain_types::{Comment, SheetData};

#[test]
fn legacy_tc_author_without_threaded_relationship_stays_note() {
    let sheet = FullParsedSheet {
        comments: vec![CommentOutput {
            cell_ref: "B2".to_string(),
            author_id: 0,
            text: "literal note".to_string(),
            runs: vec![comment_run("literal note")],
            shape_id: Some(42),
            xr_uid: Some("{LEGACY-XR-UID}".to_string()),
            comment_pr: None,
        }],
        comment_authors: vec!["tc={LITERAL-AUTHOR}".to_string()],
        ..Default::default()
    };

    let sheet_data = convert_sheet(
        &sheet,
        &[],
        &[],
        &[],
        &[],
        &[],
        &std::collections::HashMap::new(),
        &std::collections::HashMap::<String, Vec<u8>>::new(),
        None,
    );

    let comment = sheet_data.comments.first().expect("comment");
    assert_eq!(comment.comment_type, CommentType::Note);
    assert_eq!(comment.author, "tc={LITERAL-AUTHOR}");
    assert_eq!(comment.content.as_deref(), Some("literal note"));
    assert_eq!(comment.runs.len(), 1);
    assert_eq!(comment.runs[0].text, "literal note");
    assert_eq!(comment.thread_id, None);
    assert_eq!(comment.xr_uid.as_deref(), Some("{LEGACY-XR-UID}"));
    assert_eq!(comment.shape_id, Some(42));
}

#[test]
fn unreachable_threaded_part_does_not_upgrade_legacy_tc_note() {
    let mut sheets = vec![SheetData {
        comments: vec![Comment {
            cell_ref: "B2".to_string(),
            author: "tc={THREAD-1}".to_string(),
            content: Some("legacy text".to_string()),
            runs: vec![rich_run("legacy text")],
            xr_uid: Some("{THREAD-1}".to_string()),
            comment_type: CommentType::Note,
            ..Default::default()
        }],
        ..Default::default()
    }];
    let result = threading_result(
        FullParsedSheet::default(),
        None,
        vec![(
            "xl/threadedComments/threadedComment1.xml".to_string(),
            threaded_comments_xml().to_vec(),
        )],
    );

    merge_threaded_comments(&result, &mut sheets);

    let comment = sheets[0].comments.first().expect("comment");
    assert_eq!(comment.comment_type, CommentType::Note);
    assert_eq!(comment.author, "tc={THREAD-1}");
    assert_eq!(comment.thread_id, None);
    assert_eq!(comment.xr_uid.as_deref(), Some("{THREAD-1}"));
    assert_eq!(comment.content.as_deref(), Some("legacy text"));
}

#[test]
fn threaded_candidate_ids_prefers_tc_author_payload_before_xr_uid() {
    let comment = Comment {
        author: "tc={AUTHOR-CANDIDATE}".to_string(),
        xr_uid: Some("{XR-CANDIDATE}".to_string()),
        ..Default::default()
    };

    let candidates: Vec<_> = threaded_candidate_ids(&comment).collect();

    assert_eq!(candidates, vec!["{AUTHOR-CANDIDATE}", "{XR-CANDIDATE}"]);
}

#[test]
fn relationship_backed_threaded_comment_upgrades_legacy_sentinel_and_adds_reply() {
    let mut sheets = vec![SheetData {
        comments: vec![Comment {
            cell_ref: "B2".to_string(),
            author: "tc={THREAD-1}".to_string(),
            content: Some("[Threaded comment] fallback".to_string()),
            runs: vec![rich_run("[Threaded comment] fallback")],
            xr_uid: Some("{THREAD-1}".to_string()),
            shape_id: Some(7),
            comment_type: CommentType::Note,
            ..Default::default()
        }],
        ..Default::default()
    }];
    let parsed_sheet = FullParsedSheet {
        sheet_opc_rels: vec![ooxml_types::shared::OpcRelationship {
            id: "rIdThreadedComments".to_string(),
            rel_type: REL_THREADED_COMMENT.to_string(),
            target: "../threadedComments/threadedComment1.xml".to_string(),
            target_mode: None,
        }],
        ..Default::default()
    };
    let result = threading_result(
        parsed_sheet,
        Some(
            br#"<personList><person displayName="Thread Author" id="P1"/><person displayName="Reply Author" id="P2"/></personList>"#
                .to_vec(),
        ),
        vec![(
            "xl/threadedComments/threadedComment1.xml".to_string(),
            threaded_comments_xml().to_vec(),
        )],
    );

    let persons = merge_threaded_comments(&result, &mut sheets);

    assert_eq!(persons.len(), 2);
    assert_eq!(sheets[0].comments.len(), 2);

    let root = &sheets[0].comments[0];
    assert_eq!(root.comment_type, CommentType::ThreadedComment);
    assert_eq!(root.thread_id.as_deref(), Some("{THREAD-1}"));
    assert_eq!(root.xr_uid, None);
    assert_eq!(root.author, "Thread Author");
    assert_eq!(root.content.as_deref(), Some("actual threaded root"));
    assert_eq!(root.person_id.as_deref(), Some("P1"));
    assert_eq!(root.timestamp.as_deref(), Some("2026-05-20T01:02:03Z"));
    assert_eq!(root.resolved, Some(true));
    assert_eq!(
        root.ext_lst_xml.as_deref(),
        Some("<extLst><ext uri=\"{x}\"/></extLst>")
    );
    assert_eq!(root.content_type, Some(CommentContentType::Mention));
    assert_eq!(root.mentions.len(), 1);
    assert_eq!(root.mentions[0].display_text, "Reply Author");
    assert_eq!(root.shape_id, Some(7));

    let reply = &sheets[0].comments[1];
    assert_eq!(reply.comment_type, CommentType::ThreadedComment);
    assert_eq!(reply.thread_id.as_deref(), Some("{REPLY-1}"));
    assert_eq!(reply.parent_id.as_deref(), Some("{THREAD-1}"));
    assert_eq!(reply.author, "Reply Author");
    assert_eq!(reply.content.as_deref(), Some("reply text"));
}

#[test]
fn threaded_merge_preserves_mixed_legacy_comment_order() {
    let mut sheets = vec![SheetData {
        comments: vec![
            Comment {
                cell_ref: "B2".to_string(),
                author: "tc={THREAD-1}".to_string(),
                content: Some("[Threaded comment] fallback".to_string()),
                runs: vec![rich_run("[Threaded comment] fallback")],
                xr_uid: Some("{THREAD-1}".to_string()),
                comment_type: CommentType::Note,
                ..Default::default()
            },
            Comment {
                cell_ref: "C3".to_string(),
                author: "Legacy Author".to_string(),
                content: Some("legacy note".to_string()),
                runs: vec![rich_run("legacy note")],
                comment_type: CommentType::Note,
                ..Default::default()
            },
            Comment {
                cell_ref: "D4".to_string(),
                author: "tc={THREAD-2}".to_string(),
                content: Some("[Threaded comment] fallback 2".to_string()),
                runs: vec![rich_run("[Threaded comment] fallback 2")],
                xr_uid: Some("{THREAD-2}".to_string()),
                comment_type: CommentType::Note,
                ..Default::default()
            },
        ],
        ..Default::default()
    }];
    let parsed_sheet = FullParsedSheet {
        sheet_opc_rels: vec![ooxml_types::shared::OpcRelationship {
            id: "rIdThreadedComments".to_string(),
            rel_type: REL_THREADED_COMMENT.to_string(),
            target: "../threadedComments/threadedComment1.xml".to_string(),
            target_mode: None,
        }],
        ..Default::default()
    };
    let result = threading_result(
        parsed_sheet,
        Some(br#"<personList><person displayName="Thread Author" id="P1"/></personList>"#.to_vec()),
        vec![(
            "xl/threadedComments/threadedComment1.xml".to_string(),
            br#"<ThreadedComments>
    <threadedComment ref="B2" id="{THREAD-1}" personId="P1"><text>root one</text></threadedComment>
    <threadedComment ref="D4" id="{THREAD-2}" personId="P1"><text>root two</text></threadedComment>
</ThreadedComments>"#
                .to_vec(),
        )],
    );

    merge_threaded_comments(&result, &mut sheets);

    let comments = &sheets[0].comments;
    assert_eq!(comments.len(), 3);
    assert_eq!(comments[0].cell_ref, "B2");
    assert_eq!(comments[0].comment_type, CommentType::ThreadedComment);
    assert_eq!(comments[1].cell_ref, "C3");
    assert_eq!(comments[1].comment_type, CommentType::Note);
    assert_eq!(comments[1].author, "Legacy Author");
    assert_eq!(comments[2].cell_ref, "D4");
    assert_eq!(comments[2].comment_type, CommentType::ThreadedComment);
}
