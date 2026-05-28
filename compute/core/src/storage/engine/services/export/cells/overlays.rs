use cell_types::{SheetId, SheetPos};
use domain_types::CellData;
use rustc_hash::{FxHashMap, FxHashSet};

use crate::mirror::CellMirror;
use crate::storage::engine::stores::EngineStores;

use super::super::PaletteOps;
use super::materialize::{
    build_cell_data_for_cell_id, explicit_blank_cell, is_imported_style_only_blank_cell,
    is_plain_blank_cell, range_payload_cell,
};
use super::style_ids::format_range_style_id_at;
use super::yrs_reads::batch_read_props_array_refs_and_formula_metadata;

pub(in crate::storage::engine) fn export_cells_for_sheet(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    palette: &impl PaletteOps,
) -> Vec<CellData> {
    let mut profile = crate::xlsx_profile::PhaseTimer::new("export", "export_cells_for_sheet");

    // Batch-read all cell properties and formula metadata in a single Yrs
    // transaction, avoiding duplicate transaction setup overhead.
    // Uses CellId keys to eliminate per-cell id_to_hex() String allocations.
    let (all_props, array_refs, formula_metadata, rich_strings) =
        batch_read_props_array_refs_and_formula_metadata(stores, sheet_id);

    // Build a reverse map: cell_id → (row, col) from grid_indexes.
    let grid = stores.grid_indexes.get(sheet_id);
    let sheet_mirror = mirror.get_sheet(sheet_id);
    let mut cells_by_pos: FxHashMap<(u32, u32), CellData> = FxHashMap::default();
    let mut range_override_positions: FxHashSet<(u32, u32)> = FxHashSet::default();

    if let Some(sheet) = sheet_mirror {
        for (_, range) in sheet.ranges_sorted_by_id() {
            for &(row_id, col_id) in range.overrides.keys() {
                let Some(row) = sheet.row_index_of(&row_id) else {
                    continue;
                };
                let Some(col) = sheet.col_index_of(&col_id) else {
                    continue;
                };
                range_override_positions.insert((row, col));
            }
        }
    }

    // Iterate all cells registered in the grid index.
    if let Some(grid) = grid {
        profile.counter("grid_cells", grid.cells().count() as u64);
        for (cell_id, row, col) in grid.cells() {
            if let Some(mut cell) = build_cell_data_for_cell_id(
                stores,
                mirror,
                sheet_id,
                &cell_id,
                row,
                col,
                &all_props,
                &array_refs,
                &formula_metadata,
                &rich_strings,
                palette,
                false,
            ) {
                if cell.style_id.is_none()
                    && let Some(sheet) = sheet_mirror
                {
                    cell.style_id = format_range_style_id_at(sheet, row, col, palette);
                }
                cells_by_pos.insert((row, col), cell);
            }
        }
    }

    if let Some(sheet) = sheet_mirror {
        sheet.visit_range_values_for_export(|row, col, value| {
            if value.is_null() || range_override_positions.contains(&(row, col)) {
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
                    cell.style_id = format_range_style_id_at(sheet, row, col, palette);
                    cells_by_pos.insert((row, col), cell);
                }
            }
        });

        // Match the dense-column overlay contract: RangeView overrides win over
        // payload values and explicit sparse cells. Sorting makes overlapping
        // range override conflicts deterministic, with higher RangeId winning.
        for (_, range) in sheet.ranges_sorted_by_id() {
            let mut overrides: Vec<_> = range.overrides.iter().collect();
            overrides.sort_by_key(|((row_id, col_id), _)| {
                (
                    sheet.row_index_of(row_id).unwrap_or(u32::MAX),
                    sheet.col_index_of(col_id).unwrap_or(u32::MAX),
                )
            });
            for (&(row_id, col_id), cell_id) in overrides {
                let Some(row) = sheet.row_index_of(&row_id) else {
                    continue;
                };
                let Some(col) = sheet.col_index_of(&col_id) else {
                    continue;
                };
                let replacement_from_cell = build_cell_data_for_cell_id(
                    stores,
                    mirror,
                    sheet_id,
                    cell_id,
                    row,
                    col,
                    &all_props,
                    &array_refs,
                    &formula_metadata,
                    &rich_strings,
                    palette,
                    true,
                );
                let is_synthetic_placeholder = replacement_from_cell.is_none();
                let mut replacement =
                    replacement_from_cell.unwrap_or_else(|| explicit_blank_cell(row, col));
                let replaces_existing_payload = cells_by_pos.contains_key(&(row, col));
                if !replaces_existing_payload
                    && ((is_synthetic_placeholder && is_plain_blank_cell(&replacement))
                        || is_imported_style_only_blank_cell(&replacement))
                {
                    continue;
                }
                if replacement.style_id.is_none() {
                    replacement.style_id = format_range_style_id_at(sheet, row, col, palette);
                }

                if cells_by_pos.get(&(row, col)).is_some_and(|existing| {
                    existing.formula.is_some() && replacement.formula.is_none()
                }) {
                    continue;
                }
                cells_by_pos.insert((row, col), replacement);
            }
        }
    }

    let sheet_uuid = sheet_id.to_uuid_string();
    for pivot in mirror
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
                let Some(value) = mirror.get_cell_value_at(sheet_id, SheetPos::new(row, col))
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
