use super::test_support::*;
use super::*;

#[test]
fn test_add_and_get_format() {
    let (storage, sheet_id) = storage_with_sheet();
    let fmt = make_format(
        "cf1",
        &sheet_id,
        vec![rng(0, 0, 9, 3)],
        vec![make_rule("r1", 1)],
    );
    add_conditional_format(storage.doc(), &storage.sheets_ref(), &fmt);
    let result = get_conditional_format(storage.doc(), &storage.sheets_ref(), "cf1", &sheet_id);
    assert!(result.is_some());
    let result = result.unwrap();
    assert_eq!(result.id, "cf1");
    assert_eq!(result.rules.len(), 1);
    assert_eq!(result.rules[0].id(), "r1");
}

#[test]
fn test_get_nonexistent_format() {
    let (storage, sheet_id) = storage_with_sheet();
    assert!(
        get_conditional_format(storage.doc(), &storage.sheets_ref(), "nope", &sheet_id).is_none()
    );
}

#[test]
fn test_update_format() {
    let (storage, sheet_id) = storage_with_sheet();
    let fmt = make_format(
        "cf1",
        &sheet_id,
        vec![rng(0, 0, 9, 3)],
        vec![make_rule("r1", 1)],
    );
    add_conditional_format(storage.doc(), &storage.sheets_ref(), &fmt);
    let updates =
        serde_json::json!({"ranges": [{"startRow": 5, "startCol": 0, "endRow": 15, "endCol": 5}]});
    assert!(update_conditional_format(
        storage.doc(),
        &storage.sheets_ref(),
        "cf1",
        &sheet_id,
        &updates
    ));
    let result =
        get_conditional_format(storage.doc(), &storage.sheets_ref(), "cf1", &sheet_id).unwrap();
    assert_eq!(result.ranges[0].start_row(), 5);
    assert_eq!(result.ranges[0].end_row(), 15);
}

#[test]
fn test_update_nonexistent_format() {
    let (storage, sheet_id) = storage_with_sheet();
    assert!(!update_conditional_format(
        storage.doc(),
        &storage.sheets_ref(),
        "nope",
        &sheet_id,
        &serde_json::json!({})
    ));
}

#[test]
fn test_delete_format() {
    let (storage, sheet_id) = storage_with_sheet();
    let fmt = make_format(
        "cf1",
        &sheet_id,
        vec![rng(0, 0, 9, 3)],
        vec![make_rule("r1", 1)],
    );
    add_conditional_format(storage.doc(), &storage.sheets_ref(), &fmt);
    assert!(delete_conditional_format(
        storage.doc(),
        &storage.sheets_ref(),
        "cf1",
        &sheet_id
    ));
    assert!(
        get_conditional_format(storage.doc(), &storage.sheets_ref(), "cf1", &sheet_id).is_none()
    );
}

#[test]
fn test_delete_nonexistent_format() {
    let (storage, sheet_id) = storage_with_sheet();
    assert!(!delete_conditional_format(
        storage.doc(),
        &storage.sheets_ref(),
        "nope",
        &sheet_id
    ));
}

#[test]
fn test_get_formats_for_sheet_sorted_by_priority() {
    let (storage, sheet_id) = storage_with_sheet();
    add_conditional_format(
        storage.doc(),
        &storage.sheets_ref(),
        &make_format(
            "cf1",
            &sheet_id,
            vec![rng(0, 0, 5, 5)],
            vec![make_rule("r1", 10)],
        ),
    );
    add_conditional_format(
        storage.doc(),
        &storage.sheets_ref(),
        &make_format(
            "cf2",
            &sheet_id,
            vec![rng(0, 0, 5, 5)],
            vec![make_rule("r2", 1)],
        ),
    );
    add_conditional_format(
        storage.doc(),
        &storage.sheets_ref(),
        &make_format(
            "cf3",
            &sheet_id,
            vec![rng(0, 0, 5, 5)],
            vec![make_rule("r3", 5)],
        ),
    );
    let formats = get_formats_for_sheet(storage.doc(), &storage.sheets_ref(), &sheet_id);
    assert_eq!(formats.len(), 3);
    assert_eq!(formats[0].id, "cf2");
    assert_eq!(formats[1].id, "cf3");
    assert_eq!(formats[2].id, "cf1");
}

#[test]
fn test_get_formats_for_sheet_empty() {
    let (storage, sheet_id) = storage_with_sheet();
    assert!(get_formats_for_sheet(storage.doc(), &storage.sheets_ref(), &sheet_id).is_empty());
}

#[test]
fn test_get_formats_for_cell() {
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
    add_conditional_format(
        storage.doc(),
        &storage.sheets_ref(),
        &make_format(
            "cf2",
            &sheet_id,
            vec![rng(10, 10, 20, 20)],
            vec![make_rule("r2", 2)],
        ),
    );
    assert_eq!(
        get_formats_for_cell(storage.doc(), &storage.sheets_ref(), &sheet_id, 3, 3).len(),
        1
    );
    assert_eq!(
        get_formats_for_cell(storage.doc(), &storage.sheets_ref(), &sheet_id, 3, 3)[0].id,
        "cf1"
    );
    assert_eq!(
        get_formats_for_cell(storage.doc(), &storage.sheets_ref(), &sheet_id, 15, 15)[0].id,
        "cf2"
    );
    assert!(
        get_formats_for_cell(storage.doc(), &storage.sheets_ref(), &sheet_id, 50, 50).is_empty()
    );
}

#[test]
fn test_has_cf_for_cell() {
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
    assert!(has_cf_for_cell(
        storage.doc(),
        &storage.sheets_ref(),
        &sheet_id,
        0,
        0
    ));
    assert!(has_cf_for_cell(
        storage.doc(),
        &storage.sheets_ref(),
        &sheet_id,
        5,
        5
    ));
    assert!(!has_cf_for_cell(
        storage.doc(),
        &storage.sheets_ref(),
        &sheet_id,
        6,
        6
    ));
}

#[test]
fn test_clear_formats_for_sheet() {
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
    add_conditional_format(
        storage.doc(),
        &storage.sheets_ref(),
        &make_format(
            "cf2",
            &sheet_id,
            vec![rng(10, 10, 20, 20)],
            vec![make_rule("r2", 2)],
        ),
    );
    assert_eq!(
        get_formats_for_sheet(storage.doc(), &storage.sheets_ref(), &sheet_id).len(),
        2
    );
    clear_formats_for_sheet(storage.doc(), &storage.sheets_ref(), &sheet_id);
    assert_eq!(
        get_formats_for_sheet(storage.doc(), &storage.sheets_ref(), &sheet_id).len(),
        0
    );
}
