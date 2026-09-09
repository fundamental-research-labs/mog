use super::*;
use crate::storage::engine::history;

// ---------------------------------------------------------------------------
// Import specific sheets from XLSX
// ---------------------------------------------------------------------------

/// Import specific sheets from an XLSX byte buffer into an existing engine.
///
/// Parses the XLSX, filters by `sheet_names` (case-insensitive), merges the
/// style palette, and installs each matched sheet and its authored table catalog.
pub(in crate::storage::engine) fn import_sheets_from_xlsx(
    engine: &mut ComputeEngine,
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
    let mut parse_output = parsed.output;
    let wanted: std::collections::HashSet<String> =
        sheet_names.iter().map(|n| n.to_lowercase()).collect();
    if !parse_output
        .sheets
        .iter()
        .any(|sheet| wanted.contains(&sheet.name.to_lowercase()))
    {
        return Err(ComputeError::Eval {
            message: format!(
                "import_sheets_from_xlsx: none of the requested sheets {:?} found in XLSX",
                sheet_names
            ),
        });
    }
    // Imported threads retain person identity without replacing existing authors.
    history::metadata::capture_workbook_field!(engine.stores.storage, persons);
    history::metadata::capture_workbook_field!(engine.stores.storage, has_persons_part);
    let mut person_ids = std::collections::HashMap::new();
    for person in &mut parse_output.persons {
        if let Some(existing) = engine
            .stores
            .storage
            .metadata
            .persons
            .iter()
            .find(|existing| existing.id.eq_ignore_ascii_case(&person.id))
        {
            if existing == person {
                continue;
            }
            let old = person.id.clone();
            person.id = engine.stores.next_id_uuid_string();
            person_ids.insert(old, person.id.clone());
        }
        engine.stores.storage.metadata.persons.push(person.clone());
    }
    engine.stores.storage.metadata.has_persons_part |= parse_output.has_persons_part;
    for sheet in &mut parse_output.sheets {
        for comment in &mut sheet.comments {
            if let Some(person) = &mut comment.person_id {
                if let Some(new) = person_ids.get(person) {
                    *person = new.clone();
                }
            }
        }
    }

    // 2. Filter sheets by name (case-insensitive)
    let matched_sheets: Vec<(usize, &domain_types::SheetData)> = parse_output
        .sheets
        .iter()
        .enumerate()
        .filter(|(_, s)| wanted.contains(&s.name.to_lowercase()))
        .collect();

    // 3. Seed a new allocator past the engine's current high-water mark
    //    so that new IDs don't collide with existing ones.
    let mut allocator = DefaultIdAllocator::with_shared(engine.stores.grid_id_alloc.clone());

    // 4. Merge style palettes and collect hydrated sheets for index building.
    struct HydratedSheet {
        tables: Vec<domain_types::domain::table::TableCatalogEntry>,
        formats: crate::storage::properties::ImportedFormats,
        metadata: crate::storage::sheet::SheetMetadata,
        sheet_id: SheetId,
        cell_ids: Vec<CellId>,
        identities: Vec<(CellId, u32, u32)>,
        row_axis: AxisIdentityStore<RowId>,
        col_axis: AxisIdentityStore<ColId>,
        name: String,
        rows: u32,
        cols: u32,
        /// Cells for building the ComputeCore snapshot
        cells_data: Vec<domain_types::CellData>,
    }

    // Match incoming sheets against existing native names.
    let existing_order = engine.stores.storage.sheet_order();
    let existing_names: std::collections::HashSet<String> = existing_order
        .iter()
        .filter_map(|sid| {
            properties::get_sheet_name(&engine.stores.storage, sid).map(|n| n.to_lowercase())
        })
        .collect();

    let existing_table_names: std::collections::HashSet<String> = engine
        .mirror
        .all_tables()
        .iter()
        .map(|table| table.name.to_ascii_lowercase())
        .collect();
    let mut reserved_table_names = existing_table_names.clone();
    reserved_table_names.extend(matched_sheets.iter().flat_map(|(_, sheet)| {
        sheet
            .tables
            .iter()
            .map(|table| table.name.to_ascii_lowercase())
    }));
    let mut imported_table_names = existing_table_names;
    let mut table_renames = Vec::new();
    let mut hydrated_sheets: Vec<HydratedSheet> = {
        // 4a. Merge style palettes
        history::metadata::capture_style_palette_append(&engine.stores.storage);
        let style_remap = merge_style_palette_incremental(
            &mut engine.stores.storage.metadata,
            &parse_output.style_palette,
        );

        let existing_styles: std::collections::HashSet<_> =
            if engine.stores.storage.history.is_active() {
                engine
                    .stores
                    .storage
                    .metadata
                    .custom_table_styles
                    .keys()
                    .cloned()
                    .collect()
            } else {
                Default::default()
            };
        let table_style_remap = hydration::merge_custom_table_styles_from_ooxml(
            &mut engine.stores.storage.metadata,
            &parse_output.custom_table_styles,
            &parse_output.workbook_stylesheet,
            &parse_output.theme,
        );
        if engine.stores.storage.history.is_active() {
            for id in engine.stores.storage.metadata.custom_table_styles.keys() {
                if !existing_styles.contains(id) {
                    history::metadata::capture_created_custom_table_style(
                        &engine.stores.storage,
                        id,
                    );
                }
            }
        }

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

            for table in &mut sheet.tables {
                if let Some(name) = table
                    .style_name
                    .as_ref()
                    .and_then(|name| table_style_remap.get(&name.to_ascii_lowercase()))
                {
                    table.style_name = Some(name.clone());
                }
                if imported_table_names.contains(&table.name.to_ascii_lowercase()) {
                    let old_name = table.name.clone();
                    let mut suffix = 2u32;
                    let name = loop {
                        let ending = format!("_{suffix}");
                        let base: String = old_name
                            .chars()
                            .take(255usize.saturating_sub(ending.len()))
                            .collect();
                        let candidate = format!("{base}{ending}");
                        if reserved_table_names.insert(candidate.to_ascii_lowercase()) {
                            break candidate;
                        }
                        suffix += 1;
                    };
                    table.name = name.clone();
                    table.display_name = name.clone();
                    table_renames.push((old_name, name));
                }
                imported_table_names.insert(table.name.to_ascii_lowercase());
            }
            let cells_data = sheet.cells.clone();

            // Hydrate native sheet metadata
            let (
                sheet_id,
                cell_ids,
                identities,
                row_axis,
                col_axis,
                native_merges,
                native_auto_filter,
                native_hyperlinks,
                native_comments,
                native_floating_objects,
            ) = hydration::hydrate_sheet(
                &mut engine.stores.storage.cell_metadata,
                &sheet,
                &parse_output.persons,
                &mut allocator,
            )?;

            history::structure::capture_new_sheet(&engine.stores.storage, sheet_id);

            let cell_properties =
                hydration::hydrate_cell_styles(&sheet.cells, &cell_ids, &Default::default());
            let (_, tables) = hydration::hydrate_workbook_tables(
                &sheet
                    .tables
                    .iter()
                    .cloned()
                    .map(|table| (table, sheet_id.to_uuid_string()))
                    .collect::<Vec<_>>(),
                &mut allocator,
            );
            results.push(HydratedSheet {
                tables,
                formats: crate::storage::properties::ImportedFormats::from_sheet(
                    &sheet,
                    &[],
                    &crate::storage::STORAGE_ID_ALLOC,
                ),
                metadata: {
                    let mut metadata = crate::storage::sheet::SheetMetadata::from_import(
                        &sheet,
                        sheet_id,
                        &row_axis,
                        &col_axis,
                        native_merges,
                        native_auto_filter,
                    );
                    metadata.hyperlinks = native_hyperlinks;
                    metadata.comments = native_comments;
                    metadata.floating_objects = native_floating_objects;
                    metadata.cell_properties = cell_properties;
                    metadata
                },
                sheet_id,
                row_axis,
                col_axis,
                cell_ids,
                identities,
                name: sheet.name.clone(),
                rows: sheet.rows,
                cols: sheet.cols,
                cells_data,
            });
        }

        results
    };

    let rewrite_tables = |source: &str| {
        table_renames
            .iter()
            .fold(source.to_owned(), |text, (old, new)| {
                crate::storage::cells::structured_ref_updater::TableReferenceEdit::RenameTable {
                    old,
                    new,
                }
                .rewrite(&text, None)
            })
    };
    // Install all imported tables before registering any imported formula.
    for sheet in &mut hydrated_sheets {
        for cell in &mut sheet.cells_data {
            if let Some(formula) = &mut cell.formula {
                *formula = rewrite_tables(formula);
            }
        }
        for table in &mut sheet.tables {
            for column in &mut table.columns {
                for formula in [
                    &mut column.calculated_formula,
                    &mut column.totals_row_formula,
                ]
                .into_iter()
                .flatten()
                {
                    *formula = rewrite_tables(formula);
                }
            }
            engine
                .stores
                .compute
                .set_table(&mut engine.mirror, table.clone());
        }
    }

    // 5. Build native indexes and ComputeCore for each hydrated sheet
    history::metadata::capture_workbook_field!(engine.stores.storage, sheet_order);
    for hs in &hydrated_sheets {
        engine.stores.storage.metadata.sheet_order.push(hs.sheet_id);
        engine
            .stores
            .storage
            .sheet_metadata
            .insert(hs.sheet_id, hs.metadata.clone());
        // Build the grid from the imported compact axis identities.
        let snap_for_grid = crate::snapshot::SheetSnapshot {
            identities: hs
                .identities
                .iter()
                .map(|(cell_id, row, col)| snapshot_types::CellIdentityPosition {
                    cell_id: *cell_id,
                    row: *row,
                    col: *col,
                })
                .collect(),
            row_axis: Some(hs.row_axis.clone()),
            col_axis: Some(hs.col_axis.clone()),
            id: hs.sheet_id.to_uuid_string(),
            name: hs.name.clone(),
            rows: hs.rows,
            cols: hs.cols,
            cells: vec![],
            ranges: vec![],
        };
        let mut grid = crate::storage::engine::build_grid_from_native_sheet(
            &engine.mirror,
            hs.sheet_id,
            &snap_for_grid,
            engine.stores.grid_id_alloc.clone(),
        )?;

        // Register all cell positions in the grid.
        // cell_ids from hydrate_sheet are in the same order as SheetData.cells.
        for (idx, cell_id) in hs.cell_ids.iter().enumerate() {
            if idx < hs.cells_data.len() {
                let cd = &hs.cells_data[idx];
                grid.register_cell(*cell_id, cd.row, cd.col);
            }
        }
        engine.stores.grid_indexes.insert(hs.sheet_id, grid);

        // 5b. MergeIndex
        let resolved = match engine.stores.grid_indexes.get(&hs.sheet_id) {
            Some(grid) => merges::get_all_merges(&engine.stores.storage, hs.sheet_id, grid),
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
            engine.stores.layout_metrics,
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
            identities: hs
                .identities
                .iter()
                .map(|(cell_id, row, col)| snapshot_types::CellIdentityPosition {
                    cell_id: *cell_id,
                    row: *row,
                    col: *col,
                })
                .collect(),
            row_axis: Some(hs.row_axis.clone()),
            col_axis: Some(hs.col_axis.clone()),
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
        if let Some(grid) = engine.stores.grid_indexes.get(&hs.sheet_id) {
            engine
                .mirror
                .install_sheet_axes(hs.sheet_id, grid.row_axis(), grid.col_axis());
        }
        if let Some(sheet) = engine.mirror.get_sheet_mut(&hs.sheet_id) {
            hs.formats
                .install(sheet, &engine.stores.storage.metadata.style_palette);
        }
    }

    engine
        .stores
        .compute
        .structure_change_with_formula_refresh(&mut engine.mirror, None, &[])?;
    materialize_table_auto_filters_for_sheets(
        &mut engine.stores,
        &mut engine.mirror,
        &hydrated_sheets
            .iter()
            .map(|sheet| sheet.sheet_id)
            .collect::<Vec<_>>(),
    );
    for sheet in &hydrated_sheets {
        crate::storage::engine::services::imported_filters::normalize_imported_auto_filter_visibility_for_sheet(
            &mut engine.stores, &mut engine.mirror, &sheet.sheet_id, None, domain_types::ImportPhase::FullHydration,
        );
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

        order::reorder_sheets(&mut engine.stores.storage, &existing)?;
    }

    // 7. Refresh CF caches for new sheets
    for hs in &hydrated_sheets {
        engine.refresh_cf_cache(&hs.sheet_id);
    }

    // 8. Return inserted sheet names
    let inserted_names: Vec<String> = hydrated_sheets.iter().map(|hs| hs.name.clone()).collect();
    Ok(inserted_names)
}
