use crate::storage::WorkbookStorage;
use formula_types::IdentityFormula;
use value_types::{CellValue, FiniteF64};

use super::update_store_formulas_on_named_range_rename;
use super::{make_cell_id, make_sheet_id};

fn set_formula_cell(
    cell_store: &mut crate::cells::CellStore,
    sheet: cell_types::SheetId,
    cell: cell_types::CellId,
    template: &str,
) {
    cell_store.apply_edit(
        &sheet,
        cell,
        cell_types::SheetPos::new(0, 0),
        CellValue::Number(FiniteF64::must(1.0)),
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
fn named_range_native_rewrites_bare_name_but_not_string_literal() {
    let mut storage = WorkbookStorage::new();
    let mut cell_store = crate::cells::CellStore::new();
    let sheet = make_sheet_id(1);
    storage
        .add_sheet(&mut cell_store, sheet, "Sheet1", 10, 5)
        .unwrap();
    let cell = make_cell_id(1);
    set_formula_cell(&mut cell_store, sheet, cell, "IF({0}=\"Region\",Region,0)");

    let count = update_store_formulas_on_named_range_rename(&mut cell_store, "Region", "Sales");
    assert_eq!(count.len(), 1);

    let identity = cell_store.get_formula(&cell);
    assert_eq!(identity.unwrap().template, "IF({0}=\"Region\",Sales,0)");
}

#[test]
fn named_range_native_skips_sheet_prefix_collision() {
    let mut storage = WorkbookStorage::new();
    let mut cell_store = crate::cells::CellStore::new();
    let sheet = make_sheet_id(1);
    storage
        .add_sheet(&mut cell_store, sheet, "Sheet1", 10, 5)
        .unwrap();
    let cell = make_cell_id(2);
    set_formula_cell(&mut cell_store, sheet, cell, "Region!{0}+Region");

    let count = update_store_formulas_on_named_range_rename(&mut cell_store, "Region", "Sales");
    assert_eq!(count.len(), 1);

    let identity = cell_store.get_formula(&cell);
    assert_eq!(identity.unwrap().template, "Region!{0}+Sales");
}

#[test]
fn named_range_native_skips_structured_table_ref_collision() {
    let mut storage = WorkbookStorage::new();
    let mut cell_store = crate::cells::CellStore::new();
    let sheet = make_sheet_id(1);
    storage
        .add_sheet(&mut cell_store, sheet, "Sheet1", 10, 5)
        .unwrap();
    let cell = make_cell_id(3);
    set_formula_cell(&mut cell_store, sheet, cell, "Region+Table1[Region]");

    let count = update_store_formulas_on_named_range_rename(&mut cell_store, "Table1", "Sales");
    assert_eq!(count.len(), 0);
}

#[test]
fn named_range_native_does_not_insert_empty_formula_for_template_only_cell() {
    let mut storage = WorkbookStorage::new();
    let mut cell_store = crate::cells::CellStore::new();
    let sheet = make_sheet_id(1);
    storage
        .add_sheet(&mut cell_store, sheet, "Sheet1", 10, 5)
        .unwrap();
    let cell = make_cell_id(4);
    set_formula_cell(&mut cell_store, sheet, cell, "Region+1");

    let count = update_store_formulas_on_named_range_rename(&mut cell_store, "Region", "Sales");
    assert_eq!(count.len(), 1);

    let identity = cell_store.get_formula(&cell);
    assert_eq!(identity.unwrap().template, "Sales+1");
}
