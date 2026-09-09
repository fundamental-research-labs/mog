//! Slicer export helpers.

use domain_types::domain::slicer::{SlicerSource, StoredSlicer};

use super::TableExportProjection;
use crate::storage::engine::stores::EngineStores;

/// Export slicer caches from the workbook-level slicers map.
pub(in crate::storage::engine) fn export_workbook_slicer_caches(
    stores: &EngineStores,
    table_projection: Option<&TableExportProjection>,
) -> Vec<ooxml_types::slicers::SlicerCacheDef> {
    let mut caches: Vec<_> = stores
        .storage
        .metadata
        .slicers
        .values()
        .map(|stored| {
            let mut cache = domain_types::domain::slicer::stored_slicer_to_cache_def(stored);
            if let Some(table_projection) = table_projection {
                reconcile_table_slicer_cache(stored, &mut cache, table_projection);
            }
            cache
        })
        .collect();
    // Multiple worksheet controls may share one workbook cache part.
    caches.sort_by(|left, right| left.name.cmp(&right.name));
    caches.dedup_by(|left, right| left.name == right.name);
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

/// Resolve native pivot bindings against the worksheet IDs that the XLSX writer uses.
pub(super) fn reconcile_pivot_bindings(output: &mut domain_types::ParseOutput) {
    let Ok(sheet_ids) = output.resolved_worksheet_ids() else {
        // The writer reports invalid or exhausted worksheet IDs at its fallible boundary.
        return;
    };
    let resolve = |key: &str| {
        let pivot = output
            .pivot_tables
            .iter()
            .find(|pivot| pivot.config.id == key)
            .or_else(|| {
                output
                    .pivot_tables
                    .iter()
                    .find(|pivot| pivot.config.name == key)
            })?;
        let index = output
            .sheets
            .iter()
            .position(|sheet| sheet.name == pivot.config.output_sheet_name)?;
        Some((&pivot.config, sheet_ids[index]))
    };
    for cache in &mut output.slicer_caches {
        for reference in &mut cache.pivot_tables {
            if let Some((pivot, tab_id)) = resolve(&reference.name) {
                reference.name.clone_from(&pivot.name);
                reference.tab_id = tab_id;
                if let (Some(tabular), Some(cache_id)) = (&mut cache.tabular_data, pivot.cache_id) {
                    tabular.pivot_cache_id = cache_id;
                }
            }
        }
    }
    for cache in &mut output.timeline_caches {
        for reference in &mut cache.pivot_tables {
            if let Some((pivot, tab_id)) = resolve(&reference.name) {
                reference.name.clone_from(&pivot.name);
                reference.tab_id = tab_id;
                if pivot.cache_id.is_some() {
                    cache.pivot_cache_id = pivot.cache_id;
                }
            }
        }
    }
}
