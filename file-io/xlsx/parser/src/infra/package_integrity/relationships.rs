use std::collections::{HashMap, HashSet};

use ooxml_types::shared::OpcRelationship;

use crate::domain::workbook::read::parse_all_rels;
use crate::infra::opc::{relationship_owner_from_rels_path, resolve_relationship_target};
use crate::zip::XlsxArchive;

use super::error::PackageIntegrityError;
use super::paths::{format_resolution_error, is_relationship_part, relationship_target_part};

pub(super) fn collect_relationships(
    archive: &XlsxArchive<'_>,
    errors: &mut Vec<PackageIntegrityError>,
) -> HashMap<String, Vec<OpcRelationship>> {
    let mut relationships_by_part = HashMap::new();

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
                        rel_type: rel.rel_type.clone(),
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
                    rel_type: rel.rel_type,
                    target: rel.target,
                    resolved_path: resolved,
                });
            }
        }
    }

    relationships_by_part
}
