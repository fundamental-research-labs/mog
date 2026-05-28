use super::support::parse_root_attrs;
use crate::domain::comments::types::{
    ParsedMention, ThreadedComment, ThreadedComments, ThreadedPerson,
};
use crate::infra::scanner::{find_closing_tag, find_gt_simd, find_tag_simd};
use crate::infra::xml::{decode_xml_entities, parse_bool_attr, parse_string_attr, parse_u32_attr};

/// Parse threaded comments from threadedComment*.xml.
pub fn parse_threaded_comments(xml: &[u8]) -> ThreadedComments {
    let mut threaded = ThreadedComments::default();

    let tc_start = match find_tag_simd(xml, b"ThreadedComments", 0) {
        Some(pos) => pos,
        None => return threaded,
    };

    let tc_end = find_closing_tag(xml, b"ThreadedComments", tc_start).unwrap_or(xml.len());

    if let Some(persons_start) = find_tag_simd(xml, b"personList", tc_start) {
        let persons_end = find_closing_tag(xml, b"personList", persons_start).unwrap_or(tc_end);
        threaded.persons = parse_persons(&xml[persons_start..persons_end]);
    }

    let mut pos = tc_start;
    while let Some(comment_start) = find_tag_simd(&xml[..tc_end], b"threadedComment", pos) {
        if comment_start >= tc_end {
            break;
        }

        let comment_end =
            find_closing_tag(xml, b"threadedComment", comment_start).unwrap_or(tc_end);

        if let Some(comment) = parse_threaded_comment(&xml[comment_start..comment_end]) {
            threaded.comments.push(comment);
        }

        pos = comment_end + 1;
    }

    threaded
}

/// Extract namespace declarations and `mc:Ignorable` from the threaded comments root.
pub fn parse_threaded_comments_root_attrs(xml: &[u8]) -> Vec<(String, String)> {
    parse_root_attrs(xml, "ThreadedComments")
}

fn parse_persons(xml: &[u8]) -> Vec<ThreadedPerson> {
    let mut persons = Vec::new();
    let mut pos = 0;

    while let Some(person_start) = find_tag_simd(xml, b"person", pos) {
        if person_start + 7 < xml.len() && xml[person_start + 7] == b'L' {
            pos = person_start + 1;
            continue;
        }

        let tag_end = find_gt_simd(xml, person_start).unwrap_or(xml.len());
        let element = &xml[person_start..tag_end + 1];

        let person = ThreadedPerson {
            display_name: parse_string_attr(element, b"displayName=\"").unwrap_or_default(),
            id: parse_string_attr(element, b"id=\"").unwrap_or_default(),
            user_id: parse_string_attr(element, b"userId=\""),
            provider_id: parse_string_attr(element, b"providerId=\""),
        };

        persons.push(person);
        pos = tag_end + 1;
    }

    persons
}

fn parse_threaded_comment(xml: &[u8]) -> Option<ThreadedComment> {
    let tag_end = find_gt_simd(xml, 0)?;
    let tag = &xml[..tag_end + 1];

    let mut comment = ThreadedComment {
        id: parse_string_attr(tag, b"id=\"")?,
        cell_ref: parse_string_attr(tag, b"ref=\"").unwrap_or_default(),
        person_id: parse_string_attr(tag, b"personId=\"").unwrap_or_default(),
        parent_id: parse_string_attr(tag, b"parentId=\""),
        done: parse_bool_attr(tag, b"done=\""),
        created: parse_string_attr(tag, b"dT=\""),
        ..Default::default()
    };

    if let Some(text_start) = find_tag_simd(xml, b"text", 0) {
        let content_start = find_gt_simd(xml, text_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        let text_end = find_closing_tag(xml, b"text", text_start).unwrap_or(xml.len());

        if content_start < text_end {
            comment.text = decode_xml_entities(&xml[content_start..text_end]);
        }
    }

    if let Some(ext_start) = find_tag_simd(xml, b"extLst", 0) {
        let ext_end = find_closing_tag(xml, b"extLst", ext_start).unwrap_or(xml.len());
        let ext_close_end = ext_end + b"</extLst>".len();
        if ext_close_end <= xml.len() {
            comment.ext_lst_xml = std::str::from_utf8(&xml[ext_start..ext_close_end])
                .ok()
                .map(|s| s.to_string());
        }
    }

    if let Some(mentions_start) = find_tag_simd(xml, b"mentions", 0) {
        let mentions_end = find_closing_tag(xml, b"mentions", mentions_start).unwrap_or(xml.len());
        let mentions_xml = &xml[mentions_start..mentions_end];
        let mut mpos = 0;
        while let Some(m_start) = find_tag_simd(mentions_xml, b"mention", mpos) {
            let m_tag_end = find_gt_simd(mentions_xml, m_start).unwrap_or(mentions_xml.len());
            let m_tag = &mentions_xml[m_start..m_tag_end + 1];
            let mention_person_id =
                parse_string_attr(m_tag, b"mentionpersonId=\"").unwrap_or_default();
            let start_index = parse_u32_attr(m_tag, b"startIndex=\"").unwrap_or(0);
            let length = parse_u32_attr(m_tag, b"length=\"").unwrap_or(0);
            comment.mentions.push(ParsedMention {
                mention_person_id,
                start_index,
                length,
            });
            mpos = m_tag_end + 1;
        }
    }

    Some(comment)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_threaded_comments_empty() {
        let xml = b"<?xml version=\"1.0\"?><worksheet></worksheet>";
        let threaded = parse_threaded_comments(xml);
        assert!(threaded.persons.is_empty());
        assert!(threaded.comments.is_empty());
    }

    #[test]
    fn test_parse_threaded_comments_basic() {
        let xml = br#"<?xml version="1.0"?>
<ThreadedComments xmlns="http://schemas.microsoft.com/office/spreadsheetml/2018/threadedcomments">
    <personList>
        <person displayName="John Doe" id="TC_1"/>
    </personList>
    <threadedComment ref="A1" id="TC_C1" personId="TC_1">
        <text>This is a threaded comment</text>
    </threadedComment>
</ThreadedComments>"#;

        let threaded = parse_threaded_comments(xml);
        assert_eq!(threaded.persons.len(), 1);
        assert_eq!(threaded.persons[0].display_name, "John Doe");
        assert_eq!(threaded.comments.len(), 1);
        assert_eq!(threaded.comments[0].cell_ref, "A1");
        assert_eq!(threaded.comments[0].text, "This is a threaded comment");
    }

    #[test]
    fn test_parse_threaded_comments_with_reply() {
        let xml = br#"<?xml version="1.0"?>
<ThreadedComments>
    <personList>
        <person displayName="User1" id="P1"/>
        <person displayName="User2" id="P2"/>
    </personList>
    <threadedComment ref="A1" id="C1" personId="P1">
        <text>Original comment</text>
    </threadedComment>
    <threadedComment ref="A1" id="C2" personId="P2" parentId="C1">
        <text>Reply to original</text>
    </threadedComment>
</ThreadedComments>"#;

        let threaded = parse_threaded_comments(xml);
        assert_eq!(threaded.comments.len(), 2);
        assert!(threaded.comments[0].parent_id.is_none());
        assert_eq!(threaded.comments[1].parent_id, Some("C1".to_string()));
    }
}
