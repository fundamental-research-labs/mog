/// Walk every formula cell in the in-memory [`crate::cells::CellStore`] and
/// rewrite occurrences of `old_name` in the identity formula template.
pub fn update_store_formulas_on_named_range_rename(
    cell_store: &mut crate::cells::CellStore,
    rewrite: impl Fn(&crate::cells::CellStore, cell_types::SheetId, &str) -> String,
) -> Vec<cell_types::CellId> {
    let mut updates: Vec<(cell_types::SheetId, cell_types::CellId, String)> = Vec::new();
    let sheet_ids: Vec<cell_types::SheetId> = cell_store.sheet_ids().copied().collect();
    for sheet_id in sheet_ids {
        let Some(sheet) = cell_store.get_sheet(&sheet_id) else {
            continue;
        };
        for (cell_id, formula) in &sheet.formulas {
            let new_template = rewrite(cell_store, sheet_id, &formula.template);
            if new_template != formula.template {
                updates.push((sheet_id, *cell_id, new_template));
            }
        }
    }

    let changed_cells = updates.iter().map(|(_, cell_id, _)| *cell_id).collect();
    for (_sheet_id, cell_id, new_template) in updates {
        let new_formula = cell_store.get_formula(&cell_id).map(|f| {
            let mut cloned = f.clone();
            cloned.template = new_template;
            cloned
        });
        if let Some(f) = new_formula {
            cell_store.set_formula(&cell_id, Some(f));
        }
    }
    changed_cells
}
