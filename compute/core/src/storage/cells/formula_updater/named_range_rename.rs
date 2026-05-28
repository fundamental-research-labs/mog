use yrs::{Doc, MapRef};

use super::named_refs::{formula_contains_name_ref, replace_name_in_formula};
use super::storage_scan::{FormulaFieldUpdate, update_formula_cells};

/// Walk every formula cell in the in-memory [`crate::mirror::CellMirror`] and
/// rewrite occurrences of `old_name` in the identity formula template.
pub fn update_mirror_formulas_on_named_range_rename(
    mirror: &mut crate::mirror::CellMirror,
    old_name: &str,
    new_name: &str,
) {
    if old_name.is_empty() || new_name.is_empty() || old_name == new_name {
        return;
    }

    let mut updates: Vec<(cell_types::SheetId, cell_types::CellId, String)> = Vec::new();
    let sheet_ids: Vec<cell_types::SheetId> = mirror.sheet_ids().copied().collect();
    for sheet_id in sheet_ids {
        let Some(sheet) = mirror.get_sheet(&sheet_id) else {
            continue;
        };
        for (cell_id, entry) in sheet.cells_iter() {
            let Some(formula) = &entry.formula else {
                continue;
            };
            if !formula_contains_name_ref(&formula.template, old_name) {
                continue;
            }
            let new_template = replace_name_in_formula(&formula.template, old_name, new_name);
            if new_template != formula.template {
                updates.push((sheet_id, *cell_id, new_template));
            }
        }
    }

    for (_sheet_id, cell_id, new_template) in updates {
        let new_formula = mirror.get_formula(&cell_id).map(|f| {
            let mut cloned = f.clone();
            cloned.template = new_template;
            cloned
        });
        if let Some(f) = new_formula {
            mirror.set_formula(&cell_id, Some(f));
        }
    }
}

/// Update formula bodies after a named range rename.
pub fn update_formula_templates_on_named_range_rename(
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
        let formula_matches = formula
            .map(|f| !f.is_empty() && formula_contains_name_ref(f, old_name))
            .unwrap_or(false);
        let template_matches = template
            .map(|t| formula_contains_name_ref(t, old_name))
            .unwrap_or(false);

        if !template_matches && !formula_matches {
            return None;
        }

        Some(FormulaFieldUpdate {
            new_template: template.map(|t| replace_name_in_formula(t, old_name, new_name)),
            new_formula: formula
                .filter(|f| !f.is_empty())
                .map(|f| replace_name_in_formula(f, old_name, new_name)),
        })
    })
}
