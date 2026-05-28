use crate::storage::YrsStorage;
use formula_types::IdentityFormula;
use value_types::{CellValue, FiniteF64};

use super::super::update_formula_templates_on_named_range_rename;
use super::{make_cell_id, make_sheet_id};

fn set_formula_cell(
    storage: &mut YrsStorage,
    mirror: &mut crate::mirror::CellMirror,
    sheet: cell_types::SheetId,
    cell: cell_types::CellId,
    formula: Option<&str>,
    template: &str,
) {
    storage.set_cell(
        mirror,
        &sheet,
        cell,
        0,
        0,
        CellValue::Number(FiniteF64::must(1.0)),
        formula.map(str::to_string),
        Some(IdentityFormula {
            template: template.to_string(),
            refs: vec![],
            is_dynamic_array: false,
            is_volatile: false,
            is_aggregate: false,
        }),
    );
}

#[test]
fn named_range_storage_rewrites_bare_name_but_not_string_literal() {
    let mut storage = YrsStorage::new();
    let mut mirror = crate::mirror::CellMirror::new();
    let sheet = make_sheet_id(1);
    storage
        .add_sheet(&mut mirror, sheet, "Sheet1", 10, 5)
        .unwrap();
    let cell = make_cell_id(1);
    set_formula_cell(
        &mut storage,
        &mut mirror,
        sheet,
        cell,
        Some("IF(A1=\"Region\",Region,0)"),
        "IF({0}=\"Region\",Region,0)",
    );

    let count = update_formula_templates_on_named_range_rename(
        storage.doc(),
        storage.workbook_map(),
        storage.sheets(),
        "Region",
        "Sales",
    );
    assert_eq!(count, 1);

    let (_, formula, identity) = storage.read_cell_from_yrs(&sheet, &cell).unwrap();
    assert_eq!(formula, Some("=IF(A1=\"Region\",Sales,0)".to_string()));
    assert_eq!(identity.unwrap().template, "IF({0}=\"Region\",Sales,0)");
}

#[test]
fn named_range_storage_skips_sheet_prefix_collision() {
    let mut storage = YrsStorage::new();
    let mut mirror = crate::mirror::CellMirror::new();
    let sheet = make_sheet_id(1);
    storage
        .add_sheet(&mut mirror, sheet, "Sheet1", 10, 5)
        .unwrap();
    let cell = make_cell_id(2);
    set_formula_cell(
        &mut storage,
        &mut mirror,
        sheet,
        cell,
        Some("Region!A1+Region"),
        "Region!{0}+Region",
    );

    let count = update_formula_templates_on_named_range_rename(
        storage.doc(),
        storage.workbook_map(),
        storage.sheets(),
        "Region",
        "Sales",
    );
    assert_eq!(count, 1);

    let (_, formula, identity) = storage.read_cell_from_yrs(&sheet, &cell).unwrap();
    assert_eq!(formula, Some("=Region!A1+Sales".to_string()));
    assert_eq!(identity.unwrap().template, "Region!{0}+Sales");
}

#[test]
fn named_range_storage_skips_structured_table_ref_collision() {
    let mut storage = YrsStorage::new();
    let mut mirror = crate::mirror::CellMirror::new();
    let sheet = make_sheet_id(1);
    storage
        .add_sheet(&mut mirror, sheet, "Sheet1", 10, 5)
        .unwrap();
    let cell = make_cell_id(3);
    set_formula_cell(
        &mut storage,
        &mut mirror,
        sheet,
        cell,
        Some("Region+Table1[Region]"),
        "Region+Table1[Region]",
    );

    let count = update_formula_templates_on_named_range_rename(
        storage.doc(),
        storage.workbook_map(),
        storage.sheets(),
        "Table1",
        "Sales",
    );
    assert_eq!(count, 0);
}

#[test]
fn named_range_storage_does_not_insert_empty_formula_for_template_only_cell() {
    let mut storage = YrsStorage::new();
    let mut mirror = crate::mirror::CellMirror::new();
    let sheet = make_sheet_id(1);
    storage
        .add_sheet(&mut mirror, sheet, "Sheet1", 10, 5)
        .unwrap();
    let cell = make_cell_id(4);
    set_formula_cell(&mut storage, &mut mirror, sheet, cell, None, "Region+1");

    let count = update_formula_templates_on_named_range_rename(
        storage.doc(),
        storage.workbook_map(),
        storage.sheets(),
        "Region",
        "Sales",
    );
    assert_eq!(count, 1);

    let (_, formula, identity) = storage.read_cell_from_yrs(&sheet, &cell).unwrap();
    assert_eq!(formula, None);
    assert_eq!(identity.unwrap().template, "Sales+1");
}
