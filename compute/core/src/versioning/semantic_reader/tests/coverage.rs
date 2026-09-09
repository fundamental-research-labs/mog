use std::collections::BTreeSet;

use snapshot_types::versioning::VersionDomainCapabilityState;
use value_types::CellValue;

use crate::storage::engine::ComputeEngine;
use crate::versioning::SemanticWorkbookStateReader;

use super::{cell, workbook};

#[test]
fn engine_semantic_reader_emits_native_coverage_rows_for_all_scopes() {
    let (engine, _) =
        ComputeEngine::from_snapshot(workbook(vec![cell(1, 0, 0, CellValue::from("alpha"))]))
            .unwrap();
    let state = engine.read_semantic_workbook_state().unwrap();
    let coverage = &state.domains["schema-coverage"];
    assert_eq!(
        coverage.capability_state,
        VersionDomainCapabilityState::Supported
    );
    let scopes: BTreeSet<_> = coverage
        .objects
        .keys()
        .filter_map(|id| id.strip_prefix("semantic-coverage:"))
        .filter_map(|id| id.split(':').next())
        .collect();
    assert_eq!(
        scopes,
        BTreeSet::from([
            "topLevel",
            "workbook",
            "sheet",
            "cell",
            "cellProperties",
            "rowColumn",
            "range",
            "metadata",
            "identity"
        ])
    );
    for path in [
        "/workbook/metadata/external_links",
        "/workbook/metadata/named_ranges",
        "/sheets/{sheetId}/metadata/comments",
        "/sheets/{sheetId}/metadata/cell_annotations",
        "/sheets/{sheetId}/metadata/conditional_formats",
    ] {
        assert!(
            coverage.objects.keys().any(|id| id.contains(path)),
            "unclassified native authority: {path}"
        );
    }
    assert!(!coverage.objects.keys().any(|id| id.contains("gridIndex")
        || id.contains("rangePayloads")
        || id.contains("bridgeOnly")));
}

#[test]
fn native_coverage_inventory_is_stable_while_authored_value_digest_changes() {
    let (mut engine, _) =
        ComputeEngine::from_snapshot(workbook(vec![cell(1, 0, 0, CellValue::from("alpha"))]))
            .unwrap();
    let before = engine.read_semantic_workbook_state().unwrap();
    let sheet = engine.storage().sheet_order()[0];
    engine.set_cell_value_parsed(&sheet, 0, 0, "beta").unwrap();
    let after = engine.read_semantic_workbook_state().unwrap();
    assert_eq!(
        before.domains["schema-coverage"].objects,
        after.domains["schema-coverage"].objects
    );
    assert_ne!(
        snapshot_types::versioning::canonical_digest(&before.sheets).unwrap(),
        snapshot_types::versioning::canonical_digest(&after.sheets).unwrap()
    );
}
