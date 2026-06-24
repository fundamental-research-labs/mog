use super::*;

pub(in crate::storage::engine) fn build_sheet_snapshot(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    name: &str,
) -> SheetSnapshot {
    let (rows, cols) = stores
        .grid_indexes
        .get(sheet_id)
        .map(|g| (g.row_count(), g.col_count()))
        .unwrap_or((100, 26));

    let mut cells = Vec::new();
    if let Some(sheet) = mirror.get_sheet(sheet_id) {
        for (cell_id, entry) in sheet.cells_iter() {
            if let Some(pos) = mirror.resolve_position(cell_id) {
                let formula = stores.compute.get_formula(cell_id).map(|s| s.to_string());

                // Reconstruct array_ref from the projection registry so that
                // rebuild_compute_core() preserves dynamic array metadata.
                // Without this, projections are not pre-registered on the
                // second full_recalc, causing false #SPILL! errors.
                let array_ref = mirror.projection_registry.get(cell_id).map(|proj| {
                    let end_row = proj.origin_row + proj.rows - 1;
                    let end_col = proj.origin_col + proj.cols - 1;
                    let start =
                        crate::storage::engine::export::pos_to_a1(proj.origin_row, proj.origin_col);
                    let end = crate::storage::engine::export::pos_to_a1(end_row, end_col);
                    format!("{start}:{end}")
                });

                cells.push(crate::snapshot::CellData {
                    cell_id: cell_id.to_uuid_string(),
                    row: pos.row(),
                    col: pos.col(),
                    value: entry.value.clone(),
                    formula,
                    identity_formula: entry.formula.as_deref().cloned(),
                    array_ref,
                });
            }
        }
    }

    let mut ranges = Vec::new();
    if let Some(sheet) = mirror.get_sheet(sheet_id) {
        for (_, rv) in sheet.iter_ranges() {
            let row_ids: Vec<cell_types::RowId> = {
                let mut pairs: Vec<_> = rv
                    .row_offset_by_id
                    .iter()
                    .map(|(&id, &off)| (off, id))
                    .collect();
                pairs.sort_by_key(|(off, _)| *off);
                pairs.into_iter().map(|(_, id)| id).collect()
            };
            let col_ids: Vec<cell_types::ColId> = {
                let mut pairs: Vec<_> = rv
                    .col_offset_by_id
                    .iter()
                    .map(|(&id, &off)| (off, id))
                    .collect();
                pairs.sort_by_key(|(off, _)| *off);
                pairs.into_iter().map(|(_, id)| id).collect()
            };
            ranges.push(crate::snapshot::RangeData {
                range_id: rv.range_id,
                kind: rv.kind,
                anchor: rv.anchor.clone(),
                encoding: rv.encoding,
                payload: rv.payload.to_vec(),
                row_axis: None,
                col_axis: None,
                row_ids,
                col_ids,
            });
        }
    }

    SheetSnapshot {
        id: sheet_id.to_uuid_string(),
        name: name.to_string(),
        rows,
        cols,
        cells,
        ranges,
    }
}

/// Build a complete `WorkbookSnapshot` from the engine's internal state.
///
/// Reads cell data from the `CellMirror` (via `build_sheet_snapshot`),
/// named ranges from `YrsStorage` (the CRDT source of truth), and
/// tables/pivot tables from the `CellMirror` metadata, and data table regions
/// from the canonical workbook-level Yrs map.
///
/// This MUST be called before replacing `ComputeCore`, since
/// `build_sheet_snapshot` reads formula strings from `ComputeCore`.
pub(in crate::storage::engine) fn build_workbook_snapshot(
    stores: &EngineStores,
    mirror: &CellMirror,
) -> WorkbookSnapshot {
    use crate::storage::sheet::properties;
    // 1. Build sheet snapshots
    let sheet_ids = stores.storage.sheet_order();
    let sheet_snapshots: Vec<SheetSnapshot> = sheet_ids
        .iter()
        .filter_map(|sheet_id| {
            let name = properties::get_sheet_name(
                stores.storage.doc(),
                stores.storage.sheets(),
                sheet_id,
            )?;
            Some(build_sheet_snapshot(stores, mirror, sheet_id, &name))
        })
        .collect();

    // 2. Named ranges from YrsStorage (survives ComputeCore rebuild)
    //
    // Typed formula boundary: canonicalized the Yrs `refers_to` field to a single
    // on-disk format: `serde_json::to_string(&IdentityFormula)`. The prior
    // dual-decoder (try JSON, fall back to raw A1) is deleted; JSON parse
    // failure is now an error rather than a silent wrong-semantics fallback.
    // The hydration path's initial A1 writes are canonicalized by
    // `normalize_named_range_refs` before any reader runs, and both engine
    // write APIs (`set_named_range`, `regenerate_named_range_yrs_refs`) now
    // emit JSON directly.
    let defined_names = workbook_named_ranges::get_all_named_ranges(
        stores.storage.doc(),
        stores.storage.workbook_map(),
    );
    let nil_sheet = SheetId::from_raw(0);
    let named_ranges_vec = defined_names_to_named_range_defs(defined_names, |identity| {
        stores
            .compute
            .to_a1_display_qualified(mirror, &nil_sheet, identity)
    });

    // 3. Tables, pivot tables, data table regions from mirror (before rebuild)
    let tables = mirror.all_table_defs().to_vec();
    let pivot_tables = mirror.all_pivot_tables().to_vec();
    let data_table_regions = crate::storage::workbook::data_tables::get_all_data_table_regions(
        stores.storage.doc(),
        stores.storage.workbook_map(),
    );

    // 4. Iterative calc settings
    let iterative_calc = stores.compute.iterative_calc();
    let max_iterations = stores.compute.max_iterations();
    let max_change = stores.compute.max_change();
    // The internal scheduler stores `max_change` as bare f64; the boundary
    // type pins it to `FiniteF64`. Convergence threshold values originate
    // from snapshots that were already finite-typed, so non-finite here
    // would only be possible via direct setter abuse — fall back to the
    // Excel default rather than panicking on extraction.
    let max_change = value_types::FiniteF64::new(max_change)
        .unwrap_or_else(|| value_types::FiniteF64::must(0.001));
    let mut calculation_settings = workbook_settings::get_calculation_settings(
        stores.storage.doc(),
        stores.storage.workbook_map(),
    );
    calculation_settings.enable_iterative_calculation = iterative_calc;
    calculation_settings.max_iterations = max_iterations;
    calculation_settings.max_change = max_change;
    calculation_settings.calc_mode = stores.compute.calc_mode();

    WorkbookSnapshot {
        sheets: sheet_snapshots,
        named_ranges: named_ranges_vec,
        tables,
        pivot_tables,
        data_table_regions,
        iterative_calc,
        max_iterations,
        max_change,
        calculation_settings: Some(calculation_settings),
    }
}

// ---------------------------------------------------------------------------
// Per-sheet snapshot from yrs (for structural undo rebuild)
// ---------------------------------------------------------------------------

/// Build a `SheetSnapshot` for a single sheet by reading directly from yrs.
///
/// Used during structural undo/redo/sync when the in-memory GridIndex and
/// CellMirror are stale. Reads cell positions from the yrs grid index
/// (`idToPos`) and cell data from the yrs cells map. The yrs grid index
/// is never modified by structural operations, so after undo it naturally
/// contains the correct pre-structural positions.
pub(in crate::storage::engine) fn build_sheet_snapshot_from_yrs(
    storage: &YrsStorage,
    sheet_id: &SheetId,
) -> Result<Option<SheetSnapshot>, ComputeError> {
    use crate::storage::sheet::properties;
    use compute_document::hex::hex_to_id;
    use compute_document::schema::KEY_GRID_INDEX;

    let Some(name) = properties::get_sheet_name(storage.doc(), storage.sheets(), sheet_id) else {
        return Ok(None);
    };
    let resolved_axes = super::resolve_sheet_axes_from_yrs(storage, *sheet_id)?;

    let (rows, cols) = resolved_axes
        .as_ref()
        .map_or((100, 26), |axes| (axes.row_count(), axes.col_count()));
    let axis_grid = resolved_axes.as_ref().map(|axes| {
        compute_document::identity::GridIndex::from_axis_stores(
            *sheet_id,
            axes.row_axis.clone(),
            axes.col_axis.clone(),
            Arc::new(IdAllocator::new()),
        )
    });

    // Walk `gridIndex/posToId` — the CRDT winner map for position ownership.
    // `idToPos` is only an inverse mirror and can contain losing CellIds after
    // concurrent empty-position writes. Hydrating from it would resurrect cells
    // that lost the position LWW race and make peers disagree based on YMap
    // iteration order.
    let mut cells = Vec::new();
    {
        let txn = storage.doc().transact();
        let sheet_hex = compute_document::hex::id_to_hex(sheet_id.as_u128());
        if let Some(yrs::Out::YMap(sheet_map)) = storage.sheets().get(&txn, &sheet_hex) {
            if let Some(yrs::Out::YMap(gi_map)) = sheet_map.get(&txn, KEY_GRID_INDEX)
                && let Some(yrs::Out::YMap(pos_to_id)) = gi_map.get(&txn, "posToId")
            {
                for (pos_key, value) in pos_to_id.iter(&txn) {
                    let Some(colon) = pos_key.find(':') else {
                        continue;
                    };
                    if colon == 0 || colon == pos_key.len() - 1 {
                        continue;
                    }
                    // `colon` from find(':') — ASCII ':' is a single UTF-8 byte.
                    #[allow(clippy::string_slice)]
                    let row_hex = &pos_key[..colon];
                    #[allow(clippy::string_slice)] // colon + 1 is a char boundary (ASCII ':').
                    let col_hex = &pos_key[colon + 1..];
                    let cell_hex = match value {
                        yrs::Out::Any(yrs::Any::String(s)) => s.to_string(),
                        _ => continue,
                    };
                    let Some(raw) = hex_to_id(&cell_hex) else {
                        continue;
                    };
                    let cid = cell_types::CellId::from_raw(raw);
                    let (row, col) = match axis_grid.as_ref() {
                        Some(grid) => {
                            let (Some(row), Some(col)) = (
                                grid.row_index_from_hex(row_hex),
                                grid.col_index_from_hex(col_hex),
                            ) else {
                                if storage.read_cell_from_yrs_full(sheet_id, &cid).is_some() {
                                    return Err(ComputeError::Deserialize {
                                        message: format!(
                                            "sheet {} posToId entry {pos_key} for cell {} does not resolve through sheet axes",
                                            sheet_id.to_uuid_string(),
                                            cid.to_uuid_string(),
                                        ),
                                    });
                                }
                                continue;
                            };
                            (row, col)
                        }
                        None => continue,
                    };
                    let Some((value, formula, identity_formula, array_ref)) =
                        storage.read_cell_from_yrs_full(sheet_id, &cid)
                    else {
                        // `posToId` also carries marker identities for metadata
                        // such as named-range endpoints, comments, and formats
                        // on empty cells. Those IDs must hydrate into GridIndex,
                        // but they are not physical cells and must not become
                        // Null-valued snapshot cells during a sync rebuild.
                        continue;
                    };
                    cells.push(crate::snapshot::CellData {
                        cell_id: cid.to_uuid_string(),
                        row,
                        col,
                        value,
                        formula,
                        identity_formula,
                        array_ref,
                    });
                }
            }
        }
    }

    // Read Range entries from the Yrs sub-maps
    let ranges = {
        let txn = storage.doc().transact();
        let sheet_hex = compute_document::hex::id_to_hex(sheet_id.as_u128());
        let mut range_data_vec = Vec::new();
        if let Some(yrs::Out::YMap(sheet_map)) = storage.sheets().get(&txn, &sheet_hex)
            && let Some(yrs::Out::YMap(ranges_map)) =
                sheet_map.get(&txn, compute_document::schema::KEY_RANGES)
            && let Some(yrs::Out::YMap(payloads_map)) =
                sheet_map.get(&txn, compute_document::schema::KEY_RANGE_PAYLOADS)
        {
            for entry in
                compute_document::range::read_ranges_from_yrs(&txn, &ranges_map, &payloads_map)
            {
                let mut row_ids = entry.metadata.row_ids;
                let mut col_ids = entry.metadata.col_ids;

                if entry.metadata.row_axis.is_some() || entry.metadata.col_axis.is_some() {
                    let (Some(row_axis_ref), Some(col_axis_ref), Some(axes)) = (
                        entry.metadata.row_axis.as_ref(),
                        entry.metadata.col_axis.as_ref(),
                        resolved_axes.as_ref(),
                    ) else {
                        return Err(ComputeError::Deserialize {
                            message: format!(
                                "sheet {} range {} has asymmetric or unresolved compact range axes",
                                sheet_id.to_uuid_string(),
                                entry.metadata.range_id.to_uuid_string(),
                            ),
                        });
                    };
                    row_ids = axes
                        .row_axis
                        .identities_for_ref(*sheet_id, row_axis_ref)
                        .ok_or_else(|| ComputeError::Deserialize {
                            message: format!(
                                "sheet {} range {} row axis ref does not resolve",
                                sheet_id.to_uuid_string(),
                                entry.metadata.range_id.to_uuid_string(),
                            ),
                        })?;
                    col_ids = axes
                        .col_axis
                        .identities_for_ref(*sheet_id, col_axis_ref)
                        .ok_or_else(|| ComputeError::Deserialize {
                            message: format!(
                                "sheet {} range {} column axis ref does not resolve",
                                sheet_id.to_uuid_string(),
                                entry.metadata.range_id.to_uuid_string(),
                            ),
                        })?;
                }

                range_data_vec.push(crate::snapshot::RangeData {
                    range_id: entry.metadata.range_id,
                    kind: entry.metadata.kind,
                    anchor: entry.metadata.anchor,
                    encoding: entry.metadata.encoding,
                    payload: entry.payload,
                    row_axis: entry.metadata.row_axis,
                    col_axis: entry.metadata.col_axis,
                    row_ids,
                    col_ids,
                });
            }
        }
        range_data_vec
    };

    Ok(Some(SheetSnapshot {
        id: sheet_id.to_uuid_string(),
        name,
        rows,
        cols,
        cells,
        ranges,
    }))
}

// ---------------------------------------------------------------------------
// Workbook snapshot from Yrs state (for collaboration fork)
// ---------------------------------------------------------------------------

/// Build a complete `WorkbookSnapshot` by reading directly from the Yrs document.
///
/// Used when creating an engine from another engine's Yrs state bytes
/// (`from_yrs_state`). Reads all cell data, named ranges, and metadata
/// from the Yrs maps — no `CellMirror` or `ComputeCore` needed.
pub fn build_workbook_snapshot_from_yrs(
    storage: &YrsStorage,
) -> Result<WorkbookSnapshot, ComputeError> {
    // 1. Build sheet snapshots from Yrs
    let sheet_order = storage.sheet_order();
    let mut sheet_snapshots = Vec::with_capacity(sheet_order.len());
    for sheet_id in &sheet_order {
        let sheet_snapshot =
            build_sheet_snapshot_from_yrs(storage, sheet_id)?.ok_or_else(|| {
                ComputeError::Deserialize {
                    message: format!(
                        "sheet {} listed in sheet order but missing from Yrs sheet state",
                        sheet_id.to_uuid_string()
                    ),
                }
            })?;
        sheet_snapshots.push(sheet_snapshot);
    }

    // 2. Named ranges from Yrs
    let defined_names =
        workbook_named_ranges::get_all_named_ranges(storage.doc(), storage.workbook_map());
    let yrs_lookup = YrsIdentityFormulaLookup::from_storage(storage);
    let named_ranges_vec = defined_names_to_named_range_defs(defined_names, |identity| {
        compute_parser::to_a1_string_qualified(identity, &yrs_lookup)
    });

    // 3. Tables and Data Table regions from Yrs workbook maps.
    // Tables are stored in the workbook table catalog plus range-backed
    // runtime bindings.
    let tables = read_tables_from_yrs(storage);
    let data_table_regions = crate::storage::workbook::data_tables::get_all_data_table_regions(
        storage.doc(),
        storage.workbook_map(),
    );
    let workbook_settings =
        crate::storage::workbook::settings::get_settings(storage.doc(), storage.workbook_map());
    let calculation_settings = workbook_settings.calculation_settings;
    let calc = calculation_settings.clone().unwrap_or_default();

    let pivot_tables = read_pivot_defs_from_yrs(storage, &sheet_order);

    Ok(WorkbookSnapshot {
        sheets: sheet_snapshots,
        named_ranges: named_ranges_vec,
        tables,
        pivot_tables,
        data_table_regions,
        iterative_calc: calc.enable_iterative_calculation,
        max_iterations: calc.max_iterations,
        max_change: calc.max_change,
        calculation_settings,
    })
}

fn read_pivot_defs_from_yrs(
    storage: &YrsStorage,
    sheet_order: &[SheetId],
) -> Vec<snapshot_types::PivotTableDef> {
    let mut defs = Vec::new();
    for sheet_id in sheet_order {
        for config in
            crate::storage::sheet::pivots::get_all_pivots(storage.doc(), storage.sheets(), sheet_id)
        {
            let output_sheet_id = config
                .output_sheet_id
                .as_deref()
                .and_then(|value| SheetId::from_uuid_str(value).ok())
                .unwrap_or(*sheet_id);
            let (start_row, start_col, end_row, end_col) = config
                .ref_range
                .as_deref()
                .and_then(crate::import::phantom::parse_range_ref)
                .unwrap_or((
                    config.output_location.row,
                    config.output_location.col,
                    config.output_location.row,
                    config.output_location.col,
                ));
            let rendered_rows = end_row
                .checked_sub(start_row)
                .map(|delta| delta.saturating_add(1));
            let rendered_cols = end_col
                .checked_sub(start_col)
                .map(|delta| delta.saturating_add(1));
            let data_field_names = config
                .placements
                .iter()
                .filter(|placement| {
                    placement.area == domain_types::domain::pivot::PivotFieldArea::Value
                })
                .map(|placement| {
                    placement.display_name.clone().unwrap_or_else(|| {
                        config
                            .fields
                            .iter()
                            .find(|field| field.id.as_str() == placement.field_id.as_str())
                            .map(|field| field.name.clone())
                            .unwrap_or_else(|| placement.field_id.to_string())
                    })
                })
                .collect();
            let cache_field_names = config
                .fields
                .iter()
                .map(|field| field.name.clone())
                .collect();
            let row_field_indices = pivot_field_indices_for_area(
                &config,
                domain_types::domain::pivot::PivotFieldArea::Row,
            );
            let col_field_indices = pivot_field_indices_for_area(
                &config,
                domain_types::domain::pivot::PivotFieldArea::Column,
            );
            defs.push(snapshot_types::PivotTableDef {
                id: config.id,
                name: config.name,
                sheet: output_sheet_id.to_uuid_string(),
                start_row,
                start_col,
                end_row,
                end_col,
                rendered_rows,
                rendered_cols,
                first_data_row: config.first_data_row.unwrap_or(0),
                first_data_col: config.first_data_col.unwrap_or(0),
                data_field_names,
                cache_field_names,
                row_field_indices,
                col_field_indices,
                data_on_rows: config.data_on_rows.unwrap_or(false),
                style: config.style,
                show_row_grand_totals: config
                    .layout
                    .as_ref()
                    .and_then(|layout| layout.show_row_grand_totals),
                show_column_grand_totals: config
                    .layout
                    .as_ref()
                    .and_then(|layout| layout.show_column_grand_totals),
            });
        }
    }
    defs
}

fn pivot_field_indices_for_area(
    config: &domain_types::domain::pivot::PivotTableConfig,
    area: domain_types::domain::pivot::PivotFieldArea,
) -> Vec<u32> {
    config
        .placements
        .iter()
        .filter(|placement| placement.area == area)
        .filter_map(|placement| {
            config
                .fields
                .iter()
                .position(|field| field.id.as_str() == placement.field_id.as_str())
                .map(|index| index as u32)
        })
        .collect()
}

/// Read table definitions from Yrs.
///
/// The workbook table catalog is the only table source. Workbook-level range
/// bindings are never used to reconstruct tables.
///
/// This mirrors the read in `services::tables::sync_tables_from_yrs`
/// but returns lightweight `TableDef`s for the snapshot rather than full
/// `CanonicalTable`s.
pub(in crate::storage::engine) fn read_tables_from_yrs(
    storage: &YrsStorage,
) -> Vec<formula_types::TableDef> {
    let doc = storage.doc();
    let txn = doc.transact();
    let workbook = storage.workbook_map();

    let mut tables = Vec::new();
    // Canonical catalog entries, including imported and runtime-created tables.
    if let Some(Out::YMap(tables_map)) = workbook.get(&txn, compute_document::schema::KEY_TABLES) {
        for (key, value) in tables_map.iter(&txn) {
            let Out::YMap(inner) = value else {
                continue;
            };
            if let Some(ct) = domain_types::yrs_schema::table::from_yrs_map_to_table(&inner, &txn)
                && ct.id == key
                && let Ok(sheet) = SheetId::from_uuid_str(&ct.sheet_id)
            {
                tables.push(formula_types::TableDef {
                    name: ct.name,
                    sheet,
                    start_row: ct.range.start_row(),
                    start_col: ct.range.start_col(),
                    end_row: ct.range.end_row(),
                    end_col: ct.range.end_col(),
                    columns: ct.columns.iter().map(|c| c.name.clone()).collect(),
                    has_headers: ct.has_header_row,
                    has_totals: ct.has_totals_row,
                });
            }
        }
    }

    tables
}
