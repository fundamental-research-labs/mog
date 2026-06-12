#![allow(unused_imports, unused_variables)]
use super::*;
use domain_types::yrs_schema::table as yrs_table;
use yrs::{MapPrelim, MapRef, ReadTxn, TransactionMut};

// -------------------------------------------------------------------
// Table Yrs Persistence
// -------------------------------------------------------------------

fn table_catalog_prelim(table: &CanonicalTable) -> MapPrelim {
    yrs_table::to_yrs_prelim_from_table(table)
        .into_iter()
        .collect()
}

fn read_table_catalog_entry<T: ReadTxn>(
    tables_map: &MapRef,
    txn: &T,
    key: &str,
) -> Option<CanonicalTable> {
    match tables_map.get(txn, key) {
        Some(Out::YMap(inner)) => yrs_table::from_yrs_map_to_table(&inner, txn),
        _ => None,
    }
}

fn write_table_catalog_entry(
    tables_map: &MapRef,
    txn: &mut TransactionMut,
    table: &CanonicalTable,
) {
    tables_map.insert(txn, table.id.as_str(), table_catalog_prelim(table));
}

fn write_table_range_binding(workbook: &MapRef, txn: &mut TransactionMut, table: &CanonicalTable) {
    let range_id = table_range_id(&table.id);
    if let Some(json) = compute_document::range::TableRangeBinding::new(&table.id).to_json() {
        compute_document::range::write_range_binding_wb(workbook, txn, &range_id, &json);
    }
}

/// Persist a full table definition to the Yrs CRDT document.
///
/// Writes the canonical table catalog entry to `workbook.tables[<table_id>]`
/// and a compact attachment to `workbook.rangeBindings[table:<table_id>]`.
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

    let tables_map = crate::storage::ensure_workbook_child_map(
        &workbook,
        &mut txn,
        compute_document::schema::KEY_TABLES,
    );
    tables_map.remove(&mut txn, table.name.as_str());
    write_table_catalog_entry(&tables_map, &mut txn, table);
    write_table_range_binding(&workbook, &mut txn, table);
}

/// Persist a table rename without changing its stable catalog identity.
pub(in crate::storage::engine) fn rename_table_in_yrs(
    stores: &mut EngineStores,
    old_name: &str,
    table: &CanonicalTable,
) {
    let workbook = stores.storage.workbook_map().clone();
    let mut txn = stores
        .storage
        .doc()
        .transact_mut_with(Origin::from(compute_document::undo::ORIGIN_USER_EDIT));

    let tables_map = crate::storage::ensure_workbook_child_map(
        &workbook,
        &mut txn,
        compute_document::schema::KEY_TABLES,
    );
    tables_map.remove(&mut txn, old_name);
    let old_range_id = table_range_id(old_name);
    compute_document::range::remove_range_binding_wb(&workbook, &mut txn, &old_range_id);

    write_table_catalog_entry(&tables_map, &mut txn, table);
    write_table_range_binding(&workbook, &mut txn, table);
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

    let tables_map = crate::storage::ensure_workbook_child_map(
        &workbook,
        &mut txn,
        compute_document::schema::KEY_TABLES,
    );
    tables_map.remove(&mut txn, table.name.as_str());
    write_table_catalog_entry(&tables_map, &mut txn, table);
    write_table_range_binding(&workbook, &mut txn, table);

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
/// Removes both the `workbook.tables[<name>]` catalog entry and the
/// `rangeBindings[table:<name>]` runtime binding.
pub(in crate::storage::engine) fn remove_table_from_yrs(
    stores: &mut EngineStores,
    table_name: &str,
) {
    remove_table_from_yrs_with_filter(stores, table_name, None, None);
}

pub(in crate::storage::engine) fn remove_table_from_yrs_by_table(
    stores: &mut EngineStores,
    table: &CanonicalTable,
) {
    remove_table_from_yrs_with_filter(stores, &table.name, Some(table.id.as_str()), None);
}

pub(in crate::storage::engine) fn remove_table_from_yrs_with_filter(
    stores: &mut EngineStores,
    table_name: &str,
    table_id: Option<&str>,
    table_filter: Option<&(SheetId, String)>,
) {
    let workbook = stores.storage.workbook_map().clone();
    let sheets = stores.storage.sheets().clone();
    let doc = stores.storage.doc().clone();
    let mut txn = doc.transact_mut_with(Origin::from(compute_document::undo::ORIGIN_USER_EDIT));

    let tables_map = crate::storage::ensure_workbook_child_map(
        &workbook,
        &mut txn,
        compute_document::schema::KEY_TABLES,
    );

    let mut catalog_keys = vec![table_name.to_string()];
    let mut table_ids = Vec::new();
    if let Some(table_id) = table_id {
        catalog_keys.push(table_id.to_string());
        table_ids.push(table_id.to_string());
    } else {
        for (key, value) in tables_map.iter(&txn) {
            if let Out::YMap(inner) = value
                && let Some(table) =
                    domain_types::yrs_schema::table::from_yrs_map_to_table(&inner, &txn)
                && table.name.eq_ignore_ascii_case(table_name)
            {
                catalog_keys.push(key.to_string());
                table_ids.push(table.id);
            }
        }
    }
    catalog_keys.sort();
    catalog_keys.dedup();
    for key in catalog_keys {
        tables_map.remove(&mut txn, key.as_str());
    }

    let range_id = table_range_id(table_name);
    compute_document::range::remove_range_binding_wb(&workbook, &mut txn, &range_id);
    table_ids.sort();
    table_ids.dedup();
    for table_id in table_ids {
        let range_id = table_range_id(&table_id);
        compute_document::range::remove_range_binding_wb(&workbook, &mut txn, &range_id);
    }

    if let Some((sheet_id, filter_id)) = table_filter {
        filters::delete_filter_in_txn(&mut txn, &sheets, sheet_id, filter_id);
    }
}

/// Persist the current table style fields to the Yrs document.
///
/// Updates `workbook.tables[<table_id>]` and the compact table attachment in
/// a single `ORIGIN_USER_EDIT`
/// transaction.
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

    let tables_map = crate::storage::ensure_workbook_child_map(
        &workbook,
        &mut txn,
        compute_document::schema::KEY_TABLES,
    );
    tables_map.remove(&mut txn, table_name);
    write_table_catalog_entry(&tables_map, &mut txn, table);
    write_table_range_binding(&workbook, &mut txn, table);

    Ok(())
}

/// Re-read ALL tables from Yrs and sync them into the mirror.
///
/// Range bindings carry the runtime table identity and extent used by the
/// mirror. The table catalog is also canonical and is read for imported or
/// catalog-only documents that do not have range bindings yet.
///
/// Called after undo/redo or remote changes so the mirror stays in sync.
pub(in crate::storage::engine) fn sync_tables_from_yrs(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
) {
    let (yrs_tables, yrs_names, yrs_ids): (
        Vec<CanonicalTable>,
        std::collections::HashSet<String>,
        std::collections::HashSet<String>,
    ) = {
        let txn = stores.storage.doc().transact();
        let mut tables = Vec::new();
        let mut names = std::collections::HashSet::new();
        let mut ids = std::collections::HashSet::new();

        // Read canonical catalog entries first. Range bindings are compact
        // attachments; legacy full bindings are migration input only.
        if let Some(Out::YMap(tables_map)) = stores
            .storage
            .workbook_map()
            .get(&txn, compute_document::schema::KEY_TABLES)
        {
            for (key, value) in tables_map.iter(&txn) {
                if let Out::YMap(inner) = value
                    && let Some(table) =
                        domain_types::yrs_schema::table::from_yrs_map_to_table(&inner, &txn)
                {
                    if table.id != key {
                        names.insert(key.to_string());
                    }
                    ids.insert(key.to_string());
                    ids.insert(table.id.clone());
                    names.insert(table.name.clone());
                    tables.push(table);
                }
            }
        }

        // Legacy documents may still have self-contained full table bindings
        // and no catalog entry. Read them after catalog entries so compact
        // attachments never become a second table source.
        let binding_entries =
            compute_document::range::all_range_bindings_wb(stores.storage.workbook_map(), &txn);
        for (range_id, json) in &binding_entries {
            if table_id_from_range_id(range_id).is_some()
                && compute_document::range::TableRangeBinding::from_json(json).is_none()
                && let Some(table) =
                    domain_types::yrs_schema::table::from_binding_json_standalone(json)
                && !names.contains(&table.name)
                && !ids.contains(&table.id)
            {
                ids.insert(table.id.clone());
                names.insert(table.name.clone());
                tables.push(table);
            }
        }

        (tables, names, ids)
    };

    // Update or create tables from Yrs
    for table in yrs_tables {
        stores.compute.set_table(mirror, table);
    }

    // Remove tables that exist in mirror but not in Yrs
    let mirror_tables: Vec<(String, String)> = mirror
        .all_tables()
        .iter()
        .map(|t| (t.name.clone(), t.id.clone()))
        .collect();
    for (name, id) in mirror_tables {
        if !yrs_names.contains(&name) && !yrs_ids.contains(&id) {
            stores.compute.remove_table(mirror, &name);
        }
    }
}
