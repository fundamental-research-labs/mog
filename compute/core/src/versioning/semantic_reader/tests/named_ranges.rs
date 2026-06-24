use domain_types::{DefinedName, DefinedNameInput, NamedRangeUpdate};
use snapshot_types::versioning::{
    SemanticChangeKind, SemanticObjectKind, VersionDomainCapabilityState,
    semantic_workbook_state_digest,
};
use snapshot_types::{CellData, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellValue, FiniteF64};

use crate::storage::engine::YrsComputeEngine;
use crate::versioning::{
    NAMED_RANGES_DOMAIN, SemanticWorkbookStateReader, diff_semantic_workbook_states,
};

use super::{cell, workbook};

#[test]
fn engine_semantic_reader_reports_named_range_create_update_and_delete() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(workbook(vec![
        cell(1, 0, 0, CellValue::number(10.0)),
        cell(2, 1, 1, CellValue::number(20.0)),
    ]))
    .expect("engine");

    let before_create = engine
        .read_semantic_workbook_state()
        .expect("before create");
    let (_, create_result) = engine
        .create_named_range(DefinedNameInput {
            name: "Revenue".to_string(),
            refers_to: "=Sheet1!$A$1".to_string(),
            scope: None,
            comment: Some("Source value".to_string()),
        })
        .expect("create named range");
    let created: DefinedName =
        serde_json::from_value(create_result.data.expect("created name")).expect("defined name");
    let after_create = engine.read_semantic_workbook_state().expect("after create");
    let object_id = "named-range:workbook:REVENUE";
    let created_object = after_create.domains[NAMED_RANGES_DOMAIN]
        .objects
        .get(object_id)
        .expect("created named range object");

    assert_eq!(created.name, "Revenue");
    assert_eq!(
        after_create.domains[NAMED_RANGES_DOMAIN].capability_state,
        VersionDomainCapabilityState::Supported
    );
    assert_eq!(
        created_object.object_kind,
        SemanticObjectKind::DomainAttachment
    );

    let create_diff =
        diff_semantic_workbook_states(&before_create, &after_create).expect("create diff");
    assert!(create_diff.changes.iter().any(|change| {
        change.kind == SemanticChangeKind::Added
            && change.domain_id == NAMED_RANGES_DOMAIN
            && change.object_kind == SemanticObjectKind::DomainAttachment
            && change.object_id == object_id
    }));

    let (_, update_result) = engine
        .update_named_range(
            &created.id,
            NamedRangeUpdate {
                refers_to: Some("=Sheet1!$B$2".to_string()),
                comment: Some(Some("Updated source value".to_string())),
                ..Default::default()
            },
        )
        .expect("update named range");
    let updated: DefinedName =
        serde_json::from_value(update_result.data.expect("updated name")).expect("defined name");
    let after_update = engine.read_semantic_workbook_state().expect("after update");

    assert_eq!(updated.id, created.id);
    assert_ne!(
        after_create.domains[NAMED_RANGES_DOMAIN].objects[object_id].digest,
        after_update.domains[NAMED_RANGES_DOMAIN].objects[object_id].digest
    );
    let update_diff =
        diff_semantic_workbook_states(&after_create, &after_update).expect("update diff");
    assert!(update_diff.changes.iter().any(|change| {
        change.kind == SemanticChangeKind::Updated
            && change.domain_id == NAMED_RANGES_DOMAIN
            && change.object_kind == SemanticObjectKind::DomainAttachment
            && change.object_id == object_id
    }));

    engine
        .remove_named_range_by_id(&created.id)
        .expect("delete named range");
    let after_delete = engine.read_semantic_workbook_state().expect("after delete");
    let delete_diff =
        diff_semantic_workbook_states(&after_update, &after_delete).expect("delete diff");

    assert!(
        after_delete.domains[NAMED_RANGES_DOMAIN]
            .objects
            .get(object_id)
            .is_none()
    );
    assert!(delete_diff.changes.iter().any(|change| {
        change.kind == SemanticChangeKind::Removed
            && change.domain_id == NAMED_RANGES_DOMAIN
            && change.object_kind == SemanticObjectKind::DomainAttachment
            && change.object_id == object_id
    }));
}

#[test]
fn engine_semantic_reader_named_range_digest_ignores_durable_id_allocation() {
    let (mut left, _) =
        YrsComputeEngine::from_snapshot(workbook(vec![cell(1, 0, 0, CellValue::number(10.0))]))
            .expect("left");
    let (mut right, _) = YrsComputeEngine::from_snapshot(WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: "660e8400-e29b-41d4-a716-446655440000".to_string(),
            name: "Sheet1".to_string(),
            rows: 10,
            cols: 10,
            cells: vec![CellData {
                cell_id: "660e8400-e29b-41d4-a716-446655440101".to_string(),
                row: 0,
                col: 0,
                value: CellValue::number(10.0),
                formula: None,
                identity_formula: None,
                array_ref: None,
            }],
            ranges: vec![],
        }],
        named_ranges: vec![],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: FiniteF64::must(0.001),
        calculation_settings: None,
    })
    .expect("right");

    for engine in [&mut left, &mut right] {
        engine
            .create_named_range(DefinedNameInput {
                name: "Revenue".to_string(),
                refers_to: "=Sheet1!$A$1".to_string(),
                scope: None,
                comment: None,
            })
            .expect("create named range");
    }

    let left_state = left.read_semantic_workbook_state().expect("left state");
    let right_state = right.read_semantic_workbook_state().expect("right state");
    let object_id = "named-range:workbook:REVENUE";

    assert_eq!(
        left_state.domains[NAMED_RANGES_DOMAIN].objects[object_id].digest,
        right_state.domains[NAMED_RANGES_DOMAIN].objects[object_id].digest
    );
    assert_eq!(
        semantic_workbook_state_digest(&left_state).expect("left digest"),
        semantic_workbook_state_digest(&right_state).expect("right digest")
    );
}
