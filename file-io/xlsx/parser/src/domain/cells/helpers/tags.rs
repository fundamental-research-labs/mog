use crate::infra::scanner::{
    StartTagEnd, find_closing_tag, find_gt_simd, find_start_tag_end_quoted, find_tag_simd,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct StartTag {
    pub lt: usize,
    pub name_end: usize,
    pub tag_end: usize,
    pub content_start: usize,
    pub is_self_closing: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ClosingTag {
    pub lt: usize,
    pub end: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct SheetDataBounds {
    pub start: usize,
    pub content_start: usize,
    pub content_end: usize,
    pub end: usize,
}

#[inline]
fn name_end_for_start_tag(xml: &[u8], name_start: usize) -> usize {
    let mut name_end = name_start;
    while name_end < xml.len() {
        if matches!(xml[name_end], b' ' | b'\t' | b'\n' | b'\r' | b'>' | b'/') {
            break;
        }
        name_end += 1;
    }
    name_end
}

#[inline]
fn name_end_for_closing_tag(xml: &[u8], name_start: usize) -> usize {
    let mut name_end = name_start;
    while name_end < xml.len() {
        if matches!(xml[name_end], b'>' | b' ' | b'\t' | b'\n' | b'\r') {
            break;
        }
        name_end += 1;
    }
    name_end
}

#[inline]
fn local_name(name: &[u8]) -> &[u8] {
    name.iter()
        .position(|&b| b == b':')
        .map_or(name, |colon| &name[colon + 1..])
}

#[inline]
fn name_matches_local(name: &[u8], expected: &[u8]) -> bool {
    name == expected || local_name(name) == expected
}

#[inline]
fn is_self_closing_start_tag(xml: &[u8], lt: usize, tag_end: usize) -> bool {
    let mut pos = tag_end;
    while pos > lt && xml[pos - 1].is_ascii_whitespace() {
        pos -= 1;
    }
    pos > lt && xml[pos - 1] == b'/'
}

#[inline]
pub(crate) fn start_tag_at(xml: &[u8], lt: usize, local: &[u8]) -> Option<StartTag> {
    if lt >= xml.len() || xml[lt] != b'<' {
        return None;
    }

    let name_start = lt + 1;
    if name_start >= xml.len() || matches!(xml[name_start], b'/' | b'!' | b'?') {
        return None;
    }

    let name_end = name_end_for_start_tag(xml, name_start);
    if name_end <= name_start || !name_matches_local(&xml[name_start..name_end], local) {
        return None;
    }

    let tag_end = match find_start_tag_end_quoted(xml, name_end) {
        StartTagEnd::Found(pos) => pos,
        StartTagEnd::UnterminatedQuote { .. } | StartTagEnd::Missing => return None,
    };
    Some(StartTag {
        lt,
        name_end,
        tag_end,
        content_start: tag_end + 1,
        is_self_closing: is_self_closing_start_tag(xml, lt, tag_end),
    })
}

#[inline]
pub(crate) fn find_start_tag(xml: &[u8], local: &[u8], start: usize) -> Option<StartTag> {
    let mut search_from = start;
    while let Some(lt) = find_tag_simd(xml, local, search_from) {
        if let Some(tag) = start_tag_at(xml, lt, local) {
            return Some(tag);
        }
        search_from = lt + 1;
    }
    None
}

#[inline]
pub(crate) fn closing_tag_at(xml: &[u8], lt: usize, local: &[u8]) -> Option<ClosingTag> {
    if lt + 2 > xml.len() || xml.get(lt..lt + 2) != Some(b"</") {
        return None;
    }

    let name_start = lt + 2;
    let name_end = name_end_for_closing_tag(xml, name_start);
    if name_end <= name_start || !name_matches_local(&xml[name_start..name_end], local) {
        return None;
    }

    let gt = find_gt_simd(xml, name_end)?;
    Some(ClosingTag { lt, end: gt + 1 })
}

#[inline]
pub(crate) fn find_closing_tag_span(xml: &[u8], local: &[u8], start: usize) -> Option<ClosingTag> {
    let mut search_from = start;
    while let Some(lt) = find_closing_tag(xml, local, search_from) {
        if let Some(tag) = closing_tag_at(xml, lt, local) {
            return Some(tag);
        }
        search_from = lt + 1;
    }
    None
}

#[inline]
pub(crate) fn find_sheet_data_bounds(xml: &[u8], start: usize) -> Option<SheetDataBounds> {
    let opening = find_start_tag(xml, b"sheetData", start)?;
    if opening.is_self_closing {
        return Some(SheetDataBounds {
            start: opening.lt,
            content_start: opening.content_start,
            content_end: opening.content_start,
            end: opening.content_start,
        });
    }

    let closing = find_closing_tag_span(xml, b"sheetData", opening.content_start);
    let (content_end, end) = closing.map_or((xml.len(), xml.len()), |tag| (tag.lt, tag.end));
    Some(SheetDataBounds {
        start: opening.lt,
        content_start: opening.content_start,
        content_end,
        end,
    })
}

#[inline]
pub(crate) fn pre_sheet_data_region(xml: &[u8]) -> &[u8] {
    find_sheet_data_bounds(xml, 0).map_or(xml, |bounds| &xml[..bounds.start])
}

#[inline]
pub(crate) fn post_sheet_data_region(xml: &[u8]) -> &[u8] {
    find_sheet_data_bounds(xml, 0).map_or(&xml[xml.len()..], |bounds| &xml[bounds.end..])
}

pub(crate) fn count_worksheet_cell_elements(xml: &[u8]) -> usize {
    let mut count = 0usize;
    let mut pos = 0usize;
    while let Some(rel) = xml[pos..].iter().position(|&b| b == b'<') {
        let lt = pos + rel;
        let name_start = lt + 1;
        if name_start >= xml.len() {
            break;
        }
        if matches!(xml[name_start], b'/' | b'!' | b'?') {
            pos = name_start + 1;
            continue;
        }

        let name_end = name_end_for_start_tag(xml, name_start);
        if name_end > name_start && name_matches_local(&xml[name_start..name_end], b"c") {
            count += 1;
        }
        pos = name_end.max(name_start + 1);
    }
    count
}
