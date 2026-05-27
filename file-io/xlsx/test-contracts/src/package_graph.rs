//! Shared package graph validation contract.

use serde::{Deserialize, Serialize};

use crate::fingerprints::{
    CorrectnessFingerprintCategory, FailureFingerprint, FingerprintCategory, FingerprintEvidence,
    FingerprintOwner, FingerprintSeverity,
};

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct PackageGraphSnapshot {
    pub parts: Vec<PackagePartSnapshot>,
    pub relationships: Vec<PackageRelationshipSnapshot>,
    pub content_types: Vec<PackageContentTypeSnapshot>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct PackagePartSnapshot {
    pub path: String,
    pub ownership: PackagePartOwnership,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PackagePartOwnership {
    Modeled,
    OpaqueClean,
    OpaqueDirty,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct PackageRelationshipSnapshot {
    pub owner_rels_path: String,
    pub id: String,
    pub relationship_type: String,
    pub target: String,
    pub target_mode: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct PackageContentTypeSnapshot {
    pub part_path: Option<String>,
    pub extension: Option<String>,
    pub content_type: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct PackageGraphValidationReport {
    pub valid: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub violations: Vec<PackageGraphViolation>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fingerprints: Vec<FailureFingerprint>,
}

impl PackageGraphValidationReport {
    pub fn pass() -> Self {
        Self {
            valid: true,
            violations: Vec::new(),
            fingerprints: Vec::new(),
        }
    }

    pub fn fail(violations: Vec<PackageGraphViolation>) -> Self {
        let fingerprints = violations
            .iter()
            .map(PackageGraphViolation::to_fingerprint)
            .collect();
        Self {
            valid: false,
            violations,
            fingerprints,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct PackageGraphViolation {
    pub code: PackageGraphViolationCode,
    pub message: String,
    pub rels_path: Option<String>,
    pub part_path: Option<String>,
    pub relationship_id: Option<String>,
    pub relationship_type: Option<String>,
    pub target: Option<String>,
}

impl PackageGraphViolation {
    pub fn to_fingerprint(&self) -> FailureFingerprint {
        let (id, category) = match self.code {
            PackageGraphViolationCode::MissingRelationshipOwner => (
                "pkg-rel-owner-missing",
                CorrectnessFingerprintCategory::PackageGraph,
            ),
            PackageGraphViolationCode::DuplicateRelationshipId => (
                "pkg-rel-id-duplicate",
                CorrectnessFingerprintCategory::RelationshipClassification,
            ),
            PackageGraphViolationCode::InvalidRelationshipTarget => (
                "pkg-rel-target-invalid",
                CorrectnessFingerprintCategory::TargetResolution,
            ),
            PackageGraphViolationCode::MissingRelationshipTarget => (
                "pkg-rel-target-missing",
                CorrectnessFingerprintCategory::TargetResolution,
            ),
            PackageGraphViolationCode::MissingRequiredRelationship => (
                "pkg-required-rel-missing",
                CorrectnessFingerprintCategory::PackageGraph,
            ),
            PackageGraphViolationCode::MissingRequiredContentType => (
                "pkg-required-content-type-missing",
                CorrectnessFingerprintCategory::ContentType,
            ),
            PackageGraphViolationCode::ContentTypeForMissingPart => (
                "pkg-content-type-stale-part",
                CorrectnessFingerprintCategory::ContentType,
            ),
            PackageGraphViolationCode::MissingWorksheetRelationshipReference => (
                "pkg-worksheet-rid-dangling",
                CorrectnessFingerprintCategory::CommentsVmlDrawingOwnership,
            ),
            PackageGraphViolationCode::MissingPartRelationshipReference => (
                "pkg-part-rid-dangling",
                CorrectnessFingerprintCategory::TablePivotChartSidecarOwnership,
            ),
        };

        let path = self
            .part_path
            .clone()
            .or_else(|| self.rels_path.clone())
            .or_else(|| self.target.clone());
        let mut evidence = FingerprintEvidence::message(self.message.clone());
        if let Some(path) = path {
            evidence = evidence.at_path(path);
        }
        FailureFingerprint::new(
            id,
            FingerprintCategory::Correctness(category),
            FingerprintSeverity::Error,
            FingerprintOwner::PackageGraph,
            self.message.clone(),
        )
        .with_evidence(evidence)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PackageGraphViolationCode {
    MissingRelationshipOwner,
    DuplicateRelationshipId,
    InvalidRelationshipTarget,
    MissingRelationshipTarget,
    MissingRequiredRelationship,
    MissingRequiredContentType,
    ContentTypeForMissingPart,
    MissingWorksheetRelationshipReference,
    MissingPartRelationshipReference,
}
