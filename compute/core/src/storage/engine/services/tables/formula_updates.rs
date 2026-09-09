use super::*;
use crate::storage::cells::structured_ref_updater::TableReferenceEdit;
use crate::storage::engine::history::metadata::{MetadataImpact, capture_workbook_entry};

/// Apply a table edit to native sources before evaluating their new dependencies.
pub(super) fn rewrite_table_formulas(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    edit: TableReferenceEdit<'_>,
) -> usize {
    // Table-owned calculated and totals formulas must export the same source as cells.
    let tables = mirror.all_tables().to_vec();
    for mut table in tables {
        let mut changed = false;
        for column in &mut table.columns {
            for (source, row) in [
                (
                    &mut column.calculated_formula,
                    table.range.start_row() + u32::from(table.has_header_row),
                ),
                (&mut column.totals_row_formula, table.range.end_row()),
            ] {
                if let Some(formula) = source {
                    let qualified = compute_parser::qualify_implicit_structured_refs(
                        formula,
                        Some(&table.name),
                    );
                    let rewritten = edit.rewrite(&qualified, Some(row));
                    if rewritten != qualified {
                        *formula = rewritten;
                        changed = true;
                    }
                }
            }
        }
        if changed {
            stores.compute.set_table(mirror, table.clone());
        }
    }
    let names: Vec<_> = stores
        .storage
        .metadata
        .named_ranges
        .iter()
        .map(|(key, name)| (key.clone(), name.clone()))
        .collect();
    let mut changed_names = Vec::new();
    for (key, mut name) in names {
        let context = name
            .scope
            .as_deref()
            .and_then(|id| SheetId::from_uuid_str(id).ok())
            .or_else(|| mirror.sheet_ids().next().copied());
        let Some(context) = context else {
            continue;
        };
        let source = stores
            .compute
            .to_a1_display_qualified(mirror, &context, &name.refers_to);
        let rewritten = edit.rewrite(&source, None);
        if source == rewritten {
            continue;
        }
        name.refers_to = stores
            .compute
            .to_identity_formula_with_rect_ranges(mirror, &context, &rewritten)
            .unwrap_or_else(|_| {
                crate::storage::workbook::named_ranges::expression_template(&rewritten)
            });
        name.raw_refers_to = None;
        capture_workbook_entry!(stores.storage, named_ranges, key, MetadataImpact::Names);
        stores
            .storage
            .metadata
            .named_ranges
            .insert(key, name.clone());
        changed_names.push(name);
    }
    let changed_name_count = changed_names.len();
    let definitions = crate::storage::engine::construction::defined_names_to_named_range_defs(
        changed_names,
        |identity| {
            stores
                .compute
                .to_a1_display_qualified(mirror, &SheetId::from_raw(0), identity)
        },
    );
    for definition in definitions {
        stores
            .compute
            .set_named_range(mirror, definition.name.clone(), definition);
    }
    if stores.storage.history.is_active() {
        for (cell_id, formula) in stores.compute.formula_texts_for_diagnostics() {
            if let Some(sheet) = mirror.sheet_for_cell(cell_id)
                && let Some(pos) = mirror.resolve_position(cell_id)
                && edit.rewrite(formula, Some(pos.row())) != formula
            {
                crate::storage::engine::history::cells::capture_cell(
                    stores,
                    mirror,
                    sheet,
                    *cell_id,
                    pos.row(),
                    pos.col(),
                );
            }
        }
    }
    let changed_cells = stores
        .compute
        .rewrite_formula_sources(mirror, |row, formula| edit.rewrite(formula, row));
    changed_cells.len() + changed_name_count
}
