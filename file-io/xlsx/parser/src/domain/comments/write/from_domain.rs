use domain_types::domain::comment::CommentType;

use super::legacy::CommentsWriter;
use super::threaded::ThreadedCommentsWriter;
use super::types::{
    CommentShape, CommentTextRun, LegacyComment, ThreadedAuthor, ThreadedComment, ThreadedMention,
};

// ============================================================================
// Bridge functions: domain → XML
// ============================================================================

/// Build comments XML and VML drawing XML from domain `Comment` list.
///
/// When `root_namespace_attrs` is provided, they are set on the `<comments>` root
/// element as owner-scoped lexical metadata.
///
/// Returns `(comments_xml, vml_xml)`.
pub fn comments_from_domain(
    _sheet_num: usize,
    comments: &[domain_types::Comment],
    _original_authors: Option<&[String]>,
    root_namespace_attrs: Option<&[(String, String)]>,
    root_ext_lst_xml: Option<&str>,
) -> (Vec<u8>, Vec<u8>) {
    comments_from_domain_with_package(
        _sheet_num,
        comments,
        _original_authors,
        root_namespace_attrs,
        root_ext_lst_xml,
        None,
    )
}

/// Build comments XML and VML drawing XML using owner-scoped package metadata.
pub fn comments_from_domain_with_package(
    _sheet_num: usize,
    comments: &[domain_types::Comment],
    _original_authors: Option<&[String]>,
    root_namespace_attrs: Option<&[(String, String)]>,
    root_ext_lst_xml: Option<&str>,
    comment_package: Option<&domain_types::SheetCommentPackageInfo>,
) -> (Vec<u8>, Vec<u8>) {
    let mut cw = CommentsWriter::new();

    if let Some(attrs) = root_namespace_attrs {
        cw.set_root_namespace_attrs(attrs.to_vec());
    }
    cw.set_root_ext_lst_xml(root_ext_lst_xml.map(ToOwned::to_owned));

    for comment in comments {
        // Skip threaded replies — they don't get their own legacy comment entry.
        if comment.parent_id.is_some() {
            continue;
        }

        let (author_name, runs, xr_uid) = if comment.comment_type == CommentType::ThreadedComment {
            // Threaded comment: legacy author is "tc={GUID}". The thread_id
            // is the canonical GUID; fall back to comment.id if missing
            // (storage invariant says threads have `Some(...)`, but the writer
            // is the last line of defense).
            let thread_id_str = comment
                .thread_id
                .as_deref()
                .unwrap_or(comment.id.as_str())
                .to_string();
            let tc_author = format!("tc={}", thread_id_str);

            // If the comment has original rich text runs from a parsed file, preserve
            // them for round-trip fidelity.  Only generate the placeholder stub when
            // creating a brand-new threaded comment that has no original runs.
            let runs = if !comment.runs.is_empty() {
                comment
                    .runs
                    .iter()
                    .map(|r| CommentTextRun {
                        text: r.text.clone(),
                        bold: r.bold,
                        italic: r.italic,
                        underline: r.underline,
                        strike: r.strikethrough,
                        font_size: r.font_size,
                        font_name: r.font_name.clone(),
                        color: r.color.clone(),
                        color_indexed: r.color_indexed,
                        color_theme: r.color_theme,
                        color_tint: r.color_tint,
                        font_family: r.family,
                        scheme: r.scheme.clone(),
                        charset: r.charset,
                        preserve_space: r.preserve_space,
                    })
                    .collect()
            } else {
                let stub_text = format!(
                    "[Threaded comment]\n\n\
                     Your version of Excel allows you to read this threaded comment; \
                     however, any edits to it will get removed if the file is opened \
                     in a newer version of Excel. Learn more: \
                     https://go.microsoft.com/fwlink/?linkid=870924\n\n\
                     Comment:\n    {}",
                    comment.content.as_deref().unwrap_or("")
                );
                vec![CommentTextRun {
                    text: stub_text,
                    ..Default::default()
                }]
            };
            (tc_author, runs, Some(thread_id_str))
        } else if comment.runs.is_empty() {
            let text = comment.content.as_deref().unwrap_or("");
            let runs = vec![
                CommentTextRun {
                    text: format!("{}:\n", comment.author),
                    bold: true,
                    font_size: Some(9.0),
                    font_name: Some("Tahoma".to_string()),
                    ..Default::default()
                },
                CommentTextRun {
                    text: text.to_string(),
                    font_size: Some(9.0),
                    font_name: Some("Tahoma".to_string()),
                    ..Default::default()
                },
            ];
            (comment.author.clone(), runs, None)
        } else {
            let runs = comment
                .runs
                .iter()
                .map(|r| CommentTextRun {
                    text: r.text.clone(),
                    bold: r.bold,
                    italic: r.italic,
                    underline: r.underline,
                    strike: r.strikethrough,
                    font_size: r.font_size,
                    font_name: r.font_name.clone(),
                    color: r.color.clone(),
                    color_indexed: r.color_indexed,
                    color_theme: r.color_theme,
                    color_tint: r.color_tint,
                    font_family: r.family,
                    scheme: r.scheme.clone(),
                    charset: r.charset,
                    preserve_space: r.preserve_space,
                })
                .collect();
            (comment.author.clone(), runs, comment.xr_uid.clone())
        };

        let author_id = cw.get_or_create_author(&author_name);

        let visible = comment.visible.unwrap_or(false);
        let legacy = LegacyComment {
            cell_ref: comment.cell_ref.clone(),
            author_id,
            text: runs,
            visible,
            shape_id: comment.shape_id,
            xr_uid,
            comment_pr: comment.comment_pr.clone(),
        };
        let mut shape = CommentShape::for_cell(&comment.cell_ref);
        shape.visible = visible;
        shape.note_height = comment.note_height;
        shape.note_width = comment.note_width;
        if let Some(vml_shape) = comment_package.and_then(|package| {
            package
                .vml_note_shapes
                .iter()
                .find(|vml_shape| vml_shape.cell_ref.as_deref() == Some(comment.cell_ref.as_str()))
        }) {
            shape.has_vml_note_provenance = true;
            shape.note_height_style = vml_shape.height.clone();
            shape.note_width_style = vml_shape.width.clone();
        }
        if let Some(anchor) = &comment.note_shape_anchor {
            shape.left_col = anchor.left_column;
            shape.left_offset = anchor.left_offset as f64;
            shape.top_row = anchor.top_row;
            shape.top_offset = anchor.top_offset as f64;
            shape.right_col = anchor.right_column;
            shape.right_offset = anchor.right_offset as f64;
            shape.bottom_row = anchor.bottom_row;
            shape.bottom_offset = anchor.bottom_offset as f64;
        }
        cw.add_with_shape(legacy, shape);
    }

    (cw.to_xml(), cw.to_vml())
}

/// Build threaded comments XML for a single sheet.
/// Returns `None` if there are no comments tagged as `ThreadedComment`.
///
/// Dispatch is `comment_type`-driven (single discriminator end-to-end). The
/// storage invariant says threaded comments always have `thread_id = Some(...)`,
/// so the unwrap inside is safe; we fall back to `comment.id` defensively.
pub fn threaded_comments_xml_from_domain(
    comments: &[domain_types::Comment],
    root_namespace_attrs: Option<&[(String, String)]>,
) -> Option<Vec<u8>> {
    let threaded: Vec<&domain_types::Comment> = comments
        .iter()
        .filter(|c| c.comment_type == CommentType::ThreadedComment)
        .collect();
    if threaded.is_empty() {
        return None;
    }

    let mut tw = ThreadedCommentsWriter::new();
    if let Some(attrs) = root_namespace_attrs {
        tw.set_root_namespace_attrs(attrs.to_vec());
    }

    for comment in &threaded {
        let thread_id = comment
            .thread_id
            .as_deref()
            .filter(|id| !id.is_empty())
            .unwrap_or(comment.id.as_str())
            .to_string();
        let comment_id = if comment.parent_id.is_none() {
            thread_id.clone()
        } else if comment.id.is_empty() {
            thread_id.clone()
        } else {
            comment.id.clone()
        };
        let person_id = comment.person_id.clone().unwrap_or_default();
        let timestamp = comment.timestamp.clone().unwrap_or_default();

        // Convert domain mentions to writer mentions
        let mentions: Vec<ThreadedMention> = comment
            .mentions
            .iter()
            .map(|m| ThreadedMention {
                mention_person_id: m.user_id.clone(),
                start_index: m.start_index,
                length: m.length,
            })
            .collect();

        tw.add_comment(ThreadedComment {
            id: comment_id,
            cell_ref: comment.cell_ref.clone(),
            author_id: person_id,
            text: comment.content.as_deref().unwrap_or("").to_string(),
            timestamp,
            parent_id: comment.parent_id.clone(),
            done: comment.resolved.unwrap_or(false),
            ext_lst_xml: comment.ext_lst_xml.clone(),
            mentions,
        });
    }

    Some(tw.to_xml())
}

/// Build persons.xml from the workbook-level person list.
pub fn persons_xml_from_domain(persons: &[domain_types::PersonInfo]) -> Vec<u8> {
    let mut tw = ThreadedCommentsWriter::new();
    for person in persons {
        tw.add_author_full(ThreadedAuthor {
            id: person.id.clone(),
            display_name: person.display_name.clone(),
            user_id: person.user_id.clone(),
            provider_id: person.provider_id.clone(),
        });
    }
    tw.to_persons_xml()
}
