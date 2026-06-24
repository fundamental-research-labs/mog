use serde::{Deserialize, Serialize};

use super::{
    ObjectDigest, SemanticObjectKind, VersionDomainCapabilityState, VersionDomainClass,
    canonical_digest,
};

pub const SEMANTIC_MERGE_POLICY_MANIFEST_SCHEMA_VERSION: &str = "semantic-merge-policy-manifest.v1";
pub const SEMANTIC_MERGE_EVIDENCE_SCHEMA_VERSION: &str = "semantic-merge-evidence.v1";
pub const SEMANTIC_MERGE_FIRST_SLICE_POLICY_ID: &str = "semantic-merge-first-slice.v1";
pub const SEMANTIC_MERGE_FIRST_SLICE_MATERIALIZER: &str =
    "semantic-cell-merge-commit-materializer.v1";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SemanticMergeBranch {
    Ours,
    Theirs,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticMergePolicyDomain {
    pub matrix_row_id: String,
    pub domain_id: String,
    pub domain_class: VersionDomainClass,
    pub merge_capability_state: VersionDomainCapabilityState,
    pub accepted_domain_ids: Vec<String>,
    pub object_kinds: Vec<SemanticObjectKind>,
}

impl SemanticMergePolicyDomain {
    pub fn accepts_domain_id(&self, domain_id: &str) -> bool {
        self.accepted_domain_ids
            .iter()
            .any(|accepted| accepted == domain_id)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticMergePolicyManifest {
    pub schema_version: String,
    pub policy_id: String,
    pub materializer: String,
    pub fail_closed: bool,
    pub supported_domains: Vec<SemanticMergePolicyDomain>,
}

impl SemanticMergePolicyManifest {
    pub fn supports_domain_id(&self, domain_id: &str) -> bool {
        self.supported_domains
            .iter()
            .any(|domain| domain.accepts_domain_id(domain_id))
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticMergeBranchEvidence {
    pub branch: SemanticMergeBranch,
    pub before_digest: ObjectDigest,
    pub after_digest: ObjectDigest,
    pub diff_digest: ObjectDigest,
    pub change_count: usize,
    pub changed_domain_ids: Vec<String>,
    pub unsupported_domain_ids: Vec<String>,
    pub incomplete_domain_ids: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticMergeEvidence {
    pub schema_version: String,
    pub policy_id: String,
    pub policy_digest: ObjectDigest,
    pub materializer: String,
    pub base_digest: ObjectDigest,
    pub ours: SemanticMergeBranchEvidence,
    pub theirs: SemanticMergeBranchEvidence,
    pub policy_admissible: bool,
}

pub fn first_slice_semantic_merge_policy_manifest() -> SemanticMergePolicyManifest {
    SemanticMergePolicyManifest {
        schema_version: SEMANTIC_MERGE_POLICY_MANIFEST_SCHEMA_VERSION.to_string(),
        policy_id: SEMANTIC_MERGE_FIRST_SLICE_POLICY_ID.to_string(),
        materializer: SEMANTIC_MERGE_FIRST_SLICE_MATERIALIZER.to_string(),
        fail_closed: true,
        supported_domains: vec![
            policy_domain(
                "sheets",
                "sheets",
                &["sheet", "sheets"],
                &[SemanticObjectKind::Sheet],
            ),
            policy_domain(
                "cells.values",
                "cells.values",
                &["cell", "cells.values"],
                &[SemanticObjectKind::Cell, SemanticObjectKind::CellValue],
            ),
            policy_domain(
                "cells.formulas",
                "cells.formulas",
                &["cell", "cells.values", "cells.formulas"],
                &[SemanticObjectKind::Cell, SemanticObjectKind::CellFormula],
            ),
            policy_domain(
                "cells.formats.direct",
                "cells.formats.direct",
                &["cells.formats", "cells.formats.direct"],
                &[SemanticObjectKind::DirectFormat],
            ),
            policy_domain(
                "rows-columns",
                "rows-columns",
                &["rows-columns"],
                &[SemanticObjectKind::Row, SemanticObjectKind::Column],
            ),
        ],
    }
}

pub fn semantic_merge_policy_manifest_digest(
    manifest: &SemanticMergePolicyManifest,
) -> Result<ObjectDigest, serde_json::Error> {
    canonical_digest(manifest)
}

pub fn semantic_merge_evidence_digest(
    evidence: &SemanticMergeEvidence,
) -> Result<ObjectDigest, serde_json::Error> {
    canonical_digest(evidence)
}

fn policy_domain(
    matrix_row_id: &str,
    domain_id: &str,
    accepted_domain_ids: &[&str],
    object_kinds: &[SemanticObjectKind],
) -> SemanticMergePolicyDomain {
    SemanticMergePolicyDomain {
        matrix_row_id: matrix_row_id.to_string(),
        domain_id: domain_id.to_string(),
        domain_class: VersionDomainClass::Authored,
        merge_capability_state: VersionDomainCapabilityState::Supported,
        accepted_domain_ids: accepted_domain_ids
            .iter()
            .map(|domain_id| (*domain_id).to_string())
            .collect(),
        object_kinds: object_kinds.to_vec(),
    }
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf};

    use super::*;

    fn public_typescript_policy_fixture() -> SemanticMergePolicyManifest {
        let fixture_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(
            "../../../../../contracts/src/versioning/semantic-merge-policy-manifest.fixture.json",
        );
        let fixture = fs::read_to_string(&fixture_path).unwrap_or_else(|error| {
            panic!(
                "failed to read public TypeScript semantic merge policy fixture at {}: {}",
                fixture_path.display(),
                error
            )
        });

        serde_json::from_str(&fixture).expect("public TypeScript semantic merge policy fixture")
    }

    #[test]
    fn semantic_merge_policy_manifest_lists_first_slice_supported_domains() {
        let manifest = first_slice_semantic_merge_policy_manifest();

        assert_eq!(
            manifest.schema_version,
            SEMANTIC_MERGE_POLICY_MANIFEST_SCHEMA_VERSION
        );
        assert_eq!(manifest.policy_id, SEMANTIC_MERGE_FIRST_SLICE_POLICY_ID);
        assert_eq!(
            manifest.materializer,
            SEMANTIC_MERGE_FIRST_SLICE_MATERIALIZER
        );
        assert!(manifest.fail_closed);
        assert!(manifest.supports_domain_id("cells.values"));
        assert!(manifest.supports_domain_id("cell"));
        assert!(manifest.supports_domain_id("sheets"));
        assert!(!manifest.supports_domain_id("named-ranges"));
    }

    #[test]
    fn semantic_merge_policy_manifest_digest_is_stable() {
        let first = first_slice_semantic_merge_policy_manifest();
        let second = first_slice_semantic_merge_policy_manifest();

        let first_digest =
            semantic_merge_policy_manifest_digest(&first).expect("first policy digest");
        let second_digest =
            semantic_merge_policy_manifest_digest(&second).expect("second policy digest");
        let canonical_bytes = super::super::canonical_json_bytes(&first).expect("canonical json");

        assert_eq!(first_digest, second_digest);
        assert_eq!(first_digest.byte_length, Some(canonical_bytes.len()));
    }

    #[test]
    fn semantic_merge_policy_manifest_matches_public_typescript_fixture() {
        let fixture = public_typescript_policy_fixture();
        assert_eq!(first_slice_semantic_merge_policy_manifest(), fixture);
    }
}
