#![allow(unused_imports, unused_variables)]
use super::*;

// -------------------------------------------------------------------
// Table Yrs Persistence
// -------------------------------------------------------------------

/// Persist a full table definition to the Yrs CRDT document.
///
/// Writes a `TableBinding` JSON string to `workbook.rangeBindings[table:<name>]`
/// (Range-backed format). Also ensures the `tables` sub-map exists so the
/// undo manager records a transaction entry even on first create.
///
/// Uses a single `ORIGIN_USER_EDIT` transaction so the change syncs to peers.
pub(in crate::storage::engine) fn persist_table_to_yrs(
    stores: &mut EngineStores,
    table: &CanonicalTable,
) {
    let workbook = stores.storage.workbook_map().clone();
    let mut txn = stores
        .storage
        .doc()
        .transact_mut_with(Origin::from(compute_document::undo::ORIGIN_USER_EDIT));

    // Lazy-create the `tables` sub-map so the undo manager records a
    // transaction entry. See `crate::storage::ensure_workbook_child_map`
    // doc-comment for why this is the LWW-safe construction.
    let _tables_map = crate::storage::ensure_workbook_child_map(
        &workbook,
        &mut txn,
        compute_document::schema::KEY_TABLES,
    );

    // Write TableBinding to rangeBindings (Range-backed format).
    let range_id = table_range_id(&table.name);
    if let Some(json) = domain_types::yrs_schema::table::table_to_binding_json(table) {
        compute_document::range::write_range_binding_wb(&workbook, &mut txn, &range_id, &json);
    }
}

/// Persist a table definition and its backing table filter in one Yrs transaction.
///
/// A table filter is not an independent user action; it is part of the table
/// model. Keeping both writes in one transaction preserves undo/redo semantics
/// and ensures peers observe a coherent table creation.
pub(in crate::storage::engine) fn persist_table_to_yrs_with_table_filter(
    stores: &mut EngineStores,
    table: &CanonicalTable,
    sheet_id: &SheetId,
    header_start_cell_id: &str,
    header_end_cell_id: &str,
    data_end_cell_id: &str,
) -> Result<filters::FilterState, ComputeError> {
    let workbook = stores.storage.workbook_map().clone();
    let sheets = stores.storage.sheets().clone();
    let doc = stores.storage.doc().clone();
    let mut txn = doc.transact_mut_with(Origin::from(compute_document::undo::ORIGIN_USER_EDIT));

    let _tables_map = crate::storage::ensure_workbook_child_map(
        &workbook,
        &mut txn,
        compute_document::schema::KEY_TABLES,
    );

    let range_id = table_range_id(&table.name);
    if let Some(json) = domain_types::yrs_schema::table::table_to_binding_json(table) {
        compute_document::range::write_range_binding_wb(&workbook, &mut txn, &range_id, &json);
    }

    filters::create_filter_in_txn(
        &mut txn,
        &sheets,
        sheet_id,
        header_start_cell_id,
        header_end_cell_id,
        data_end_cell_id,
        filters::FilterKind::TableFilter,
        Some(table.id.clone()),
        &stores.id_alloc,
    )
}

/// Remove a table from the Yrs CRDT document.
///
/// Removes the `rangeBindings[table:<name>]` entry. Also ensures the
/// `tables` sub-map exists so the undo manager records a transaction
/// entry (important for create+delete groupings where the inner remove
/// is otherwise a no-op and the txn would carry no changes).
pub(in crate::storage::engine) fn remove_table_from_yrs(
    stores: &mut EngineStores,
    table_name: &str,
) {
    remove_table_from_yrs_with_filter(stores, table_name, None);
}

pub(in crate::storage::engine) fn remove_table_from_yrs_with_filter(
    stores: &mut EngineStores,
    table_name: &str,
    table_filter: Option<&(SheetId, String)>,
) {
    let workbook = stores.storage.workbook_map().clone();
    let sheets = stores.storage.sheets().clone();
    let doc = stores.storage.doc().clone();
    let mut txn = doc.transact_mut_with(Origin::from(compute_document::undo::ORIGIN_USER_EDIT));

    // Ensure `tables` sub-map exists for undo manager tracking.
    let _tables_map = crate::storage::ensure_workbook_child_map(
        &workbook,
        &mut txn,
        compute_document::schema::KEY_TABLES,
    );

    // Clean up rangeBindings entry.
    let range_id = table_range_id(table_name);
    compute_document::range::remove_range_binding_wb(&workbook, &mut txn, &range_id);

    if let Some((sheet_id, filter_id)) = table_filter {
        filters::delete_filter_in_txn(&mut txn, &sheets, sheet_id, filter_id);
    }
}

/// Persist the current table style fields to the Yrs document.
///
/// Writes a `TableBinding` JSON string to `workbook.rangeBindings[table:<name>]`
/// in a single `ORIGIN_USER_EDIT` transaction.
pub(in crate::storage::engine) fn persist_table_style_to_yrs(
    stores: &mut EngineStores,
    mirror: &CellMirror,
    table_name: &str,
) -> Result<(), ComputeError> {
    let table = &mirror
        .get_table(table_name)
        .cloned()
        .ok_or_else(|| ComputeError::Eval {
            message: format!("Table not found: {}", table_name),
        })?;

    let workbook = stores.storage.workbook_map().clone();
    let mut txn = stores
        .storage
        .doc()
        .transact_mut_with(Origin::from(compute_document::undo::ORIGIN_USER_EDIT));

    // Write updated binding to rangeBindings.
    let range_id = table_range_id(table_name);
    if let Some(json) = domain_types::yrs_schema::table::table_to_binding_json(table) {
        compute_document::range::write_range_binding_wb(&workbook, &mut txn, &range_id, &json);
    }

    Ok(())
}

/// Re-read ALL tables from Yrs and sync them into the mirror.
///
/// Primary read path: `rangeBindings[table:<name>]` entries (Range-backed
/// format). Range coordinates, table ID, and sheet ID are stored in the
/// binding JSON itself.
///
/// Fallback for XLSX-imported tables that were written through the legacy
/// `workbook.tables` path (which does not yet write to rangeBindings):
/// any table name present in `workbook.tables` but NOT in rangeBindings
/// is read via `from_yrs_map_to_table` (canonical Y.Map keys or OOXML
/// rangeRef fallback).
///
/// Called after undo/redo or remote changes so the mirror stays in sync.
pub(in crate::storage::engine) fn sync_tables_from_yrs(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
) {
    let (yrs_tables, yrs_names): (Vec<CanonicalTable>, std::collections::HashSet<String>) = {
        let txn = stores.storage.doc().transact();
        let mut tables = Vec::new();
        let mut names = std::collections::HashSet::new();

        // Tier 1: read tables from rangeBindings (primary path).
        let binding_entries =
            compute_document::range::all_range_bindings_wb(stores.storage.workbook_map(), &txn);
        for (range_id, json) in &binding_entries {
            if let Some(_tname) = table_name_from_range_id(range_id)
                && let Some(table) =
                    domain_types::yrs_schema::table::from_binding_json_standalone(json)
            {
                names.insert(table.name.clone());
                tables.push(table);
            }
        }

        // Fallback: read from workbook.tables for XLSX-imported tables
        // that haven't been migrated to rangeBindings yet.
        if let Some(Out::YMap(tables_map)) = stores
            .storage
            .workbook_map()
            .get(&txn, compute_document::schema::KEY_TABLES)
        {
            for (key, value) in tables_map.iter(&txn) {
                // Skip if already found in rangeBindings.
                if names.contains(key) {
                    continue;
                }
                if let Out::YMap(inner) = value
                    && let Some(table) =
                        domain_types::yrs_schema::table::from_yrs_map_to_table(&inner, &txn)
                {
                    names.insert(table.name.clone());
                    tables.push(table);
                }
            }
        }

        (tables, names)
    };

    // Update or create tables from Yrs
    for table in yrs_tables {
        stores.compute.set_table(mirror, table);
    }

    // Remove tables that exist in mirror but not in Yrs
    let mirror_names: Vec<String> = mirror.all_tables().iter().map(|t| t.name.clone()).collect();
    for name in mirror_names {
        if !yrs_names.contains(&name) {
            stores.compute.remove_table(mirror, &name);
        }
    }
}
