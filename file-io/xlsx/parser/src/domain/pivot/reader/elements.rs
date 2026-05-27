//! Bounded child-element traversal for pivot XML.

use crate::infra::scanner::{find_closing_tag, find_gt_simd, find_tag_simd};

#[derive(Debug, Clone, Copy)]
#[allow(dead_code)]
pub(crate) struct ElementSpan {
    pub start: usize,
    pub tag_end: usize,
    pub end: usize,
    pub self_closing: bool,
}

pub(crate) fn opening_tag(xml: &[u8], name: &[u8], start: usize) -> Option<(usize, usize)> {
    let elem_start = find_tag_simd(xml, name, start)?;
    let elem_end = find_gt_simd(xml, elem_start)?;
    Some((elem_start, elem_end + 1))
}

pub(crate) fn first_element_span(xml: &[u8], name: &[u8], start: usize) -> Option<ElementSpan> {
    let elem_start = find_tag_simd(xml, name, start)?;
    element_span_at(xml, name, elem_start)
}

pub(crate) fn element_span_at(xml: &[u8], name: &[u8], elem_start: usize) -> Option<ElementSpan> {
    let tag_end = find_gt_simd(xml, elem_start)?;
    let self_closing = tag_end > 0 && xml.get(tag_end - 1) == Some(&b'/');
    let end = if self_closing {
        tag_end + 1
    } else {
        find_closing_tag(xml, name, elem_start).unwrap_or(xml.len())
    };
    Some(ElementSpan {
        start: elem_start,
        tag_end: tag_end + 1,
        end,
        self_closing,
    })
}

pub(crate) fn child_slice<'a>(xml: &'a [u8], parent: ElementSpan, name: &[u8]) -> Option<&'a [u8]> {
    let body = &xml[parent.start..parent.end];
    let child = first_element_span(body, name, 0)?;
    Some(&body[child.start..child.end])
}

#[allow(dead_code)]
pub(crate) fn for_each_child(xml: &[u8], name: &[u8], mut f: impl FnMut(ElementSpan, &[u8])) {
    let mut pos = 0;
    while let Some(start) = find_tag_simd(xml, name, pos) {
        if let Some(span) = element_span_at(xml, name, start) {
            f(span, &xml[span.start..span.tag_end]);
            pos = span.end.saturating_add(usize::from(!span.self_closing));
        } else {
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn child_slice_is_bounded_to_parent() {
        let xml = br#"<root><a><b v="1"/></a><b v="2"/></root>"#;
        let parent = first_element_span(xml, b"a", 0).unwrap();
        let child = child_slice(xml, parent, b"b").unwrap();
        assert!(std::str::from_utf8(child).unwrap().contains("v=\"1\""));
        assert!(!std::str::from_utf8(child).unwrap().contains("v=\"2\""));
    }

    #[test]
    fn span_handles_self_closing_and_open_close_forms() {
        let xml = br#"<root><x/><x><y/></x></root>"#;
        let mut spans = Vec::new();
        for_each_child(xml, b"x", |span, _| spans.push(span));
        assert_eq!(spans.len(), 2);
        assert!(spans[0].self_closing);
        assert!(!spans[1].self_closing);
    }
}
