//! Direct-child element extraction for scoped drawing XML slices.

use crate::infra::scanner::{find_element_end, find_lt_simd};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Element<'a> {
    pub(crate) local_name: &'a [u8],
    pub(crate) start: usize,
    pub(crate) open_end: usize,
    pub(crate) end: usize,
    pub(crate) self_closing: bool,
}

impl<'a> Element<'a> {
    pub(crate) fn full_slice(self, xml: &'a [u8]) -> &'a [u8] {
        &xml[self.start..self.end]
    }
}

/// Return the first real XML element in a document slice, skipping declarations,
/// comments, and doctype-like markup.
pub(crate) fn document_element(xml: &[u8]) -> Option<Element<'_>> {
    let mut pos = 0;
    while let Some(lt) = find_lt_simd(xml, pos) {
        if is_markup_to_skip(xml, lt) {
            pos = find_element_end(xml, lt).map_or(xml.len(), |end| end + 1);
            continue;
        }

        return parse_element_at(xml, lt);
    }

    None
}

/// Return the first real XML element's full slice.
pub(crate) fn document_element_slice(xml: &[u8]) -> Option<&[u8]> {
    document_element(xml).map(|element| element.full_slice(xml))
}

/// Iterate direct child elements of `xml` in document order.
pub(crate) fn direct_child_elements(xml: &[u8]) -> DirectChildren<'_> {
    let content_start = find_element_end(xml, 0).map_or(0, |end| end + 1);
    DirectChildren {
        xml,
        pos: content_start,
    }
}

/// Return the first direct child with `local_name`.
pub(crate) fn direct_child<'a>(xml: &'a [u8], local_name: &[u8]) -> Option<Element<'a>> {
    direct_child_elements(xml).find(|child| child.local_name == local_name)
}

/// Return the first direct child's full XML slice.
pub(crate) fn direct_child_slice<'a>(xml: &'a [u8], local_name: &[u8]) -> Option<&'a [u8]> {
    let child = direct_child(xml, local_name)?;
    Some(child.full_slice(xml))
}

/// Return the first descendant element with `local_name`, including direct
/// children and deeper descendants, as a complete scoped slice.
pub(crate) fn first_descendant_slice<'a>(xml: &'a [u8], local_name: &[u8]) -> Option<&'a [u8]> {
    let mut pos = 0;
    while let Some(lt) = find_lt_simd(xml, pos) {
        if is_closing_tag(xml, lt) || is_markup_to_skip(xml, lt) {
            pos = find_element_end(xml, lt).map_or(lt + 1, |end| end + 1);
            continue;
        }

        if local_name_at(xml, lt).is_some_and(|name| name == local_name) {
            let element = parse_element_at(xml, lt)?;
            return Some(element.full_slice(xml));
        }

        pos = find_element_end(xml, lt).map_or(lt + 1, |end| end + 1);
    }

    None
}

/// Return a direct child's text content as bytes.
pub(crate) fn direct_child_text<'a>(xml: &'a [u8], local_name: &[u8]) -> Option<&'a [u8]> {
    let child = direct_child(xml, local_name)?;
    if child.self_closing {
        return Some(&[]);
    }
    let close = find_closing_start(xml, child.start, child.end, child.local_name)?;
    Some(&xml[child.open_end + 1..close])
}

pub(crate) struct DirectChildren<'a> {
    xml: &'a [u8],
    pos: usize,
}

impl<'a> Iterator for DirectChildren<'a> {
    type Item = Element<'a>;

    fn next(&mut self) -> Option<Self::Item> {
        loop {
            let lt = find_lt_simd(self.xml, self.pos)?;
            if is_closing_tag(self.xml, lt) {
                self.pos = self.xml.len();
                return None;
            }
            if is_markup_to_skip(self.xml, lt) {
                self.pos = find_element_end(self.xml, lt).map_or(self.xml.len(), |end| end + 1);
                continue;
            }

            let element = parse_element_at(self.xml, lt)?;
            self.pos = element.end;
            return Some(element);
        }
    }
}

fn parse_element_at<'a>(xml: &'a [u8], start: usize) -> Option<Element<'a>> {
    let open_end = find_element_end(xml, start)?;
    let local_name = local_name_at(xml, start)?;
    let self_closing = is_self_closing_open_tag(xml, open_end);
    let end = if self_closing {
        open_end + 1
    } else {
        find_matching_element_end(xml, start, local_name, open_end)?
    };

    Some(Element {
        local_name,
        start,
        open_end,
        end,
        self_closing,
    })
}

fn find_matching_element_end(
    xml: &[u8],
    _start: usize,
    local_name: &[u8],
    open_end: usize,
) -> Option<usize> {
    let mut depth = 1usize;
    let mut pos = open_end + 1;

    while let Some(lt) = find_lt_simd(xml, pos) {
        if is_markup_to_skip(xml, lt) {
            pos = find_element_end(xml, lt).map_or(xml.len(), |end| end + 1);
            continue;
        }

        if is_closing_tag(xml, lt) {
            if closing_local_name_at(xml, lt).is_some_and(|name| name == local_name) {
                depth -= 1;
                let gt = find_element_end(xml, lt)?;
                if depth == 0 {
                    return Some(gt + 1);
                }
                pos = gt + 1;
                continue;
            }
        } else if let Some(name) = local_name_at(xml, lt) {
            let gt = find_element_end(xml, lt)?;
            if !is_self_closing_open_tag(xml, gt) {
                if name == local_name {
                    depth += 1;
                    pos = gt + 1;
                } else {
                    pos = find_matching_element_end(xml, lt, name, gt)?;
                }
                continue;
            }
            pos = gt + 1;
            continue;
        }

        pos = find_element_end(xml, lt).map_or(lt + 1, |end| end + 1);
    }

    None
}

fn find_closing_start(xml: &[u8], start: usize, end: usize, local_name: &[u8]) -> Option<usize> {
    let mut depth = 1usize;
    let mut pos = find_element_end(xml, start)? + 1;
    while pos < end {
        let lt = find_lt_simd(xml, pos)?;
        if is_closing_tag(xml, lt) {
            if closing_local_name_at(xml, lt).is_some_and(|name| name == local_name) {
                depth -= 1;
                if depth == 0 {
                    return Some(lt);
                }
            }
        } else if local_name_at(xml, lt).is_some_and(|name| name == local_name) {
            let gt = find_element_end(xml, lt)?;
            if !is_self_closing_open_tag(xml, gt) {
                depth += 1;
            }
        }
        pos = find_element_end(xml, lt).map_or(lt + 1, |gt| gt + 1);
    }
    None
}

fn is_closing_tag(xml: &[u8], lt: usize) -> bool {
    xml.get(lt + 1) == Some(&b'/')
}

fn is_markup_to_skip(xml: &[u8], lt: usize) -> bool {
    matches!(xml.get(lt + 1), Some(b'!') | Some(b'?'))
}

fn is_self_closing_open_tag(xml: &[u8], open_end: usize) -> bool {
    xml[..open_end]
        .iter()
        .rposition(|b| !b.is_ascii_whitespace())
        .is_some_and(|pos| xml[pos] == b'/')
}

fn local_name_at(xml: &[u8], lt: usize) -> Option<&[u8]> {
    let name_start = lt.checked_add(1)?;
    element_local_name(xml, name_start)
}

fn closing_local_name_at(xml: &[u8], lt: usize) -> Option<&[u8]> {
    let name_start = lt.checked_add(2)?;
    element_local_name(xml, name_start)
}

fn element_local_name(xml: &[u8], name_start: usize) -> Option<&[u8]> {
    if name_start >= xml.len() {
        return None;
    }
    let mut name_end = name_start;
    while name_end < xml.len()
        && !matches!(xml[name_end], b' ' | b'\t' | b'\n' | b'\r' | b'>' | b'/')
    {
        name_end += 1;
    }
    if name_end == name_start {
        return None;
    }
    let name = &xml[name_start..name_end];
    let local_start = name
        .iter()
        .rposition(|b| *b == b':')
        .map_or(0, |pos| pos + 1);
    Some(&name[local_start..])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iterates_direct_children_in_document_order() {
        let xml = br#"<xdr:twoCellAnchor><xdr:from/><xdr:sp><a:spPr/></xdr:sp><xdr:clientData/></xdr:twoCellAnchor>"#;
        let names: Vec<_> = direct_child_elements(xml)
            .map(|child| std::str::from_utf8(child.local_name).unwrap().to_string())
            .collect();
        assert_eq!(names, ["from", "sp", "clientData"]);
    }

    #[test]
    fn ignores_nested_same_local_name_for_child_text() {
        let xml = br#"<root><p>outer<p>inner</p>end</p><p>second</p></root>"#;
        let first = direct_child(xml, b"p").unwrap();
        assert_eq!(first.full_slice(xml), br#"<p>outer<p>inner</p>end</p>"#);
        assert_eq!(
            direct_child_text(xml, b"p"),
            Some(&b"outer<p>inner</p>end"[..])
        );
    }

    #[test]
    fn handles_self_closing_and_namespaces() {
        let xml = br#"<root><a:ext cx="1" cy="2"/><b:ext><c:ext/></b:ext></root>"#;
        let children: Vec<_> = direct_child_elements(xml).collect();
        assert_eq!(children.len(), 2);
        assert_eq!(children[0].local_name, b"ext");
        assert!(children[0].self_closing);
        assert_eq!(children[1].full_slice(xml), br#"<b:ext><c:ext/></b:ext>"#);
    }

    #[test]
    fn document_element_skips_declaration_and_comments() {
        let xml =
            br#"<?xml version="1.0"?><!--generated--><xdr:wsDr><xdr:twoCellAnchor/></xdr:wsDr>"#;
        assert_eq!(
            document_element_slice(xml),
            Some(&br#"<xdr:wsDr><xdr:twoCellAnchor/></xdr:wsDr>"#[..])
        );
    }

    #[test]
    fn first_descendant_returns_scoped_nested_element() {
        let xml =
            br#"<root><a><b:item id="1"><item id="nested"/></b:item></a><item id="2"/></root>"#;
        assert_eq!(
            first_descendant_slice(xml, b"item"),
            Some(&br#"<b:item id="1"><item id="nested"/></b:item>"#[..])
        );
    }

    #[test]
    fn malformed_unclosed_child_stops_iteration() {
        let xml = br#"<root><a><b></a></root>"#;
        let mut iter = direct_child_elements(xml);
        assert!(iter.next().is_none());
    }
}
