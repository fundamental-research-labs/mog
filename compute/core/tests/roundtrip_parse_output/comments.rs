use std::sync::Arc;

use super::helpers::*;
use domain_types::{Comment, CommentType};
use value_types::CellValue;

#[test]
fn roundtrip_comments() {
    let mut output = make_single_sheet(
        "Comments",
        vec![
            cell(0, 0, CellValue::Text(Arc::from("Has comment"))),
            cell(1, 0, CellValue::Text(Arc::from("Also commented"))),
        ],
    );
    output.sheets[0].comments = vec![
        Comment {
            cell_ref: "A1".to_string(),
            author: "Alice".to_string(),
            content: Some("This is a comment on A1".to_string()),
            comment_type: CommentType::Note,
            ..Default::default()
        },
        Comment {
            cell_ref: "A2".to_string(),
            author: "Bob".to_string(),
            content: Some("Another comment on A2".to_string()),
            comment_type: CommentType::Note,
            ..Default::default()
        },
    ];

    let rt = roundtrip(&output);
    assert_eq!(rt.sheets.len(), 1);

    let rt_comments = &rt.sheets[0].comments;
    assert!(
        rt_comments.len() >= 2,
        "Expected at least 2 comments, got {}",
        rt_comments.len()
    );

    // Build lookup by cell_ref
    let rt_map: std::collections::HashMap<&str, &Comment> = rt_comments
        .iter()
        .map(|c| (c.cell_ref.as_str(), c))
        .collect();

    let c1 = rt_map
        .get("A1")
        .expect("Comment on A1 should survive round-trip");
    assert_eq!(c1.author, "Alice", "Author should be preserved");
    // Content may be in `content` or reconstructed from `runs`
    let c1_text = c1.content.as_deref().unwrap_or_else(|| {
        // fallback: check runs
        if !c1.runs.is_empty() { "has_runs" } else { "" }
    });
    assert!(
        c1_text.contains("comment on A1") || !c1.runs.is_empty(),
        "Comment content on A1 should be preserved. Got content={:?}, runs={:?}",
        c1.content,
        c1.runs
    );

    let c2 = rt_map
        .get("A2")
        .expect("Comment on A2 should survive round-trip");
    assert_eq!(c2.author, "Bob", "Author should be preserved");
}

#[test]
fn roundtrip_comment_with_rich_text_runs() {
    let mut output = make_single_sheet(
        "RichComments",
        vec![cell(0, 0, CellValue::Text(Arc::from("Cell")))],
    );
    output.sheets[0].comments = vec![Comment {
        cell_ref: "A1".to_string(),
        author: "Author".to_string(),
        content: Some("Bold and normal".to_string()),
        comment_type: CommentType::Note,
        runs: vec![
            domain_types::RichTextRun {
                text: "Bold".to_string(),
                bold: true,
                ..Default::default()
            },
            domain_types::RichTextRun {
                text: " and normal".to_string(),
                ..Default::default()
            },
        ],
        ..Default::default()
    }];

    let rt = roundtrip(&output);
    let rt_comments = &rt.sheets[0].comments;
    assert!(!rt_comments.is_empty(), "Comment should survive round-trip");

    let c = rt_comments
        .iter()
        .find(|c| c.cell_ref == "A1")
        .expect("Comment on A1 should exist");
    assert_eq!(c.author, "Author");
    // Verify some text content survived (either as content or runs)
    let has_content = c.content.as_ref().map_or(false, |s| !s.is_empty());
    let has_runs = !c.runs.is_empty();
    assert!(
        has_content || has_runs,
        "Comment should have content or runs after round-trip"
    );
}

#[test]
fn roundtrip_comments_keep_empty_wide_anchor_refs() {
    let mut output = make_single_sheet(
        "EmptyAnchors",
        vec![cell(0, 0, CellValue::Text(Arc::from("data")))],
    );
    output.sheets[0].comments = vec![
        Comment {
            cell_ref: "AV1".to_string(),
            author: "Wide".to_string(),
            content: Some("wide empty anchor".to_string()),
            comment_type: CommentType::Note,
            ..Default::default()
        },
        Comment {
            cell_ref: "B111".to_string(),
            author: "HexLike".to_string(),
            content: Some("A1-looking hex guard".to_string()),
            comment_type: CommentType::Note,
            ..Default::default()
        },
    ];

    let rt = roundtrip(&output);
    let refs: std::collections::HashSet<&str> = rt.sheets[0]
        .comments
        .iter()
        .map(|comment| comment.cell_ref.as_str())
        .collect();
    assert!(refs.contains("AV1"), "wide comment ref should survive L1");
    assert!(
        refs.contains("B111"),
        "A1-looking hex comment ref should survive L1"
    );
    assert!(
        !rt.sheets[0]
            .cells
            .iter()
            .any(|cell| matches!((cell.row, cell.col), (0, 47) | (110, 1))),
        "comment-only anchors must not become data cells in L1"
    );
}
