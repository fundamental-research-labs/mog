use std::collections::BTreeSet;

use cell_types::CellId;
use compute_document::hex::id_to_hex;
use snapshot_types::versioning::{
    SemanticDiagnosticSeverity, SemanticDomainCoverageStatus, VersionDomainCapabilityState,
};
use value_types::CellValue;
use yrs::{Any, Map, MapPrelim, Out, Transact};

use crate::storage::engine::YrsComputeEngine;
use crate::versioning::{SemanticWorkbookStateReader, coverage_for_states};

use super::{cell, workbook};

fn unclassified_schema_object_ids(engine: &YrsComputeEngine) -> Vec<String> {
    let state = engine.read_semantic_workbook_state().expect("state");
    let domain = state
        .domains
        .get("unclassified-schema-keys")
        .expect("unclassified schema domain");
    assert_eq!(
        domain.capability_state,
        VersionDomainCapabilityState::OpaqueBlocking
    );

    let coverage = coverage_for_states(&state, &state);
    let domain_coverage = coverage
        .iter()
        .find(|coverage| coverage.domain_id == "unclassified-schema-keys")
        .expect("unclassified schema coverage");
    assert_eq!(
        domain_coverage.status,
        SemanticDomainCoverageStatus::OpaqueBlocking
    );
    assert_eq!(domain_coverage.diagnostics.len(), 1);
    assert_eq!(
        domain_coverage.diagnostics[0].severity,
        SemanticDiagnosticSeverity::Error
    );
    assert_eq!(
        domain_coverage.diagnostics[0].code,
        "VERSIONING_OPAQUE_BLOCKING_DOMAIN"
    );
    domain_coverage.diagnostics[0].object_ids.clone()
}

#[test]
fn engine_semantic_reader_emits_schema_coverage_rows_for_all_scopes() {
    let (engine, _) =
        YrsComputeEngine::from_snapshot(workbook(vec![cell(1, 0, 0, CellValue::from("alpha"))]))
            .expect("engine");

    let state = engine.read_semantic_workbook_state().expect("state");
    let coverage_domain = state
        .domains
        .get("schema-coverage")
        .expect("schema coverage domain");
    assert_eq!(
        coverage_domain.capability_state,
        VersionDomainCapabilityState::Supported
    );
    assert!(
        !state.domains.contains_key("unclassified-schema-keys"),
        "known schema keys must not produce fail-closed diagnostics"
    );

    let scopes: BTreeSet<_> = coverage_domain
        .objects
        .keys()
        .filter_map(|object_id| object_id.strip_prefix("semantic-coverage:"))
        .filter_map(|suffix| suffix.split(':').next())
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
            "bridgeOnly",
        ])
    );
}

#[test]
fn engine_semantic_reader_marks_unclassified_workbook_schema_key_blocking() {
    let (engine, _) =
        YrsComputeEngine::from_snapshot(workbook(vec![cell(1, 0, 0, CellValue::from("alpha"))]))
            .expect("engine");

    {
        let mut txn = engine.storage().doc().transact_mut();
        engine
            .storage()
            .workbook_map()
            .insert(&mut txn, "vc03UnknownWorkbookKey", Any::Bool(true));
    }

    assert_eq!(
        unclassified_schema_object_ids(&engine),
        vec!["unclassified-schema-key:workbook:/workbook/vc03UnknownWorkbookKey"]
    );
}

#[test]
fn engine_semantic_reader_marks_unclassified_sheet_schema_key_blocking() {
    let (engine, _) =
        YrsComputeEngine::from_snapshot(workbook(vec![cell(1, 0, 0, CellValue::from("alpha"))]))
            .expect("engine");
    let sheet_hex = id_to_hex(engine.storage().sheet_order()[0].as_u128());

    {
        let mut txn = engine.storage().doc().transact_mut();
        let Some(Out::YMap(sheet_map)) = engine.storage().sheets().get(&txn, sheet_hex.as_str())
        else {
            panic!("sheet map");
        };
        sheet_map.insert(
            &mut txn,
            "vc03UnknownSheetKey",
            MapPrelim::from([] as [(&str, Any); 0]),
        );
    }

    assert_eq!(
        unclassified_schema_object_ids(&engine),
        vec!["unclassified-schema-key:sheet:/sheets/{sheetId}/vc03UnknownSheetKey"]
    );
}

#[test]
fn engine_semantic_reader_marks_unclassified_cell_schema_key_blocking() {
    let (engine, _) =
        YrsComputeEngine::from_snapshot(workbook(vec![cell(1, 0, 0, CellValue::from("alpha"))]))
            .expect("engine");
    let sheet_hex = id_to_hex(engine.storage().sheet_order()[0].as_u128());
    let cell_hex = id_to_hex(
        CellId::from_uuid_str("550e8400-e29b-41d4-a716-446655440001")
            .expect("cell id")
            .as_u128(),
    );

    {
        let mut txn = engine.storage().doc().transact_mut();
        let Some(Out::YMap(sheet_map)) = engine.storage().sheets().get(&txn, sheet_hex.as_str())
        else {
            panic!("sheet map");
        };
        let Some(Out::YMap(cells_map)) = sheet_map.get(&txn, "cells") else {
            panic!("cells map");
        };
        let Some(Out::YMap(cell_map)) = cells_map.get(&txn, cell_hex.as_str()) else {
            panic!("cell map");
        };
        cell_map.insert(&mut txn, "vc03UnknownCellKey", Any::Bool(true));
    }

    assert_eq!(
        unclassified_schema_object_ids(&engine),
        vec!["unclassified-schema-key:cell:/sheets/{sheetId}/cells/{cellId}/vc03UnknownCellKey"]
    );
}
