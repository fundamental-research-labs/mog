use crate::infra::scanner::{
    StartTagEnd, find_closing_tag, find_gt_simd, find_start_tag_end_quoted,
};
use crate::infra::xml::parse_string_attr_quoted;

/// Extract `mc:Ignorable` value from the root `<externalLink>` element.
pub(super) fn extract_mc_ignorable(xml: &[u8]) -> Option<String> {
    let el_start = memchr::memmem::find(xml, b"<externalLink")?;
    let (element, _) = start_tag_element(xml, el_start, xml.len());
    parse_string_attr_quoted(element, b"mc:Ignorable")
}

pub(super) fn extract_ext_lst_xml(xml: &[u8]) -> Option<String> {
    let start = crate::infra::scanner::find_tag_simd(xml, b"extLst", 0)?;
    let end = find_closing_tag(xml, b"extLst", start)?;
    let closing_end = find_gt_simd(xml, end)?.saturating_add(1);
    Some(String::from_utf8_lossy(&xml[start..closing_end]).into_owned())
}

pub(super) fn start_tag_end_for_attrs(xml: &[u8], start: usize, limit: usize) -> usize {
    let limit = limit.min(xml.len());
    let end = match find_start_tag_end_quoted(xml, start) {
        StartTagEnd::Found(pos) => pos.saturating_add(1),
        StartTagEnd::UnterminatedQuote {
            fallback_gt: Some(pos),
            ..
        } => pos.saturating_add(1),
        StartTagEnd::UnterminatedQuote {
            fallback_gt: None, ..
        }
        | StartTagEnd::Missing => limit,
    };

    end.min(limit)
}

pub(super) fn start_tag_element(xml: &[u8], start: usize, limit: usize) -> (&[u8], usize) {
    let end = start_tag_end_for_attrs(xml, start, limit);
    (&xml[start..end], end)
}
