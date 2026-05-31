use yrs::{Doc, MapRef};

use super::sheet_refs::{
    replace_sheet_name_in_a1_formula, replace_sheet_name_in_template, template_contains_sheet_ref,
};
use super::storage_scan::{FormulaFieldUpdate, update_formula_cells, update_formula_cells_in_txn};

/// Update formula templates after a sheet rename.
pub fn update_formula_templates_on_sheet_rename(
    doc: &Doc,
    workbook: &MapRef,
    sheets: &MapRef,
    old_name: &str,
    new_name: &str,
) -> u32 {
    if old_name.is_empty() || new_name.is_empty() || old_name == new_name {
        return 0;
    }

    update_formula_cells(doc, workbook, sheets, |template, formula| {
        build_sheet_rename_update(template, formula, old_name, new_name)
    })
}

pub(crate) fn update_formula_templates_on_sheet_rename_in_txn(
    txn: &mut yrs::TransactionMut<'_>,
    workbook: &MapRef,
    sheets: &MapRef,
    old_name: &str,
    new_name: &str,
) -> u32 {
    if old_name.is_empty() || new_name.is_empty() || old_name == new_name {
        return 0;
    }

    update_formula_cells_in_txn(txn, workbook, sheets, |template, formula| {
        build_sheet_rename_update(template, formula, old_name, new_name)
    })
}

fn build_sheet_rename_update(
    template: Option<&str>,
    formula: Option<&str>,
    old_name: &str,
    new_name: &str,
) -> Option<FormulaFieldUpdate> {
    let formula = formula.unwrap_or("");
    let template_matches = template
        .map(|t| template_contains_sheet_ref(t, old_name))
        .unwrap_or(false);
    let formula_matches = !formula.is_empty() && formula.contains(&format!("{}!", old_name));

    if !template_matches && !formula_matches {
        return None;
    }

    Some(FormulaFieldUpdate {
        new_template: template.map(|t| replace_sheet_name_in_template(t, old_name, new_name)),
        new_formula: Some(replace_sheet_name_in_a1_formula(
            formula, old_name, new_name,
        )),
    })
}
