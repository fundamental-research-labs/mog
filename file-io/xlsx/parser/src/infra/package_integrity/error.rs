use crate::infra::opc::relationship_owner_from_rels_path;

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
        rel_type: String,
        target: String,
        reason: String,
    },
    MissingRelationshipTarget {
        rels_path: String,
        id: String,
        rel_type: String,
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
                rel_type,
                target,
                reason,
            } => write!(
                f,
                "owner {} relationship {id} type {rel_type} in {rels_path} has invalid target {target}: {reason}",
                relationship_owner_label(rels_path)
            ),
            Self::MissingRelationshipTarget {
                rels_path,
                id,
                rel_type,
                target,
                resolved_path,
            } => write!(
                f,
                "owner {} relationship {id} type {rel_type} in {rels_path} targets missing part {resolved_path} from target {target}",
                relationship_owner_label(rels_path)
            ),
            Self::MissingRequiredRelationship {
                rels_path,
                rel_type,
                target_path,
            } => write!(
                f,
                "owner {} relationship part {rels_path} is missing required relationship type {rel_type} targeting {target_path}",
                relationship_owner_label(rels_path)
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
                "worksheet {worksheet_path} references relationship {id}, but owner {} relationship part {rels_path} does not define it",
                relationship_owner_label(rels_path)
            ),
            Self::MissingPartRelationshipReference {
                part_path,
                rels_path,
                id,
                attr_name,
            } => write!(
                f,
                "part {part_path} references relationship {id} through {attr_name}, but owner {} relationship part {rels_path} does not define it",
                relationship_owner_label(rels_path)
            ),
        }
    }
}

impl std::error::Error for PackageIntegrityError {}

fn relationship_owner_label(rels_path: &str) -> String {
    if rels_path == "*" {
        return "any modeled owner".to_string();
    }
    match relationship_owner_from_rels_path(rels_path) {
        Some(owner_path) => format!("part={owner_path}"),
        None if rels_path == "_rels/.rels" => "Root".to_string(),
        None => "unknown".to_string(),
    }
}
