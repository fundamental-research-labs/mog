//! Slicer export helpers.

use compute_document::schema::KEY_SLICERS;
use domain_types::{
    SheetData,
    domain::slicer::{SlicerSource, StoredSlicer},
    domain::table::TableSpec,
    yrs_schema,
};
use yrs::{Any, Map, Out, Transact};

use crate::storage::engine::stores::EngineStores;

/// Export slicer caches from the workbook-level slicers map.
pub(in crate::storage::engine) fn export_workbook_slicer_caches(
    stores: &EngineStores,
    exported_sheets: Option<&[SheetData]>,
) -> Vec<ooxml_types::slicers::SlicerCacheDef> {
    let doc = stores.storage.doc();
    let txn = doc.transact();
    let workbook = stores.storage.workbook_map();
    let table_lookup = exported_sheets.map(build_exported_table_lookup);

    let slicers_map = match workbook.get(&txn, KEY_SLICERS) {
        Some(Out::YMap(m)) => m,
        _ => return vec![],
    };

    let mut caches = Vec::new();
    for (_, value) in slicers_map.iter(&txn) {
        if let Some(stored) = yrs_schema::slicer::from_yrs_out(value.clone(), &txn) {
            let mut cache = domain_types::domain::slicer::stored_slicer_to_cache_def(&stored);
            if let Some(table_lookup) = table_lookup.as_ref() {
                reconcile_table_slicer_cache(&stored, &mut cache, table_lookup);
            }
            caches.push(cache);
            continue;
        }
        if let Out::Any(Any::String(json_str)) = value {
            match serde_json::from_str::<ooxml_types::slicers::SlicerCacheDef>(&json_str) {
                Ok(cache_def) => caches.push(cache_def),
                Err(e) => {
                    tracing::warn!(
                        error = %e,
                        "Failed to deserialize slicer entry during export, skipping"
                    );
                }
            }
        }
    }
    caches
}

type ExportedTableLookup<'a> = std::collections::HashMap<String, (u32, &'a TableSpec)>;

fn build_exported_table_lookup(sheets: &[SheetData]) -> ExportedTableLookup<'_> {
    let mut lookup = ExportedTableLookup::new();
    let mut global_table_idx = 0u32;
    for sheet in sheets {
        for table in &sheet.tables {
            global_table_idx += 1;
            let ooxml_id = if table.id > 0 {
                table.id
            } else {
                global_table_idx
            };
            insert_exported_table_key(&mut lookup, table.name.as_str(), ooxml_id, table);
            insert_exported_table_key(&mut lookup, table.display_name.as_str(), ooxml_id, table);
            if table.id > 0 {
                insert_exported_table_key(&mut lookup, &table.id.to_string(), ooxml_id, table);
            }
            insert_exported_table_key(&mut lookup, &ooxml_id.to_string(), ooxml_id, table);
        }
    }
    lookup
}

fn insert_exported_table_key<'a>(
    lookup: &mut ExportedTableLookup<'a>,
    key: &str,
    ooxml_id: u32,
    table: &'a TableSpec,
) {
    if key.is_empty() {
        return;
    }
    lookup
        .entry(key.to_ascii_lowercase())
        .or_insert((ooxml_id, table));
}

fn reconcile_table_slicer_cache(
    stored: &StoredSlicer,
    cache: &mut ooxml_types::slicers::SlicerCacheDef,
    table_lookup: &ExportedTableLookup<'_>,
) {
    let SlicerSource::Table {
        table_id,
        column_cell_id,
    } = &stored.source
    else {
        return;
    };
    let Some(table_cache) = cache.table_slicer_cache.as_mut() else {
        return;
    };

    let target = table_lookup
        .get(&table_id.to_ascii_lowercase())
        .or_else(|| table_lookup.get(&table_cache.table_id.to_string()));
    let Some((ooxml_id, table)) = target else {
        return;
    };

    table_cache.table_id = *ooxml_id;
    if stored.table_column_index.is_none()
        && let Some(index) = table.columns.iter().position(|column| {
            column.name.eq_ignore_ascii_case(column_cell_id)
                || column.id.to_string() == *column_cell_id
        })
    {
        table_cache.column = index as u32;
    }
}
