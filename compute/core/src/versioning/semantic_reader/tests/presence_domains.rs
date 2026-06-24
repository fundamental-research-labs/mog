use compute_document::schema::KEY_PROPERTIES;
use domain_types::domain::validation::{
    EnforcementLevel, IdentityRangeSchemaRef, RangeSchema, RangeSchemaDefinition,
    SchemaConstraints, SchemaType,
};
use snapshot_types::versioning::{
    SemanticDiagnosticSeverity, SemanticDomainCoverageStatus, SemanticObjectKind,
    SemanticWorkbookState, VersionDomainCapabilityState, VersionDomainClass,
};

use crate::storage::engine::YrsComputeEngine;
use crate::storage::infra::grid_helpers::{get_sheet_submap, sheet_id_to_hex};
use crate::versioning::{SemanticWorkbookStateReader, coverage_for_states};
use yrs::{Map, Transact};

use super::workbook;

fn validation_range_schema(id: &str) -> RangeSchema {
    RangeSchema {
        id: id.to_string(),
        created_at: 1_700_000_000,
        ranges: vec![IdentityRangeSchemaRef {
            start_id: "0:0".to_string(),
            end_id: "4:0".to_string(),
            sheet_id: None,
        }],
        schema: RangeSchemaDefinition {
            schema_type: Some(SchemaType::Number),
            constraints: Some(SchemaConstraints {
                min: Some(0.0),
                max: Some(100.0),
                ..Default::default()
            }),
        },
        enforcement: Some(EnforcementLevel::Strict),
        ui: None,
    }
}

fn assert_opaque_blocking_presence_domain(
    state: &SemanticWorkbookState,
    domain_id: &str,
    object_id: &str,
) {
    let domain = state.domains.get(domain_id).expect("presence domain");

    assert_eq!(domain.domain_class, VersionDomainClass::Authored);
    assert_eq!(
        domain.capability_state,
        VersionDomainCapabilityState::OpaqueBlocking
    );
    assert_eq!(domain.objects.len(), 1);
    let object = domain.objects.get(object_id).expect("presence object");
    assert_eq!(object.object_kind, SemanticObjectKind::DomainAttachment);
    assert_eq!(object.domain_id, domain_id);

    let coverage = coverage_for_states(state, state);
    let domain_coverage = coverage
        .iter()
        .find(|entry| entry.domain_id == domain_id)
        .expect("presence coverage");
    assert_eq!(
        domain_coverage.status,
        SemanticDomainCoverageStatus::OpaqueBlocking
    );
    assert_eq!(
        domain_coverage.diagnostics[0].severity,
        SemanticDiagnosticSeverity::Error
    );
    assert_eq!(
        domain_coverage.diagnostics[0].object_ids,
        vec![object_id.to_string()]
    );
}

fn set_data_validation_declared_count(engine: &YrsComputeEngine, sheet_id: &cell_types::SheetId) {
    let sheets = engine.storage().sheets_ref();
    let mut txn = engine.storage().doc().transact_mut();
    let sheet_hex = sheet_id_to_hex(sheet_id);
    let meta_map =
        get_sheet_submap(&txn, &sheets, &sheet_hex, KEY_PROPERTIES).expect("sheet meta map");
    meta_map.insert(&mut txn, "dvDeclaredCount", 1_i64);
}

#[test]
fn engine_semantic_reader_marks_data_validation_presence_opaque_blocking() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(workbook(vec![])).expect("engine");
    let sheet_id = engine.storage().sheet_order()[0];
    let clean_state = engine.read_semantic_workbook_state().expect("clean state");

    assert!(
        !clean_state
            .domains
            .contains_key(super::super::DATA_VALIDATION_DOMAIN)
    );

    engine
        .set_range_schema(&sheet_id, &validation_range_schema("vc06-validation"))
        .expect("set range schema");

    let state = engine.read_semantic_workbook_state().expect("state");
    assert_opaque_blocking_presence_domain(
        &state,
        super::super::DATA_VALIDATION_DOMAIN,
        "domain-presence:data-validation:sheet#0",
    );
}

#[test]
fn engine_semantic_reader_marks_data_validation_metadata_presence_opaque_blocking() {
    let (engine, _) = YrsComputeEngine::from_snapshot(workbook(vec![])).expect("engine");
    let sheet_id = engine.storage().sheet_order()[0];
    let clean_state = engine.read_semantic_workbook_state().expect("clean state");

    assert!(
        !clean_state
            .domains
            .contains_key(super::super::DATA_VALIDATION_DOMAIN)
    );

    set_data_validation_declared_count(&engine, &sheet_id);

    let state = engine.read_semantic_workbook_state().expect("state");
    assert_opaque_blocking_presence_domain(
        &state,
        super::super::DATA_VALIDATION_DOMAIN,
        "domain-presence:data-validation:sheet#0",
    );
}

#[test]
fn engine_semantic_reader_marks_conditional_formatting_presence_opaque_blocking() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(workbook(vec![])).expect("engine");
    let sheet_id = engine.storage().sheet_order()[0];
    let clean_state = engine.read_semantic_workbook_state().expect("clean state");

    assert!(
        !clean_state
            .domains
            .contains_key(super::super::CONDITIONAL_FORMATTING_DOMAIN)
    );

    engine
        .add_cf_rule(
            &sheet_id,
            serde_json::json!({
                "id": "vc06-cf",
                "sheetId": sheet_id.to_uuid_string(),
                "ranges": [{
                    "startRow": 0u32,
                    "startCol": 0u32,
                    "endRow": 4u32,
                    "endCol": 0u32,
                }],
                "rules": [{
                    "type": "containsBlanks",
                    "id": "vc06-cf-rule",
                    "priority": 1,
                    "style": {},
                }],
            }),
        )
        .expect("add conditional format");

    let state = engine.read_semantic_workbook_state().expect("state");
    assert_opaque_blocking_presence_domain(
        &state,
        super::super::CONDITIONAL_FORMATTING_DOMAIN,
        "domain-presence:conditional-formatting:sheet#0",
    );
}
