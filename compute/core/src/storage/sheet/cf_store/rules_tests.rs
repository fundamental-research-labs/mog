use super::test_support::*;
use super::*;

#[test]
fn test_add_rule() {
    let (storage, sheet_id) = storage_with_sheet();
    add_conditional_format(
        storage.doc(),
        &storage.sheets_ref(),
        &make_format(
            "cf1",
            &sheet_id,
            vec![rng(0, 0, 5, 5)],
            vec![make_rule("r1", 5)],
        ),
    );
    assert!(add_cf_rule(
        storage.doc(),
        &storage.sheets_ref(),
        "cf1",
        &sheet_id,
        &make_rule("r2", 1)
    ));
    let result =
        get_conditional_format(storage.doc(), &storage.sheets_ref(), "cf1", &sheet_id).unwrap();
    assert_eq!(result.rules.len(), 2);
    assert_eq!(result.rules[0].id(), "r2");
    assert_eq!(result.rules[1].id(), "r1");
}

#[test]
fn test_add_rule_to_nonexistent_format() {
    let (storage, sheet_id) = storage_with_sheet();
    assert!(!add_cf_rule(
        storage.doc(),
        &storage.sheets_ref(),
        "nope",
        &sheet_id,
        &make_rule("r1", 1)
    ));
}

#[test]
fn test_update_rule() {
    let (storage, sheet_id) = storage_with_sheet();
    add_conditional_format(
        storage.doc(),
        &storage.sheets_ref(),
        &make_format(
            "cf1",
            &sheet_id,
            vec![rng(0, 0, 5, 5)],
            vec![make_rule("r1", 1)],
        ),
    );
    assert!(update_cf_rule(
        storage.doc(),
        &storage.sheets_ref(),
        "cf1",
        &sheet_id,
        "r1",
        &serde_json::json!({"priority": 99})
    ));
    assert_eq!(
        get_conditional_format(storage.doc(), &storage.sheets_ref(), "cf1", &sheet_id)
            .unwrap()
            .rules[0]
            .priority(),
        99
    );
}

#[test]
fn test_update_nonexistent_rule() {
    let (storage, sheet_id) = storage_with_sheet();
    add_conditional_format(
        storage.doc(),
        &storage.sheets_ref(),
        &make_format(
            "cf1",
            &sheet_id,
            vec![rng(0, 0, 5, 5)],
            vec![make_rule("r1", 1)],
        ),
    );
    assert!(!update_cf_rule(
        storage.doc(),
        &storage.sheets_ref(),
        "cf1",
        &sheet_id,
        "nope",
        &serde_json::json!({})
    ));
}

#[test]
fn test_delete_rule() {
    let (storage, sheet_id) = storage_with_sheet();
    add_conditional_format(
        storage.doc(),
        &storage.sheets_ref(),
        &make_format(
            "cf1",
            &sheet_id,
            vec![rng(0, 0, 5, 5)],
            vec![make_rule("r1", 1), make_rule("r2", 2)],
        ),
    );
    assert!(delete_cf_rule(
        storage.doc(),
        &storage.sheets_ref(),
        "cf1",
        &sheet_id,
        "r1"
    ));
    let result =
        get_conditional_format(storage.doc(), &storage.sheets_ref(), "cf1", &sheet_id).unwrap();
    assert_eq!(result.rules.len(), 1);
    assert_eq!(result.rules[0].id(), "r2");
}

#[test]
fn test_delete_last_rule_deletes_format() {
    let (storage, sheet_id) = storage_with_sheet();
    add_conditional_format(
        storage.doc(),
        &storage.sheets_ref(),
        &make_format(
            "cf1",
            &sheet_id,
            vec![rng(0, 0, 5, 5)],
            vec![make_rule("r1", 1)],
        ),
    );
    assert!(delete_cf_rule(
        storage.doc(),
        &storage.sheets_ref(),
        "cf1",
        &sheet_id,
        "r1"
    ));
    assert!(
        get_conditional_format(storage.doc(), &storage.sheets_ref(), "cf1", &sheet_id).is_none()
    );
}

#[test]
fn test_delete_nonexistent_rule() {
    let (storage, sheet_id) = storage_with_sheet();
    add_conditional_format(
        storage.doc(),
        &storage.sheets_ref(),
        &make_format(
            "cf1",
            &sheet_id,
            vec![rng(0, 0, 5, 5)],
            vec![make_rule("r1", 1)],
        ),
    );
    assert!(!delete_cf_rule(
        storage.doc(),
        &storage.sheets_ref(),
        "cf1",
        &sheet_id,
        "nope"
    ));
}
