//! OPC package integrity validation for XLSX archives.
//!
//! This module validates cross-part package invariants that individual feature
//! writers cannot prove locally.

use std::collections::HashSet;

use crate::domain::workbook::read::parse_all_rels;
use crate::infra::opc::{
    OpcTargetResolutionError, relationship_owner_from_rels_path, resolve_relationship_target,
};
use crate::zip::XlsxArchive;

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
        }
    }
}

impl std::error::Error for PackageIntegrityError {}

pub fn validate_archive_package_integrity(
    archive: &XlsxArchive<'_>,
) -> Result<(), Vec<PackageIntegrityError>> {
    let mut errors = Vec::new();

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

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}

fn is_relationship_part(path: &str) -> bool {
    path == "_rels/.rels" || (path.contains("/_rels/") && path.ends_with(".rels"))
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
}
