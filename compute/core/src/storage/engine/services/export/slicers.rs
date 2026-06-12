//! Slicer export helpers.

use compute_document::schema::KEY_SLICERS;
use domain_types::{
    domain::slicer::{SlicerSource, StoredSlicer},
    yrs_schema,
};
use yrs::{Any, Map, Out, Transact};

use super::TableExportProjection;
use crate::storage::engine::stores::EngineStores;

/// Export slicer caches from the workbook-level slicers map.
pub(in crate::storage::engine) fn export_workbook_slicer_caches(
    stores: &EngineStores,
    table_projection: Option<&TableExportProjection>,
) -> Vec<ooxml_types::slicers::SlicerCacheDef> {
    let doc = stores.storage.doc();
    let txn = doc.transact();
    let workbook = stores.storage.workbook_map();

    let slicers_map = match workbook.get(&txn, KEY_SLICERS) {
        Some(Out::YMap(m)) => m,
        _ => return vec![],
    };

    let mut caches = Vec::new();
    for (_, value) in slicers_map.iter(&txn) {
        if let Some(stored) = yrs_schema::slicer::from_yrs_out(value.clone(), &txn) {
            let mut cache = domain_types::domain::slicer::stored_slicer_to_cache_def(&stored);
            if let Some(table_projection) = table_projection {
                reconcile_table_slicer_cache(&stored, &mut cache, table_projection);
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

fn reconcile_table_slicer_cache(
    stored: &StoredSlicer,
    cache: &mut ooxml_types::slicers::SlicerCacheDef,
    table_projection: &TableExportProjection,
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

    let Some(table) = table_projection
        .get(table_id)
        .or_else(|| table_projection.get(&table_cache.table_id.to_string()))
    else {
        return;
    };

    table_cache.table_id = table.ooxml_table_id;
    if let Some((index, column)) = table.columns.iter().enumerate().find(|(_, column)| {
        column
            .stable_column_id
            .as_deref()
            .is_some_and(|stable_id| stable_id == column_cell_id)
            || column.name.eq_ignore_ascii_case(column_cell_id)
            || column.ooxml_column_id.to_string() == *column_cell_id
    }) {
        table_cache.column = index as u32;
        cache.source_name.clone_from(&column.name);
    }
}
