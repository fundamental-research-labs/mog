use std::collections::HashMap;

use domain_types::{
    OpaquePackageOwner, OpaquePackageOwnership, OpaquePackageRelationship,
    OpaqueRelationshipTarget, RoundTripContext, SheetRoundTripContext,
};

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
    round_trip_ctx: &RoundTripContext,
    sheet_rt: &SheetRoundTripContext,
    sheet_idx: usize,
) -> Option<WorksheetCustomProperties> {
    let xml = sheet_rt.custom_properties_xml.as_ref()?;
    let relationship_ids = custom_property_relationship_ids(xml);
    if relationship_ids.is_empty() {
        return None;
    }

    let clean_parts = clean_opaque_custom_property_parts(round_trip_ctx, sheet_idx);

    let mut parts = Vec::with_capacity(relationship_ids.len());
    for relationship_id in relationship_ids {
        let (path, data) = clean_parts.get(&relationship_id)?;
        parts.push(WorksheetCustomPropertyPart {
            path: path.clone(),
            relationship_id_hint: relationship_id,
            data: data.clone(),
        });
    }

    Some(WorksheetCustomProperties {
        xml: xml.clone(),
        parts,
    })
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

fn clean_opaque_custom_property_parts(
    round_trip_ctx: &RoundTripContext,
    sheet_idx: usize,
) -> HashMap<String, (String, Vec<u8>)> {
    let mut parts_by_relationship_id = HashMap::new();
    for subgraph in &round_trip_ctx.opaque_package_subgraphs {
        if subgraph.ownership != OpaquePackageOwnership::CleanImported {
            continue;
        }
        let mut relationships = Vec::with_capacity(1 + subgraph.relationships.len());
        relationships.push(&subgraph.owner_relationship);
        relationships.extend(subgraph.relationships.iter());
        for relationship in relationships {
            if !is_worksheet_custom_property_relationship(relationship, sheet_idx) {
                continue;
            }
            let Some(relationship_id) = relationship.relationship_id_hint.clone() else {
                continue;
            };
            let OpaqueRelationshipTarget::InternalPart { path } = &relationship.target else {
                continue;
            };
            let Some(part) = subgraph.parts.iter().find(|part| {
                part.content_type.as_deref() == Some(CT_WORKSHEET_CUSTOM_PROPERTY)
                    && part.part.path.trim_start_matches('/') == path.trim_start_matches('/')
                    && part.ownership == OpaquePackageOwnership::CleanImported
            }) else {
                continue;
            };
            parts_by_relationship_id.insert(
                relationship_id,
                (
                    part.part.path.trim_start_matches('/').to_string(),
                    part.part.data.clone(),
                ),
            );
        }
    }
    parts_by_relationship_id
}

pub(super) fn is_worksheet_custom_property_relationship(
    relationship: &OpaquePackageRelationship,
    sheet_idx: usize,
) -> bool {
    relationship.relationship_type == REL_WORKSHEET_CUSTOM_PROPERTY
        && matches!(
            relationship.owner,
            OpaquePackageOwner::Worksheet { index, .. } if index == sheet_idx
        )
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
