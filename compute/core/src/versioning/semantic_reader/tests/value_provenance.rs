use std::sync::Arc;

use cell_types::CellId;
use compute_document::hex::id_to_hex;
use domain_types::RichSharedString;
use snapshot_types::versioning::{
    SemanticDiagnosticSeverity, SemanticDomainCoverageStatus, SemanticWorkbookState,
    VersionDomainCapabilityState,
};
use value_types::{CellControl, CellImage, CellImageSizing, CellValue};

use crate::storage::engine::ComputeEngine;
use crate::storage::properties::{self, CellProperties};
use crate::versioning::{SemanticWorkbookStateReader, coverage_for_states};

use super::{cell, workbook};

fn test_cell_id(id_suffix: u32) -> CellId {
    CellId::from_uuid_str(&format!("550e8400-e29b-41d4-a716-44665544{id_suffix:04}"))
        .expect("test cell id")
}

fn set_test_cell_properties(engine: &mut ComputeEngine, id_suffix: u32, props: CellProperties) {
    let sheet_id = engine.storage().sheet_order()[0];
    let cell_id = test_cell_id(id_suffix);
    let cell_hex = id_to_hex(cell_id.as_u128());
    properties::set_properties(engine.storage_mut(), &sheet_id, &cell_hex, &props);
}

fn assert_ambiguous_value_provenance(
    state: &SemanticWorkbookState,
    cell_key: &str,
    categories: &[&str],
) {
    let unsupported = state
        .domains
        .get(super::super::UNSUPPORTED_CELL_VALUES_DOMAIN)
        .expect("unsupported domain");

    assert_eq!(
        unsupported.capability_state,
        VersionDomainCapabilityState::OpaqueBlocking
    );
    for category in categories {
        let suffix = format!(":unsupported:ambiguous-value-provenance:{category}");
        assert!(
            unsupported
                .objects
                .keys()
                .any(|object_id| object_id.ends_with(&suffix)),
            "missing ambiguous value provenance category {category}"
        );
    }
    assert_eq!(
        state.sheets["sheet#0"].cells[cell_key]
            .value
            .as_ref()
            .expect("cell value")
            .value_kind,
        "unsupported:ambiguous-value-provenance"
    );

    let coverage = coverage_for_states(state, state);
    let unsupported_coverage = coverage
        .iter()
        .find(|entry| entry.domain_id == super::super::UNSUPPORTED_CELL_VALUES_DOMAIN)
        .expect("unsupported coverage");
    assert_eq!(
        unsupported_coverage.status,
        SemanticDomainCoverageStatus::OpaqueBlocking
    );
    assert_eq!(
        unsupported_coverage.diagnostics[0].severity,
        SemanticDiagnosticSeverity::Error
    );
}

#[test]
fn scalar_with_formula_metadata_is_ambiguous_value_provenance() {
    let (mut engine, _) =
        ComputeEngine::from_snapshot(workbook(vec![cell(1, 0, 0, CellValue::number(7.0))]))
            .expect("engine");
    let cell_id = test_cell_id(1);
    engine.storage_mut().set_cell_metadata(
        cell_id,
        crate::storage::CellMetadata {
            formula: Some(crate::storage::FormulaMetadata::from(
                &ooxml_types::worksheet::CellFormula {
                    ca: true,
                    ..Default::default()
                },
            )),
            ..Default::default()
        },
    );

    let state = engine.read_semantic_workbook_state().expect("state");

    assert_ambiguous_value_provenance(&state, "cell:sheet#0:r0:c0", &["formula-metadata"]);
}

#[test]
fn imported_formula_result_modes_remain_distinct_value_provenance() {
    use crate::mirror::cell_metadata::FormulaResultMode;

    let mut digests = Vec::new();
    for mode in [
        FormulaResultMode::LegacyScalar,
        FormulaResultMode::Cse,
        FormulaResultMode::Dynamic,
    ] {
        let (mut engine, _) =
            ComputeEngine::from_snapshot(workbook(vec![cell(1, 0, 0, CellValue::number(7.0))]))
                .expect("engine");
        engine.storage_mut().set_cell_metadata(
            test_cell_id(1),
            crate::storage::CellMetadata {
                formula_result_mode: Some(mode),
                ..Default::default()
            },
        );
        let state = engine.read_semantic_workbook_state().expect("state");
        assert_ambiguous_value_provenance(&state, "cell:sheet#0:r0:c0", &["formula-metadata"]);
        let objects = &state.domains[super::super::UNSUPPORTED_CELL_VALUES_DOMAIN].objects;
        let digest = objects
            .iter()
            .find(|(id, _)| {
                id.ends_with(":unsupported:ambiguous-value-provenance:formula-metadata")
            })
            .expect("formula metadata provenance")
            .1
            .digest
            .clone();
        assert!(
            !digests.contains(&digest),
            "formula mode provenance collapsed: {mode:?}"
        );
        digests.push(digest);
    }
}

#[test]
fn rich_and_unsupported_value_metadata_are_ambiguous_value_provenance() {
    let (mut engine, _) =
        ComputeEngine::from_snapshot(workbook(vec![cell(1, 0, 0, CellValue::from("rich"))]))
            .expect("engine");
    let cell_id = test_cell_id(1);
    engine.storage_mut().set_cell_metadata(
        cell_id,
        crate::storage::CellMetadata {
            rich_string: Some(RichSharedString {
                plain_text: "rich".to_string(),
                ..Default::default()
            }),
            ..Default::default()
        },
    );
    set_test_cell_properties(
        &mut engine,
        1,
        CellProperties {
            cell_metadata_index: Some(3),
            vm: Some(7),
            phonetic: true,
            ..Default::default()
        },
    );

    let state = engine.read_semantic_workbook_state().expect("state");

    assert_ambiguous_value_provenance(
        &state,
        "cell:sheet#0:r0:c0",
        &["rich-value-metadata", "unsupported-value-metadata"],
    );
}

#[test]
fn array_marker_is_ambiguous_value_provenance() {
    let (mut engine, _) =
        ComputeEngine::from_snapshot(workbook(vec![cell(1, 0, 0, CellValue::number(1.0))]))
            .expect("engine");
    let cell_id = test_cell_id(1);
    engine.storage_mut().set_cell_metadata(
        cell_id,
        crate::storage::CellMetadata {
            array_ref: Some("A1:B2".to_string()),
            ..Default::default()
        },
    );

    let state = engine.read_semantic_workbook_state().expect("state");

    assert_ambiguous_value_provenance(&state, "cell:sheet#0:r0:c0", &["array-marker"]);
}

#[test]
fn preservation_sidecars_are_ambiguous_value_provenance() {
    let (mut engine, _) =
        ComputeEngine::from_snapshot(workbook(vec![cell(1, 0, 0, CellValue::number(123.0))]))
            .expect("engine");
    set_test_cell_properties(
        &mut engine,
        1,
        CellProperties {
            date_lexical_value: Some("2024-01-02".to_string()),
            original_sst_index: Some(4),
            original_value: Some("00123".to_string()),
            ..Default::default()
        },
    );

    let state = engine.read_semantic_workbook_state().expect("state");

    assert_ambiguous_value_provenance(&state, "cell:sheet#0:r0:c0", &["preservation-sidecar"]);
}

#[test]
fn array_control_and_image_values_remain_opaque_blocking() {
    let image = CellImage::new(
        "https://example.test/logo.png",
        Some(Arc::<str>::from("logo")),
        CellImageSizing::Fit,
        None,
        None,
    );
    let (mut engine, _) = ComputeEngine::from_snapshot(workbook(vec![
        cell(
            1,
            0,
            0,
            CellValue::array(vec![CellValue::number(1.0), CellValue::number(2.0)], 2),
        ),
        cell(2, 0, 1, CellValue::Control(CellControl::checkbox(true))),
        cell(3, 0, 2, CellValue::Image(image)),
    ]))
    .expect("engine");

    let state = engine.read_semantic_workbook_state().expect("state");
    let unsupported = state
        .domains
        .get(super::super::UNSUPPORTED_CELL_VALUES_DOMAIN)
        .expect("unsupported domain");

    assert_eq!(
        unsupported.capability_state,
        VersionDomainCapabilityState::OpaqueBlocking
    );
    for value_kind in ["array", "control", "image"] {
        let suffix = format!(":unsupported:{value_kind}");
        assert!(
            unsupported
                .objects
                .keys()
                .any(|object_id| object_id.ends_with(&suffix)),
            "missing unsupported {value_kind} value object"
        );
    }
    assert_eq!(
        state.sheets["sheet#0"].cells["cell:sheet#0:r0:c0"]
            .value
            .as_ref()
            .expect("array value")
            .value_kind,
        "unsupported:array"
    );
    assert_eq!(
        state.sheets["sheet#0"].cells["cell:sheet#0:r0:c1"]
            .value
            .as_ref()
            .expect("control value")
            .value_kind,
        "unsupported:control"
    );
    assert_eq!(
        state.sheets["sheet#0"].cells["cell:sheet#0:r0:c2"]
            .value
            .as_ref()
            .expect("image value")
            .value_kind,
        "unsupported:image"
    );
}
