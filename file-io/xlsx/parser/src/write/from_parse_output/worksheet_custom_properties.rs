use std::collections::HashMap;

use domain_types::{RoundTripContext, SheetRoundTripContext};

pub(super) const REL_WORKSHEET_CUSTOM_PROPERTY: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/customProperty";

pub(super) const CT_WORKSHEET_CUSTOM_PROPERTY: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.customProperty+xml";

#[derive(Clone)]
pub(super) struct WorksheetCustomProperties {
    pub xml: String,
    pub parts: Vec<WorksheetCustomPropertyPart>,
}

#[derive(Clone)]
pub(super) struct WorksheetCustomPropertyPart {
    pub path: String,
    pub relationship_id_hint: String,
    pub data: Vec<u8>,
}

pub(super) fn custom_properties_for_export(
    _round_trip_ctx: &RoundTripContext,
    _sheet_rt: &SheetRoundTripContext,
    _sheet_idx: usize,
) -> Option<WorksheetCustomProperties> {
    None
}

pub(super) fn with_resolved_relationship_ids(
    xml: &str,
    resolved_ids: &HashMap<String, String>,
) -> String {
    let mut remapped = xml.to_string();
    for (old_id, new_id) in resolved_ids {
        remapped = remapped.replace(&format!("r:id=\"{old_id}\""), &format!("r:id=\"{new_id}\""));
        remapped = remapped.replace(&format!("r:id='{old_id}'"), &format!("r:id='{new_id}'"));
    }
    remapped
}

fn custom_property_relationship_ids(xml: &str) -> Vec<String> {
    let mut ids = Vec::new();
    let mut rest = xml.as_bytes();
    while let Some(pos) = find_subslice(rest, b"customPr") {
        rest = &rest[pos + b"customPr".len()..];
        let Some(tag_end) = memchr::memchr(b'>', rest) else {
            break;
        };
        let tag = &rest[..tag_end];
        if let Some(id) = crate::infra::xml::parse_string_attr(tag, b"r:id") {
            ids.push(id);
        }
        rest = &rest[tag_end..];
    }
    ids
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_all_custom_property_relationship_ids() {
        let ids = custom_property_relationship_ids(
            r#"<customProperties><customPr r:id="rId1"/><customPr name="B" r:id='rId2'/></customProperties>"#,
        );

        assert_eq!(ids, vec!["rId1".to_string(), "rId2".to_string()]);
    }

    #[test]
    fn remaps_custom_property_relationship_ids() {
        let mut resolved_ids = HashMap::new();
        resolved_ids.insert("rIdOld".to_string(), "rId7".to_string());

        let xml = with_resolved_relationship_ids(r#"<customPr r:id="rIdOld"/>"#, &resolved_ids);

        assert_eq!(xml, r#"<customPr r:id="rId7"/>"#);
    }
}
