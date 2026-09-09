use cell_types::{SheetId, SheetPos};
use domain_types::CellData;
use rustc_hash::FxHashMap;

use crate::cells::CellStore;
use crate::storage::engine::stores::EngineStores;

use super::super::PaletteOps;
use super::materialize::{build_cell_data_for_cell_id, range_payload_cell};
use super::metadata_reads::batch_read_props_array_refs_and_formula_metadata;
use super::style_ids::positional_style_id_at;

pub(in crate::storage::engine) fn export_cells_for_sheet(
    stores: &EngineStores,
    cell_store: &CellStore,
    sheet_id: &SheetId,
    palette: &impl PaletteOps,
) -> Vec<CellData> {
    let mut profile = crate::xlsx_profile::PhaseTimer::new("export", "export_cells_for_sheet");

    // Read native cell properties and formula metadata using typed CellId keys.
    let (all_props, array_refs, formula_metadata, rich_strings) =
        batch_read_props_array_refs_and_formula_metadata(stores, cell_store, sheet_id);

    let mut cells_by_pos: FxHashMap<(u32, u32), CellData> = FxHashMap::default();
    if let Some(sheet) = cell_store.get_sheet(sheet_id) {
        profile.counter("registered_cells", sheet.cells().count() as u64);
        for (cell_id, row, col) in sheet.cells() {
            if let Some(mut cell) = build_cell_data_for_cell_id(
                stores,
                cell_store,
                sheet_id,
                &cell_id,
                row,
                col,
                &all_props,
                &array_refs,
                &formula_metadata,
                &rich_strings,
                palette,
                cell_id.is_virtual(),
            ) {
                if cell.style_id.is_none() {
                    cell.style_id =
                        positional_style_id_at(stores, cell_store, sheet_id, row, col, palette);
                }
                cells_by_pos.insert((row, col), cell);
            }
        }

        sheet.visit_range_values_for_export(|row, col, value| {
            if value.is_null() {
                return;
            }
            match cells_by_pos.get_mut(&(row, col)) {
                Some(existing) => {
                    if existing.formula.is_none() && existing.value.is_null() {
                        existing.value = value;
                    }
                }
                None => {
                    let mut cell = range_payload_cell(row, col, value);
                    cell.style_id =
                        positional_style_id_at(stores, cell_store, sheet_id, row, col, palette);
                    cells_by_pos.insert((row, col), cell);
                }
            }
        });
    }

    let sheet_uuid = sheet_id.to_uuid_string();
    for pivot in cell_store
        .all_pivot_tables()
        .iter()
        .filter(|pivot| pivot.sheet == sheet_uuid)
    {
        if pivot.is_empty_rendered_region() {
            continue;
        }

        let end_row = pivot
            .start_row
            .saturating_add(pivot.rendered_row_count())
            .saturating_sub(1);
        let end_col = pivot
            .start_col
            .saturating_add(pivot.rendered_col_count())
            .saturating_sub(1);

        for row in pivot.start_row..=end_row {
            for col in pivot.start_col..=end_col {
                let Some(value) = cell_store.get_cell_value_at(sheet_id, SheetPos::new(row, col))
                else {
                    continue;
                };
                if value.is_null() {
                    continue;
                }

                if let std::collections::hash_map::Entry::Vacant(entry) =
                    cells_by_pos.entry((row, col))
                {
                    entry.insert(range_payload_cell(row, col, value.clone()));
                }
            }
        }
    }

    let mut cells: Vec<CellData> = cells_by_pos.into_values().collect();
    // Sort by (row, col) to maintain deterministic output order
    cells.sort_by_key(|c| (c.row, c.col));

    profile.counter("cells", cells.len() as u64);
    cells
}
