use cell_types::{SheetId, SheetPos};
use domain_types::CellData;
use rustc_hash::FxHashMap;
use value_types::CellValue;

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

        // Live projections have no authored CellIds for their members. Export
        // their current values into vacant positions so growth/shrink recalc
        // results are represented without manufacturing blockers.
        sheet.visit_projected_values_for_export(|row, col, value| {
            if value.is_null() {
                return;
            }
            match cells_by_pos.entry((row, col)) {
                std::collections::hash_map::Entry::Vacant(entry) => {
                    let mut cell = range_payload_cell(row, col, value);
                    cell.style_id =
                        positional_style_id_at(stores, cell_store, sheet_id, row, col, palette);
                    entry.insert(cell);
                }
                std::collections::hash_map::Entry::Occupied(mut entry) => {
                    merge_live_projected_value(entry.get_mut(), value);
                }
            }
        });

        // Reattach imported child metadata after a live recalc. The cached
        // values themselves are stale at that point, but marker/style/formula
        // metadata remains semantically valid for the corresponding projected
        // positions. Current caches are copied verbatim for no-recalc export.
        for cache in sheet.imported_array_caches() {
            for cached in &cache.cells {
                let key = (cached.row, cached.col);
                if cache.values_current {
                    // A direct edit at a former spill position creates an
                    // authored cell. Its value and metadata are authoritative
                    // even if the import cache still exists in a deferred or
                    // manually-calculated engine.
                    if has_authored_cell_at(sheet, SheetPos::new(cached.row, cached.col)) {
                        continue;
                    }
                    match cells_by_pos.entry(key) {
                        std::collections::hash_map::Entry::Vacant(entry) => {
                            entry.insert(cached.clone());
                        }
                        std::collections::hash_map::Entry::Occupied(mut entry) => {
                            merge_current_imported_cache_metadata(entry.get_mut(), cached);
                        }
                    }
                    continue;
                }

                let position = SheetPos::new(cached.row, cached.col);
                // An authored cell at this position may be a genuine blocker
                // or an explicit user replacement. Never reattach imported
                // child metadata to it.
                if has_authored_cell_at(sheet, position) {
                    continue;
                }

                let owned_by_source =
                    cache_position_owned_by_source(cell_store, sheet_id, cache, position);
                if owned_by_source {
                    if let Some(existing) = cells_by_pos.get_mut(&key) {
                        merge_live_imported_cache_metadata(existing, cached);
                    } else if is_empty_imported_formula_marker(cached) {
                        // A live projection may legitimately produce an empty
                        // element. Retain its empty formula marker while using
                        // the current live value (never the stale cache value).
                        let mut marker = style_only_cell(cached);
                        marker.value = cell_store
                            .get_cell_value_at(sheet_id, position)
                            .cloned()
                            .unwrap_or(CellValue::Null);
                        marker.projection_role =
                            domain_types::ImportedCellProjectionRole::DynamicArraySpillTarget;
                        marker.formula_cache_provenance = cached.formula_cache_provenance.clone();
                        marker.cell_formula = cached.cell_formula.clone();
                        cells_by_pos.insert(key, marker);
                    } else if cached.style_id.is_some() {
                        // Plain cached children can also be empty in the live
                        // result. Keep their cell style even when there is no
                        // value to materialize; this emits a styled blank and
                        // does not recreate a formula or stale cache payload.
                        let mut styled = style_only_cell(cached);
                        styled.value = cell_store
                            .get_cell_value_at(sheet_id, position)
                            .cloned()
                            .unwrap_or(CellValue::Null);
                        cells_by_pos.insert(key, styled);
                    }
                } else if let Some(existing) = cells_by_pos.get_mut(&key) {
                    // The live projection shrank or was blocked. Preserve a
                    // child's formatting at its former position while
                    // discarding stale values, formula markers, and type
                    // metadata.
                    merge_former_imported_cache_style(existing, cached);
                } else if cached.style_id.is_some() {
                    // Emit a style-only blank for a former spill member. The
                    // sheet writer serializes a Null/Empty value as a
                    // self-closing styled cell, without creating a phantom
                    // formula or cached value.
                    cells_by_pos.insert(key, style_only_cell(cached));
                }
            }
        }
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

fn cache_position_owned_by_source(
    cell_store: &CellStore,
    sheet_id: &SheetId,
    cache: &crate::imported_array_cache::ImportedArrayCache,
    position: SheetPos,
) -> bool {
    cell_store
        .projection_registry
        .resolve(sheet_id, position.row(), position.col())
        .is_some_and(|(owner, _, _)| owner == cache.source_id)
}

fn has_authored_cell_at(sheet: &crate::cells::SheetStore, position: SheetPos) -> bool {
    let Some(cell_id) = sheet.cell_id_at(position) else {
        return false;
    };
    sheet
        .get_cell(&cell_id)
        // `cell_id_at` can resolve identity-only entries allocated for
        // comments, merges, or formula dependencies. They carry no authored
        // value and must not hide an imported spill cache. A virtual range
        // identity is authoritative only when it has a materialized entry.
        .is_some_and(|_| !sheet.is_ghost(&cell_id) || cell_id.is_virtual())
}

fn is_empty_imported_formula_marker(cell: &CellData) -> bool {
    cell.projection_role == domain_types::ImportedCellProjectionRole::DynamicArraySpillTarget
        && cell.formula.is_none()
        && cell.cell_formula.as_ref().is_some_and(|formula| {
            formula.t == ooxml_types::worksheet::CellFormulaType::Normal && formula.text.is_empty()
        })
}

fn merge_current_imported_cache_metadata(destination: &mut CellData, cached: &CellData) {
    // A format-only edit can allocate a ghost identity and therefore leave a
    // Null destination in the export map. The imported cache is authoritative
    // while it is current, so restore its value/provenance into that blank
    // destination while retaining any current formatting fields.
    if destination.formula.is_none() && destination.value.is_null() {
        destination.value = cached.value.clone();
        destination.rich_string = cached.rich_string.clone();
        destination.formula_result_type = cached.formula_result_type;
        destination.has_empty_cached_value = cached.has_empty_cached_value;
        destination.formula_cache_provenance = cached.formula_cache_provenance.clone();
        destination.vm = cached.vm;
        destination.imported_rich_error = cached.imported_rich_error;
        destination.date_lexical_value = cached.date_lexical_value.clone();
        destination.original_sst_index = cached.original_sst_index;
        destination.original_value = cached.original_value.clone();
    }
    if destination.style_id.is_none() {
        destination.style_id = cached.style_id;
    }
    if destination.cell_metadata_index.is_none() {
        destination.cell_metadata_index = cached.cell_metadata_index;
    }
    destination.phonetic |= cached.phonetic;
    if is_empty_imported_formula_marker(cached) {
        destination.cell_formula = cached.cell_formula.clone();
        destination.formula_cache_provenance = cached.formula_cache_provenance.clone();
        destination.projection_role =
            domain_types::ImportedCellProjectionRole::DynamicArraySpillTarget;
    }
}

fn merge_live_projected_value(destination: &mut CellData, value: CellValue) {
    // A formatting-only entry can occupy a spill position with a Null value.
    // Keep its current style/metadata while replacing the old imported cache
    // payload with the live projection result. Clear package cache typing so a
    // rich/string child cannot be exported as stale text after recalc.
    if destination.formula.is_some() || !destination.value.is_null() {
        return;
    }
    destination.value = value;
    destination.rich_string = None;
    destination.formula_result_type = None;
    destination.has_empty_cached_value = false;
    destination.formula_cache_provenance = Default::default();
    destination.vm = None;
    destination.imported_rich_error = None;
    destination.date_lexical_value = None;
    destination.original_sst_index = None;
    destination.original_value = None;
}

fn merge_live_imported_cache_metadata(destination: &mut CellData, cached: &CellData) {
    // The durable cache is stale after a live calculation. Carry only
    // metadata that remains valid for the source-owned position; the live
    // projection value/type/rich cache must remain authoritative.
    if destination.style_id.is_none() {
        destination.style_id = cached.style_id;
    }
    if destination.cell_metadata_index.is_none() {
        destination.cell_metadata_index = cached.cell_metadata_index;
    }
    destination.phonetic |= cached.phonetic;
    if is_empty_imported_formula_marker(cached) {
        destination.cell_formula = cached.cell_formula.clone();
        destination.formula_cache_provenance = cached.formula_cache_provenance.clone();
        destination.projection_role =
            domain_types::ImportedCellProjectionRole::DynamicArraySpillTarget;
    }
}

fn merge_former_imported_cache_style(destination: &mut CellData, cached: &CellData) {
    if destination.style_id.is_none() {
        destination.style_id = cached.style_id;
    }
}

fn style_only_cell(cached: &CellData) -> CellData {
    CellData {
        row: cached.row,
        col: cached.col,
        style_id: cached.style_id,
        ..Default::default()
    }
}
