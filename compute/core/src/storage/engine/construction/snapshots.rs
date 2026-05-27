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
) -> Option<SheetSnapshot> {
    use crate::storage::infra::grid_helpers;
    use crate::storage::sheet::properties;
    use compute_document::hex::hex_to_id;
    use compute_document::schema::KEY_GRID_INDEX;

    let name = properties::get_sheet_name(storage.doc(), storage.sheets(), sheet_id)?;

    // Derive dimensions from rowOrder/colOrder YArray lengths
    let (rows, cols) = {
        let txn = storage.doc().transact();
        let sheet_hex = compute_document::hex::id_to_hex(sheet_id.as_u128());
        let sheet_map = match storage.sheets().get(&txn, &sheet_hex) {
            Some(yrs::Out::YMap(m)) => m,
            _ => return None,
        };
        let r = grid_helpers::get_row_order_array(&sheet_map, &txn)
            .map(|a| a.len(&txn))
            .unwrap_or(100);
        let c = grid_helpers::get_col_order_array(&sheet_map, &txn)
            .map(|a| a.len(&txn))
            .unwrap_or(26);
        (r, c)
    };

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
            // Build rowHex -> row_index and colHex -> col_index maps from
            // rowOrder / colOrder arrays.
            let row_index: std::collections::HashMap<String, u32> =
                match grid_helpers::get_row_order_array(&sheet_map, &txn) {
                    Some(arr) => (0..arr.len(&txn))
                        .filter_map(|i| match arr.get(&txn, i) {
                            Some(yrs::Out::Any(yrs::Any::String(s))) => Some((s.to_string(), i)),
                            _ => None,
                        })
                        .collect(),
                    None => std::collections::HashMap::new(),
                };
            let col_index: std::collections::HashMap<String, u32> =
                match grid_helpers::get_col_order_array(&sheet_map, &txn) {
                    Some(arr) => (0..arr.len(&txn))
                        .filter_map(|i| match arr.get(&txn, i) {
                            Some(yrs::Out::Any(yrs::Any::String(s))) => Some((s.to_string(), i)),
                            _ => None,
                        })
                        .collect(),
                    None => std::collections::HashMap::new(),
                };

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
                    let Some(&row) = row_index.get(row_hex) else {
                        continue;
                    };
                    let Some(&col) = col_index.get(col_hex) else {
                        continue;
                    };
                    let cell_hex = match value {
                        yrs::Out::Any(yrs::Any::String(s)) => s.to_string(),
                        _ => continue,
                    };
                    let Some(raw) = hex_to_id(&cell_hex) else {
                        continue;
                    };
                    let cid = cell_types::CellId::from_raw(raw);
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
                range_data_vec.push(crate::snapshot::RangeData {
                    range_id: entry.metadata.range_id,
                    kind: entry.metadata.kind,
                    anchor: entry.metadata.anchor,
                    encoding: entry.metadata.encoding,
                    payload: entry.payload,
                    row_axis: entry.metadata.row_axis,
                    col_axis: entry.metadata.col_axis,
                    row_ids: entry.metadata.row_ids,
                    col_ids: entry.metadata.col_ids,
                });
            }
        }
        range_data_vec
    };

    Some(SheetSnapshot {
        id: sheet_id.to_uuid_string(),
        name,
        rows,
        cols,
        cells,
        ranges,
    })
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
    let sheet_snapshots: Vec<SheetSnapshot> = sheet_order
        .iter()
        .filter_map(|sheet_id| build_sheet_snapshot_from_yrs(storage, sheet_id))
        .collect();

    // 2. Named ranges from Yrs
    let defined_names =
        workbook_named_ranges::get_all_named_ranges(storage.doc(), storage.workbook_map());
    let yrs_lookup = YrsIdentityFormulaLookup::from_storage(storage);
    let named_ranges_vec = defined_names_to_named_range_defs(defined_names, |identity| {
        compute_parser::to_a1_string_qualified(identity, &yrs_lookup)
    });

    // 3. Tables and Data Table regions from Yrs workbook maps.
    // Tables are stored as JSON strings in the workbook.tables map.
    let tables = read_tables_from_yrs(storage);
    let data_table_regions = crate::storage::workbook::data_tables::get_all_data_table_regions(
        storage.doc(),
        storage.workbook_map(),
    );
    let workbook_settings =
        crate::storage::workbook::settings::get_settings(storage.doc(), storage.workbook_map());
    let calculation_settings = workbook_settings.calculation_settings;
    let calc = calculation_settings.clone().unwrap_or_default();

    Ok(WorkbookSnapshot {
        sheets: sheet_snapshots,
        named_ranges: named_ranges_vec,
        tables,
        pivot_tables: vec![],
        data_table_regions,
        iterative_calc: calc.enable_iterative_calculation,
        max_iterations: calc.max_iterations,
        max_change: calc.max_change,
        calculation_settings,
    })
}

/// Read table definitions from Yrs.
///
/// Primary path: `rangeBindings[table:<name>]` entries (where runtime-created
/// tables are persisted by `persist_table_to_yrs`).
///
/// Fallback: the legacy `workbook.tables` map (used by XLSX imports that
/// haven't migrated to rangeBindings).
///
/// This mirrors the two-tier read in `services::tables::sync_tables_from_yrs`
/// but returns lightweight `TableDef`s for the snapshot rather than full
/// `CanonicalTable`s.
pub(in crate::storage::engine) fn read_tables_from_yrs(
    storage: &YrsStorage,
) -> Vec<formula_types::TableDef> {
    let doc = storage.doc();
    let txn = doc.transact();
    let workbook = storage.workbook_map();

    let mut tables = Vec::new();
    let mut seen_names = std::collections::HashSet::new();

    // Tier 1: rangeBindings (primary path for runtime-created tables).
    let binding_entries = compute_document::range::all_range_bindings_wb(workbook, &txn);
    for (range_id, json) in &binding_entries {
        if let Some(_tname) =
            crate::storage::engine::services::tables::table_name_from_range_id(range_id)
            && let Some(ct) = domain_types::yrs_schema::table::from_binding_json_standalone(json)
            && let Ok(sheet) = SheetId::from_uuid_str(&ct.sheet_id)
        {
            seen_names.insert(ct.name.clone());
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

    // Tier 2: legacy workbook.tables map (XLSX-imported tables).
    if let Some(Out::YMap(tables_map)) = workbook.get(&txn, "tables") {
        for (key, value) in tables_map.iter(&txn) {
            if seen_names.contains(key) {
                continue;
            }
            match value {
                Out::Any(Any::String(json_str)) => {
                    if let Ok(table_def) =
                        serde_json::from_str::<formula_types::TableDef>(&json_str)
                    {
                        tables.push(table_def);
                    }
                }
                Out::YMap(inner) => {
                    if let Some(ct) =
                        domain_types::yrs_schema::table::from_yrs_map_to_table(&inner, &txn)
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
                _ => {}
            }
        }
    }

    tables
}
