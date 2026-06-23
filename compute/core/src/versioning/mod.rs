use std::collections::{BTreeMap, BTreeSet};

use snapshot_types::versioning::{
    ObjectDigest, SemanticChange, SemanticChangeKind, SemanticCompletenessDiagnostic,
    SemanticDiagnosticSeverity, SemanticDomainCoverage, SemanticDomainCoverageStatus,
    SemanticObjectDigest, SemanticObjectKind, SemanticWorkbookDiff, SemanticWorkbookState,
    VersionDomainCapabilityState, VersionDomainClass, canonical_digest,
    semantic_workbook_state_digest,
};

mod formula_reader;
mod semantic_ids;
mod semantic_reader;

const SHEETS_DOMAIN: &str = "sheets";
const ROWS_COLUMNS_DOMAIN: &str = "rows-columns";
const CELL_VALUES_DOMAIN: &str = "cells.values";
const CELL_FORMULAS_DOMAIN: &str = "cells.formulas";
const NAMED_RANGES_DOMAIN: &str = "named-ranges";
const CHARTS_DOMAIN: &str = "charts";
const FLOATING_OBJECTS_DOMAIN: &str = "floating-objects";

#[derive(Debug, thiserror::Error)]
pub enum SemanticStateReadError {
    #[error("semantic workbook state reader is not implemented for {reader}")]
    UnsupportedReader { reader: &'static str },
    #[error("semantic workbook state serialization failed: {0}")]
    Serialization(#[from] serde_json::Error),
}

pub trait SemanticWorkbookStateReader {
    fn read_semantic_workbook_state(&self)
    -> Result<SemanticWorkbookState, SemanticStateReadError>;
}

pub fn diff_semantic_workbook_states(
    before: &SemanticWorkbookState,
    after: &SemanticWorkbookState,
) -> Result<SemanticWorkbookDiff, serde_json::Error> {
    let before_digest = semantic_workbook_state_digest(before)?;
    let after_digest = semantic_workbook_state_digest(after)?;
    let before_objects = semantic_objects(before)?;
    let after_objects = semantic_objects(after)?;

    let mut object_ids = BTreeSet::new();
    object_ids.extend(before_objects.keys().cloned());
    object_ids.extend(after_objects.keys().cloned());

    let mut changes = Vec::new();
    for object_id in object_ids {
        match (
            before_objects.get(&object_id),
            after_objects.get(&object_id),
        ) {
            (None, Some(after_object)) => {
                changes.push(change(SemanticChangeKind::Added, None, Some(after_object)))
            }
            (Some(before_object), None) => changes.push(change(
                SemanticChangeKind::Removed,
                Some(before_object),
                None,
            )),
            (Some(before_object), Some(after_object))
                if before_object.digest != after_object.digest =>
            {
                changes.push(change(
                    SemanticChangeKind::Updated,
                    Some(before_object),
                    Some(after_object),
                ));
            }
            _ => {}
        }
    }

    let coverage = coverage_for_states(before, after);
    let diagnostics = coverage
        .iter()
        .flat_map(|coverage| coverage.diagnostics.iter().cloned())
        .collect();

    Ok(SemanticWorkbookDiff {
        before_digest,
        after_digest,
        changes,
        coverage,
        diagnostics,
    })
}

pub fn coverage_for_states(
    before: &SemanticWorkbookState,
    after: &SemanticWorkbookState,
) -> Vec<SemanticDomainCoverage> {
    let mut domain_ids = BTreeSet::new();
    domain_ids.extend(before.domains.keys().cloned());
    domain_ids.extend(after.domains.keys().cloned());

    domain_ids
        .into_iter()
        .filter_map(|domain_id| {
            let domain = after
                .domains
                .get(&domain_id)
                .or_else(|| before.domains.get(&domain_id))?;
            Some(coverage_for_domain(
                domain.domain_id.clone(),
                domain.domain_class.clone(),
                domain.capability_state.clone(),
                domain.objects.keys().cloned().collect(),
            ))
        })
        .collect()
}

pub fn coverage_for_domain(
    domain_id: String,
    domain_class: VersionDomainClass,
    capability_state: VersionDomainCapabilityState,
    object_ids: Vec<String>,
) -> SemanticDomainCoverage {
    let status = domain_coverage_status(&domain_class, &capability_state);
    let diagnostic = coverage_diagnostic(
        &domain_id,
        &domain_class,
        &capability_state,
        &status,
        object_ids,
    );

    SemanticDomainCoverage {
        domain_id,
        domain_class,
        capability_state,
        status,
        diagnostics: diagnostic.into_iter().collect(),
    }
}

pub fn domain_coverage_status(
    domain_class: &VersionDomainClass,
    capability_state: &VersionDomainCapabilityState,
) -> SemanticDomainCoverageStatus {
    match (domain_class, capability_state) {
        (_, VersionDomainCapabilityState::Supported) => SemanticDomainCoverageStatus::Complete,
        (_, VersionDomainCapabilityState::Derived) => SemanticDomainCoverageStatus::Derived,
        (VersionDomainClass::Transient, VersionDomainCapabilityState::Excluded) => {
            SemanticDomainCoverageStatus::Transient
        }
        (_, VersionDomainCapabilityState::Excluded) => SemanticDomainCoverageStatus::Excluded,
        (_, VersionDomainCapabilityState::OpaquePreserved) => {
            SemanticDomainCoverageStatus::OpaquePreserved
        }
        (_, VersionDomainCapabilityState::OpaqueBlocking) => {
            SemanticDomainCoverageStatus::OpaqueBlocking
        }
        (
            _,
            VersionDomainCapabilityState::NotStarted | VersionDomainCapabilityState::Contracted,
        ) => SemanticDomainCoverageStatus::Unsupported,
    }
}

fn coverage_diagnostic(
    domain_id: &str,
    domain_class: &VersionDomainClass,
    capability_state: &VersionDomainCapabilityState,
    status: &SemanticDomainCoverageStatus,
    object_ids: Vec<String>,
) -> Option<SemanticCompletenessDiagnostic> {
    let (severity, code, message) = match status {
        SemanticDomainCoverageStatus::Complete => return None,
        SemanticDomainCoverageStatus::Derived => (
            SemanticDiagnosticSeverity::Info,
            "VERSIONING_DERIVED_DOMAIN",
            "derived domain is represented by source semantics and may be promoted separately",
        ),
        SemanticDomainCoverageStatus::Excluded => (
            SemanticDiagnosticSeverity::Info,
            "VERSIONING_EXCLUDED_DOMAIN",
            "domain is excluded by the A2 capability policy",
        ),
        SemanticDomainCoverageStatus::Transient => (
            SemanticDiagnosticSeverity::Info,
            "VERSIONING_TRANSIENT_DOMAIN",
            "transient runtime domain is intentionally excluded from semantic state",
        ),
        SemanticDomainCoverageStatus::Unsupported => (
            SemanticDiagnosticSeverity::Warning,
            "VERSIONING_UNSUPPORTED_DOMAIN",
            "domain is contracted or not started and is not semantically diffed in this slice",
        ),
        SemanticDomainCoverageStatus::OpaquePreserved => (
            SemanticDiagnosticSeverity::Warning,
            "VERSIONING_OPAQUE_PRESERVED_DOMAIN",
            "domain is preserved as opaque digest material without semantic interpretation",
        ),
        SemanticDomainCoverageStatus::OpaqueBlocking => (
            SemanticDiagnosticSeverity::Error,
            "VERSIONING_OPAQUE_BLOCKING_DOMAIN",
            "domain contains opaque blocking state that prevents complete semantic coverage",
        ),
    };

    Some(SemanticCompletenessDiagnostic {
        severity,
        code: code.to_string(),
        domain_id: domain_id.to_string(),
        domain_class: domain_class.clone(),
        capability_state: capability_state.clone(),
        status: status.clone(),
        message: Some(message.to_string()),
        object_ids,
    })
}

fn semantic_objects(
    state: &SemanticWorkbookState,
) -> Result<BTreeMap<String, SemanticObjectDigest>, serde_json::Error> {
    let mut objects = BTreeMap::new();

    for (sheet_id, sheet) in &state.sheets {
        let digest = match &sheet.digest {
            Some(digest) => digest.clone(),
            None => canonical_digest(sheet)?,
        };
        objects.insert(
            format!("sheet:{sheet_id}"),
            SemanticObjectDigest {
                object_id: format!("sheet:{sheet_id}"),
                object_kind: SemanticObjectKind::Sheet,
                domain_id: SHEETS_DOMAIN.to_string(),
                digest,
            },
        );

        for (row_id, row) in &sheet.rows {
            let digest = match &row.digest {
                Some(digest) => digest.clone(),
                None => canonical_digest(row)?,
            };
            objects.insert(
                row_id.clone(),
                SemanticObjectDigest {
                    object_id: row_id.clone(),
                    object_kind: SemanticObjectKind::Row,
                    domain_id: ROWS_COLUMNS_DOMAIN.to_string(),
                    digest,
                },
            );
        }

        for (column_id, column) in &sheet.columns {
            let digest = match &column.digest {
                Some(digest) => digest.clone(),
                None => canonical_digest(column)?,
            };
            objects.insert(
                column_id.clone(),
                SemanticObjectDigest {
                    object_id: column_id.clone(),
                    object_kind: SemanticObjectKind::Column,
                    domain_id: ROWS_COLUMNS_DOMAIN.to_string(),
                    digest,
                },
            );
        }

        for (cell_id, cell) in &sheet.cells {
            let digest = match &cell.digest {
                Some(digest) => digest.clone(),
                None => canonical_digest(cell)?,
            };
            objects.insert(
                cell_id.clone(),
                SemanticObjectDigest {
                    object_id: cell_id.clone(),
                    object_kind: SemanticObjectKind::Cell,
                    domain_id: CELL_VALUES_DOMAIN.to_string(),
                    digest,
                },
            );

            if let Some(formula) = &cell.formula {
                let digest = match &formula.digest {
                    Some(digest) => digest.clone(),
                    None => canonical_digest(formula)?,
                };
                let object_id = format!("formula:{cell_id}");
                objects.insert(
                    object_id.clone(),
                    SemanticObjectDigest {
                        object_id,
                        object_kind: SemanticObjectKind::CellFormula,
                        domain_id: CELL_FORMULAS_DOMAIN.to_string(),
                        digest,
                    },
                );
            }
        }
    }

    for domain in state.domains.values() {
        objects.extend(
            domain
                .objects
                .iter()
                .map(|(object_id, digest)| (object_id.clone(), digest.clone())),
        );
    }

    Ok(objects)
}

fn change(
    kind: SemanticChangeKind,
    before: Option<&SemanticObjectDigest>,
    after: Option<&SemanticObjectDigest>,
) -> SemanticChange {
    let object = after.or(before).expect("change has before or after object");
    SemanticChange {
        change_id: format!("{}:{}", change_kind_id(&kind), object.object_id),
        kind,
        domain_id: object.domain_id.clone(),
        object_id: object.object_id.clone(),
        object_kind: object.object_kind.clone(),
        before_digest: before.map(|object| object.digest.clone()),
        after_digest: after.map(|object| object.digest.clone()),
    }
}

fn change_kind_id(kind: &SemanticChangeKind) -> &'static str {
    match kind {
        SemanticChangeKind::Added => "added",
        SemanticChangeKind::Removed => "removed",
        SemanticChangeKind::Updated => "updated",
    }
}

#[allow(dead_code)]
fn _object_digest_for_reader_scaffold(bytes: &[u8]) -> ObjectDigest {
    ObjectDigest::sha256(bytes)
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use serde_json::Value;
    use snapshot_types::versioning::{
        CanonicalCellValue, SEMANTIC_WORKBOOK_STATE_SCHEMA_VERSION, SemanticCellState,
        SemanticDomainState, SemanticSheetState,
    };

    use super::*;

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
    fn versioning_diff_reports_deterministic_cell_value_update() {
        let before = workbook_with_cell("alpha");
        let after = workbook_with_cell("beta");

        let first = diff_semantic_workbook_states(&before, &after).expect("diff");
        let second = diff_semantic_workbook_states(&before, &after).expect("diff");

        assert_eq!(first, second);
        assert_ne!(first.before_digest, first.after_digest);
        assert_eq!(first.changes.len(), 2);
        assert_eq!(first.changes[0].change_id, "updated:cell:sheet-1:1:1");
        assert_eq!(first.changes[0].kind, SemanticChangeKind::Updated);
        assert_eq!(first.changes[0].domain_id, CELL_VALUES_DOMAIN);
        assert_eq!(first.diagnostics, Vec::new());
    }

    #[test]
    fn versioning_diff_reports_added_and_removed_objects() {
        let before = workbook_with_cell("alpha");
        let mut after = workbook_with_cell("alpha");
        after.sheets.clear();

        let diff = diff_semantic_workbook_states(&before, &after).expect("diff");
        let change_ids: Vec<_> = diff
            .changes
            .iter()
            .map(|change| change.change_id.as_str())
            .collect();

        assert_eq!(
            change_ids,
            vec!["removed:cell:sheet-1:1:1", "removed:sheet:sheet-1"]
        );
        assert_eq!(diff.changes[0].domain_id, CELL_VALUES_DOMAIN);
        assert_eq!(diff.changes[1].domain_id, SHEETS_DOMAIN);
    }

    #[test]
    fn versioning_coverage_classifies_a2_unsupported_opaque_and_transient_domains() {
        let cases = [
            (
                VersionDomainClass::Authored,
                VersionDomainCapabilityState::Contracted,
                SemanticDomainCoverageStatus::Unsupported,
                SemanticDiagnosticSeverity::Warning,
                "VERSIONING_UNSUPPORTED_DOMAIN",
            ),
            (
                VersionDomainClass::PackageFidelity,
                VersionDomainCapabilityState::OpaquePreserved,
                SemanticDomainCoverageStatus::OpaquePreserved,
                SemanticDiagnosticSeverity::Warning,
                "VERSIONING_OPAQUE_PRESERVED_DOMAIN",
            ),
            (
                VersionDomainClass::External,
                VersionDomainCapabilityState::OpaqueBlocking,
                SemanticDomainCoverageStatus::OpaqueBlocking,
                SemanticDiagnosticSeverity::Error,
                "VERSIONING_OPAQUE_BLOCKING_DOMAIN",
            ),
            (
                VersionDomainClass::Transient,
                VersionDomainCapabilityState::Excluded,
                SemanticDomainCoverageStatus::Transient,
                SemanticDiagnosticSeverity::Info,
                "VERSIONING_TRANSIENT_DOMAIN",
            ),
        ];

        for (domain_class, capability_state, status, severity, code) in cases {
            let coverage = coverage_for_domain(
                "domain".to_string(),
                domain_class,
                capability_state,
                vec!["object-1".to_string()],
            );
            assert_eq!(coverage.status, status);
            assert_eq!(coverage.diagnostics.len(), 1);
            assert_eq!(coverage.diagnostics[0].severity, severity);
            assert_eq!(coverage.diagnostics[0].code, code);
        }
    }

    #[test]
    fn versioning_reader_trait_scaffold_can_be_implemented_without_yrs_reader() {
        struct ExplicitReader(SemanticWorkbookState);

        impl SemanticWorkbookStateReader for ExplicitReader {
            fn read_semantic_workbook_state(
                &self,
            ) -> Result<SemanticWorkbookState, SemanticStateReadError> {
                Ok(self.0.clone())
            }
        }

        let state = workbook_with_cell("alpha");
        let reader = ExplicitReader(state.clone());

        assert_eq!(
            reader.read_semantic_workbook_state().expect("read state"),
            state
        );
    }
}
