//! Strict explicit-target contracts for floating-object mutations.

use super::super::*;
use super::helpers::*;

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
