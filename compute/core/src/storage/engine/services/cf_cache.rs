//! Extracted CF cache service functions.
//!
//! Handles re-evaluation of conditional formatting rules and cache management.
//! The original methods on `ComputeEngine` delegate to these free functions.

use std::collections::HashMap;

use crate::cells::CellStore;
use crate::snapshot::RecalcResult;
use crate::storage::engine::CFCacheEntry;
use crate::storage::engine::cf_cache::convert_cf_formats_to_rules;
use crate::storage::engine::stores::EngineStores;
use crate::storage::sheet::cf_store;
use cell_types::SheetId;
use rustc_hash::{FxHashMap, FxHashSet};

/// After a recalculation pass, refresh the CF cache for every sheet that
/// both (a) has conditional formatting rules and (b) had at least one cell
/// change in the recalc result.
pub(in crate::storage::engine) fn refresh_cf_caches_after_recalc(
    stores: &mut EngineStores,
    cell_store: &CellStore,
    theme_palette: &HashMap<String, String>,
    recalc: &RecalcResult,
) {
    if stores.cf_cache.is_empty() {
        return;
    }

    // Collect unique sheet IDs from changed cells that have CF rules
    let mut affected_sheets: FxHashSet<SheetId> = FxHashSet::default();
    for change in &recalc.changed_cells {
        if let Ok(sid) = SheetId::from_uuid_str(&change.sheet_id)
            && stores.cf_cache.contains_key(&sid)
        {
            affected_sheets.insert(sid);
        }
    }

    // Also check projection changes (dynamic array spills)
    for proj in &recalc.projection_changes {
        if let Ok(sid) = SheetId::from_uuid_str(&proj.sheet_id)
            && stores.cf_cache.contains_key(&sid)
        {
            affected_sheets.insert(sid);
        }
    }

    for sheet_id in &affected_sheets {
        refresh_cf_cache(stores, cell_store, theme_palette, sheet_id);
    }
}

/// Re-evaluate all conditional formatting rules for a sheet and update the cache.
///
/// Pipeline: read CF formats from native storage -> convert domain types to
/// compute-cf rules -> evaluate via `ComputeCore::eval_cf` -> store results
/// in `cf_cache` keyed by `(row, col)`.
pub(in crate::storage::engine) fn refresh_cf_cache(
    stores: &mut EngineStores,
    cell_store: &CellStore,
    theme_palette: &HashMap<String, String>,
    sheet_id: &SheetId,
) {
    let Some(results) = evaluate_cf_for_sheet(stores, cell_store, theme_palette, sheet_id) else {
        stores.cf_cache.remove(sheet_id);
        return;
    };

    // 5. Convert Vec<CellCFResult> to HashMap keyed by (row, col)
    let mut result_map = FxHashMap::default();
    for result in results {
        result_map.insert((result.row, result.col), result);
    }

    // 6. Store in cache
    stores.cf_cache.insert(
        *sheet_id,
        CFCacheEntry {
            results: result_map,
        },
    );
}

/// Fresh evaluation shared by display caching and filter predicates. It must not
/// read the display cache: filter reapply observes current rules and values.
pub(in crate::storage::engine) fn evaluate_cf_for_sheet(
    stores: &EngineStores,
    cell_store: &CellStore,
    theme_palette: &HashMap<String, String>,
    sheet_id: &SheetId,
) -> Option<Vec<crate::cf::types::CellCFResult>> {
    // 1. Read CF formats from native storage
    let formats = cf_store::get_formats_for_sheet(&stores.storage, sheet_id);

    let rules = convert_cf_formats_to_rules(&formats, Some(*sheet_id), theme_palette);

    // 3. If no rules, remove cache entry and return
    if rules.is_empty() {
        return None;
    }

    // 4. Evaluate CF rules
    Some(stores.compute.eval_cf(cell_store, sheet_id, &rules))
}

/// Materialize icon identities only for filters that require CF context.
pub(in crate::storage::engine) fn evaluate_filter_icons(
    stores: &EngineStores,
    cell_store: &CellStore,
    sheet_id: &SheetId,
    filter_id: &str,
) -> FxHashMap<(u32, u32), domain_types::FilterIconIdentity> {
    let needs_icons =
        crate::storage::sheet::filters::get_filter(&stores.storage, sheet_id, filter_id)
            .is_some_and(|filter| {
                filter
                    .column_filters
                    .values()
                    .any(|criterion| matches!(criterion, domain_types::ColumnFilter::Icon { .. }))
            });
    if !needs_icons {
        return FxHashMap::default();
    }
    // Theme color resolution has no bearing on icon identity or rule matching.
    evaluate_cf_for_sheet(stores, cell_store, &HashMap::new(), sheet_id)
        .unwrap_or_default()
        .into_iter()
        .filter_map(|cell| {
            let icon = cell.icon?;
            let count = icon.set_name.icon_count();
            let index = count.checked_sub(usize::from(icon.icon_index) + 1)?;
            let name = compute_cf::types::CFIconSetName::SERDE_NAMES[icon.set_name as usize];
            Some((
                (cell.row, cell.col),
                domain_types::FilterIconIdentity {
                    icon_set_name: name.into(),
                    icon_index: index as u32,
                },
            ))
        })
        .collect()
}
