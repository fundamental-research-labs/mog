use super::*;

// ---------------------------------------------------------------------------
// Import specific sheets from XLSX
// ---------------------------------------------------------------------------

/// Import specific sheets from an XLSX byte buffer into an existing engine.
///
/// Parses the XLSX, filters by `sheet_names` (case-insensitive), merges the
/// style palette, hydrates each matched sheet into the Yrs document, syncs
pub(in crate::storage::engine) fn import_sheets_from_xlsx(
    engine: &mut YrsComputeEngine,
    xlsx_data: &[u8],
    sheet_names: &[String],
    insert_position: Option<u32>,
) -> Result<Vec<String>, ComputeError> {
    use crate::storage::infra::hydration::{
        self, DefaultIdAllocator, merge_style_palette_incremental, remap_sheet_style_ids,
    };
    use crate::storage::sheet::{order, properties};

    // 1. Parse the XLSX
    let parsed = xlsx_api::parse(xlsx_data).map_err(|e| ComputeError::Deserialize {
        message: format!("XLSX parse error: {}", e),
    })?;
    let parse_output = parsed.output;

    // 2. Filter sheets by name (case-insensitive)
    let wanted: std::collections::HashSet<String> =
        sheet_names.iter().map(|n| n.to_lowercase()).collect();
    let matched_sheets: Vec<(usize, &domain_types::SheetData)> = parse_output
        .sheets
        .iter()
        .enumerate()
        .filter(|(_, s)| wanted.contains(&s.name.to_lowercase()))
        .collect();

    if matched_sheets.is_empty() {
        return Err(ComputeError::Eval {
            message: format!(
                "import_sheets_from_xlsx: none of the requested sheets {:?} found in XLSX",
                sheet_names
            ),
        });
    }

    // 3. Seed a new allocator past the engine's current high-water mark
    //    so that new IDs don't collide with existing ones.
    let seed = engine.stores.grid_id_alloc.high_water_mark();
    let mut allocator = DefaultIdAllocator::with_seed(seed);

    // 4. Merge style palette + hydrate sheets inside a transaction
    //    Collect the results we need for index building.
    struct HydratedSheet {
        sheet_id: SheetId,
        cell_ids: Vec<CellId>,
        phantom_cells: Vec<(CellId, u32, u32)>,
        name: String,
        rows: u32,
        cols: u32,
        /// Cells for building the ComputeCore snapshot
        cells_data: Vec<domain_types::CellData>,
    }

    // Gather existing sheet names BEFORE opening the write transaction,
    // because get_sheet_name / sheet_order open their own read transactions
    // and Yrs does not allow nested txn on the same Doc.
    let existing_order = engine.stores.storage.sheet_order();
    let existing_names: std::collections::HashSet<String> = existing_order
        .iter()
        .filter_map(|sid| {
            properties::get_sheet_name(
                engine.stores.storage.doc(),
                engine.stores.storage.sheets(),
                sid,
            )
            .map(|n| n.to_lowercase())
        })
        .collect();

    let hydrated_sheets: Vec<HydratedSheet> = {
        let mut txn = engine.stores.storage.doc().transact_mut();
        let workbook = engine.stores.storage.workbook_map().clone();
        let sheets_map = engine.stores.storage.sheets().clone();
        // lazy-create — see `YrsStorage::new` doc.
        let order_arr = engine.stores.storage.ensure_sheet_order_array(&mut txn);

        // 4a. Merge style palettes
        let style_remap =
            merge_style_palette_incremental(&mut txn, &workbook, &parse_output.style_palette);

        // 4b. Resolve unique sheet names, hydrate each sheet
        let mut used_names = existing_names;
        let mut results = Vec::with_capacity(matched_sheets.len());

        for (_src_idx, sheet_data) in &matched_sheets {
            // Clone and remap style IDs
            let mut sheet = (*sheet_data).clone();
            remap_sheet_style_ids(&mut sheet, &style_remap);

            // Deduplicate name
            let base_name = &sheet.name;
            let unique_name = if used_names.contains(&base_name.to_lowercase()) {
                let mut n = 2u32;
                loop {
                    let candidate = format!("{} ({})", base_name, n);
                    if !used_names.contains(&candidate.to_lowercase()) {
                        break candidate;
                    }
                    n += 1;
                }
            } else {
                base_name.clone()
            };
            used_names.insert(unique_name.to_lowercase());
            sheet.name = unique_name;

            let cells_data = sheet.cells.clone();

            // Hydrate into Yrs
            let (sheet_id, cell_ids, phantom_cells, _identity_only_cells, _row_ids, _col_ids) =
                hydration::hydrate_sheet(
                    &mut txn,
                    &sheets_map,
                    &order_arr,
                    &sheet,
                    &parse_output.style_palette,
                    &parse_output.persons,
                    &mut allocator,
                )?;

            results.push(HydratedSheet {
                sheet_id,
                cell_ids,
                phantom_cells,
                name: sheet.name.clone(),
                rows: sheet.rows,
                cols: sheet.cols,
                cells_data,
            });
        }

        results
    }; // txn drops here, committing all Yrs changes

    // 5. Sync indexes and ComputeCore for each hydrated sheet
    for hs in &hydrated_sheets {
        // 5a. GridIndex (reads row/col order arrays from committed Yrs data)
        let snap_for_grid = crate::snapshot::SheetSnapshot {
            id: hs.sheet_id.to_uuid_string(),
            name: hs.name.clone(),
            rows: hs.rows,
            cols: hs.cols,
            cells: vec![],
            ranges: vec![],
        };
        let mut grid = crate::storage::engine::build_grid_from_yrs_for_sheet(
            &engine.stores.storage,
            hs.sheet_id,
            &snap_for_grid,
            engine.stores.grid_id_alloc.clone(),
        );

        // Register all cell positions in the grid.
        // cell_ids from hydrate_sheet are in the same order as SheetData.cells.
        for (idx, cell_id) in hs.cell_ids.iter().enumerate() {
            if idx < hs.cells_data.len() {
                let cd = &hs.cells_data[idx];
                grid.register_cell(*cell_id, cd.row, cd.col);
            }
        }
        // Register phantom cells
        for (cell_id, row, col) in &hs.phantom_cells {
            grid.register_cell(*cell_id, *row, *col);
        }
        engine.stores.grid_indexes.insert(hs.sheet_id, grid);

        // 5b. MergeIndex
        let resolved = match engine.stores.grid_indexes.get(&hs.sheet_id) {
            Some(grid) => merges::get_all_merges(
                engine.stores.storage.doc(),
                engine.stores.storage.sheets(),
                hs.sheet_id,
                grid,
            ),
            None => Vec::new(),
        };
        let items: Vec<MergeSpatialItem> = resolved
            .iter()
            .map(|m| MergeSpatialItem {
                id: m.merge.top_left_id.clone(),
                start_row: m.start_row,
                start_col: m.start_col,
                end_row: m.end_row,
                end_col: m.end_col,
                range_ref: MergeRangeRef {
                    start_row: m.start_row,
                    start_col: m.start_col,
                    end_row: m.end_row,
                    end_col: m.end_col,
                },
            })
            .collect();
        engine
            .stores
            .merge_indexes
            .insert(hs.sheet_id, RangeSpatialIndex::with_items(items));

        // 5c. LayoutIndex
        let layout = build_layout_index_for_sheet(
            &engine.stores.storage,
            &hs.sheet_id,
            hs.rows,
            hs.cols,
            engine.stores.grid_indexes.get(&hs.sheet_id),
        );
        engine.stores.layout_indexes.insert(hs.sheet_id, layout);

        // 5d. ComputeCore — build SheetSnapshot and add
        let snap_cells: Vec<crate::snapshot::CellData> = hs
            .cells_data
            .iter()
            .enumerate()
            .filter_map(|(cell_idx, cell)| {
                // Skip only parser-proven dynamic array spill targets.
                if cell.projection_role == ImportedCellProjectionRole::DynamicArraySpillTarget {
                    return None;
                }
                if cell_idx >= hs.cell_ids.len() {
                    return None;
                }
                let cell_uuid = format!("{:032x}", hs.cell_ids[cell_idx].as_u128());
                Some(crate::snapshot::CellData {
                    cell_id: cell_uuid,
                    row: cell.row,
                    col: cell.col,
                    value: cell.value.clone(),
                    formula: cell.formula.clone(),
                    identity_formula: None,
                    array_ref: cell.array_ref.clone(),
                })
            })
            .collect();

        let sheet_snap = crate::snapshot::SheetSnapshot {
            id: hs.sheet_id.to_uuid_string(),
            name: hs.name.clone(),
            rows: hs.rows,
            cols: hs.cols,
            cells: snap_cells,
            ranges: vec![],
        };
        engine
            .stores
            .compute
            .add_sheet(&mut engine.mirror, sheet_snap)?;
    }

    // 6. Reorder sheets to place imported ones at insert_position
    if let Some(pos) = insert_position {
        let order = engine.stores.storage.sheet_order();
        let new_ids: std::collections::HashSet<u128> = hydrated_sheets
            .iter()
            .map(|hs| hs.sheet_id.as_u128())
            .collect();

        // Remove the newly added sheets from wherever they ended up (at the end)
        let mut existing: Vec<SheetId> = order
            .iter()
            .filter(|sid| !new_ids.contains(&sid.as_u128()))
            .copied()
            .collect();
        let new_sheets: Vec<SheetId> = order
            .iter()
            .filter(|sid| new_ids.contains(&sid.as_u128()))
            .copied()
            .collect();

        // Insert at the requested position
        let insert_at = (pos as usize).min(existing.len());
        for (i, sid) in new_sheets.into_iter().enumerate() {
            existing.insert(insert_at + i, sid);
        }

        order::reorder_sheets(
            engine.stores.storage.doc(),
            engine.stores.storage.workbook_map(),
            &existing,
        )?;
    }

    // 7. Refresh CF caches for new sheets
    for hs in &hydrated_sheets {
        engine.refresh_cf_cache(&hs.sheet_id);
    }

    // 8. Return inserted sheet names
    let inserted_names: Vec<String> = hydrated_sheets.iter().map(|hs| hs.name.clone()).collect();
    Ok(inserted_names)
}
