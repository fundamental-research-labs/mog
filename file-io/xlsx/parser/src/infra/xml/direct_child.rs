use crate::infra::scanner::{find_closing_tag, find_gt_simd};

/// Extract the raw XML for a direct child element by local name.
pub fn extract_direct_child_element_xml(
    xml: &[u8],
    parent_name: &[u8],
    child_name: &[u8],
) -> Option<String> {
    let (body_start, body_end) = element_body_bounds(xml, parent_name)?;
    let body = &xml[body_start..body_end];
    let child_start = find_direct_child_start(body, child_name)?;
    let child_tag_end = find_gt_simd(body, child_start)?;
    let child_end = element_end(body, child_start, child_tag_end)?;

    std::str::from_utf8(&body[child_start..child_end])
        .ok()
        .map(ToOwned::to_owned)
}

fn element_body_bounds(xml: &[u8], parent_name: &[u8]) -> Option<(usize, usize)> {
    let open_end = find_gt_simd(xml, 0)?;
    if open_end > 0 && xml[open_end - 1] == b'/' {
        return None;
    }
    let close_start = find_closing_tag(xml, parent_name, open_end)?;
    Some((open_end + 1, close_start))
}

fn find_direct_child_start(body: &[u8], child_name: &[u8]) -> Option<usize> {
    let mut pos = 0;
    while pos < body.len() {
        let lt = memchr::memchr(b'<', &body[pos..])? + pos;
        let name_start = lt + 1;
        if name_start >= body.len() {
            return None;
        }

        match body[name_start] {
            b'/' => return None,
            b'!' | b'?' => {
                pos = find_gt_simd(body, lt).map_or(body.len(), |end| end + 1);
                continue;
            }
            _ => {}
        }

        let name_end = tag_name_end(body, name_start);
        if local_name(&body[name_start..name_end]) == child_name {
            return Some(lt);
        }

        let tag_end = find_gt_simd(body, lt)?;
        pos = element_end(body, lt, tag_end)?;
    }
    None
}

fn element_end(xml: &[u8], start: usize, tag_end: usize) -> Option<usize> {
    if tag_end > start && xml[tag_end - 1] == b'/' {
        return Some(tag_end + 1);
    }
    let name_start = start + 1;
    let name_end = tag_name_end(xml, name_start);
    let close_start = find_closing_tag(xml, &xml[name_start..name_end], tag_end)?;
    find_gt_simd(xml, close_start).map(|end| end + 1)
}

fn tag_name_end(xml: &[u8], mut pos: usize) -> usize {
    while pos < xml.len() {
        let b = xml[pos];
        if matches!(b, b'>' | b'/' | b' ' | b'\t' | b'\n' | b'\r') {
            break;
        }
        pos += 1;
    }
    pos
}

fn local_name(name: &[u8]) -> &[u8] {
    name.iter()
        .rposition(|b| *b == b':')
        .map_or(name, |idx| &name[idx + 1..])
}
