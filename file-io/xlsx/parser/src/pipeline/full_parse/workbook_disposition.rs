use crate::infra::scanner::{find_closing_tag, find_gt_simd, find_tag_simd};

const UNSUPPORTED_WORKBOOK_ELEMENTS: &[(&[u8], &str)] = &[
    (b"functionGroups", "functionGroups"),
    (b"oleSize", "oleSize"),
    (b"smartTagPr", "smartTagPr"),
    (b"smartTagTypes", "smartTagTypes"),
    (b"fileRecoveryPr", "fileRecoveryPr"),
    (b"webPublishObjects", "webPublishObjects"),
    (b"extLst", "extLst"),
];

pub(super) fn unsupported_workbook_elements(workbook_xml: &[u8]) -> Vec<String> {
    let Some((body_start, body_end)) = workbook_body_bounds(workbook_xml) else {
        return Vec::new();
    };
    let body = &workbook_xml[body_start..body_end];

    UNSUPPORTED_WORKBOOK_ELEMENTS
        .iter()
        .filter_map(|(local_name, label)| {
            direct_child_start(body, local_name).map(|_| (*label).to_string())
        })
        .collect()
}

pub(super) fn unsupported_workbook_mce(workbook_xml: &[u8]) -> Vec<String> {
    let mut unsupported = Vec::new();
    if workbook_root_start_tag(workbook_xml).is_some_and(contains_must_understand_attr) {
        unsupported.push("mc:MustUnderstand".to_string());
    }

    if let Some((body_start, body_end)) = workbook_body_bounds(workbook_xml) {
        let body = &workbook_xml[body_start..body_end];
        if direct_child_start(body, b"AlternateContent").is_some() {
            unsupported.push("mc:AlternateContent".to_string());
        }
    }

    unsupported
}

fn workbook_body_bounds(xml: &[u8]) -> Option<(usize, usize)> {
    let workbook_start = find_tag_simd(xml, b"workbook", 0)?;
    let open_end = find_gt_simd(xml, workbook_start)?;
    if open_end > workbook_start && xml[open_end - 1] == b'/' {
        return None;
    }
    let close_start = find_closing_tag(xml, b"workbook", open_end)?;
    Some((open_end + 1, close_start))
}

fn workbook_root_start_tag(xml: &[u8]) -> Option<&[u8]> {
    let workbook_start = find_tag_simd(xml, b"workbook", 0)?;
    let open_end = find_gt_simd(xml, workbook_start)?;
    Some(&xml[workbook_start..=open_end])
}

fn direct_child_start(body: &[u8], child_local_name: &[u8]) -> Option<usize> {
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
        if local_name(&body[name_start..name_end]) == child_local_name {
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
        if matches!(xml[pos], b'>' | b'/' | b' ' | b'\t' | b'\n' | b'\r') {
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

fn contains_must_understand_attr(tag: &[u8]) -> bool {
    tag.windows(b"MustUnderstand".len())
        .any(|window| window == b"MustUnderstand")
}
