#![allow(unused_imports, unused_variables)]
use super::*;
use domain_types::yrs_schema::table as yrs_table;
use yrs::{MapPrelim, MapRef, TransactionMut};

// -------------------------------------------------------------------
// Table Yrs Persistence
// -------------------------------------------------------------------

fn table_catalog_prelim(table: &CanonicalTable) -> MapPrelim {
    yrs_table::to_yrs_prelim_from_table(table)
        .into_iter()
        .collect()
}

fn write_table_catalog_entry(
    tables_map: &MapRef,
    txn: &mut TransactionMut,
    table: &CanonicalTable,
) {
    tables_map.insert(txn, table.id.as_str(), table_catalog_prelim(table));
}

pub(in crate::storage::engine) fn persist_table_to_yrs_in_txn(
    workbook: &MapRef,
    txn: &mut TransactionMut,
    table: &CanonicalTable,
) {
    let tables_map = crate::storage::ensure_workbook_child_map(
        workbook,
        txn,
        compute_document::schema::KEY_TABLES,
    );
    write_table_catalog_entry(&tables_map, txn, table);
}

/// Persist a full table definition to the Yrs CRDT document.
///
/// Writes the canonical table catalog entry to `workbook.tables[<table_id>]`.
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

    persist_table_to_yrs_in_txn(&workbook, &mut txn, table);
}

/// Persist a table rename without changing its stable catalog identity.
pub(in crate::storage::engine) fn rename_table_in_yrs(
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

    write_table_catalog_entry(&tables_map, &mut txn, table);
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

    persist_table_to_yrs_in_txn(&workbook, &mut txn, table);

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

pub(in crate::storage::engine) fn remove_table_from_yrs_with_filter(
    stores: &mut EngineStores,
    table_name: &str,
    table_id: Option<&str>,
    table_filter: Option<&(SheetId, String)>,
) -> Vec<(u32, bool)> {
    let workbook = stores.storage.workbook_map().clone();
    let sheets = stores.storage.sheets().clone();
    let doc = stores.storage.doc().clone();
    let grid_index = table_filter.and_then(|(sheet_id, _)| stores.grid_indexes.get(sheet_id));
    let mut txn = doc.transact_mut_with(Origin::from(compute_document::undo::ORIGIN_USER_EDIT));

    remove_table_from_yrs_in_txn(
        &workbook,
        &sheets,
        &mut txn,
        table_name,
        table_id,
        table_filter,
        grid_index,
    )
}

pub(in crate::storage::engine) fn remove_table_from_yrs_in_txn(
    workbook: &MapRef,
    sheets: &MapRef,
    txn: &mut TransactionMut,
    _table_name: &str,
    table_id: Option<&str>,
    table_filter: Option<&(SheetId, String)>,
    grid_index: Option<&crate::identity::GridIndex>,
) -> Vec<(u32, bool)> {
    let tables_map = crate::storage::ensure_workbook_child_map(
        workbook,
        txn,
        compute_document::schema::KEY_TABLES,
    );

    if let Some(table_id) = table_id {
        tables_map.remove(txn, table_id);
    }

    if let Some((sheet_id, filter_id)) = table_filter {
        let transitions = crate::storage::sheet::dimensions::clear_filter_hidden_rows_in_txn(
            txn, sheets, sheet_id, filter_id, grid_index,
        );
        filters::delete_filter_in_txn(txn, sheets, sheet_id, filter_id);
        filters::delete_filter_metadata_binding_in_txn(txn, sheets, sheet_id, filter_id);
        transitions
    } else {
        Vec::new()
    }
}

/// Persist the current table style fields to the Yrs document.
///
/// Updates `workbook.tables[<table_id>]` in a single `ORIGIN_USER_EDIT`
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

    persist_table_to_yrs_in_txn(&workbook, &mut txn, table);

    Ok(())
}

/// Re-read ALL tables from Yrs and sync them into the mirror.
///
/// The id-keyed catalog is the canonical table source. Workbook-level range
/// bindings are not table-domain input.
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

        // Read canonical catalog entries. Range bindings are never table sources.
        if let Some(Out::YMap(tables_map)) = stores
            .storage
            .workbook_map()
            .get(&txn, compute_document::schema::KEY_TABLES)
        {
            for (key, value) in tables_map.iter(&txn) {
                if let Out::YMap(inner) = value
                    && let Some(table) =
                        domain_types::yrs_schema::table::from_yrs_map_to_table(&inner, &txn)
                    && table.id == key
                {
                    ids.insert(table.id.clone());
                    names.insert(table.name.clone());
                    tables.push(table);
                }
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
