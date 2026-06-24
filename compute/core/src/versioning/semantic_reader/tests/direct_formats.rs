use cell_types::CellId;
use domain_types::CellFormat;
use snapshot_types::versioning::{
    SemanticChangeKind, SemanticObjectKind, semantic_workbook_state_digest,
};
use value_types::CellValue;

use crate::storage::engine::YrsComputeEngine;
use crate::versioning::{
    CELL_VALUES_DOMAIN, DIRECT_FORMATS_DOMAIN, SemanticWorkbookStateReader,
    diff_semantic_workbook_states,
};

use super::{cell, workbook};

#[test]
fn engine_semantic_reader_reads_direct_cell_format() {
    let (before, _) =
        YrsComputeEngine::from_snapshot(workbook(vec![cell(1, 0, 0, CellValue::from("alpha"))]))
            .expect("before");
    let (mut after, _) =
        YrsComputeEngine::from_snapshot(workbook(vec![cell(1, 0, 0, CellValue::from("alpha"))]))
            .expect("after");

    let sheet_id = after.storage().sheet_order()[0];
    let cell_id = CellId::from_uuid_str("550e8400-e29b-41d4-a716-446655440001").expect("cell id");
    after
        .set_cell_format(
            &sheet_id,
            &cell_id,
            &CellFormat {
                bold: Some(true),
                ..Default::default()
            },
        )
        .expect("set direct format");

    let before_state = before.read_semantic_workbook_state().expect("before state");
    let after_state = after.read_semantic_workbook_state().expect("after state");
    let cell_key = "cell:sheet#0:r0:c0";
    assert!(
        before_state.sheets["sheet#0"].cells[cell_key]
            .direct_format
            .is_none()
    );
    let direct_format = after_state.sheets["sheet#0"].cells[cell_key]
        .direct_format
        .as_ref()
        .expect("direct format");

    assert_eq!(
        direct_format.properties.get("bold"),
        Some(&serde_json::json!(true))
    );
    assert_ne!(
        semantic_workbook_state_digest(&before_state).expect("before digest"),
        semantic_workbook_state_digest(&after_state).expect("after digest")
    );
    let diff = diff_semantic_workbook_states(&before_state, &after_state).expect("diff");
    assert!(diff.changes.iter().any(|change| {
        change.kind == SemanticChangeKind::Updated
            && change.object_kind == SemanticObjectKind::Cell
            && change.domain_id == CELL_VALUES_DOMAIN
            && change.object_id == cell_key
    }));
    assert!(has_direct_format_change(
        &diff.changes,
        SemanticChangeKind::Added,
        cell_key
    ));
}

#[test]
fn engine_semantic_reader_reads_format_only_cell() {
    let (before, _) = YrsComputeEngine::from_snapshot(workbook(vec![])).expect("before");
    let (mut after, _) = YrsComputeEngine::from_snapshot(workbook(vec![])).expect("after");

    let sheet_id = after.storage().sheet_order()[0];
    after
        .set_format_for_ranges(
            &sheet_id,
            &[(1, 1, 1, 1)],
            &CellFormat {
                italic: Some(true),
                font_color: Some("#FF0000".to_string()),
                ..Default::default()
            },
        )
        .expect("set direct format on blank cell");

    let before_state = before.read_semantic_workbook_state().expect("before state");
    let after_state = after.read_semantic_workbook_state().expect("after state");
    let cell_key = "cell:sheet#0:r1:c1";

    assert!(!before_state.sheets["sheet#0"].cells.contains_key(cell_key));
    let cell_state = after_state.sheets["sheet#0"]
        .cells
        .get(cell_key)
        .expect("format-only cell state");
    assert!(cell_state.value.is_none());
    assert!(cell_state.formula.is_none());
    let direct_format = cell_state.direct_format.as_ref().expect("direct format");
    assert_eq!(
        direct_format.properties.get("fontColor"),
        Some(&serde_json::json!("#FF0000"))
    );
    assert_eq!(
        direct_format.properties.get("italic"),
        Some(&serde_json::json!(true))
    );
    assert_ne!(
        semantic_workbook_state_digest(&before_state).expect("before digest"),
        semantic_workbook_state_digest(&after_state).expect("after digest")
    );
    let diff = diff_semantic_workbook_states(&before_state, &after_state).expect("diff");
    assert!(diff.changes.iter().any(|change| {
        change.kind == SemanticChangeKind::Added
            && change.object_kind == SemanticObjectKind::Cell
            && change.domain_id == CELL_VALUES_DOMAIN
            && change.object_id == cell_key
    }));
    assert!(has_direct_format_change(
        &diff.changes,
        SemanticChangeKind::Added,
        cell_key
    ));
}

fn has_direct_format_change(
    changes: &[snapshot_types::versioning::SemanticChange],
    kind: SemanticChangeKind,
    cell_key: &str,
) -> bool {
    let object_id = format!("direct-format:{cell_key}");
    changes.iter().any(|change| {
        change.kind == kind
            && change.object_kind == SemanticObjectKind::DirectFormat
            && change.domain_id == DIRECT_FORMATS_DOMAIN
            && change.object_id == object_id
    })
}
