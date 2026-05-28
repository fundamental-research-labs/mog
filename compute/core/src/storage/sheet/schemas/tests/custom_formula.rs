use super::support::*;
use super::*;

#[test]
fn custom_formula_accepts_truthy_typed_value() {
    let (storage, sid, gi, mirror) = storage_with_sheet_and_mirror();
    let rs = make_custom_formula_range_schema(
        "rs-custom-truthy",
        "=ISNUMBER(E1)",
        vec![IdentityRangeSchemaRef {
            start_id: "0:4".to_string(),
            end_id: "4:4".to_string(),
            sheet_id: None,
        }],
    );
    set_range_schema(storage.doc(), storage.sheets(), &sid, &rs).unwrap();

    let result = validate_cell_value(
        storage.doc(),
        storage.sheets(),
        &sid,
        0,
        4,
        "42",
        Some(&gi),
        &mirror,
    );
    assert!(result.valid, "Numeric '42' must satisfy ISNUMBER");
}
#[test]
fn custom_formula_rejects_falsy_typed_value() {
    let (storage, sid, gi, mirror) = storage_with_sheet_and_mirror();
    let rs = make_custom_formula_range_schema(
        "rs-custom-falsy",
        "=ISNUMBER(E1)",
        vec![IdentityRangeSchemaRef {
            start_id: "0:4".to_string(),
            end_id: "4:4".to_string(),
            sheet_id: None,
        }],
    );
    set_range_schema(storage.doc(), storage.sheets(), &sid, &rs).unwrap();

    let result = validate_cell_value(
        storage.doc(),
        storage.sheets(),
        &sid,
        1,
        4,
        "hello",
        Some(&gi),
        &mirror,
    );
    assert!(
        !result.valid,
        "Text 'hello' must fail ISNUMBER and reject the commit"
    );
    assert_eq!(result.enforcement, EnforcementLevel::Strict);
}
#[test]
fn custom_formula_shifts_relative_refs_per_row() {
    // =ISNUMBER(E1) on E1:E5 must evaluate as ISNUMBER(E2) for row 1, etc.
    // The pending typed value is what gets fed to the (shifted) reference.
    let (storage, sid, gi, mirror) = storage_with_sheet_and_mirror();
    let rs = make_custom_formula_range_schema(
        "rs-custom-shift",
        "=ISNUMBER(E1)",
        vec![IdentityRangeSchemaRef {
            start_id: "0:4".to_string(),
            end_id: "4:4".to_string(),
            sheet_id: None,
        }],
    );
    set_range_schema(storage.doc(), storage.sheets(), &sid, &rs).unwrap();

    // Row 2 (E3): typing "3.14" shifts the formula to ISNUMBER(E3) and the
    // pending override at E3 supplies the number; ISNUMBER returns TRUE.
    let result = validate_cell_value(
        storage.doc(),
        storage.sheets(),
        &sid,
        2,
        4,
        "3.14",
        Some(&gi),
        &mirror,
    );
    assert!(result.valid);
}
