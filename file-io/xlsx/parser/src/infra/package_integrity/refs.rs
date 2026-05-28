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
    for id in extract_r_ids(&xml) {
        if !defined_ids.contains(id.as_str()) {
            errors.push(
                PackageIntegrityError::MissingWorksheetRelationshipReference {
                    worksheet_path: worksheet_path.to_string(),
                    rels_path: rels_path.clone(),
                    id,
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

fn extract_r_ids(xml: &[u8]) -> Vec<String> {
    let mut ids = Vec::new();
    let mut rest = xml;
    while let Some(pos) = find_subslice(rest, b"r:id=") {
        rest = &rest[pos + b"r:id=".len()..];
        let Some((&quote, after_quote)) = rest.split_first() else {
            break;
        };
        if quote != b'"' && quote != b'\'' {
            continue;
        }
        let Some(end) = after_quote.iter().position(|b| *b == quote) else {
            break;
        };
        ids.push(String::from_utf8_lossy(&after_quote[..end]).into_owned());
        rest = &after_quote[end + 1..];
    }
    ids
}

struct RelationshipAttr {
    name: String,
    value: String,
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
        });
        pos = value_start + value_len + 1;
    }

    attrs
}
