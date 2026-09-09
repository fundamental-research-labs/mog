use crate::infra::scanner::{find_closing_tag, find_gt_simd, find_tag_simd};
use crate::infra::xml_namespaces::NS_MC;
use quick_xml::{events::Event, name::ResolveResult, NsReader};

const UNSUPPORTED_WORKBOOK_ELEMENTS: &[(&[u8], &str)] = &[
    (b"functionGroups", "functionGroups"),
    (b"oleSize", "oleSize"),
    (b"smartTagPr", "smartTagPr"),
    (b"smartTagTypes", "smartTagTypes"),
    (b"fileRecoveryPr", "fileRecoveryPr"),
    (b"webPublishObjects", "webPublishObjects"),
    (b"extLst", "extLst"),
];

/// List schema-known workbook children that have no typed parser.
///
/// This is an import inventory used by legacy diagnostics. Whether a listed
/// child is actually dropped is decided by `WorkbookXmlFidelity`: safe inert
/// children can still be preserved as raw payloads.
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

/// List workbook-level MCE constructs that the writer cannot safely replay.
/// `mc:Ignorable` is handled by the root namespace writer; processing and
/// branch-selection directives remain diagnostic-only until their owners are
/// modeled.
pub(super) fn unsupported_workbook_mce(workbook_xml: &[u8]) -> Vec<String> {
    let mut unsupported = Vec::new();
    if let Some(root_tag) = workbook_root_start_tag(workbook_xml) {
        if contains_mce_attribute(root_tag, b"MustUnderstand") {
            unsupported.push("mc:MustUnderstand".to_string());
        }
        if contains_mce_attribute(root_tag, b"ProcessContent") {
            unsupported.push("mc:ProcessContent".to_string());
        }
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

fn contains_mce_attribute(tag: &[u8], expected_local_name: &[u8]) -> bool {
    let Ok(tag) = std::str::from_utf8(tag) else {
        return false;
    };
    let mut reader = NsReader::from_str(tag);
    let Ok(event) = reader.read_event() else {
        return false;
    };
    let element = match event {
        Event::Start(element) | Event::Empty(element) => element,
        _ => return false,
    };

    element
        .attributes()
        .with_checks(false)
        .filter_map(Result::ok)
        .any(|attribute| {
            let (namespace, local_name) = reader.resolve_attribute(attribute.key);
            matches!(namespace, ResolveResult::Bound(namespace) if namespace.as_ref() == NS_MC.as_bytes())
                && local_name.as_ref() == expected_local_name
        })
}

#[cfg(test)]
mod tests {
    use super::unsupported_workbook_mce;

    #[test]
    fn mce_diagnostics_require_markup_compatibility_namespace() {
        let xml = r#"<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:compat="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:other="urn:example" compat:ProcessContent="xr" other:MustUnderstand="other" ProcessContent="literal" note="value ProcessContent=not-an-attribute"><sheets/></workbook>"#;

        assert_eq!(
            unsupported_workbook_mce(xml.as_bytes()),
            vec!["mc:ProcessContent".to_string()]
        );
    }

    #[test]
    fn mce_diagnostics_accept_an_alternate_markup_compatibility_prefix() {
        let xml = r#"<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:compat="http://schemas.openxmlformats.org/markup-compatibility/2006" compat:MustUnderstand="x15"><sheets/></workbook>"#;

        assert_eq!(
            unsupported_workbook_mce(xml.as_bytes()),
            vec!["mc:MustUnderstand".to_string()]
        );
    }
}
