#![allow(unused_imports, unused_variables)]
use super::*;
use domain_types::domain::table::{TableColumnSpec, TableSpec};
use domain_types::yrs_schema::table as yrs_table;
use std::sync::Arc;
use yrs::{Any, MapPrelim, MapRef, ReadTxn, TransactionMut};

// -------------------------------------------------------------------
// Table Yrs Persistence
// -------------------------------------------------------------------

fn table_catalog_prelim(table: &CanonicalTable, existing_spec: Option<TableSpec>) -> MapPrelim {
    let spec = merge_table_catalog_spec(table, existing_spec);
    let mut entries = yrs_table::to_yrs_prelim(&spec);
    let id_value = if spec.id != 0 && table.id.parse::<u32>().is_err() {
        Any::Number(spec.id as f64)
    } else {
        Any::String(Arc::from(table.id.as_str()))
    };

    set_entry(&mut entries, yrs_table::KEY_ID, id_value);
    set_entry(
        &mut entries,
        yrs_table::KEY_SHEET_ID,
        Any::String(Arc::from(table.sheet_id.as_str())),
    );
    set_entry(
        &mut entries,
        yrs_table::KEY_START_ROW,
        Any::Number(table.range.start_row() as f64),
    );
    set_entry(
        &mut entries,
        yrs_table::KEY_START_COL,
        Any::Number(table.range.start_col() as f64),
    );
    set_entry(
        &mut entries,
        yrs_table::KEY_END_ROW,
        Any::Number(table.range.end_row() as f64),
    );
    set_entry(
        &mut entries,
        yrs_table::KEY_END_COL,
        Any::Number(table.range.end_col() as f64),
    );
    set_entry(
        &mut entries,
        yrs_table::KEY_SHOW_FILTER_BUTTONS,
        Any::Bool(table.show_filter_buttons),
    );
    set_entry(
        &mut entries,
        yrs_table::KEY_AUTO_EXPAND,
        Any::Bool(table.auto_expand),
    );
    set_entry(
        &mut entries,
        yrs_table::KEY_AUTO_CALCULATED_COLUMNS,
        Any::Bool(table.auto_calculated_columns),
    );

    entries.into_iter().collect()
}

fn set_entry(entries: &mut Vec<(&str, Any)>, key: &'static str, value: Any) {
    if let Some((_, existing)) = entries.iter_mut().find(|(entry_key, _)| *entry_key == key) {
        *existing = value;
    } else {
        entries.push((key, value));
    }
}

fn merge_table_catalog_spec(table: &CanonicalTable, existing_spec: Option<TableSpec>) -> TableSpec {
    let merged_columns = existing_spec
        .as_ref()
        .map(|spec| merge_table_catalog_columns(table, &spec.columns));
    let generated =
        domain_types::domain::table::table_to_table_spec(table, merged_columns.as_deref());
    let mut spec = existing_spec.unwrap_or_default();

    spec.id = if generated.id != 0 {
        generated.id
    } else {
        spec.id
    };
    spec.name = generated.name;
    spec.display_name = generated.display_name;
    spec.range_ref = generated.range_ref;
    spec.has_headers = generated.has_headers;
    spec.has_totals = generated.has_totals;
    spec.style_name = generated.style_name;
    spec.row_stripes = generated.row_stripes;
    spec.col_stripes = generated.col_stripes;
    spec.first_col_highlight = generated.first_col_highlight;
    spec.last_col_highlight = generated.last_col_highlight;
    spec.auto_filter_ref = generated.auto_filter_ref;
    spec.columns = generated.columns;

    spec
}

fn merge_table_catalog_columns(
    table: &CanonicalTable,
    existing_columns: &[TableColumnSpec],
) -> Vec<TableColumnSpec> {
    table
        .columns
        .iter()
        .enumerate()
        .map(|(index, column)| {
            let mut spec = existing_columns.get(index).cloned().unwrap_or_default();
            spec.id = column
                .id
                .parse::<u32>()
                .ok()
                .filter(|id| *id != 0)
                .or_else(|| (spec.id != 0).then_some(spec.id))
                .unwrap_or(index as u32 + 1);
            spec.name = column.name.clone();
            spec.totals_function = column.totals_function;
            spec.totals_label = column.totals_label.clone();
            spec.calculated_formula = column.calculated_formula.clone();
            if spec.calculated_formula.is_none() {
                spec.calculated_formula_array = false;
            }
            spec
        })
        .collect()
}

fn read_table_catalog_spec<T: ReadTxn>(
    tables_map: &MapRef,
    txn: &T,
    table_name: &str,
) -> Option<TableSpec> {
    match tables_map.get(txn, table_name) {
        Some(Out::YMap(inner)) => yrs_table::from_yrs_map(&inner, txn),
        _ => None,
    }
}

fn write_table_catalog_entry(
    tables_map: &MapRef,
    txn: &mut TransactionMut,
    table: &CanonicalTable,
    existing_spec: Option<TableSpec>,
) {
    tables_map.insert(
        txn,
        table.name.as_str(),
        table_catalog_prelim(table, existing_spec),
    );
}

fn write_table_range_binding(workbook: &MapRef, txn: &mut TransactionMut, table: &CanonicalTable) {
    let range_id = table_range_id(&table.name);
    if let Some(json) = yrs_table::table_to_binding_json(table) {
        compute_document::range::write_range_binding_wb(workbook, txn, &range_id, &json);
    }
}

/// Persist a full table definition to the Yrs CRDT document.
///
/// Writes the canonical table catalog entry to `workbook.tables[<name>]` and
/// the range-backed runtime binding to `workbook.rangeBindings[table:<name>]`.
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
    let existing_spec = read_table_catalog_spec(&tables_map, &txn, &table.name);
    write_table_catalog_entry(&tables_map, &mut txn, table, existing_spec);
    write_table_range_binding(&workbook, &mut txn, table);
}

/// Persist a table rename while carrying forward any imported OOXML catalog
/// metadata from the old table name.
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
    let existing_spec = read_table_catalog_spec(&tables_map, &txn, old_name)
        .or_else(|| read_table_catalog_spec(&tables_map, &txn, &table.name));
    tables_map.remove(&mut txn, old_name);
    let old_range_id = table_range_id(old_name);
    compute_document::range::remove_range_binding_wb(&workbook, &mut txn, &old_range_id);

    write_table_catalog_entry(&tables_map, &mut txn, table, existing_spec);
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
    let existing_spec = read_table_catalog_spec(&tables_map, &txn, &table.name);
    write_table_catalog_entry(&tables_map, &mut txn, table, existing_spec);
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

    let tables_map = crate::storage::ensure_workbook_child_map(
        &workbook,
        &mut txn,
        compute_document::schema::KEY_TABLES,
    );
    tables_map.remove(&mut txn, table_name);

    let range_id = table_range_id(table_name);
    compute_document::range::remove_range_binding_wb(&workbook, &mut txn, &range_id);

    if let Some((sheet_id, filter_id)) = table_filter {
        filters::delete_filter_in_txn(&mut txn, &sheets, sheet_id, filter_id);
    }
}

/// Persist the current table style fields to the Yrs document.
///
/// Updates both `workbook.tables[<name>]` and
/// `workbook.rangeBindings[table:<name>]` in a single `ORIGIN_USER_EDIT`
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
    let existing_spec = read_table_catalog_spec(&tables_map, &txn, table_name);
    write_table_catalog_entry(&tables_map, &mut txn, table, existing_spec);
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
    let (yrs_tables, yrs_names): (Vec<CanonicalTable>, std::collections::HashSet<String>) = {
        let txn = stores.storage.doc().transact();
        let mut tables = Vec::new();
        let mut names = std::collections::HashSet::new();

        // Read runtime table bindings first; they carry the live range-backed
        // table identity used by the compute mirror.
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

        // Read catalog-only tables, including imported documents that do not
        // yet have range-backed bindings.
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
