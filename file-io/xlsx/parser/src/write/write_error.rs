//! Error type for XLSX write operations.

/// Errors that can occur during XLSX write/export.
#[derive(Debug)]
pub enum WriteError {
    /// Failed to deserialize the input JSON.
    Deserialization(String),
    /// ZIP archive creation failed.
    Zip(String),
    /// Exported package violates OPC relationship/content integrity.
    PackageIntegrity(String),
    /// Exported package graph violates OPC relationship/content integrity.
    PackageIntegrityIssues(Vec<PackageIntegrityIssue>),
    /// General I/O error.
    Io(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PackageIntegrityIssue {
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
    InvalidRelationshipOwner {
        rels_path: String,
        relationship_type: String,
        expected_owner: String,
    },
    InvalidRelationshipTargetKind {
        rels_path: String,
        relationship_type: String,
        target_path: String,
        actual_kind: String,
        expected_kind: String,
    },
    MissingRequiredRelationship {
        rels_path: String,
        relationship_type: String,
        target_path: String,
    },
    MissingRequiredContentType {
        part_path: String,
        expected_content_type: String,
    },
    MissingPartContentType {
        part_path: String,
    },
    MissingOpaquePartBytes {
        part_path: String,
    },
    MissingOpaqueRelationshipReference {
        part_path: String,
        rels_path: String,
        relationship_id: String,
    },
}

impl std::fmt::Display for PackageIntegrityIssue {
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
            Self::InvalidRelationshipOwner {
                rels_path,
                relationship_type,
                expected_owner,
            } => write!(
                f,
                "relationship type {relationship_type} in {rels_path} is not valid for that owner; expected {expected_owner}"
            ),
            Self::InvalidRelationshipTargetKind {
                rels_path,
                relationship_type,
                target_path,
                actual_kind,
                expected_kind,
            } => write!(
                f,
                "relationship type {relationship_type} in {rels_path} targets {target_path} with semantic kind {actual_kind}; expected {expected_kind}"
            ),
            Self::MissingRequiredRelationship {
                rels_path,
                relationship_type,
                target_path,
            } => write!(
                f,
                "relationship part {rels_path} is missing required relationship type {relationship_type} targeting {target_path}"
            ),
            Self::MissingRequiredContentType {
                part_path,
                expected_content_type,
            } => write!(
                f,
                "part {part_path} is missing required content type {expected_content_type}"
            ),
            Self::MissingPartContentType { part_path } => {
                write!(f, "part {part_path} has no registered content type")
            }
            Self::MissingOpaquePartBytes { part_path } => {
                write!(f, "opaque part {part_path} has no bytes to emit")
            }
            Self::MissingOpaqueRelationshipReference {
                part_path,
                rels_path,
                relationship_id,
            } => write!(
                f,
                "opaque part {part_path} references relationship {relationship_id}, but owner relationship part {rels_path} does not define it"
            ),
        }
    }
}

impl std::fmt::Display for WriteError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            WriteError::Deserialization(msg) => write!(f, "Deserialization error: {}", msg),
            WriteError::Zip(msg) => write!(f, "ZIP error: {}", msg),
            WriteError::PackageIntegrity(msg) => write!(f, "Package integrity error: {}", msg),
            WriteError::PackageIntegrityIssues(issues) => {
                let message = issues
                    .iter()
                    .map(ToString::to_string)
                    .collect::<Vec<_>>()
                    .join("; ");
                write!(f, "Package integrity error: {message}")
            }
            WriteError::Io(msg) => write!(f, "I/O error: {}", msg),
        }
    }
}

impl std::error::Error for WriteError {}

impl From<super::zip_writer::ZipWriteError> for WriteError {
    fn from(e: super::zip_writer::ZipWriteError) -> Self {
        WriteError::Zip(e.to_string())
    }
}
