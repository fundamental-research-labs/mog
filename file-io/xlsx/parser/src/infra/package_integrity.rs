//! OPC package integrity validation for XLSX archives.
//!
//! This module validates cross-part package invariants that individual feature
//! writers cannot prove locally.

use std::collections::{HashMap, HashSet};

use crate::domain::content_types::read::ContentTypes;
use crate::domain::web_extensions::read::{
    CT_WEB_EXTENSION_TASKPANES, REL_WEB_EXTENSION_TASKPANES,
};
use crate::domain::workbook::read::parse_all_rels;
use crate::infra::opc::{
    OpcTargetResolutionError, relationship_owner_from_rels_path, resolve_relationship_target,
};
use crate::write::{
    CT_CHART, CT_COMMENTS, CT_CORE_PROPERTIES, CT_CUSTOM_PROPERTIES, CT_DRAWING,
    CT_EXTENDED_PROPERTIES, CT_SHARED_STRINGS, CT_STYLES, CT_TABLE, CT_THEME, CT_WORKSHEET,
    REL_CHART, REL_CHART_EX, REL_COMMENTS, REL_CORE_PROPERTIES, REL_CUSTOM_PROPERTIES, REL_DRAWING,
    REL_EXTENDED_PROPERTIES, REL_OFFICE_DOCUMENT, REL_SHARED_STRINGS, REL_STYLES, REL_TABLE,
    REL_THEME, REL_THREADED_COMMENT, REL_WORKSHEET,
};
use crate::zip::XlsxArchive;

const CT_CHART_EX: &str = "application/vnd.ms-office.chartex+xml";
const CT_THREADED_COMMENTS: &str = "application/vnd.ms-excel.threadedcomments+xml";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PackageIntegrityError {
    MissingRelationshipOwner {
        rels_path: String,
        owner_path: String,
    },
    DuplicateRelationshipId {
        rels_path: String,
        id: String,
    },
    InvalidRelationshipTarget {
        rels_path: String,
        id: String,
        target: String,
        reason: String,
    },
    MissingRelationshipTarget {
        rels_path: String,
        id: String,
        target: String,
        resolved_path: String,
    },
    MissingRequiredRelationship {
        rels_path: String,
        rel_type: &'static str,
        target_path: String,
    },
    MissingRequiredContentType {
        part_path: String,
        content_type: &'static str,
    },
    ContentTypeForMissingPart {
        part_path: String,
        content_type: String,
    },
    MissingWorksheetRelationshipReference {
        worksheet_path: String,
        rels_path: String,
        id: String,
    },
    MissingPartRelationshipReference {
        part_path: String,
        rels_path: String,
        id: String,
        attr_name: String,
    },
}

impl std::fmt::Display for PackageIntegrityError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::MissingRelationshipOwner {
                rels_path,
                owner_path,
            } => write!(
                f,
                "relationship part {rels_path} has missing owner part {owner_path}"
            ),
            Self::DuplicateRelationshipId { rels_path, id } => {
                write!(f, "relationship part {rels_path} has duplicate Id {id}")
            }
            Self::InvalidRelationshipTarget {
                rels_path,
                id,
                target,
                reason,
            } => write!(
                f,
                "relationship {id} in {rels_path} has invalid target {target}: {reason}"
            ),
            Self::MissingRelationshipTarget {
                rels_path,
                id,
                target,
                resolved_path,
            } => write!(
                f,
                "relationship {id} in {rels_path} targets missing part {resolved_path} from target {target}"
            ),
            Self::MissingRequiredRelationship {
                rels_path,
                rel_type,
                target_path,
            } => write!(
                f,
                "relationship part {rels_path} is missing required relationship type {rel_type} targeting {target_path}"
            ),
            Self::MissingRequiredContentType {
                part_path,
                content_type,
            } => write!(
                f,
                "part {part_path} is missing required content type {content_type}"
            ),
            Self::ContentTypeForMissingPart {
                part_path,
                content_type,
            } => write!(
                f,
                "[Content_Types].xml contains override {content_type} for missing part {part_path}"
            ),
            Self::MissingWorksheetRelationshipReference {
                worksheet_path,
                rels_path,
                id,
            } => write!(
                f,
                "worksheet {worksheet_path} references relationship {id}, but {rels_path} does not define it"
            ),
            Self::MissingPartRelationshipReference {
                part_path,
                rels_path,
                id,
                attr_name,
            } => write!(
                f,
                "part {part_path} references relationship {id} through {attr_name}, but {rels_path} does not define it"
            ),
        }
    }
}

impl std::error::Error for PackageIntegrityError {}

pub fn validate_archive_package_integrity(
    archive: &XlsxArchive<'_>,
) -> Result<(), Vec<PackageIntegrityError>> {
    let mut errors = Vec::new();
    let mut relationships_by_part: HashMap<String, Vec<ooxml_types::shared::OpcRelationship>> =
        HashMap::new();

    for entry in archive.entries() {
        let rels_path = entry.name.as_str();
        if !is_relationship_part(rels_path) {
            continue;
        }

        let owner = relationship_owner_from_rels_path(rels_path);
        if let Some(owner_path) = owner.as_deref()
            && !archive.contains(owner_path)
        {
            errors.push(PackageIntegrityError::MissingRelationshipOwner {
                rels_path: rels_path.to_string(),
                owner_path: owner_path.to_string(),
            });
        }

        let rels_xml = match archive.read_file(rels_path) {
            Ok(xml) => xml,
            Err(_) => continue,
        };
        let rels = parse_all_rels(&rels_xml);
        relationships_by_part.insert(rels_path.to_string(), rels.clone());
        let mut seen_ids = HashSet::new();
        for rel in rels {
            if !seen_ids.insert(rel.id.clone()) {
                errors.push(PackageIntegrityError::DuplicateRelationshipId {
                    rels_path: rels_path.to_string(),
                    id: rel.id.clone(),
                });
            }

            if rel.target_mode.as_deref() == Some("External") {
                continue;
            }

            let Some(target_part) = relationship_target_part(&rel.target) else {
                continue;
            };

            let resolved = match resolve_relationship_target(owner.as_deref(), target_part) {
                Ok(path) => path,
                Err(err) => {
                    errors.push(PackageIntegrityError::InvalidRelationshipTarget {
                        rels_path: rels_path.to_string(),
                        id: rel.id.clone(),
                        target: rel.target.clone(),
                        reason: format_resolution_error(err),
                    });
                    continue;
                }
            };

            if !archive.contains(&resolved) {
                errors.push(PackageIntegrityError::MissingRelationshipTarget {
                    rels_path: rels_path.to_string(),
                    id: rel.id,
                    target: rel.target,
                    resolved_path: resolved,
                });
            }
        }
    }

    validate_content_types(archive, &mut errors);
    if archive.contains("[Content_Types].xml") && archive.contains("_rels/.rels") {
        validate_modeled_part_invariants(archive, &relationships_by_part, &mut errors);
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}

fn validate_content_types(archive: &XlsxArchive<'_>, errors: &mut Vec<PackageIntegrityError>) {
    let Ok(xml) = archive.read_file("[Content_Types].xml") else {
        return;
    };
    let Ok(content_types) = ContentTypes::parse(&xml) else {
        return;
    };

    for (part_path, content_type) in content_types.overrides() {
        if !archive.contains(part_path) {
            errors.push(PackageIntegrityError::ContentTypeForMissingPart {
                part_path: part_path.to_string(),
                content_type: content_type.to_string(),
            });
        }
    }
}

fn validate_modeled_part_invariants(
    archive: &XlsxArchive<'_>,
    relationships_by_part: &HashMap<String, Vec<ooxml_types::shared::OpcRelationship>>,
    errors: &mut Vec<PackageIntegrityError>,
) {
    require_relationship(
        relationships_by_part,
        "_rels/.rels",
        REL_OFFICE_DOCUMENT,
        "xl/workbook.xml",
        errors,
    );

    if archive.contains("docProps/core.xml") {
        require_relationship(
            relationships_by_part,
            "_rels/.rels",
            REL_CORE_PROPERTIES,
            "docProps/core.xml",
            errors,
        );
        require_content_type(archive, "docProps/core.xml", CT_CORE_PROPERTIES, errors);
    }
    if archive.contains("docProps/app.xml") {
        require_relationship(
            relationships_by_part,
            "_rels/.rels",
            REL_EXTENDED_PROPERTIES,
            "docProps/app.xml",
            errors,
        );
        require_content_type(archive, "docProps/app.xml", CT_EXTENDED_PROPERTIES, errors);
    }
    if archive.contains("docProps/custom.xml") {
        require_relationship(
            relationships_by_part,
            "_rels/.rels",
            REL_CUSTOM_PROPERTIES,
            "docProps/custom.xml",
            errors,
        );
        require_content_type(archive, "docProps/custom.xml", CT_CUSTOM_PROPERTIES, errors);
    }
    if archive.contains("xl/webextensions/taskpanes.xml") {
        require_relationship(
            relationships_by_part,
            "_rels/.rels",
            REL_WEB_EXTENSION_TASKPANES,
            "xl/webextensions/taskpanes.xml",
            errors,
        );
        require_content_type(
            archive,
            "xl/webextensions/taskpanes.xml",
            CT_WEB_EXTENSION_TASKPANES,
            errors,
        );
    }

    let workbook_rels = "xl/_rels/workbook.xml.rels";
    if archive.contains("xl/sharedStrings.xml") {
        require_relationship(
            relationships_by_part,
            workbook_rels,
            REL_SHARED_STRINGS,
            "xl/sharedStrings.xml",
            errors,
        );
        require_content_type(archive, "xl/sharedStrings.xml", CT_SHARED_STRINGS, errors);
    }
    if archive.contains("xl/styles.xml") {
        require_relationship(
            relationships_by_part,
            workbook_rels,
            REL_STYLES,
            "xl/styles.xml",
            errors,
        );
        require_content_type(archive, "xl/styles.xml", CT_STYLES, errors);
    }
    if archive.contains("xl/theme/theme1.xml") {
        require_relationship(
            relationships_by_part,
            workbook_rels,
            REL_THEME,
            "xl/theme/theme1.xml",
            errors,
        );
        require_content_type(archive, "xl/theme/theme1.xml", CT_THEME, errors);
    }

    for entry in archive.entries() {
        let path = entry.name.as_str();
        if is_relationship_reference_part(path) && !is_worksheet_part(path) {
            validate_part_relationship_references(archive, path, relationships_by_part, errors);
        }
        if is_worksheet_part(path) {
            require_relationship(
                relationships_by_part,
                workbook_rels,
                REL_WORKSHEET,
                path,
                errors,
            );
            require_content_type(archive, path, CT_WORKSHEET, errors);
            validate_worksheet_r_ids(archive, path, relationships_by_part, errors);
        } else if is_table_part(path) {
            require_any_relationship_to_path(relationships_by_part, REL_TABLE, path, errors);
            require_content_type(archive, path, CT_TABLE, errors);
        } else if is_comment_part(path) {
            require_any_relationship_to_path(relationships_by_part, REL_COMMENTS, path, errors);
            require_content_type(archive, path, CT_COMMENTS, errors);
        } else if is_threaded_comment_part(path) {
            require_any_relationship_to_path(
                relationships_by_part,
                REL_THREADED_COMMENT,
                path,
                errors,
            );
            require_content_type(archive, path, CT_THREADED_COMMENTS, errors);
        } else if is_drawing_part(path) {
            require_any_relationship_to_path(relationships_by_part, REL_DRAWING, path, errors);
            require_content_type(archive, path, CT_DRAWING, errors);
        } else if is_chart_ex_part(path) {
            require_any_relationship_to_path(relationships_by_part, REL_CHART_EX, path, errors);
            require_content_type(archive, path, CT_CHART_EX, errors);
        } else if is_chart_part(path) {
            require_any_relationship_to_path(relationships_by_part, REL_CHART, path, errors);
            require_content_type(archive, path, CT_CHART, errors);
        }
    }
}

fn require_content_type(
    archive: &XlsxArchive<'_>,
    part_path: &str,
    content_type: &'static str,
    errors: &mut Vec<PackageIntegrityError>,
) {
    let Ok(xml) = archive.read_file("[Content_Types].xml") else {
        return;
    };
    let Ok(content_types) = ContentTypes::parse(&xml) else {
        return;
    };
    if content_types.get_type(part_path) != Some(content_type) {
        errors.push(PackageIntegrityError::MissingRequiredContentType {
            part_path: part_path.to_string(),
            content_type,
        });
    }
}

fn require_relationship(
    relationships_by_part: &HashMap<String, Vec<ooxml_types::shared::OpcRelationship>>,
    rels_path: &'static str,
    rel_type: &'static str,
    target_path: &str,
    errors: &mut Vec<PackageIntegrityError>,
) {
    if has_relationship_to_path(relationships_by_part, rels_path, rel_type, target_path) {
        return;
    }
    errors.push(PackageIntegrityError::MissingRequiredRelationship {
        rels_path: rels_path.to_string(),
        rel_type,
        target_path: target_path.to_string(),
    });
}

fn require_any_relationship_to_path(
    relationships_by_part: &HashMap<String, Vec<ooxml_types::shared::OpcRelationship>>,
    rel_type: &'static str,
    target_path: &str,
    errors: &mut Vec<PackageIntegrityError>,
) {
    if relationships_by_part.keys().any(|rels_path| {
        has_relationship_to_path(relationships_by_part, rels_path, rel_type, target_path)
    }) {
        return;
    }
    errors.push(PackageIntegrityError::MissingRequiredRelationship {
        rels_path: "*".to_string(),
        rel_type,
        target_path: target_path.to_string(),
    });
}

fn has_relationship_to_path(
    relationships_by_part: &HashMap<String, Vec<ooxml_types::shared::OpcRelationship>>,
    rels_path: &str,
    rel_type: &str,
    target_path: &str,
) -> bool {
    let owner = relationship_owner_from_rels_path(rels_path);
    relationships_by_part
        .get(rels_path)
        .into_iter()
        .flatten()
        .any(|rel| {
            rel.rel_type == rel_type
                && rel.target_mode.as_deref() != Some("External")
                && relationship_target_part(&rel.target)
                    .and_then(|target| resolve_relationship_target(owner.as_deref(), target).ok())
                    .as_deref()
                    == Some(target_path)
        })
}

fn validate_worksheet_r_ids(
    archive: &XlsxArchive<'_>,
    worksheet_path: &str,
    relationships_by_part: &HashMap<String, Vec<ooxml_types::shared::OpcRelationship>>,
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

fn validate_part_relationship_references(
    archive: &XlsxArchive<'_>,
    part_path: &str,
    relationships_by_part: &HashMap<String, Vec<ooxml_types::shared::OpcRelationship>>,
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

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn part_rels_path(part_path: &str) -> String {
    let (dir, file) = part_path.rsplit_once('/').unwrap_or(("", part_path));
    if dir.is_empty() {
        format!("_rels/{file}.rels")
    } else {
        format!("{dir}/_rels/{file}.rels")
    }
}

fn is_xml_part(path: &str) -> bool {
    path.ends_with(".xml") && path != "[Content_Types].xml" && !is_relationship_part(path)
}

fn is_relationship_reference_part(path: &str) -> bool {
    is_xml_part(path) || path.ends_with(".vml")
}

fn worksheet_rels_path(worksheet_path: &str) -> String {
    let (dir, file) = worksheet_path
        .rsplit_once('/')
        .unwrap_or(("", worksheet_path));
    if dir.is_empty() {
        format!("_rels/{file}.rels")
    } else {
        format!("{dir}/_rels/{file}.rels")
    }
}

fn is_relationship_part(path: &str) -> bool {
    path == "_rels/.rels" || (path.contains("/_rels/") && path.ends_with(".rels"))
}

fn is_worksheet_part(path: &str) -> bool {
    path.starts_with("xl/worksheets/sheet") && path.ends_with(".xml")
}

fn is_table_part(path: &str) -> bool {
    path.starts_with("xl/tables/table") && path.ends_with(".xml")
}

fn is_comment_part(path: &str) -> bool {
    path.starts_with("xl/comments") && path.ends_with(".xml")
}

fn is_threaded_comment_part(path: &str) -> bool {
    path.starts_with("xl/threadedComments/threadedComment") && path.ends_with(".xml")
}

fn is_drawing_part(path: &str) -> bool {
    path.starts_with("xl/drawings/drawing") && path.ends_with(".xml")
}

fn is_chart_part(path: &str) -> bool {
    path.starts_with("xl/charts/chart")
        && !path.starts_with("xl/charts/chartEx")
        && path.ends_with(".xml")
}

fn is_chart_ex_part(path: &str) -> bool {
    path.starts_with("xl/charts/chartEx") && path.ends_with(".xml")
}

fn relationship_target_part(target: &str) -> Option<&str> {
    let part = target.split_once('#').map_or(target, |(part, _)| part);
    (!part.is_empty()).then_some(part)
}

fn format_resolution_error(err: OpcTargetResolutionError) -> String {
    match err {
        OpcTargetResolutionError::EmptyTarget => "empty internal target".to_string(),
        OpcTargetResolutionError::BackslashTarget => {
            "internal target contains backslash separators".to_string()
        }
        OpcTargetResolutionError::EscapesPackageRoot => {
            "internal target escapes package root".to_string()
        }
        OpcTargetResolutionError::InvalidSegment => {
            "internal target contains an invalid path segment".to_string()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::write::ZipWriter;

    fn archive(entries: &[(&str, &[u8])]) -> XlsxArchive<'static> {
        let mut zip = ZipWriter::new();
        for (path, data) in entries {
            zip.add_file(path, data.to_vec());
        }
        let bytes = zip.finish().expect("zip should finish");
        let leaked = Box::leak(bytes.into_boxed_slice());
        XlsxArchive::new(leaked).expect("archive should open")
    }

    fn valid_content_types(extra: &str) -> Vec<u8> {
        format!(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
{extra}</Types>"#
        )
        .into_bytes()
    }

    fn root_rels() -> &'static [u8] {
        br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="/xl/workbook.xml"/></Relationships>"#
    }

    fn workbook_rels(extra: &str) -> Vec<u8> {
        format!(
            r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>{extra}</Relationships>"#
        )
        .into_bytes()
    }

    #[test]
    fn valid_internal_relationship_target_passes() {
        let archive = archive(&[
            ("xl/workbook.xml", b"<workbook/>"),
            (
                "xl/_rels/workbook.xml.rels",
                br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#,
            ),
            ("xl/worksheets/sheet1.xml", b"<worksheet/>"),
        ]);

        validate_archive_package_integrity(&archive).expect("package should be valid");
    }

    #[test]
    fn missing_internal_relationship_target_fails() {
        let archive = archive(&[
            ("xl/workbook.xml", b"<workbook/>"),
            (
                "xl/_rels/workbook.xml.rels",
                br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/missing.xml"/></Relationships>"#,
            ),
        ]);

        let errors = validate_archive_package_integrity(&archive).expect_err("target is missing");
        assert!(matches!(
            errors.as_slice(),
            [PackageIntegrityError::MissingRelationshipTarget { resolved_path, .. }]
                if resolved_path == "xl/worksheets/missing.xml"
        ));
    }

    #[test]
    fn fragment_only_relationship_target_passes_without_part_lookup() {
        let archive = archive(&[
            ("xl/drawings/drawing1.xml", b"<xdr:wsDr/>"),
            (
                "xl/drawings/_rels/drawing1.xml.rels",
                br##"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="#Summary!A1"/></Relationships>"##,
            ),
        ]);

        validate_archive_package_integrity(&archive)
            .expect("fragment-only target is not a package part");
    }

    #[test]
    fn relationship_target_with_fragment_validates_base_part() {
        let archive = archive(&[
            ("xl/workbook.xml", b"<workbook/>"),
            (
                "xl/_rels/workbook.xml.rels",
                br##"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml#A1"/></Relationships>"##,
            ),
            ("xl/worksheets/sheet1.xml", b"<worksheet/>"),
        ]);

        validate_archive_package_integrity(&archive).expect("base package part exists");
    }

    #[test]
    fn missing_relationship_target_with_fragment_fails_on_base_part() {
        let archive = archive(&[
            ("xl/workbook.xml", b"<workbook/>"),
            (
                "xl/_rels/workbook.xml.rels",
                br##"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/missing.xml#A1"/></Relationships>"##,
            ),
        ]);

        let errors = validate_archive_package_integrity(&archive).expect_err("target is missing");
        assert!(matches!(
            errors.as_slice(),
            [PackageIntegrityError::MissingRelationshipTarget { resolved_path, .. }]
                if resolved_path == "xl/worksheets/missing.xml"
        ));
    }

    #[test]
    fn missing_relationship_owner_fails() {
        let archive = archive(&[(
            "xl/worksheets/_rels/sheet1.xml.rels",
            br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>"#,
        )]);

        let errors = validate_archive_package_integrity(&archive).expect_err("owner is missing");
        assert!(matches!(
            errors.as_slice(),
            [PackageIntegrityError::MissingRelationshipOwner { owner_path, .. }]
                if owner_path == "xl/worksheets/sheet1.xml"
        ));
    }

    #[test]
    fn content_type_override_for_missing_part_fails() {
        let content_types = valid_content_types(
            r#"<Override PartName="/xl/missing.xml" ContentType="application/xml"/>"#,
        );
        let workbook_rels = workbook_rels("");
        let archive = archive(&[
            ("[Content_Types].xml", &content_types),
            ("_rels/.rels", root_rels()),
            ("xl/workbook.xml", b"<workbook/>"),
            ("xl/_rels/workbook.xml.rels", &workbook_rels),
            ("xl/styles.xml", b"<styleSheet/>"),
            ("xl/worksheets/sheet1.xml", b"<worksheet/>"),
        ]);

        let errors = validate_archive_package_integrity(&archive).expect_err("override is stale");
        assert!(errors.iter().any(|error| matches!(
            error,
            PackageIntegrityError::ContentTypeForMissingPart { part_path, .. }
                if part_path == "xl/missing.xml"
        )));
    }

    #[test]
    fn emitted_shared_strings_without_workbook_relationship_fails() {
        let content_types = valid_content_types(
            r#"<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>"#,
        );
        let workbook_rels = workbook_rels("");
        let archive = archive(&[
            ("[Content_Types].xml", &content_types),
            ("_rels/.rels", root_rels()),
            ("xl/workbook.xml", b"<workbook/>"),
            ("xl/_rels/workbook.xml.rels", &workbook_rels),
            ("xl/styles.xml", b"<styleSheet/>"),
            ("xl/sharedStrings.xml", b"<sst/>"),
            ("xl/worksheets/sheet1.xml", b"<worksheet/>"),
        ]);

        let errors =
            validate_archive_package_integrity(&archive).expect_err("shared strings rel missing");
        assert!(errors.iter().any(|error| matches!(
            error,
            PackageIntegrityError::MissingRequiredRelationship { rel_type, target_path, .. }
                if *rel_type == REL_SHARED_STRINGS && target_path == "xl/sharedStrings.xml"
        )));
    }

    #[test]
    fn worksheet_r_id_without_matching_sheet_relationship_fails() {
        let content_types = valid_content_types("");
        let workbook_rels = workbook_rels("");
        let archive = archive(&[
            ("[Content_Types].xml", &content_types),
            ("_rels/.rels", root_rels()),
            ("xl/workbook.xml", b"<workbook/>"),
            ("xl/_rels/workbook.xml.rels", &workbook_rels),
            ("xl/styles.xml", b"<styleSheet/>"),
            (
                "xl/worksheets/sheet1.xml",
                br#"<worksheet><drawing r:id="rId9"/></worksheet>"#,
            ),
        ]);

        let errors =
            validate_archive_package_integrity(&archive).expect_err("worksheet r:id is dangling");
        assert!(errors.iter().any(|error| matches!(
            error,
            PackageIntegrityError::MissingWorksheetRelationshipReference { id, .. }
                if id == "rId9"
        )));
    }

    #[test]
    fn drawing_embed_without_matching_drawing_relationship_fails() {
        let content_types = valid_content_types(
            r#"<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>"#,
        );
        let workbook_rels = workbook_rels("");
        let sheet_rels = br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdDrawing" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>"#;
        let archive = archive(&[
            ("[Content_Types].xml", &content_types),
            ("_rels/.rels", root_rels()),
            ("xl/workbook.xml", b"<workbook/>"),
            ("xl/_rels/workbook.xml.rels", &workbook_rels),
            ("xl/styles.xml", b"<styleSheet/>"),
            (
                "xl/worksheets/sheet1.xml",
                br#"<worksheet><drawing r:id="rIdDrawing"/></worksheet>"#,
            ),
            ("xl/worksheets/_rels/sheet1.xml.rels", sheet_rels),
            (
                "xl/drawings/drawing1.xml",
                br#"<xdr:wsDr><xdr:pic><a:blip r:embed="rIdImage"/></xdr:pic></xdr:wsDr>"#,
            ),
        ]);

        let errors =
            validate_archive_package_integrity(&archive).expect_err("drawing r:embed is dangling");
        assert!(errors.iter().any(|error| matches!(
            error,
            PackageIntegrityError::MissingPartRelationshipReference {
                part_path,
                id,
                attr_name,
                ..
            } if part_path == "xl/drawings/drawing1.xml"
                && id == "rIdImage"
                && attr_name == "r:embed"
        )));
    }

    #[test]
    fn chart_id_without_matching_chart_relationship_fails() {
        let content_types = valid_content_types(
            r#"<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/><Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>"#,
        );
        let workbook_rels = workbook_rels("");
        let sheet_rels = br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdDrawing" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>"#;
        let drawing_rels = br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdChart" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/></Relationships>"#;
        let archive = archive(&[
            ("[Content_Types].xml", &content_types),
            ("_rels/.rels", root_rels()),
            ("xl/workbook.xml", b"<workbook/>"),
            ("xl/_rels/workbook.xml.rels", &workbook_rels),
            ("xl/styles.xml", b"<styleSheet/>"),
            (
                "xl/worksheets/sheet1.xml",
                br#"<worksheet><drawing r:id="rIdDrawing"/></worksheet>"#,
            ),
            ("xl/worksheets/_rels/sheet1.xml.rels", sheet_rels),
            (
                "xl/drawings/drawing1.xml",
                br#"<xdr:wsDr><c:chart r:id="rIdChart"/></xdr:wsDr>"#,
            ),
            ("xl/drawings/_rels/drawing1.xml.rels", drawing_rels),
            (
                "xl/charts/chart1.xml",
                br#"<c:chartSpace><c:externalData r:id="rIdExternalData"/></c:chartSpace>"#,
            ),
        ]);

        let errors =
            validate_archive_package_integrity(&archive).expect_err("chart r:id is dangling");
        assert!(errors.iter().any(|error| matches!(
            error,
            PackageIntegrityError::MissingPartRelationshipReference {
                part_path,
                id,
                attr_name,
                ..
            } if part_path == "xl/charts/chart1.xml"
                && id == "rIdExternalData"
                && attr_name == "r:id"
        )));
    }

    #[test]
    fn vml_image_relid_without_matching_vml_relationship_fails() {
        let content_types = valid_content_types("");
        let workbook_rels = workbook_rels("");
        let sheet_rels = br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdVml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing" Target="../drawings/vmlDrawing1.vml"/></Relationships>"#;
        let archive = archive(&[
            ("[Content_Types].xml", &content_types),
            ("_rels/.rels", root_rels()),
            ("xl/workbook.xml", b"<workbook/>"),
            ("xl/_rels/workbook.xml.rels", &workbook_rels),
            ("xl/styles.xml", b"<styleSheet/>"),
            (
                "xl/worksheets/sheet1.xml",
                br#"<worksheet><legacyDrawing r:id="rIdVml"/></worksheet>"#,
            ),
            ("xl/worksheets/_rels/sheet1.xml.rels", sheet_rels),
            (
                "xl/drawings/vmlDrawing1.vml",
                br#"<xml><v:shape><v:imagedata o:relid="rIdImage"/></v:shape></xml>"#,
            ),
        ]);

        let errors =
            validate_archive_package_integrity(&archive).expect_err("VML image rel is dangling");
        assert!(errors.iter().any(|error| matches!(
            error,
            PackageIntegrityError::MissingPartRelationshipReference {
                part_path,
                id,
                attr_name,
                ..
            } if part_path == "xl/drawings/vmlDrawing1.vml"
                && id == "rIdImage"
                && attr_name == "o:relid"
        )));
    }

    #[test]
    fn vml_image_relid_with_matching_vml_relationship_passes() {
        let content_types = valid_content_types("");
        let workbook_rels = workbook_rels("");
        let sheet_rels = br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdVml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing" Target="../drawings/vmlDrawing1.vml"/></Relationships>"#;
        let vml_rels = br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>"#;
        let archive = archive(&[
            ("[Content_Types].xml", &content_types),
            ("_rels/.rels", root_rels()),
            ("xl/workbook.xml", b"<workbook/>"),
            ("xl/_rels/workbook.xml.rels", &workbook_rels),
            ("xl/styles.xml", b"<styleSheet/>"),
            (
                "xl/worksheets/sheet1.xml",
                br#"<worksheet><legacyDrawing r:id="rIdVml"/></worksheet>"#,
            ),
            ("xl/worksheets/_rels/sheet1.xml.rels", sheet_rels),
            (
                "xl/drawings/vmlDrawing1.vml",
                br#"<xml><v:shape><v:imagedata o:relid="rIdImage"/></v:shape></xml>"#,
            ),
            ("xl/drawings/_rels/vmlDrawing1.vml.rels", vml_rels),
            ("xl/media/image1.png", b"png"),
        ]);

        validate_archive_package_integrity(&archive)
            .expect("matching VML image relationship should be valid");
    }

    #[test]
    fn emitted_taskpanes_without_root_relationship_fails() {
        let content_types = valid_content_types(
            r#"<Override PartName="/xl/webextensions/taskpanes.xml" ContentType="application/vnd.ms-office.webextensiontaskpanes+xml"/>"#,
        );
        let workbook_rels = workbook_rels("");
        let archive = archive(&[
            ("[Content_Types].xml", &content_types),
            ("_rels/.rels", root_rels()),
            ("xl/workbook.xml", b"<workbook/>"),
            ("xl/_rels/workbook.xml.rels", &workbook_rels),
            ("xl/styles.xml", b"<styleSheet/>"),
            ("xl/worksheets/sheet1.xml", b"<worksheet/>"),
            ("xl/webextensions/taskpanes.xml", b"<wetp:taskpanes/>"),
        ]);

        let errors =
            validate_archive_package_integrity(&archive).expect_err("taskpanes rel missing");
        assert!(errors.iter().any(|error| matches!(
            error,
            PackageIntegrityError::MissingRequiredRelationship { rel_type, target_path, .. }
                if *rel_type == REL_WEB_EXTENSION_TASKPANES
                    && target_path == "xl/webextensions/taskpanes.xml"
        )));
    }

    #[test]
    fn emitted_threaded_comment_without_sheet_relationship_fails() {
        let content_types = valid_content_types(
            r#"<Override PartName="/xl/threadedComments/threadedComment1.xml" ContentType="application/vnd.ms-excel.threadedcomments+xml"/>"#,
        );
        let workbook_rels = workbook_rels("");
        let archive = archive(&[
            ("[Content_Types].xml", &content_types),
            ("_rels/.rels", root_rels()),
            ("xl/workbook.xml", b"<workbook/>"),
            ("xl/_rels/workbook.xml.rels", &workbook_rels),
            ("xl/styles.xml", b"<styleSheet/>"),
            ("xl/worksheets/sheet1.xml", b"<worksheet/>"),
            (
                "xl/threadedComments/threadedComment1.xml",
                b"<ThreadedComments/>",
            ),
        ]);

        let errors =
            validate_archive_package_integrity(&archive).expect_err("threaded comment rel missing");
        assert!(errors.iter().any(|error| matches!(
            error,
            PackageIntegrityError::MissingRequiredRelationship { rel_type, target_path, .. }
                if *rel_type == REL_THREADED_COMMENT
                    && target_path == "xl/threadedComments/threadedComment1.xml"
        )));
    }
}
