use super::rich_text::parse_rich_text;
use super::support::parse_root_attrs;
use crate::domain::comments::types::{Comment, Comments};
use crate::infra::scanner::{find_closing_tag, find_gt_simd, find_tag_simd};
use crate::infra::xml::{decode_xml_entities, parse_string_attr, parse_u32_attr};

/// Parse comments from comments*.xml.
pub fn parse_comments(xml: &[u8]) -> Comments {
    let mut comments = Comments::default();

    let comments_start = match find_tag_simd(xml, b"comments", 0) {
        Some(pos) => pos,
        None => return comments,
    };

    comments.root_namespace_attrs = parse_comments_root_attrs(xml);

    if let Some(authors_start) = find_tag_simd(xml, b"authors", comments_start) {
        let authors_end = find_closing_tag(xml, b"authors", authors_start).unwrap_or(xml.len());
        comments.authors = parse_authors(&xml[authors_start..authors_end]);
    }

    if let Some(list_start) = find_tag_simd(xml, b"commentList", comments_start) {
        let list_end = find_closing_tag(xml, b"commentList", list_start).unwrap_or(xml.len());
        comments.comments = parse_comment_list(&xml[list_start..list_end]);
    }

    comments
}

fn parse_comments_root_attrs(xml: &[u8]) -> Vec<(String, String)> {
    parse_root_attrs(xml, "comments")
}

fn parse_authors(xml: &[u8]) -> Vec<String> {
    let mut authors = Vec::new();
    let mut pos = 0;

    while let Some(author_start) = find_tag_simd(xml, b"author", pos) {
        let gt_pos = find_gt_simd(xml, author_start).unwrap_or(xml.len());

        if gt_pos > 0 && xml[gt_pos - 1] == b'/' {
            authors.push(String::new());
            pos = gt_pos + 1;
            continue;
        }

        let content_start = gt_pos + 1;
        let author_end = find_closing_tag(xml, b"author", author_start).unwrap_or(xml.len());

        if content_start <= author_end {
            if content_start == author_end {
                authors.push(String::new());
            } else {
                let author_text = decode_xml_entities(&xml[content_start..author_end]);
                authors.push(author_text);
            }
        }

        pos = author_end + 1;
    }

    authors
}

fn parse_comment_list(xml: &[u8]) -> Vec<Comment> {
    let mut comments = Vec::new();
    let mut pos = 0;

    while let Some(comment_start) = find_tag_simd(xml, b"comment", pos) {
        if comment_start + 8 < xml.len() && xml[comment_start + 8] == b'L' {
            pos = comment_start + 1;
            continue;
        }

        let comment_end = find_closing_tag(xml, b"comment", comment_start).unwrap_or(xml.len());

        if let Some(comment) = parse_single_comment(&xml[comment_start..comment_end]) {
            comments.push(comment);
        }

        pos = comment_end + 1;
    }

    comments
}

fn parse_single_comment(xml: &[u8]) -> Option<Comment> {
    let mut comment = Comment::default();

    let tag_end = find_gt_simd(xml, 0)?;
    let tag = &xml[..tag_end + 1];

    comment.cell_ref = parse_string_attr(tag, b"ref=\"")?;
    comment.author_id = parse_u32_attr(tag, b"authorId=\"").unwrap_or(0);
    comment.guid = parse_string_attr(tag, b"guid=\"");
    comment.shape_id = parse_u32_attr(tag, b"shapeId=\"");
    comment.xr_uid = parse_string_attr(tag, b"xr:uid=\"");

    if let Some(text_start) = find_tag_simd(xml, b"text", 0) {
        let text_end = find_closing_tag(xml, b"text", text_start).unwrap_or(xml.len());
        comment.rich_text = parse_rich_text(&xml[text_start..text_end]);
    }

    Some(comment)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_comments_empty() {
        let xml = b"<?xml version=\"1.0\"?><worksheet></worksheet>";
        let comments = parse_comments(xml);
        assert!(comments.authors.is_empty());
        assert!(comments.comments.is_empty());
    }

    #[test]
    fn test_parse_comments_basic() {
        let xml = br#"<?xml version="1.0"?>
<comments xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
    <authors>
        <author>John Doe</author>
        <author>Jane Smith</author>
    </authors>
    <commentList>
        <comment ref="A1" authorId="0">
            <text>
                <t>This is a comment</t>
            </text>
        </comment>
    </commentList>
</comments>"#;

        let comments = parse_comments(xml);
        assert_eq!(comments.authors.len(), 2);
        assert_eq!(comments.authors[0], "John Doe");
        assert_eq!(comments.authors[1], "Jane Smith");
        assert_eq!(comments.comments.len(), 1);
        assert_eq!(comments.comments[0].cell_ref, "A1");
        assert_eq!(comments.comments[0].author_id, 0);
        assert_eq!(comments.comments[0].text(), "This is a comment");
    }

    #[test]
    fn test_parse_comments_rich_text() {
        let xml = br#"<?xml version="1.0"?>
<comments>
    <authors><author>Author</author></authors>
    <commentList>
        <comment ref="B2" authorId="0">
            <text>
                <r>
                    <rPr><b/><sz val="11"/></rPr>
                    <t>Bold </t>
                </r>
                <r>
                    <rPr><i/></rPr>
                    <t>Italic</t>
                </r>
            </text>
        </comment>
    </commentList>
</comments>"#;

        let comments = parse_comments(xml);
        assert_eq!(comments.comments.len(), 1);
        let comment = &comments.comments[0];
        assert_eq!(comment.rich_text.len(), 2);
        assert_eq!(comment.rich_text[0].text, "Bold ");
        assert!(comment.rich_text[0].font.as_ref().unwrap().bold);
        assert_eq!(comment.rich_text[0].font.as_ref().unwrap().size, Some(11.0));
        assert_eq!(comment.rich_text[1].text, "Italic");
        assert!(comment.rich_text[1].font.as_ref().unwrap().italic);
        assert_eq!(comment.text(), "Bold Italic");
    }

    #[test]
    fn test_parse_comments_with_entities() {
        let xml = br#"<?xml version="1.0"?>
<comments>
    <authors><author>A &amp; B</author></authors>
    <commentList>
        <comment ref="A1" authorId="0">
            <text><t>&lt;tag&gt; &amp; &quot;text&quot;</t></text>
        </comment>
    </commentList>
</comments>"#;

        let comments = parse_comments(xml);
        assert_eq!(comments.authors[0], "A & B");
        assert_eq!(comments.comments[0].text(), "<tag> & \"text\"");
    }

    #[test]
    fn test_parse_comments_multiple() {
        let xml = br#"<?xml version="1.0"?>
<comments>
    <authors><author>User</author></authors>
    <commentList>
        <comment ref="A1" authorId="0"><text><t>First</t></text></comment>
        <comment ref="B2" authorId="0"><text><t>Second</t></text></comment>
        <comment ref="C3" authorId="0"><text><t>Third</t></text></comment>
    </commentList>
</comments>"#;

        let comments = parse_comments(xml);
        assert_eq!(comments.comments.len(), 3);
        assert_eq!(comments.comments[0].cell_ref, "A1");
        assert_eq!(comments.comments[1].cell_ref, "B2");
        assert_eq!(comments.comments[2].cell_ref, "C3");
    }

    #[test]
    fn test_parse_comment_with_guid() {
        let xml = br#"<?xml version="1.0"?>
<comments>
    <authors><author>User</author></authors>
    <commentList>
        <comment ref="A1" authorId="0" guid="{12345678-1234-1234-1234-123456789012}">
            <text><t>Comment with GUID</t></text>
        </comment>
    </commentList>
</comments>"#;

        let comments = parse_comments(xml);
        assert_eq!(
            comments.comments[0].guid,
            Some("{12345678-1234-1234-1234-123456789012}".to_string())
        );
    }

    #[test]
    fn test_parse_comments_empty_text() {
        let xml = br#"<?xml version="1.0"?>
<comments>
    <authors><author>User</author></authors>
    <commentList>
        <comment ref="A1" authorId="0">
            <text><t></t></text>
        </comment>
    </commentList>
</comments>"#;

        let comments = parse_comments(xml);
        assert_eq!(comments.comments.len(), 1);
        assert_eq!(comments.comments[0].text(), "");
    }

    #[test]
    fn test_parse_comments_no_authors() {
        let xml = br#"<?xml version="1.0"?>
<comments>
    <authors></authors>
    <commentList>
        <comment ref="A1" authorId="0">
            <text><t>Orphan comment</t></text>
        </comment>
    </commentList>
</comments>"#;

        let comments = parse_comments(xml);
        assert!(comments.authors.is_empty());
        assert_eq!(comments.comments.len(), 1);
    }
}
