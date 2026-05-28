use formula_types::{IdentityCellRef, IdentityFormula, IdentityFormulaRef};
use value_types::{CellValue, FiniteF64};

use super::super::update_mirror_formulas_on_named_range_rename;
use super::{make_cell_id, make_sheet_id};

#[test]
fn named_range_mirror_rewrites_template_and_preserves_formula_metadata() {
    let mut storage = crate::storage::YrsStorage::new();
    let mut mirror = crate::mirror::CellMirror::new();
    let sheet = make_sheet_id(1);
    let cell = make_cell_id(1);
    storage
        .add_sheet(&mut mirror, sheet, "Sheet1", 10, 5)
        .unwrap();
    storage.set_cell(
        &mut mirror,
        &sheet,
        cell,
        0,
        0,
        CellValue::Number(FiniteF64::must(1.0)),
        Some("Region+1".to_string()),
        Some(IdentityFormula {
            template: "Region+{0}".to_string(),
            refs: vec![IdentityFormulaRef::Cell(IdentityCellRef {
                id: cell,
                row_absolute: false,
                col_absolute: false,
            })],
            is_dynamic_array: true,
            is_volatile: true,
            is_aggregate: true,
        }),
    );

    update_mirror_formulas_on_named_range_rename(&mut mirror, "Region", "Sales");

    let formula = mirror.get_formula(&cell).unwrap();
    assert_eq!(formula.template, "Sales+{0}");
    assert_eq!(
        formula.refs,
        vec![IdentityFormulaRef::Cell(IdentityCellRef {
            id: cell,
            row_absolute: false,
            col_absolute: false,
        })]
    );
    assert!(formula.is_dynamic_array);
    assert!(formula.is_volatile);
    assert!(formula.is_aggregate);
}

#[test]
fn named_range_mirror_skips_disqualified_contexts() {
    let mut storage = crate::storage::YrsStorage::new();
    let mut mirror = crate::mirror::CellMirror::new();
    let sheet = make_sheet_id(1);
    let cell = make_cell_id(2);
    storage
        .add_sheet(&mut mirror, sheet, "Sheet1", 10, 5)
        .unwrap();
    storage.set_cell(
        &mut mirror,
        &sheet,
        cell,
        0,
        0,
        CellValue::Number(FiniteF64::must(1.0)),
        Some("\"Region\"+Region!A1+Region(A1)+Region[Col]".to_string()),
        Some(IdentityFormula {
            template: "\"Region\"+Region!{0}+Region({1})+Region[Col]".to_string(),
            refs: vec![],
            is_dynamic_array: false,
            is_volatile: false,
            is_aggregate: false,
        }),
    );

    update_mirror_formulas_on_named_range_rename(&mut mirror, "Region", "Sales");

    let formula = mirror.get_formula(&cell).unwrap();
    assert_eq!(
        formula.template,
        "\"Region\"+Region!{0}+Region({1})+Region[Col]"
    );
}
