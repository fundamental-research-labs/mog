//! Raw XML preservation helpers for drawing passthrough cases.

use super::elements::direct_child_slice;
use crate::infra::scanner::{find_closing_tag, find_element_end, find_tag_simd};

/// Extract a complete element as UTF-8 raw XML.
pub(crate) fn extract_element_raw_string(
    xml: &[u8],
    local_name: &[u8],
    start: usize,
) -> Option<(String, usize)> {
    let open_end = find_element_end(xml, start)?;
    let end = if is_self_closing_open_tag(xml, open_end) {
        open_end + 1
    } else {
        let close_lt = find_closing_tag(xml, local_name, start)?;
        find_element_end(xml, close_lt)? + 1
    };
    let raw = std::str::from_utf8(xml.get(start..end)?).ok()?.to_string();
    Some((raw, end))
}

/// Extract raw `<extLst>...</extLst>` XML from a scoped element.
pub(crate) fn extract_ext_lst_raw(xml: &[u8]) -> Option<String> {
    direct_child_raw(xml, b"extLst")
}

/// Extract a direct child `mc:AlternateContent` block from a scoped element.
pub(crate) fn direct_alternate_content_raw(xml: &[u8]) -> Option<String> {
    direct_child_raw(xml, b"AlternateContent")
}

/// Whether a scoped XML block contains a graphic frame element.
pub(crate) fn contains_graphic_frame(xml: &[u8]) -> bool {
    find_tag_simd(xml, b"graphicFrame", 0).is_some()
}

/// Extract common DrawingML relationship ids from preserved raw XML.
///
/// Raw passthrough blocks can carry relationships on several attributes, not
/// only `r:id`. These ids are the relationship graph contract conversion uses
/// to decide whether an opaque payload has a closed, resolvable subgraph.
pub(crate) fn relationship_ids_in_raw(xml: &str) -> Vec<String> {
    const RELATIONSHIP_ATTRIBUTES: [&str; 7] =
        ["r:id", "r:embed", "r:link", "r:dm", "r:lo", "r:qs", "r:cs"];

    let mut ids = Vec::new();
    let mut offset = 0;
    while let Some(pos) = xml[offset..].find("r:") {
        let attr_start = offset + pos;
        let candidate = &xml[attr_start..];
        let Some(eq) = candidate.find('=') else {
            break;
        };
        let attr = candidate[..eq].trim();
        let value = candidate[eq + 1..].trim_start();
        if RELATIONSHIP_ATTRIBUTES.contains(&attr)
            && let Some(quote) = value.as_bytes().first().copied()
            && matches!(quote, b'"' | b'\'')
        {
            let value = &value[1..];
            if let Some(end) = value.as_bytes().iter().position(|byte| *byte == quote) {
                let id = &value[..end];
                if !ids.iter().any(|existing| existing == id) {
                    ids.push(id.to_string());
                }
                offset = attr_start + eq + 2 + end;
                continue;
            }
            break;
        }
        offset = attr_start + 2;
    }
    ids
}

fn direct_child_raw(xml: &[u8], local_name: &[u8]) -> Option<String> {
    let child = direct_child_slice(xml, local_name)?;
    std::str::from_utf8(child).ok().map(ToOwned::to_owned)
}

fn is_self_closing_open_tag(xml: &[u8], open_end: usize) -> bool {
    xml[..open_end]
        .iter()
        .rposition(|b| !b.is_ascii_whitespace())
        .is_some_and(|pos| xml[pos] == b'/')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn raw_relationship_extraction_covers_common_drawingml_attributes() {
        let xml = r#"<a:graphic>
            <a:blip r:embed="rIdImage" r:link='rIdExternal'/>
            <dgm:relIds r:dm="rIdDm" r:lo="rIdLo" r:qs="rIdQs" r:cs="rIdCs"/>
            <cx:chart r:id="rIdChart"/>
            <cx:chart r:id="rIdChart"/>
        </a:graphic>"#;

        assert_eq!(
            relationship_ids_in_raw(xml),
            [
                "rIdImage",
                "rIdExternal",
                "rIdDm",
                "rIdLo",
                "rIdQs",
                "rIdCs",
                "rIdChart"
            ]
        );
    }
}
