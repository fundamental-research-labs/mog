//! Parser adapter for the shared package graph validation contract.

use crate::infra::package_integrity::{PackageIntegrityError, validate_archive_package_integrity};
use crate::zip::XlsxArchive;
use xlsx_test_contracts::{
    PackageGraphValidationReport, PackageGraphViolation, PackageGraphViolationCode,
};

pub fn validate_package_graph_archive(archive: &XlsxArchive<'_>) -> PackageGraphValidationReport {
    match validate_archive_package_integrity(archive) {
        Ok(()) => PackageGraphValidationReport::pass(),
        Err(errors) => PackageGraphValidationReport::fail(
            errors
                .into_iter()
                .map(PackageGraphViolation::from)
                .collect(),
        ),
    }
}

pub fn validate_package_graph_bytes(
    bytes: &[u8],
) -> Result<PackageGraphValidationReport, crate::zip::ZipError> {
    let archive = XlsxArchive::new(bytes)?;
    Ok(validate_package_graph_archive(&archive))
}

impl From<PackageIntegrityError> for PackageGraphViolation {
    fn from(error: PackageIntegrityError) -> Self {
        let message = error.to_string();
        match error {
            PackageIntegrityError::MissingRelationshipOwner {
                rels_path,
                owner_path,
            } => Self {
                code: PackageGraphViolationCode::MissingRelationshipOwner,
                message,
                rels_path: Some(rels_path),
                part_path: Some(owner_path),
                relationship_id: None,
                relationship_type: None,
                target: None,
            },
            PackageIntegrityError::DuplicateRelationshipId { rels_path, id } => Self {
                code: PackageGraphViolationCode::DuplicateRelationshipId,
                message,
                rels_path: Some(rels_path),
                part_path: None,
                relationship_id: Some(id),
                relationship_type: None,
                target: None,
            },
            PackageIntegrityError::InvalidRelationshipTarget {
                rels_path,
                id,
                rel_type,
                target,
                ..
            } => Self {
                code: PackageGraphViolationCode::InvalidRelationshipTarget,
                message,
                rels_path: Some(rels_path),
                part_path: None,
                relationship_id: Some(id),
                relationship_type: Some(rel_type),
                target: Some(target),
            },
            PackageIntegrityError::MissingRelationshipTarget {
                rels_path,
                id,
                rel_type,
                target,
                resolved_path,
            } => Self {
                code: PackageGraphViolationCode::MissingRelationshipTarget,
                message,
                rels_path: Some(rels_path),
                part_path: Some(resolved_path),
                relationship_id: Some(id),
                relationship_type: Some(rel_type),
                target: Some(target),
            },
            PackageIntegrityError::MissingRequiredRelationship {
                rels_path,
                rel_type,
                target_path,
            } => Self {
                code: PackageGraphViolationCode::MissingRequiredRelationship,
                message,
                rels_path: Some(rels_path),
                part_path: Some(target_path),
                relationship_id: None,
                relationship_type: Some(rel_type.to_string()),
                target: None,
            },
            PackageIntegrityError::MissingRequiredContentType {
                part_path,
                content_type,
            } => Self {
                code: PackageGraphViolationCode::MissingRequiredContentType,
                message,
                rels_path: None,
                part_path: Some(part_path),
                relationship_id: None,
                relationship_type: None,
                target: Some(content_type.to_string()),
            },
            PackageIntegrityError::ContentTypeForMissingPart {
                part_path,
                content_type,
            } => Self {
                code: PackageGraphViolationCode::ContentTypeForMissingPart,
                message,
                rels_path: None,
                part_path: Some(part_path),
                relationship_id: None,
                relationship_type: None,
                target: Some(content_type),
            },
            PackageIntegrityError::MissingWorksheetRelationshipReference {
                worksheet_path,
                rels_path,
                id,
            } => Self {
                code: PackageGraphViolationCode::MissingWorksheetRelationshipReference,
                message,
                rels_path: Some(rels_path),
                part_path: Some(worksheet_path),
                relationship_id: Some(id),
                relationship_type: None,
                target: None,
            },
            PackageIntegrityError::MissingPartRelationshipReference {
                part_path,
                rels_path,
                id,
                attr_name,
            } => Self {
                code: PackageGraphViolationCode::MissingPartRelationshipReference,
                message,
                rels_path: Some(rels_path),
                part_path: Some(part_path),
                relationship_id: Some(id),
                relationship_type: None,
                target: Some(attr_name),
            },
        }
    }
}
