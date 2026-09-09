/// Walk every formula cell in the in-memory [`crate::mirror::CellMirror`] and
/// rewrite occurrences of `old_name` in the identity formula template.
pub fn update_mirror_formulas_on_named_range_rename(
    mirror: &mut crate::mirror::CellMirror,
    rewrite: impl Fn(&crate::mirror::CellMirror, cell_types::SheetId, &str) -> String,
) -> Vec<cell_types::CellId> {
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
            let new_template = rewrite(mirror, sheet_id, &formula.template);
            if new_template != formula.template {
                updates.push((sheet_id, *cell_id, new_template));
            }
        }
    }

    let changed_cells = updates.iter().map(|(_, cell_id, _)| *cell_id).collect();
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
    changed_cells
}
