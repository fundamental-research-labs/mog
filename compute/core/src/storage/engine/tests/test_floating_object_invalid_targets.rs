//! Strict explicit-target contracts for floating-object mutations.

use super::super::*;
use super::helpers::*;

fn assert_chart_not_found(err: value_types::ComputeError, sid: &cell_types::SheetId, id: &str) {
    assert!(
        matches!(
            err,
            value_types::ComputeError::ChartNotFound {
                ref sheet_id,
                ref chart_id,
            } if sheet_id == &sid.to_uuid_string() && chart_id == id
        ),
        "expected receiver-scoped ChartNotFound for {id}, got {err:?}"
    );
}

#[test]
fn delete_missing_floating_object_is_an_error() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let sid = sheet_id();

    let err = engine
        .delete_floating_object(&sid, "missing-object")
        .expect_err("missing floating-object delete must fail");
    assert!(matches!(
        err,
        value_types::ComputeError::InvalidInput { .. }
    ));
}

#[test]
fn group_rejects_missing_members_without_creating_a_group() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let sid = sheet_id();
    let config = serde_json::json!({ "children": ["missing-a", "missing-b"] });

    let err = engine
        .create_floating_object_group(&sid, &config)
        .expect_err("group with missing members must fail");
    assert!(matches!(
        err,
        value_types::ComputeError::InvalidInput { .. }
    ));
    assert!(engine.get_all_floating_object_groups_typed(&sid).is_empty());
}

#[test]
fn chart_mutations_reject_missing_root_targets() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let sid = sheet_id();
    let id = "missing-chart";
    let updates = serde_json::json!({ "name": "must-not-be-created" });

    let errors = [
        engine
            .update_chart(&sid, id, &updates)
            .expect_err("missing chart update must fail"),
        engine
            .delete_chart(&sid, id)
            .expect_err("missing chart delete must fail"),
        engine
            .bring_chart_to_front(&sid, id)
            .expect_err("missing chart bring-to-front must fail"),
        engine
            .send_chart_to_back(&sid, id)
            .expect_err("missing chart send-to-back must fail"),
        engine
            .bring_chart_forward(&sid, id)
            .expect_err("missing chart bring-forward must fail"),
        engine
            .send_chart_backward(&sid, id)
            .expect_err("missing chart send-backward must fail"),
        engine
            .link_chart_to_table(&sid, id, "table-1")
            .expect_err("missing chart link-to-table must fail"),
        engine
            .unlink_chart_from_table(&sid, id)
            .expect_err("missing chart unlink-from-table must fail"),
    ];

    for err in errors {
        assert_chart_not_found(err, &sid, id);
    }
}

#[test]
fn missing_chart_reads_remain_tolerant() {
    let (engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let sid = sheet_id();

    assert!(engine.get_chart(&sid, "missing-chart").is_none());
    assert!(!engine.is_chart_linked_to_table(&sid, "missing-chart"));
}

#[test]
fn chart_mutations_reject_stale_ids_after_deletion() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let sid = sheet_id();
    let config = serde_json::json!({
        "chartType": "bar",
        "dataRange": "A1:B2",
        "anchorRow": 0,
        "anchorCol": 0,
        "width": 320,
        "height": 200,
    });
    engine
        .create_chart(&sid, &config)
        .expect("chart creation should succeed");
    let chart_id = engine
        .get_all_charts(&sid)
        .into_iter()
        .next()
        .expect("created chart")
        .common
        .id;
    engine
        .delete_chart(&sid, &chart_id)
        .expect("initial chart deletion should succeed");

    let err = engine
        .update_chart(&sid, &chart_id, &serde_json::json!({ "name": "stale" }))
        .expect_err("a deleted chart ID must remain invalid");
    assert_chart_not_found(err, &sid, &chart_id);
    assert!(engine.get_chart(&sid, &chart_id).is_none());
}
