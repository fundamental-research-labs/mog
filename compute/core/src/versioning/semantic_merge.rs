use std::collections::BTreeSet;

use snapshot_types::versioning::{
    ObjectDigest, SemanticDomainCoverageStatus, SemanticMergeBranch, SemanticMergeBranchEvidence,
    SemanticMergeEvidence, SemanticMergePolicyManifest, SemanticWorkbookDiff,
    SemanticWorkbookState, canonical_digest, first_slice_semantic_merge_policy_manifest,
    semantic_merge_policy_manifest_digest,
};

#[derive(Debug, thiserror::Error)]
pub enum SemanticMergeEvidenceError {
    #[error("semantic merge evidence requires both branch diffs to share the same base digest")]
    MismatchedBaseDigest {
        ours_base: ObjectDigest,
        theirs_base: ObjectDigest,
    },
    #[error("semantic merge evidence serialization failed: {0}")]
    Serialization(#[from] serde_json::Error),
}

pub fn semantic_merge_evidence_for_states(
    base: &SemanticWorkbookState,
    ours: &SemanticWorkbookState,
    theirs: &SemanticWorkbookState,
) -> Result<SemanticMergeEvidence, SemanticMergeEvidenceError> {
    let ours_diff = super::diff_semantic_workbook_states(base, ours)?;
    let theirs_diff = super::diff_semantic_workbook_states(base, theirs)?;
    semantic_merge_evidence_from_diffs(&ours_diff, &theirs_diff)
}

pub fn semantic_merge_evidence_from_diffs(
    ours_diff: &SemanticWorkbookDiff,
    theirs_diff: &SemanticWorkbookDiff,
) -> Result<SemanticMergeEvidence, SemanticMergeEvidenceError> {
    if ours_diff.before_digest != theirs_diff.before_digest {
        return Err(SemanticMergeEvidenceError::MismatchedBaseDigest {
            ours_base: ours_diff.before_digest.clone(),
            theirs_base: theirs_diff.before_digest.clone(),
        });
    }

    let policy = first_slice_semantic_merge_policy_manifest();
    let policy_digest = semantic_merge_policy_manifest_digest(&policy)?;
    let ours = semantic_merge_branch_evidence(SemanticMergeBranch::Ours, ours_diff, &policy)?;
    let theirs = semantic_merge_branch_evidence(SemanticMergeBranch::Theirs, theirs_diff, &policy)?;
    let policy_admissible =
        branch_is_policy_admissible(&ours) && branch_is_policy_admissible(&theirs);

    Ok(SemanticMergeEvidence {
        schema_version: snapshot_types::versioning::SEMANTIC_MERGE_EVIDENCE_SCHEMA_VERSION
            .to_string(),
        policy_id: policy.policy_id,
        policy_digest,
        materializer: policy.materializer,
        base_digest: ours_diff.before_digest.clone(),
        ours,
        theirs,
        policy_admissible,
    })
}

fn semantic_merge_branch_evidence(
    branch: SemanticMergeBranch,
    diff: &SemanticWorkbookDiff,
    policy: &SemanticMergePolicyManifest,
) -> Result<SemanticMergeBranchEvidence, serde_json::Error> {
    let changed_domain_ids = changed_domain_ids(diff);
    let unsupported_domain_ids = changed_domain_ids
        .iter()
        .filter(|domain_id| !policy.supports_domain_id(domain_id))
        .cloned()
        .collect();
    let incomplete_domain_ids = incomplete_domain_ids(diff, &changed_domain_ids);

    Ok(SemanticMergeBranchEvidence {
        branch,
        before_digest: diff.before_digest.clone(),
        after_digest: diff.after_digest.clone(),
        diff_digest: canonical_digest(diff)?,
        change_count: diff.changes.len(),
        changed_domain_ids,
        unsupported_domain_ids,
        incomplete_domain_ids,
    })
}

fn changed_domain_ids(diff: &SemanticWorkbookDiff) -> Vec<String> {
    diff.changes
        .iter()
        .map(|change| change.domain_id.clone())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn incomplete_domain_ids(
    diff: &SemanticWorkbookDiff,
    changed_domain_ids: &[String],
) -> Vec<String> {
    let changed_domain_ids: BTreeSet<_> = changed_domain_ids.iter().map(String::as_str).collect();
    diff.coverage
        .iter()
        .filter(|coverage| {
            changed_domain_ids.contains(coverage.domain_id.as_str())
                && coverage.status != SemanticDomainCoverageStatus::Complete
        })
        .map(|coverage| coverage.domain_id.clone())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn branch_is_policy_admissible(evidence: &SemanticMergeBranchEvidence) -> bool {
    evidence.unsupported_domain_ids.is_empty() && evidence.incomplete_domain_ids.is_empty()
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use serde_json::Value;
    use snapshot_types::versioning::{
        CanonicalCellValue, SEMANTIC_MERGE_FIRST_SLICE_POLICY_ID,
        SEMANTIC_WORKBOOK_STATE_SCHEMA_VERSION, SemanticCellState, SemanticDomainState,
        SemanticObjectDigest, SemanticObjectKind, SemanticSheetState, VersionDomainCapabilityState,
        VersionDomainClass, semantic_merge_evidence_digest, semantic_workbook_state_digest,
    };

    use super::*;
    use crate::versioning::{CELL_VALUES_DOMAIN, SHEETS_DOMAIN};

    fn authored_domain(
        domain_id: &str,
        capability_state: VersionDomainCapabilityState,
    ) -> SemanticDomainState {
        SemanticDomainState {
            domain_id: domain_id.to_string(),
            domain_class: VersionDomainClass::Authored,
            capability_state,
            objects: BTreeMap::new(),
        }
    }

    fn domain_with_object(domain_id: &str, object_id: &str, value: &str) -> SemanticDomainState {
        let mut domain = authored_domain(domain_id, VersionDomainCapabilityState::Supported);
        domain.objects.insert(
            object_id.to_string(),
            SemanticObjectDigest {
                object_id: object_id.to_string(),
                object_kind: SemanticObjectKind::DomainAttachment,
                domain_id: domain_id.to_string(),
                digest: canonical_digest(&Value::String(value.to_string())).expect("digest"),
            },
        );
        domain
    }

    fn workbook_with_cell(value: &str) -> SemanticWorkbookState {
        let cell = SemanticCellState {
            object_id: "cell:sheet-1:1:1".to_string(),
            sheet_id: "sheet-1".to_string(),
            row: 1,
            column: 1,
            value: Some(CanonicalCellValue {
                value_kind: "string".to_string(),
                canonical_value: Some(Value::String(value.to_string())),
                digest: None,
            }),
            formula: None,
            direct_format: None,
            digest: None,
        };
        let mut sheet = SemanticSheetState {
            sheet_id: "sheet-1".to_string(),
            name: "Sheet1".to_string(),
            row_count: 2,
            column_count: 2,
            rows: BTreeMap::new(),
            columns: BTreeMap::new(),
            cells: BTreeMap::new(),
            digest: None,
        };
        sheet.cells.insert(cell.object_id.clone(), cell);

        let mut state = SemanticWorkbookState {
            schema_version: SEMANTIC_WORKBOOK_STATE_SCHEMA_VERSION.to_string(),
            workbook_id: Some("wb-1".to_string()),
            domains: BTreeMap::new(),
            sheets: BTreeMap::new(),
        };
        state.domains.insert(
            SHEETS_DOMAIN.to_string(),
            authored_domain(SHEETS_DOMAIN, VersionDomainCapabilityState::Supported),
        );
        state.domains.insert(
            CELL_VALUES_DOMAIN.to_string(),
            authored_domain(CELL_VALUES_DOMAIN, VersionDomainCapabilityState::Supported),
        );
        state.sheets.insert(sheet.sheet_id.clone(), sheet);
        state
    }

    #[test]
    fn semantic_merge_evidence_for_states_records_branch_diff_digests() {
        let base = workbook_with_cell("base");
        let ours = workbook_with_cell("ours");
        let theirs = workbook_with_cell("theirs");

        let evidence = semantic_merge_evidence_for_states(&base, &ours, &theirs).expect("evidence");
        let first_digest = semantic_merge_evidence_digest(&evidence).expect("first digest");
        let second_digest = semantic_merge_evidence_digest(&evidence).expect("second digest");

        assert_eq!(evidence.policy_id, SEMANTIC_MERGE_FIRST_SLICE_POLICY_ID);
        assert_eq!(
            evidence.base_digest,
            semantic_workbook_state_digest(&base).expect("base digest")
        );
        assert_eq!(evidence.ours.branch, SemanticMergeBranch::Ours);
        assert_eq!(evidence.theirs.branch, SemanticMergeBranch::Theirs);
        assert_eq!(
            evidence.ours.changed_domain_ids,
            vec![CELL_VALUES_DOMAIN.to_string(), SHEETS_DOMAIN.to_string()]
        );
        assert!(evidence.ours.unsupported_domain_ids.is_empty());
        assert!(evidence.ours.incomplete_domain_ids.is_empty());
        assert!(evidence.policy_admissible);
        assert_eq!(first_digest, second_digest);
    }

    #[test]
    fn semantic_merge_evidence_flags_domains_outside_first_slice_policy() {
        let base = workbook_with_cell("base");
        let mut ours = workbook_with_cell("base");
        ours.domains.insert(
            "named-ranges".to_string(),
            domain_with_object("named-ranges", "named-range:alpha", "ours"),
        );

        let evidence = semantic_merge_evidence_for_states(&base, &ours, &base).expect("evidence");

        assert_eq!(
            evidence.ours.unsupported_domain_ids,
            vec!["named-ranges".to_string()]
        );
        assert!(!evidence.policy_admissible);
    }

    #[test]
    fn semantic_merge_evidence_rejects_mismatched_base_digests() {
        let base = workbook_with_cell("base");
        let other_base = workbook_with_cell("other-base");
        let ours = workbook_with_cell("ours");
        let theirs = workbook_with_cell("theirs");
        let ours_diff =
            super::super::diff_semantic_workbook_states(&base, &ours).expect("ours diff");
        let theirs_diff =
            super::super::diff_semantic_workbook_states(&other_base, &theirs).expect("theirs diff");

        assert!(matches!(
            semantic_merge_evidence_from_diffs(&ours_diff, &theirs_diff),
            Err(SemanticMergeEvidenceError::MismatchedBaseDigest { .. })
        ));
    }
}
