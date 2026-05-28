use crate::storage::YrsStorage;
use formula_types::IdentityFormula;
use value_types::{CellValue, FiniteF64};

use super::super::update_formula_templates_on_sheet_rename;
use super::{make_cell_id, make_sheet_id};

#[test]
fn test_update_templates_on_rename_end_to_end() {
    let mut storage = YrsStorage::new();
    let mut mirror = crate::mirror::CellMirror::new();
    let s1 = make_sheet_id(1);
    let s2 = make_sheet_id(2);
    storage.add_sheet(&mut mirror, s1, "Sheet1", 10, 5).unwrap();
    storage.add_sheet(&mut mirror, s2, "Sheet2", 10, 5).unwrap();

    let cell_id = make_cell_id(100);
    storage.set_cell(
        &mut mirror,
        &s1,
        cell_id,
        0,
        0,
        CellValue::Number(FiniteF64::must(42.0)),
        Some("Sheet2!A1+1".to_string()),
        Some(IdentityFormula {
            template: "Sheet2!{0}+1".to_string(),
            refs: vec![],
            is_dynamic_array: false,
            is_volatile: false,
            is_aggregate: false,
        }),
    );

    let count = update_formula_templates_on_sheet_rename(
        storage.doc(),
        storage.workbook_map(),
        storage.sheets(),
        "Sheet2",
        "Data",
    );
    assert_eq!(count, 1);

    let (_, formula, identity) = storage.read_cell_from_yrs(&s1, &cell_id).unwrap();
    assert_eq!(formula, Some("=Data!A1+1".to_string()));
    assert_eq!(identity.unwrap().template, "Data!{0}+1");
}

#[test]
fn test_update_templates_no_formulas() {
    let mut storage = YrsStorage::new();
    let mut mirror = crate::mirror::CellMirror::new();
    let s1 = make_sheet_id(1);
    storage.add_sheet(&mut mirror, s1, "Sheet1", 10, 5).unwrap();
    storage.set_cell(
        &mut mirror,
        &s1,
        make_cell_id(200),
        0,
        0,
        CellValue::Number(FiniteF64::must(42.0)),
        None,
        None,
    );

    let count = update_formula_templates_on_sheet_rename(
        storage.doc(),
        storage.workbook_map(),
        storage.sheets(),
        "Sheet2",
        "Data",
    );
    assert_eq!(count, 0);
}

#[test]
fn test_update_templates_no_cross_sheet_ref() {
    let mut storage = YrsStorage::new();
    let mut mirror = crate::mirror::CellMirror::new();
    let s1 = make_sheet_id(1);
    storage.add_sheet(&mut mirror, s1, "Sheet1", 10, 5).unwrap();
    let cell_id = make_cell_id(300);

    storage.set_cell(
        &mut mirror,
        &s1,
        cell_id,
        0,
        0,
        CellValue::Number(FiniteF64::must(10.0)),
        Some("SUM(A1:A10)".to_string()),
        Some(IdentityFormula {
            template: "SUM({0})".to_string(),
            refs: vec![],
            is_dynamic_array: false,
            is_volatile: false,
            is_aggregate: false,
        }),
    );

    let count = update_formula_templates_on_sheet_rename(
        storage.doc(),
        storage.workbook_map(),
        storage.sheets(),
        "Sheet2",
        "Data",
    );
    assert_eq!(count, 0);
}

#[test]
fn test_update_templates_multiple_cells_across_sheets() {
    let mut storage = YrsStorage::new();
    let mut mirror = crate::mirror::CellMirror::new();
    let s1 = make_sheet_id(1);
    let s2 = make_sheet_id(2);
    let s3 = make_sheet_id(3);
    storage.add_sheet(&mut mirror, s1, "Sheet1", 10, 5).unwrap();
    storage.add_sheet(&mut mirror, s2, "Sheet2", 10, 5).unwrap();
    storage.add_sheet(&mut mirror, s3, "Sheet3", 10, 5).unwrap();

    let c1 = make_cell_id(100);
    storage.set_cell(
        &mut mirror,
        &s1,
        c1,
        0,
        0,
        CellValue::Number(FiniteF64::must(1.0)),
        Some("Sheet2!A1".to_string()),
        Some(IdentityFormula {
            template: "Sheet2!{0}".to_string(),
            refs: vec![],
            is_dynamic_array: false,
            is_volatile: false,
            is_aggregate: false,
        }),
    );

    let c2 = make_cell_id(200);
    storage.set_cell(
        &mut mirror,
        &s3,
        c2,
        0,
        0,
        CellValue::Number(FiniteF64::must(2.0)),
        Some("Sheet2!B2+Sheet2!C3".to_string()),
        Some(IdentityFormula {
            template: "Sheet2!{0}+Sheet2!{1}".to_string(),
            refs: vec![],
            is_dynamic_array: false,
            is_volatile: false,
            is_aggregate: false,
        }),
    );

    let c3 = make_cell_id(300);
    storage.set_cell(
        &mut mirror,
        &s2,
        c3,
        0,
        0,
        CellValue::Number(FiniteF64::must(3.0)),
        Some("SUM(A1:A5)".to_string()),
        Some(IdentityFormula {
            template: "SUM({0})".to_string(),
            refs: vec![],
            is_dynamic_array: false,
            is_volatile: false,
            is_aggregate: false,
        }),
    );

    let count = update_formula_templates_on_sheet_rename(
        storage.doc(),
        storage.workbook_map(),
        storage.sheets(),
        "Sheet2",
        "Revenue",
    );
    assert_eq!(count, 2);

    let (_, f1, idf1) = storage.read_cell_from_yrs(&s1, &c1).unwrap();
    assert_eq!(f1, Some("=Revenue!A1".to_string()));
    assert_eq!(idf1.unwrap().template, "Revenue!{0}");

    let (_, f2, idf2) = storage.read_cell_from_yrs(&s3, &c2).unwrap();
    assert_eq!(f2, Some("=Revenue!B2+Revenue!C3".to_string()));
    assert_eq!(idf2.unwrap().template, "Revenue!{0}+Revenue!{1}");

    let (_, f3, idf3) = storage.read_cell_from_yrs(&s2, &c3).unwrap();
    assert_eq!(f3, Some("=SUM(A1:A5)".to_string()));
    assert_eq!(idf3.unwrap().template, "SUM({0})");
}

#[test]
fn test_update_templates_same_name() {
    let mut storage = YrsStorage::new();
    let mut mirror = crate::mirror::CellMirror::new();
    let s1 = make_sheet_id(1);
    storage.add_sheet(&mut mirror, s1, "Sheet1", 10, 5).unwrap();

    let count = update_formula_templates_on_sheet_rename(
        storage.doc(),
        storage.workbook_map(),
        storage.sheets(),
        "Sheet1",
        "Sheet1",
    );
    assert_eq!(count, 0);
}

#[test]
fn test_update_templates_empty_names() {
    let storage = YrsStorage::new();
    assert_eq!(
        update_formula_templates_on_sheet_rename(
            storage.doc(),
            storage.workbook_map(),
            storage.sheets(),
            "",
            "Data"
        ),
        0
    );
    assert_eq!(
        update_formula_templates_on_sheet_rename(
            storage.doc(),
            storage.workbook_map(),
            storage.sheets(),
            "Sheet1",
            ""
        ),
        0
    );
}

#[test]
fn test_update_templates_quoted_to_unquoted() {
    let mut storage = YrsStorage::new();
    let mut mirror = crate::mirror::CellMirror::new();
    let s1 = make_sheet_id(1);
    let s2 = make_sheet_id(2);
    storage.add_sheet(&mut mirror, s1, "Sheet1", 10, 5).unwrap();
    storage
        .add_sheet(&mut mirror, s2, "My Sheet", 10, 5)
        .unwrap();

    let cell_id = make_cell_id(400);
    storage.set_cell(
        &mut mirror,
        &s1,
        cell_id,
        0,
        0,
        CellValue::Number(FiniteF64::must(5.0)),
        Some("'My Sheet'!A1".to_string()),
        Some(IdentityFormula {
            template: "'My Sheet'!{0}".to_string(),
            refs: vec![],
            is_dynamic_array: false,
            is_volatile: false,
            is_aggregate: false,
        }),
    );

    let count = update_formula_templates_on_sheet_rename(
        storage.doc(),
        storage.workbook_map(),
        storage.sheets(),
        "My Sheet",
        "Data",
    );
    assert_eq!(count, 1);

    let (_, formula, idf) = storage.read_cell_from_yrs(&s1, &cell_id).unwrap();
    assert_eq!(formula, Some("=Data!A1".to_string()));
    assert_eq!(idf.unwrap().template, "Data!{0}");
}

#[test]
fn test_update_templates_unquoted_to_quoted() {
    let mut storage = YrsStorage::new();
    let mut mirror = crate::mirror::CellMirror::new();
    let s1 = make_sheet_id(1);
    let s2 = make_sheet_id(2);
    storage.add_sheet(&mut mirror, s1, "Sheet1", 10, 5).unwrap();
    storage.add_sheet(&mut mirror, s2, "Data", 10, 5).unwrap();

    let cell_id = make_cell_id(500);
    storage.set_cell(
        &mut mirror,
        &s1,
        cell_id,
        0,
        0,
        CellValue::Number(FiniteF64::must(7.0)),
        Some("Data!A1".to_string()),
        Some(IdentityFormula {
            template: "Data!{0}".to_string(),
            refs: vec![],
            is_dynamic_array: false,
            is_volatile: false,
            is_aggregate: false,
        }),
    );

    let count = update_formula_templates_on_sheet_rename(
        storage.doc(),
        storage.workbook_map(),
        storage.sheets(),
        "Data",
        "My Revenue",
    );
    assert_eq!(count, 1);

    let (_, formula, idf) = storage.read_cell_from_yrs(&s1, &cell_id).unwrap();
    assert_eq!(formula, Some("='My Revenue'!A1".to_string()));
    assert_eq!(idf.unwrap().template, "'My Revenue'!{0}");
}

#[test]
fn test_update_templates_empty_workbook() {
    let storage = YrsStorage::new();
    let count = update_formula_templates_on_sheet_rename(
        storage.doc(),
        storage.workbook_map(),
        storage.sheets(),
        "Sheet1",
        "Data",
    );
    assert_eq!(count, 0);
}
