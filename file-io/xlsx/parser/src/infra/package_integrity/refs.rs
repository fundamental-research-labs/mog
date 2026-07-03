use std::collections::{HashMap, HashSet};

use ooxml_types::shared::OpcRelationship;

use crate::zip::XlsxArchive;

use super::error::PackageIntegrityError;
use super::paths::{find_subslice, part_rels_path, worksheet_rels_path};

pub(super) fn validate_worksheet_r_ids(
    archive: &XlsxArchive<'_>,
    worksheet_path: &str,
    relationships_by_part: &HashMap<String, Vec<OpcRelationship>>,
    errors: &mut Vec<PackageIntegrityError>,
) {
    let Ok(xml) = archive.read_file(worksheet_path) else {
        return;
    };
    let rels_path = worksheet_rels_path(worksheet_path);
    let defined_ids: HashSet<&str> = relationships_by_part
        .get(&rels_path)
        .into_iter()
        .flatten()
        .map(|rel| rel.id.as_str())
        .collect();
    for attr in extract_prefixed_attr_values(&xml, "id") {
        if is_worksheet_control_reference(&xml, attr.start) {
            continue;
        }
        if !defined_ids.contains(attr.value.as_str()) {
            errors.push(
                PackageIntegrityError::MissingWorksheetRelationshipReference {
                    worksheet_path: worksheet_path.to_string(),
                    rels_path: rels_path.clone(),
                    id: attr.value,
                },
            );
        }
    }
}

pub(super) fn validate_part_relationship_references(
    archive: &XlsxArchive<'_>,
    part_path: &str,
    relationships_by_part: &HashMap<String, Vec<OpcRelationship>>,
    errors: &mut Vec<PackageIntegrityError>,
) {
    let Ok(xml) = archive.read_file(part_path) else {
        return;
    };
    let rels_path = part_rels_path(part_path);
    let defined_ids: HashSet<&str> = relationships_by_part
        .get(&rels_path)
        .into_iter()
        .flatten()
        .map(|rel| rel.id.as_str())
        .collect();
    for attr in extract_relationship_attrs(&xml) {
        if !defined_ids.contains(attr.value.as_str()) {
            errors.push(PackageIntegrityError::MissingPartRelationshipReference {
                part_path: part_path.to_string(),
                rels_path: rels_path.clone(),
                id: attr.value,
                attr_name: attr.name,
            });
        }
    }
}

struct RelationshipAttr {
    name: String,
    value: String,
    start: usize,
}

fn extract_relationship_attrs(xml: &[u8]) -> Vec<RelationshipAttr> {
    ["id", "embed", "link", "relid"]
        .into_iter()
        .flat_map(|local_name| extract_prefixed_attr_values(xml, local_name))
        .collect()
}

fn extract_prefixed_attr_values(xml: &[u8], local_name: &str) -> Vec<RelationshipAttr> {
    let mut attrs = Vec::new();
    let pattern = format!(":{local_name}");
    let pattern = pattern.as_bytes();
    let mut pos = 0;

    while let Some(offset) = find_subslice(&xml[pos..], pattern) {
        let attr_start = pos + offset;
        let name_end = attr_start + pattern.len();
        let mut cursor = name_end;
        while xml
            .get(cursor)
            .is_some_and(|byte| byte.is_ascii_whitespace())
        {
            cursor += 1;
        }
        if xml.get(cursor) != Some(&b'=') {
            pos = name_end;
            continue;
        }
        cursor += 1;
        while xml
            .get(cursor)
            .is_some_and(|byte| byte.is_ascii_whitespace())
        {
            cursor += 1;
        }
        let Some(&quote) = xml.get(cursor) else {
            pos = name_end;
            continue;
        };
        if quote != b'"' && quote != b'\'' {
            pos = name_end;
            continue;
        }
        let value_start = cursor + 1;
        let Some(value_len) = xml[value_start..].iter().position(|b| *b == quote) else {
            break;
        };
        let prefix_start = xml[..attr_start]
            .iter()
            .rposition(|byte| byte.is_ascii_whitespace() || *byte == b'<' || *byte == b'/')
            .map_or(0, |idx| idx + 1);
        attrs.push(RelationshipAttr {
            name: String::from_utf8_lossy(&xml[prefix_start..name_end]).into_owned(),
            value: String::from_utf8_lossy(&xml[value_start..value_start + value_len]).into_owned(),
            start: attr_start,
        });
        pos = value_start + value_len + 1;
    }

    attrs
}

fn is_worksheet_control_reference(xml: &[u8], attr_start: usize) -> bool {
    let Some(tag_start) = xml[..attr_start].iter().rposition(|byte| *byte == b'<') else {
        return false;
    };
    if xml.get(tag_start + 1) == Some(&b'/') {
        return false;
    }
    let mut name_start = tag_start + 1;
    let mut name_end = name_start;
    while name_end < xml.len() {
        let b = xml[name_end];
        if matches!(b, b' ' | b'\t' | b'\n' | b'\r' | b'>' | b'/') {
            break;
        }
        name_end += 1;
    }
    if let Some(colon_offset) = xml[name_start..name_end]
        .iter()
        .position(|byte| *byte == b':')
    {
        name_start += colon_offset + 1;
    }
    &xml[name_start..name_end] == b"control"
}
